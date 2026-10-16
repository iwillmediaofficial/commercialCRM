-- "Generate due invoices now" only touches the caller's own company.
-- The nightly job still runs every company (null = all).
create or replace function private.generate_recurring_invoices(p_workspace_id uuid)
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
      and (p_workspace_id is null or rb.workspace_id = p_workspace_id)
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

create or replace function private.generate_recurring_invoices()
returns int
language sql security definer
set search_path = ''
as $$
  select private.generate_recurring_invoices(null::uuid);
$$;

create or replace function public.run_recurring_billing(p_workspace_id uuid)
returns int
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.can_admin_write(p_workspace_id, 'invoicing') then
    raise exception 'Not allowed.';
  end if;
  return private.generate_recurring_invoices(p_workspace_id);
end;
$$;
