-- A PIN redeemed by an existing owner of the same company no longer demotes them.
create or replace function public.pin_consume(p_pin_id uuid, p_user_id uuid, p_email text,
                                              p_full_name text default null, p_phone text default null,
                                              p_client_key text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_pin public.access_pins;
begin
  select * into v_pin from public.access_pins where id = p_pin_id for update;
  if v_pin.id is null or v_pin.used_at is not null or v_pin.revoked_at is not null or v_pin.expires_at < now() then
    raise exception 'This PIN is no longer valid.' using hint = 'invalid_pin';
  end if;

  insert into public.profiles (id, email, full_name, phone)
  values (p_user_id, lower(trim(p_email)), coalesce(nullif(trim(p_full_name), ''), ''), nullif(trim(p_phone), ''))
  on conflict (id) do update
    set full_name = coalesce(nullif(excluded.full_name, ''), public.profiles.full_name),
        phone = coalesce(excluded.phone, public.profiles.phone);

  if v_pin.purpose = 'signup' then
    -- Rejoining reactivates the member. An owner keeps the owner role, and an
    -- owner PIN can't make a second owner (the one-owner index refuses it).
    insert into public.workspace_members (workspace_id, user_id, role)
    values (v_pin.workspace_id, p_user_id, v_pin.role)
    on conflict (workspace_id, user_id) do update
      set is_active = true,
          role = case when public.workspace_members.role = 'owner' then 'owner'::public.member_role
                      else excluded.role end;
  elsif v_pin.purpose = 'platform_admin' then
    insert into public.platform_admins (user_id) values (p_user_id) on conflict do nothing;
  end if;

  update public.access_pins set used_at = now(), used_by = p_user_id where id = p_pin_id;
  insert into private.pin_attempts (key, success)
  values ('email:' || lower(trim(p_email)), true), ('ip:' || coalesce(p_client_key, 'unknown'), true);

  return jsonb_build_object('ok', true, 'workspace_id', v_pin.workspace_id, 'role', v_pin.role);
end;
$$;
