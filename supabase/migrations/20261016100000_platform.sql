-- Platform layer: plans, workspaces, membership, Super Admin, subscriptions.
-- Every module table hangs off public.workspaces; isolation is enforced by RLS.

create extension if not exists pgcrypto with schema extensions;

-- Objects that must never be reachable through the API live in "private".
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.member_role as enum ('owner', 'admin', 'staff');
-- Stored state. The effective state (trial/active/grace/expired/suspended)
-- is derived from this plus valid_until; see public.workspace_status().
create type public.subscription_state as enum ('trial', 'active', 'suspended');
create type public.billing_period as enum ('monthly', 'quarterly', 'half_yearly', 'yearly');
create type public.payment_mode as enum ('bank_transfer', 'upi', 'cheque', 'cash', 'other');
create type public.request_status as enum ('pending', 'approved', 'rejected');

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  -- Prices in INR per period. NULL = not sold for that period.
  price_monthly numeric(12,2),
  price_quarterly numeric(12,2),
  price_half_yearly numeric(12,2),
  price_yearly numeric(12,2),
  staff_limit int check (staff_limit is null or staff_limit > 0),   -- NULL = unlimited
  client_limit int check (client_limit is null or client_limit > 0), -- NULL = unlimited
  -- Optional modules switched on for this plan. Core modules (dashboard,
  -- clients, staff, settings, notifications) are always on.
  modules text[] not null default '{}'
    check (modules <@ array['leads', 'work', 'invoicing', 'ad_funds']::text[]),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger plans_updated_at before update on public.plans
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Workspaces (one per customer company)
-- ---------------------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{1,46}[a-z0-9])?$'),
  plan_id uuid not null references public.plans(id),
  state public.subscription_state not null default 'trial',
  -- End of the trial or of the paid period.
  valid_until timestamptz not null,
  owner_name text,
  owner_email text,
  owner_phone text,
  logo_path text,
  notes text, -- Super Admin's private notes
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workspaces_plan_idx on public.workspaces(plan_id);
create trigger workspaces_updated_at before update on public.workspaces
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  phone text,
  designation text,
  department text,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'staff',
  is_active boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members(user_id);
-- Exactly one owner per workspace.
create unique index workspace_one_owner on public.workspace_members(workspace_id) where role = 'owner';

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Single-row table: your payment details shown on the renewal screen.
create table public.platform_settings (
  id boolean primary key default true check (id),
  grace_days int not null default 3 check (grace_days >= 0),
  trial_days int not null default 14 check (trial_days >= 0),
  reminder_days int not null default 7 check (reminder_days >= 0),
  bank_account_name text,
  bank_name text,
  bank_account_number text,
  bank_ifsc text,
  upi_id text,
  upi_qr_path text,
  payment_note text,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings default values;
create trigger platform_settings_updated_at before update on public.platform_settings
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Subscriptions (direct payment, approved by hand)
-- ---------------------------------------------------------------------------
create table public.renewal_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  period public.billing_period not null,
  amount numeric(12,2) not null check (amount >= 0),
  payment_mode public.payment_mode not null,
  reference_no text,
  receipt_path text,
  note text,
  status public.request_status not null default 'pending',
  admin_note text,
  requested_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index renewal_requests_ws_idx on public.renewal_requests(workspace_id);
create index renewal_requests_pending_idx on public.renewal_requests(created_at) where status = 'pending';

create table public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  renewal_request_id uuid references public.renewal_requests(id) on delete set null,
  plan_id uuid not null references public.plans(id),
  period public.billing_period,
  amount numeric(12,2) not null check (amount >= 0),
  payment_mode public.payment_mode not null,
  reference_no text,
  paid_on date not null default current_date,
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index subscription_payments_ws_idx on public.subscription_payments(workspace_id);
create index subscription_payments_paid_idx on public.subscription_payments(paid_on);

create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  workspace_id uuid references public.workspaces(id) on delete set null,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index admin_audit_log_ws_idx on public.admin_audit_log(workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Access helpers used by every RLS policy. SECURITY DEFINER so they can read
-- membership without recursing into RLS; they only ever look at auth.uid().
-- ---------------------------------------------------------------------------
create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admins where user_id = (select auth.uid()));
$$;

create or replace function public.member_role(ws uuid)
returns public.member_role
language sql stable security definer
set search_path = ''
as $$
  select role from public.workspace_members
  where workspace_id = ws and user_id = (select auth.uid()) and is_active;
$$;

create or replace function public.is_workspace_member(ws uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.member_role(ws) is not null;
$$;

create or replace function public.is_workspace_admin(ws uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(public.member_role(ws) in ('owner', 'admin'), false);
$$;

-- Effective status: trial | active | grace | expired | suspended
create or replace function public.workspace_status(ws uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select case
    when w.state = 'suspended' then 'suspended'
    when now() <= w.valid_until then w.state::text
    when now() <= w.valid_until + make_interval(days => s.grace_days) then 'grace'
    else 'expired'
  end
  from public.workspaces w
  cross join public.platform_settings s
  where w.id = ws;
$$;

-- Writes are allowed while trial, active or in grace.
create or replace function public.workspace_is_active(ws uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(public.workspace_status(ws) in ('trial', 'active', 'grace'), false);
$$;

create or replace function public.workspace_has_module(ws uuid, module text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select module = any (p.modules)
    from public.workspaces w join public.plans p on p.id = w.plan_id
    where w.id = ws
  ), false);
$$;

-- Shorthand for module write policies: member + active subscription + module on.
create or replace function public.can_write(ws uuid, module text default null)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.is_workspace_member(ws)
     and public.workspace_is_active(ws)
     and (module is null or public.workspace_has_module(ws, module));
$$;

create or replace function public.can_admin_write(ws uuid, module text default null)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.is_workspace_admin(ws) and public.can_write(ws, module);
$$;

-- ---------------------------------------------------------------------------
-- Plan limits, enforced in the database
-- ---------------------------------------------------------------------------
create or replace function private.enforce_staff_limit()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_limit int;
  v_count int;
begin
  if not new.is_active then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.is_active then
    return new;
  end if;
  select p.staff_limit into v_limit
  from public.workspaces w join public.plans p on p.id = w.plan_id
  where w.id = new.workspace_id;
  if v_limit is null then
    return new;
  end if;
  -- Serialise concurrent joins to the same workspace.
  perform 1 from public.workspaces where id = new.workspace_id for update;
  select count(*) into v_count from public.workspace_members
  where workspace_id = new.workspace_id and is_active and user_id <> new.user_id;
  if v_count >= v_limit then
    raise exception 'Staff limit reached: this plan allows % active users.', v_limit
      using errcode = 'P0001', hint = 'seat_limit';
  end if;
  return new;
end;
$$;
create trigger workspace_members_staff_limit
  before insert or update of is_active on public.workspace_members
  for each row execute function private.enforce_staff_limit();

-- Members cannot be moved between workspaces or change their own role.
create or replace function private.guard_member_update()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.workspace_id <> old.workspace_id or new.user_id <> old.user_id then
    raise exception 'Membership keys cannot change.';
  end if;
  if (select auth.uid()) is not null and not public.is_platform_admin() then
    if new.user_id = (select auth.uid()) and (new.role <> old.role or new.is_active <> old.is_active) then
      raise exception 'You cannot change your own role or status.';
    end if;
    if (old.role = 'owner' or new.role = 'owner') and old.role <> new.role then
      raise exception 'Only the Super Admin can change the workspace owner.';
    end if;
  end if;
  return new;
end;
$$;
create trigger workspace_members_guard
  before update on public.workspace_members
  for each row execute function private.guard_member_update();

-- ---------------------------------------------------------------------------
-- RLS for the platform tables
-- ---------------------------------------------------------------------------
alter table public.plans enable row level security;
alter table public.workspaces enable row level security;
alter table public.profiles enable row level security;
alter table public.workspace_members enable row level security;
alter table public.platform_admins enable row level security;
alter table public.platform_settings enable row level security;
alter table public.renewal_requests enable row level security;
alter table public.subscription_payments enable row level security;
alter table public.admin_audit_log enable row level security;

-- Plans: any signed-in user can read active plans (renewal screen); only you edit.
create policy plans_read on public.plans for select to authenticated
  using (is_active or public.is_platform_admin());
create policy plans_admin on public.plans for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Workspaces: members read their own; only you create, change or delete.
create policy workspaces_read on public.workspaces for select to authenticated
  using (public.is_workspace_member(id) or public.is_platform_admin());
create policy workspaces_admin on public.workspaces for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Profiles: yourself, people who share a workspace with you, or the Super Admin.
create policy profiles_read on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or public.is_platform_admin()
    or exists (
      select 1 from public.workspace_members them
      where them.user_id = profiles.id and public.is_workspace_member(them.workspace_id)
    )
  );
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy profiles_admin on public.profiles for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Members: anyone in the workspace can see the team; workspace admins manage it.
-- New members only arrive through the PIN sign-up function (service role).
create policy members_read on public.workspace_members for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_platform_admin());
create policy members_update on public.workspace_members for update to authenticated
  using (public.can_admin_write(workspace_id) or public.is_platform_admin())
  with check (public.can_admin_write(workspace_id) or public.is_platform_admin());
create policy members_delete on public.workspace_members for delete to authenticated
  using (
    public.is_platform_admin()
    or (public.can_admin_write(workspace_id) and role <> 'owner' and user_id <> (select auth.uid()))
  );
create policy members_platform_insert on public.workspace_members for insert to authenticated
  with check (public.is_platform_admin());

create policy platform_admins_read on public.platform_admins for select to authenticated
  using (public.is_platform_admin());

-- Payment details are readable by every signed-in user (renewal screen).
create policy platform_settings_read on public.platform_settings for select to authenticated
  using (true);
create policy platform_settings_admin on public.platform_settings for update to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Renewal requests: the workspace's admins submit and see theirs; you review all.
create policy renewals_read on public.renewal_requests for select to authenticated
  using (public.is_workspace_admin(workspace_id) or public.is_platform_admin());
create policy renewals_insert on public.renewal_requests for insert to authenticated
  with check (
    public.is_workspace_admin(workspace_id)
    and public.workspace_status(workspace_id) <> 'suspended'
    and status = 'pending'
    and requested_by = (select auth.uid())
    and reviewed_by is null and reviewed_at is null and admin_note is null
  );
create policy renewals_admin on public.renewal_requests for update to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy sub_payments_read on public.subscription_payments for select to authenticated
  using (public.is_workspace_admin(workspace_id) or public.is_platform_admin());
create policy sub_payments_admin on public.subscription_payments for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy audit_read on public.admin_audit_log for select to authenticated
  using (public.is_platform_admin());

-- Helper functions are callable by signed-in users only.
revoke execute on function public.is_platform_admin(), public.member_role(uuid),
  public.is_workspace_member(uuid), public.is_workspace_admin(uuid),
  public.workspace_status(uuid), public.workspace_is_active(uuid),
  public.workspace_has_module(uuid, text), public.can_write(uuid, text),
  public.can_admin_write(uuid, text)
  from public, anon;
grant execute on function public.is_platform_admin(), public.member_role(uuid),
  public.is_workspace_member(uuid), public.is_workspace_admin(uuid),
  public.workspace_status(uuid), public.workspace_is_active(uuid),
  public.workspace_has_module(uuid, text), public.can_write(uuid, text),
  public.can_admin_write(uuid, text)
  to authenticated;
