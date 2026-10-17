-- Fixes from the QA report of 17 Oct 2026. Each block names the report item.

-- ---------------------------------------------------------------------------
-- 1.2 Only the Super Admin can switch the owner off.
-- ---------------------------------------------------------------------------
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
    if old.role = 'owner' and new.is_active <> old.is_active then
      raise exception 'Only the Super Admin can switch off the company owner.';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1.4 People edit their name, phone and photo; the email always matches the login.
-- ---------------------------------------------------------------------------
revoke update on public.profiles from authenticated;
grant update (full_name, phone, designation, department, avatar_path) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 1.5 Members can read their own company's plan even after it is retired.
-- ---------------------------------------------------------------------------
drop policy plans_read on public.plans;
create policy plans_read on public.plans for select to authenticated
  using (
    is_active
    or public.is_platform_admin()
    or exists (select 1 from public.workspaces w where w.plan_id = plans.id and public.is_workspace_member(w.id))
  );

-- ---------------------------------------------------------------------------
-- 2.1 / SA-10 Names can't be blank (spaces only).
-- ---------------------------------------------------------------------------
create or replace function private.require_name()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v text := to_jsonb(new) ->> tg_argv[0];
begin
  if coalesce(btrim(v), '') = '' then
    raise exception '% is required.', tg_argv[1] using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger workspaces_require_name before insert or update of name on public.workspaces
  for each row execute function private.require_name('name', 'Company name');
create trigger clients_require_name before insert or update of company_name on public.clients
  for each row execute function private.require_name('company_name', 'Client name');
create trigger leads_require_name before insert or update of name on public.leads
  for each row execute function private.require_name('name', 'Lead name');
create trigger work_items_require_title before insert or update of title on public.work_items
  for each row execute function private.require_name('title', 'Title');
create trigger plans_require_name before insert or update of name on public.plans
  for each row execute function private.require_name('name', 'Plan name');

-- ---------------------------------------------------------------------------
-- 2.3 Drafts have no number; the next number is given when the invoice is sent.
-- ---------------------------------------------------------------------------
alter table public.invoices drop constraint if exists invoices_number_present;

create or replace function private.invoice_number_default()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if coalesce(btrim(new.invoice_number), '') = '' then
    new.invoice_number := null;
    if new.status <> 'draft' then
      new.invoice_number := private.next_invoice_number(new.workspace_id);
    end if;
  end if;
  return new;
end;
$$;
drop trigger invoices_number on public.invoices;
create trigger invoices_number before insert or update of status, invoice_number on public.invoices
  for each row execute function private.invoice_number_default();

-- The next number skips numbers already used (for example typed by hand)...
create or replace function private.next_invoice_number(p_ws uuid)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_prefix text;
  v_n int;
begin
  loop
    update public.workspace_settings
    set next_invoice_number = next_invoice_number + 1
    where workspace_id = p_ws
    returning invoice_prefix, next_invoice_number - 1 into v_prefix, v_n;
    exit when not exists (
      select 1 from public.invoices where workspace_id = p_ws and invoice_number = v_prefix || lpad(v_n::text, 4, '0'));
  end loop;
  return v_prefix || lpad(v_n::text, 4, '0');
end;
$$;

-- ...and can't be set back to one already used.
create or replace function private.guard_next_invoice_number()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_max int;
begin
  if new.next_invoice_number >= old.next_invoice_number and new.invoice_prefix = old.invoice_prefix then
    return new;
  end if;
  select max(substr(invoice_number, length(new.invoice_prefix) + 1)::int) into v_max
  from public.invoices
  where workspace_id = new.workspace_id
    and left(invoice_number, length(new.invoice_prefix)) = new.invoice_prefix
    and substr(invoice_number, length(new.invoice_prefix) + 1) ~ '^[0-9]{1,9}$';
  if v_max is not null and new.next_invoice_number <= v_max then
    raise exception '%', format('Invoice %s is already used, so the next number must be %s or higher.',
                                new.invoice_prefix || lpad(v_max::text, 4, '0'), v_max + 1)
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger workspace_settings_invoice_number before update of next_invoice_number, invoice_prefix on public.workspace_settings
  for each row execute function private.guard_next_invoice_number();

-- ---------------------------------------------------------------------------
-- 2.2 / IN-12 / invoice edit: a sent invoice needs a value, and payments can't
-- be more than the total. Checked when the save finishes, so lines added in the
-- same save count.
-- ---------------------------------------------------------------------------
create or replace function private.check_invoice_totals()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  i public.invoices;
begin
  select * into i from public.invoices where id = new.id;
  if i.id is null then
    return null;
  end if;
  if i.status in ('pending', 'paid') and i.subtotal <= 0 and i.recurring_bill_id is null then
    raise exception 'Add at least one line with a rate above ₹0 before sending the invoice.' using errcode = 'P0001';
  end if;
  if i.amount_paid > i.total then
    raise exception '%', format('Payments recorded (₹%s) are more than the invoice total (₹%s).', i.amount_paid, i.total)
      using errcode = 'P0001';
  end if;
  return null;
end;
$$;
create constraint trigger invoices_totals_check after insert or update on public.invoices
  deferrable initially deferred
  for each row execute function private.check_invoice_totals();

create or replace function private.check_invoice_payment()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  i public.invoices;
  v_other numeric;
begin
  select * into i from public.invoices where id = new.invoice_id;
  if i.status = 'cancelled' then
    raise exception 'This invoice is cancelled, so it can''t take payments.' using errcode = 'P0001';
  end if;
  select coalesce(sum(amount), 0) into v_other from public.invoice_payments
  where invoice_id = new.invoice_id and id <> new.id;
  if v_other + new.amount > i.total then
    raise exception '%', format('This is more than the balance due (₹%s).', greatest(0, i.total - v_other))
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger invoice_payments_check before insert or update of amount on public.invoice_payments
  for each row execute function private.check_invoice_payment();

-- A retainer needs an amount.
create or replace function private.check_recurring_amount()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.amount <= 0 then
    raise exception 'Enter an amount above ₹0.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger recurring_bills_amount before insert or update of amount on public.recurring_bills
  for each row execute function private.check_recurring_amount();

-- ---------------------------------------------------------------------------
-- TI-14/15 Staff add or change times by hand only when the company allows it.
-- ---------------------------------------------------------------------------
alter table public.workspace_settings add column if not exists staff_manual_time boolean not null default false;

create or replace function private.limit_staff_time_entries()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or public.is_workspace_admin(new.workspace_id) or public.is_platform_admin() then
    return new;
  end if;
  if (select staff_manual_time from public.workspace_settings where workspace_id = new.workspace_id) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.stopped_at is not null or abs(extract(epoch from new.started_at - now())) > 120 then
      raise exception 'Only admins can add time by hand. Use the timer instead.' using errcode = 'P0001';
    end if;
  elsif new.started_at is distinct from old.started_at
     or (new.stopped_at is distinct from old.stopped_at
         and (old.stopped_at is not null or new.stopped_at is null
              or abs(extract(epoch from new.stopped_at - now())) > 120)) then
    raise exception 'Only admins can change the times on an entry.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger time_entries_staff_limit before insert or update on public.time_entries
  for each row execute function private.limit_staff_time_entries();

-- ---------------------------------------------------------------------------
-- TI-07 Staff time only the work assigned to them.
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
  if p_work_item_id is not null and not public.is_workspace_admin(p_workspace_id)
     and not public.is_assigned_to_work_item(p_work_item_id) then
    raise exception 'You can only time work assigned to you.' using errcode = 'P0001';
  end if;

  -- Stop any running timer first.
  update public.time_entries set stopped_at = now(), stopped_by = (select auth.uid())
  where workspace_id = p_workspace_id and user_id = (select auth.uid()) and stopped_at is null;

  select client_id into v_client from public.work_items where id = p_work_item_id and workspace_id = p_workspace_id;
  insert into public.time_entries (workspace_id, user_id, work_item_id, client_id, notes)
  values (p_workspace_id, (select auth.uid()), p_work_item_id, v_client, p_notes)
  returning id into v_id;

  -- Starting a timer moves a backlog item into progress.
  update public.work_items set status = 'in_progress' where id = p_work_item_id and status = 'backlog';
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- LD-12 "Created by" is always the person who added the lead.
-- Dashboard: record when a lead was won.
-- ---------------------------------------------------------------------------
alter table public.leads add column if not exists won_at timestamptz;
update public.leads set won_at = updated_at where stage = 'won' and won_at is null;

create or replace function private.lead_defaults()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if (select auth.uid()) is not null then
      new.created_by := (select auth.uid());
    end if;
  elsif not public.is_platform_admin() then
    new.created_by := old.created_by;
  end if;
  if new.stage = 'won' then
    if tg_op = 'INSERT' or old.stage <> 'won' then
      new.won_at := now();
    else
      new.won_at := coalesce(old.won_at, now());
    end if;
  else
    new.won_at := null;
  end if;
  return new;
end;
$$;
create trigger leads_defaults before insert or update on public.leads
  for each row execute function private.lead_defaults();

-- ---------------------------------------------------------------------------
-- Notification settings are now used.
-- ---------------------------------------------------------------------------
create or replace function private.rule_on(p_ws uuid, p_rule text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select (notification_rules ->> p_rule)::boolean from public.workspace_settings where workspace_id = p_ws
  ), true);
$$;

create or replace function private.notify_work_assignment()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.user_id is distinct from (select auth.uid()) and private.rule_on(new.workspace_id, 'task_assigned') then
    insert into public.notifications (workspace_id, user_id, type, title, message, link)
    select new.workspace_id, new.user_id, 'work', 'New work assigned', w.title, '/work?open=' || w.id
    from public.work_items w where w.id = new.work_item_id;
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
     and new.assigned_to is distinct from (select auth.uid())
     and private.rule_on(new.workspace_id, 'lead_assigned') then
    insert into public.notifications (workspace_id, user_id, type, title, message, link)
    values (new.workspace_id, new.assigned_to, 'lead', 'Lead assigned to you',
            coalesce(nullif(new.company, ''), new.name), '/leads?open=' || new.id);
  end if;
  return null;
end;
$$;
create trigger leads_notify_assignment after insert or update of assigned_to on public.leads
  for each row execute function private.notify_lead_assignment();

-- Daily: work due today or tomorrow, invoices that just went overdue, and new retainer invoices.
create or replace function private.send_daily_alerts()
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.notifications (workspace_id, user_id, type, title, message, link)
  select w.workspace_id, a.user_id, 'work',
         case when w.due_date = current_date then 'Due today' else 'Due tomorrow' end,
         w.title, '/work?open=' || w.id
  from public.work_items w
  join public.work_item_assignees a on a.work_item_id = w.id
  join public.workspace_members m on m.workspace_id = w.workspace_id and m.user_id = a.user_id and m.is_active
  where w.status <> 'completed'
    and w.due_date in (current_date, current_date + 1)
    and public.workspace_is_active(w.workspace_id)
    and private.rule_on(w.workspace_id, 'due_date_reminders');

  insert into public.notifications (workspace_id, user_id, type, title, message, link)
  select i.workspace_id, m.user_id, 'invoice',
         case when i.recurring_bill_id is not null and i.created_at > now() - interval '1 day' and i.due_date <> current_date - 1
              then 'Retainer invoice created' else 'Invoice overdue' end,
         coalesce(i.invoice_number, 'Draft') || ' · ' || c.company_name, '/invoices?open=' || i.id
  from public.invoices i
  join public.clients c on c.id = i.client_id
  join public.workspace_members m on m.workspace_id = i.workspace_id and m.role in ('owner', 'admin') and m.is_active
  where i.status = 'pending'
    and (i.due_date = current_date - 1 or (i.recurring_bill_id is not null and i.created_at > now() - interval '1 day'))
    and public.workspace_is_active(i.workspace_id)
    and public.workspace_has_module(i.workspace_id, 'invoicing')
    and private.rule_on(i.workspace_id, 'billing_alerts');
end;
$$;

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
         'Renew from the Subscription page to keep full access.', '/billing'
  from public.workspaces w
  cross join public.platform_settings s
  join public.workspace_members m on m.workspace_id = w.id and m.role in ('owner', 'admin') and m.is_active
  where w.state <> 'suspended'
    and (w.valid_until::date = current_date + s.reminder_days or w.valid_until::date = current_date)
    and private.rule_on(w.id, 'renewal_reminders');
end;
$$;

select cron.schedule('daily-alerts', '30 3 * * *', $$select private.send_daily_alerts()$$);

-- ---------------------------------------------------------------------------
-- LF-09 / flooding: required questions are checked here too, and each visitor
-- is limited separately so one person can't block a form for everyone.
-- ---------------------------------------------------------------------------
create table if not exists private.form_submissions (
  form_id uuid not null,
  visitor text not null,
  submitted_at timestamptz not null default now()
);
create index if not exists form_submissions_idx on private.form_submissions(form_id, visitor, submitted_at desc);

create or replace function public.submit_public_lead(p_slug text, p_name text, p_phone text,
                                                     p_email text default null, p_answers jsonb default '{}')
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  f public.lead_forms;
  v_lead uuid;
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}');
  v_visitor text := coalesce(v_headers ->> 'cf-connecting-ip', v_headers ->> 'x-real-ip', 'unknown');
  v_missing text;
begin
  select * into f from public.lead_forms where slug = lower(btrim(p_slug)) and is_active;
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
  select q ->> 'label' into v_missing
  from jsonb_array_elements(case when jsonb_typeof(f.fields) = 'array' then f.fields else '[]' end) q
  where (q ->> 'required')::boolean is true
    and coalesce(btrim(coalesce(p_answers, '{}') ->> (q ->> 'key')), '') = ''
  limit 1;
  if v_missing is not null then
    raise exception 'Please answer "%".', v_missing;
  end if;
  -- Flood protection: 5 per visitor and 200 in total per form, per 10 minutes.
  if (select count(*) from private.form_submissions
      where form_id = f.id and visitor = v_visitor and submitted_at > now() - interval '10 minutes') >= 5
     or (select count(*) from public.leads where form_id = f.id and created_at > now() - interval '10 minutes') >= 200 then
    raise exception 'Too many submissions, please try again shortly.';
  end if;
  insert into private.form_submissions (form_id, visitor) values (f.id, v_visitor);

  insert into public.leads (workspace_id, name, phone, email, company, source, form_id, form_answers)
  values (f.workspace_id, trim(p_name), nullif(trim(p_phone), ''), nullif(lower(trim(p_email)), ''),
          private.company_from_answers(p_answers), f.default_source, f.id, coalesce(p_answers, '{}'))
  returning id into v_lead;

  insert into public.notifications (workspace_id, user_id, type, title, message, link)
  select f.workspace_id, m.user_id, 'lead', 'New lead: ' || trim(p_name), 'From form "' || f.title || '"', '/leads?open=' || v_lead
  from public.workspace_members m
  where m.workspace_id = f.workspace_id and m.role in ('owner', 'admin') and m.is_active;

  return jsonb_build_object('ok', true, 'message', coalesce(f.success_message, 'Thank you! We will contact you soon.'));
end;
$$;

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
  where f.slug = lower(btrim(p_slug)) and f.is_active
    and public.workspace_status(f.workspace_id) <> 'suspended'
    and public.workspace_has_module(f.workspace_id, 'leads');
$$;

-- ---------------------------------------------------------------------------
-- Sign-in: a wrong password on the "existing account" path counts as a failed try.
-- ---------------------------------------------------------------------------
create or replace function public.pin_record_failure(p_email text, p_client_key text)
returns void
language sql security definer
set search_path = ''
as $$
  insert into private.pin_attempts (key, success)
  values ('email:' || lower(trim(p_email)), false), ('ip:' || coalesce(p_client_key, 'unknown'), false);
$$;
revoke execute on function public.pin_record_failure(text, text) from public, anon, authenticated;
grant execute on function public.pin_record_failure(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Super Admin: unsuspending puts a company back to what it was (trial or active).
-- ---------------------------------------------------------------------------
alter table public.workspaces add column if not exists state_before_suspend public.subscription_state;

create or replace function private.remember_state_before_suspend()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state = 'suspended' and old.state <> 'suspended' then
    new.state_before_suspend := old.state;
  end if;
  return new;
end;
$$;
create trigger workspaces_remember_state before update of state on public.workspaces
  for each row execute function private.remember_state_before_suspend();

-- ---------------------------------------------------------------------------
-- Plans: no negative prices. Prices for Pro Agency and Enterprise (GST included).
-- ---------------------------------------------------------------------------
alter table public.plans
  add constraint plans_prices_not_negative check (
    coalesce(price_monthly, 0) >= 0 and coalesce(price_quarterly, 0) >= 0
    and coalesce(price_half_yearly, 0) >= 0 and coalesce(price_yearly, 0) >= 0);

update public.plans set price_monthly = 5999 where name = 'Pro Agency' and price_monthly is null;
update public.plans set price_monthly = 9999 where name = 'Enterprise' and price_monthly is null;

-- ---------------------------------------------------------------------------
-- 2.4 A switched-off member is told so, instead of "not part of any company".
-- ---------------------------------------------------------------------------
create or replace function public.my_inactive_companies()
returns table (name text)
language sql stable security definer
set search_path = ''
as $$
  select w.name
  from public.workspace_members m
  join public.workspaces w on w.id = m.workspace_id
  where m.user_id = (select auth.uid()) and not m.is_active
  order by w.name;
$$;
revoke execute on function public.my_inactive_companies() from public, anon;
grant execute on function public.my_inactive_companies() to authenticated;
