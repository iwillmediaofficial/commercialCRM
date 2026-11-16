-- ---------------------------------------------------------------------------
-- Lead timeline (lead management plan, phase 1)
--
-- Every lead gets a dated history: remarks, calls, WhatsApp and meetings that
-- people log, plus entries the database writes itself when a lead is created,
-- moves stage, is (re)assigned, has its follow-up changed or becomes a client.
-- The old single Notes box is copied in as each lead's first remark.
-- ---------------------------------------------------------------------------

create table public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  -- remark, call, whatsapp, meeting = written by people; the rest are automatic.
  kind text not null check (kind in ('remark', 'call', 'whatsapp', 'meeting',
                                     'created', 'stage', 'assigned', 'follow_up', 'converted')),
  outcome text check (outcome is null or outcome in ('connected', 'no_answer', 'busy', 'switched_off', 'wrong_number')),
  body text check (body is null or length(body) <= 5000),
  details jsonb not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  check (kind not in ('remark', 'meeting') or coalesce(btrim(body), '') <> '')
);
create index lead_activities_lead_idx on public.lead_activities(lead_id, created_at desc);
create index lead_activities_ws_idx on public.lead_activities(workspace_id, created_at desc);
create index lead_activities_created_by_idx on public.lead_activities(created_by);

alter table public.lead_activities enable row level security;

-- The latest remark shows on the lead list.
alter table public.leads
  add column if not exists last_remark text,
  add column if not exists last_remark_at timestamptz;

-- ---------------------------------------------------------------------------
-- Who can do what. A timeline is visible to whoever can see the lead (the
-- leads policies already limit staff to their own leads).
-- ---------------------------------------------------------------------------
create policy lead_activities_read on public.lead_activities for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id and l.workspace_id = lead_activities.workspace_id));

create policy lead_activities_insert on public.lead_activities for insert to authenticated
  with check (
    kind in ('remark', 'call', 'whatsapp', 'meeting')
    and created_by = (select auth.uid())
    and public.can_write(workspace_id, 'leads')
    and exists (select 1 from public.leads l where l.id = lead_id and l.workspace_id = lead_activities.workspace_id)
  );

-- Your own entries, for 24 hours.
create policy lead_activities_update on public.lead_activities for update to authenticated
  using (
    kind in ('remark', 'call', 'whatsapp', 'meeting')
    and created_by = (select auth.uid())
    and created_at > now() - interval '24 hours'
    and public.can_write(workspace_id, 'leads')
  )
  with check (created_by = (select auth.uid()));

grant select, insert, update on public.lead_activities to authenticated;

-- ---------------------------------------------------------------------------
-- Keep entries honest: the workspace always matches the lead, and an edit can
-- only change the text and the outcome.
-- ---------------------------------------------------------------------------
create or replace function private.lead_activity_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    select l.workspace_id into new.workspace_id from public.leads l where l.id = new.lead_id;
    new.body := nullif(btrim(new.body), '');
    new.edited_at := null;
  else
    new.workspace_id := old.workspace_id;
    new.lead_id := old.lead_id;
    new.kind := old.kind;
    new.details := old.details;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.body := nullif(btrim(new.body), '');
    if new.body is distinct from old.body or new.outcome is distinct from old.outcome then
      new.edited_at := now();
    else
      new.edited_at := old.edited_at;
    end if;
  end if;
  return new;
end;
$$;
create trigger lead_activities_guard before insert or update on public.lead_activities
  for each row execute function private.lead_activity_guard();

-- Latest remark/call/WhatsApp/meeting text on the lead itself.
create or replace function private.refresh_last_remark(p_lead uuid)
returns void
language sql security definer
set search_path = ''
as $$
  update public.leads l
  set (last_remark, last_remark_at) = (
    select left(x.body, 300), x.created_at from public.lead_activities x
    where x.lead_id = p_lead and x.kind in ('remark', 'call', 'whatsapp', 'meeting')
    order by x.created_at desc limit 1
  )
  where l.id = p_lead;
$$;

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
  return null;
end;
$$;
-- Removals are added to this trigger in 20261116100100_lead_timeline_removals.sql.
create trigger lead_activities_changed after insert or update on public.lead_activities
  for each row execute function private.lead_activity_changed();

-- ---------------------------------------------------------------------------
-- Automatic entries from changes to the lead.
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
    values (new.workspace_id, new.id, 'stage', jsonb_build_object('from', old.stage, 'to', new.stage), v_actor);
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.lead_activities (workspace_id, lead_id, kind, details, created_by)
    values (new.workspace_id, new.id, 'assigned', jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to), v_actor);
  end if;
  if new.follow_up_date is distinct from old.follow_up_date then
    insert into public.lead_activities (workspace_id, lead_id, kind, details, created_by)
    values (new.workspace_id, new.id, 'follow_up', jsonb_build_object('from', old.follow_up_date, 'to', new.follow_up_date), v_actor);
  end if;
  if new.converted_client_id is not null and old.converted_client_id is null then
    insert into public.lead_activities (workspace_id, lead_id, kind, details, created_by)
    values (new.workspace_id, new.id, 'converted', jsonb_build_object('client_id', new.converted_client_id), v_actor);
  end if;
  return null;
end;
$$;
create trigger leads_log_changes after insert or update of stage, assigned_to, follow_up_date, converted_client_id
  on public.leads for each row execute function private.log_lead_changes();

-- ---------------------------------------------------------------------------
-- Existing leads: a "created" entry, and the old Notes text as the first remark.
-- (The notes column is kept untouched; the app no longer edits it.)
-- ---------------------------------------------------------------------------
insert into public.lead_activities (workspace_id, lead_id, kind, details, created_by, created_at)
select l.workspace_id, l.id, 'created',
       jsonb_build_object('source', l.source, 'form_id', l.form_id),
       l.created_by, l.created_at
from public.leads l
where not exists (select 1 from public.lead_activities a where a.lead_id = l.id and a.kind = 'created');

insert into public.lead_activities (workspace_id, lead_id, kind, body, details, created_by, created_at)
select l.workspace_id, l.id, 'remark', btrim(l.notes), '{"from_notes": true}', l.created_by,
       greatest(l.created_at + interval '1 second', l.updated_at)
from public.leads l
where coalesce(btrim(l.notes), '') <> ''
  and not exists (select 1 from public.lead_activities a where a.lead_id = l.id and a.details ? 'from_notes');

-- Live updates while a lead is open.
alter publication supabase_realtime add table public.lead_activities;
