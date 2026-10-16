-- Server-side functions: workspace onboarding, PIN sign-up, renewals,
-- public lead forms, timers, lead conversion, invoicing, notifications.

-- ---------------------------------------------------------------------------
-- Secrets used for hashing PINs (never exposed through the API)
-- ---------------------------------------------------------------------------
create table private.app_secrets (
  name text primary key,
  value text not null
);
insert into private.app_secrets (name, value)
values ('pin_pepper', encode(extensions.gen_random_bytes(32), 'hex'));

create or replace function private.hash_pin(p_pin text)
returns text
language sql stable security definer
set search_path = ''
as $$
  select encode(
    extensions.hmac(upper(regexp_replace(p_pin, '[^A-Za-z0-9]', '', 'g')),
                    (select value from private.app_secrets where name = 'pin_pepper'),
                    'sha256'),
    'hex');
$$;

-- 8 characters, no look-alikes (0/O, 1/I/L).
create or replace function private.new_pin()
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(8);
  result text := '';
begin
  for i in 0..7 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
  end loop;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Access PINs
-- ---------------------------------------------------------------------------
create type public.pin_purpose as enum ('signup', 'reset', 'platform_admin');

create table public.access_pins (
  id uuid primary key default gen_random_uuid(),
  purpose public.pin_purpose not null default 'signup',
  workspace_id uuid references public.workspaces(id) on delete cascade,
  role public.member_role,
  email text,            -- optional lock for sign-up PINs
  target_user_id uuid references auth.users(id) on delete cascade, -- reset PINs
  pin_hash text not null unique,
  pin_hint text not null, -- last 2 characters, to tell PINs apart in lists
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  issued_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (purpose <> 'signup' or (workspace_id is not null and role is not null)),
  check (purpose <> 'reset' or target_user_id is not null)
);
create index access_pins_ws_idx on public.access_pins(workspace_id, created_at desc);
alter table public.access_pins enable row level security;

-- Admins can list (not read) the PINs of their workspace; you see all.
create policy access_pins_read on public.access_pins for select to authenticated
  using (public.is_platform_admin() or (workspace_id is not null and public.is_workspace_admin(workspace_id)));
-- Hide the hash column from the API: grant only the listable columns.
revoke all on public.access_pins from anon, authenticated;
grant select (id, purpose, workspace_id, role, email, target_user_id, pin_hint, expires_at,
              used_at, used_by, revoked_at, issued_by, created_at)
  on public.access_pins to authenticated;

create table private.pin_attempts (
  id bigint generated always as identity primary key,
  key text not null,
  success boolean not null,
  attempted_at timestamptz not null default now()
);
create index pin_attempts_key_idx on private.pin_attempts(key, attempted_at desc);

-- Issue a PIN. Returns the plain PIN once; only its hash is stored.
--   Sign-up, owner role:         Super Admin only.
--   Sign-up, admin/staff role:   workspace owner/admin (active workspace) or Super Admin.
--   Reset for a member:          workspace owner/admin (not for the owner) or Super Admin.
create or replace function public.issue_access_pin(
  p_purpose public.pin_purpose,
  p_workspace_id uuid default null,
  p_role public.member_role default null,
  p_email text default null,
  p_target_user_id uuid default null,
  p_valid_days int default 7
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_pin text;
  v_id uuid;
  v_target_role public.member_role;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first.';
  end if;
  if p_valid_days not between 1 and 30 then
    raise exception 'A PIN can be valid for 1 to 30 days.';
  end if;

  if p_purpose = 'platform_admin' then
    if not public.is_platform_admin() then
      raise exception 'Only the Super Admin can issue this PIN.';
    end if;
  elsif p_purpose = 'signup' then
    if p_workspace_id is null or p_role is null then
      raise exception 'Choose a workspace and a role.';
    end if;
    if not public.is_platform_admin() then
      if p_role = 'owner' then
        raise exception 'Only the Super Admin can issue owner PINs.';
      end if;
      if not public.can_admin_write(p_workspace_id) then
        raise exception 'Only an owner or admin of an active workspace can issue PINs.';
      end if;
    end if;
  elsif p_purpose = 'reset' then
    if p_target_user_id is null then
      raise exception 'Choose who the reset PIN is for.';
    end if;
    if not public.is_platform_admin() then
      select role into v_target_role from public.workspace_members
      where workspace_id = p_workspace_id and user_id = p_target_user_id;
      if v_target_role is null or not public.is_workspace_admin(p_workspace_id) then
        raise exception 'You can only reset passwords for members of your workspace.';
      end if;
      if v_target_role = 'owner' then
        raise exception 'Owner passwords are reset by the Super Admin.';
      end if;
    end if;
    -- Any older unused reset PIN for this person stops working.
    update public.access_pins set revoked_at = now()
    where target_user_id = p_target_user_id and purpose = 'reset' and used_at is null and revoked_at is null;
  end if;

  loop
    v_pin := private.new_pin();
    begin
      insert into public.access_pins
        (purpose, workspace_id, role, email, target_user_id, pin_hash, pin_hint, expires_at, issued_by)
      values
        (p_purpose, p_workspace_id, p_role, nullif(lower(trim(p_email)), ''), p_target_user_id,
         private.hash_pin(v_pin), right(v_pin, 2), now() + make_interval(days => p_valid_days),
         (select auth.uid()))
      returning id into v_id;
      exit;
    exception when unique_violation then
      -- astronomically unlikely; draw again
    end;
  end loop;

  if public.is_platform_admin() then
    insert into public.admin_audit_log (actor_id, workspace_id, action, details)
    values ((select auth.uid()), p_workspace_id, 'pin_issued',
            jsonb_build_object('purpose', p_purpose, 'role', p_role, 'pin_id', v_id));
  end if;

  return jsonb_build_object('id', v_id, 'pin', v_pin,
    'expires_at', now() + make_interval(days => p_valid_days));
end;
$$;
revoke execute on function public.issue_access_pin(public.pin_purpose, uuid, public.member_role, text, uuid, int) from public, anon;
grant execute on function public.issue_access_pin(public.pin_purpose, uuid, public.member_role, text, uuid, int) to authenticated;

create or replace function public.revoke_access_pin(p_pin_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ws uuid;
begin
  select workspace_id into v_ws from public.access_pins where id = p_pin_id;
  if not (public.is_platform_admin() or (v_ws is not null and public.is_workspace_admin(v_ws))) then
    raise exception 'Not allowed.';
  end if;
  update public.access_pins set revoked_at = now() where id = p_pin_id and used_at is null;
end;
$$;
revoke execute on function public.revoke_access_pin(uuid) from public, anon;
grant execute on function public.revoke_access_pin(uuid) to authenticated;

-- Step 1 of sign-up/reset (service role only): check a PIN without using it.
-- Locks a key (email or IP) after 5 failures in 15 minutes.
create or replace function public.pin_check(p_pin text, p_email text, p_purpose public.pin_purpose, p_client_key text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(p_email));
  v_keys text[] := array['email:' || v_email, 'ip:' || coalesce(p_client_key, 'unknown')];
  v_pin public.access_pins;
  v_target_email text;
begin
  if (select count(*) from private.pin_attempts
      where key = any (v_keys) and not success and attempted_at > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  end if;

  select * into v_pin from public.access_pins
  where pin_hash = private.hash_pin(p_pin) and purpose = p_purpose;

  if v_pin.id is null or v_pin.used_at is not null or v_pin.revoked_at is not null
     or v_pin.expires_at < now()
     or (v_pin.email is not null and v_pin.email <> v_email) then
    insert into private.pin_attempts (key, success) select k, false from unnest(v_keys) k;
    return jsonb_build_object('ok', false, 'error', 'invalid_pin');
  end if;

  if p_purpose = 'reset' then
    select lower(email) into v_target_email from auth.users where id = v_pin.target_user_id;
    if v_target_email is distinct from v_email then
      insert into private.pin_attempts (key, success) select k, false from unnest(v_keys) k;
      return jsonb_build_object('ok', false, 'error', 'invalid_pin');
    end if;
  end if;

  if v_pin.workspace_id is not null and public.workspace_status(v_pin.workspace_id) in ('suspended', 'expired')
     and p_purpose = 'signup' then
    return jsonb_build_object('ok', false, 'error', 'workspace_inactive');
  end if;

  return jsonb_build_object('ok', true, 'pin_id', v_pin.id, 'purpose', v_pin.purpose,
    'workspace_id', v_pin.workspace_id, 'role', v_pin.role, 'target_user_id', v_pin.target_user_id);
end;
$$;

-- Step 2 (service role only): use the PIN and attach the account.
create or replace function public.pin_consume(p_pin_id uuid, p_user_id uuid, p_email text,
                                              p_full_name text default null, p_phone text default null,
                                              p_client_key text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_pin public.access_pins;
begin
  select * into v_pin from public.access_pins where id = p_pin_id for update;
  if v_pin.id is null or v_pin.used_at is not null or v_pin.revoked_at is not null or v_pin.expires_at < now() then
    raise exception 'This PIN is no longer valid.' using hint = 'invalid_pin';
  end if;

  insert into public.profiles (id, email, full_name, phone)
  values (p_user_id, lower(trim(p_email)), coalesce(nullif(trim(p_full_name), ''), ''), nullif(trim(p_phone), ''))
  on conflict (id) do update
    set full_name = coalesce(nullif(excluded.full_name, ''), public.profiles.full_name),
        phone = coalesce(excluded.phone, public.profiles.phone);

  if v_pin.purpose = 'signup' then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (v_pin.workspace_id, p_user_id, v_pin.role)
    on conflict (workspace_id, user_id) do update set is_active = true, role = excluded.role;
  elsif v_pin.purpose = 'platform_admin' then
    insert into public.platform_admins (user_id) values (p_user_id) on conflict do nothing;
  end if;

  update public.access_pins set used_at = now(), used_by = p_user_id where id = p_pin_id;
  insert into private.pin_attempts (key, success)
  values ('email:' || lower(trim(p_email)), true), ('ip:' || coalesce(p_client_key, 'unknown'), true);

  return jsonb_build_object('ok', true, 'workspace_id', v_pin.workspace_id, 'role', v_pin.role);
end;
$$;

revoke execute on function public.pin_check(text, text, public.pin_purpose, text) from public, anon, authenticated;
revoke execute on function public.pin_consume(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.pin_check(text, text, public.pin_purpose, text) to service_role;
grant execute on function public.pin_consume(uuid, uuid, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Super Admin: create a workspace and its owner PIN in one step
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_workspace(
  p_name text,
  p_slug text,
  p_plan_id uuid,
  p_owner_name text,
  p_owner_email text default null,
  p_owner_phone text default null,
  p_trial_days int default null,   -- NULL = platform default
  p_valid_until timestamptz default null -- set instead of a trial for paid starts
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_until timestamptz;
  v_state public.subscription_state;
  v_pin jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Only the Super Admin can create workspaces.';
  end if;
  if p_valid_until is not null then
    v_until := p_valid_until;
    v_state := 'active';
  else
    v_until := now() + make_interval(days => coalesce(p_trial_days, (select trial_days from public.platform_settings)));
    v_state := 'trial';
  end if;

  insert into public.workspaces (name, slug, plan_id, state, valid_until, owner_name, owner_email, owner_phone, created_by)
  values (trim(p_name), lower(trim(p_slug)), p_plan_id, v_state, v_until, p_owner_name,
          nullif(lower(trim(p_owner_email)), ''), p_owner_phone, (select auth.uid()))
  returning id into v_ws;

  insert into public.admin_audit_log (actor_id, workspace_id, action, details)
  values ((select auth.uid()), v_ws, 'workspace_created',
          jsonb_build_object('plan_id', p_plan_id, 'state', v_state, 'valid_until', v_until));

  v_pin := public.issue_access_pin('signup', v_ws, 'owner', p_owner_email, null, 7);
  return jsonb_build_object('workspace_id', v_ws, 'owner_pin', v_pin);
end;
$$;
revoke execute on function public.admin_create_workspace(text, text, uuid, text, text, text, int, timestamptz) from public, anon;
grant execute on function public.admin_create_workspace(text, text, uuid, text, text, text, int, timestamptz) to authenticated;

-- Manual override: add or remove days, change plan or state.
create or replace function public.admin_update_subscription(
  p_workspace_id uuid,
  p_add_days int default 0,
  p_plan_id uuid default null,
  p_state public.subscription_state default null,
  p_note text default null
)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only the Super Admin can change subscriptions.';
  end if;
  update public.workspaces
  set valid_until = valid_until + make_interval(days => coalesce(p_add_days, 0)),
      plan_id = coalesce(p_plan_id, plan_id),
      state = coalesce(p_state, state)
  where id = p_workspace_id;
  insert into public.admin_audit_log (actor_id, workspace_id, action, details)
  values ((select auth.uid()), p_workspace_id, 'subscription_updated',
          jsonb_build_object('add_days', p_add_days, 'plan_id', p_plan_id, 'state', p_state, 'note', p_note));
end;
$$;
revoke execute on function public.admin_update_subscription(uuid, int, uuid, public.subscription_state, text) from public, anon;
grant execute on function public.admin_update_subscription(uuid, int, uuid, public.subscription_state, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Renewals
-- ---------------------------------------------------------------------------
create or replace function private.period_interval(p public.billing_period)
returns interval
language sql immutable
set search_path = ''
as $$
  select case p
    when 'monthly' then interval '1 month'
    when 'quarterly' then interval '3 months'
    when 'half_yearly' then interval '6 months'
    when 'yearly' then interval '1 year'
  end;
$$;

create or replace function private.plan_price(p_plan uuid, p public.billing_period)
returns numeric
language sql stable
set search_path = ''
as $$
  select case p
    when 'monthly' then price_monthly
    when 'quarterly' then price_quarterly
    when 'half_yearly' then price_half_yearly
    when 'yearly' then price_yearly
  end
  from public.plans where id = p_plan and is_active;
$$;

-- The amount on a request always comes from the plan, never from the browser.
create or replace function private.renewal_request_defaults()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_price numeric;
begin
  v_price := private.plan_price(new.plan_id, new.period);
  if v_price is null then
    raise exception 'This plan is not available for that period.';
  end if;
  new.amount := v_price;
  return new;
end;
$$;
create trigger renewal_requests_defaults before insert on public.renewal_requests
  for each row execute function private.renewal_request_defaults();

create or replace function public.approve_renewal(p_request_id uuid, p_admin_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.renewal_requests;
  v_from timestamptz;
  v_until timestamptz;
begin
  if not public.is_platform_admin() then
    raise exception 'Only the Super Admin can approve renewals.';
  end if;
  select * into r from public.renewal_requests where id = p_request_id for update;
  if r.id is null or r.status <> 'pending' then
    raise exception 'This request is not pending.';
  end if;

  -- Extend from the current expiry if renewed early, from now if already lapsed.
  select greatest(valid_until, now()) into v_from from public.workspaces where id = r.workspace_id for update;
  v_until := v_from + private.period_interval(r.period);

  update public.workspaces
  set valid_until = v_until, plan_id = r.plan_id,
      state = case when state = 'suspended' then state else 'active' end
  where id = r.workspace_id;

  update public.renewal_requests
  set status = 'approved', admin_note = p_admin_note, reviewed_by = (select auth.uid()), reviewed_at = now()
  where id = r.id;

  insert into public.subscription_payments
    (workspace_id, renewal_request_id, plan_id, period, amount, payment_mode, reference_no, paid_on, valid_from, valid_until, recorded_by)
  values
    (r.workspace_id, r.id, r.plan_id, r.period, r.amount, r.payment_mode, r.reference_no, current_date, v_from, v_until, (select auth.uid()));

  insert into public.notifications (workspace_id, user_id, type, title, message, link)
  select r.workspace_id, m.user_id, 'subscription', 'Subscription renewed',
         'Your plan is active until ' || to_char(v_until at time zone 'Asia/Kolkata', 'DD Mon YYYY') || '.',
         '/settings/subscription'
  from public.workspace_members m
  where m.workspace_id = r.workspace_id and m.role in ('owner', 'admin') and m.is_active;

  insert into public.admin_audit_log (actor_id, workspace_id, action, details)
  values ((select auth.uid()), r.workspace_id, 'renewal_approved',
          jsonb_build_object('request_id', r.id, 'amount', r.amount, 'valid_until', v_until));

  return jsonb_build_object('valid_until', v_until);
end;
$$;

create or replace function public.reject_renewal(p_request_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.renewal_requests;
begin
  if not public.is_platform_admin() then
    raise exception 'Only the Super Admin can reject renewals.';
  end if;
  update public.renewal_requests
  set status = 'rejected', admin_note = p_reason, reviewed_by = (select auth.uid()), reviewed_at = now()
  where id = p_request_id and status = 'pending'
  returning * into r;
  if r.id is null then
    raise exception 'This request is not pending.';
  end if;

  insert into public.notifications (workspace_id, user_id, type, title, message, link)
  select r.workspace_id, m.user_id, 'subscription', 'Renewal request not approved',
         coalesce(p_reason, 'Please contact support.'), '/settings/subscription'
  from public.workspace_members m
  where m.workspace_id = r.workspace_id and m.role in ('owner', 'admin') and m.is_active;

  insert into public.admin_audit_log (actor_id, workspace_id, action, details)
  values ((select auth.uid()), r.workspace_id, 'renewal_rejected',
          jsonb_build_object('request_id', r.id, 'reason', p_reason));
end;
$$;
revoke execute on function public.approve_renewal(uuid, text), public.reject_renewal(uuid, text) from public, anon;
grant execute on function public.approve_renewal(uuid, text), public.reject_renewal(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Public lead forms (anonymous visitors)
-- ---------------------------------------------------------------------------
create or replace function public.get_public_form(p_slug text)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'slug', f.slug, 'title', f.title, 'description', f.description, 'fields', f.fields,
    'banner_path', f.banner_path, 'logo_path', coalesce(f.logo_path, s.logo_path),
    'theme_color', f.theme_color, 'company_name', coalesce(s.company_name, w.name))
  from public.lead_forms f
  join public.workspaces w on w.id = f.workspace_id
  left join public.workspace_settings s on s.workspace_id = f.workspace_id
  where f.slug = lower(p_slug) and f.is_active
    and public.workspace_status(f.workspace_id) <> 'suspended'
    and public.workspace_has_module(f.workspace_id, 'leads');
$$;

-- Keeps collecting leads after expiry so customers lose nothing; stops when suspended.
create or replace function public.submit_public_lead(p_slug text, p_name text, p_phone text,
                                                     p_email text default null, p_answers jsonb default '{}')
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  f public.lead_forms;
  v_lead uuid;
begin
  select * into f from public.lead_forms where slug = lower(p_slug) and is_active;
  if f.id is null or public.workspace_status(f.workspace_id) = 'suspended'
     or not public.workspace_has_module(f.workspace_id, 'leads') then
    raise exception 'This form is not available.';
  end if;
  if coalesce(trim(p_name), '') = '' or (coalesce(trim(p_phone), '') = '' and coalesce(trim(p_email), '') = '') then
    raise exception 'Name and a phone number or email are required.';
  end if;
  if length(p_name) > 200 or length(coalesce(p_phone, '')) > 40 or length(coalesce(p_email, '')) > 200
     or pg_column_size(p_answers) > 20000 then
    raise exception 'Submission is too large.';
  end if;
  -- Light flood protection: 30 submissions per form per 10 minutes.
  if (select count(*) from public.leads where form_id = f.id and created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'Too many submissions, please try again shortly.';
  end if;

  insert into public.leads (workspace_id, name, phone, email, source, form_id, form_answers)
  values (f.workspace_id, trim(p_name), nullif(trim(p_phone), ''), nullif(lower(trim(p_email)), ''),
          f.default_source, f.id, coalesce(p_answers, '{}'))
  returning id into v_lead;

  insert into public.notifications (workspace_id, user_id, type, title, message, link)
  select f.workspace_id, m.user_id, 'lead', 'New lead: ' || trim(p_name), 'From form "' || f.title || '"', '/leads?open=' || v_lead
  from public.workspace_members m
  where m.workspace_id = f.workspace_id and m.role in ('owner', 'admin') and m.is_active;

  return jsonb_build_object('ok', true, 'message', coalesce(f.success_message, 'Thank you! We will contact you soon.'));
end;
$$;
grant execute on function public.get_public_form(text), public.submit_public_lead(text, text, text, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Timers
-- ---------------------------------------------------------------------------
create or replace function public.start_timer(p_workspace_id uuid, p_work_item_id uuid default null, p_notes text default null)
returns uuid
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_client uuid;
begin
  -- Stop any running timer first.
  update public.time_entries set stopped_at = now(), stopped_by = (select auth.uid())
  where workspace_id = p_workspace_id and user_id = (select auth.uid()) and stopped_at is null;

  select client_id into v_client from public.work_items where id = p_work_item_id;
  insert into public.time_entries (workspace_id, user_id, work_item_id, client_id, notes)
  values (p_workspace_id, (select auth.uid()), p_work_item_id, v_client, p_notes)
  returning id into v_id;

  -- Starting a timer moves a backlog item into progress.
  update public.work_items set status = 'in_progress' where id = p_work_item_id and status = 'backlog';
  return v_id;
end;
$$;

-- Stops your own running timer, or (admins) someone else's forgotten one.
create or replace function public.stop_timer(p_workspace_id uuid, p_user_id uuid default null)
returns void
language plpgsql security invoker
set search_path = ''
as $$
begin
  update public.time_entries set stopped_at = now(), stopped_by = (select auth.uid())
  where workspace_id = p_workspace_id and user_id = coalesce(p_user_id, (select auth.uid())) and stopped_at is null;
end;
$$;
revoke execute on function public.start_timer(uuid, uuid, text), public.stop_timer(uuid, uuid) from public, anon;
grant execute on function public.start_timer(uuid, uuid, text), public.stop_timer(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Lead conversion (Won lead -> client + onboarding work item)
-- ---------------------------------------------------------------------------
create or replace function public.convert_lead_to_client(p_lead_id uuid, p_create_work_item boolean default true)
returns jsonb
language plpgsql security invoker
set search_path = ''
as $$
declare
  l public.leads;
  v_client uuid;
  v_work uuid;
begin
  select * into l from public.leads where id = p_lead_id;
  if l.id is null then
    raise exception 'Lead not found.';
  end if;
  if l.converted_client_id is not null then
    return jsonb_build_object('client_id', l.converted_client_id, 'already_converted', true);
  end if;

  insert into public.clients (workspace_id, company_name, contact_person, email, phone, created_by)
  values (l.workspace_id, coalesce(nullif(l.company, ''), l.name), l.name, l.email, l.phone, (select auth.uid()))
  returning id into v_client;

  update public.leads set stage = 'won', converted_client_id = v_client where id = l.id;

  if p_create_work_item and public.workspace_has_module(l.workspace_id, 'work') then
    insert into public.work_items (workspace_id, title, client_id, priority, created_by)
    values (l.workspace_id, 'Onboard ' || coalesce(nullif(l.company, ''), l.name), v_client, 'high', (select auth.uid()))
    returning id into v_work;
    if l.assigned_to is not null then
      insert into public.work_item_assignees (work_item_id, user_id, workspace_id, assigned_by)
      values (v_work, l.assigned_to, l.workspace_id, (select auth.uid()));
    end if;
  end if;

  return jsonb_build_object('client_id', v_client, 'work_item_id', v_work);
end;
$$;
revoke execute on function public.convert_lead_to_client(uuid, boolean) from public, anon;
grant execute on function public.convert_lead_to_client(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Invoicing
-- ---------------------------------------------------------------------------
-- Per-workspace numbering: INV-0001, INV-0002, ...
create or replace function private.next_invoice_number(p_ws uuid)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_prefix text;
  v_n int;
begin
  update public.workspace_settings
  set next_invoice_number = next_invoice_number + 1
  where workspace_id = p_ws
  returning invoice_prefix, next_invoice_number - 1 into v_prefix, v_n;
  return v_prefix || lpad(v_n::text, 4, '0');
end;
$$;

create or replace function private.invoice_number_default()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.invoice_number is null or new.invoice_number = '' then
    new.invoice_number := private.next_invoice_number(new.workspace_id);
  end if;
  return new;
end;
$$;
create trigger invoices_number before insert on public.invoices
  for each row execute function private.invoice_number_default();
alter table public.invoices alter column invoice_number drop not null;
alter table public.invoices add constraint invoices_number_present check (invoice_number is not null);

-- Creates upcoming invoices for recurring bills, ahead of their date. Runs daily.
create or replace function private.generate_recurring_invoices()
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  b record;
  v_inv uuid;
  v_count int := 0;
  v_period_end date;
begin
  for b in
    select rb.*, s.recurring_lead_days
    from public.recurring_bills rb
    join public.workspace_settings s on s.workspace_id = rb.workspace_id
    where rb.is_active
      and rb.next_run_date <= current_date + s.recurring_lead_days
      and (rb.end_date is null or rb.next_run_date <= rb.end_date)
      and public.workspace_status(rb.workspace_id) in ('trial', 'active', 'grace')
      and public.workspace_has_module(rb.workspace_id, 'invoicing')
    for update of rb skip locked
  loop
    v_period_end := (b.next_run_date + private.period_interval(b.frequency))::date - 1;
    insert into public.invoices
      (workspace_id, client_id, recurring_bill_id, period_start, period_end, issue_date, due_date,
       status, currency, assigned_to, created_by)
    values
      (b.workspace_id, b.client_id, b.id, b.next_run_date, v_period_end, b.next_run_date,
       b.next_run_date + b.payment_terms_days, 'pending', b.currency, b.assigned_to, b.created_by)
    on conflict (recurring_bill_id, period_start) do nothing
    returning id into v_inv;

    if v_inv is not null then
      insert into public.invoice_items (invoice_id, workspace_id, description, quantity, rate, tax_rate)
      values (v_inv, b.workspace_id, b.title, 1, b.amount, b.tax_rate);
      v_count := v_count + 1;
    end if;

    update public.recurring_bills
    set next_run_date = (next_run_date + private.period_interval(frequency))::date
    where id = b.id;
  end loop;
  return v_count;
end;
$$;

-- Admins can trigger generation for their own workspace from the UI.
create or replace function public.run_recurring_billing(p_workspace_id uuid)
returns int
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.can_admin_write(p_workspace_id, 'invoicing') then
    raise exception 'Not allowed.';
  end if;
  return private.generate_recurring_invoices();
end;
$$;
revoke execute on function public.run_recurring_billing(uuid) from public, anon;
grant execute on function public.run_recurring_billing(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Notifications from work assignments
-- ---------------------------------------------------------------------------
create or replace function private.notify_work_assignment()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.user_id is distinct from (select auth.uid()) then
    insert into public.notifications (workspace_id, user_id, type, title, message, link)
    select new.workspace_id, new.user_id, 'work', 'New work assigned', w.title, '/work?open=' || w.id
    from public.work_items w where w.id = new.work_item_id;
  end if;
  return new;
end;
$$;
create trigger work_item_assignees_notify after insert on public.work_item_assignees
  for each row execute function private.notify_work_assignment();

-- ---------------------------------------------------------------------------
-- Activity feed
-- ---------------------------------------------------------------------------
create or replace function private.log_activity()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  j jsonb := to_jsonb(coalesce(new, old));
  v_action text;
  v_summary text;
begin
  v_summary := coalesce(j ->> 'title', j ->> 'name', j ->> 'company_name', j ->> 'invoice_number');
  if tg_op = 'INSERT' then
    v_action := 'created';
  elsif tg_op = 'DELETE' then
    v_action := 'deleted';
  else
    if to_jsonb(new) ->> 'status' is distinct from to_jsonb(old) ->> 'status'
       or to_jsonb(new) ->> 'stage' is distinct from to_jsonb(old) ->> 'stage' then
      v_action := 'status_changed';
      v_summary := coalesce(v_summary, '') || ' → ' || coalesce(j ->> 'status', j ->> 'stage');
    elsif tg_table_name = 'time_entries' and to_jsonb(old) ->> 'stopped_at' is null and to_jsonb(new) ->> 'stopped_at' is not null then
      v_action := 'timer_stopped';
    else
      return null; -- ordinary edits are not logged
    end if;
  end if;

  insert into public.activity_logs (workspace_id, actor_id, action, entity_type, entity_id, summary)
  values ((j ->> 'workspace_id')::uuid, (select auth.uid()), v_action,
          case tg_table_name
            when 'leads' then 'lead' when 'clients' then 'client' when 'work_items' then 'work_item'
            when 'invoices' then 'invoice' when 'invoice_payments' then 'payment'
            when 'time_entries' then 'timer' when 'ad_fund_uploads' then 'ad_fund'
            else tg_table_name end,
          (j ->> 'id')::uuid, v_summary);
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['leads', 'clients', 'work_items', 'invoices', 'invoice_payments', 'ad_fund_uploads'] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function private.log_activity()',
      t || '_activity', t);
  end loop;
end;
$$;
create trigger time_entries_activity after update of stopped_at on public.time_entries
  for each row execute function private.log_activity();

-- ---------------------------------------------------------------------------
-- Scheduled jobs
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;

-- Reminders 7 days before expiry and on the day it lapses.
create or replace function private.send_subscription_reminders()
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.notifications (workspace_id, user_id, type, title, message, link)
  select w.id, m.user_id, 'subscription',
         case when w.valid_until::date = current_date then 'Your plan ends today'
              else 'Your plan ends in ' || (w.valid_until::date - current_date) || ' days' end,
         'Renew from Settings to keep full access.', '/settings/subscription'
  from public.workspaces w
  cross join public.platform_settings s
  join public.workspace_members m on m.workspace_id = w.id and m.role in ('owner', 'admin') and m.is_active
  where w.state <> 'suspended'
    and (w.valid_until::date = current_date + s.reminder_days or w.valid_until::date = current_date);
end;
$$;

select cron.schedule('recurring-invoices', '30 0 * * *', $$select private.generate_recurring_invoices()$$);
select cron.schedule('subscription-reminders', '0 3 * * *', $$select private.send_subscription_reminders()$$);
