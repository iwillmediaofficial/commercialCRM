-- ---------------------------------------------------------------------------
-- Automatic lead assignment (lead management plan, phase 3 and 3b)
--
-- * Admins pick the staff in a rotation. Each new lead goes to whoever in the
--   rotation was given a lead longest ago (skipping people marked away or
--   deactivated). A lead form can have its own staff list.
-- * 3b: an auto-assigned lead nobody has called, messaged or remarked on within
--   the set minutes (counted in working hours, 9 AM to 8 PM India time) moves
--   to the next person. It stops once everyone in the list has had it.
-- Rows are never removed from the rotation table; "in_rotation" switches them off.
-- ---------------------------------------------------------------------------

alter table public.workspace_settings
  add column if not exists auto_assign_enabled boolean not null default false,
  add column if not exists auto_assign_manual boolean not null default false,
  add column if not exists pass_on_minutes int check (pass_on_minutes is null or pass_on_minutes between 5 and 1440);

alter table public.lead_forms
  add column if not exists own_rotation boolean not null default false;

alter table public.leads
  add column if not exists assigned_at timestamptz,
  add column if not exists auto_assigned boolean not null default false,
  add column if not exists pass_on_count int not null default 0;

update public.leads set assigned_at = coalesce(updated_at, created_at)
where assigned_to is not null and assigned_at is null;

create table public.lead_assignment_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  form_id uuid references public.lead_forms(id) on delete cascade, -- null = the main rotation
  user_id uuid not null references auth.users(id) on delete cascade,
  in_rotation boolean not null default true,
  is_away boolean not null default false,
  position int not null default 0,
  last_assigned_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index lead_assignment_members_uniq
  on public.lead_assignment_members(workspace_id, coalesce(form_id, '00000000-0000-0000-0000-000000000000'::uuid), user_id);
create index lead_assignment_members_form_idx on public.lead_assignment_members(form_id);
create index lead_assignment_members_user_idx on public.lead_assignment_members(user_id);

alter table public.lead_assignment_members enable row level security;

create policy lead_assignment_members_read on public.lead_assignment_members for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_platform_admin());
create policy lead_assignment_members_insert on public.lead_assignment_members for insert to authenticated
  with check (public.can_admin_write(workspace_id, 'leads'));
create policy lead_assignment_members_update on public.lead_assignment_members for update to authenticated
  using (public.can_admin_write(workspace_id, 'leads'))
  with check (public.can_admin_write(workspace_id, 'leads'));
grant select, insert, update on public.lead_assignment_members to authenticated;

-- The person must belong to the workspace, and a form must be in the same workspace.
create or replace function private.lead_assignment_member_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.workspace_members m where m.workspace_id = new.workspace_id and m.user_id = new.user_id) then
    raise exception 'That person is not in this company.';
  end if;
  if new.form_id is not null and not exists (select 1 from public.lead_forms f where f.id = new.form_id and f.workspace_id = new.workspace_id) then
    raise exception 'That form is not in this company.';
  end if;
  if tg_op = 'UPDATE' then
    new.workspace_id := old.workspace_id;
    new.user_id := old.user_id;
    new.form_id := old.form_id;
  end if;
  return new;
end;
$$;
create trigger lead_assignment_members_guard before insert or update on public.lead_assignment_members
  for each row execute function private.lead_assignment_member_guard();

-- Staff switch themselves away (leave, day off) and back.
create or replace function public.set_my_lead_away(p_workspace_id uuid, p_away boolean)
returns void
language sql security definer
set search_path = ''
as $$
  update public.lead_assignment_members
  set is_away = p_away
  where workspace_id = p_workspace_id and user_id = (select auth.uid());
$$;
revoke execute on function public.set_my_lead_away(uuid, boolean) from public, anon;
grant execute on function public.set_my_lead_away(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- The pick. Locks the rotation so two leads arriving together go to two people.
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
revoke execute on function private.pick_lead_assignee(uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- On every new lead and every reassignment.
-- ---------------------------------------------------------------------------
create or replace function private.lead_auto_assign()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.workspace_settings;
begin
  if tg_op = 'INSERT' then
    new.auto_assigned := false;
    new.pass_on_count := 0;
    if new.assigned_to is null then
      select * into s from public.workspace_settings where workspace_id = new.workspace_id;
      -- Leads added by hand are handed out only when an admin adds them unassigned
      -- (staff adding one without an assignee keep it unassigned, as before).
      if coalesce(s.auto_assign_enabled, false)
         and (new.form_id is not null
              or (s.auto_assign_manual and ((select auth.uid()) is null or public.is_workspace_admin(new.workspace_id)))) then
        new.assigned_to := private.pick_lead_assignee(new.workspace_id, new.form_id);
        if new.assigned_to is not null then
          new.auto_assigned := true;
        else
          insert into public.notifications (workspace_id, user_id, type, title, message, link)
          select new.workspace_id, m.user_id, 'lead', 'Lead not assigned: ' || new.name,
                 'Everyone in the rotation is away, so nobody got it.', '/leads?open=' || new.id
          from public.workspace_members m
          where m.workspace_id = new.workspace_id and m.role in ('owner', 'admin') and m.is_active
            and exists (select 1 from public.lead_assignment_members x where x.workspace_id = new.workspace_id and x.in_rotation);
        end if;
      end if;
    end if;
    new.assigned_at := case when new.assigned_to is not null then now() end;
  elsif new.assigned_to is distinct from old.assigned_to then
    new.assigned_at := case when new.assigned_to is not null then now() end;
    -- A person changing it by hand takes it out of the automatic flow.
    if (select auth.uid()) is not null then
      new.auto_assigned := false;
      new.pass_on_count := 0;
    end if;
  else
    new.assigned_at := old.assigned_at;
  end if;
  return new;
end;
$$;
create trigger leads_auto_assign before insert or update on public.leads
  for each row execute function private.lead_auto_assign();

-- Timeline: say when a lead was handed out automatically.
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
                               'assigned_to', new.assigned_to, 'auto', new.auto_assigned),
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
    values (new.workspace_id, new.id, 'assigned',
            jsonb_strip_nulls(jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to,
              'reason', nullif(current_setting('app.assign_reason', true), ''),
              'minutes', nullif(current_setting('app.pass_on_minutes', true), '')::int)),
            v_actor);
  end if;
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

-- ---------------------------------------------------------------------------
-- 3b: pass on leads nobody has touched in time.
-- ---------------------------------------------------------------------------
-- When the clock runs out: the minutes count only from 9 AM to 8 PM India time.
create or replace function private.pass_on_deadline(p_from timestamptz, p_minutes int)
returns timestamptz
language plpgsql stable
set search_path = ''
as $$
declare
  v_local timestamp := p_from at time zone 'Asia/Kolkata';
  v_day date := v_local::date;
  v_left int := p_minutes;
  v_open timestamp;
  v_close timestamp;
  v_start timestamp;
  v_avail int;
begin
  loop
    v_open := v_day + time '09:00';
    v_close := v_day + time '20:00';
    v_start := greatest(v_local, v_open);
    if v_start < v_close then
      v_avail := floor(extract(epoch from (v_close - v_start)) / 60);
      if v_left <= v_avail then
        return (v_start + make_interval(mins => v_left)) at time zone 'Asia/Kolkata';
      end if;
      v_left := v_left - v_avail;
    end if;
    v_day := v_day + 1;
    v_local := v_day + time '09:00';
  end loop;
end;
$$;

create or replace function private.pass_on_uncontacted_leads()
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
  v_next uuid;
  v_pool_size int;
  v_hour int := extract(hour from now() at time zone 'Asia/Kolkata');
begin
  if v_hour < 9 or v_hour >= 20 then
    return;
  end if;
  for r in
    select l.id, l.workspace_id, l.form_id, l.name, l.assigned_to, l.pass_on_count, s.pass_on_minutes
    from public.leads l
    join public.workspace_settings s on s.workspace_id = l.workspace_id
    where s.auto_assign_enabled and s.pass_on_minutes is not null
      and l.auto_assigned and l.assigned_to is not null
      and l.stage = 'new' and l.first_contacted_at is null
      and (l.last_remark_at is null or l.last_remark_at < l.assigned_at)
      and private.pass_on_deadline(l.assigned_at, s.pass_on_minutes) <= now()
      and public.workspace_status(l.workspace_id) in ('trial', 'active', 'grace')
    order by l.assigned_at
    limit 200
  loop
    select count(*) into v_pool_size
    from public.lead_assignment_members m
    where m.workspace_id = r.workspace_id and m.in_rotation
      and m.form_id is not distinct from (
        case when r.form_id is not null and exists (
          select 1 from public.lead_forms f join public.lead_assignment_members x on x.form_id = f.id and x.in_rotation
          where f.id = r.form_id and f.own_rotation) then r.form_id end);

    v_next := null;
    if r.pass_on_count + 1 < v_pool_size then
      v_next := private.pick_lead_assignee(r.workspace_id, r.form_id, r.assigned_to);
    end if;

    if v_next is null then
      -- Everyone has had it (or nobody else is free): stop and tell the admins.
      update public.leads set auto_assigned = false where id = r.id;
      insert into public.notifications (workspace_id, user_id, type, title, message, link)
      select r.workspace_id, m.user_id, 'lead', 'Lead still not contacted: ' || r.name,
             'It went round the rotation and nobody contacted it. Please assign it by hand.', '/leads?open=' || r.id
      from public.workspace_members m
      where m.workspace_id = r.workspace_id and m.role in ('owner', 'admin') and m.is_active;
      continue;
    end if;

    perform set_config('app.assign_reason', 'not_contacted', true);
    perform set_config('app.pass_on_minutes', r.pass_on_minutes::text, true);
    update public.leads
    set assigned_to = v_next, auto_assigned = true, pass_on_count = r.pass_on_count + 1
    where id = r.id;
    perform set_config('app.assign_reason', '', true);
    perform set_config('app.pass_on_minutes', '', true);

    insert into public.notifications (workspace_id, user_id, type, title, message, link)
    values (r.workspace_id, r.assigned_to, 'lead', 'Lead passed on: ' || r.name,
            'It wasn''t contacted within ' || r.pass_on_minutes || ' minutes, so it went to the next person.', '/leads?open=' || r.id);
  end loop;
end;
$$;
revoke execute on function private.pass_on_uncontacted_leads() from public, anon, authenticated;

select cron.schedule('lead-pass-on', '*/5 * * * *', $$select private.pass_on_uncontacted_leads()$$);
