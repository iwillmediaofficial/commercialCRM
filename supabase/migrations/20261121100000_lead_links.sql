-- ---------------------------------------------------------------------------
-- Lead links: a secret web address per company that turns anything posted to
-- it into a live lead (Google Sheet script, Zapier, Make, Pabbly; later the
-- direct Meta connection).
--
-- * The lead-link edge function finds the link by its key, matches the
--   fields (link.field_map overrides the automatic match) and calls
--   receive_lead_link() with the service key. Nobody else can call it.
-- * Link leads are live: the 1-hour first-contact deadline, rotation and
--   pass-on all apply. Duplicates (same phone, last 10 digits; or same email
--   when there is no phone) are skipped and logged.
-- * Every request is logged in lead_link_events (kept 30 days).
-- ---------------------------------------------------------------------------

create or replace function private.new_lead_link_token()
returns text
language sql volatile
set search_path = ''
as $$
  select left(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 40);
$$;
revoke execute on function private.new_lead_link_token() from public, anon, authenticated;

create table if not exists public.lead_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  -- The guard trigger replaces this with a 40-character key (the default runs as the caller).
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  is_active boolean not null default true,
  source text not null default 'Meta Ads' check (length(btrim(source)) between 1 and 60),
  assign_mode text not null default 'rotation' check (assign_mode in ('rotation', 'person', 'none')),
  assignee uuid references auth.users(id) on delete set null,
  field_map jsonb not null default '{}'::jsonb
    check (jsonb_typeof(field_map) = 'object' and pg_column_size(field_map) < 8000),
  received_count int not null default 0,
  added_count int not null default 0,
  last_received_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lead_links_ws_idx on public.lead_links(workspace_id, created_at);
create index if not exists lead_links_assignee_idx on public.lead_links(assignee);
create index if not exists lead_links_created_by_idx on public.lead_links(created_by);

create or replace function private.lead_link_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  new.source := btrim(new.source);
  if tg_op = 'INSERT' then
    if (select count(*) from public.lead_links where workspace_id = new.workspace_id) >= 10 then
      raise exception 'A company can have up to 10 lead links.';
    end if;
    new.created_by := (select auth.uid());
    new.token := private.new_lead_link_token();
  else
    new.workspace_id := old.workspace_id;
    new.created_by := old.created_by;
    new.updated_at := now();
  end if;
  if new.assign_mode = 'person' then
    if not exists (select 1 from public.workspace_members m
                   where m.workspace_id = new.workspace_id and m.user_id = new.assignee and m.is_active) then
      raise exception 'Pick an active member to get this link''s leads.';
    end if;
  else
    new.assignee := null;
  end if;
  return new;
end;
$$;
create trigger lead_links_guard before insert or update on public.lead_links
  for each row execute function private.lead_link_guard();

alter table public.lead_links enable row level security;
create policy lead_links_read on public.lead_links for select to authenticated
  using (public.is_workspace_admin(workspace_id) or public.is_platform_admin());
create policy lead_links_insert on public.lead_links for insert to authenticated
  with check (public.can_admin_write(workspace_id, 'leads'));
create policy lead_links_update on public.lead_links for update to authenticated
  using (public.can_admin_write(workspace_id, 'leads'))
  with check (public.can_admin_write(workspace_id, 'leads'));
create policy lead_links_remove on public.lead_links for delete to authenticated
  using (public.can_admin_write(workspace_id, 'leads'));

-- The key and the counters only change through the functions below.
revoke all on public.lead_links from anon, authenticated;
grant select on public.lead_links to authenticated;
grant insert (workspace_id, name, source, assign_mode, assignee, field_map, is_active) on public.lead_links to authenticated;
grant update (name, source, assign_mode, assignee, field_map, is_active) on public.lead_links to authenticated;
grant delete on public.lead_links to authenticated;

create table if not exists public.lead_link_events (
  id bigint generated always as identity primary key,
  link_id uuid not null references public.lead_links(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  received_at timestamptz not null default now(),
  status text not null check (status in ('added', 'duplicate', 'rejected', 'test')),
  lead_id uuid references public.leads(id) on delete set null,
  name text,
  phone text,
  email text,
  reason text,
  via text,
  fields jsonb
);
create index if not exists lead_link_events_link_idx on public.lead_link_events(link_id, received_at desc);
create index if not exists lead_link_events_ws_idx on public.lead_link_events(workspace_id, received_at desc);
create index if not exists lead_link_events_lead_idx on public.lead_link_events(lead_id);

alter table public.lead_link_events enable row level security;
create policy lead_link_events_read on public.lead_link_events for select to authenticated
  using (public.is_workspace_admin(workspace_id) or public.is_platform_admin());
revoke all on public.lead_link_events from anon, authenticated;
grant select on public.lead_link_events to authenticated;

alter table public.leads
  add column if not exists lead_link_id uuid references public.lead_links(id) on delete set null;
create index if not exists leads_lead_link_idx on public.leads(lead_link_id);

-- ---------------------------------------------------------------------------
-- Auto-assign: link leads follow their link's choice (rotation shares them
-- from the main rotation and lets pass-on move them along).
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
    if new.assigned_to is null and new.import_id is null and new.lead_link_id is not null then
      if exists (select 1 from public.lead_links k where k.id = new.lead_link_id and k.assign_mode = 'rotation') then
        new.assigned_to := private.pick_lead_assignee(new.workspace_id, null);
        if new.assigned_to is not null then
          new.auto_assigned := true;
        else
          insert into public.notifications (workspace_id, user_id, type, title, message, link)
          select new.workspace_id, m.user_id, 'lead', 'Lead not assigned: ' || new.name,
                 'Everyone in the rotation is away, so nobody got it.', '/leads?open=' || new.id
          from public.workspace_members m
          where m.workspace_id = new.workspace_id and m.role in ('owner', 'admin') and m.is_active;
        end if;
      end if;
    -- Imports choose who gets each lead themselves.
    elsif new.assigned_to is null and new.import_id is null and new.lead_link_id is null then
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

-- ---------------------------------------------------------------------------
-- New key for a link: the old address stops working at once.
-- ---------------------------------------------------------------------------
create or replace function public.rotate_lead_link_token(p_link_id uuid)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_token text := private.new_lead_link_token();
begin
  select workspace_id into v_ws from public.lead_links where id = p_link_id;
  if v_ws is null or not public.can_admin_write(v_ws, 'leads') then
    raise exception 'Lead link not found.';
  end if;
  update public.lead_links set token = v_token, updated_at = now() where id = p_link_id;
  return v_token;
end;
$$;
revoke execute on function public.rotate_lead_link_token(uuid) from public, anon;
grant execute on function public.rotate_lead_link_token(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The shared intake. Called by the lead-link edge function (service key) with
-- leads already matched to CRM fields. Each item:
--   { "name": "", "phone": "", "email": "", "company": "", "campaign": "",
--     "answers": { "Question": "Answer" }, "fields": { raw incoming fields },
--     "test": false }
-- Returns { added, duplicates, rejected, tests, results: [{ status, lead_id, reason }] }.
-- Raises 'not_available' (company suspended / no Leads module / link off)
-- and 'too_many' (over 300 in 10 minutes) so the caller can answer properly.
-- ---------------------------------------------------------------------------
create or replace function public.receive_lead_link(p_link_id uuid, p_items jsonb, p_via text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  k public.lead_links;
  r jsonb;
  v_via text := nullif(left(btrim(coalesce(p_via, '')), 40), '');
  v_name text;
  v_phone text;
  v_email text;
  v_key text;
  v_answers jsonb;
  v_fields jsonb;
  v_assignee uuid;
  v_lead uuid;
  v_existing uuid;
  v_reason text;
  v_added int := 0;
  v_dups int := 0;
  v_rejected int := 0;
  v_tests int := 0;
  v_results jsonb := '[]'::jsonb;
begin
  select * into k from public.lead_links where id = p_link_id for update;
  if k.id is null or not k.is_active
     or public.workspace_status(k.workspace_id) = 'suspended'
     or not public.workspace_has_module(k.workspace_id, 'leads') then
    raise exception 'not_available';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 50 then
    raise exception 'Send 1 to 50 leads at a time.';
  end if;
  if (select count(*) from public.lead_link_events e
      where e.link_id = k.id and e.received_at > now() - interval '10 minutes') + jsonb_array_length(p_items) > 300 then
    raise exception 'too_many';
  end if;

  for r in select value from jsonb_array_elements(p_items) loop
    v_fields := case when jsonb_typeof(r -> 'fields') = 'object' and pg_column_size(r -> 'fields') < 8000
                     then r -> 'fields' end;
    v_phone := nullif(left(btrim(regexp_replace(coalesce(r ->> 'phone', ''), '^p:', '', 'i')), 40), '');
    v_email := nullif(lower(left(btrim(coalesce(r ->> 'email', '')), 200)), '');
    v_name := coalesce(nullif(left(btrim(coalesce(r ->> 'name', '')), 200), ''), v_phone, v_email);
    v_key := private.phone_key(v_phone);
    v_lead := null;
    v_reason := null;

    if (r ->> 'test')::boolean is true then
      insert into public.lead_link_events (link_id, workspace_id, status, reason, via, fields)
      values (k.id, k.workspace_id, 'test', 'Connection test', v_via, v_fields);
      v_tests := v_tests + 1;
      v_results := v_results || jsonb_build_object('status', 'test');
      continue;
    end if;

    if v_phone is not null and (v_key is null or length(v_key) < 7) then
      v_phone := null;
      if v_email is null then
        v_reason := 'Phone number looks wrong';
      end if;
    end if;
    if v_reason is null and v_phone is null and v_email is null then
      v_reason := 'No phone or email';
    end if;
    if v_reason is not null then
      insert into public.lead_link_events (link_id, workspace_id, status, name, phone, email, reason, via, fields)
      values (k.id, k.workspace_id, 'rejected', v_name, left(r ->> 'phone', 40), v_email, v_reason, v_via, v_fields);
      v_rejected := v_rejected + 1;
      v_results := v_results || jsonb_build_object('status', 'rejected', 'reason', v_reason);
      continue;
    end if;

    select l.id into v_existing from public.leads l
    where l.workspace_id = k.workspace_id
      and ((v_key is not null and private.phone_key(l.phone) = v_key)
           or (v_key is null and lower(l.email) = v_email))
    order by l.created_at desc
    limit 1;
    if found then
      insert into public.lead_link_events (link_id, workspace_id, status, lead_id, name, phone, email, reason, via, fields)
      values (k.id, k.workspace_id, 'duplicate', v_existing, v_name, v_phone, v_email, 'Already in the CRM', v_via, v_fields);
      v_dups := v_dups + 1;
      v_results := v_results || jsonb_build_object('status', 'duplicate', 'lead_id', v_existing);
      continue;
    end if;

    v_answers := case when jsonb_typeof(r -> 'answers') = 'object' and r -> 'answers' <> '{}'::jsonb
                           and pg_column_size(r -> 'answers') < 8000
                      then r -> 'answers' end;
    v_assignee := case when k.assign_mode = 'person' and exists (
                    select 1 from public.workspace_members m
                    where m.workspace_id = k.workspace_id and m.user_id = k.assignee and m.is_active)
                  then k.assignee end;

    insert into public.leads (workspace_id, name, phone, email, company, source, campaign_details,
                              form_answers, assigned_to, lead_link_id)
    values (k.workspace_id, v_name, v_phone, v_email,
            nullif(left(btrim(coalesce(r ->> 'company', '')), 200), ''), k.source,
            nullif(left(btrim(coalesce(r ->> 'campaign', '')), 1000), ''),
            v_answers, v_assignee, k.id)
    returning id into v_lead;

    insert into public.notifications (workspace_id, user_id, type, title, message, link)
    select k.workspace_id, m.user_id, 'lead', 'New lead: ' || v_name, 'From lead link "' || k.name || '"', '/leads?open=' || v_lead
    from public.workspace_members m
    where m.workspace_id = k.workspace_id and m.role in ('owner', 'admin') and m.is_active;

    insert into public.lead_link_events (link_id, workspace_id, status, lead_id, name, phone, email, via, fields)
    values (k.id, k.workspace_id, 'added', v_lead, v_name, v_phone, v_email, v_via, v_fields);
    v_added := v_added + 1;
    v_results := v_results || jsonb_build_object('status', 'added', 'lead_id', v_lead);
  end loop;

  update public.lead_links
  set received_count = received_count + jsonb_array_length(p_items) - v_tests,
      added_count = added_count + v_added,
      last_received_at = now()
  where id = k.id;

  return jsonb_build_object('added', v_added, 'duplicates', v_dups, 'rejected', v_rejected, 'tests', v_tests,
                            'results', v_results);
end;
$$;
revoke execute on function public.receive_lead_link(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.receive_lead_link(uuid, jsonb, text) to service_role;
