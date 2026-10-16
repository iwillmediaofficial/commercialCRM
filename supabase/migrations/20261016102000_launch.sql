-- Phase 4, launch readiness:
--   * seller and GST details for subscription invoices, plus product/support info
--   * a GST invoice (number + frozen snapshot) on every subscription payment
--   * a public site-info function for the landing page (no bank details)
--   * client error log for the Super Admin
--   * demo workspaces filled with sample data

-- ---------------------------------------------------------------------------
-- Platform settings
-- ---------------------------------------------------------------------------
alter table public.platform_settings
  add column product_name text not null default 'Agency CRM',
  add column support_email text,
  add column support_phone text,
  add column seller_legal_name text,
  add column seller_address text,
  add column seller_state text,
  add column seller_gstin text,
  add column seller_pan text,
  add column sac_code text not null default '997331',
  add column gst_rate numeric(5,2) not null default 18 check (gst_rate between 0 and 28),
  add column sub_invoice_prefix text not null default 'SUB',
  add column legal_updated_on date not null default current_date;

-- GST state codes, so place of supply can be worked out from a state name.
create table private.gst_states (code text primary key, name text not null);
insert into private.gst_states (code, name) values
  ('01','Jammu and Kashmir'),('02','Himachal Pradesh'),('03','Punjab'),('04','Chandigarh'),
  ('05','Uttarakhand'),('06','Haryana'),('07','Delhi'),('08','Rajasthan'),('09','Uttar Pradesh'),
  ('10','Bihar'),('11','Sikkim'),('12','Arunachal Pradesh'),('13','Nagaland'),('14','Manipur'),
  ('15','Mizoram'),('16','Tripura'),('17','Meghalaya'),('18','Assam'),('19','West Bengal'),
  ('20','Jharkhand'),('21','Odisha'),('22','Chhattisgarh'),('23','Madhya Pradesh'),('24','Gujarat'),
  ('26','Dadra and Nagar Haveli and Daman and Diu'),('27','Maharashtra'),('29','Karnataka'),
  ('30','Goa'),('31','Lakshadweep'),('32','Kerala'),('33','Tamil Nadu'),('34','Puducherry'),
  ('35','Andaman and Nicobar Islands'),('36','Telangana'),('37','Andhra Pradesh'),('38','Ladakh');

-- A GSTIN starts with the state code; otherwise match the state name.
create or replace function private.gst_state_code(p_gstin text, p_state text)
returns text
language sql stable
set search_path = ''
as $$
  select coalesce(
    case when p_gstin ~ '^[0-9]{2}[A-Za-z0-9]{13}$' then left(p_gstin, 2) end,
    (select code from private.gst_states
      where lower(regexp_replace(name, '[^a-zA-Z]', '', 'g')) = lower(regexp_replace(coalesce(p_state, ''), '[^a-zA-Z]', '', 'g'))
        and coalesce(p_state, '') <> ''
      limit 1)
  );
$$;

-- ---------------------------------------------------------------------------
-- Subscription invoices
-- ---------------------------------------------------------------------------
alter table public.subscription_payments
  add column invoice_no text unique,
  add column invoice jsonb;

create table private.sub_invoice_counters (fy text primary key, last_no int not null);

-- Indian financial year label for a date, e.g. 2026-27.
create or replace function private.financial_year(p date)
returns text
language sql immutable
set search_path = ''
as $$
  select case when extract(month from p) >= 4
    then extract(year from p)::int || '-' || lpad(((extract(year from p)::int + 1) % 100)::text, 2, '0')
    else (extract(year from p)::int - 1) || '-' || lpad((extract(year from p)::int % 100)::text, 2, '0')
  end;
$$;

-- Numbers every payment and freezes seller, buyer and tax split at that moment,
-- so later edits to settings never change an issued invoice. The amount paid is
-- the invoice total (plan prices include GST).
create or replace function private.fill_subscription_invoice(p public.subscription_payments)
returns public.subscription_payments
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.platform_settings;
  b public.workspace_settings;
  w public.workspaces;
  v_fy text;
  v_no int;
  v_seller_code text;
  v_buyer_code text;
  v_registered boolean;
  v_rate numeric;
  v_taxable numeric(12,2);
  v_tax numeric(12,2);
  v_cgst numeric(12,2) := 0;
  v_sgst numeric(12,2) := 0;
  v_igst numeric(12,2) := 0;
  v_plan text;
begin
  if p.invoice_no is not null then
    return p;
  end if;
  select * into s from public.platform_settings limit 1;
  select * into b from public.workspace_settings where workspace_id = p.workspace_id;
  select * into w from public.workspaces where id = p.workspace_id;
  select name into v_plan from public.plans where id = p.plan_id;

  v_fy := private.financial_year(p.paid_on);
  insert into private.sub_invoice_counters as c (fy, last_no) values (v_fy, 1)
  on conflict (fy) do update set last_no = c.last_no + 1
  returning last_no into v_no;
  p.invoice_no := coalesce(nullif(trim(s.sub_invoice_prefix), ''), 'SUB') || '/' || v_fy || '/' || lpad(v_no::text, 4, '0');

  v_registered := coalesce(trim(s.seller_gstin), '') <> '';
  v_rate := case when v_registered then s.gst_rate else 0 end;
  v_seller_code := private.gst_state_code(s.seller_gstin, s.seller_state);
  v_buyer_code := coalesce(private.gst_state_code(b.gstin, b.state), v_seller_code);
  v_taxable := round(p.amount * 100 / (100 + v_rate), 2);
  v_tax := p.amount - v_taxable;
  if v_tax > 0 then
    if v_seller_code is not null and v_buyer_code <> v_seller_code then
      v_igst := v_tax;
    else
      v_cgst := round(v_tax / 2, 2);
      v_sgst := v_tax - v_cgst;
    end if;
  end if;

  p.invoice := jsonb_build_object(
    'date', p.paid_on,
    'registered', v_registered,
    'seller', jsonb_build_object(
      'name', coalesce(nullif(trim(s.seller_legal_name), ''), s.product_name),
      'product', s.product_name,
      'address', s.seller_address,
      'state', s.seller_state,
      'state_code', v_seller_code,
      'gstin', nullif(trim(s.seller_gstin), ''),
      'pan', nullif(trim(s.seller_pan), ''),
      'email', s.support_email,
      'phone', s.support_phone),
    'buyer', jsonb_build_object(
      'name', coalesce(nullif(trim(b.legal_name), ''), nullif(trim(b.company_name), ''), w.name),
      'address', concat_ws(', ', nullif(trim(b.address), ''), nullif(trim(b.city), ''), nullif(trim(b.state), ''), nullif(trim(b.postal_code), '')),
      'state', b.state,
      'state_code', v_buyer_code,
      'gstin', nullif(trim(b.gstin), ''),
      'email', coalesce(b.email, w.owner_email),
      'phone', coalesce(b.phone, w.owner_phone)),
    'line', jsonb_build_object(
      'description', coalesce(v_plan, 'Subscription') || ' plan subscription'
        || coalesce(' (' || replace(p.period::text, '_', '-') || ')', ''),
      'period_from', p.valid_from,
      'period_to', p.valid_until,
      'sac', s.sac_code),
    'rate', v_rate,
    'taxable', v_taxable,
    'cgst', v_cgst,
    'sgst', v_sgst,
    'igst', v_igst,
    'total', p.amount,
    'payment_mode', p.payment_mode,
    'reference_no', p.reference_no);
  return p;
end;
$$;

create or replace function private.subscription_invoice()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  return private.fill_subscription_invoice(new);
end;
$$;

create trigger subscription_payments_invoice before insert on public.subscription_payments
  for each row execute function private.subscription_invoice();

-- Give the payments already recorded an invoice too, oldest first.
do $$
declare
  r public.subscription_payments;
begin
  for r in select * from public.subscription_payments where invoice_no is null order by paid_on, created_at loop
    r := private.fill_subscription_invoice(r);
    update public.subscription_payments set invoice_no = r.invoice_no, invoice = r.invoice where id = r.id;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Landing page info, readable without signing in. No bank or payment details.
-- ---------------------------------------------------------------------------
create or replace function public.public_site_info()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'product_name', s.product_name,
    'support_email', s.support_email,
    'support_phone', s.support_phone,
    'seller_name', coalesce(nullif(trim(s.seller_legal_name), ''), s.product_name),
    'seller_address', s.seller_address,
    'seller_gstin', nullif(trim(s.seller_gstin), ''),
    'trial_days', s.trial_days,
    'grace_days', s.grace_days,
    'legal_updated_on', s.legal_updated_on,
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', p.name, 'description', p.description,
        'price_monthly', p.price_monthly, 'price_quarterly', p.price_quarterly,
        'price_half_yearly', p.price_half_yearly, 'price_yearly', p.price_yearly,
        'staff_limit', p.staff_limit, 'client_limit', p.client_limit, 'modules', p.modules
      ) order by p.sort_order, p.price_monthly nulls last)
      from public.plans p where p.is_active), '[]'::jsonb))
  from public.platform_settings s
  limit 1;
$$;
revoke execute on function public.public_site_info() from public;
grant execute on function public.public_site_info() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Error log: the app reports crashes here; only the Super Admin reads them.
-- ---------------------------------------------------------------------------
create table public.app_errors (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  workspace_id uuid references public.workspaces(id) on delete set null,
  source text not null default 'app',
  message text not null,
  stack text,
  url text,
  user_agent text,
  app_version text
);
create index app_errors_created_idx on public.app_errors(created_at desc);
create index app_errors_user_idx on public.app_errors(user_id);
create index app_errors_ws_idx on public.app_errors(workspace_id);
alter table public.app_errors enable row level security;
create policy app_errors_read on public.app_errors for select to authenticated
  using (public.is_platform_admin());
create policy app_errors_clear on public.app_errors for delete to authenticated
  using (public.is_platform_admin());

-- Anyone may report (sign-in pages crash too), with sizes capped and a flood
-- limit so a broken loop or a stranger can't fill the table.
create or replace function public.log_client_error(
  p_message text,
  p_stack text default null,
  p_url text default null,
  p_user_agent text default null,
  p_workspace_id uuid default null,
  p_app_version text default null
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if coalesce(trim(p_message), '') = '' then
    return;
  end if;
  if (select count(*) from public.app_errors where created_at > now() - interval '1 hour') >= 1000 then
    return;
  end if;
  if (select count(*) from public.app_errors
      where created_at > now() - interval '10 minutes'
        and user_id is not distinct from v_user
        and message = left(p_message, 1000)) >= 5 then
    return;
  end if;
  insert into public.app_errors (user_id, workspace_id, message, stack, url, user_agent, app_version)
  values (
    v_user,
    case when p_workspace_id is not null and v_user is not null and public.is_workspace_member(p_workspace_id)
      then p_workspace_id end,
    left(p_message, 1000), left(p_stack, 4000), left(p_url, 500), left(p_user_agent, 300), left(p_app_version, 40));
end;
$$;
revoke execute on function public.log_client_error(text, text, text, text, uuid, text) from public;
grant execute on function public.log_client_error(text, text, text, text, uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Demo workspaces for showing prospects
-- ---------------------------------------------------------------------------
alter table public.workspaces add column is_demo boolean not null default false;

create or replace function private.seed_demo_data(p_ws uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  c uuid[];
  v_inv uuid;
  m date := date_trunc('month', current_date)::date;
  i int;
begin
  update public.workspace_settings
  set legal_name = 'Brightside Digital Pvt Ltd', address = '42, MG Road', city = 'Bengaluru',
      state = 'Karnataka', postal_code = '560001', phone = '+91 98450 00000',
      email = 'hello@brightside.example', website = 'https://brightside.example'
  where workspace_id = p_ws;

  with ins as (
    insert into public.clients (workspace_id, company_name, contact_person, email, phone, status, is_dm_client, monthly_ad_target, ad_platforms, notes)
    values
      (p_ws, 'Green Leaf Cafe', 'Anita Rao', 'anita@greenleaf.example', '+91 90000 11111', 'active', true, 40000, '{meta,google}', 'Instagram and Google Ads for three outlets.'),
      (p_ws, 'Urban Fit Gym', 'Rohit Mehta', 'rohit@urbanfit.example', '+91 90000 22222', 'active', true, 25000, '{meta}', 'Lead ads for memberships.'),
      (p_ws, 'Sunrise Dental Clinic', 'Dr. Kavya Iyer', 'kavya@sunrise.example', '+91 90000 33333', 'active', true, 15000, '{google}', 'Search ads, local SEO.'),
      (p_ws, 'Nova Interiors', 'Sameer Khan', 'sameer@nova.example', '+91 90000 44444', 'active', false, 0, '{}', 'Website redesign project.'),
      (p_ws, 'Kiran Textiles', 'Kiran Patel', 'kiran@kirantex.example', '+91 90000 55555', 'active', true, 30000, '{meta,google}', 'Festive season campaigns.')
    returning id, company_name
  )
  select array_agg(id order by company_name) into c from ins;
  -- c: 1 Green Leaf, 2 Kiran Textiles, 3 Nova Interiors, 4 Sunrise Dental, 5 Urban Fit

  insert into public.leads (workspace_id, name, phone, email, company, source, stage, value, score, notes, follow_up_date)
  values
    (p_ws, 'Priya Sharma', '+91 91111 00001', 'priya@bakehouse.example', 'The Bake House', 'Meta Ads', 'new', 20000, 60, 'Wants Instagram growth.', current_date + 1),
    (p_ws, 'Arjun Nair', '+91 91111 00002', 'arjun@zoomauto.example', 'Zoom Auto', 'Website', 'contacted', 45000, 70, 'Asked for a call on Monday.', current_date + 3),
    (p_ws, 'Meera Joshi', '+91 91111 00003', null, 'Petals Florist', 'Referral', 'qualified', 15000, 80, 'Referred by Green Leaf Cafe.', current_date + 2),
    (p_ws, 'Vikram Singh', '+91 91111 00004', 'vikram@peakrealty.example', 'Peak Realty', 'Cold Call', 'proposal_sent', 90000, 75, 'Proposal sent for lead generation.', current_date + 5),
    (p_ws, 'Neha Gupta', '+91 91111 00005', 'neha@styleloft.example', 'Style Loft', 'Meta Ads', 'won', 30000, 90, 'Signed for 6 months.', null),
    (p_ws, 'Rahul Verma', '+91 91111 00006', null, 'Crisp Laundry', 'Website', 'lost', 10000, 30, 'Went with a freelancer.', null);

  insert into public.work_items (workspace_id, title, description, client_id, status, priority, start_date, due_date, estimated_hours, is_billable, billable_amount, position, checklist)
  values
    (p_ws, 'October social media calendar', 'Plan 20 posts and 8 reels.', c[1], 'in_progress', 'high', m, m + 9, 12, false, null, 1,
      '[{"text":"Draft post ideas","done":true},{"text":"Design creatives","done":false},{"text":"Client approval","done":false}]'),
    (p_ws, 'Membership lead ad campaign', 'New Meta lead form campaign.', c[5], 'under_review', 'urgent', m, current_date + 1, 6, false, null, 2, '[]'),
    (p_ws, 'Website redesign', 'Five-page site with a booking form.', c[3], 'in_progress', 'medium', m - 20, current_date + 14, 40, true, 60000, 3,
      '[{"text":"Wireframes","done":true},{"text":"Homepage design","done":true},{"text":"Development","done":false}]'),
    (p_ws, 'Google Ads keyword review', null, c[4], 'backlog', 'low', null, current_date + 10, 3, false, null, 4, '[]'),
    (p_ws, 'Festive catalogue shoot', 'Product photos for Diwali.', c[2], 'backlog', 'high', null, current_date + 7, 8, true, 25000, 5, '[]'),
    (p_ws, 'Monthly performance report', null, c[1], 'completed', 'medium', m - 25, m - 20, 4, false, null, 6, '[]');

  insert into public.recurring_bills (workspace_id, client_id, title, amount, tax_rate, frequency, billing_day, start_date, next_run_date)
  values
    (p_ws, c[1], 'Social media management retainer', 35000, 18, 'monthly', 1, m, (m + interval '1 month')::date),
    (p_ws, c[5], 'Ad management retainer', 20000, 18, 'monthly', 5, m, (m + interval '1 month' + interval '4 days')::date);

  -- Three months of invoices: paid, part-paid, pending and one overdue.
  for i in 0..2 loop
    insert into public.invoices (workspace_id, invoice_number, client_id, issue_date, due_date, status, place_of_supply)
    values (p_ws, '', c[1], (m - make_interval(months => i))::date, (m - make_interval(months => i))::date + 15,
            'pending', 'Karnataka')
    returning id into v_inv;
    insert into public.invoice_items (invoice_id, workspace_id, description, quantity, rate, tax_rate, hsn_sac)
    values (v_inv, p_ws, 'Social media management', 1, 35000, 18, '998361');
    if i > 0 then
      insert into public.invoice_payments (invoice_id, workspace_id, amount, paid_on, method, reference_no)
      values (v_inv, p_ws, 41300, (m - make_interval(months => i))::date + 10, 'upi', 'UPI' || (4410 + i));
    end if;
  end loop;

  insert into public.invoices (workspace_id, invoice_number, client_id, issue_date, due_date, status, place_of_supply)
  values (p_ws, '', c[3], m - 20, m - 5, 'pending', 'Karnataka')
  returning id into v_inv;
  insert into public.invoice_items (invoice_id, workspace_id, description, quantity, rate, tax_rate, hsn_sac, position)
  values (v_inv, p_ws, 'Website redesign, first milestone', 1, 30000, 18, '998314', 0);

  insert into public.invoices (workspace_id, invoice_number, client_id, issue_date, due_date, status, place_of_supply)
  values (p_ws, '', c[5], m - 30, m - 15, 'pending', 'Karnataka')
  returning id into v_inv;
  insert into public.invoice_items (invoice_id, workspace_id, description, quantity, rate, tax_rate, hsn_sac)
  values (v_inv, p_ws, 'Ad management, last month', 1, 20000, 18, '998366');
  insert into public.invoice_payments (invoice_id, workspace_id, amount, paid_on, method, reference_no)
  values (v_inv, p_ws, 10000, m - 10, 'bank_transfer', 'NEFT 7781');

  -- Ad funds: collections from clients and spends this month and last.
  insert into public.ad_fund_collections (workspace_id, client_id, amount, received_on, method, reference_no)
  values
    (p_ws, c[1], 40000, m - 28, 'upi', 'UPI 9001'),
    (p_ws, c[1], 40000, least(current_date, m + 1), 'upi', 'UPI 9002'),
    (p_ws, c[5], 25000, least(current_date, m + 2), 'bank_transfer', 'NEFT 5521'),
    (p_ws, c[2], 30000, least(current_date, m + 1), 'upi', 'UPI 9010');
  insert into public.ad_fund_uploads (workspace_id, client_id, platform, amount, payer_type, payer_name, upload_date)
  values
    (p_ws, c[1], 'meta', 20000, 'company', null, m - 25),
    (p_ws, c[1], 'google', 18000, 'company', null, m - 15),
    (p_ws, c[1], 'meta', 15000, 'company', null, least(current_date, m + 3)),
    (p_ws, c[5], 'meta', 12000, 'personal', 'Rohit (agency)', least(current_date, m + 4)),
    (p_ws, c[4], 'google', 8000, 'client', null, least(current_date, m + 2)),
    (p_ws, c[2], 'meta', 10000, 'company', null, least(current_date, m + 2));
end;
$$;

-- Creates a demo company on the plan with the most modules, active for a year,
-- filled with sample data, and returns an owner PIN for whoever will run demos.
create or replace function public.admin_create_demo_workspace(
  p_name text default 'Brightside Digital (Demo)',
  p_owner_email text default null,
  p_owner_name text default 'Demo Owner'
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_plan uuid;
  v_slug text;
  v_pin jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Only the Super Admin can create demo companies.';
  end if;
  select id into v_plan from public.plans
  order by cardinality(modules) desc, client_limit desc nulls first, sort_order desc
  limit 1;
  v_slug := 'demo-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  insert into public.workspaces (name, slug, plan_id, state, valid_until, owner_name, owner_email, is_demo, created_by, notes)
  values (coalesce(nullif(trim(p_name), ''), 'Demo company'), v_slug, v_plan, 'active', now() + interval '1 year',
          p_owner_name, nullif(lower(trim(p_owner_email)), ''), true, (select auth.uid()),
          'Demo company with sample data. Not a customer.')
  returning id into v_ws;

  perform private.seed_demo_data(v_ws);

  insert into public.admin_audit_log (actor_id, workspace_id, action, details)
  values ((select auth.uid()), v_ws, 'demo_workspace_created', jsonb_build_object('plan_id', v_plan));

  v_pin := public.issue_access_pin('signup', v_ws, 'owner', p_owner_email, null, 30, p_owner_name, null);
  return jsonb_build_object('workspace_id', v_ws, 'slug', v_slug, 'owner_pin', v_pin);
end;
$$;
revoke execute on function public.admin_create_demo_workspace(text, text, text) from public, anon;
grant execute on function public.admin_create_demo_workspace(text, text, text) to authenticated;
