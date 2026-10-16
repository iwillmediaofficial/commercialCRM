-- PIN lockout counts failures per email and per device separately, so five
-- wrong tries lock that email (or that device), not three.
create or replace function public.pin_check(p_pin text, p_email text, p_purpose public.pin_purpose, p_client_key text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(p_email));
  v_keys text[] := array['email:' || v_email, 'ip:' || coalesce(p_client_key, 'unknown')];
  v_pin public.access_pins;
  v_target_email text;
begin
  -- Lock when any one key (the email or the device) has 5 recent failures.
  if exists (select 1 from private.pin_attempts
             where key = any (v_keys) and not success and attempted_at > now() - interval '15 minutes'
             group by key having count(*) >= 5) then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  end if;

  select * into v_pin from public.access_pins
  where pin_hash = private.hash_pin(p_pin) and purpose = p_purpose;

  if v_pin.id is null or v_pin.used_at is not null or v_pin.revoked_at is not null
     or v_pin.expires_at < now()
     or (v_pin.email is not null and v_pin.email <> v_email) then
    insert into private.pin_attempts (key, success) select k, false from unnest(v_keys) k;
    return jsonb_build_object('ok', false, 'error', 'invalid_pin');
  end if;

  if p_purpose = 'reset' then
    select lower(email) into v_target_email from auth.users where id = v_pin.target_user_id;
    if v_target_email is distinct from v_email then
      insert into private.pin_attempts (key, success) select k, false from unnest(v_keys) k;
      return jsonb_build_object('ok', false, 'error', 'invalid_pin');
    end if;
  end if;

  if v_pin.workspace_id is not null and public.workspace_status(v_pin.workspace_id) in ('suspended', 'expired')
     and p_purpose = 'signup' then
    return jsonb_build_object('ok', false, 'error', 'workspace_inactive');
  end if;

  return jsonb_build_object('ok', true, 'pin_id', v_pin.id, 'purpose', v_pin.purpose,
    'workspace_id', v_pin.workspace_id, 'role', v_pin.role, 'target_user_id', v_pin.target_user_id);
end;
$$;
