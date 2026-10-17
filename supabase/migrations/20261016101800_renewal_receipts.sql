-- Companies renew after their plan has ended, so admins may attach a renewal
-- receipt even when the workspace is expired (but not when suspended).
create policy files_insert_renewal on public.files for insert to authenticated
  with check (
    entity_type = 'renewal'
    and public.is_workspace_admin(workspace_id)
    and public.workspace_status(workspace_id) <> 'suspended'
    and uploaded_by = (select auth.uid())
  );
