-- A lead form question about the company (labelled Company, Company name,
-- Business name, Organisation...) now fills the lead's Company field, not
-- just the extra answers.
create or replace function private.company_from_answers(p_answers jsonb)
returns text
language sql immutable
set search_path = ''
as $$
  select left(nullif(trim(value), ''), 200)
  from jsonb_each_text(coalesce(p_answers, '{}'))
  where key ~ '^(company|company_name|your_company|business|business_name|brand|brand_name|organisation|organization|organisation_name|organization_name|firm|firm_name)$'
    and nullif(trim(value), '') is not null
  limit 1;
$$;

create or replace function public.submit_public_lead(p_slug text, p_name text, p_phone text,
                                                     p_email text default null, p_answers jsonb default '{}')
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  f public.lead_forms;
  v_lead uuid;
begin
  select * into f from public.lead_forms where slug = lower(p_slug) and is_active;
  if f.id is null or public.workspace_status(f.workspace_id) = 'suspended'
     or not public.workspace_has_module(f.workspace_id, 'leads') then
    raise exception 'This form is not available.';
  end if;
  if coalesce(trim(p_name), '') = '' or (coalesce(trim(p_phone), '') = '' and coalesce(trim(p_email), '') = '') then
    raise exception 'Name and a phone number or email are required.';
  end if;
  if length(p_name) > 200 or length(coalesce(p_phone, '')) > 40 or length(coalesce(p_email, '')) > 200
     or pg_column_size(p_answers) > 20000 then
    raise exception 'Submission is too large.';
  end if;
  -- Light flood protection: 30 submissions per form per 10 minutes.
  if (select count(*) from public.leads where form_id = f.id and created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'Too many submissions, please try again shortly.';
  end if;

  insert into public.leads (workspace_id, name, phone, email, company, source, form_id, form_answers)
  values (f.workspace_id, trim(p_name), nullif(trim(p_phone), ''), nullif(lower(trim(p_email)), ''),
          private.company_from_answers(p_answers), f.default_source, f.id, coalesce(p_answers, '{}'))
  returning id into v_lead;

  insert into public.notifications (workspace_id, user_id, type, title, message, link)
  select f.workspace_id, m.user_id, 'lead', 'New lead: ' || trim(p_name), 'From form "' || f.title || '"', '/leads?open=' || v_lead
  from public.workspace_members m
  where m.workspace_id = f.workspace_id and m.role in ('owner', 'admin') and m.is_active;

  return jsonb_build_object('ok', true, 'message', coalesce(f.success_message, 'Thank you! We will contact you soon.'));
end;
$$;

-- Fill the company on leads already received.
update public.leads
set company = private.company_from_answers(form_answers)
where company is null and form_id is not null and private.company_from_answers(form_answers) is not null;
