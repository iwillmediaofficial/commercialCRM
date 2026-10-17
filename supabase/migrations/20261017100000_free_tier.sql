-- Staying on the free plans: attachments off until the Super Admin turns them
-- on per company, live updates for the main lists, and a monthly cleanup (next file) so the
-- 500 MB database doesn't fill with old logs.

-- ---------------------------------------------------------------------------
-- Attachments switch (work items, clients, leads, invoices). Logos, avatars,
-- lead form images and renewal receipts are not affected.
-- ---------------------------------------------------------------------------
alter table public.workspaces add column attachments_enabled boolean not null default false;

create policy files_attachments_switch on public.files as restrictive for insert to authenticated
  with check (
    entity_type not in ('work_item', 'client', 'lead', 'invoice')
    or exists (select 1 from public.workspaces w where w.id = workspace_id and w.attachments_enabled)
  );

-- ---------------------------------------------------------------------------
-- Live updates. Row-level security still decides who receives each change.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table
  public.work_items, public.leads, public.clients, public.invoices, public.renewal_requests;
