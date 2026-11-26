-- Assets & documents files work even when a company's file attachments
-- switch is off (owner chose this 2026-11-26). Still owner/admin only.
alter policy files_company_record_admin on public.files
  with check (entity_type <> 'company_record' or public.is_workspace_admin(workspace_id));
