-- Assets & documents: the company's own documents, assets and domains, each
-- with an expiry or renewal date, files, renewal history and daily reminders.
-- Available on every plan. Owner and admins add, edit and delete; staff can view.

create table public.company_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('document', 'asset', 'domain')),
  category text not null default 'other' check (length(category) <= 60),
  name text not null check (length(btrim(name)) between 1 and 200),
  reference text check (length(reference) <= 200),   -- document number, serial or tag
  issued_by text check (length(issued_by) <= 200),    -- issuing office, vendor or registrar
  issue_date date,                                     -- issued, bought or registered on
  expiry_date date,                                    -- expiry, warranty/insurance/service due, renewal date
  amount numeric(12,2) check (amount is null or amount >= 0), -- price paid or yearly renewal cost (INR)
  auto_renew boolean not null default false,           -- domains
  hosting_expiry date,                                 -- domains, optional
  ssl_expiry date,                                     -- domains, optional
  held_by uuid references auth.users(id) on delete set null,       -- assets: who has it
  reminder_user_id uuid references auth.users(id) on delete set null, -- also gets this item's reminders
  notes text check (length(notes) <= 4000),
  status text not null default 'active' check (status in ('active', 'closed')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index company_records_ws_idx on public.company_records(workspace_id, kind, expiry_date);
create index company_records_held_by_idx on public.company_records(held_by);
create index company_records_reminder_user_idx on public.company_records(reminder_user_id);
create index company_records_created_by_idx on public.company_records(created_by);
create trigger company_records_updated_at before update on public.company_records
  for each row execute function private.set_updated_at();

create table public.company_record_renewals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  record_id uuid not null references public.company_records(id) on delete cascade,
  old_expiry date,
  new_expiry date not null,
  amount numeric(12,2) check (amount is null or amount >= 0),
  note text check (length(note) <= 1000),
  renewed_by uuid references auth.users(id) on delete set null default auth.uid(),
  renewed_at timestamptz not null default now()
);
create index company_record_renewals_record_idx on public.company_record_renewals(record_id, renewed_at desc);
create index company_record_renewals_ws_idx on public.company_record_renewals(workspace_id);
create index company_record_renewals_by_idx on public.company_record_renewals(renewed_by);

alter table public.company_records enable row level security;
alter table public.company_record_renewals enable row level security;

create policy company_records_read on public.company_records for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_platform_admin());
create policy company_records_insert on public.company_records for insert to authenticated
  with check (public.can_admin_write(workspace_id));
create policy company_records_update on public.company_records for update to authenticated
  using (public.can_admin_write(workspace_id))
  with check (public.can_admin_write(workspace_id));
create policy company_records_delete on public.company_records for delete to authenticated
  using (public.can_admin_write(workspace_id));

-- History is written only by renew_company_record().
create policy company_record_renewals_read on public.company_record_renewals for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_platform_admin());

grant select, insert, update, delete on public.company_records to authenticated;
grant select on public.company_record_renewals to authenticated;

-- People picked on an item must belong to the same company.
create or replace function private.check_company_record_people()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.held_by is not null and not exists (
    select 1 from public.workspace_members where workspace_id = new.workspace_id and user_id = new.held_by
  ) then
    raise exception 'Pick someone from your team.';
  end if;
  if new.reminder_user_id is not null and not exists (
    select 1 from public.workspace_members where workspace_id = new.workspace_id and user_id = new.reminder_user_id
  ) then
    raise exception 'Pick someone from your team.';
  end if;
  if tg_op = 'UPDATE' and new.workspace_id <> old.workspace_id then
    raise exception 'Items cannot move between companies.';
  end if;
  return new;
end;
$$;
create trigger company_records_people before insert or update on public.company_records
  for each row execute function private.check_company_record_people();

-- Renew: move the date forward and keep the old one in the history.
create or replace function public.renew_company_record(p_id uuid, p_new_expiry date,
                                                       p_amount numeric default null, p_note text default null)
returns public.company_records
language plpgsql security invoker
set search_path = ''
as $$
declare
  r public.company_records;
begin
  select * into r from public.company_records where id = p_id for update;
  if r.id is null or not public.can_admin_write(r.workspace_id) then
    raise exception 'Only the owner or an admin can renew this.';
  end if;
  if p_new_expiry is null then
    raise exception 'Enter the new expiry date.';
  end if;
  if r.expiry_date is not null and p_new_expiry <= r.expiry_date then
    raise exception 'The new date must be after the current one (%).', to_char(r.expiry_date, 'DD Mon YYYY');
  end if;
  insert into public.company_record_renewals (workspace_id, record_id, old_expiry, new_expiry, amount, note)
  values (r.workspace_id, r.id, r.expiry_date, p_new_expiry, p_amount, nullif(btrim(coalesce(p_note, '')), ''));
  update public.company_records
     set expiry_date = p_new_expiry, status = 'active', amount = coalesce(p_amount, amount)
   where id = r.id
  returning * into r;
  return r;
end;
$$;
-- The insert into the history table runs as the caller, so let it through
-- only from inside renew_company_record (which checks admin first).
create policy company_record_renewals_insert on public.company_record_renewals for insert to authenticated
  with check (public.can_admin_write(workspace_id) and renewed_by = (select auth.uid()));
grant insert on public.company_record_renewals to authenticated;
revoke execute on function public.renew_company_record(uuid, date, numeric, text) from public, anon;
grant execute on function public.renew_company_record(uuid, date, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Files on these items: admins only, and only when uploads are on.
-- ---------------------------------------------------------------------------
alter table public.files drop constraint files_entity_type_check;
alter table public.files add constraint files_entity_type_check
  check (entity_type in ('work_item', 'client', 'lead', 'invoice', 'workspace', 'profile', 'renewal', 'lead_form', 'company_record'));

create policy files_company_record_admin on public.files as restrictive for insert to authenticated
  with check (
    entity_type <> 'company_record'
    or (
      public.is_workspace_admin(workspace_id)
      and exists (select 1 from public.workspaces w where w.id = workspace_id and w.attachments_enabled)
    )
  );

-- ---------------------------------------------------------------------------
-- Daily reminders at 9 AM India time (with the other daily alerts):
-- 30, 7 and 1 day before, on the day, then weekly while overdue.
-- Auto-renew domains get one heads-up 7 days before.
-- Goes to the owner, admins and the item's reminder person; the bell
-- row is pushed to phones by the existing notifications_push trigger.
-- ---------------------------------------------------------------------------
create or replace function private.send_expiry_reminders()
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  with dates as (
    select r.id, r.workspace_id, r.kind, r.name, r.auto_renew, r.reminder_user_id,
           d.label, d.due, d.due - current_date as left_days
    from public.company_records r
    cross join lateral (values
      (case r.kind when 'domain' then 'Domain renewal' when 'asset' then 'Warranty / service date' else 'Expiry' end, r.expiry_date),
      ('Hosting renewal', case when r.kind = 'domain' then r.hosting_expiry end),
      ('SSL certificate', case when r.kind = 'domain' then r.ssl_expiry end)
    ) as d(label, due)
    where r.status = 'active' and d.due is not null
      and public.workspace_is_active(r.workspace_id)
      and private.rule_on(r.workspace_id, 'expiry_reminders')
  ),
  due as (
    select * from dates
    where case
      when auto_renew and label = 'Domain renewal' then left_days = 7
      else left_days in (30, 7, 1, 0) or (left_days < 0 and (-left_days) % 7 = 0)
    end
  ),
  people as (
    select d.*, m.user_id
    from due d
    join public.workspace_members m on m.workspace_id = d.workspace_id and m.is_active
    where m.role in ('owner', 'admin') or m.user_id = d.reminder_user_id
  )
  insert into public.notifications (workspace_id, user_id, type, title, message, link)
  select workspace_id, user_id, 'expiry',
         case
           when auto_renew and label = 'Domain renewal' then 'Auto-renews in 7 days'
           when left_days = 0 then label || ' is today'
           when left_days = 1 then label || ' is tomorrow'
           when left_days > 1 then label || ' in ' || left_days || ' days'
           else label || ' passed ' || (-left_days) || ' days ago'
         end,
         name, '/assets?open=' || id
  from people;
end;
$$;

select cron.schedule('expiry-reminders', '35 3 * * *', $$select private.send_expiry_reminders()$$);
