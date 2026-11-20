-- ---------------------------------------------------------------------------
-- WhatsApp AI replies (WhatsApp AI chat agent plan, phase 2)
--
-- Each company fills in what the assistant may say (its knowledge) and the
-- questions it should ask. When AI replies are on, new chats start with the AI
-- answering; it collects the customer's details onto the lead and hands the
-- chat to a person when it should. Staff can take over or hand back any time.
-- The AI's reply never counts as contact for the 1-hour rule.
-- ---------------------------------------------------------------------------

create table public.wa_ai_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  enabled boolean not null default false,
  assistant_name text check (assistant_name is null or length(assistant_name) <= 60),
  greeting text check (greeting is null or length(greeting) <= 500),
  about text check (about is null or length(about) <= 4000),
  products text check (products is null or length(products) <= 8000),
  faqs text check (faqs is null or length(faqs) <= 8000),
  contact_hours text check (contact_hours is null or length(contact_hours) <= 2000),
  policies text check (policies is null or length(policies) <= 4000),
  questions text check (questions is null or length(questions) <= 2000), -- one question per line
  handoff_words text not null default 'call me, manager, human, real person, complaint, refund'
    check (length(handoff_words) <= 500),
  tone text not null default 'friendly' check (tone in ('friendly', 'formal')),
  monthly_chat_limit int not null default 500 check (monthly_chat_limit between 0 and 100000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create index wa_ai_settings_updated_by_idx on public.wa_ai_settings(updated_by);
alter table public.wa_ai_settings enable row level security;

create policy wa_ai_settings_read on public.wa_ai_settings for select to authenticated
  using (public.is_workspace_admin(workspace_id) or public.is_platform_admin());
create policy wa_ai_settings_insert on public.wa_ai_settings for insert to authenticated
  with check (public.can_admin_write(workspace_id, 'leads'));
create policy wa_ai_settings_update on public.wa_ai_settings for update to authenticated
  using (public.can_admin_write(workspace_id, 'leads'))
  with check (public.can_admin_write(workspace_id, 'leads'));

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
  return new;
end;
$$;
create trigger wa_ai_settings_stamp before insert or update on public.wa_ai_settings
  for each row execute function private.wa_ai_settings_stamp();

-- AI use per company per month: chats the AI answered, replies, tokens.
create table public.wa_ai_usage (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  month date not null, -- first day of the month, India time
  chats int not null default 0,
  replies int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (workspace_id, month)
);
alter table public.wa_ai_usage enable row level security;
create policy wa_ai_usage_read on public.wa_ai_usage for select to authenticated
  using (public.is_workspace_admin(workspace_id) or public.is_platform_admin());

alter table public.wa_chats
  add column if not exists ai_month date,          -- month this chat was last counted for AI use
  add column if not exists ai_replies int not null default 0,
  add column if not exists ai_summary text check (ai_summary is null or length(ai_summary) <= 1000),
  add column if not exists handoff_reason text check (handoff_reason is null or length(handoff_reason) <= 300),
  add column if not exists handoff_at timestamptz;

-- New chats start with the AI when the company has it on.
create or replace function private.wa_chat_default_handler()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.wa_ai_settings s where s.workspace_id = new.workspace_id and s.enabled) then
    new.handler := 'ai';
  end if;
  return new;
end;
$$;
create trigger wa_chats_default_handler before insert on public.wa_chats
  for each row execute function private.wa_chat_default_handler();

create or replace function private.ist_month()
returns date
language sql stable
set search_path = ''
as $$
  select date_trunc('month', now() at time zone 'Asia/Kolkata')::date;
$$;

-- ---------------------------------------------------------------------------
-- What the AI needs for one reply (service key only). Null when the AI should
-- stay quiet: switched off, a person has the chat, or the month's allowance is used.
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
  if not coalesce(s.enabled, false) or not w.whatsapp_enabled or not public.workspace_is_active(w.id) then return null; end if;
  if c.last_inbound_at is null or c.last_inbound_at < now() - interval '24 hours' then return null; end if;
  -- A runaway chat (spam, a loop) stops getting AI replies.
  if c.ai_replies >= 40 then return null; end if;

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

-- ---------------------------------------------------------------------------
-- Save what the AI decided (service key only): the reply (stored as "sending"),
-- what it learned about the customer, the running summary, a hand-off, usage.
-- Returns where to send the reply, or null when there is nothing to send.
-- ---------------------------------------------------------------------------
create or replace function public.wa_ai_record(
  p_chat_id uuid, p_reply text, p_handoff boolean, p_handoff_reason text,
  p_customer_name text, p_answers jsonb, p_summary text,
  p_input_tokens int default 0, p_output_tokens int default 0
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  c public.wa_chats;
  l public.leads;
  v_month date := private.ist_month();
  v_new_chat boolean;
  v_reply text := nullif(btrim(coalesce(p_reply, '')), '');
  v_msg uuid;
  v_phone_id text;
  v_name text := nullif(left(btrim(coalesce(p_customer_name, '')), 200), '');
  v_answers jsonb := '{}'::jsonb;
  v_key text;
  v_val text;
begin
  select * into c from public.wa_chats where id = p_chat_id for update;
  if c.id is null then return null; end if;
  -- A person took over while the AI was thinking: drop the reply.
  if c.handler <> 'ai' then return null; end if;
  -- A chat counts once a month, and only when the AI actually answered in it.
  v_new_chat := c.ai_month is distinct from v_month and v_reply is not null;

  insert into public.wa_ai_usage (workspace_id, month, chats, replies, input_tokens, output_tokens)
  values (c.workspace_id, v_month, case when v_new_chat then 1 else 0 end, case when v_reply is null then 0 else 1 end,
          greatest(coalesce(p_input_tokens, 0), 0), greatest(coalesce(p_output_tokens, 0), 0))
  on conflict (workspace_id, month) do update
  set chats = public.wa_ai_usage.chats + excluded.chats,
      replies = public.wa_ai_usage.replies + excluded.replies,
      input_tokens = public.wa_ai_usage.input_tokens + excluded.input_tokens,
      output_tokens = public.wa_ai_usage.output_tokens + excluded.output_tokens;

  if v_reply is not null then
    select phone_number_id into v_phone_id from public.whatsapp_numbers where id = c.number_id and is_active;
    insert into public.wa_messages (workspace_id, chat_id, direction, sender, type, body, status)
    values (c.workspace_id, c.id, 'out', 'ai', 'text', left(v_reply, 4096), 'sending')
    returning id into v_msg;
  end if;

  update public.wa_chats
  set ai_month = case when v_reply is null then ai_month else v_month end,
      ai_replies = ai_replies + case when v_reply is null then 0 else 1 end,
      ai_summary = coalesce(nullif(left(btrim(coalesce(p_summary, '')), 1000), ''), ai_summary),
      last_message_at = case when v_reply is null then last_message_at else now() end,
      last_message_preview = coalesce(left(v_reply, 160), last_message_preview),
      handler = case when p_handoff then 'human' else handler end,
      handoff_reason = case when p_handoff then left(coalesce(nullif(btrim(p_handoff_reason), ''), 'The assistant asked for a person'), 300) else handoff_reason end,
      handoff_at = case when p_handoff then now() else handoff_at end,
      -- The AI answered, so nobody needs to read it yet; a hand-off does need a person.
      unread_count = case when p_handoff then greatest(unread_count, 1)
                          when v_reply is not null then 0 else unread_count end
  where id = c.id;

  -- What the AI learned goes on the lead (never the stage: the AI is not contact).
  if c.lead_id is not null then
    select * into l from public.leads where id = c.lead_id;
    if jsonb_typeof(p_answers) = 'object' then
      for v_key, v_val in select key, value from jsonb_each_text(p_answers) loop
        if btrim(coalesce(v_val, '')) <> '' and length(v_key) <= 80 then
          v_answers := v_answers || jsonb_build_object(left(btrim(v_key), 80), left(btrim(v_val), 300));
        end if;
      end loop;
    end if;
    if v_answers <> '{}'::jsonb or (v_name is not null and l.name = '+' || c.wa_id) then
      update public.leads
      set form_answers = case when v_answers = '{}'::jsonb then form_answers
                              else coalesce(form_answers, '{}'::jsonb) || v_answers end,
          name = case when v_name is not null and name = '+' || c.wa_id then v_name else name end
      where id = l.id and pg_column_size(coalesce(form_answers, '{}'::jsonb) || v_answers) < 20000;
    end if;

    if p_handoff then
      insert into public.lead_activities (workspace_id, lead_id, kind, body, details)
      values (c.workspace_id, l.id, 'remark',
              left('WhatsApp assistant handed this chat to the team: '
                   || coalesce(nullif(btrim(p_handoff_reason), ''), 'asked for a person')
                   || coalesce(E'\nSummary: ' || nullif(btrim(p_summary), ''), ''), 5000),
              jsonb_build_object('source', 'whatsapp_ai', 'chat_id', c.id));
      insert into public.notifications (workspace_id, user_id, type, title, message, link)
      select c.workspace_id, x.user_id, 'lead', 'WhatsApp chat needs you: ' || coalesce(v_name, l.name),
             left(coalesce(nullif(btrim(p_handoff_reason), ''), 'The assistant handed the chat over'), 200),
             '/whatsapp?chat=' || c.id
      from (select l.assigned_to as user_id where l.assigned_to is not null
            union
            select m.user_id from public.workspace_members m
            where l.assigned_to is null and m.workspace_id = c.workspace_id and m.role in ('owner', 'admin') and m.is_active) x;
    end if;
  end if;

  if v_msg is null then return null; end if;
  return jsonb_build_object('message_id', v_msg, 'phone_number_id', v_phone_id, 'to', c.wa_id);
end;
$$;

-- Staff: take the chat from the AI, or hand it back.
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

-- A person replying always wins: the AI goes quiet in that chat.
create or replace function private.wa_staff_reply_takes_over()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.sender = 'staff' then
    update public.wa_chats
    set handler = 'human', handoff_at = coalesce(handoff_at, now()),
        handoff_reason = coalesce(handoff_reason, 'Staff replied')
    where id = new.chat_id and handler = 'ai';
  end if;
  return null;
end;
$$;
create trigger wa_messages_staff_takes_over after insert on public.wa_messages
  for each row execute function private.wa_staff_reply_takes_over();

-- Settings page "Test the assistant": the company's settings, for its admins only.
create or replace function public.wa_ai_test_context(p_workspace_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.wa_ai_settings;
begin
  if not public.can_admin_write(p_workspace_id, 'leads') then raise exception 'Only admins can test the assistant.'; end if;
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

create or replace function public.wa_ai_add_test_usage(p_workspace_id uuid, p_input_tokens int, p_output_tokens int)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.wa_ai_usage (workspace_id, month, replies, input_tokens, output_tokens)
  values (p_workspace_id, private.ist_month(), 1, greatest(p_input_tokens, 0), greatest(p_output_tokens, 0))
  on conflict (workspace_id, month) do update
  set replies = public.wa_ai_usage.replies + 1,
      input_tokens = public.wa_ai_usage.input_tokens + excluded.input_tokens,
      output_tokens = public.wa_ai_usage.output_tokens + excluded.output_tokens;
$$;

revoke execute on function public.wa_ai_context(uuid) from public, anon, authenticated;
revoke execute on function public.wa_ai_record(uuid, text, boolean, text, text, jsonb, text, int, int) from public, anon, authenticated;
revoke execute on function public.wa_ai_add_test_usage(uuid, int, int) from public, anon, authenticated;
grant execute on function public.wa_ai_context(uuid) to service_role;
grant execute on function public.wa_ai_record(uuid, text, boolean, text, text, jsonb, text, int, int) to service_role;
grant execute on function public.wa_ai_add_test_usage(uuid, int, int) to service_role;
revoke execute on function public.wa_set_handler(uuid, text) from public, anon;
revoke execute on function public.wa_ai_test_context(uuid) from public, anon;
grant execute on function public.wa_set_handler(uuid, text) to authenticated;
grant execute on function public.wa_ai_test_context(uuid) to authenticated;
revoke execute on function private.ist_month() from public, anon, authenticated;
