-- Sign-up asks only for email, password and PIN. The name and phone the
-- admin entered travel with the PIN and fill in the new person's profile.
alter table public.access_pins add column full_name text, add column phone text;
grant select (full_name, phone) on public.access_pins to authenticated;

-- Retire the old six-argument version (renamed and locked, so calls can't
-- become ambiguous between the two).
alter function public.issue_access_pin(public.pin_purpose, uuid, public.member_role, text, uuid, int)
  rename to issue_access_pin_retired;
revoke execute on function public.issue_access_pin_retired(public.pin_purpose, uuid, public.member_role, text, uuid, int)
  from public, anon, authenticated;
create or replace function public.issue_access_pin(
  p_purpose public.pin_purpose,
  p_workspace_id uuid default null,
  p_role public.member_role default null,
  p_email text default null,
  p_target_user_id uuid default null,
  p_valid_days int default 7,
  p_full_name text default null,
  p_phone text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_pin text;
  v_id uuid;
  v_target_role public.member_role;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first.';
  end if;
  if p_valid_days not between 1 and 30 then
    raise exception 'A PIN can be valid for 1 to 30 days.';
  end if;

  if p_purpose = 'platform_admin' then
    if not public.is_platform_admin() then
      raise exception 'Only the Super Admin can issue this PIN.';
    end if;
  elsif p_purpose = 'signup' then
    if p_workspace_id is null or p_role is null then
      raise exception 'Choose a workspace and a role.';
    end if;
    if not public.is_platform_admin() then
      if p_role = 'owner' then
        raise exception 'Only the Super Admin can issue owner PINs.';
      end if;
      if not public.can_admin_write(p_workspace_id) then
        raise exception 'Only an owner or admin of an active workspace can issue PINs.';
      end if;
    end if;
  elsif p_purpose = 'reset' then
    if p_target_user_id is null then
      raise exception 'Choose who the reset PIN is for.';
    end if;
    if not public.is_platform_admin() then
      select role into v_target_role from public.workspace_members
      where workspace_id = p_workspace_id and user_id = p_target_user_id;
      if v_target_role is null or not public.is_workspace_admin(p_workspace_id) then
        raise exception 'You can only reset passwords for members of your workspace.';
      end if;
      if v_target_role = 'owner' then
        raise exception 'Owner passwords are reset by the Super Admin.';
      end if;
    end if;
    -- Any older unused reset PIN for this person stops working.
    update public.access_pins set revoked_at = now()
    where target_user_id = p_target_user_id and purpose = 'reset' and used_at is null and revoked_at is null;
  end if;

  loop
    v_pin := private.new_pin();
    begin
      insert into public.access_pins
        (purpose, workspace_id, role, email, full_name, phone, target_user_id, pin_hash, pin_hint, expires_at, issued_by)
      values
        (p_purpose, p_workspace_id, p_role, nullif(lower(trim(p_email)), ''),
         nullif(trim(p_full_name), ''), nullif(trim(p_phone), ''), p_target_user_id,
         private.hash_pin(v_pin), right(v_pin, 2), now() + make_interval(days => p_valid_days),
         (select auth.uid()))
      returning id into v_id;
      exit;
    exception when unique_violation then
      -- astronomically unlikely; draw again
    end;
  end loop;

  if public.is_platform_admin() then
    insert into public.admin_audit_log (actor_id, workspace_id, action, details)
    values ((select auth.uid()), p_workspace_id, 'pin_issued',
            jsonb_build_object('purpose', p_purpose, 'role', p_role, 'pin_id', v_id));
  end if;

  return jsonb_build_object('id', v_id, 'pin', v_pin,
    'expires_at', now() + make_interval(days => p_valid_days));
end;
$$;
revoke execute on function public.issue_access_pin(public.pin_purpose, uuid, public.member_role, text, uuid, int, text, text) from public, anon;
grant execute on function public.issue_access_pin(public.pin_purpose, uuid, public.member_role, text, uuid, int, text, text) to authenticated;

create or replace function public.admin_create_workspace(
  p_name text,
  p_slug text,
  p_plan_id uuid,
  p_owner_name text,
  p_owner_email text default null,
  p_owner_phone text default null,
  p_trial_days int default null,   -- NULL = platform default
  p_valid_until timestamptz default null -- set instead of a trial for paid starts
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_until timestamptz;
  v_state public.subscription_state;
  v_pin jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Only the Super Admin can create workspaces.';
  end if;
  if p_valid_until is not null then
    v_until := p_valid_until;
    v_state := 'active';
  else
    v_until := now() + make_interval(days => coalesce(p_trial_days, (select trial_days from public.platform_settings)));
    v_state := 'trial';
  end if;

  insert into public.workspaces (name, slug, plan_id, state, valid_until, owner_name, owner_email, owner_phone, created_by)
  values (trim(p_name), lower(trim(p_slug)), p_plan_id, v_state, v_until, p_owner_name,
          nullif(lower(trim(p_owner_email)), ''), p_owner_phone, (select auth.uid()))
  returning id into v_ws;

  insert into public.admin_audit_log (actor_id, workspace_id, action, details)
  values ((select auth.uid()), v_ws, 'workspace_created',
          jsonb_build_object('plan_id', p_plan_id, 'state', v_state, 'valid_until', v_until));

  v_pin := public.issue_access_pin('signup', v_ws, 'owner', p_owner_email, null, 7, p_owner_name, p_owner_phone);
  return jsonb_build_object('workspace_id', v_ws, 'owner_pin', v_pin);
end;
$$;

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
  values (p_user_id, lower(trim(p_email)),
          coalesce(nullif(trim(p_full_name), ''), v_pin.full_name, ''),
          coalesce(nullif(trim(p_phone), ''), v_pin.phone))
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
