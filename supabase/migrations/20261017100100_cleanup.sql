-- Run once in Supabase > SQL Editor (the deploy tool here can't run deletes).
-- ---------------------------------------------------------------------------
-- Monthly cleanup: activity older than 6 months, read notifications older
-- than 3 months, error reports older than 1 month.
-- ---------------------------------------------------------------------------
create or replace function private.cleanup_old_records()
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_activity int;
  v_notifications int;
  v_errors int;
begin
  delete from public.activity_logs where created_at < now() - interval '6 months';
  get diagnostics v_activity = row_count;
  delete from public.notifications where is_read and created_at < now() - interval '3 months';
  get diagnostics v_notifications = row_count;
  delete from public.app_errors where created_at < now() - interval '1 month';
  get diagnostics v_errors = row_count;
  return jsonb_build_object('activity_logs', v_activity, 'notifications', v_notifications, 'app_errors', v_errors);
end;
$$;

select cron.schedule('cleanup-old-records', '0 2 1 * *', $$select private.cleanup_old_records()$$);
