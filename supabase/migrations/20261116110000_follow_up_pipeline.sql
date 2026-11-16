-- ---------------------------------------------------------------------------
-- Follow-up pipeline (lead management plan, phase 2)
--
-- * Follow-ups get a time of day (follow_up_at). follow_up_date stays, kept in
--   step automatically, so older screens and reports keep working.
-- * Contact tracking: logging a call, WhatsApp or meeting marks the lead as
--   contacted (and moves a "New" lead to "Contacted").
-- * Lost reason; Won/Lost clears the follow-up.
-- * In-app reminders: a bell notification when a follow-up falls due (checked
--   every 15 minutes) and a 9:00 AM IST summary of today's follow-ups.
-- All times are India time (the app is INR-only).
-- ---------------------------------------------------------------------------

alter table public.leads
  add column if not exists follow_up_at timestamptz,
  add column if not exists follow_up_notified_at timestamptz,
  add column if not exists first_contacted_at timestamptz,
  add column if not exists last_contacted_at timestamptz,
  add column if not exists lost_reason text check (lost_reason is null or length(lost_reason) <= 200);

-- Existing follow-up dates become 10:00 AM that day.
update public.leads
set follow_up_at = (follow_up_date + time '10:00') at time zone 'Asia/Kolkata',
    follow_up_notified_at = case when follow_up_date < (now() at time zone 'Asia/Kolkata')::date then now() end
where follow_up_date is not null and follow_up_at is null;

-- Leads already past "New" count as contacted.
update public.leads
set first_contacted_at = created_at
where stage <> 'new' and first_contacted_at is null;

create index if not exists leads_follow_up_idx on public.leads(workspace_id, follow_up_at);
create index if not exists leads_follow_up_due_idx on public.leads(follow_up_at)
  where follow_up_notified_at is null and follow_up_at is not null;

-- ---------------------------------------------------------------------------
-- Keep follow-up fields consistent on every save.
-- ---------------------------------------------------------------------------
create or replace function private.lead_follow_up_rules()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.follow_up_at is not null then
      new.follow_up_date := (new.follow_up_at at time zone 'Asia/Kolkata')::date;
    elsif new.follow_up_date is not null then
      new.follow_up_at := (new.follow_up_date + time '10:00') at time zone 'Asia/Kolkata';
    end if;
  elsif new.follow_up_at is distinct from old.follow_up_at then
    new.follow_up_date := (new.follow_up_at at time zone 'Asia/Kolkata')::date;
  elsif new.follow_up_date is distinct from old.follow_up_date then
    -- An older screen changed only the date: keep the time, or use 10:00 AM.
    new.follow_up_at := case when new.follow_up_date is null then null
      else (new.follow_up_date + coalesce((old.follow_up_at at time zone 'Asia/Kolkata')::time, time '10:00'))
           at time zone 'Asia/Kolkata' end;
  end if;

  if new.stage in ('won', 'lost') then
    new.follow_up_at := null;
    new.follow_up_date := null;
  end if;
  if new.stage <> 'lost' then
    new.lost_reason := null;
  else
    new.lost_reason := nullif(btrim(new.lost_reason), '');
  end if;

  if tg_op = 'INSERT' or new.follow_up_at is distinct from old.follow_up_at then
    new.follow_up_notified_at := null;
  end if;

  -- Moving a lead on from "New" means someone has been in touch.
  if new.stage <> 'new' and new.first_contacted_at is null then
    new.first_contacted_at := now();
  end if;
  return new;
end;
$$;
create trigger leads_follow_up_rules before insert or update on public.leads
  for each row execute function private.lead_follow_up_rules();

-- ---------------------------------------------------------------------------
-- Timeline: follow-ups are logged with their time, and Lost with its reason.
-- ---------------------------------------------------------------------------
create or replace function private.log_lead_changes()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    insert into public.lead_activities (workspace_id, lead_id, kind, details, created_by, created_at)
    values (new.workspace_id, new.id, 'created',
            jsonb_build_object('source', new.source, 'form_id', new.form_id, 'stage', new.stage,
                               'assigned_to', new.assigned_to),
            v_actor, new.created_at);
    return null;
  end if;

  if new.stage is distinct from old.stage then
    insert into public.lead_activities (workspace_id, lead_id, kind, details, created_by)
    values (new.workspace_id, new.id, 'stage',
            jsonb_strip_nulls(jsonb_build_object('from', old.stage, 'to', new.stage, 'reason', new.lost_reason)), v_actor);
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.lead_activities (workspace_id, lead_id, kind, details, created_by)
    values (new.workspace_id, new.id, 'assigned', jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to), v_actor);
  end if;
  -- Won/Lost clear the follow-up; the stage entry already says so.
  if new.follow_up_at is distinct from old.follow_up_at and new.stage not in ('won', 'lost') then
    insert into public.lead_activities (workspace_id, lead_id, kind, details, created_by)
    values (new.workspace_id, new.id, 'follow_up', jsonb_build_object('from', old.follow_up_at, 'to', new.follow_up_at), v_actor);
  end if;
  if new.converted_client_id is not null and old.converted_client_id is null then
    insert into public.lead_activities (workspace_id, lead_id, kind, details, created_by)
    values (new.workspace_id, new.id, 'converted', jsonb_build_object('client_id', new.converted_client_id), v_actor);
  end if;
  return null;
end;
$$;
create or replace trigger leads_log_changes
  after insert or update of stage, assigned_to, follow_up_at, follow_up_date, converted_client_id
  on public.leads for each row execute function private.log_lead_changes();

-- ---------------------------------------------------------------------------
-- A logged call, WhatsApp or meeting counts as contact.
-- ---------------------------------------------------------------------------
create or replace function private.lead_activity_changed()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  -- new is null when a row is removed, old is null when one is added.
  if coalesce(new.kind, old.kind) in ('remark', 'call', 'whatsapp', 'meeting') then
    perform private.refresh_last_remark(coalesce(new.lead_id, old.lead_id));
  end if;
  if tg_op = 'INSERT' and new.kind in ('call', 'whatsapp', 'meeting') then
    update public.leads
    set last_contacted_at = greatest(coalesce(last_contacted_at, new.created_at), new.created_at),
        first_contacted_at = coalesce(first_contacted_at, new.created_at),
        stage = case when stage = 'new' then 'contacted' else stage end
    where id = new.lead_id;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reminders (in-app only). Switch off with the "follow_up_reminders" rule.
-- ---------------------------------------------------------------------------
create or replace function private.send_follow_up_reminders()
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  with due as (
    update public.leads l
    set follow_up_notified_at = now()
    where l.follow_up_at <= now()
      and l.follow_up_notified_at is null
      and l.stage not in ('won', 'lost')
    returning l.id, l.workspace_id, l.assigned_to, l.name, l.company, l.follow_up_at
  )
  insert into public.notifications (workspace_id, user_id, type, title, message, link)
  select d.workspace_id, coalesce(d.assigned_to, m.user_id), 'lead',
         'Follow up: ' || coalesce(nullif(d.company, ''), d.name),
         'Due ' || to_char(d.follow_up_at at time zone 'Asia/Kolkata', 'FMDD Mon, FMHH12:MI AM')
           || case when d.assigned_to is null then ' (nobody is assigned)' else '' end,
         '/leads?open=' || d.id
  from due d
  left join public.workspace_members m
    on d.assigned_to is null and m.workspace_id = d.workspace_id and m.role in ('owner', 'admin') and m.is_active
  where d.follow_up_at > now() - interval '1 day'   -- don't re-announce long-overdue ones
    and (d.assigned_to is not null or m.user_id is not null)
    and private.rule_on(d.workspace_id, 'follow_up_reminders')
    and public.workspace_status(d.workspace_id) in ('trial', 'active', 'grace')
    and public.workspace_has_module(d.workspace_id, 'leads');
end;
$$;

create or replace function private.send_follow_up_summary()
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.notifications (workspace_id, user_id, type, title, message, link)
  select s.workspace_id, s.assigned_to, 'lead',
         s.total || ' follow-up' || case when s.total = 1 then '' else 's' end || ' today',
         case when s.overdue > 0 then s.overdue || ' overdue from earlier days' else 'Nothing overdue' end,
         '/follow-ups'
  from (
    select l.workspace_id, l.assigned_to,
           count(*) as total,
           count(*) filter (where (l.follow_up_at at time zone 'Asia/Kolkata')::date < (now() at time zone 'Asia/Kolkata')::date) as overdue
    from public.leads l
    join public.workspace_members m on m.workspace_id = l.workspace_id and m.user_id = l.assigned_to and m.is_active
    where l.follow_up_at is not null
      and l.stage not in ('won', 'lost')
      and (l.follow_up_at at time zone 'Asia/Kolkata')::date <= (now() at time zone 'Asia/Kolkata')::date
    group by l.workspace_id, l.assigned_to
  ) s
  where private.rule_on(s.workspace_id, 'follow_up_reminders')
    and public.workspace_status(s.workspace_id) in ('trial', 'active', 'grace')
    and public.workspace_has_module(s.workspace_id, 'leads');
$$;

revoke execute on function private.send_follow_up_reminders() from public, anon, authenticated;
revoke execute on function private.send_follow_up_summary() from public, anon, authenticated;

select cron.schedule('follow-up-reminders', '*/15 * * * *', $$select private.send_follow_up_reminders()$$);
select cron.schedule('follow-up-summary', '30 3 * * *', $$select private.send_follow_up_summary()$$);
