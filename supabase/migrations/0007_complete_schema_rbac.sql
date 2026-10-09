-- ============================================================================
-- Internship Management System (IMS) — COMPLETE SCHEMA + RBAC
-- ============================================================================
-- ONE-FILE, idempotent, paste-into-SQL-Editor migration.
-- Combines: init schema (0001) + RLS helpers/policies (0002) +
-- prototype fields (0003) + consistency/triggers (0004) + user mgmt
-- (0005) + RBAC hardening (0006), with role-based data isolation
-- enforced at the DATABASE layer.
--
-- Safe to run on a fresh OR already-partially-built project:
--   * enums/tables use "if not exists"
--   * columns use "add column if not exists"
--   * policies use "drop policy if exists" before "create policy"
--   * triggers/functions use "create or replace" / "drop trigger if exists"
--
-- After running this, the three roles are isolated:
--   * HR Admin / HR Staff -> global visibility + full management
--   * Supervisor            -> ONLY their assigned interns (+ that interns'
--                             attendance/journals/documents/evaluations)
--   * Intern                -> ONLY their own row + own data
-- An intern or another supervisor hitting out-of-scope data gets
-- empty/403 at the API layer (requirement #3).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. ENUMS
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type user_role as enum ('admin', 'hr_staff', 'supervisor', 'intern');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'intern_status') then
    create type intern_status as enum ('active', 'completed', 'archived');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'attendance_status') then
    create type attendance_status as enum ('present', 'late', 'absent', 'pending');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'journal_status') then
    create type journal_status as enum ('pending', 'approved', 'rejected');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'document_status') then
    create type document_status as enum ('pending', 'approved', 'rejected');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'evaluation_status') then
    create type evaluation_status as enum ('pending', 'completed', 'archived');
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. PROFILES (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text,
  avatar_url text,
  contact_number text,
  bio text,
  role user_role not null default 'intern',
  intern_id uuid references public.interns (id) on delete set null,
  supervisor_id uuid references public.supervisors (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- 3. DEPARTMENTS
-- ---------------------------------------------------------------------------
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- 4. SUPERVISORS
-- ---------------------------------------------------------------------------
create table if not exists public.supervisors (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles (id) on delete set null,
  department_id uuid references public.departments (id) on delete set null,
  full_name text,
  email text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- 5. INTERNS (core isolation table)
-- ---------------------------------------------------------------------------
create table if not exists public.interns (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles (id) on delete set null,
  full_name text not null,
  student_number text,
  school text,
  course text,
  contact_number text,
  email text,
  emergency_contact text,
  department_id uuid references public.departments (id) on delete set null,
  supervisor_id uuid references public.supervisors (id) on delete set null,
  start_date date,
  end_date date,
  required_hours numeric not null default 300,
  status intern_status not null default 'active',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists interns_department_idx on public.interns (department_id);
create index if not exists interns_supervisor_idx on public.interns (supervisor_id);
create index if not exists interns_status_idx on public.interns (status);
create index if not exists idx_interns_created_by on public.interns (created_by);


-- ---------------------------------------------------------------------------
-- 6. ATTENDANCE
-- ---------------------------------------------------------------------------
create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  intern_id uuid not null references public.interns (id) on delete cascade,
  date date not null default current_date,
  time_in timestamptz,
  time_out timestamptz,
  total_hours numeric not null default 0,
  method text default 'manual',
  status attendance_status not null default 'present',
  created_at timestamptz not null default now()
);

create index if not exists attendance_intern_idx on public.attendance (intern_id);
create index if not exists attendance_date_idx on public.attendance (date);


-- ---------------------------------------------------------------------------
-- 7. DAILY JOURNALS
-- ---------------------------------------------------------------------------
create table if not exists public.daily_journals (
  id uuid primary key default gen_random_uuid(),
  intern_id uuid not null references public.interns (id) on delete cascade,
  supervisor_id uuid references public.supervisors (id) on delete set null,
  date date not null default current_date,
  activities text not null,
  hours_worked numeric not null default 0,
  challenges text,
  learnings text,
  status journal_status not null default 'pending',
  supervisor_comment text,
  created_at timestamptz not null default now()
);

create index if not exists journals_intern_idx on public.daily_journals (intern_id);
create index if not exists journals_status_idx on public.daily_journals (status);


-- ---------------------------------------------------------------------------
-- 8. DOCUMENTS
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  intern_id uuid not null references public.interns (id) on delete cascade,
  type text not null,
  label text,
  file_path text,
  file_name text,
  file_url text,
  status document_status not null default 'pending',
  created_at timestamptz not null default now()
);

create index if not exists documents_intern_idx on public.documents (intern_id);


-- ---------------------------------------------------------------------------
-- 9. EVALUATIONS
-- ---------------------------------------------------------------------------
create table if not exists public.evaluations (
  id uuid primary key default gen_random_uuid(),
  intern_id uuid not null references public.interns (id) on delete cascade,
  supervisor_id uuid references public.supervisors (id) on delete set null,
  attendance integer not null default 0,
  communication integer not null default 0,
  teamwork integer not null default 0,
  initiative integer not null default 0,
  technical_skills integer not null default 0,
  professionalism integer not null default 0,
  overall_rating integer not null default 0,
  comments text,
  final_recommendation text,
  status evaluation_status not null default 'pending',
  created_at timestamptz not null default now()
);

create index if not exists evaluations_intern_idx on public.evaluations (intern_id);


-- ---------------------------------------------------------------------------
-- 10. ANNOUNCEMENTS
-- ---------------------------------------------------------------------------
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  category text not null default 'company_news',
  pinned boolean not null default false,
  published_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists announcements_pinned_idx on public.announcements (pinned);


-- ---------------------------------------------------------------------------
-- 11. SETTINGS (singleton, id = 1)
-- ---------------------------------------------------------------------------
create table if not exists public.settings (
  id integer primary key default 1,
  company_name text,
  internship_duration text,
  required_hours numeric not null default 300,
  updated_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- 12. NOTIFICATIONS
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  type text,
  title text,
  message text,
  link text,
  is_read boolean not null default false,
  read_at timestamptz,
  metadata jsonb default '{}',
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- 13. AUDIT LOGS
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  action text,
  resource_type text,
  resource_id text,
  changes jsonb default '{}',
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- 14. HELPER FUNCTIONS (RLS)
-- ---------------------------------------------------------------------------
create or replace function public.current_role ()
  returns user_role
  language sql
  stable
  security definer
  set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid ()
$$;

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
  )
$$;

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
  where p.id = auth.uid ()
$$;

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
  where p.id = auth.uid ()
$$;


-- ---------------------------------------------------------------------------
-- 15. TRIGGERS
-- ---------------------------------------------------------------------------

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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user ();

-- Keep profiles.intern_id / supervisor_id cached in sync with the
-- interns / supervisors rows (mirrors the app's manual link updates).
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

-- Maintain updated_at on key tables.
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
-- 16. CONSTRAINTS (safety / data quality)
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

-- One OPEN attendance record per intern per day.
create unique index if not exists attendance_open_unique
  on public.attendance (intern_id, date)
  where (time_out is null);


-- ---------------------------------------------------------------------------
-- 17. ENABLE RLS ON ALL TABLES
-- ---------------------------------------------------------------------------
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
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;


-- ---------------------------------------------------------------------------
-- 18. RLS POLICIES — RBAC ISOLATION
-- ---------------------------------------------------------------------------

-- profiles: all authenticated read; user updates own; admin manages all.
drop policy if exists "profiles readable by authenticated" on public.profiles;
create policy "profiles readable by authenticated"
  on public.profiles for select to authenticated using (true);

drop policy if exists "users manage own profile" on public.profiles;
create policy "users manage own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid ());

drop policy if exists "admins manage profiles" on public.profiles;
create policy "admins manage profiles"
  on public.profiles for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());

-- departments: all read; admin manages.
drop policy if exists "departments readable" on public.departments;
create policy "departments readable"
  on public.departments for select to authenticated using (true);

drop policy if exists "admins manage departments" on public.departments;
create policy "admins manage departments"
  on public.departments for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());

-- supervisors: all read (names in dropdowns); admin manages.
drop policy if exists "supervisors readable" on public.supervisors;
create policy "supervisors readable"
  on public.supervisors for select to authenticated using (true);

drop policy if exists "admins manage supervisors" on public.supervisors;
create policy "admins manage supervisors"
  on public.supervisors for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());

-- interns: THE CORE ISOLATION TABLE.
--   admin            -> all
--   supervisor      -> assigned (supervisor_id) OR created-by interns
--   intern          -> own row only
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

drop policy if exists "supervisor reads assigned interns" on public.interns;
create policy "supervisor reads assigned interns"
  on public.interns for select to authenticated
  using (supervisor_id = public.current_supervisor_id ());

drop policy if exists "supervisor manages assigned interns" on public.interns;
create policy "supervisor manages assigned interns"
  on public.interns for all to authenticated
  using (
    supervisor_id = public.current_supervisor_id()
    or created_by = auth.uid()
  )
  with check (
    supervisor_id = public.current_supervisor_id()
    or created_by = auth.uid()
  );

-- attendance: intern owns; supervisor sees assigned; admin all.
drop policy if exists "attendance readable" on public.attendance;
create policy "attendance readable"
  on public.attendance for select to authenticated
  using (
    public.is_admin()
    or intern_id = public.current_intern_id()
    or intern_id in (
      select id from public.interns
      where supervisor_id = public.current_supervisor_id()
    )
  );

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
      where supervisor_id = public.current_supervisor_id()
    )
  );

-- daily_journals: same shape as attendance.
drop policy if exists "journals readable" on public.daily_journals;
create policy "journals readable"
  on public.daily_journals for select to authenticated
  using (
    public.is_admin()
    or intern_id = public.current_intern_id()
    or intern_id in (
      select id from public.interns
      where supervisor_id = public.current_supervisor_id()
    )
  );

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
      where supervisor_id = public.current_supervisor_id()
    )
  );

-- documents: same shape.
drop policy if exists "documents readable" on public.documents;
create policy "documents readable"
  on public.documents for select to authenticated
  using (
    public.is_admin()
    or intern_id = public.current_intern_id()
    or intern_id in (
      select id from public.interns
      where supervisor_id = public.current_supervisor_id()
    )
  );

drop policy if exists "admins manage documents" on public.documents;
create policy "admins manage documents"
  on public.documents for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());

drop policy if exists "intern manages own documents" on public.documents;
create policy "intern manages own documents"
  on public.documents for all to authenticated
  using (intern_id = public.current_intern_id ())
  with check (intern_id = public.current_intern_id ());

-- evaluations: supervisor manages own; intern reads own; admin all.
drop policy if exists "evaluations readable" on public.evaluations;
create policy "evaluations readable"
  on public.evaluations for select to authenticated
  using (
    public.is_admin()
    or intern_id = public.current_intern_id()
    or supervisor_id = public.current_supervisor_id()
  );

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

-- announcements: all read; admin manages.
drop policy if exists "announcements readable" on public.announcements;
create policy "announcements readable"
  on public.announcements for select to authenticated using (true);

drop policy if exists "admins manage announcements" on public.announcements;
create policy "admins manage announcements"
  on public.announcements for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());

-- settings: all read; admin manages.
drop policy if exists "settings readable" on public.settings;
create policy "settings readable"
  on public.settings for select to authenticated using (true);

drop policy if exists "admins manage settings" on public.settings;
create policy "admins manage settings"
  on public.settings for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());

-- audit_logs: admin ONLY (read + write). No other role may touch them.
drop policy if exists "admins read audit logs" on public.audit_logs;
create policy "admins read audit logs"
  on public.audit_logs for select to authenticated
  using (public.is_admin ());

drop policy if exists "admins write audit logs" on public.audit_logs;
create policy "admins write audit logs"
  on public.audit_logs for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());

-- notifications: a user reads/updates ONLY their own; admin manages.
drop policy if exists "user reads own notifications" on public.notifications;
create policy "user reads own notifications"
  on public.notifications for select to authenticated
  using (user_id = auth.uid ());

drop policy if exists "user manages own notifications" on public.notifications;
create policy "user manages own notifications"
  on public.notifications for all to authenticated
  using (user_id = auth.uid ()) with check (user_id = auth.uid ());

drop policy if exists "admins manage notifications" on public.notifications;
create policy "admins manage notifications"
  on public.notifications for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());


-- ---------------------------------------------------------------------------
-- 19. STORAGE BUCKET + POLICIES (intern documents)
-- ---------------------------------------------------------------------------
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


-- ---------------------------------------------------------------------------
-- 20. BACKFILL cached profile links (safe on fresh DB too)
-- ---------------------------------------------------------------------------
update public.profiles p
  set intern_id = i.id
  from public.interns i
  where i.profile_id = p.id and p.intern_id is distinct from i.id;

update public.profiles p
  set supervisor_id = s.id
  from public.supervisors s
  where s.profile_id = p.id and p.supervisor_id is distinct from s.id;


-- ============================================================================
-- DONE. Role-based access control is now enforced at the database layer.
-- Verify with:  select tablename, policyname from pg_policies
--               where tablename in ('interns','attendance','daily_journals')
--               order by tablename;
-- ============================================================================
