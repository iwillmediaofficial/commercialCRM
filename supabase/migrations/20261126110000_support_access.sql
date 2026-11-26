-- Super Admin "Act as owner": full owner-level access to one company at a time.
--
-- The Super Admin starts a support session for a company (logged). While it is
-- open (4 hours at most, or until they exit), public.member_role() answers
-- 'owner' for them in that company, so every RLS rule, RPC and Edge Function
-- that already checks the owner's rights lets them in. They are never added to
-- workspace_members, so they take no seat, never show on the Team page, and
-- can't be given leads, work or time entries.
--
-- Every change they make inside the company is written to admin_audit_log
-- (action 'support_action'). Bursts of the same change (a lead import, say)
-- fold into one log row with a count.

create table public.support_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '4 hours',
  ended_at timestamptz
);
create index support_sessions_open_idx on public.support_sessions (admin_id, workspace_id) where ended_at is null;
create index support_sessions_ws_idx on public.support_sessions (workspace_id);

alter table public.support_sessions enable row level security;
create policy support_sessions_read on public.support_sessions for select to authenticated
  using (admin_id = (select auth.uid()) and public.is_platform_admin());
-- No insert/update/delete policies: only the functions below change sessions.

create or replace function private.support_session_open(ws uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.support_sessions s
    join public.platform_admins a on a.user_id = s.admin_id
    where s.admin_id = (select auth.uid()) and s.workspace_id = ws
      and s.ended_at is null and s.expires_at > now()
  );
$$;

-- A real membership always wins; otherwise an open support session counts as owner.
create or replace function public.member_role(ws uuid)
returns public.member_role
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select role from public.workspace_members
     where workspace_id = ws and user_id = (select auth.uid()) and is_active),
    case when private.support_session_open(ws) then 'owner'::public.member_role end
  );
$$;

create or replace function public.admin_start_support(p_workspace_id uuid)
returns timestamptz
language plpgsql security definer
set search_path = ''
as $$
declare
  v_until timestamptz;
begin
  if not public.is_platform_admin() then
    raise exception 'Only the Super Admin can do this.';
  end if;
  if not exists (select 1 from public.workspaces where id = p_workspace_id) then
    raise exception 'Company not found.';
  end if;
  -- One company at a time.
  update public.support_sessions set ended_at = now()
  where admin_id = (select auth.uid()) and ended_at is null;
  insert into public.support_sessions (admin_id, workspace_id)
  values ((select auth.uid()), p_workspace_id)
  returning expires_at into v_until;
  insert into public.admin_audit_log (actor_id, workspace_id, action, details)
  values ((select auth.uid()), p_workspace_id, 'support_start', jsonb_build_object('until', v_until));
  return v_until;
end;
$$;

create or replace function public.admin_end_support()
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
begin
  if not public.is_platform_admin() then
    raise exception 'Only the Super Admin can do this.';
  end if;
  for r in
    update public.support_sessions set ended_at = now()
    where admin_id = (select auth.uid()) and ended_at is null
    returning workspace_id, expires_at
  loop
    insert into public.admin_audit_log (actor_id, workspace_id, action, details)
    values ((select auth.uid()), r.workspace_id, 'support_end',
            case when r.expires_at <= now() then '{"expired": true}'::jsonb else '{}'::jsonb end);
  end loop;
end;
$$;

revoke execute on function public.admin_start_support(uuid) from public, anon;
revoke execute on function public.admin_end_support() from public, anon;
grant execute on function public.admin_start_support(uuid) to authenticated;
grant execute on function public.admin_end_support() to authenticated;

-- Log every change the Super Admin makes inside a company.
create or replace function private.log_support_action()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  j jsonb;
  v_ws uuid;
  v_label text;
  v_id bigint;
begin
  if v_uid is null or not exists (select 1 from public.platform_admins where user_id = v_uid) then
    return null;
  end if;
  j := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else to_jsonb(old) end;
  v_ws := (j ->> 'workspace_id')::uuid;
  if v_ws is null or exists (
    select 1 from public.workspace_members
    where workspace_id = v_ws and user_id = v_uid and is_active
  ) then
    return null;
  end if;
  v_label := left(coalesce(j ->> 'name', j ->> 'title', j ->> 'company_name', j ->> 'invoice_number', j ->> 'file_name', j ->> 'full_name', j ->> 'label', j ->> 'email', ''), 120);

  -- Fold repeats of the same kind of change within 10 seconds into one row.
  select id into v_id from public.admin_audit_log
  where actor_id = v_uid and workspace_id = v_ws and action = 'support_action'
    and details ->> 'table' = tg_table_name and details ->> 'op' = tg_op
    and created_at > now() - interval '10 seconds'
  order by created_at desc limit 1;

  if v_id is not null then
    update public.admin_audit_log
    set details = jsonb_set(details, '{count}', to_jsonb(coalesce((details ->> 'count')::int, 1) + 1))
    where id = v_id;
  else
    insert into public.admin_audit_log (actor_id, workspace_id, action, details)
    values (v_uid, v_ws, 'support_action',
            jsonb_build_object('table', tg_table_name, 'op', tg_op, 'record_id', j ->> 'id',
                               'label', nullif(v_label, ''), 'count', 1));
  end if;
  return null;
end;
$$;

do $$
declare
  t text;
begin
  for t in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables x using (table_schema, table_name)
    where c.table_schema = 'public' and c.column_name = 'workspace_id' and x.table_type = 'BASE TABLE'
      and c.table_name not in (
        'admin_audit_log', 'app_errors', 'notifications', 'activity_logs', 'lead_activities',
        'wa_ai_usage', 'lead_link_events', 'subscription_payments', 'support_sessions'
      )
  loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function private.log_support_action()',
      t || '_support_log', t);
  end loop;
end;
$$;
