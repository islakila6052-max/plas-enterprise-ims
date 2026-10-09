-- ============================================================================
-- Internship Management System — Consistency & hardening migration
-- ============================================================================
-- Applied AFTER 0001_init, 0002_rls, 0003_prototype_fields.
-- Goal: make the frontend, backend and database agree.
--
-- Changes:
--   1. profiles.intern_id / profiles.supervisor_id  (cached FK links)
--   2. profile_id FKs changed from SET NULL -> CASCADE (no orphan rows)
--   3. evaluation_status enum + evaluations.status converted
--   4. supervisors.full_name / email denormalized for display
--   5. CHECK constraints (hours >= 0, rating 0..5, valid type/category/recommendation)
--   6. partial unique index: one OPEN attendance per intern per day
--   7. sync_profile_links trigger keeps profile links in sync
--   8. moddatetime triggers for updated_at on profiles/interns/settings
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Cached profile -> intern / supervisor links
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists intern_id uuid references public.interns (id) on delete set null;
alter table public.profiles
  add column if not exists supervisor_id uuid references public.supervisors (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 2. profile_id FK cascade (drop old SET NULL constraint, add CASCADE)
-- ---------------------------------------------------------------------------
alter table public.interns
  drop constraint if exists interns_profile_id_fkey;
alter table public.interns
  add constraint interns_profile_id_fkey
  foreign key (profile_id) references public.profiles (id) on delete cascade;

alter table public.supervisors
  drop constraint if exists supervisors_profile_id_fkey;
alter table public.supervisors
  add constraint supervisors_profile_id_fkey
  foreign key (profile_id) references public.profiles (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 3. evaluation_status enum (create if missing) + convert column if still text
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'evaluation_status') then
    create type evaluation_status as enum ('pending', 'completed', 'archived');
  end if;
end$$;

-- If a pre-existing evaluations.status is still plain text, convert it to the enum.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'evaluations'
      and column_name = 'status' and data_type = 'text'
  ) then
    alter table public.evaluations
      alter column status type evaluation_status
      using (coalesce(status, 'pending')::evaluation_status);
    alter table public.evaluations
      alter column status set default 'pending';
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 4. supervisors denormalized display fields
-- ---------------------------------------------------------------------------
alter table public.supervisors
  add column if not exists full_name text;
alter table public.supervisors
  add column if not exists email text;

-- ---------------------------------------------------------------------------
-- 5. CHECK constraints
-- ---------------------------------------------------------------------------
alter table public.interns
  add constraint if not exists interns_required_hours_check
  check (required_hours >= 0);
alter table public.settings
  add constraint if not exists settings_required_hours_check
  check (required_hours >= 0);
alter table public.attendance
  add constraint if not exists attendance_total_hours_check
  check (total_hours >= 0);
alter table public.daily_journals
  add constraint if not exists journals_hours_check
  check (hours_worked >= 0);
alter table public.documents
  add constraint if not exists documents_type_check
  check (type in ('resume', 'moa', 'endorsement', 'school_requirements', 'completion_report'));
alter table public.announcements
  add constraint if not exists announcements_category_check
  check (category in ('company_news', 'schedule', 'deadline', 'reminder'));
alter table public.evaluations
  add constraint if not exists evaluations_rating_check
  check (
    attendance between 0 and 5 and
    communication between 0 and 5 and
    teamwork between 0 and 5 and
    initiative between 0 and 5 and
    technical_skills between 0 and 5 and
    professionalism between 0 and 5 and
    overall_rating between 0 and 5
  );
alter table public.evaluations
  add constraint if not exists evaluations_recommendation_check
  check (
    final_recommendation is null or
    final_recommendation in ('highly_recommend', 'recommend', 'neutral', 'do_not_recommend')
  );

-- ---------------------------------------------------------------------------
-- 6. One OPEN attendance record per intern per day
-- ---------------------------------------------------------------------------
create unique index if not exists attendance_open_unique
  on public.attendance (intern_id, date)
  where (time_out is null);

-- ---------------------------------------------------------------------------
-- 7. sync_profile_links trigger
-- ---------------------------------------------------------------------------
create or replace function public.sync_profile_links ()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if tg_table_name = 'interns' then
    if tg_op = 'DELETE' then
      update public.profiles set intern_id = null where intern_id = old.id;
      return old;
    else
      if new.profile_id is not null then
        update public.profiles set intern_id = new.id where id = new.profile_id;
      end if;
      return new;
    end if;
  elsif tg_table_name = 'supervisors' then
    if tg_op = 'DELETE' then
      update public.profiles set supervisor_id = null where supervisor_id = old.id;
      return old;
    else
      if new.profile_id is not null then
        update public.profiles set supervisor_id = new.id where id = new.profile_id;
      end if;
      return new;
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists sync_profile_intern on public.interns;
create trigger sync_profile_intern
  after insert or update or delete on public.interns
  for each row execute function public.sync_profile_links ();

drop trigger if exists sync_profile_supervisor on public.supervisors;
create trigger sync_profile_supervisor
  after insert or update or delete on public.supervisors
  for each row execute function public.sync_profile_links ();

-- ---------------------------------------------------------------------------
-- 8. updated_at maintenance
-- ---------------------------------------------------------------------------
drop trigger if exists set_profiles_updated on public.profiles;
create trigger set_profiles_updated
  before update on public.profiles
  for each row execute function extensions.moddatetime (updated_at);

drop trigger if exists set_interns_updated on public.interns;
create trigger set_interns_updated
  before update on public.interns
  for each row execute function extensions.moddatetime (updated_at);

drop trigger if exists set_settings_updated on public.settings;
create trigger set_settings_updated
  before update on public.settings
  for each row execute function extensions.moddatetime (updated_at);

-- ---------------------------------------------------------------------------
-- Backfill: populate cached profile links from existing rows
-- ---------------------------------------------------------------------------
update public.profiles p
  set intern_id = i.id
  from public.interns i
  where i.profile_id = p.id and p.intern_id is distinct from i.id;

update public.profiles p
  set supervisor_id = s.id
  from public.supervisors s
  where s.profile_id = p.id and p.supervisor_id is distinct from s.id;
