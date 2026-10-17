-- QA fixes, part 2: invoices. Run in Supabase > SQL Editor if the deploy tool
-- can't (it contains deletes).

-- Only drafts can be deleted. A sent invoice is cancelled instead, so its
-- number stays in the records (GST).
create policy invoices_delete_drafts_only on public.invoices as restrictive for delete to authenticated
  using (status = 'draft');

-- Saves an invoice and its lines in one go: either all of it saves or none of it.
--   p_header: client_id, issue_date, due_date, place_of_supply, notes, terms,
--             discount_amount, invoice_number (optional)
--   p_items:  [{ id?, description, hsn_sac, quantity, rate, tax_rate }] in order
create or replace function public.save_invoice(
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_header jsonb,
  p_items jsonb,
  p_mark_sent boolean default false
)
returns uuid
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_id uuid := p_invoice_id;
  v_status text;
  v_keep uuid[];
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one line item with a description.' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e
             where coalesce(btrim(e ->> 'description'), '') = ''
                or coalesce((e ->> 'quantity')::numeric, 0) <= 0
                or coalesce((e ->> 'rate')::numeric, 0) < 0) then
    raise exception 'Every line needs a description, a quantity above 0 and a rate of 0 or more.' using errcode = 'P0001';
  end if;
  if p_mark_sent and (select sum((e ->> 'quantity')::numeric * (e ->> 'rate')::numeric) from jsonb_array_elements(p_items) e) <= 0 then
    raise exception 'Add at least one line with a rate above ₹0 before sending the invoice.' using errcode = 'P0001';
  end if;

  if v_id is null then
    insert into public.invoices
      (workspace_id, client_id, issue_date, due_date, place_of_supply, notes, terms, discount_amount, invoice_number, status, created_by)
    values
      (p_workspace_id, (p_header ->> 'client_id')::uuid, (p_header ->> 'issue_date')::date, (p_header ->> 'due_date')::date,
       nullif(btrim(p_header ->> 'place_of_supply'), ''), nullif(btrim(p_header ->> 'notes'), ''), nullif(btrim(p_header ->> 'terms'), ''),
       coalesce((p_header ->> 'discount_amount')::numeric, 0), nullif(btrim(p_header ->> 'invoice_number'), ''), 'draft', (select auth.uid()))
    returning id into v_id;
  else
    select status into v_status from public.invoices where id = v_id and workspace_id = p_workspace_id;
    if v_status is null then
      raise exception 'Invoice not found.' using errcode = 'P0001';
    end if;
    if v_status not in ('draft', 'pending') then
      raise exception 'Only draft or unpaid invoices can be edited.' using errcode = 'P0001';
    end if;
    update public.invoices
    set client_id = (p_header ->> 'client_id')::uuid,
        issue_date = (p_header ->> 'issue_date')::date,
        due_date = (p_header ->> 'due_date')::date,
        place_of_supply = nullif(btrim(p_header ->> 'place_of_supply'), ''),
        notes = nullif(btrim(p_header ->> 'notes'), ''),
        terms = nullif(btrim(p_header ->> 'terms'), ''),
        discount_amount = coalesce((p_header ->> 'discount_amount')::numeric, 0),
        invoice_number = coalesce(nullif(btrim(p_header ->> 'invoice_number'), ''), invoice_number)
    where id = v_id;
  end if;

  select coalesce(array_agg((e ->> 'id')::uuid) filter (where nullif(e ->> 'id', '') is not null), '{}')
    into v_keep from jsonb_array_elements(p_items) e;
  delete from public.invoice_items where invoice_id = v_id and not (id = any (v_keep));

  update public.invoice_items it
  set description = btrim(x.e ->> 'description'),
      hsn_sac = nullif(btrim(x.e ->> 'hsn_sac'), ''),
      quantity = (x.e ->> 'quantity')::numeric,
      rate = (x.e ->> 'rate')::numeric,
      tax_rate = coalesce((x.e ->> 'tax_rate')::numeric, 0),
      position = (x.o - 1)::int
  from jsonb_array_elements(p_items) with ordinality as x(e, o)
  where nullif(x.e ->> 'id', '') is not null and it.id = (x.e ->> 'id')::uuid and it.invoice_id = v_id;

  insert into public.invoice_items (invoice_id, workspace_id, description, hsn_sac, quantity, rate, tax_rate, position)
  select v_id, p_workspace_id, btrim(x.e ->> 'description'), nullif(btrim(x.e ->> 'hsn_sac'), ''),
         (x.e ->> 'quantity')::numeric, (x.e ->> 'rate')::numeric, coalesce((x.e ->> 'tax_rate')::numeric, 0), (x.o - 1)::int
  from jsonb_array_elements(p_items) with ordinality as x(e, o)
  where nullif(x.e ->> 'id', '') is null;

  if p_mark_sent then
    update public.invoices set status = 'pending' where id = v_id and status = 'draft';
  end if;
  return v_id;
end;
$$;
revoke execute on function public.save_invoice(uuid, uuid, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.save_invoice(uuid, uuid, jsonb, jsonb, boolean) to authenticated;

-- Monthly cleanup also clears old form flood-protection records.
create or replace function private.cleanup_old_records()
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_activity int;
  v_notifications int;
  v_errors int;
begin
  delete from public.activity_logs where created_at < now() - interval '6 months';
  get diagnostics v_activity = row_count;
  delete from public.notifications where is_read and created_at < now() - interval '3 months';
  get diagnostics v_notifications = row_count;
  delete from public.app_errors where created_at < now() - interval '1 month';
  get diagnostics v_errors = row_count;
  delete from private.form_submissions where submitted_at < now() - interval '1 day';
  return jsonb_build_object('activity_logs', v_activity, 'notifications', v_notifications, 'app_errors', v_errors);
end;
$$;
