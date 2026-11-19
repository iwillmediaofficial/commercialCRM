-- ---------------------------------------------------------------------------
-- WhatsApp Inbox (WhatsApp AI chat agent plan, phase 1)
--
-- A company's WhatsApp Business number is linked by the Super Admin. Messages
-- customers send to it arrive through the `whatsapp-webhook` Edge Function,
-- are stored here, and are matched to a lead (or create one). Staff reply from
-- the Inbox page through the `whatsapp-send` Edge Function. No AI yet.
-- ---------------------------------------------------------------------------

-- Super Admin switch per company (the "WhatsApp AI" add-on).
alter table public.workspaces add column if not exists whatsapp_enabled boolean not null default false;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.whatsapp_numbers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Meta's "Phone number ID" (not the phone number itself). Unique across all companies.
  phone_number_id text not null unique check (phone_number_id ~ '^[0-9]{5,30}$'),
  display_phone text check (display_phone is null or length(display_phone) <= 40),
  waba_id text check (waba_id is null or waba_id ~ '^[0-9]{5,30}$'),
  label text check (label is null or length(label) <= 80),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index whatsapp_numbers_ws_idx on public.whatsapp_numbers(workspace_id);

create table public.wa_chats (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  number_id uuid not null references public.whatsapp_numbers(id) on delete cascade,
  wa_id text not null check (wa_id ~ '^[0-9]{6,20}$'), -- customer's number, digits with country code
  contact_name text check (contact_name is null or length(contact_name) <= 200),
  lead_id uuid references public.leads(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'closed')),
  -- Who answers: staff by hand for now; the AI comes in phase 2.
  handler text not null default 'human' check (handler in ('human', 'ai')),
  unread_count int not null default 0 check (unread_count >= 0),
  last_message_at timestamptz,
  last_message_preview text,
  last_inbound_at timestamptz, -- the 24-hour reply window runs from here
  created_at timestamptz not null default now(),
  unique (number_id, wa_id)
);
create index wa_chats_ws_idx on public.wa_chats(workspace_id, last_message_at desc);
create index wa_chats_lead_idx on public.wa_chats(lead_id);

create table public.wa_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  chat_id uuid not null references public.wa_chats(id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  sender text not null check (sender in ('customer', 'staff', 'ai', 'system')),
  sent_by uuid references auth.users(id) on delete set null,
  type text not null default 'text', -- text, image, document, audio, video, sticker, location, contacts, ...
  body text check (body is null or length(body) <= 4096),
  media jsonb,
  wa_message_id text unique,
  status text not null default 'received'
    check (status in ('received', 'sending', 'sent', 'delivered', 'read', 'failed')),
  error text,
  created_at timestamptz not null default now()
);
create index wa_messages_chat_idx on public.wa_messages(chat_id, created_at);
create index wa_messages_ws_idx on public.wa_messages(workspace_id, created_at desc);
create index wa_messages_sent_by_idx on public.wa_messages(sent_by);

alter table public.whatsapp_numbers enable row level security;
alter table public.wa_chats enable row level security;
alter table public.wa_messages enable row level security;

-- ---------------------------------------------------------------------------
-- Who sees what: admins see every chat; staff see chats whose lead is theirs.
-- Changes go through the functions below, never straight from the browser.
-- ---------------------------------------------------------------------------
create or replace function public.can_see_wa_chat(p_ws uuid, p_lead uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.is_platform_admin()
      or public.is_workspace_admin(p_ws)
      or (p_lead is not null and public.is_workspace_member(p_ws)
          and exists (select 1 from public.leads l
                      where l.id = p_lead and l.workspace_id = p_ws
                        and (l.assigned_to = (select auth.uid()) or l.created_by = (select auth.uid()))));
$$;
revoke execute on function public.can_see_wa_chat(uuid, uuid) from public, anon;
grant execute on function public.can_see_wa_chat(uuid, uuid) to authenticated;

create policy whatsapp_numbers_read on public.whatsapp_numbers for select to authenticated
  using (public.is_workspace_admin(workspace_id) or public.is_platform_admin());
create policy whatsapp_numbers_admin on public.whatsapp_numbers for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy wa_chats_read on public.wa_chats for select to authenticated
  using (public.can_see_wa_chat(workspace_id, lead_id));

create policy wa_messages_read on public.wa_messages for select to authenticated
  using (exists (select 1 from public.wa_chats c
                 where c.id = chat_id and public.can_see_wa_chat(c.workspace_id, c.lead_id)));

-- Live updates for the Inbox (row-level security still applies).
alter publication supabase_realtime add table public.wa_chats, public.wa_messages;

-- ---------------------------------------------------------------------------
-- Incoming message (called by the webhook with the service key only).
-- Finds the company by Meta's phone number ID, stores the message once,
-- matches the customer to a lead by the last 10 digits of the phone, or
-- creates a lead with source "WhatsApp" and hands it out like any new lead.
-- ---------------------------------------------------------------------------
create or replace function public.wa_receive(
  p_phone_number_id text, p_wa_id text, p_name text, p_wa_message_id text,
  p_type text, p_body text, p_media jsonb default null, p_sent_at timestamptz default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  n public.whatsapp_numbers;
  w public.workspaces;
  c public.wa_chats;
  s public.workspace_settings;
  v_wa text := regexp_replace(coalesce(p_wa_id, ''), '\D', '', 'g');
  v_last10 text;
  v_name text := nullif(left(btrim(coalesce(p_name, '')), 200), '');
  v_at timestamptz := least(coalesce(p_sent_at, now()), now());
  v_lead uuid;
  v_assignee uuid;
  v_preview text;
  v_msg uuid;
begin
  select * into n from public.whatsapp_numbers where phone_number_id = p_phone_number_id and is_active;
  if n.id is null then return jsonb_build_object('ok', false, 'reason', 'unknown_number'); end if;
  select * into w from public.workspaces where id = n.workspace_id;
  if not w.whatsapp_enabled or public.workspace_status(w.id) = 'suspended' then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;
  if v_wa !~ '^[0-9]{6,20}$' then return jsonb_build_object('ok', false, 'reason', 'bad_number'); end if;

  -- Same message delivered twice by Meta: keep one.
  if p_wa_message_id is not null and exists (select 1 from public.wa_messages where wa_message_id = p_wa_message_id) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  insert into public.wa_chats (workspace_id, number_id, wa_id, contact_name)
  values (w.id, n.id, v_wa, v_name)
  on conflict (number_id, wa_id) do update set contact_name = coalesce(excluded.contact_name, public.wa_chats.contact_name)
  returning * into c;

  -- Link a lead the first time (or again if the old one was deleted).
  if c.lead_id is null and public.workspace_has_module(w.id, 'leads') then
    v_last10 := right(v_wa, 10);
    select l.id into v_lead from public.leads l
    where l.workspace_id = w.id and l.phone is not null
      and right(regexp_replace(l.phone, '\D', '', 'g'), 10) = v_last10
    order by (l.stage in ('won', 'lost')), l.created_at desc
    limit 1;

    if v_lead is null then
      insert into public.leads (workspace_id, name, phone, source)
      values (w.id, coalesce(v_name, '+' || v_wa), '+' || v_wa, 'WhatsApp')
      returning id into v_lead;
      -- Hand it out like a form lead when automatic assignment is on.
      select * into s from public.workspace_settings where workspace_id = w.id;
      if coalesce(s.auto_assign_enabled, false) then
        v_assignee := private.pick_lead_assignee(w.id, null);
        if v_assignee is not null then
          update public.leads set assigned_to = v_assignee, auto_assigned = true where id = v_lead;
        end if;
      end if;
      insert into public.notifications (workspace_id, user_id, type, title, message, link)
      select w.id, m.user_id, 'lead', 'New WhatsApp lead: ' || coalesce(v_name, '+' || v_wa),
             'Started a chat on WhatsApp', '/whatsapp?chat=' || c.id
      from public.workspace_members m
      where m.workspace_id = w.id and m.role in ('owner', 'admin') and m.is_active;
    end if;
    update public.wa_chats set lead_id = v_lead where id = c.id;
    c.lead_id := v_lead;
  end if;

  v_preview := left(coalesce(nullif(btrim(p_body), ''), '[' || initcap(coalesce(p_type, 'message')) || ']'), 160);
  insert into public.wa_messages (workspace_id, chat_id, direction, sender, type, body, media, wa_message_id, status, created_at)
  values (w.id, c.id, 'in', 'customer', coalesce(nullif(p_type, ''), 'text'), left(p_body, 4096), p_media,
          p_wa_message_id, 'received', v_at)
  returning id into v_msg;

  -- Tell the lead's owner on the first unread message (not on every one).
  if c.unread_count = 0 and c.lead_id is not null then
    insert into public.notifications (workspace_id, user_id, type, title, message, link)
    select w.id, l.assigned_to, 'lead', 'WhatsApp from ' || coalesce(v_name, l.name), v_preview, '/whatsapp?chat=' || c.id
    from public.leads l
    where l.id = c.lead_id and l.assigned_to is not null;
  end if;

  update public.wa_chats
  set unread_count = unread_count + 1,
      status = 'open',
      last_message_at = greatest(coalesce(last_message_at, v_at), v_at),
      last_message_preview = v_preview,
      last_inbound_at = greatest(coalesce(last_inbound_at, v_at), v_at)
  where id = c.id;

  return jsonb_build_object('ok', true, 'chat_id', c.id, 'message_id', v_msg, 'lead_id', c.lead_id);
end;
$$;

-- Delivery receipts from Meta. Statuses only move forward.
create or replace function public.wa_status(p_wa_message_id text, p_status text, p_error text default null)
returns void
language sql security definer
set search_path = ''
as $$
  update public.wa_messages
  set status = p_status,
      error = case when p_status = 'failed' then left(coalesce(p_error, 'Not delivered'), 500) else error end
  where wa_message_id = p_wa_message_id
    and p_status in ('sent', 'delivered', 'read', 'failed')
    and (p_status = 'failed'
         or array_position(array['sending', 'sent', 'delivered', 'read'], p_status)
            > coalesce(array_position(array['sending', 'sent', 'delivered', 'read'], status), 0));
$$;

-- ---------------------------------------------------------------------------
-- Staff reply, step 1 (called by `whatsapp-send` as the signed-in person).
-- Checks they may reply, stores the message as "sending" and returns what the
-- function needs to send it. The first reply in a while also goes on the lead's
-- timeline, which counts as contact for the 1-hour rule.
-- ---------------------------------------------------------------------------
create or replace function public.wa_prepare_send(p_chat_id uuid, p_body text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  c public.wa_chats;
  l public.leads;
  v_uid uuid := (select auth.uid());
  v_body text := btrim(coalesce(p_body, ''));
  v_msg uuid;
  v_phone_id text;
begin
  select * into c from public.wa_chats where id = p_chat_id;
  if c.id is null or not public.can_see_wa_chat(c.workspace_id, c.lead_id) then
    raise exception 'Chat not found.';
  end if;
  if not public.can_write(c.workspace_id)
     or not (select whatsapp_enabled from public.workspaces where id = c.workspace_id) then
    raise exception 'WhatsApp replies are not available for this company right now.';
  end if;
  if v_body = '' then raise exception 'Type a message first.'; end if;
  if length(v_body) > 4096 then raise exception 'Messages can be up to 4,096 characters.'; end if;
  if c.last_inbound_at is null or c.last_inbound_at < now() - interval '24 hours' then
    raise exception 'The 24-hour reply window has closed. The customer has to message again before you can reply.';
  end if;
  if c.lead_id is not null then
    select * into l from public.leads where id = c.lead_id;
    if private.is_lead_stuck(c.workspace_id, v_uid) and not coalesce(l.follow_up_at < now(), false) then
      raise exception 'Clear your overdue follow-ups first. Replies are locked until then.';
    end if;
  end if;
  select phone_number_id into v_phone_id from public.whatsapp_numbers where id = c.number_id and is_active;
  if v_phone_id is null then raise exception 'This WhatsApp number is no longer connected.'; end if;

  insert into public.wa_messages (workspace_id, chat_id, direction, sender, sent_by, type, body, status)
  values (c.workspace_id, c.id, 'out', 'staff', v_uid, 'text', v_body, 'sending')
  returning id into v_msg;

  update public.wa_chats
  set unread_count = 0, status = 'open', last_message_at = now(), last_message_preview = left(v_body, 160)
  where id = c.id;

  -- Timeline + contact, at most once per person per lead every 30 minutes.
  if c.lead_id is not null and not exists (
    select 1 from public.lead_activities a
    where a.lead_id = c.lead_id and a.kind = 'whatsapp' and a.created_by = v_uid
      and a.created_at > now() - interval '30 minutes'
  ) then
    insert into public.lead_activities (workspace_id, lead_id, kind, body, details, created_by)
    values (c.workspace_id, c.lead_id, 'whatsapp', 'Replied on WhatsApp: ' || left(v_body, 300),
            jsonb_build_object('source', 'inbox', 'chat_id', c.id), v_uid);
  end if;

  return jsonb_build_object('message_id', v_msg, 'phone_number_id', v_phone_id, 'to', c.wa_id);
end;
$$;

-- Staff reply, step 2 (service key only): the result from Meta.
create or replace function public.wa_finish_send(p_message_id uuid, p_wa_message_id text, p_error text default null)
returns void
language sql security definer
set search_path = ''
as $$
  update public.wa_messages
  set wa_message_id = coalesce(p_wa_message_id, wa_message_id),
      status = case when p_error is null then 'sent' else 'failed' end,
      error = left(p_error, 500)
  where id = p_message_id and status = 'sending';
$$;

-- Opening a chat marks it read.
create or replace function public.wa_mark_read(p_chat_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  c public.wa_chats;
begin
  select * into c from public.wa_chats where id = p_chat_id;
  if c.id is null or not public.can_see_wa_chat(c.workspace_id, c.lead_id) or not public.is_workspace_member(c.workspace_id) then
    return;
  end if;
  if c.unread_count > 0 then update public.wa_chats set unread_count = 0 where id = c.id; end if;
end;
$$;

-- Close a finished chat, or reopen it. A new customer message reopens it anyway.
create or replace function public.wa_set_chat_status(p_chat_id uuid, p_status text)
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
  if p_status not in ('open', 'closed') then raise exception 'Unknown status.'; end if;
  update public.wa_chats set status = p_status, unread_count = case when p_status = 'closed' then 0 else unread_count end
  where id = c.id;
end;
$$;

revoke execute on function public.wa_receive(text, text, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.wa_status(text, text, text) from public, anon, authenticated;
revoke execute on function public.wa_finish_send(uuid, text, text) from public, anon, authenticated;
grant execute on function public.wa_receive(text, text, text, text, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.wa_status(text, text, text) to service_role;
grant execute on function public.wa_finish_send(uuid, text, text) to service_role;
revoke execute on function public.wa_prepare_send(uuid, text) from public, anon;
revoke execute on function public.wa_mark_read(uuid) from public, anon;
revoke execute on function public.wa_set_chat_status(uuid, text) from public, anon;
grant execute on function public.wa_prepare_send(uuid, text) to authenticated;
grant execute on function public.wa_mark_read(uuid) to authenticated;
grant execute on function public.wa_set_chat_status(uuid, text) to authenticated;
