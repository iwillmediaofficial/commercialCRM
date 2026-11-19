-- ---------------------------------------------------------------------------
-- First-contact deadline and Stuck lock
--
-- * A new lead given to someone gets an automatic follow-up N working minutes
--   later (9 AM to 8 PM India time), so an uncontacted lead turns Overdue by
--   itself. The first call/WhatsApp/meeting clears that automatic deadline.
-- * Stuck lock: after the lock time (India time), staff with an overdue lead
--   see only their overdue leads until each is contacted and rescheduled (or
--   closed). Owners and admins are never locked. Admins can unlock a person
--   for the rest of the day. Stuck staff are skipped by the lead rotation.
-- ---------------------------------------------------------------------------

alter table public.workspace_settings
  add column if not exists first_contact_minutes int default 60
    check (first_contact_minutes is null or first_contact_minutes between 5 and 480),
  add column if not exists stuck_lock_enabled boolean not null default false,
  add column if not exists stuck_lock_time time not null default '12:00';

alter table public.leads
  add column if not exists follow_up_auto boolean not null default false;

-- Admin "Unlock for today".
create table if not exists public.lead_lock_overrides (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  unlocked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id, day)
);
create index if not exists lead_lock_overrides_user_idx on public.lead_lock_overrides(user_id);
create index if not exists lead_lock_overrides_by_idx on public.lead_lock_overrides(unlocked_by);
alter table public.lead_lock_overrides enable row level security;
create policy lead_lock_overrides_read on public.lead_lock_overrides for select to authenticated
  using (user_id = (select auth.uid()) or public.is_workspace_admin(workspace_id) or public.is_platform_admin());
grant select on public.lead_lock_overrides to authenticated;

-- ---------------------------------------------------------------------------
-- Is this person stuck right now?
-- ---------------------------------------------------------------------------
create or replace function private.lead_overdue_count(p_ws uuid, p_user uuid)
returns int
language sql stable security definer
set search_path = ''
as $$
  select count(*)::int from public.leads l
  where l.workspace_id = p_ws and l.assigned_to = p_user
    and l.stage not in ('won', 'lost')
    and l.follow_up_at < now();
$$;

create or replace function private.is_lead_stuck(p_ws uuid, p_user uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select s.stuck_lock_enabled
       and (now() at time zone 'Asia/Kolkata')::time >= s.stuck_lock_time
       and exists (select 1 from public.workspace_members m
                   where m.workspace_id = p_ws and m.user_id = p_user and m.is_active and m.role = 'staff')
       and not exists (select 1 from public.lead_lock_overrides o
                       where o.workspace_id = p_ws and o.user_id = p_user
                         and o.day = (now() at time zone 'Asia/Kolkata')::date)
       and private.lead_overdue_count(p_ws, p_user) > 0
    from public.workspace_settings s where s.workspace_id = p_ws
  ), false);
$$;
revoke execute on function private.lead_overdue_count(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.is_lead_stuck(uuid, uuid) from public, anon, authenticated;

-- For the app: the signed-in person's lock state.
create or replace function public.my_lead_lock(p_workspace_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled', coalesce(s.stuck_lock_enabled, false),
    'lock_time', to_char(coalesce(s.stuck_lock_time, '12:00'), 'HH24:MI'),
    'stuck', private.is_lead_stuck(p_workspace_id, (select auth.uid())),
    'overdue', private.lead_overdue_count(p_workspace_id, (select auth.uid())),
    'unlocked_today', exists (select 1 from public.lead_lock_overrides o
                              where o.workspace_id = p_workspace_id and o.user_id = (select auth.uid())
                                and o.day = (now() at time zone 'Asia/Kolkata')::date)
  )
  from public.workspace_settings s
  where s.workspace_id = p_workspace_id and public.is_workspace_member(p_workspace_id);
$$;
revoke execute on function public.my_lead_lock(uuid) from public, anon;
grant execute on function public.my_lead_lock(uuid) to authenticated;

-- For admins: everyone's lock state.
create or replace function public.team_lead_lock(p_workspace_id uuid)
returns table (user_id uuid, overdue int, stuck boolean, unlocked_today boolean)
language sql stable security definer
set search_path = ''
as $$
  select m.user_id,
         private.lead_overdue_count(p_workspace_id, m.user_id),
         private.is_lead_stuck(p_workspace_id, m.user_id),
         exists (select 1 from public.lead_lock_overrides o
                 where o.workspace_id = p_workspace_id and o.user_id = m.user_id
                   and o.day = (now() at time zone 'Asia/Kolkata')::date)
  from public.workspace_members m
  where m.workspace_id = p_workspace_id and m.is_active
    and (public.is_workspace_admin(p_workspace_id) or public.is_platform_admin());
$$;
revoke execute on function public.team_lead_lock(uuid) from public, anon;
grant execute on function public.team_lead_lock(uuid) to authenticated;

create or replace function public.unlock_lead_lock(p_workspace_id uuid, p_user_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_admin text;
begin
  if not public.can_admin_write(p_workspace_id, 'leads') then
    raise exception 'Only owners and admins can unlock someone.';
  end if;
  if not exists (select 1 from public.workspace_members m where m.workspace_id = p_workspace_id and m.user_id = p_user_id) then
    raise exception 'That person is not in this company.';
  end if;
  insert into public.lead_lock_overrides (workspace_id, user_id, day, unlocked_by)
  values (p_workspace_id, p_user_id, (now() at time zone 'Asia/Kolkata')::date, (select auth.uid()))
  on conflict (workspace_id, user_id, day) do nothing;
  select coalesce(nullif(p.full_name, ''), p.email, 'An admin') into v_admin from public.profiles p where p.id = (select auth.uid());
  insert into public.notifications (workspace_id, user_id, type, title, message, link)
  values (p_workspace_id, p_user_id, 'lead', 'Leads unlocked for today',
          coalesce(v_admin, 'An admin') || ' unlocked your leads for the rest of today. Please still clear your overdue follow-ups.', '/follow-ups');
end;
$$;
revoke execute on function public.unlock_lead_lock(uuid, uuid) from public, anon;
grant execute on function public.unlock_lead_lock(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Follow-up rules, now with the first-contact deadline.
-- ---------------------------------------------------------------------------
create or replace function private.lead_follow_up_rules()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_minutes int;
  v_auto boolean := false;
begin
  -- Moving a lead on from "New" means someone has been in touch.
  if new.stage <> 'new' and new.first_contacted_at is null then
    new.first_contacted_at := now();
  end if;

  -- First-contact deadline: a new, uncontacted lead given to someone is due
  -- N working minutes later, unless someone already set a follow-up by hand.
  if new.assigned_to is not null and new.first_contacted_at is null and new.stage = 'new'
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and (new.follow_up_at is null
          or (tg_op = 'UPDATE' and old.follow_up_auto and new.follow_up_at is not distinct from old.follow_up_at)) then
    select s.first_contact_minutes into v_minutes from public.workspace_settings s where s.workspace_id = new.workspace_id;
    if v_minutes is not null then
      new.follow_up_at := private.pass_on_deadline(coalesce(new.assigned_at, now()), v_minutes);
      v_auto := true;
    end if;
  end if;

  if v_auto then
    new.follow_up_auto := true;
  elsif tg_op = 'INSERT' then
    new.follow_up_auto := false;
  elsif new.follow_up_at is distinct from old.follow_up_at then
    new.follow_up_auto := false;           -- someone set it by hand
  elsif old.follow_up_auto and old.first_contacted_at is null and new.first_contacted_at is not null then
    -- First contact made: the automatic deadline has done its job.
    new.follow_up_at := null;
    new.follow_up_date := null;
    new.follow_up_auto := false;
  else
    new.follow_up_auto := old.follow_up_auto;
  end if;

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
    new.follow_up_auto := false;
  end if;

  if new.stage in ('won', 'lost') then
    new.follow_up_at := null;
    new.follow_up_date := null;
    new.follow_up_auto := false;
  end if;
  if new.stage <> 'lost' then
    new.lost_reason := null;
  else
    new.lost_reason := nullif(btrim(new.lost_reason), '');
  end if;

  if tg_op = 'INSERT' or new.follow_up_at is distinct from old.follow_up_at then
    new.follow_up_notified_at := null;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- While stuck, an overdue lead can't just be pushed to a later date: it must
-- be contacted first (or closed as Won/Lost).
-- ---------------------------------------------------------------------------
create or replace function private.lead_stuck_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null
     or old.stage in ('won', 'lost') or new.stage in ('won', 'lost')
     or old.follow_up_at is null or old.follow_up_at >= now()
     or new.follow_up_at is not distinct from old.follow_up_at
     or not private.is_lead_stuck(new.workspace_id, v_uid) then
    return new;
  end if;
  if not exists (select 1 from public.lead_activities a
                 where a.lead_id = new.id and a.kind in ('call', 'whatsapp', 'meeting')
                   and a.created_at >= old.follow_up_at) then
    raise exception 'Contact this lead first (Call or WhatsApp), then set the next follow-up.';
  end if;
  return new;
end;
$$;
create or replace trigger leads_stuck_guard before update of follow_up_at, follow_up_date on public.leads
  for each row execute function private.lead_stuck_guard();

-- ---------------------------------------------------------------------------
-- The rotation skips people who are stuck.
-- ---------------------------------------------------------------------------
create or replace function private.pick_lead_assignee(p_ws uuid, p_form uuid, p_exclude uuid default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_pool uuid;
  v_user uuid;
begin
  -- A form with its own list (and someone in it) uses that list.
  if p_form is not null and exists (
       select 1 from public.lead_forms f
       join public.lead_assignment_members m on m.form_id = f.id and m.in_rotation
       where f.id = p_form and f.own_rotation) then
    v_pool := p_form;
  end if;

  perform pg_advisory_xact_lock(hashtext('lead-rotation:' || p_ws::text || ':' || coalesce(v_pool::text, 'main')));

  select m.user_id into v_user
  from public.lead_assignment_members m
  join public.workspace_members wm on wm.workspace_id = m.workspace_id and wm.user_id = m.user_id and wm.is_active
  where m.workspace_id = p_ws
    and m.form_id is not distinct from v_pool
    and m.in_rotation and not m.is_away
    and not private.is_lead_stuck(p_ws, m.user_id)
    and m.user_id is distinct from p_exclude
  order by m.last_assigned_at nulls first, m.position, m.created_at
  limit 1;

  if v_user is not null then
    update public.lead_assignment_members
    set last_assigned_at = clock_timestamp()
    where workspace_id = p_ws and form_id is not distinct from v_pool and user_id = v_user;
  end if;
  return v_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- Warning 30 minutes before the lock, once a day, to staff with overdue leads.
-- Runs from the existing 15-minute reminder job.
-- ---------------------------------------------------------------------------
create or replace function private.send_lead_lock_warnings()
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.notifications (workspace_id, user_id, type, title, message, link)
  select m.workspace_id, m.user_id, 'lead',
         'Leads lock at ' || to_char(s.stuck_lock_time, 'FMHH12:MI AM'),
         private.lead_overdue_count(m.workspace_id, m.user_id) || ' overdue lead'
           || case when private.lead_overdue_count(m.workspace_id, m.user_id) = 1 then '' else 's' end
           || '. Contact them before then to keep full access.',
         '/follow-ups'
  from public.workspace_settings s
  join public.workspace_members m on m.workspace_id = s.workspace_id and m.is_active and m.role = 'staff'
  where s.stuck_lock_enabled
    and (now() at time zone 'Asia/Kolkata')::time >= s.stuck_lock_time - interval '30 minutes'
    and (now() at time zone 'Asia/Kolkata')::time < s.stuck_lock_time
    and private.lead_overdue_count(m.workspace_id, m.user_id) > 0
    and public.workspace_status(s.workspace_id) in ('trial', 'active', 'grace')
    and public.workspace_has_module(s.workspace_id, 'leads')
    and not exists (select 1 from public.notifications n
                    where n.workspace_id = m.workspace_id and n.user_id = m.user_id
                      and n.title like 'Leads lock at %'
                      and n.created_at >= ((now() at time zone 'Asia/Kolkata')::date at time zone 'Asia/Kolkata'));
$$;
revoke execute on function private.send_lead_lock_warnings() from public, anon, authenticated;

create or replace function private.send_follow_up_reminders()
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.send_lead_lock_warnings();
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
