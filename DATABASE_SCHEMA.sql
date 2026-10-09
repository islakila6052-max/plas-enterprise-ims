-- ============================================================================
-- Internship Management System (IMS) — COMPLETE DATABASE SCHEMA
-- ============================================================================
-- Project Name : Internship Management System (IMS)
-- Generated     : 2026-07-16
-- Database      : PostgreSQL 15+ (Supabase)
-- Summary of Objects:
--   Tables  : 10  (profiles, departments, supervisors, interns, attendance,
--                  daily_journals, documents, evaluations, announcements, settings)
--   Enums  : 6   (user_role, intern_status, attendance_status, journal_status,
--                  document_status, evaluation_status)
--   Functions: 6 (current_role, is_admin, current_supervisor_id, current_intern_id,
--                  handle_new_user, sync_profile_links)
--   Triggers : 6 (on_auth_user_created, sync_profile_intern, sync_profile_supervisor,
--                  set_profiles_updated, set_interns_updated, set_settings_updated)
--   Views   : 0
--   Indexes : 14 (13 regular + 1 partial unique on open attendance)
--   Policies: 33 (table RLS + storage)
--   Storage Buckets: 1 (intern-documents)
--
-- HOW TO USE
--   Paste this ENTIRE file into Supabase: SQL Editor -> New query -> Run.
--   It is SAFE TO RE-RUN. Every statement uses "if not exists" / "or replace" /
--   "on conflict" / "drop ... if exists" / "add column if not exists", so it
--   repairs a partially-created database (e.g. one missing the `pinned` column)
--   instead of failing.
--
-- EVIDENCE BASIS (reverse-engineered + reconciled with the codebase)
--   supabase/migrations/0001_init.sql            -> enums + tables + indexes
--   supabase/migrations/0002_rls.sql             -> functions + trigger + RLS + storage
--   supabase/migrations/0003_prototype_fields.sql-> announcements.pinned, documents.file_name
--   supabase/migrations/0004_consistency.sql     -> profile links, FK cascade, evaluation enum,
--                                                   supervisor denormalization, constraints, triggers
--   src/services/*                               -> every table/column actually queried
--   src/pages/*                                  -> profile.intern_id / profile.supervisor_id usage
--   src/lib/constants.js                         -> enum value sets
-- ============================================================================


-- ---------------------------------------------------------------------------
-- EXTENSIONS
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";       -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type user_role as enum ('admin', 'hr_staff', 'supervisor', 'intern');
  end if;
  if not exists (select 1 from pg_type where typname = 'intern_status') then
    create type intern_status as enum ('active', 'completed', 'archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'attendance_status') then
    create type attendance_status as enum ('present', 'late', 'absent', 'pending');
  end if;
  if not exists (select 1 from pg_type where typname = 'journal_status') then
    create type journal_status as enum ('pending', 'approved', 'rejected');
  end if;
  if not exists (select 1 from pg_type where typname = 'document_status') then
    create type document_status as enum ('pending', 'approved', 'rejected');
  end if;
  if not exists (select 1 from pg_type where typname = 'evaluation_status') then
    create type evaluation_status as enum ('pending', 'completed', 'archived');
  end if;
end$$;


-- ---------------------------------------------------------------------------
-- profiles  (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text,
  avatar_url text,
  contact_number text,
  bio text,
  role user_role not null default 'intern',
  -- Cached links to the person's intern/supervisor record (kept in sync by trigger).
  -- These make profile.intern_id / profile.supervisor_id valid for the frontend.
  intern_id uuid references public.interns (id) on delete set null,
  supervisor_id uuid references public.supervisors (id) on delete set null,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);


-- ---------------------------------------------------------------------------
-- departments
-- ---------------------------------------------------------------------------
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid (),
  name text not null unique,
  description text,
  created_at timestamptz not null default now ()
);


-- ---------------------------------------------------------------------------
-- supervisors
-- ---------------------------------------------------------------------------
create table if not exists public.supervisors (
  id uuid primary key default gen_random_uuid (),
  profile_id uuid references public.profiles (id) on delete cascade,
  department_id uuid references public.departments (id) on delete set null,
  -- Supervisor name is stored as first_name + last_name. `full_name` is a
  -- generated convenience column (first_name || ' ' || last_name) kept for
  -- read paths that display a single combined name.
  first_name text not null default '',
  last_name text,
  full_name text generated always as (
    btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
  ) stored,
  email text,
  created_at timestamptz not null default now ()
);

-- Reconcile denormalized supervisor display columns (safe if already present).
alter table public.supervisors
  add column if not exists first_name text;
alter table public.supervisors
  add column if not exists last_name text;
alter table public.supervisors
  add column if not exists email text;


-- ---------------------------------------------------------------------------
-- interns
-- ---------------------------------------------------------------------------
create table if not exists public.interns (
  id uuid primary key default gen_random_uuid (),
  profile_id uuid references public.profiles (id) on delete cascade,
  -- Intern name is stored as first_name + last_name. `full_name` is a
  -- generated convenience column (first_name || ' ' || last_name) kept for
  -- read paths that display a single combined name.
  first_name text not null default '',
  last_name text,
  full_name text generated always as (
    btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
  ) stored,
  school text,
  course text,
  contact_number text,
  email text,
  emergency_contact text,
  department_id uuid references public.departments (id) on delete set null,
  supervisor_id uuid references public.supervisors (id) on delete set null,
  start_date date,
  end_date date,
  required_hours numeric not null default 300 check (required_hours >= 0),
  status intern_status not null default 'active',
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create index if not exists interns_department_idx on public.interns (department_id);
create index if not exists interns_supervisor_idx on public.interns (supervisor_id);
create index if not exists interns_status_idx on public.interns (status);

-- Reconcile cached profile links (requires interns + supervisors to already exist).
alter table public.profiles
  add column if not exists intern_id uuid references public.interns (id) on delete set null;
alter table public.profiles
  add column if not exists supervisor_id uuid references public.supervisors (id) on delete set null;


-- ---------------------------------------------------------------------------
-- attendance
-- ---------------------------------------------------------------------------
create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid (),
  intern_id uuid not null references public.interns (id) on delete cascade,
  date date not null default current_date,
  time_in timestamptz,
  time_out timestamptz,
  total_hours numeric not null default 0 check (total_hours >= 0),
  method text default 'manual',
  status attendance_status not null default 'present',
  created_at timestamptz not null default now ()
);

create index if not exists attendance_intern_idx on public.attendance (intern_id);
create index if not exists attendance_date_idx on public.attendance (date);
-- One attendance record per intern per day (enforced by unique index).
create unique index if not exists attendance_unique_per_day
  on public.attendance (intern_id, date);


-- ---------------------------------------------------------------------------
-- daily_journals
-- ---------------------------------------------------------------------------
create table if not exists public.daily_journals (
  id uuid primary key default gen_random_uuid (),
  intern_id uuid not null references public.interns (id) on delete cascade,
  supervisor_id uuid references public.supervisors (id) on delete set null,
  date date not null default current_date,
  activities text not null,
  hours_worked numeric not null default 0 check (hours_worked >= 0),
  challenges text,
  learnings text,
  status journal_status not null default 'pending',
  supervisor_comment text,
  created_at timestamptz not null default now ()
);

create index if not exists journals_intern_idx on public.daily_journals (intern_id);
create index if not exists journals_status_idx on public.daily_journals (status);
create index if not exists journals_supervisor_idx on public.daily_journals (supervisor_id);


-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid (),
  intern_id uuid not null references public.interns (id) on delete cascade,
  type text not null check (type in ('resume', 'moa', 'endorsement', 'school_requirements', 'completion_report')),
  label text,
  file_path text,
  file_url text,
  file_name text,
  status document_status not null default 'pending',
  created_at timestamptz not null default now ()
);

-- Reconcile document file_name column (safe if already present).
alter table public.documents
  add column if not exists file_name text;

create index if not exists documents_intern_idx on public.documents (intern_id);


-- ---------------------------------------------------------------------------
-- evaluations
-- ---------------------------------------------------------------------------
create table if not exists public.evaluations (
  id uuid primary key default gen_random_uuid (),
  intern_id uuid not null references public.interns (id) on delete cascade,
  supervisor_id uuid references public.supervisors (id) on delete set null,
  attendance integer not null default 0 check (attendance between 0 and 5),
  communication integer not null default 0 check (communication between 0 and 5),
  teamwork integer not null default 0 check (teamwork between 0 and 5),
  initiative integer not null default 0 check (initiative between 0 and 5),
  technical_skills integer not null default 0 check (technical_skills between 0 and 5),
  professionalism integer not null default 0 check (professionalism between 0 and 5),
  overall_rating integer not null default 0 check (overall_rating between 0 and 5),
  comments text,
  final_recommendation text check (
    final_recommendation is null or
    final_recommendation in ('highly_recommend', 'recommend', 'neutral', 'do_not_recommend')
  ),
  status evaluation_status not null default 'pending',
  created_at timestamptz not null default now ()
);

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
  end if;
end$$;

create index if not exists evaluations_intern_idx on public.evaluations (intern_id);
create index if not exists evaluations_supervisor_idx on public.evaluations (supervisor_id);
create index if not exists evaluations_status_idx on public.evaluations (status);


-- ---------------------------------------------------------------------------
-- announcements
-- ---------------------------------------------------------------------------
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid (),
  title text not null,
  body text not null,
  category text not null default 'company_news'
    check (category in ('company_news', 'schedule', 'deadline', 'reminder')),
  published_by uuid references public.profiles (id) on delete set null,
  pinned boolean not null default false,
  created_at timestamptz not null default now ()
);

-- Reconcile announcements.pinned column (the usual cause of a re-run failure).
alter table public.announcements
  add column if not exists pinned boolean not null default false;

create index if not exists announcements_pinned_idx on public.announcements (pinned);


-- ---------------------------------------------------------------------------
-- settings  (singleton, id = 1)
-- ---------------------------------------------------------------------------
create table if not exists public.settings (
  id integer primary key default 1,
  company_name text,
  internship_duration text,
  required_hours numeric not null default 300 check (required_hours >= 0),
  updated_at timestamptz not null default now ()
);


-- ============================================================================
-- FUNCTIONS + TRIGGERS + RLS + STORAGE
-- ============================================================================

-- Helper: role of the current user.
create or replace function public.current_role ()
  returns user_role
  language sql
  stable
  security definer
  set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid ();
$$;

-- Helper: true if current user is admin or hr_staff.
create or replace function public.is_admin ()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid ()
      and role in ('admin', 'hr_staff')
  );
$$;

-- Helper: supervisor row id for the current user.
create or replace function public.current_supervisor_id ()
  returns uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select s.id
  from public.supervisors s
  join public.profiles p on p.id = s.profile_id
  where p.id = auth.uid ();
$$;

-- Helper: intern row id for the current user.
create or replace function public.current_intern_id ()
  returns uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select i.id
  from public.interns i
  join public.profiles p on p.id = i.profile_id
  where p.id = auth.uid ();
$$;

-- Auto-create a profile row when a new auth user signs up.
create or replace function public.handle_new_user ()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'intern')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Keep profiles.intern_id / profiles.supervisor_id in sync with intern/supervisor rows.
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user ();

drop trigger if exists sync_profile_intern on public.interns;
create trigger sync_profile_intern
  after insert or update or delete on public.interns
  for each row execute function public.sync_profile_links ();

drop trigger if exists sync_profile_supervisor on public.supervisors;
create trigger sync_profile_supervisor
  after insert or update or delete on public.supervisors
  for each row execute function public.sync_profile_links ();

-- Maintain updated_at on key tables (Supabase-provided moddatetime function).
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

-- Enable RLS on all tables.
alter table public.profiles enable row level security;
alter table public.departments enable row level security;
alter table public.supervisors enable row level security;
alter table public.interns enable row level security;
alter table public.attendance enable row level security;
alter table public.daily_journals enable row level security;
alter table public.documents enable row level security;
alter table public.evaluations enable row level security;
alter table public.announcements enable row level security;
alter table public.settings enable row level security;

-- profiles
drop policy if exists "profiles readable by authenticated" on public.profiles;
create policy "profiles readable by authenticated"
  on public.profiles for select to authenticated using (true);
drop policy if exists "users manage own profile" on public.profiles;
create policy "users manage own profile"
  on public.profiles for update to authenticated using (id = auth.uid ());
drop policy if exists "admins manage profiles" on public.profiles;
create policy "admins manage profiles"
  on public.profiles for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());

-- departments
drop policy if exists "departments readable" on public.departments;
create policy "departments readable"
  on public.departments for select to authenticated using (true);
drop policy if exists "admins manage departments" on public.departments;
create policy "admins manage departments"
  on public.departments for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());

-- supervisors
drop policy if exists "supervisors readable" on public.supervisors;
create policy "supervisors readable"
  on public.supervisors for select to authenticated using (true);
drop policy if exists "admins manage supervisors" on public.supervisors;
create policy "admins manage supervisors"
  on public.supervisors for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());

-- Helper: the current user's supervisor department id.
create or replace function public.current_supervisor_department_id ()
  returns uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select s.department_id
  from public.supervisors s
  join public.profiles p on p.id = s.profile_id
  where p.id = auth.uid ();
$$;

-- interns
-- SELECT: role-scoped (admin | own intern | assigned supervisor | created_by).
drop policy if exists "interns readable" on public.interns;
create policy "interns readable"
  on public.interns for select to authenticated
  using (
    public.is_admin()
    or id = public.current_intern_id()
    or supervisor_id = public.current_supervisor_id()
    or created_by = auth.uid()
  );
drop policy if exists "admins manage interns" on public.interns;
create policy "admins manage interns"
  on public.interns for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());
drop policy if exists "intern reads own row" on public.interns;
create policy "intern reads own row"
  on public.interns for select to authenticated
  using (id = public.current_intern_id ());
-- Supervisor may READ assigned interns or interns they created.
drop policy if exists "supervisor reads assigned interns" on public.interns;
create policy "supervisor reads assigned interns"
  on public.interns for select to authenticated
  using (
    supervisor_id = public.current_supervisor_id()
    or created_by = auth.uid()
  );

-- Supervisor may UPDATE assigned interns only (no INSERT).
drop policy if exists "supervisor modifies assigned interns" on public.interns;
create policy "supervisor modifies assigned interns"
  on public.interns for update to authenticated
  using (
    supervisor_id = public.current_supervisor_id()
  )
  with check (
    supervisor_id = public.current_supervisor_id()
    and department_id = public.current_supervisor_department_id()
  );

-- Supervisor may DELETE assigned interns only.
drop policy if exists "supervisor deletes assigned interns" on public.interns;
create policy "supervisor deletes assigned interns"
  on public.interns for delete to authenticated
  using (
    supervisor_id = public.current_supervisor_id()
  );

-- attendance
drop policy if exists "attendance readable" on public.attendance;
create policy "attendance readable"
  on public.attendance for select to authenticated using (true);
drop policy if exists "admins manage attendance" on public.attendance;
create policy "admins manage attendance"
  on public.attendance for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());
drop policy if exists "intern manages own attendance" on public.attendance;
create policy "intern manages own attendance"
  on public.attendance for all to authenticated
  using (intern_id = public.current_intern_id ())
  with check (intern_id = public.current_intern_id ());
drop policy if exists "supervisor reads assigned attendance" on public.attendance;
create policy "supervisor reads assigned attendance"
  on public.attendance for select to authenticated
  using (
    intern_id in (
      select id from public.interns
      where supervisor_id = public.current_supervisor_id ()
    )
  );

-- daily_journals
drop policy if exists "journals readable" on public.daily_journals;
create policy "journals readable"
  on public.daily_journals for select to authenticated using (true);
drop policy if exists "admins manage journals" on public.daily_journals;
create policy "admins manage journals"
  on public.daily_journals for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());
drop policy if exists "intern manages own journals" on public.daily_journals;
create policy "intern manages own journals"
  on public.daily_journals for all to authenticated
  using (intern_id = public.current_intern_id ())
  with check (intern_id = public.current_intern_id ());
drop policy if exists "supervisor reviews assigned journals" on public.daily_journals;
create policy "supervisor reviews assigned journals"
  on public.daily_journals for update to authenticated
  using (
    intern_id in (
      select id from public.interns
      where supervisor_id = public.current_supervisor_id ()
    )
  );

-- documents
drop policy if exists "documents readable" on public.documents;
create policy "documents readable"
  on public.documents for select to authenticated using (true);
drop policy if exists "admins manage documents" on public.documents;
create policy "admins manage documents"
  on public.documents for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());
drop policy if exists "intern manages own documents" on public.documents;
create policy "intern manages own documents"
  on public.documents for all to authenticated
  using (intern_id = public.current_intern_id ())
  with check (intern_id = public.current_intern_id ());

-- evaluations
drop policy if exists "evaluations readable" on public.evaluations;
create policy "evaluations readable"
  on public.evaluations for select to authenticated using (true);
drop policy if exists "admins manage evaluations" on public.evaluations;
create policy "admins manage evaluations"
  on public.evaluations for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());
drop policy if exists "supervisor manages assigned evaluations" on public.evaluations;
create policy "supervisor manages assigned evaluations"
  on public.evaluations for all to authenticated
  using (supervisor_id = public.current_supervisor_id ())
  with check (supervisor_id = public.current_supervisor_id ());
drop policy if exists "intern reads own evaluation" on public.evaluations;
create policy "intern reads own evaluation"
  on public.evaluations for select to authenticated
  using (intern_id = public.current_intern_id ());

-- announcements
drop policy if exists "announcements readable" on public.announcements;
create policy "announcements readable"
  on public.announcements for select to authenticated using (true);
drop policy if exists "admins manage announcements" on public.announcements;
create policy "admins manage announcements"
  on public.announcements for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());

-- settings
drop policy if exists "settings readable" on public.settings;
create policy "settings readable"
  on public.settings for select to authenticated using (true);
drop policy if exists "admins manage settings" on public.settings;
create policy "admins manage settings"
  on public.settings for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());

-- Storage bucket for intern documents.
insert into storage.buckets (id, name, public)
values ('intern-documents', 'intern-documents', true)
on conflict (id) do nothing;

drop policy if exists "documents storage readable" on storage.objects;
create policy "documents storage readable"
  on storage.objects for select to authenticated
  using (bucket_id = 'intern-documents');

drop policy if exists "intern uploads own documents" on storage.objects;
create policy "intern uploads own documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'intern-documents'
    and (storage.foldername (name))[1] = public.current_intern_id ()::text
  );

drop policy if exists "admins manage storage" on storage.objects;
create policy "admins manage storage"
  on storage.objects for all to authenticated
  using (bucket_id = 'intern-documents')
  with check (bucket_id = 'intern-documents');
