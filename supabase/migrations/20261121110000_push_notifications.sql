-- Phone alerts (Web Push) for the installable app.
--
-- Each phone or computer that turns on alerts saves a push address here.
-- Every new row in public.notifications (new lead, follow-up due, and the rest
-- of the bell's items) is handed to the "push" Edge Function, which sends it to
-- that person's devices. The function makes its own VAPID keys on first use and
-- keeps them in private.app_secrets, so nothing has to be set up by hand.

create extension if not exists pg_net with schema extensions;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  device text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_read on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));
grant select, delete on public.push_subscriptions to authenticated;
-- Saving goes through save_push_subscription() so a shared phone moves to whoever signed in last.

-- Set once a notification has been pushed, so it is never sent twice.
alter table public.notifications add column if not exists pushed_at timestamptz;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_device text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 or length(p_p256dh) > 200 or length(p_auth) > 100 then
    raise exception 'Bad push address';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_device, 200))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        device = excluded.device, created_at = now();
end;
$$;
revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- VAPID keys for the push function (service role only).
create or replace function public.push_get_keys()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'public', (select value from private.app_secrets where name = 'vapid_public'),
    'private', (select value from private.app_secrets where name = 'vapid_private'));
$$;

create or replace function public.push_store_keys(p_public text, p_private text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  -- First writer wins; later calls keep the existing pair.
  insert into private.app_secrets (name, value) values ('vapid_public', p_public) on conflict (name) do nothing;
  insert into private.app_secrets (name, value) values ('vapid_private', p_private) on conflict (name) do nothing;
end;
$$;
revoke execute on function public.push_get_keys() from public, anon, authenticated;
revoke execute on function public.push_store_keys(text, text) from public, anon, authenticated;
grant execute on function public.push_get_keys() to service_role;
grant execute on function public.push_store_keys(text, text) to service_role;

-- Hand each new notification to the push function, but only if that person
-- has a device with alerts on. Never lets a failure here stop the notification.
create or replace function private.push_new_notification()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.push_subscriptions s where s.user_id = new.user_id) then
    perform net.http_post(
      url := 'https://zpotoxpaeqeissxycgrz.supabase.co/functions/v1/push',
      body := jsonb_build_object('notification_id', new.id),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 10000
    );
  end if;
  return null;
exception when others then
  return null;
end;
$$;
revoke execute on function private.push_new_notification() from public, anon, authenticated;

create trigger notifications_push
after insert on public.notifications
for each row execute function private.push_new_notification();
