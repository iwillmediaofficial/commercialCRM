-- Catch up on missed periods: each run now creates every invoice that is due
-- for a bill (period by period), not just one, so a retainer that started
-- months ago or was paused is brought up to date. Capped at 24 per bill per run.
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
  v_next date;
  v_runs int;
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
    v_next := b.next_run_date;
    v_runs := 0;
    while v_next <= current_date + b.recurring_lead_days
      and (b.end_date is null or v_next <= b.end_date)
      and v_runs < 24
    loop
      v_inv := null;
      v_period_end := (v_next + private.period_interval(b.frequency))::date - 1;
      insert into public.invoices
        (workspace_id, client_id, recurring_bill_id, period_start, period_end, issue_date, due_date,
         status, currency, assigned_to, created_by)
      values
        (b.workspace_id, b.client_id, b.id, v_next, v_period_end, v_next,
         v_next + b.payment_terms_days, 'pending', b.currency, b.assigned_to, b.created_by)
      on conflict (recurring_bill_id, period_start) do nothing
      returning id into v_inv;

      if v_inv is not null then
        insert into public.invoice_items (invoice_id, workspace_id, description, quantity, rate, tax_rate)
        values (v_inv, b.workspace_id, b.title, 1, b.amount, b.tax_rate);
        v_count := v_count + 1;
      end if;

      v_next := (v_next + private.period_interval(b.frequency))::date;
      v_runs := v_runs + 1;
    end loop;

    update public.recurring_bills
    set next_run_date = v_next
    where id = b.id;
  end loop;
  return v_count;
end;
$$;
