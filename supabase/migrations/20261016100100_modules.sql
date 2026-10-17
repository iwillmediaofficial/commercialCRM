-- CRM module tables. Every table carries workspace_id, and every policy checks it.
-- Read rules:  members of the workspace (staff see only their own leads and work).
-- Write rules: members of an active workspace whose plan includes the module.
-- The Super Admin can read everything (support), but writes only as a member.

-- ---------------------------------------------------------------------------
-- Workspace settings (company profile, invoicing defaults, notification rules)
-- ---------------------------------------------------------------------------
create table public.workspace_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  company_name text,
  legal_name text,
  address text,
  city text,
  state text,
  postal_code text,
  country text default 'India',
  phone text,
  email text,
  website text,
  gstin text,
  pan text,
  currency text not null default 'INR',
  logo_path text,
  invoice_prefix text not null default 'INV-',
  next_invoice_number int not null default 1 check (next_invoice_number > 0),
  default_payment_terms_days int not null default 15,
  default_tax_rate numeric(5,2) not null default 18,
  invoice_footer text,
  bank_details text,
  recurring_lead_days int not null default 7 check (recurring_lead_days between 0 and 60),
  notification_rules jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create trigger workspace_settings_updated_at before update on public.workspace_settings
  for each row execute function private.set_updated_at();

-- Every new workspace gets a settings row.
create or replace function private.create_workspace_settings()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.workspace_settings (workspace_id, company_name)
  values (new.id, new.name)
  on conflict do nothing;
  return new;
end;
$$;
create trigger workspaces_create_settings after insert on public.workspaces
  for each row execute function private.create_workspace_settings();

-- ---------------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_name text not null,
  contact_person text,
  email text,
  phone text,
  address text,
  website text,
  gstin text,
  logo_path text,
  notes text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  -- Digital marketing enrolment (Ad Fund Management)
  is_dm_client boolean not null default false,
  monthly_ad_target numeric(12,2) not null default 0 check (monthly_ad_target >= 0),
  ad_platforms text[] not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create index clients_ws_idx on public.clients(workspace_id, company_name);
create trigger clients_updated_at before update on public.clients
  for each row execute function private.set_updated_at();

create or replace function private.enforce_client_limit()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_limit int;
  v_count int;
begin
  if new.status <> 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'active' then
    return new;
  end if;
  select p.client_limit into v_limit
  from public.workspaces w join public.plans p on p.id = w.plan_id
  where w.id = new.workspace_id;
  if v_limit is null then
    return new;
  end if;
  perform 1 from public.workspaces where id = new.workspace_id for update;
  select count(*) into v_count from public.clients
  where workspace_id = new.workspace_id and status = 'active' and id <> new.id;
  if v_count >= v_limit then
    raise exception 'Client limit reached: this plan allows % active clients.', v_limit
      using errcode = 'P0001', hint = 'client_limit';
  end if;
  return new;
end;
$$;
create trigger clients_limit before insert or update of status on public.clients
  for each row execute function private.enforce_client_limit();

-- ---------------------------------------------------------------------------
-- Leads and public lead forms
-- ---------------------------------------------------------------------------
create table public.lead_forms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{1,62}[a-z0-9])?$'),
  title text not null,
  description text,
  -- [{ "key": "budget", "label": "Monthly budget", "type": "text|textarea|select|number|email|phone", "required": true, "options": [...] }]
  fields jsonb not null default '[]' check (jsonb_typeof(fields) = 'array'),
  default_source text not null default 'Lead form',
  banner_path text,
  logo_path text,
  theme_color text,
  success_message text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lead_forms_ws_idx on public.lead_forms(workspace_id);
create trigger lead_forms_updated_at before update on public.lead_forms
  for each row execute function private.set_updated_at();

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  company text,
  source text not null default 'Other', -- Meta Ads, Website, Referral, Cold Call, Lead form, ...
  stage text not null default 'new'
    check (stage in ('new', 'contacted', 'qualified', 'proposal_sent', 'won', 'lost')),
  value numeric(12,2) check (value is null or value >= 0),
  score int check (score is null or score between 0 and 100),
  notes text,
  campaign_details text,
  form_id uuid references public.lead_forms(id) on delete set null,
  form_answers jsonb,
  assigned_to uuid references auth.users(id) on delete set null,
  follow_up_date date,
  position int not null default 0, -- order within a Kanban column
  converted_client_id uuid references public.clients(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_ws_stage_idx on public.leads(workspace_id, stage, position);
create index leads_assigned_idx on public.leads(assigned_to);
create trigger leads_updated_at before update on public.leads
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Work items, assignees, checklist, time tracking
-- ---------------------------------------------------------------------------
create table public.work_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  description text,
  client_id uuid references public.clients(id) on delete set null,
  status text not null default 'backlog'
    check (status in ('backlog', 'in_progress', 'under_review', 'completed')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  start_date date,
  due_date date,
  estimated_hours numeric(8,2) check (estimated_hours is null or estimated_hours >= 0),
  -- [{ "id": "...", "text": "...", "done": false }]
  checklist jsonb not null default '[]' check (jsonb_typeof(checklist) = 'array'),
  is_billable boolean not null default false,
  billable_amount numeric(12,2) check (billable_amount is null or billable_amount >= 0),
  position int not null default 0,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index work_items_ws_status_idx on public.work_items(workspace_id, status, position);
create index work_items_client_idx on public.work_items(client_id);
create trigger work_items_updated_at before update on public.work_items
  for each row execute function private.set_updated_at();

create or replace function private.work_item_completed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status <> 'completed') then
    new.completed_at := now();
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;
create trigger work_items_completed before insert or update of status on public.work_items
  for each row execute function private.work_item_completed_at();

create table public.work_item_assignees (
  work_item_id uuid not null references public.work_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (work_item_id, user_id)
);
create index work_item_assignees_user_idx on public.work_item_assignees(user_id, workspace_id);

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  work_item_id uuid references public.work_items(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  started_at timestamptz not null default now(),
  stopped_at timestamptz,
  duration_seconds int generated always as (
    case when stopped_at is null then null
         else greatest(0, extract(epoch from (stopped_at - started_at))::int) end
  ) stored,
  is_billable boolean not null default true,
  notes text,
  stopped_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (stopped_at is null or stopped_at >= started_at)
);
-- One running timer per person per workspace.
create unique index time_entries_one_running on public.time_entries(workspace_id, user_id) where stopped_at is null;
create index time_entries_ws_started_idx on public.time_entries(workspace_id, started_at desc);
create index time_entries_work_item_idx on public.time_entries(work_item_id);

-- ---------------------------------------------------------------------------
-- Files (stored in Cloudflare R2; this table holds the record)
-- ---------------------------------------------------------------------------
create table public.files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity_type text not null check (entity_type in ('work_item', 'client', 'lead', 'invoice', 'workspace', 'profile')),
  entity_id uuid,
  r2_key text not null unique, -- always "<workspace_id>/..."
  file_name text not null,
  mime_type text,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (split_part(r2_key, '/', 1) = workspace_id::text)
);
create index files_entity_idx on public.files(workspace_id, entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Invoicing and recurring billing
-- ---------------------------------------------------------------------------
create table public.recurring_bills (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null,
  description text,
  amount numeric(12,2) not null check (amount >= 0),
  tax_rate numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  currency text not null default 'INR',
  frequency public.billing_period not null default 'monthly',
  billing_day int not null default 1 check (billing_day between 1 and 28),
  start_date date not null default current_date,
  end_date date,
  next_run_date date not null,
  payment_terms_days int not null default 15 check (payment_terms_days >= 0),
  is_active boolean not null default true,
  assigned_to uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recurring_bills_due_idx on public.recurring_bills(next_run_date) where is_active;
create index recurring_bills_ws_idx on public.recurring_bills(workspace_id);
create trigger recurring_bills_updated_at before update on public.recurring_bills
  for each row execute function private.set_updated_at();

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invoice_number text not null,
  client_id uuid not null references public.clients(id) on delete restrict,
  work_item_id uuid references public.work_items(id) on delete set null,
  recurring_bill_id uuid references public.recurring_bills(id) on delete set null,
  period_start date,
  period_end date,
  issue_date date not null default current_date,
  due_date date not null,
  status text not null default 'draft' check (status in ('draft', 'pending', 'paid', 'cancelled')),
  currency text not null default 'INR',
  subtotal numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  tax_total numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  place_of_supply text,
  notes text,
  terms text,
  assigned_to uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, invoice_number),
  unique (recurring_bill_id, period_start)
);
create index invoices_ws_due_idx on public.invoices(workspace_id, due_date);
create index invoices_client_idx on public.invoices(client_id);
create trigger invoices_updated_at before update on public.invoices
  for each row execute function private.set_updated_at();

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  description text not null,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  rate numeric(12,2) not null default 0 check (rate >= 0),
  tax_rate numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  hsn_sac text,
  amount numeric(12,2) generated always as (round(quantity * rate, 2)) stored,
  position int not null default 0
);
create index invoice_items_invoice_idx on public.invoice_items(invoice_id);

create table public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  paid_on date not null default current_date,
  method public.payment_mode not null,
  reference_no text,
  notes text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index invoice_payments_invoice_idx on public.invoice_payments(invoice_id);
create index invoice_payments_ws_paid_idx on public.invoice_payments(workspace_id, paid_on);

-- Recalculate invoice totals whenever items or payments change.
create or replace function private.recalc_invoice(p_invoice uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_sub numeric(12,2);
  v_tax numeric(12,2);
  v_paid numeric(12,2);
  v_disc numeric(12,2);
begin
  select coalesce(sum(amount), 0), coalesce(sum(round(amount * tax_rate / 100, 2)), 0)
    into v_sub, v_tax
  from public.invoice_items where invoice_id = p_invoice;
  select coalesce(sum(amount), 0) into v_paid from public.invoice_payments where invoice_id = p_invoice;
  select discount_amount into v_disc from public.invoices where id = p_invoice;
  update public.invoices
  set subtotal = v_sub,
      tax_total = v_tax,
      total = greatest(0, v_sub + v_tax - coalesce(v_disc, 0)),
      amount_paid = v_paid,
      status = case
        when status = 'cancelled' then status
        when v_paid > 0 and v_paid >= greatest(0, v_sub + v_tax - coalesce(v_disc, 0)) then 'paid'
        when status = 'paid' then 'pending'
        else status
      end
  where id = p_invoice;
end;
$$;

create or replace function private.invoice_children_changed()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.recalc_invoice(coalesce(new.invoice_id, old.invoice_id));
  return null;
end;
$$;
create trigger invoice_items_recalc after insert or update or delete on public.invoice_items
  for each row execute function private.invoice_children_changed();
create trigger invoice_payments_recalc after insert or update or delete on public.invoice_payments
  for each row execute function private.invoice_children_changed();

create or replace function private.invoice_discount_changed()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.recalc_invoice(new.id);
  return null;
end;
$$;
create trigger invoices_discount_recalc after update of discount_amount on public.invoices
  for each row execute function private.invoice_discount_changed();

-- Overdue is derived, not stored: pending and past due date.
create or replace view public.invoices_with_status
with (security_invoker = true) as
  select i.*,
    case when i.status = 'pending' and i.due_date < current_date then 'overdue' else i.status end
      as display_status,
    greatest(0, i.total - i.amount_paid) as balance_due
  from public.invoices i;

-- ---------------------------------------------------------------------------
-- Ad Fund Management
-- ---------------------------------------------------------------------------
create table public.ad_fund_uploads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  platform text not null, -- meta, google, linkedin, ...
  amount numeric(12,2) not null check (amount > 0),
  -- company = agency cash, personal = fronted by a person (payer_name required),
  -- client = paid directly by the client, unused_fund = drawn from carryover.
  payer_type text not null check (payer_type in ('company', 'personal', 'client', 'unused_fund')),
  payer_name text,
  upload_date date not null default current_date,
  notes text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (payer_type <> 'personal' or coalesce(trim(payer_name), '') <> '')
);
create index ad_fund_uploads_client_idx on public.ad_fund_uploads(workspace_id, client_id, upload_date);
create trigger ad_fund_uploads_updated_at before update on public.ad_fund_uploads
  for each row execute function private.set_updated_at();

-- Money received from the client towards their ad fund.
create table public.ad_fund_collections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  received_on date not null default current_date,
  method public.payment_mode not null,
  reference_no text,
  notes text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ad_fund_collections_client_idx on public.ad_fund_collections(workspace_id, client_id, received_on);
create trigger ad_fund_collections_updated_at before update on public.ad_fund_collections
  for each row execute function private.set_updated_at();

-- Original Fund ledger (the CRUD tab): opening balances, carryovers, corrections.
create table public.ad_fund_adjustments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  year_month date not null check (extract(day from year_month) = 1), -- first day of the month
  kind text not null check (kind in ('opening_balance', 'carryover', 'correction')),
  amount numeric(12,2) not null, -- signed
  notes text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ad_fund_adjustments_client_idx on public.ad_fund_adjustments(workspace_id, client_id, year_month);
create trigger ad_fund_adjustments_updated_at before update on public.ad_fund_adjustments
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Notifications and activity feed
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade, -- null = platform notice
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null default 'info',
  title text not null,
  message text,
  link text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, is_read, created_at desc);

create table public.activity_logs (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,       -- created, updated, status_changed, deleted, ...
  entity_type text not null,  -- lead, client, work_item, invoice, ...
  entity_id uuid,
  summary text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index activity_logs_ws_idx on public.activity_logs(workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Cross-workspace reference guard: a row may only point at clients, work
-- items, forms, invoices and users of its own workspace.
-- ---------------------------------------------------------------------------
create or replace function private.same_workspace(p_table text, p_id uuid, p_ws uuid)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if p_id is null then
    return true;
  end if;
  execute format('select exists (select 1 from public.%I where id = $1 and workspace_id = $2)', p_table)
    into v_ok using p_id, p_ws;
  return v_ok;
end;
$$;

create or replace function private.is_member_of(p_user uuid, p_ws uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_user is null or exists (
    select 1 from public.workspace_members where user_id = p_user and workspace_id = p_ws
  );
$$;

create or replace function private.check_refs()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  j jsonb := to_jsonb(new);
  ref record;
begin
  for ref in
    select * from (values
      ('client_id', 'clients'), ('work_item_id', 'work_items'), ('form_id', 'lead_forms'),
      ('invoice_id', 'invoices'), ('recurring_bill_id', 'recurring_bills'),
      ('converted_client_id', 'clients')
    ) as t(col, tbl)
  loop
    if j ? ref.col and not private.same_workspace(ref.tbl, (j ->> ref.col)::uuid, new.workspace_id) then
      raise exception '% does not belong to this workspace.', ref.col;
    end if;
  end loop;
  for ref in
    select * from (values ('assigned_to'), ('user_id')) as t(col)
  loop
    if j ? ref.col and tg_table_name <> 'notifications'
       and not private.is_member_of((j ->> ref.col)::uuid, new.workspace_id) then
      raise exception '% is not a member of this workspace.', ref.col;
    end if;
  end loop;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'leads', 'work_items', 'work_item_assignees', 'time_entries', 'recurring_bills',
    'invoices', 'invoice_items', 'invoice_payments', 'ad_fund_uploads',
    'ad_fund_collections', 'ad_fund_adjustments'
  ] loop
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function private.check_refs()',
      t || '_refs', t);
  end loop;
end;
$$;

-- workspace_id never changes after insert.
create or replace function private.lock_workspace_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'workspace_id cannot be changed.';
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'workspace_settings', 'clients', 'lead_forms', 'leads', 'work_items', 'work_item_assignees',
    'time_entries', 'files', 'recurring_bills', 'invoices', 'invoice_items', 'invoice_payments',
    'ad_fund_uploads', 'ad_fund_collections', 'ad_fund_adjustments', 'notifications',
    'activity_logs', 'workspace_members', 'renewal_requests', 'subscription_payments'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.lock_workspace_id()',
      t || '_lock_ws', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'workspace_settings', 'clients', 'lead_forms', 'leads', 'work_items', 'work_item_assignees',
    'time_entries', 'files', 'recurring_bills', 'invoices', 'invoice_items', 'invoice_payments',
    'ad_fund_uploads', 'ad_fund_collections', 'ad_fund_adjustments', 'notifications', 'activity_logs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- Is the signed-in user assigned to this work item?
create or replace function public.is_assigned_to_work_item(p_work_item uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.work_item_assignees
    where work_item_id = p_work_item and user_id = (select auth.uid())
  );
$$;
revoke execute on function public.is_assigned_to_work_item(uuid) from public, anon;
grant execute on function public.is_assigned_to_work_item(uuid) to authenticated;

-- Workspace settings: everyone in the workspace reads; admins edit.
create policy ws_settings_read on public.workspace_settings for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_platform_admin());
create policy ws_settings_update on public.workspace_settings for update to authenticated
  using (public.can_admin_write(workspace_id)) with check (public.can_admin_write(workspace_id));

-- Clients: all members read (needed to label work); admins manage.
create policy clients_read on public.clients for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_platform_admin());
create policy clients_insert on public.clients for insert to authenticated
  with check (public.can_admin_write(workspace_id));
create policy clients_update on public.clients for update to authenticated
  using (public.can_admin_write(workspace_id)) with check (public.can_admin_write(workspace_id));
create policy clients_delete on public.clients for delete to authenticated
  using (public.can_admin_write(workspace_id));

-- Lead forms: admins manage. The public reads them only through get_public_form().
create policy lead_forms_read on public.lead_forms for select to authenticated
  using (public.is_workspace_admin(workspace_id) or public.is_platform_admin());
create policy lead_forms_write on public.lead_forms for all to authenticated
  using (public.can_admin_write(workspace_id, 'leads'))
  with check (public.can_admin_write(workspace_id, 'leads'));

-- Leads: admins see all; staff see leads assigned to them or created by them.
create policy leads_read on public.leads for select to authenticated
  using (
    public.is_workspace_admin(workspace_id) or public.is_platform_admin()
    or (public.is_workspace_member(workspace_id)
        and (assigned_to = (select auth.uid()) or created_by = (select auth.uid())))
  );
create policy leads_insert on public.leads for insert to authenticated
  with check (
    public.can_write(workspace_id, 'leads')
    and (public.is_workspace_admin(workspace_id) or assigned_to is null or assigned_to = (select auth.uid()))
  );
create policy leads_update on public.leads for update to authenticated
  using (
    public.can_write(workspace_id, 'leads')
    and (public.is_workspace_admin(workspace_id) or assigned_to = (select auth.uid()) or created_by = (select auth.uid()))
  )
  with check (
    public.can_write(workspace_id, 'leads')
    and (public.is_workspace_admin(workspace_id) or assigned_to = (select auth.uid()) or assigned_to is null)
  );
create policy leads_delete on public.leads for delete to authenticated
  using (public.can_admin_write(workspace_id, 'leads'));

-- Work items: admins see all; staff see items they are assigned to.
create policy work_items_read on public.work_items for select to authenticated
  using (
    public.is_workspace_admin(workspace_id) or public.is_platform_admin()
    or (public.is_workspace_member(workspace_id)
        and (public.is_assigned_to_work_item(id) or created_by = (select auth.uid())))
  );
create policy work_items_insert on public.work_items for insert to authenticated
  with check (public.can_admin_write(workspace_id, 'work'));
-- Staff can move their own items along (status, checklist); admins edit everything.
create policy work_items_update on public.work_items for update to authenticated
  using (
    public.can_admin_write(workspace_id, 'work')
    or (public.can_write(workspace_id, 'work') and public.is_assigned_to_work_item(id))
  )
  with check (
    public.can_admin_write(workspace_id, 'work')
    or (public.can_write(workspace_id, 'work') and public.is_assigned_to_work_item(id))
  );
create policy work_items_delete on public.work_items for delete to authenticated
  using (public.can_admin_write(workspace_id, 'work'));

-- Staff may only change status, checklist and position on their items.
create or replace function private.limit_staff_work_item_update()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or public.is_workspace_admin(new.workspace_id) then
    return new;
  end if;
  if (to_jsonb(new) - array['status', 'checklist', 'position', 'completed_at', 'updated_at'])
     is distinct from (to_jsonb(old) - array['status', 'checklist', 'position', 'completed_at', 'updated_at']) then
    raise exception 'Staff can only change the status and checklist of their work items.';
  end if;
  return new;
end;
$$;
create trigger work_items_staff_limit before update on public.work_items
  for each row execute function private.limit_staff_work_item_update();

create policy assignees_read on public.work_item_assignees for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_platform_admin());
create policy assignees_write on public.work_item_assignees for all to authenticated
  using (public.can_admin_write(workspace_id, 'work'))
  with check (public.can_admin_write(workspace_id, 'work'));

-- Time entries: people manage their own; admins see and fix everyone's.
create policy time_read on public.time_entries for select to authenticated
  using (
    public.is_workspace_admin(workspace_id) or public.is_platform_admin()
    or (public.is_workspace_member(workspace_id) and user_id = (select auth.uid()))
  );
create policy time_insert on public.time_entries for insert to authenticated
  with check (
    public.can_write(workspace_id, 'work')
    and (user_id = (select auth.uid()) or public.is_workspace_admin(workspace_id))
  );
create policy time_update on public.time_entries for update to authenticated
  using (
    public.can_write(workspace_id, 'work')
    and (user_id = (select auth.uid()) or public.is_workspace_admin(workspace_id))
  )
  with check (
    public.can_write(workspace_id, 'work')
    and (user_id = (select auth.uid()) or public.is_workspace_admin(workspace_id))
  );
create policy time_delete on public.time_entries for delete to authenticated
  using (public.can_admin_write(workspace_id, 'work'));

-- Files: members read; members upload; uploader or admins delete.
create policy files_read on public.files for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_platform_admin());
create policy files_insert on public.files for insert to authenticated
  with check (public.can_write(workspace_id) and uploaded_by = (select auth.uid()));
create policy files_delete on public.files for delete to authenticated
  using (
    public.can_write(workspace_id)
    and (uploaded_by = (select auth.uid()) or public.is_workspace_admin(workspace_id))
  );

-- Invoicing tables: admins only.
do $$
declare
  t text;
begin
  foreach t in array array['recurring_bills', 'invoices', 'invoice_items', 'invoice_payments'] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_workspace_admin(workspace_id) or public.is_platform_admin())',
      t || '_read', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.can_admin_write(workspace_id, %L)) with check (public.can_admin_write(workspace_id, %L))',
      t || '_write', t, 'invoicing', 'invoicing');
  end loop;
end;
$$;

-- Ad fund tables: admins only.
do $$
declare
  t text;
begin
  foreach t in array array['ad_fund_uploads', 'ad_fund_collections', 'ad_fund_adjustments'] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_workspace_admin(workspace_id) or public.is_platform_admin())',
      t || '_read', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.can_admin_write(workspace_id, %L)) with check (public.can_admin_write(workspace_id, %L))',
      t || '_write', t, 'ad_funds', 'ad_funds');
  end loop;
end;
$$;

-- Notifications: your own only.
create policy notifications_read on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

-- Activity feed: readable by the workspace's admins; written only by triggers.
create policy activity_read on public.activity_logs for select to authenticated
  using (public.is_workspace_admin(workspace_id) or public.is_platform_admin());

-- Enable Realtime for the live timer monitor and notification bell.
alter publication supabase_realtime add table public.time_entries, public.notifications;
