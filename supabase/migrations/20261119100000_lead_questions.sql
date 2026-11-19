-- ---------------------------------------------------------------------------
-- Follow-up desk, phase 1: quick-check questions.
--
-- Each company keeps its own short list of questions staff answer about a lead
-- (default: Genuine lead? / Details sent? / Interest). Answers live on the lead
-- as {question key: chosen option}, and every change lands on the timeline.
-- ---------------------------------------------------------------------------

alter table public.workspace_settings
  add column if not exists lead_questions jsonb not null default '[
    {"key": "genuine", "label": "Genuine lead?", "options": ["Yes", "No", "Not sure"]},
    {"key": "details_sent", "label": "Details sent?", "options": ["Yes", "No"]},
    {"key": "interest", "label": "Interest", "options": ["Hot", "Warm", "Cold"], "show_in_list": true}
  ]'::jsonb
  check (jsonb_typeof(lead_questions) = 'array' and jsonb_array_length(lead_questions) <= 10
         and pg_column_size(lead_questions) <= 8000);

alter table public.leads
  add column if not exists answers jsonb not null default '{}'::jsonb
  check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 4000);

-- A new kind of timeline entry for answer changes.
alter table public.lead_activities drop constraint if exists lead_activities_kind_check;
alter table public.lead_activities add constraint lead_activities_kind_check
  check (kind in ('remark', 'call', 'whatsapp', 'meeting',
                  'created', 'stage', 'assigned', 'follow_up', 'converted', 'answers'));

create or replace function private.log_lead_changes()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    insert into public.lead_activities (workspace_id, lead_id, kind, details, created_by, created_at)
    values (new.workspace_id, new.id, 'created',
            jsonb_build_object('source', new.source, 'form_id', new.form_id, 'stage', new.stage,
                               'assigned_to', new.assigned_to, 'auto', new.auto_assigned),
            v_actor, new.created_at);
    return null;
  end if;

  if new.stage is distinct from old.stage then
    insert into public.lead_activities (workspace_id, lead_id, kind, details, created_by)
    values (new.workspace_id, new.id, 'stage',
            jsonb_strip_nulls(jsonb_build_object('from', old.stage, 'to', new.stage, 'reason', new.lost_reason)), v_actor);
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.lead_activities (workspace_id, lead_id, kind, details, created_by)
    values (new.workspace_id, new.id, 'assigned',
            jsonb_strip_nulls(jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to,
              'reason', nullif(current_setting('app.assign_reason', true), ''),
              'minutes', nullif(current_setting('app.pass_on_minutes', true), '')::int)),
            v_actor);
  end if;
  if new.follow_up_at is distinct from old.follow_up_at and new.stage not in ('won', 'lost') then
    insert into public.lead_activities (workspace_id, lead_id, kind, details, created_by)
    values (new.workspace_id, new.id, 'follow_up', jsonb_build_object('from', old.follow_up_at, 'to', new.follow_up_at), v_actor);
  end if;
  if new.answers is distinct from old.answers then
    insert into public.lead_activities (workspace_id, lead_id, kind, details, created_by)
    values (new.workspace_id, new.id, 'answers', jsonb_build_object('from', old.answers, 'to', new.answers), v_actor);
  end if;
  if new.converted_client_id is not null and old.converted_client_id is null then
    insert into public.lead_activities (workspace_id, lead_id, kind, details, created_by)
    values (new.workspace_id, new.id, 'converted', jsonb_build_object('client_id', new.converted_client_id), v_actor);
  end if;
  return null;
end;
$$;

create or replace trigger leads_log_changes
  after insert or update of stage, assigned_to, follow_up_at, follow_up_date, converted_client_id, answers
  on public.leads for each row execute function private.log_lead_changes();
