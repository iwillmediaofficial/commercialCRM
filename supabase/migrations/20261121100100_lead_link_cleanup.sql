-- Run once in Supabase > SQL Editor (the deploy tool here can't run deletes).
-- Lead link log: keep 30 days, cleared every night.
create or replace function private.cleanup_lead_link_events()
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v int;
begin
  delete from public.lead_link_events where received_at < now() - interval '30 days';
  get diagnostics v = row_count;
  return v;
end;
$$;
revoke execute on function private.cleanup_lead_link_events() from public, anon, authenticated;

select cron.schedule('lead-link-log-cleanup', '15 2 * * *', $$select private.cleanup_lead_link_events()$$);
