-- Lead timeline, part 2: removing entries.
-- Run in the Supabase SQL Editor (the connector can't run SQL with these keywords).

-- Your own entries for 24 hours; admins any entry people wrote. Automatic ones stay.
create policy lead_activities_delete on public.lead_activities for delete to authenticated
  using (
    kind in ('remark', 'call', 'whatsapp', 'meeting')
    and public.can_write(workspace_id, 'leads')
    and ((created_by = (select auth.uid()) and created_at > now() - interval '24 hours')
         or public.is_workspace_admin(workspace_id))
  );

grant delete on public.lead_activities to authenticated;

drop trigger if exists lead_activities_changed on public.lead_activities;
create trigger lead_activities_changed after insert or update or delete on public.lead_activities
  for each row execute function private.lead_activity_changed();
