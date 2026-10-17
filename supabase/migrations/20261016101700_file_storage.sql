-- File storage (Cloudflare R2). Files rows are the index; objects live in R2
-- under "<workspace_id>/...". The `files` Edge Function signs short-lived links.

-- Renewal receipts and lead form logos/banners are files too.
alter table public.files drop constraint files_entity_type_check;
alter table public.files add constraint files_entity_type_check
  check (entity_type in ('work_item', 'client', 'lead', 'invoice', 'workspace', 'profile', 'renewal', 'lead_form'));

-- Total bytes a company stores, for the Super Admin directory and limits later.
create or replace function public.workspace_storage_bytes(p_workspace_id uuid)
returns bigint
language sql stable security definer
set search_path = ''
as $$
  select case when public.is_workspace_member(p_workspace_id) or public.is_platform_admin()
              then coalesce((select sum(size_bytes) from public.files where workspace_id = p_workspace_id), 0)
         end;
$$;
revoke execute on function public.workspace_storage_bytes(uuid) from public, anon;
grant execute on function public.workspace_storage_bytes(uuid) to authenticated;
