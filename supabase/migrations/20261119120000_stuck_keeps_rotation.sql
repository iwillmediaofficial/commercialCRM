-- ---------------------------------------------------------------------------
-- Stuck staff keep getting new leads (the rotation no longer skips them), but
-- while stuck they can't log a call, WhatsApp or meeting on any lead that
-- isn't overdue. New leads wait until the overdue ones are cleared.
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

create or replace function private.lead_activity_stuck_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or new.kind not in ('call', 'whatsapp', 'meeting')
     or not private.is_lead_stuck(new.workspace_id, v_uid) then
    return new;
  end if;
  if not exists (select 1 from public.leads l
                 where l.id = new.lead_id and l.stage not in ('won', 'lost') and l.follow_up_at < now()) then
    raise exception 'Clear your overdue leads first. New leads open again once every overdue one is contacted and rescheduled.';
  end if;
  return new;
end;
$$;
create or replace trigger lead_activities_stuck_guard before insert on public.lead_activities
  for each row execute function private.lead_activity_stuck_guard();
