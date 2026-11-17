-- ---------------------------------------------------------------------------
-- Tapping Call or WhatsApp now logs the contact straight away, before any note
-- is written. The latest remark shown on the lead list should skip those
-- note-less entries instead of going blank.
-- ---------------------------------------------------------------------------
create or replace function private.refresh_last_remark(p_lead uuid)
returns void
language sql security definer
set search_path = ''
as $$
  update public.leads l
  set (last_remark, last_remark_at) = (
    select left(x.body, 300), x.created_at from public.lead_activities x
    where x.lead_id = p_lead and x.kind in ('remark', 'call', 'whatsapp', 'meeting') and x.body is not null
    order by x.created_at desc limit 1
  )
  where l.id = p_lead;
$$;
