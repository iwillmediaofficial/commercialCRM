-- Workspace isolation tests.
-- Seeds two companies, signs in as different people and proves nobody can
-- read, change or delete another company's data. Everything runs in one
-- transaction and is rolled back at the end: the run always finishes with an
-- error whose message is either "ALL TESTS PASSED (n checks)" or "FAIL: ...".
--
-- Run it with the Supabase SQL editor, `psql`, or the Supabase MCP execute_sql tool.

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end $$;

create function pg_temp.as_service() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end $$;

create function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- The statement must fail (RLS, permission, trigger or constraint).
create function pg_temp.must_fail(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    return;
  end;
  raise exception 'FAIL: % (statement succeeded)', p_label;
end $$;

-- A count query must return exactly p_n.
create function pg_temp.must_count(p_sql text, p_n bigint, p_label text) returns void language plpgsql as $$
declare
  v bigint;
begin
  execute p_sql into v;
  if v is distinct from p_n then
    raise exception 'FAIL: % (expected %, got %)', p_label, p_n, v;
  end if;
end $$;

-- An UPDATE/DELETE must touch exactly p_n rows.
create function pg_temp.must_touch(p_sql text, p_n bigint, p_label text) returns void language plpgsql as $$
declare
  v bigint;
begin
  execute p_sql;
  get diagnostics v = row_count;
  if v <> p_n then
    raise exception 'FAIL: % (expected % rows changed, got %)', p_label, p_n, v;
  end if;
end $$;

create function pg_temp.must_pass(p_sql text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
exception when others then
  raise exception 'FAIL: % (%)', p_label, sqlerrm;
end $$;

do $test$
declare
  -- people
  a_owner uuid := gen_random_uuid();
  a_staff uuid := gen_random_uuid();
  b_owner uuid := gen_random_uuid();
  super_admin uuid := gen_random_uuid();
  -- data
  plan_pro uuid;
  plan_starter uuid;
  ws_a uuid;
  ws_b uuid;
  client_a uuid;
  client_b uuid;
  work_a uuid;
  lead_b uuid;
  form_a uuid;
  invoice_a uuid;
  v_slug text;
  v_pin jsonb;
  v_check jsonb;
  checks int := 0;
  t text;
begin
  perform pg_temp.as_postgres();

  -- Seed -------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email)
  values (a_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a-owner@test.local'),
         (a_staff, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a-staff@test.local'),
         (b_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b-owner@test.local'),
         (super_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'super@test.local');
  insert into public.platform_admins (user_id) values (super_admin);

  insert into public.plans (name, staff_limit, client_limit, modules, price_monthly)
  values ('TEST Pro', null, null, array['leads', 'work', 'invoicing', 'ad_funds'], 100) returning id into plan_pro;
  insert into public.plans (name, staff_limit, client_limit, modules, price_monthly)
  values ('TEST Starter', 2, 2, array['leads', 'work'], 50) returning id into plan_starter;

  insert into public.workspaces (name, slug, plan_id, valid_until)
  values ('Test A', 'test-a-' || substr(md5(random()::text), 1, 6), plan_pro, now() + interval '30 days') returning id into ws_a;
  insert into public.workspaces (name, slug, plan_id, valid_until)
  values ('Test B', 'test-b-' || substr(md5(random()::text), 1, 6), plan_starter, now() + interval '30 days') returning id into ws_b;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws_a, a_owner, 'owner'), (ws_a, a_staff, 'staff'), (ws_b, b_owner, 'owner');

  insert into public.clients (workspace_id, company_name) values (ws_a, 'A Client') returning id into client_a;
  insert into public.clients (workspace_id, company_name) values (ws_b, 'B Client') returning id into client_b;
  insert into public.leads (workspace_id, name, assigned_to) values (ws_a, 'A lead for staff', a_staff);
  insert into public.leads (workspace_id, name) values (ws_a, 'A lead unassigned');
  insert into public.leads (workspace_id, name) values (ws_b, 'B lead') returning id into lead_b;
  insert into public.work_items (workspace_id, title, client_id) values (ws_a, 'A work', client_a) returning id into work_a;
  insert into public.work_items (workspace_id, title) values (ws_a, 'A work not assigned');
  insert into public.work_item_assignees (work_item_id, user_id, workspace_id) values (work_a, a_staff, ws_a);
  insert into public.work_items (workspace_id, title, client_id) values (ws_b, 'B work', client_b);
  insert into public.invoices (workspace_id, client_id, due_date) values (ws_a, client_a, current_date + 10) returning id into invoice_a;
  insert into public.invoice_items (invoice_id, workspace_id, description, quantity, rate, tax_rate)
  values (invoice_a, ws_a, 'Retainer', 1, 1000, 18);
  insert into public.ad_fund_uploads (workspace_id, client_id, platform, amount, payer_type)
  values (ws_a, client_a, 'meta', 500, 'company');
  insert into public.files (workspace_id, entity_type, r2_key, file_name)
  values (ws_a, 'client', ws_a || '/clients/logo.png', 'logo.png');
  insert into public.lead_forms (workspace_id, slug, title)
  values (ws_a, 'form-' || substr(md5(random()::text), 1, 8), 'A form') returning id, slug into form_a, v_slug;

  -- Sanity: invoice totals and numbering ------------------------------------
  perform pg_temp.must_count(format($q$select count(*) from public.invoices where id = %L and total = 1180 and invoice_number = 'INV-0001'$q$, invoice_a), 1, 'invoice totals and number'); checks := checks + 1;

  -- Company A owner ----------------------------------------------------------
  perform pg_temp.as_user(a_owner);
  perform pg_temp.must_count('select count(*) from public.workspaces', 1, 'A owner sees only workspace A'); checks := checks + 1;
  perform pg_temp.must_count('select count(*) from public.clients', 1, 'A owner sees only A clients'); checks := checks + 1;
  perform pg_temp.must_count('select count(*) from public.leads', 2, 'A owner sees only A leads'); checks := checks + 1;
  perform pg_temp.must_count('select count(*) from public.work_items', 2, 'A owner sees only A work'); checks := checks + 1;
  perform pg_temp.must_count('select count(*) from public.workspace_members', 2, 'A owner sees only A team'); checks := checks + 1;
  perform pg_temp.must_count('select count(*) from public.invoices', 1, 'A owner sees A invoice'); checks := checks + 1;

  foreach t in array array['clients', 'leads', 'work_items', 'work_item_assignees', 'time_entries', 'files',
                           'invoices', 'invoice_items', 'invoice_payments', 'recurring_bills', 'ad_fund_uploads',
                           'ad_fund_collections', 'ad_fund_adjustments', 'lead_forms', 'activity_logs',
                           'workspace_settings', 'renewal_requests', 'subscription_payments', 'access_pins'] loop
    perform pg_temp.must_count(format('select count(*) from public.%I where workspace_id = %L', t, ws_b), 0,
                               'A owner reads nothing of B in ' || t);
    checks := checks + 1;
  end loop;

  perform pg_temp.must_fail(format($q$insert into public.clients (workspace_id, company_name) values (%L, 'x')$q$, ws_b), 'A owner inserts a client into B'); checks := checks + 1;
  perform pg_temp.must_touch(format($q$update public.clients set notes = 'hacked' where id = %L$q$, client_b), 0, 'A owner updates B client'); checks := checks + 1;
  perform pg_temp.must_touch(format($q$delete from public.leads where id = %L$q$, lead_b), 0, 'A owner deletes B lead'); checks := checks + 1;
  perform pg_temp.must_fail(format($q$update public.clients set workspace_id = %L where id = %L$q$, ws_b, client_a), 'A owner moves a client to B'); checks := checks + 1;
  perform pg_temp.must_fail(format($q$insert into public.work_items (workspace_id, title, client_id) values (%L, 'x', %L)$q$, ws_a, client_b), 'A work item points at B client'); checks := checks + 1;
  perform pg_temp.must_fail(format($q$insert into public.leads (workspace_id, name, assigned_to) values (%L, 'x', %L)$q$, ws_a, b_owner), 'A lead assigned to B owner'); checks := checks + 1;
  perform pg_temp.must_fail(format($q$insert into public.files (workspace_id, entity_type, r2_key, file_name, uploaded_by) values (%L, 'client', %L, 'x', %L)$q$, ws_a, ws_b || '/x', a_owner), 'A file stored under B folder'); checks := checks + 1;
  perform pg_temp.must_fail(format($q$select public.issue_access_pin('signup', %L, 'owner')$q$, ws_a), 'A owner issues an owner PIN'); checks := checks + 1;
  perform pg_temp.must_fail(format($q$select public.issue_access_pin('signup', %L, 'staff')$q$, ws_b), 'A owner issues a PIN for B'); checks := checks + 1;
  perform pg_temp.must_fail('select pin_hash from public.access_pins', 'A owner reads PIN hashes'); checks := checks + 1;
  -- The owner may be refused outright or the update may match no row; either way the date must not move.
  begin
    execute format($q$update public.workspaces set valid_until = now() + interval '10 years' where id = %L$q$, ws_a);
  exception when others then null;
  end;
  perform pg_temp.as_postgres();
  perform pg_temp.must_count(format($q$select count(*) from public.workspaces where id = %L and valid_until < now() + interval '1 year'$q$, ws_a), 1, 'A subscription unchanged'); checks := checks + 1;
  perform pg_temp.as_user(a_owner);
  perform pg_temp.must_fail(format($q$select public.approve_renewal(gen_random_uuid())$q$), 'A owner approves a renewal'); checks := checks + 1;
  perform pg_temp.must_pass(format($q$insert into public.renewal_requests (workspace_id, plan_id, period, amount, payment_mode, requested_by) values (%L, %L, 'monthly', 1, 'upi', %L)$q$, ws_a, plan_pro, a_owner), 'A owner requests a renewal'); checks := checks + 1;
  perform pg_temp.must_count(format($q$select count(*) from public.renewal_requests where workspace_id = %L and amount = 100$q$, ws_a), 1, 'renewal amount comes from the plan'); checks := checks + 1;

  -- Company A staff ----------------------------------------------------------
  perform pg_temp.as_user(a_staff);
  perform pg_temp.must_count('select count(*) from public.leads', 1, 'A staff sees only assigned lead'); checks := checks + 1;
  perform pg_temp.must_count('select count(*) from public.work_items', 1, 'A staff sees only assigned work'); checks := checks + 1;
  perform pg_temp.must_count('select count(*) from public.invoices', 0, 'A staff sees no invoices'); checks := checks + 1;
  perform pg_temp.must_count('select count(*) from public.ad_fund_uploads', 0, 'A staff sees no ad funds'); checks := checks + 1;
  perform pg_temp.must_fail(format($q$insert into public.clients (workspace_id, company_name) values (%L, 'x')$q$, ws_a), 'A staff adds a client'); checks := checks + 1;
  perform pg_temp.must_fail(format($q$update public.work_items set title = 'renamed' where id = %L$q$, work_a), 'A staff renames a work item'); checks := checks + 1;
  perform pg_temp.must_touch(format($q$update public.work_items set status = 'under_review' where id = %L$q$, work_a), 1, 'A staff moves own work item'); checks := checks + 1;
  perform pg_temp.must_pass(format($q$select public.start_timer(%L, %L)$q$, ws_a, work_a), 'A staff starts a timer'); checks := checks + 1;
  perform pg_temp.must_pass(format($q$select public.stop_timer(%L)$q$, ws_a), 'A staff stops the timer'); checks := checks + 1;
  perform pg_temp.must_touch(format($q$update public.workspace_members set role = 'admin' where user_id = %L$q$, a_staff), 0, 'A staff promotes self'); checks := checks + 1;

  -- Company B owner (Starter plan: no invoicing or ad funds, 2 seats, 2 clients) -
  perform pg_temp.as_user(b_owner);
  perform pg_temp.must_count('select count(*) from public.clients', 1, 'B owner sees only B client'); checks := checks + 1;
  perform pg_temp.must_count(format('select count(*) from public.time_entries where workspace_id = %L', ws_a), 0, 'B owner sees no A timers'); checks := checks + 1;
  perform pg_temp.must_fail(format($q$insert into public.ad_fund_uploads (workspace_id, client_id, platform, amount, payer_type) values (%L, %L, 'meta', 1, 'company')$q$, ws_b, client_b), 'B uses ad funds without the module'); checks := checks + 1;
  perform pg_temp.must_fail(format($q$insert into public.invoices (workspace_id, client_id, due_date) values (%L, %L, current_date)$q$, ws_b, client_b), 'B uses invoicing without the module'); checks := checks + 1;
  perform pg_temp.must_pass(format($q$insert into public.clients (workspace_id, company_name) values (%L, 'B second')$q$, ws_b), 'B adds a 2nd client'); checks := checks + 1;
  perform pg_temp.must_fail(format($q$insert into public.clients (workspace_id, company_name) values (%L, 'B third')$q$, ws_b), 'B exceeds client limit'); checks := checks + 1;

  -- Seat limit ----------------------------------------------------------------
  perform pg_temp.as_postgres();
  perform pg_temp.must_pass(format($q$insert into public.workspace_members (workspace_id, user_id, role) values (%L, %L, 'staff')$q$, ws_b, a_staff), 'B 2nd seat'); checks := checks + 1;
  perform pg_temp.must_fail(format($q$insert into public.workspace_members (workspace_id, user_id, role) values (%L, %L, 'staff')$q$, ws_b, super_admin), 'B exceeds seat limit'); checks := checks + 1;
  execute format('update public.workspace_members set is_active = false where workspace_id = %L and user_id = %L', ws_b, a_staff);

  -- Expired and suspended -----------------------------------------------------
  execute format($q$update public.workspaces set valid_until = now() - interval '30 days' where id = %L$q$, ws_b);
  perform pg_temp.as_user(b_owner);
  perform pg_temp.must_count('select count(*) from public.clients', 2, 'expired B can still read'); checks := checks + 1;
  perform pg_temp.must_touch(format($q$update public.clients set notes = 'x' where workspace_id = %L$q$, ws_b), 0, 'expired B cannot edit'); checks := checks + 1;
  perform pg_temp.as_postgres();
  execute format($q$update public.workspaces set valid_until = now() - interval '1 day' where id = %L$q$, ws_b);
  perform pg_temp.as_user(b_owner);
  perform pg_temp.must_touch(format($q$update public.clients set notes = 'x' where workspace_id = %L$q$, ws_b), 2, 'B in grace can edit'); checks := checks + 1;
  perform pg_temp.as_postgres();
  execute format($q$update public.workspaces set state = 'suspended', valid_until = now() + interval '30 days' where id = %L$q$, ws_a);
  perform pg_temp.as_user(a_owner);
  perform pg_temp.must_touch(format($q$update public.clients set notes = 'x' where workspace_id = %L$q$, ws_a), 0, 'suspended A cannot edit'); checks := checks + 1;
  perform pg_temp.as_postgres();
  execute format($q$update public.workspaces set state = 'active' where id = %L$q$, ws_a);

  -- Anonymous visitors -----------------------------------------------------------
  perform pg_temp.as_anon();
  perform pg_temp.must_fail('select count(*) from public.leads', 'anon reads leads'); checks := checks + 1;
  perform pg_temp.must_fail('select count(*) from public.workspaces', 'anon reads workspaces'); checks := checks + 1;
  perform pg_temp.must_fail('select count(*) from public.lead_forms', 'anon reads lead_forms table'); checks := checks + 1;
  perform pg_temp.must_pass(format($q$select public.get_public_form(%L)$q$, v_slug), 'anon loads a form'); checks := checks + 1;
  perform pg_temp.must_pass(format($q$select public.submit_public_lead(%L, 'Visitor', '9999999999')$q$, v_slug), 'anon submits a lead form'); checks := checks + 1;
  perform pg_temp.as_postgres();
  perform pg_temp.must_count(format($q$select count(*) from public.leads where workspace_id = %L and form_id = %L$q$, ws_a, form_a), 1, 'form lead lands in A'); checks := checks + 1;
  perform pg_temp.as_anon();
  perform pg_temp.must_fail(format($q$select public.issue_access_pin('signup', %L, 'staff')$q$, ws_a), 'anon issues a PIN'); checks := checks + 1;
  perform pg_temp.must_fail($q$select public.pin_check('AAAAAAAA', 'x@y.z', 'signup', 'ip')$q$, 'anon calls pin_check'); checks := checks + 1;

  -- Super Admin -------------------------------------------------------------------
  perform pg_temp.as_user(super_admin);
  perform pg_temp.must_count('select count(*) from public.workspaces where name like ''Test %''', 2, 'Super Admin sees both test workspaces'); checks := checks + 1;
  perform pg_temp.must_fail(format($q$insert into public.clients (workspace_id, company_name) values (%L, 'x')$q$, ws_a), 'Super Admin writes into a workspace without joining'); checks := checks + 1;
  v_pin := public.issue_access_pin('signup', ws_a, 'staff', 'new-staff@test.local');
  checks := checks + 1;

  -- PIN sign-up flow (as the Edge Function's service role) -------------------------
  perform pg_temp.as_service();
  v_check := public.pin_check('WRONGPIN', 'new-staff@test.local', 'signup', 'test-ip');
  if (v_check ->> 'ok')::boolean then raise exception 'FAIL: wrong PIN accepted'; end if; checks := checks + 1;
  v_check := public.pin_check(v_pin ->> 'pin', 'someone-else@test.local', 'signup', 'test-ip-2');
  if (v_check ->> 'ok')::boolean then raise exception 'FAIL: email-locked PIN accepted for another email'; end if; checks := checks + 1;
  v_check := public.pin_check(v_pin ->> 'pin', 'new-staff@test.local', 'signup', 'test-ip-3');
  if not (v_check ->> 'ok')::boolean then raise exception 'FAIL: valid PIN rejected: %', v_check; end if; checks := checks + 1;
  perform pg_temp.as_postgres();
  insert into auth.users (id, instance_id, aud, role, email)
  values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'new-staff@test.local');
  perform pg_temp.as_service();
  perform public.pin_consume((v_check ->> 'pin_id')::uuid, '11111111-1111-1111-1111-111111111111', 'new-staff@test.local', 'New Staff');
  v_check := public.pin_check(v_pin ->> 'pin', 'new-staff@test.local', 'signup', 'test-ip-4');
  if (v_check ->> 'ok')::boolean then raise exception 'FAIL: used PIN accepted again'; end if; checks := checks + 1;
  perform pg_temp.as_postgres();
  perform pg_temp.must_count(format($q$select count(*) from public.workspace_members where workspace_id = %L and user_id = '11111111-1111-1111-1111-111111111111' and role = 'staff'$q$, ws_a), 1, 'PIN sign-up joined A as staff'); checks := checks + 1;

  -- Lockout after 5 failures
  perform pg_temp.as_service();
  for i in 1..5 loop
    perform public.pin_check('BADBAD' || i, 'locked@test.local', 'signup', 'lock-ip');
  end loop;
  v_check := public.pin_check('ANYTHING', 'locked@test.local', 'signup', 'other-ip');
  if v_check ->> 'error' <> 'too_many_attempts' then raise exception 'FAIL: no lockout after 5 failures (%)', v_check; end if; checks := checks + 1;

  perform pg_temp.as_postgres();
  raise exception 'ALL TESTS PASSED (% checks)', checks;
end
$test$;
