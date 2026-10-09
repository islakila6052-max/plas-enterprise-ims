-- ============================================================================
-- Internship Management System — Initial Schema
-- ============================================================================
-- Run this in the Supabase SQL editor (or via Supabase CLI migrations).
-- Enables RLS on every table with role-based policies.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type user_role as enum ('admin', 'hr_staff', 'supervisor', 'intern');
create type intern_status as enum ('active', 'completed', 'archived');
create type attendance_status as enum ('present', 'late', 'absent', 'pending');
create type journal_status as enum ('pending', 'approved', 'rejected');
create type document_status as enum ('pending', 'approved', 'rejected');

-- ---------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text,
  avatar_url text,
  contact_number text,
  bio text,
  role user_role not null default 'intern',
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
  profile_id uuid references public.profiles (id) on delete set null,
  department_id uuid references public.departments (id) on delete set null,
  created_at timestamptz not null default now ()
);

-- ---------------------------------------------------------------------------
-- interns
-- ---------------------------------------------------------------------------
create table if not exists public.interns (
  id uuid primary key default gen_random_uuid (),
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
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create index if not exists interns_department_idx on public.interns (department_id);
create index if not exists interns_supervisor_idx on public.interns (supervisor_id);
create index if not exists interns_status_idx on public.interns (status);

-- ---------------------------------------------------------------------------
-- attendance
-- ---------------------------------------------------------------------------
create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid (),
  intern_id uuid not null references public.interns (id) on delete cascade,
  date date not null default current_date,
  time_in timestamptz,
  time_out timestamptz,
  total_hours numeric not null default 0,
  method text default 'manual',
  status attendance_status not null default 'present',
  created_at timestamptz not null default now ()
);

create index if not exists attendance_intern_idx on public.attendance (intern_id);
create index if not exists attendance_date_idx on public.attendance (date);

-- ---------------------------------------------------------------------------
-- daily_journals
-- ---------------------------------------------------------------------------
create table if not exists public.daily_journals (
  id uuid primary key default gen_random_uuid (),
  intern_id uuid not null references public.interns (id) on delete cascade,
  supervisor_id uuid references public.supervisors (id) on delete set null,
  date date not null default current_date,
  activities text not null,
  hours_worked numeric not null default 0,
  challenges text,
  learnings text,
  status journal_status not null default 'pending',
  supervisor_comment text,
  created_at timestamptz not null default now ()
);

create index if not exists journals_intern_idx on public.daily_journals (intern_id);
create index if not exists journals_status_idx on public.daily_journals (status);

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid (),
  intern_id uuid not null references public.interns (id) on delete cascade,
  type text not null,
  label text,
  file_path text,
  file_url text,
  status document_status not null default 'pending',
  created_at timestamptz not null default now ()
);

create index if not exists documents_intern_idx on public.documents (intern_id);

-- ---------------------------------------------------------------------------
-- evaluations
-- ---------------------------------------------------------------------------
create table if not exists public.evaluations (
  id uuid primary key default gen_random_uuid (),
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
  status text not null default 'completed',
  created_at timestamptz not null default now ()
);

create index if not exists evaluations_intern_idx on public.evaluations (intern_id);

-- ---------------------------------------------------------------------------
-- announcements
-- ---------------------------------------------------------------------------
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid (),
  title text not null,
  body text not null,
  category text not null default 'company_news',
  published_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now ()
);

-- ---------------------------------------------------------------------------
-- settings (singleton, id = 1)
-- ---------------------------------------------------------------------------
create table if not exists public.settings (
  id integer primary key default 1,
  company_name text,
  internship_duration text,
  required_hours numeric not null default 300,
  updated_at timestamptz not null default now ()
);
