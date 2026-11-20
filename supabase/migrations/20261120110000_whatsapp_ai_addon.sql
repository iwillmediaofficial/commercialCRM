-- ---------------------------------------------------------------------------
-- WhatsApp AI add-on and follow-ups from AI chats (WhatsApp AI plan, phase 3)
--
-- * The AI assistant is a paid add-on (default ₹999/month incl. GST, 500 AI
--   chats). The Super Admin switches it on per company. Without it the
--   assistant's settings, test box, "Fill from website" and AI replies stay off.
-- * Renewals and recorded payments include the add-on, and the invoice shows it
--   as its own line.
-- * When the add-on or AI replies are switched off, chats the AI was answering
--   go to the team, so no customer is left waiting.
-- * When a customer asks for a call or visit at a time, the AI puts that time
--   on the lead as its follow-up.
-- ---------------------------------------------------------------------------

alter table public.workspaces
  add column if not exists wa_ai_addon boolean not null default false,
  add column if not exists wa_ai_addon_price numeric(10,2) not null default 999
    check (wa_ai_addon_price >= 0);

alter table public.subscription_payments
  add column if not exists addon_amount numeric(12,2) not null default 0;

-- Companies already using AI replies keep them: their add-on starts on.
update public.workspaces w set wa_ai_addon = true
where exists (select 1 from public.wa_ai_settings s where s.workspace_id = w.id and s.enabled);

-- Is the add-on on for this company? (Members can read their own company.)
create or replace function public.wa_ai_addon_on(p_workspace_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce((select w.wa_ai_addon from public.workspaces w where w.id = p_workspace_id), false);
$$;
revoke execute on function public.wa_ai_addon_on(uuid) from public, anon;
grant execute on function public.wa_ai_addon_on(uuid) to authenticated, service_role;

create or replace function private.period_months(p public.billing_period)
returns int
language sql immutable
set search_path = ''
as $$
  select case p when 'monthly' then 1 when 'quarterly' then 3 when 'half_yearly' then 6 when 'yearly' then 12 end;
$$;

-- The add-on's price for a period (0 when it is off).
create or replace function private.wa_ai_addon_amount(p_workspace_id uuid, p public.billing_period)
returns numeric
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select case when w.wa_ai_addon then w.wa_ai_addon_price * private.period_months(p) else 0 end
                   from public.workspaces w where w.id = p_workspace_id), 0);
$$;
revoke execute on function private.period_months(public.billing_period) from public, anon, authenticated;
revoke execute on function private.wa_ai_addon_amount(uuid, public.billing_period) from public, anon, authenticated;

-- Chats the AI was answering go to the team.
create or replace function private.wa_ai_release_chats(p_workspace_id uuid, p_reason text)
returns void
language sql security definer
set search_path = ''
as $$
  update public.wa_chats
  set handler = 'human', handoff_at = now(), handoff_reason = left(p_reason, 300),
      unread_count = greatest(unread_count, 1)
  where workspace_id = p_workspace_id and handler = 'ai';
$$;
revoke execute on function private.wa_ai_release_chats(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Super Admin: switch the add-on, set its monthly price and chat allowance.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_wa_ai_addon(
  p_workspace_id uuid, p_on boolean, p_price numeric default null, p_chat_limit int default null
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  w public.workspaces;
begin
  if not public.is_platform_admin() then raise exception 'Only the Super Admin can change add-ons.'; end if;
  select * into w from public.workspaces where id = p_workspace_id for update;
  if w.id is null then raise exception 'Company not found.'; end if;
  if p_price is not null and (p_price < 0 or p_price > 1000000) then raise exception 'Enter a monthly price in rupees.'; end if;
  if p_chat_limit is not null and (p_chat_limit < 0 or p_chat_limit > 100000) then raise exception 'Enter a chat allowance from 0 to 100000.'; end if;

  update public.workspaces
  set wa_ai_addon = p_on, wa_ai_addon_price = coalesce(p_price, wa_ai_addon_price)
  where id = w.id;

  if p_chat_limit is not null then
    insert into public.wa_ai_settings (workspace_id, monthly_chat_limit) values (w.id, p_chat_limit)
    on conflict (workspace_id) do update set monthly_chat_limit = excluded.monthly_chat_limit;
  end if;

  if not p_on then
    update public.wa_ai_settings set enabled = false where workspace_id = w.id and enabled;
    perform private.wa_ai_release_chats(w.id, 'The WhatsApp AI add-on was switched off');
  end if;

  insert into public.admin_audit_log (actor_id, workspace_id, action, details)
  values ((select auth.uid()), w.id, 'wa_ai_addon',
          jsonb_strip_nulls(jsonb_build_object('on', p_on, 'was_on', w.wa_ai_addon, 'price', p_price, 'chat_limit', p_chat_limit)));
end;
$$;
revoke execute on function public.admin_set_wa_ai_addon(uuid, boolean, numeric, int) from public, anon;
grant execute on function public.admin_set_wa_ai_addon(uuid, boolean, numeric, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Settings: AI replies can only be switched on with the add-on; switching them
-- off hands the AI's chats to the team.
-- ---------------------------------------------------------------------------
create or replace function private.wa_ai_settings_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  -- The Super Admin sets the allowance; a company admin can't raise its own.
  if tg_op = 'UPDATE' and new.monthly_chat_limit is distinct from old.monthly_chat_limit
     and not public.is_platform_admin() and (select auth.uid()) is not null then
    new.monthly_chat_limit := old.monthly_chat_limit;
  elsif tg_op = 'INSERT' and not public.is_platform_admin() and (select auth.uid()) is not null then
    new.monthly_chat_limit := 500;
  end if;
  if new.enabled and not public.wa_ai_addon_on(new.workspace_id) then
    if tg_op = 'INSERT' or not old.enabled then
      raise exception 'AI replies need the WhatsApp AI add-on. Ask the Super Admin to switch it on.';
    end if;
    new.enabled := false;
  end if;
  return new;
end;
$$;

create or replace function private.wa_ai_settings_switched_off()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if old.enabled and not new.enabled then
    perform private.wa_ai_release_chats(new.workspace_id, 'AI replies were switched off');
  end if;
  return null;
end;
$$;
drop trigger if exists wa_ai_settings_switched_off on public.wa_ai_settings;
create trigger wa_ai_settings_switched_off after update of enabled on public.wa_ai_settings
  for each row execute function private.wa_ai_settings_switched_off();

-- New chats start with the AI only when the add-on and AI replies are on.
create or replace function private.wa_chat_default_handler()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if public.wa_ai_addon_on(new.workspace_id)
     and exists (select 1 from public.wa_ai_settings s where s.workspace_id = new.workspace_id and s.enabled) then
    new.handler := 'ai';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- What the AI needs for one reply. Now also checks the add-on, and when the AI
-- can't answer a chat it is supposed to be answering, the chat goes to the team.
-- ---------------------------------------------------------------------------
create or replace function public.wa_ai_context(p_chat_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  c public.wa_chats;
  s public.wa_ai_settings;
  w public.workspaces;
  u public.wa_ai_usage;
  l public.leads;
  v_msgs jsonb;
begin
  select * into c from public.wa_chats where id = p_chat_id;
  if c.id is null or c.handler <> 'ai' then return null; end if;
  select * into w from public.workspaces where id = c.workspace_id;
  select * into s from public.wa_ai_settings where workspace_id = c.workspace_id;
  if not w.whatsapp_enabled or not public.workspace_is_active(w.id) then return null; end if;
  if not w.wa_ai_addon or not coalesce(s.enabled, false) then
    update public.wa_chats
    set handler = 'human', handoff_at = now(), unread_count = greatest(unread_count, 1),
        handoff_reason = case when w.wa_ai_addon then 'AI replies are switched off' else 'The WhatsApp AI add-on is off' end
    where id = c.id;
    return null;
  end if;
  if c.last_inbound_at is null or c.last_inbound_at < now() - interval '24 hours' then return null; end if;
  -- A runaway chat (spam, a loop) goes to the team.
  if c.ai_replies >= 40 then
    update public.wa_chats
    set handler = 'human', handoff_at = now(), unread_count = greatest(unread_count, 1),
        handoff_reason = 'The assistant has already replied 40 times in this chat'
    where id = c.id;
    return null;
  end if;

  select * into u from public.wa_ai_usage where workspace_id = w.id and month = private.ist_month();
  if c.ai_month is distinct from private.ist_month() and coalesce(u.chats, 0) >= s.monthly_chat_limit then
    return jsonb_build_object('limit_reached', true, 'workspace_id', w.id);
  end if;

  if c.lead_id is not null then select * into l from public.leads where id = c.lead_id; end if;

  select coalesce(jsonb_agg(jsonb_build_object('sender', m.sender, 'body', coalesce(m.body, '[' || m.type || ']'),
                                               'at', m.created_at) order by m.created_at), '[]'::jsonb)
  into v_msgs
  from (select * from public.wa_messages where chat_id = c.id and status <> 'failed'
        order by created_at desc limit 30) m;

  return jsonb_build_object(
    'workspace_id', w.id,
    'company', w.name,
    'settings', to_jsonb(s) - 'updated_by' - 'monthly_chat_limit',
    'chat', jsonb_build_object('id', c.id, 'contact_name', c.contact_name, 'wa_id', c.wa_id,
                               'ai_summary', c.ai_summary, 'last_inbound_at', c.last_inbound_at),
    'lead', case when l.id is null then null else jsonb_build_object(
      'id', l.id, 'name', l.name, 'stage', l.stage, 'form_answers', l.form_answers) end,
    'messages', v_msgs
  );
end;
$$;

-- Staff hand a chat back to the AI only when the add-on and AI replies are on.
create or replace function public.wa_set_handler(p_chat_id uuid, p_handler text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  c public.wa_chats;
begin
  select * into c from public.wa_chats where id = p_chat_id;
  if c.id is null or not public.can_see_wa_chat(c.workspace_id, c.lead_id) or not public.can_write(c.workspace_id) then
    raise exception 'Chat not found.';
  end if;
  if p_handler not in ('ai', 'human') then raise exception 'Unknown choice.'; end if;
  if p_handler = 'ai' and not public.wa_ai_addon_on(c.workspace_id) then
    raise exception 'This company doesn''t have the WhatsApp AI add-on.';
  end if;
  if p_handler = 'ai' and not exists (select 1 from public.wa_ai_settings s where s.workspace_id = c.workspace_id and s.enabled) then
    raise exception 'AI replies are switched off for this company. An admin can turn them on in WhatsApp settings.';
  end if;
  update public.wa_chats
  set handler = p_handler,
      handoff_reason = case when p_handler = 'ai' then null else coalesce(handoff_reason, 'Taken over by staff') end,
      handoff_at = case when p_handler = 'ai' then null else coalesce(handoff_at, now()) end
  where id = c.id;
end;
$$;

-- Test box: only with the add-on.
create or replace function public.wa_ai_test_context(p_workspace_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.wa_ai_settings;
begin
  if not public.can_admin_write(p_workspace_id, 'leads') then raise exception 'Only admins can test the assistant.'; end if;
  if not public.wa_ai_addon_on(p_workspace_id) then
    raise exception 'This company doesn''t have the WhatsApp AI add-on. Ask the Super Admin to switch it on.';
  end if;
  select * into s from public.wa_ai_settings where workspace_id = p_workspace_id;
  if s.workspace_id is null then raise exception 'Save the assistant settings first.'; end if;
  -- Tests count towards the month's AI use too (as replies, not chats), so they can't be used to run up costs unseen.
  if (select count(*) from public.wa_ai_usage u where u.workspace_id = p_workspace_id and u.month = private.ist_month()
      and u.replies > 2000) > 0 then
    raise exception 'This month''s AI use is very high. Ask the Super Admin.';
  end if;
  return jsonb_build_object('workspace_id', p_workspace_id,
                            'company', (select name from public.workspaces where id = p_workspace_id),
                            'settings', to_jsonb(s) - 'updated_by' - 'monthly_chat_limit');
end;
$$;

-- ---------------------------------------------------------------------------
-- Follow-up from an AI chat (service key only): the customer asked to be called
-- or visited at a time. It becomes the lead's follow-up unless the team already
-- has an earlier one set by hand. Returns true when the follow-up was set.
-- ---------------------------------------------------------------------------
create or replace function public.wa_ai_follow_up(p_chat_id uuid, p_at timestamptz, p_note text default null)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  c public.wa_chats;
  l public.leads;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 300), '');
begin
  if p_at is null or p_at < now() + interval '5 minutes' or p_at > now() + interval '60 days' then return false; end if;
  select * into c from public.wa_chats where id = p_chat_id;
  if c.id is null or c.lead_id is null then return false; end if;
  select * into l from public.leads where id = c.lead_id for update;
  if l.id is null or l.stage in ('won', 'lost') then return false; end if;
  if l.follow_up_at is not null and not l.follow_up_auto and l.follow_up_at > now() and l.follow_up_at <= p_at then
    return false;
  end if;
  if l.follow_up_at is not distinct from p_at then return false; end if;

  update public.leads set follow_up_at = p_at where id = l.id;
  insert into public.lead_activities (workspace_id, lead_id, kind, body, details)
  values (c.workspace_id, l.id, 'remark',
          left('WhatsApp assistant set a follow-up for '
               || to_char(p_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')
               || coalesce(': ' || v_note, '') || '.', 1000),
          jsonb_build_object('source', 'whatsapp_ai', 'chat_id', c.id, 'follow_up_at', p_at));
  return true;
end;
$$;
revoke execute on function public.wa_ai_follow_up(uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.wa_ai_follow_up(uuid, timestamptz, text) to service_role;

-- ---------------------------------------------------------------------------
-- Billing: renewals include the add-on, and invoices show it as its own line.
-- ---------------------------------------------------------------------------
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
  new.amount := v_price + private.wa_ai_addon_amount(new.workspace_id, new.period);
  return new;
end;
$$;

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
  v_period text;
  v_addon numeric(12,2);
  v_addon_taxable numeric(12,2);
  v_plan_line jsonb;
  v_lines jsonb;
begin
  if p.invoice_no is not null then
    return p;
  end if;
  select * into s from public.platform_settings limit 1;
  select * into b from public.workspace_settings where workspace_id = p.workspace_id;
  select * into w from public.workspaces where id = p.workspace_id;
  select name into v_plan from public.plans where id = p.plan_id;

  -- The add-on's share of the amount paid (never more than the amount).
  v_addon := case when p.period is null then 0
                  else least(greatest(p.amount, 0), private.wa_ai_addon_amount(p.workspace_id, p.period)) end;
  p.addon_amount := v_addon;

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
  v_addon_taxable := round(v_addon * 100 / (100 + v_rate), 2);
  v_period := coalesce(' (' || replace(p.period::text, '_', '-') || ')', '');

  v_plan_line := jsonb_build_object(
    'description', coalesce(v_plan, 'Subscription') || ' plan subscription' || v_period,
    'period_from', p.valid_from,
    'period_to', p.valid_until,
    'sac', s.sac_code,
    'amount', p.amount - v_addon,
    'taxable', v_taxable - v_addon_taxable);
  v_lines := jsonb_build_array(v_plan_line);
  if v_addon > 0 then
    v_lines := v_lines || jsonb_build_object(
      'description', 'WhatsApp AI assistant add-on' || v_period,
      'period_from', p.valid_from,
      'period_to', p.valid_until,
      'sac', s.sac_code,
      'amount', v_addon,
      'taxable', v_addon_taxable);
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
    'line', v_plan_line,
    'lines', v_lines,
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
