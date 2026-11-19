-- Staff can add their own work: a per-person switch the owner or an admin turns on.
-- With it, a staff member can create work items that are assigned to themselves only,
-- and edit the details of items they created. Billable fields, assigning other people
-- and deleting stay with admins.

alter table public.workspace_members
  add column if not exists can_add_own_work boolean not null default false;

-- True when the signed-in person is an active member of the workspace with the switch on.
create or replace function public.can_add_own_work(ws uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select m.can_add_own_work from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid()) and m.is_active
  ), false);
$$;
revoke execute on function public.can_add_own_work(uuid) from public, anon;
grant execute on function public.can_add_own_work(uuid) to authenticated;

-- True when the signed-in person created this work item.
create or replace function public.created_work_item(p_work_item uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.work_items
    where id = p_work_item and created_by = (select auth.uid())
  );
$$;
revoke execute on function public.created_work_item(uuid) from public, anon;
grant execute on function public.created_work_item(uuid) to authenticated;

-- Insert: admins as before; staff with the switch only for themselves and never billable.
alter policy work_items_insert on public.work_items
  with check (
    public.can_admin_write(workspace_id, 'work')
    or (
      public.can_write(workspace_id, 'work')
      and public.can_add_own_work(workspace_id)
      and created_by = (select auth.uid())
      and not is_billable
      and billable_amount is null
    )
  );

-- Update: also items a staff member created while their switch is on.
alter policy work_items_update on public.work_items
  using (
    public.can_admin_write(workspace_id, 'work')
    or (public.can_write(workspace_id, 'work') and public.is_assigned_to_work_item(id))
    or (public.can_write(workspace_id, 'work') and public.can_add_own_work(workspace_id) and created_by = (select auth.uid()))
  )
  with check (
    public.can_admin_write(workspace_id, 'work')
    or (public.can_write(workspace_id, 'work') and public.is_assigned_to_work_item(id))
    or (public.can_write(workspace_id, 'work') and public.can_add_own_work(workspace_id) and created_by = (select auth.uid()))
  );

-- Staff may change status, checklist and position on their items; on items they created
-- (with the switch on) also the details, but never billing, ownership or the workspace.
create or replace function private.limit_staff_work_item_update()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or public.is_workspace_admin(new.workspace_id) then
    return new;
  end if;
  if old.created_by = (select auth.uid()) and public.can_add_own_work(new.workspace_id) then
    if (to_jsonb(new) - array['title', 'description', 'client_id', 'status', 'priority', 'start_date', 'due_date',
                              'estimated_hours', 'checklist', 'position', 'completed_at', 'updated_at'])
       is distinct from
       (to_jsonb(old) - array['title', 'description', 'client_id', 'status', 'priority', 'start_date', 'due_date',
                              'estimated_hours', 'checklist', 'position', 'completed_at', 'updated_at']) then
      raise exception 'Only an admin can change billing on a work item.';
    end if;
    return new;
  end if;
  if (to_jsonb(new) - array['status', 'checklist', 'position', 'completed_at', 'updated_at'])
     is distinct from (to_jsonb(old) - array['status', 'checklist', 'position', 'completed_at', 'updated_at']) then
    raise exception 'Staff can only change the status and checklist of their work items.';
  end if;
  return new;
end;
$$;

-- Assignees: staff with the switch can add only themselves, only to items they created.
create policy assignees_self_insert on public.work_item_assignees for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.can_write(workspace_id, 'work')
    and public.can_add_own_work(workspace_id)
    and public.created_work_item(work_item_id)
    and exists (select 1 from public.work_items w where w.id = work_item_id and w.workspace_id = work_item_assignees.workspace_id)
  );
