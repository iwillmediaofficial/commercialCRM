-- Refuse new staff/admin sign-up PINs once the plan's seats are all taken.
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
  v_limit int;
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
    -- Don't hand out a PIN that can't be used: active members plus PINs still
    -- waiting to be used must stay within the plan's seats.
    if p_role <> 'owner' then
      select p.staff_limit into v_limit
      from public.workspaces w join public.plans p on p.id = w.plan_id
      where w.id = p_workspace_id;
      if v_limit is not null and
         (select count(*) from public.workspace_members
          where workspace_id = p_workspace_id and is_active)
         + (select count(*) from public.access_pins
            where workspace_id = p_workspace_id and purpose = 'signup' and role <> 'owner'
              and used_at is null and revoked_at is null and expires_at > now()) >= v_limit then
        raise exception 'All % seats on this plan are taken (including unused PINs). Deactivate someone, revoke an unused PIN, or upgrade the plan.', v_limit
          using hint = 'seat_limit';
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
