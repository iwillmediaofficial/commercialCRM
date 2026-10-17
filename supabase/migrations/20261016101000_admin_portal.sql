-- Phase 2: Super Admin portal helpers.

-- One row per company with what the directory needs, in a single call.
create or replace function public.admin_workspace_overview()
returns table (workspace_id uuid, status text, active_members int, pending_renewals int)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only the Super Admin can see this.';
  end if;
  return query
  select w.id,
         public.workspace_status(w.id),
         (select count(*)::int from public.workspace_members m where m.workspace_id = w.id and m.is_active),
         (select count(*)::int from public.renewal_requests r where r.workspace_id = w.id and r.status = 'pending')
  from public.workspaces w;
end;
$$;
revoke execute on function public.admin_workspace_overview() from public, anon;
grant execute on function public.admin_workspace_overview() to authenticated;

-- A payment received offline without a renewal request: extends validity,
-- adds it to the ledger, tells the company and records it in the audit log.
create or replace function public.admin_record_payment(
  p_workspace_id uuid,
  p_plan_id uuid,
  p_period public.billing_period,
  p_amount numeric,
  p_payment_mode public.payment_mode,
  p_reference_no text default null,
  p_paid_on date default current_date,
  p_note text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_from timestamptz;
  v_until timestamptz;
  v_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Only the Super Admin can record payments.';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'Enter the amount received.';
  end if;

  select greatest(valid_until, now()) into v_from from public.workspaces where id = p_workspace_id for update;
  if v_from is null then
    raise exception 'Company not found.';
  end if;
  v_until := v_from + private.period_interval(p_period);

  update public.workspaces
  set valid_until = v_until, plan_id = p_plan_id,
      state = case when state = 'suspended' then state else 'active' end
  where id = p_workspace_id;

  insert into public.subscription_payments
    (workspace_id, plan_id, period, amount, payment_mode, reference_no, paid_on, valid_from, valid_until, recorded_by)
  values
    (p_workspace_id, p_plan_id, p_period, p_amount, p_payment_mode, nullif(trim(p_reference_no), ''),
     coalesce(p_paid_on, current_date), v_from, v_until, (select auth.uid()))
  returning id into v_id;

  insert into public.notifications (workspace_id, user_id, type, title, message, link)
  select p_workspace_id, m.user_id, 'subscription', 'Subscription renewed',
         'Your plan is active until ' || to_char(v_until at time zone 'Asia/Kolkata', 'DD Mon YYYY') || '.',
         '/settings/subscription'
  from public.workspace_members m
  where m.workspace_id = p_workspace_id and m.role in ('owner', 'admin') and m.is_active;

  insert into public.admin_audit_log (actor_id, workspace_id, action, details)
  values ((select auth.uid()), p_workspace_id, 'payment_recorded',
          jsonb_build_object('payment_id', v_id, 'amount', p_amount, 'period', p_period,
                             'valid_until', v_until, 'note', p_note));

  return jsonb_build_object('valid_until', v_until);
end;
$$;
revoke execute on function public.admin_record_payment(uuid, uuid, public.billing_period, numeric, public.payment_mode, text, date, text) from public, anon;
grant execute on function public.admin_record_payment(uuid, uuid, public.billing_period, numeric, public.payment_mode, text, date, text) to authenticated;

-- The Super Admin opening a company's workspace (read-only) is recorded.
create or replace function public.admin_log_support_view(p_workspace_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only the Super Admin can do this.';
  end if;
  insert into public.admin_audit_log (actor_id, workspace_id, action, details)
  values ((select auth.uid()), p_workspace_id, 'support_view', '{}');
end;
$$;
revoke execute on function public.admin_log_support_view(uuid) from public, anon;
grant execute on function public.admin_log_support_view(uuid) to authenticated;

-- Plan and settings changes go in the audit log too.
create or replace function private.audit_platform_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.admin_audit_log (actor_id, action, details)
  values ((select auth.uid()),
          tg_table_name || '_' || lower(tg_op),
          case when tg_table_name = 'plans'
               then jsonb_build_object('plan_id', to_jsonb(new) -> 'id', 'name', to_jsonb(new) -> 'name')
               else '{}'::jsonb end);
  return new;
end;
$$;
create trigger plans_audit after insert or update on public.plans
  for each row execute function private.audit_platform_change();
create trigger platform_settings_audit after update on public.platform_settings
  for each row execute function private.audit_platform_change();
