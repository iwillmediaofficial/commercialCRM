-- Assets & documents files (owner's choice, 2026-11-26):
-- 1. They work even when a company's file attachments switch is off. Still owner/admin only.
-- 2. Limits: 10 MB per file and 100 MB per company by default. The Super Admin
--    changes the defaults in Settings and can set a company's own limits on
--    its Companies page (blank = use the default).

alter policy files_company_record_admin on public.files
  with check (entity_type <> 'company_record' or public.is_workspace_admin(workspace_id));

alter table public.platform_settings
  add column if not exists record_file_max_mb int not null default 10 check (record_file_max_mb between 1 and 20),
  add column if not exists record_storage_mb int not null default 100 check (record_storage_mb >= 1);

alter table public.workspaces
  add column if not exists record_file_max_mb int check (record_file_max_mb between 1 and 20),
  add column if not exists record_storage_mb int check (record_storage_mb >= 1);

-- The limits that apply to a company, and how much it has used.
create or replace function public.company_record_file_limits(p_ws uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case when public.is_workspace_member(p_ws) or public.is_platform_admin() then
    jsonb_build_object(
      'file_mb', coalesce(w.record_file_max_mb, s.record_file_max_mb),
      'total_mb', coalesce(w.record_storage_mb, s.record_storage_mb),
      'used_bytes', (select coalesce(sum(f.size_bytes), 0) from public.files f
                     where f.workspace_id = p_ws and f.entity_type = 'company_record')
    )
  end
  from public.workspaces w cross join public.platform_settings s
  where w.id = p_ws;
$$;
revoke execute on function public.company_record_file_limits(uuid) from public, anon;
grant execute on function public.company_record_file_limits(uuid) to authenticated;

-- Checked when the upload is recorded; the files function then removes the
-- stored copy and shows this message.
create or replace function private.check_company_record_file()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_file_mb int;
  v_total_mb int;
  v_used bigint;
begin
  if new.entity_type <> 'company_record' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('company_record_files:' || new.workspace_id::text));
  select coalesce(w.record_file_max_mb, s.record_file_max_mb), coalesce(w.record_storage_mb, s.record_storage_mb)
    into v_file_mb, v_total_mb
  from public.workspaces w cross join public.platform_settings s
  where w.id = new.workspace_id;
  if new.size_bytes > v_file_mb::bigint * 1024 * 1024 then
    raise exception 'Files here can be up to % MB.', v_file_mb;
  end if;
  select coalesce(sum(size_bytes), 0) into v_used from public.files
  where workspace_id = new.workspace_id and entity_type = 'company_record';
  if v_used + new.size_bytes > v_total_mb::bigint * 1024 * 1024 then
    raise exception 'Assets & documents storage is full (% MB). Delete old files or ask the Super Admin for more space.', v_total_mb;
  end if;
  return new;
end;
$$;
create trigger files_company_record_limits before insert on public.files
  for each row execute function private.check_company_record_file();
