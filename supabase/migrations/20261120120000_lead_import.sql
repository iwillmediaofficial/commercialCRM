-- ---------------------------------------------------------------------------
-- Bulk lead import (Meta lead ad Excel/CSV files).
--
-- * Owners and admins upload a file on /leads/import; the browser reads it,
--   matches columns, shows a preview, then sends the rows here in batches.
-- * Duplicates (same phone, last 10 digits; or same email when there is no
--   phone) against leads already in the company are skipped.
-- * Imported leads don't start the first-contact deadline or the pass-on, and
--   don't send one alert per lead: each person gets one summary alert.
-- * Undo: the app removes the batch's untouched leads (stage New, never
--   contacted) through the normal delete rule, then marks the batch undone.
-- ---------------------------------------------------------------------------

create table if not exists public.lead_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  file_name text not null check (length(file_name) between 1 and 200),
  source text not null default 'Meta Ads' check (length(source) between 1 and 60),
  assign_mode text not null check (assign_mode in ('rotation', 'person', 'none')),
  assignee uuid references auth.users(id) on delete set null,
  total_rows int not null default 0 check (total_rows between 0 and 2000),
  imported int not null default 0,
  skipped int not null default 0,
  finished_at timestamptz,
  undone_at timestamptz,
  undone_count int,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists lead_imports_ws_idx on public.lead_imports(workspace_id, created_at desc);
create index if not exists lead_imports_assignee_idx on public.lead_imports(assignee);
create index if not exists lead_imports_created_by_idx on public.lead_imports(created_by);

alter table public.lead_imports enable row level security;
create policy lead_imports_read on public.lead_imports for select to authenticated
  using (public.is_workspace_admin(workspace_id) or public.is_platform_admin());
grant select on public.lead_imports to authenticated;

alter table public.leads
  add column if not exists import_id uuid references public.lead_imports(id) on delete set null;
create index if not exists leads_import_idx on public.leads(import_id);

-- Phone numbers compare by their last 10 digits ("p:+91 98765-43210" = "9876543210").
create or replace function private.phone_key(p text)
returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select nullif(right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10), '');
$$;
revoke execute on function private.phone_key(text) from public, anon, authenticated;
create index if not exists leads_phone_key_idx on public.leads(workspace_id, private.phone_key(phone));
create index if not exists leads_email_key_idx on public.leads(workspace_id, lower(email));

-- ---------------------------------------------------------------------------
-- Triggers: imported leads skip the deadline, auto-assign and per-lead alerts.
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
  if new.stage <> 'new' and new.first_contacted_at is null then
    new.first_contacted_at := now();
  end if;

  -- First-contact deadline (not for leads brought in by a bulk import).
  if new.assigned_to is not null and new.first_contacted_at is null and new.stage = 'new'
     and not (tg_op = 'INSERT' and new.import_id is not null)
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
    new.follow_up_auto := false;
  elsif old.follow_up_auto and old.first_contacted_at is null and new.first_contacted_at is not null then
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
    -- Imports choose who gets each lead themselves.
    if new.assigned_to is null and new.import_id is null then
      select * into s from public.workspace_settings where workspace_id = new.workspace_id;
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

create or replace function private.notify_lead_assignment()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.assigned_to is not null
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not (tg_op = 'INSERT' and new.import_id is not null)
     and new.assigned_to is distinct from (select auth.uid())
     and private.rule_on(new.workspace_id, 'lead_assigned') then
    insert into public.notifications (workspace_id, user_id, type, title, message, link)
    values (new.workspace_id, new.assigned_to, 'lead', 'Lead assigned to you',
            coalesce(nullif(new.company, ''), new.name), '/leads?open=' || new.id);
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Start an import.
-- ---------------------------------------------------------------------------
create or replace function public.start_lead_import(
  p_workspace_id uuid, p_file_name text, p_source text, p_assign text, p_assignee uuid, p_total int)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.can_admin_write(p_workspace_id, 'leads') then
    raise exception 'Only owners and admins can import leads.';
  end if;
  if p_assign not in ('rotation', 'person', 'none') then
    raise exception 'Pick who should get the leads.';
  end if;
  if p_total is null or p_total < 1 or p_total > 2000 then
    raise exception 'A file can have up to 2,000 leads. Split bigger files and import them one by one.';
  end if;
  if p_assign = 'person' and not exists (
       select 1 from public.workspace_members m
       where m.workspace_id = p_workspace_id and m.user_id = p_assignee and m.is_active) then
    raise exception 'That person is not an active member of this company.';
  end if;
  if p_assign = 'rotation' and not exists (
       select 1 from public.lead_assignment_members x
       join public.workspace_members wm on wm.workspace_id = x.workspace_id and wm.user_id = x.user_id and wm.is_active
       where x.workspace_id = p_workspace_id and x.form_id is null and x.in_rotation and not x.is_away) then
    raise exception 'Nobody is in the lead rotation right now. Add people on the Lead assignment page, or give the leads to one person.';
  end if;

  insert into public.lead_imports (workspace_id, file_name, source, assign_mode, assignee, total_rows, created_by)
  values (p_workspace_id, left(coalesce(nullif(btrim(p_file_name), ''), 'Import'), 200),
          left(coalesce(nullif(btrim(p_source), ''), 'Meta Ads'), 60), p_assign,
          case when p_assign = 'person' then p_assignee end, p_total, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.start_lead_import(uuid, text, text, text, uuid, int) from public, anon;
grant execute on function public.start_lead_import(uuid, text, text, text, uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Send rows (up to 250 per call). Each row:
--    { "row": 12, "name": "", "phone": "", "email": "", "company": "",
--      "campaign": "", "answers": { "Question": "Answer", ... } }
--    Returns { "imported": n, "skipped": [ { "row": 12, "reason": "..." } ] }.
-- ---------------------------------------------------------------------------
create or replace function public.import_lead_rows(p_import_id uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  imp public.lead_imports;
  r jsonb;
  v_name text;
  v_phone text;
  v_email text;
  v_key text;
  v_answers jsonb;
  v_assignee uuid;
  v_lead uuid;
  v_dup_import uuid;
  v_imported int := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  select * into imp from public.lead_imports where id = p_import_id for update;
  if imp.id is null or not public.can_admin_write(imp.workspace_id, 'leads') then
    raise exception 'Import not found.';
  end if;
  if imp.finished_at is not null then
    raise exception 'This import is already finished.';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 250 then
    raise exception 'Send up to 250 rows at a time.';
  end if;
  if imp.imported + imp.skipped + jsonb_array_length(p_rows) > imp.total_rows then
    raise exception 'More rows than the file said it had.';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_phone := nullif(left(btrim(regexp_replace(coalesce(r ->> 'phone', ''), '^p:', '')), 40), '');
    v_email := nullif(lower(left(btrim(coalesce(r ->> 'email', '')), 200)), '');
    v_name := coalesce(nullif(left(btrim(coalesce(r ->> 'name', '')), 200), ''), v_phone, v_email);
    v_key := private.phone_key(v_phone);

    if v_phone is null and v_email is null then
      v_skipped := v_skipped || jsonb_build_object('row', r -> 'row', 'name', v_name, 'reason', 'No phone or email');
      continue;
    end if;
    if v_phone is not null and (v_key is null or length(v_key) < 7) then
      v_phone := null;
      if v_email is null then
        v_skipped := v_skipped || jsonb_build_object('row', r -> 'row', 'name', v_name, 'reason', 'Phone number looks wrong');
        continue;
      end if;
    end if;
    select l.import_id into v_dup_import from public.leads l
    where l.workspace_id = imp.workspace_id
      and ((v_key is not null and private.phone_key(l.phone) = v_key)
           or (v_key is null and lower(l.email) = v_email))
    order by (l.import_id is not distinct from imp.id) desc
    limit 1;
    if found then
      v_skipped := v_skipped || jsonb_build_object('row', r -> 'row', 'name', v_name, 'phone', v_phone, 'email', v_email,
                     'reason', case when v_dup_import is not distinct from imp.id then 'Repeated in this file' else 'Already in the CRM' end);
      continue;
    end if;

    v_answers := case when jsonb_typeof(r -> 'answers') = 'object' and pg_column_size(r -> 'answers') < 8000
                      then r -> 'answers' end;
    v_assignee := case imp.assign_mode
      when 'person' then imp.assignee
      when 'rotation' then private.pick_lead_assignee(imp.workspace_id, null)
    end;

    insert into public.leads (workspace_id, name, phone, email, company, source, campaign_details,
                              form_answers, assigned_to, import_id)
    values (imp.workspace_id, v_name, v_phone, v_email,
            nullif(left(btrim(coalesce(r ->> 'company', '')), 200), ''), imp.source,
            nullif(left(btrim(coalesce(r ->> 'campaign', '')), 1000), ''),
            v_answers, v_assignee, imp.id)
    returning id into v_lead;

    update public.lead_activities
    set details = coalesce(details, '{}'::jsonb) || jsonb_build_object('import', imp.file_name)
    where lead_id = v_lead and kind = 'created';
    v_imported := v_imported + 1;
  end loop;

  update public.lead_imports
  set imported = imported + v_imported, skipped = skipped + jsonb_array_length(v_skipped)
  where id = imp.id;
  return jsonb_build_object('imported', v_imported, 'skipped', v_skipped);
end;
$$;
revoke execute on function public.import_lead_rows(uuid, jsonb) from public, anon;
grant execute on function public.import_lead_rows(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Finish: one alert per person with how many leads they got.
-- ---------------------------------------------------------------------------
create or replace function public.finish_lead_import(p_import_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  imp public.lead_imports;
begin
  select * into imp from public.lead_imports where id = p_import_id for update;
  if imp.id is null or not public.can_admin_write(imp.workspace_id, 'leads') then
    raise exception 'Import not found.';
  end if;
  if imp.finished_at is null then
    update public.lead_imports set finished_at = now() where id = imp.id;
    if private.rule_on(imp.workspace_id, 'lead_assigned') then
      insert into public.notifications (workspace_id, user_id, type, title, message, link)
      select imp.workspace_id, l.assigned_to, 'lead',
             count(*) || ' new lead' || case when count(*) = 1 then '' else 's' end || ' for you',
             'Imported from ' || imp.file_name || '. Find them under Follow-ups, Not contacted yet.', '/follow-ups'
      from public.leads l
      where l.import_id = imp.id and l.assigned_to is not null and l.assigned_to is distinct from (select auth.uid())
      group by l.assigned_to;
    end if;
  end if;
  return (select jsonb_build_object('imported', i.imported, 'skipped', i.skipped)
          from public.lead_imports i where i.id = imp.id);
end;
$$;
revoke execute on function public.finish_lead_import(uuid) from public, anon;
grant execute on function public.finish_lead_import(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- After the app removed a batch's untouched leads: record the undo.
-- ---------------------------------------------------------------------------
create or replace function public.mark_lead_import_undone(p_import_id uuid, p_removed int)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  imp public.lead_imports;
  v_left int;
begin
  select * into imp from public.lead_imports where id = p_import_id for update;
  if imp.id is null or not public.can_admin_write(imp.workspace_id, 'leads') then
    raise exception 'Import not found.';
  end if;
  select count(*)::int into v_left from public.leads where import_id = imp.id;
  update public.lead_imports
  set undone_at = now(), undone_count = coalesce(undone_count, 0) + greatest(coalesce(p_removed, 0), 0)
  where id = imp.id;
  return jsonb_build_object('removed', greatest(coalesce(p_removed, 0), 0), 'kept', v_left);
end;
$$;
revoke execute on function public.mark_lead_import_undone(uuid, int) from public, anon;
grant execute on function public.mark_lead_import_undone(uuid, int) to authenticated;
