-- ============================================================================
-- PLAS ENTERPRISE IMS - UNIFIED FINAL SUPABASE MIGRATION (single-file rebuild)
-- Generated : 2026-10-03 | Target: Supabase Postgres 15+ | Run: SQL Editor
-- Scope     : Admin + Supervisor + Intern | Blank-or-dirty safe (teardown first)
-- ============================================================================
-- EVIDENCE MAP (codebase -> schema):
-- profiles/departments/supervisors/interns: profileService, internService,
--   supervisorService, AuthContext (intern_id/supervisor_id), api/admin/*
-- attendance (+claimed/claim_* + remarks): attendanceService RPCs clock_in,
--   clock_out, submit_claim, review_claim + listForRange/adminList/getStats
-- daily_journals: journalService.list/create/review
-- documents (+file_name/size/mime): documentService (BUCKET intern-documents)
-- evaluations (6 criteria + overall + recommendation): evaluationService
-- announcements (+pinned) + announcement_likes: announcementService RPCs +
--   toggleLike/listLikes | institutions/programs: institutionService,
--   programService, DtrModal embed | settings singleton id=1: settingsService
-- notifications (14 types): notificationService + activityService via RPC only
-- audit_logs: activityService.recordAudit via write_audit_log RPC,
--   auditLogService.list, audit_profile_changes trigger
-- ALL supabase.rpc(...) names below are defined SECURITY DEFINER w/ p_* params.
-- ============================================================================

-- ============================================================================
-- 0. TEARDOWN / RESET (blank-or-dirty safe)
-- ============================================================================
-- !!! DESTRUCTIVE - THIS DROPS EVERY TABLE AND ENUM (ALL DATA LOST) !!!
-- The tripwire below must run BEFORE the teardown, so an accidental paste
-- cannot destroy a populated database. Same session variable convention as
-- scripts/wipe_public_schema.sql. To actually run:
--   SET ims.allow_destructive_wipe = 'YES-I-AM-SURE';
-- To REPAIR a database without losing data, use
--   supabase/migrations/0053_canonical_repair.sql instead of this file.
-- ============================================================================
do $$
begin
  if current_setting('ims.allow_destructive_wipe', true) is distinct from 'YES-I-AM-SURE' then
    raise exception
      'Refusing to run. This drops all 15 public tables and every row in them. '
      'Set the session variable first: SET ims.allow_destructive_wipe = ''YES-I-AM-SURE''; '
      'For a non-destructive repair use supabase/migrations/0053_canonical_repair.sql.';
  end if;
end $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS sync_profile_intern ON public.interns;
DROP TRIGGER IF EXISTS sync_profile_supervisor ON public.supervisors;
DROP TRIGGER IF EXISTS ensure_role_rows_trg ON public.profiles;
DROP TRIGGER IF EXISTS audit_profile_changes ON public.profiles;
DROP TRIGGER IF EXISTS touch_profiles ON public.profiles;
DROP TRIGGER IF EXISTS touch_supervisors ON public.supervisors;
DROP TRIGGER IF EXISTS touch_interns ON public.interns;
DROP TRIGGER IF EXISTS touch_attendance ON public.attendance;
DROP TRIGGER IF EXISTS touch_journals ON public.daily_journals;
DROP TRIGGER IF EXISTS touch_documents ON public.documents;
DROP TRIGGER IF EXISTS touch_evaluations ON public.evaluations;
DROP TRIGGER IF EXISTS touch_announcements ON public.announcements;
DROP TRIGGER IF EXISTS touch_settings ON public.settings;
DROP TRIGGER IF EXISTS touch_institutions ON public.institutions;
DROP TRIGGER IF EXISTS touch_programs ON public.programs;
DROP TRIGGER IF EXISTS set_profiles_updated ON public.profiles;
DROP TRIGGER IF EXISTS set_interns_updated ON public.interns;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT format('%I.%I(%s)', n.nspname, p.proname,
    pg_get_function_identity_arguments(p.oid)) AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('current_role','is_admin',
    'current_intern_id','current_supervisor_id',
    'current_supervisor_department_id','current_supervisor_intern_ids',
    'can_delete_users','can_manage_settings','handle_new_user',
    'sync_profile_links','ensure_role_rows','touch_updated_at',
    'update_updated_at_column','audit_profile_changes','profile_ids_by_role',
    'supervisor_profile_id','intern_profile_id','update_own_profile',
    'notify_user','notify_role','write_audit_log','attendance_today',
    'attendance_hours','attendance_clock_in','attendance_clock_out',
    'attendance_submit_claim','attendance_review_claim','journal_review',
    'document_review','evaluation_create','announcement_create',
    'announcement_update','announcement_delete','get_intern_stats',
    'get_supervisor_stats','get_admin_stats')
  LOOP EXECUTE 'DROP FUNCTION IF EXISTS '||r.sig||' CASCADE'; END LOOP;
END $$;
DROP TABLE IF EXISTS public.announcement_likes CASCADE;
DROP TABLE IF EXISTS public.audit_logs CASCADE;
DROP TABLE IF EXISTS public.notifications CASCADE;
DROP TABLE IF EXISTS public.announcements CASCADE;
DROP TABLE IF EXISTS public.evaluations CASCADE;
DROP TABLE IF EXISTS public.documents CASCADE;
DROP TABLE IF EXISTS public.daily_journals CASCADE;
DROP TABLE IF EXISTS public.attendance CASCADE;
DROP TABLE IF EXISTS public.interns CASCADE;
DROP TABLE IF EXISTS public.programs CASCADE;
DROP TABLE IF EXISTS public.institutions CASCADE;
DROP TABLE IF EXISTS public.supervisors CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.departments CASCADE;
DROP TABLE IF EXISTS public.settings CASCADE;
DROP TYPE IF EXISTS public.user_role CASCADE;
DROP TYPE IF EXISTS public.intern_status CASCADE;
DROP TYPE IF EXISTS public.attendance_status CASCADE;
DROP TYPE IF EXISTS public.journal_status CASCADE;
DROP TYPE IF EXISTS public.document_status CASCADE;
DROP TYPE IF EXISTS public.evaluation_status CASCADE;

DROP TRIGGER IF EXISTS set_settings_updated ON public.settings;

DROP POLICY IF EXISTS "documents storage readable" ON storage.objects;
DROP POLICY IF EXISTS "intern uploads own documents" ON storage.objects;
DROP POLICY IF EXISTS "admins manage storage" ON storage.objects;
DROP POLICY IF EXISTS "intern documents private read" ON storage.objects;
DROP POLICY IF EXISTS "intern documents owner write" ON storage.objects;
DROP POLICY IF EXISTS "intern documents owner delete" ON storage.objects;
DROP POLICY IF EXISTS "intern documents admin manage" ON storage.objects;
DROP POLICY IF EXISTS "moa_admin_upload" ON storage.objects;
DROP POLICY IF EXISTS "moa_admin_read" ON storage.objects;
DROP POLICY IF EXISTS "moa_admin_delete" ON storage.objects;
DROP POLICY IF EXISTS "institution_logos_admin_upload" ON storage.objects;
DROP POLICY IF EXISTS "institution_logos_public_read" ON storage.objects;
DROP POLICY IF EXISTS "institution_logos_admin_delete" ON storage.objects;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE TYPE public.user_role AS ENUM ('admin','hr_staff','supervisor','intern');
CREATE TYPE public.intern_status AS ENUM ('active','completed','archived');
CREATE TYPE public.attendance_status AS ENUM ('present','late','absent','pending');
CREATE TYPE public.journal_status AS ENUM ('pending','approved','rejected');
CREATE TYPE public.document_status AS ENUM ('pending','approved','rejected');
CREATE TYPE public.evaluation_status AS ENUM ('pending','completed','archived');
CREATE TABLE public.departments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE, description text,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.profiles (id uuid PRIMARY KEY
  REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '', email text, avatar_url text,
  contact_number text, bio text,
  role public.user_role NOT NULL DEFAULT 'intern',
  intern_id uuid, supervisor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.supervisors (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  first_name text NOT NULL DEFAULT '', last_name text, email text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.supervisors ADD COLUMN full_name text GENERATED ALWAYS AS
  (btrim(coalesce(first_name,'')||' '||coalesce(last_name,''))) STORED;
CREATE TABLE public.institutions (institution_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_name text NOT NULL, abbreviation text, campus text, address text,
  contact_person text, contact_number text, email text, logo_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.programs (program_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(institution_id) ON DELETE CASCADE,
  program_name text NOT NULL, abbreviation text, program_code text,
  required_hours numeric NOT NULL DEFAULT 300 CHECK (required_hours>=0),
  memo_of_agreement text, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.interns (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  first_name text NOT NULL DEFAULT '', last_name text, email text,
  contact_number text, emergency_contact text,
  student_number text, school text, course text,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  supervisor_id uuid REFERENCES public.supervisors(id) ON DELETE SET NULL,
  institution_id uuid REFERENCES public.institutions(institution_id) ON DELETE SET NULL,
  program_id uuid REFERENCES public.programs(program_id) ON DELETE SET NULL,
  start_date date, end_date date,
  required_hours numeric NOT NULL DEFAULT 300 CHECK (required_hours>=0),
  status public.intern_status NOT NULL DEFAULT 'active',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.attendance (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intern_id uuid NOT NULL REFERENCES public.interns(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Manila')::date,
  time_in timestamptz, time_out timestamptz,
  total_hours numeric NOT NULL DEFAULT 0 CHECK (total_hours>=0),
  method text NOT NULL DEFAULT 'manual',
  status public.attendance_status NOT NULL DEFAULT 'pending',
  remarks text, claimed_time_out timestamptz,
  claim_status text CHECK (claim_status IN ('pending','approved','rejected')),
  claim_remarks text, claim_reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  claim_reviewed_at timestamptz, claim_review_comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (time_out IS NULL OR time_in IS NULL OR time_out>time_in),
  CHECK (claimed_time_out IS NULL OR time_in IS NULL OR claimed_time_out>time_in));
CREATE TABLE public.daily_journals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intern_id uuid NOT NULL REFERENCES public.interns(id) ON DELETE CASCADE,
  supervisor_id uuid REFERENCES public.supervisors(id) ON DELETE SET NULL,
  date date NOT NULL DEFAULT CURRENT_DATE, activities text NOT NULL,
  hours_worked numeric NOT NULL DEFAULT 0 CHECK (hours_worked>=0),
  challenges text, learnings text,
  status public.journal_status NOT NULL DEFAULT 'pending',
  supervisor_comment text, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intern_id uuid NOT NULL REFERENCES public.interns(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('resume','moa','endorsement',
    'school_requirements','completion_report')),
  label text, file_path text, file_url text, file_name text,
  file_size integer CHECK (file_size IS NULL OR file_size>=0), mime_type text,
  status public.document_status NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.evaluations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intern_id uuid NOT NULL REFERENCES public.interns(id) ON DELETE CASCADE,
  supervisor_id uuid REFERENCES public.supervisors(id) ON DELETE SET NULL,
  attendance integer NOT NULL DEFAULT 0 CHECK (attendance BETWEEN 0 AND 5),
  communication integer NOT NULL DEFAULT 0 CHECK (communication BETWEEN 0 AND 5),
  teamwork integer NOT NULL DEFAULT 0 CHECK (teamwork BETWEEN 0 AND 5),
  initiative integer NOT NULL DEFAULT 0 CHECK (initiative BETWEEN 0 AND 5),
  technical_skills integer NOT NULL DEFAULT 0 CHECK (technical_skills BETWEEN 0 AND 5),
  professionalism integer NOT NULL DEFAULT 0 CHECK (professionalism BETWEEN 0 AND 5),
  overall_rating integer NOT NULL DEFAULT 0 CHECK (overall_rating BETWEEN 0 AND 5),
  comments text, final_recommendation text CHECK (final_recommendation IS NULL
    OR final_recommendation IN ('highly_recommend','recommend','neutral','do_not_recommend')),
  status public.evaluation_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.announcements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (btrim(title)<>''), body text NOT NULL,
  category text NOT NULL DEFAULT 'company_news'
    CHECK (category IN ('company_news','schedule','deadline','reminder')),
  pinned boolean NOT NULL DEFAULT false,
  published_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.announcement_likes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT announcement_likes_unique UNIQUE (announcement_id, user_id));
CREATE TABLE public.settings (id integer PRIMARY KEY DEFAULT 1 CHECK (id=1),
  company_name text, internship_duration text,
  required_hours numeric NOT NULL DEFAULT 300 CHECK (required_hours>=0),
  shift_start_minute integer NOT NULL DEFAULT 780
    CHECK (shift_start_minute>=0 AND shift_start_minute<1440),
  is_configured boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('announcement','journal_review',
    'journal_reviewed','journal_submitted','document_review','evaluation_created',
    'evaluation_submitted','attendance_reminder','attendance_update',
    'account_created','intern_assigned','intern_status','supervisor_assigned',
    'supervisor_added')),
  title text NOT NULL, message text NOT NULL, link text,
  is_read boolean NOT NULL DEFAULT false, read_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('create','update','delete','review','login')),
  resource_type text NOT NULL, resource_id uuid,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text, user_agent text,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_supervisors_department ON public.supervisors(department_id);
CREATE INDEX IF NOT EXISTS idx_supervisors_created_by ON public.supervisors(created_by);
CREATE INDEX IF NOT EXISTS idx_programs_institution ON public.programs(institution_id);
CREATE UNIQUE INDEX IF NOT EXISTS programs_program_code_per_inst_unique
  ON public.programs (institution_id, program_code)
  WHERE program_code IS NOT NULL AND program_code<>'';
CREATE INDEX IF NOT EXISTS interns_department_idx ON public.interns(department_id);
CREATE INDEX IF NOT EXISTS interns_supervisor_idx ON public.interns(supervisor_id);
CREATE INDEX IF NOT EXISTS interns_status_idx ON public.interns(status);
CREATE INDEX IF NOT EXISTS idx_interns_institution ON public.interns(institution_id);
CREATE INDEX IF NOT EXISTS idx_interns_program ON public.interns(program_id);
CREATE INDEX IF NOT EXISTS idx_interns_created_by ON public.interns(created_by);
CREATE INDEX IF NOT EXISTS attendance_intern_idx ON public.attendance(intern_id);
CREATE INDEX IF NOT EXISTS attendance_date_idx ON public.attendance(date);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_unique_per_day
  ON public.attendance(intern_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_remarks ON public.attendance(remarks)
  WHERE remarks IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_claim_status ON public.attendance(claim_status)
  WHERE claim_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS journals_intern_idx ON public.daily_journals(intern_id);
CREATE INDEX IF NOT EXISTS journals_status_idx ON public.daily_journals(status);
CREATE INDEX IF NOT EXISTS journals_supervisor_idx ON public.daily_journals(supervisor_id);
CREATE INDEX IF NOT EXISTS documents_intern_idx ON public.documents(intern_id);
CREATE INDEX IF NOT EXISTS documents_status_idx ON public.documents(status);
CREATE INDEX IF NOT EXISTS evaluations_intern_idx ON public.evaluations(intern_id);
CREATE INDEX IF NOT EXISTS evaluations_supervisor_idx ON public.evaluations(supervisor_id);
CREATE INDEX IF NOT EXISTS evaluations_status_idx ON public.evaluations(status);
CREATE INDEX IF NOT EXISTS announcements_pinned_idx ON public.announcements(pinned);
CREATE INDEX IF NOT EXISTS announcements_category_idx ON public.announcements(category);
CREATE INDEX IF NOT EXISTS announcement_likes_user_idx ON public.announcement_likes(user_id);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON public.notifications(user_id, is_read)
  WHERE is_read=false;
CREATE INDEX IF NOT EXISTS audit_logs_resource_idx
  ON public.audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS audit_logs_user_idx ON public.audit_logs(user_id);
CREATE OR REPLACE FUNCTION public.current_role() RETURNS public.user_role
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
  AS $$ SELECT role FROM public.profiles WHERE id=auth.uid(); $$;
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
  AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles
    WHERE id=auth.uid() AND role IN ('admin','hr_staff')); $$;
CREATE OR REPLACE FUNCTION public.can_delete_users() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
  AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles
    WHERE id=auth.uid() AND role='admin'); $$;
CREATE OR REPLACE FUNCTION public.can_manage_settings() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
  AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles
    WHERE id=auth.uid() AND role IN ('admin','hr_staff')); $$;
CREATE OR REPLACE FUNCTION public.current_intern_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
  AS $$ SELECT COALESCE((SELECT i.id FROM public.interns i
    WHERE i.profile_id=auth.uid() LIMIT 1),
    (SELECT p.intern_id FROM public.profiles p
    WHERE p.id=auth.uid() AND p.intern_id IS NOT NULL LIMIT 1)); $$;
CREATE OR REPLACE FUNCTION public.current_supervisor_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
  AS $$ SELECT COALESCE((SELECT s.id FROM public.supervisors s
    WHERE s.profile_id=auth.uid() LIMIT 1),
    (SELECT p.supervisor_id FROM public.profiles p
    WHERE p.id=auth.uid() AND p.supervisor_id IS NOT NULL LIMIT 1)); $$;

CREATE OR REPLACE FUNCTION public.current_supervisor_department_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
  AS $$ SELECT s.department_id FROM public.supervisors s
    WHERE s.id=public.current_supervisor_id() LIMIT 1; $$;
CREATE OR REPLACE FUNCTION public.current_supervisor_intern_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
  AS $$ SELECT i.id FROM public.interns i
    WHERE i.supervisor_id=public.current_supervisor_id(); $$;
CREATE OR REPLACE FUNCTION public.profile_ids_by_role(p_role text) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
  AS $$ SELECT p.id FROM public.profiles p WHERE p.role::text=p_role; $$;
CREATE OR REPLACE FUNCTION public.supervisor_profile_id(p_supervisor_row_id uuid)
  RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
  AS $$ SELECT p.id FROM public.profiles p
    WHERE p.supervisor_id=p_supervisor_row_id LIMIT 1; $$;
CREATE OR REPLACE FUNCTION public.intern_profile_id(p_intern_row_id uuid)
  RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
  AS $$ SELECT p.id FROM public.profiles p
    WHERE p.intern_id=p_intern_row_id LIMIT 1; $$;
CREATE OR REPLACE FUNCTION public.attendance_today() RETURNS date
  LANGUAGE sql STABLE
  AS $$ SELECT (now() AT TIME ZONE 'Asia/Manila')::date; $$;
CREATE OR REPLACE FUNCTION public.attendance_hours(p_time_in timestamptz,
  p_time_out timestamptz) RETURNS numeric LANGUAGE sql IMMUTABLE
  AS $$ SELECT CASE WHEN p_time_in IS NULL OR p_time_out IS NULL THEN NULL
    WHEN p_time_out<=p_time_in THEN 0
    ELSE round((extract(epoch FROM (p_time_out-p_time_in))/3600.0)::numeric,2)
    END; $$;
CREATE OR REPLACE FUNCTION public.attendance_clock_in(p_method text DEFAULT 'manual')
RETURNS public.attendance LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE v_intern uuid:=public.current_intern_id();
  v_today date:=public.attendance_today(); v_shift integer; v_row public.attendance;
BEGIN
  IF v_intern IS NULL THEN RAISE EXCEPTION
    'No intern profile is linked to this account.'
    USING ERRCODE='insufficient_privilege'; END IF;
  IF EXISTS (SELECT 1 FROM public.attendance
    WHERE intern_id=v_intern AND date=v_today) THEN RAISE EXCEPTION
    'You have already submitted your attendance for today.'
    USING ERRCODE='unique_violation'; END IF;
  SELECT COALESCE((SELECT s.shift_start_minute FROM public.settings s
    WHERE s.id=1),780) INTO v_shift;
  INSERT INTO public.attendance (intern_id, date, time_in, method, status)
  VALUES (v_intern, v_today, now(),
    COALESCE(NULLIF(btrim(p_method),''),'manual'),
    CASE WHEN extract(hour FROM now() AT TIME ZONE 'Asia/Manila')*60
      +extract(minute FROM now() AT TIME ZONE 'Asia/Manila')>v_shift
    THEN 'late'::public.attendance_status ELSE 'present'::public.attendance_status END)
  RETURNING * INTO v_row; RETURN v_row;
END; $$;

INSERT INTO public.settings (id, company_name, internship_duration,
  required_hours, shift_start_minute, is_configured)
VALUES (1, 'My Company', '6 months', 300, 780, false)
ON CONFLICT (id) DO NOTHING;
CREATE OR REPLACE FUNCTION public.attendance_clock_out(p_time_out timestamptz,
  p_remarks text DEFAULT NULL) RETURNS public.attendance
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE v_intern uuid:=public.current_intern_id(); v_row public.attendance;
BEGIN
  IF v_intern IS NULL THEN RAISE EXCEPTION
    'No intern profile is linked to this account.'
    USING ERRCODE='insufficient_privilege'; END IF;
  SELECT * INTO v_row FROM public.attendance WHERE intern_id=v_intern
    AND date=public.attendance_today() AND time_out IS NULL
    ORDER BY time_in DESC LIMIT 1 FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'No open attendance record to close.'
    USING ERRCODE='no_data_found'; END IF;
  IF p_time_out IS NULL OR p_time_out<=v_row.time_in THEN RAISE EXCEPTION
    'Time out must be after time in.' USING ERRCODE='check_violation'; END IF;
  UPDATE public.attendance SET time_out=p_time_out,
    total_hours=public.attendance_hours(v_row.time_in,p_time_out),
    remarks=NULLIF(btrim(p_remarks),'')
    WHERE id=v_row.id RETURNING * INTO v_row; RETURN v_row;
END; $$;
CREATE OR REPLACE FUNCTION public.attendance_submit_claim(p_record_id uuid,
  p_claimed_time_out timestamptz, p_remarks text DEFAULT NULL)
RETURNS public.attendance LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE v_intern uuid:=public.current_intern_id(); v_row public.attendance;
BEGIN
  IF v_intern IS NULL THEN RAISE EXCEPTION
    'No intern profile is linked to this account.'
    USING ERRCODE='insufficient_privilege'; END IF;
  SELECT * INTO v_row FROM public.attendance WHERE id=p_record_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Attendance record not found.'
    USING ERRCODE='no_data_found'; END IF;
  IF v_row.intern_id<>v_intern AND NOT public.is_admin() THEN RAISE EXCEPTION
    'You can only claim your own attendance.'
    USING ERRCODE='insufficient_privilege'; END IF;
  IF v_row.time_out IS NOT NULL THEN RAISE EXCEPTION
    'This record is already closed.' USING ERRCODE='check_violation'; END IF;
  IF v_row.claim_status='pending' THEN RAISE EXCEPTION
    'You already have a pending claim.' USING ERRCODE='check_violation'; END IF;
  IF p_claimed_time_out IS NULL OR p_claimed_time_out<=v_row.time_in THEN
    RAISE EXCEPTION 'Claimed time out must be after time in.'
    USING ERRCODE='check_violation'; END IF;
  UPDATE public.attendance SET claimed_time_out=p_claimed_time_out,
    claim_status='pending', claim_remarks=NULLIF(btrim(p_remarks),''),
    claim_reviewed_by=NULL, claim_reviewed_at=NULL, claim_review_comment=NULL
    WHERE id=v_row.id RETURNING * INTO v_row; RETURN v_row;
END; $$;
CREATE OR REPLACE FUNCTION public.attendance_review_claim(p_record_id uuid,
  p_decision text, p_comment text DEFAULT NULL) RETURNS public.attendance
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE v_row public.attendance; v_sup uuid:=public.current_supervisor_id();
BEGIN
  IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION
    'Decision must be approved or rejected.' USING ERRCODE='check_violation'; END IF;
  SELECT * INTO v_row FROM public.attendance WHERE id=p_record_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Attendance record not found.'
    USING ERRCODE='no_data_found'; END IF;
  IF NOT public.is_admin() AND NOT EXISTS (SELECT 1 FROM public.interns i
    WHERE i.id=v_row.intern_id AND i.supervisor_id=v_sup) THEN RAISE EXCEPTION
    'You are not assigned to this intern.' USING ERRCODE='insufficient_privilege'; END IF;
  IF v_row.claim_status IS NULL OR v_row.claim_status<>'pending' THEN RAISE EXCEPTION
    'No pending claim exists for this record.' USING ERRCODE='check_violation'; END IF;
  UPDATE public.attendance SET claim_status=p_decision,
    claim_reviewed_by=auth.uid(), claim_reviewed_at=now(),
    claim_review_comment=NULLIF(btrim(p_comment),''),
    remarks=NULLIF(btrim(p_comment),''),
    time_out=CASE WHEN p_decision='approved' THEN v_row.claimed_time_out
                  ELSE time_out END,
    total_hours=CASE WHEN p_decision='approved'
                     THEN public.attendance_hours(v_row.time_in, v_row.claimed_time_out)
                     ELSE total_hours END,
    method=CASE WHEN p_decision='approved' THEN 'claimed' ELSE method END,
    status=CASE WHEN p_decision='rejected' THEN 'absent'::public.attendance_status
                ELSE status END
    WHERE id=v_row.id RETURNING * INTO v_row;
  RETURN v_row;
END; $$;
CREATE OR REPLACE FUNCTION public.journal_review(p_journal_id uuid,
  p_status text, p_comment text DEFAULT NULL) RETURNS public.daily_journals
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE v_row public.daily_journals; v_sup uuid:=public.current_supervisor_id();
BEGIN
  IF p_status NOT IN ('pending','approved','rejected') THEN RAISE EXCEPTION
    'Invalid journal status.' USING ERRCODE='check_violation'; END IF;
  SELECT * INTO v_row FROM public.daily_journals WHERE id=p_journal_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Journal entry not found.'
    USING ERRCODE='no_data_found'; END IF;
  IF NOT public.is_admin() AND NOT EXISTS (SELECT 1 FROM public.interns i
    WHERE i.id=v_row.intern_id AND i.supervisor_id=v_sup) THEN RAISE EXCEPTION
    'You are not assigned to this intern.' USING ERRCODE='insufficient_privilege'; END IF;
  UPDATE public.daily_journals SET status=p_status::public.journal_status,
    supervisor_comment=NULLIF(btrim(p_comment),''),
    supervisor_id=COALESCE(v_sup,supervisor_id)
    WHERE id=v_row.id RETURNING * INTO v_row; RETURN v_row;
END; $$;
CREATE OR REPLACE FUNCTION public.document_review(p_document_id uuid, p_status text)
RETURNS public.documents LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE v_row public.documents;
BEGIN
  IF p_status NOT IN ('pending','approved','rejected') THEN RAISE EXCEPTION
    'Invalid document status.' USING ERRCODE='check_violation'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION
    'Only administrators may review documents.'
    USING ERRCODE='insufficient_privilege'; END IF;
  UPDATE public.documents SET status=p_status::public.document_status,
    reviewed_by=auth.uid(), reviewed_at=now()
    WHERE id=p_document_id RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Document not found.'
    USING ERRCODE='no_data_found'; END IF;
  RETURN v_row;
END; $$;
CREATE OR REPLACE FUNCTION public.evaluation_create(p_intern_id uuid,
  p_attendance integer, p_communication integer, p_teamwork integer,
  p_initiative integer, p_technical_skills integer, p_professionalism integer,
  p_overall_rating integer, p_comments text DEFAULT NULL,
  p_final_recommendation text DEFAULT NULL) RETURNS public.evaluations
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE v_sup uuid:=public.current_supervisor_id(); v_row public.evaluations;
BEGIN
  IF v_sup IS NULL THEN RAISE EXCEPTION
    'Only supervisors may submit evaluations.'
    USING ERRCODE='insufficient_privilege'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.interns i
    WHERE i.id=p_intern_id AND i.supervisor_id=v_sup) THEN RAISE EXCEPTION
    'You are not assigned to this intern.' USING ERRCODE='insufficient_privilege'; END IF;
  IF p_final_recommendation IS NOT NULL AND p_final_recommendation NOT IN
    ('highly_recommend','recommend','neutral','do_not_recommend') THEN RAISE EXCEPTION
    'Invalid final recommendation.' USING ERRCODE='check_violation'; END IF;
  INSERT INTO public.evaluations (intern_id, supervisor_id, attendance,
    communication, teamwork, initiative, technical_skills, professionalism,
    overall_rating, comments, final_recommendation, status)
  VALUES (p_intern_id, v_sup, COALESCE(p_attendance,0),
    COALESCE(p_communication,0), COALESCE(p_teamwork,0),
    COALESCE(p_initiative,0), COALESCE(p_technical_skills,0),
    COALESCE(p_professionalism,0), COALESCE(p_overall_rating,0),
    p_comments, p_final_recommendation, 'pending')
  RETURNING * INTO v_row; RETURN v_row;
END; $$;
CREATE OR REPLACE FUNCTION public.notify_user(p_user_id uuid, p_type text,
  p_title text, p_message text, p_link text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$ DECLARE v_id uuid;
BEGIN INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
  VALUES (p_user_id, p_type, p_title, p_message, NULLIF(btrim(p_link),''),
    COALESCE(p_metadata,'{}'::jsonb)) RETURNING id INTO v_id; RETURN v_id; END; $$;
CREATE OR REPLACE FUNCTION public.notify_role(p_role text, p_type text,
  p_title text, p_message text, p_link text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$ DECLARE v_n integer:=0;
BEGIN INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
  SELECT p.id, p_type, p_title, p_message, NULLIF(btrim(p_link),''),
    COALESCE(p_metadata,'{}'::jsonb) FROM public.profiles p
    WHERE p.role::text=p_role;
  GET DIAGNOSTICS v_n=ROW_COUNT; RETURN v_n; END; $$;
CREATE OR REPLACE FUNCTION public.write_audit_log(p_action text,
  p_resource_type text, p_resource_id uuid DEFAULT NULL,
  p_changes jsonb DEFAULT '{}'::jsonb) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$ DECLARE v_id uuid; v_ip text; v_ua text;
BEGIN
  BEGIN v_ip:=NULLIF(btrim(current_setting('request.headers',true)::jsonb
    ->>'x-forwarded-for'),''); EXCEPTION WHEN OTHERS THEN v_ip:=NULL; END;
  BEGIN v_ua:=NULLIF(btrim(current_setting('request.headers',true)::jsonb
    ->>'user-agent'),''); EXCEPTION WHEN OTHERS THEN v_ua:=NULL; END;
  INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id,
    changes, ip_address, user_agent)
  VALUES (auth.uid(), p_action, p_resource_type, p_resource_id,
    COALESCE(p_changes,'{}'::jsonb), v_ip, v_ua)
  RETURNING id INTO v_id; RETURN v_id; END; $$;
CREATE OR REPLACE FUNCTION public.announcement_create(p_title text, p_body text,
  p_category text DEFAULT 'company_news', p_pinned boolean DEFAULT false)
RETURNS public.announcements LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$ DECLARE v_row public.announcements;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION
    'Only administrators may manage announcements.'
    USING ERRCODE='insufficient_privilege'; END IF;
  INSERT INTO public.announcements (title, body, category, pinned, published_by)
  VALUES (NULLIF(btrim(p_title),''), p_body,
    COALESCE(p_category,'company_news'), COALESCE(p_pinned,false), auth.uid())
  RETURNING * INTO v_row;
  PERFORM public.write_audit_log('create','announcement',v_row.id,
    jsonb_build_object('title',v_row.title,'category',v_row.category));
  RETURN v_row; END; $$;
CREATE OR REPLACE FUNCTION public.announcement_update(p_id uuid,
  p_title text DEFAULT NULL, p_body text DEFAULT NULL,
  p_category text DEFAULT NULL, p_pinned boolean DEFAULT NULL)
RETURNS public.announcements LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$ DECLARE v_before public.announcements; v_row public.announcements;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION
    'Only administrators may manage announcements.'
    USING ERRCODE='insufficient_privilege'; END IF;
  SELECT * INTO v_before FROM public.announcements WHERE id=p_id;
  IF v_before.id IS NULL THEN RAISE EXCEPTION 'Announcement not found.'
    USING ERRCODE='no_data_found'; END IF;
  UPDATE public.announcements SET title=COALESCE(NULLIF(btrim(p_title),''),title),
    body=COALESCE(NULLIF(btrim(p_body),''),body),
    category=COALESCE(p_category,category), pinned=COALESCE(p_pinned,pinned)
    WHERE id=p_id RETURNING * INTO v_row;
  PERFORM public.write_audit_log('update','announcement',v_row.id,
    jsonb_build_object('title_before',v_before.title,'title_after',v_row.title,
    'pinned_before',v_before.pinned,'pinned_after',v_row.pinned));
  RETURN v_row; END; $$;
CREATE OR REPLACE FUNCTION public.announcement_delete(p_id uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$ DECLARE v_before public.announcements;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION
    'Only administrators may manage announcements.'
    USING ERRCODE='insufficient_privilege'; END IF;
  SELECT * INTO v_before FROM public.announcements WHERE id=p_id;
  IF v_before.id IS NULL THEN RAISE EXCEPTION 'Announcement not found.'
    USING ERRCODE='no_data_found'; END IF;
  DELETE FROM public.announcements WHERE id=p_id;
  PERFORM public.write_audit_log('delete','announcement',p_id,
    jsonb_build_object('title',v_before.title,'body',v_before.body,
                       'category',v_before.category));
  RETURN true;
END; $$;
CREATE OR REPLACE FUNCTION public.update_own_profile(
  p_full_name text DEFAULT NULL, p_contact_number text DEFAULT NULL,
  p_bio text DEFAULT NULL, p_avatar_url text DEFAULT NULL)
RETURNS public.profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$ DECLARE v_row public.profiles;
BEGIN UPDATE public.profiles SET full_name=COALESCE(p_full_name,full_name),
  contact_number=COALESCE(p_contact_number,contact_number),
  bio=COALESCE(p_bio,bio), avatar_url=COALESCE(p_avatar_url,avatar_url)
  WHERE id=auth.uid() RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION
    'Profile not found for the current user' USING ERRCODE='no_data_found'; END IF;
  RETURN v_row; END; $$;
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_role public.user_role := 'intern';
  v_raw  text;
BEGIN
  -- Honour raw_user_meta_data.role so admin/supervisor signups keep their role.
  v_raw := NEW.raw_user_meta_data ->> 'role';
  IF v_raw IS NOT NULL THEN
    BEGIN
      v_role := v_raw::public.user_role;
    EXCEPTION WHEN invalid_text_representation THEN
      v_role := 'intern';
    END;
  END IF;
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name',''),
    NEW.email, v_role)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION public.ensure_role_rows() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$ DECLARE v_dept uuid; mk boolean:=false; v_full text;
BEGIN
  IF TG_OP='INSERT' THEN mk:=true;
  ELSIF TG_OP='UPDATE' THEN mk:=(OLD.role IS DISTINCT FROM NEW.role); END IF;
  IF NOT mk THEN RETURN NEW; END IF;
  v_full:=btrim(COALESCE(NEW.full_name,''));
  IF NEW.role='intern' AND NOT EXISTS
    (SELECT 1 FROM public.interns i WHERE i.profile_id=NEW.id) THEN
    SELECT d.id INTO v_dept FROM public.departments d ORDER BY d.id LIMIT 1;
    INSERT INTO public.interns (id, profile_id, first_name, last_name, email,
      status, required_hours, department_id)
    VALUES (gen_random_uuid(), NEW.id,
      COALESCE(NULLIF(split_part(v_full,' ',1),''),''),
      NULLIF(btrim(regexp_replace(v_full,'^\\S+\\s*',''))),
      NEW.email,'active',300,v_dept); END IF;
  IF NEW.role='supervisor' AND NOT EXISTS
    (SELECT 1 FROM public.supervisors s WHERE s.profile_id=NEW.id) THEN
    SELECT d.id INTO v_dept FROM public.departments d ORDER BY d.id LIMIT 1;
    INSERT INTO public.supervisors (id, profile_id, first_name, last_name,
      email, department_id)
    VALUES (gen_random_uuid(), NEW.id,
      COALESCE(NULLIF(split_part(v_full,' ',1),''),''),
      NULLIF(btrim(regexp_replace(v_full,'^\\S+\\s*',''))),
      NEW.email,v_dept); END IF;
  RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.sync_profile_links() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$ BEGIN
  IF TG_TABLE_NAME='interns' THEN
    IF TG_OP='DELETE' THEN UPDATE public.profiles SET intern_id=NULL
      WHERE intern_id=OLD.id; RETURN OLD;
    ELSIF NEW.profile_id IS NOT NULL THEN UPDATE public.profiles
      SET intern_id=NEW.id WHERE id=NEW.profile_id; RETURN NEW; END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME='supervisors' THEN
    IF TG_OP='DELETE' THEN UPDATE public.profiles SET supervisor_id=NULL
      WHERE supervisor_id=OLD.id; RETURN OLD;
    ELSIF NEW.profile_id IS NOT NULL THEN UPDATE public.profiles
      SET supervisor_id=NEW.id WHERE id=NEW.profile_id; RETURN NEW; END IF;
    RETURN NEW; END IF;
  RETURN NULL; END; $$;
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.audit_profile_changes() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$ DECLARE v_changes jsonb:='{}'::jsonb;
BEGIN
  IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN v_changes:=jsonb_set(
    v_changes,'{full_name}',jsonb_build_object('from',OLD.full_name,'to',NEW.full_name)); END IF;
  IF NEW.contact_number IS DISTINCT FROM OLD.contact_number THEN v_changes:=jsonb_set(
    v_changes,'{contact_number}',jsonb_build_object('from',OLD.contact_number,'to',NEW.contact_number)); END IF;
  IF NEW.bio IS DISTINCT FROM OLD.bio THEN v_changes:=jsonb_set(
    v_changes,'{bio}',jsonb_build_object('from',OLD.bio,'to',NEW.bio)); END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN v_changes:=jsonb_set(
    v_changes,'{role}',jsonb_build_object('from',OLD.role,'to',NEW.role)); END IF;
  IF v_changes='{}'::jsonb THEN RETURN NULL; END IF;
  INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id, changes)
  VALUES (auth.uid(),'update','profile',NEW.id,v_changes);
  RETURN NULL; END; $$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
DROP TRIGGER IF EXISTS touch_profiles ON public.profiles;
CREATE TRIGGER touch_profiles BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS touch_supervisors ON public.supervisors;
CREATE TRIGGER touch_supervisors BEFORE UPDATE ON public.supervisors
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS touch_interns ON public.interns;
CREATE TRIGGER touch_interns BEFORE UPDATE ON public.interns
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS touch_attendance ON public.attendance;
CREATE TRIGGER touch_attendance BEFORE UPDATE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS touch_journals ON public.daily_journals;
CREATE TRIGGER touch_journals BEFORE UPDATE ON public.daily_journals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS touch_documents ON public.documents;
CREATE TRIGGER touch_documents BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS touch_evaluations ON public.evaluations;
CREATE TRIGGER touch_evaluations BEFORE UPDATE ON public.evaluations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS touch_announcements ON public.announcements;
CREATE TRIGGER touch_announcements BEFORE UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS touch_settings ON public.settings;
CREATE TRIGGER touch_settings BEFORE UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS touch_institutions ON public.institutions;
CREATE TRIGGER touch_institutions BEFORE UPDATE ON public.institutions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS touch_programs ON public.programs;
CREATE TRIGGER touch_programs BEFORE UPDATE ON public.programs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
UPDATE public.profiles p SET intern_id=i.id FROM public.interns i
  WHERE i.profile_id=p.id AND p.intern_id IS DISTINCT FROM i.id;
UPDATE public.profiles p SET supervisor_id=s.id FROM public.supervisors s
  WHERE s.profile_id=p.id AND p.supervisor_id IS DISTINCT FROM s.id;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles select directory" ON public.profiles;
CREATE POLICY "profiles select directory" ON public.profiles
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "users update own profile pinned role" ON public.profiles;
CREATE POLICY "users update own profile pinned role" ON public.profiles
  FOR UPDATE TO authenticated USING (id=auth.uid())
  WITH CHECK (id=auth.uid() AND role=public.current_role());
DROP POLICY IF EXISTS "admins manage profiles" ON public.profiles;
CREATE POLICY "admins manage profiles" ON public.profiles
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "departments readable" ON public.departments;
CREATE POLICY "departments readable" ON public.departments
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "admins manage departments" ON public.departments;
CREATE POLICY "admins manage departments" ON public.departments
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "institutions readable" ON public.institutions;
CREATE POLICY "institutions readable" ON public.institutions
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "admins manage institutions" ON public.institutions;
CREATE POLICY "admins manage institutions" ON public.institutions
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "programs readable" ON public.programs;
CREATE POLICY "programs readable" ON public.programs
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "admins manage programs" ON public.programs;
CREATE POLICY "admins manage programs" ON public.programs
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "supervisors readable" ON public.supervisors;
CREATE POLICY "supervisors readable" ON public.supervisors
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "interns select scoped" ON public.interns;
CREATE POLICY "interns select scoped" ON public.interns
  FOR SELECT TO authenticated USING (public.is_admin()
    OR id=public.current_intern_id()
    OR supervisor_id=public.current_supervisor_id()
    OR created_by=auth.uid());
DROP POLICY IF EXISTS "admins manage interns" ON public.interns;
CREATE POLICY "admins manage interns" ON public.interns
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "supervisor inserts assigned interns" ON public.interns;
CREATE POLICY "supervisor inserts assigned interns" ON public.interns
  FOR INSERT TO authenticated WITH CHECK (
    public.current_supervisor_id() IS NOT NULL
    AND (supervisor_id=public.current_supervisor_id() OR created_by=auth.uid()));
DROP POLICY IF EXISTS "supervisor updates assigned interns" ON public.interns;
CREATE POLICY "supervisor updates assigned interns" ON public.interns
  FOR UPDATE TO authenticated
  USING (supervisor_id=public.current_supervisor_id())
  WITH CHECK (supervisor_id=public.current_supervisor_id());
DROP POLICY IF EXISTS "attendance select scoped" ON public.attendance;
CREATE POLICY "attendance select scoped" ON public.attendance
  FOR SELECT TO authenticated USING (public.is_admin()
    OR intern_id=public.current_intern_id()
    OR intern_id IN (SELECT id FROM public.interns
      WHERE supervisor_id=public.current_supervisor_id()));
DROP POLICY IF EXISTS "admins manage attendance" ON public.attendance;
CREATE POLICY "admins manage attendance" ON public.attendance
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "supervisor reviews attendance claims" ON public.attendance;
CREATE POLICY "supervisor reviews attendance claims" ON public.attendance
  FOR UPDATE TO authenticated
  USING (intern_id IN (SELECT id FROM public.interns
    WHERE supervisor_id=public.current_supervisor_id()))
  WITH CHECK (intern_id IN (SELECT id FROM public.interns
    WHERE supervisor_id=public.current_supervisor_id()));
DROP POLICY IF EXISTS "journals select scoped" ON public.daily_journals;
CREATE POLICY "journals select scoped" ON public.daily_journals
  FOR SELECT TO authenticated USING (public.is_admin()
    OR intern_id=public.current_intern_id()
    OR supervisor_id=public.current_supervisor_id()
    OR intern_id IN (SELECT id FROM public.interns
      WHERE supervisor_id=public.current_supervisor_id()));
DROP POLICY IF EXISTS "admins manage journals" ON public.daily_journals;
CREATE POLICY "admins manage journals" ON public.daily_journals
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "intern inserts own journals" ON public.daily_journals;
CREATE POLICY "intern inserts own journals" ON public.daily_journals
  FOR INSERT TO authenticated WITH CHECK (intern_id=public.current_intern_id());
DROP POLICY IF EXISTS "supervisor reviews assigned journals" ON public.daily_journals;
CREATE POLICY "supervisor reviews assigned journals" ON public.daily_journals
  FOR UPDATE TO authenticated
  USING (intern_id IN (SELECT id FROM public.interns
    WHERE supervisor_id=public.current_supervisor_id()))
  WITH CHECK (intern_id IN (SELECT id FROM public.interns
    WHERE supervisor_id=public.current_supervisor_id()));
DROP POLICY IF EXISTS "documents select scoped" ON public.documents;
CREATE POLICY "documents select scoped" ON public.documents
  FOR SELECT TO authenticated USING (public.is_admin()
    OR intern_id=public.current_intern_id()
    OR intern_id IN (SELECT id FROM public.interns
      WHERE supervisor_id=public.current_supervisor_id()));
DROP POLICY IF EXISTS "admins manage documents" ON public.documents;
CREATE POLICY "admins manage documents" ON public.documents
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "intern inserts own documents" ON public.documents;
CREATE POLICY "intern inserts own documents" ON public.documents
  FOR INSERT TO authenticated WITH CHECK (intern_id=public.current_intern_id());
DROP POLICY IF EXISTS "intern deletes own documents" ON public.documents;
CREATE POLICY "intern deletes own documents" ON public.documents
  FOR DELETE TO authenticated USING (intern_id=public.current_intern_id());

DROP POLICY IF EXISTS "admins manage supervisors" ON public.supervisors;
CREATE POLICY "admins manage supervisors" ON public.supervisors
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
DROP TRIGGER IF EXISTS sync_profile_intern ON public.interns;
CREATE TRIGGER sync_profile_intern AFTER INSERT OR UPDATE OR DELETE ON public.interns
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_links();
DROP TRIGGER IF EXISTS sync_profile_supervisor ON public.supervisors;
CREATE TRIGGER sync_profile_supervisor AFTER INSERT OR UPDATE OR DELETE ON public.supervisors
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_links();

-- ---------------------------------------------------------------------------
-- 0021: self-healing intern/supervisor <-> profile links on EVERY write.
-- Without these, an intern row written with profile_id / department_id NULL
-- never self-corrects, so RLS (current_intern_id()) and the supervisor list
-- silently come up empty. The teardown above does not drop these functions,
-- but they must be defined for a blank database.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_intern_links() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
declare
  v_profile uuid;
  v_dept    uuid;
begin
  if new.profile_id is null then
    select p.id into v_profile from public.profiles p
     where p.id = new.created_by and p.role = 'intern';
    if v_profile is null and new.email is not null then
      select p.id into v_profile from public.profiles p
       where p.role = 'intern' and lower(p.email) = lower(new.email) limit 1;
    end if;
    if v_profile is not null then new.profile_id := v_profile; end if;
  end if;

  if new.department_id is null and new.supervisor_id is not null then
    select s.department_id into v_dept from public.supervisors s
     where s.id = new.supervisor_id;
    if v_dept is not null then new.department_id := v_dept; end if;
  end if;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.ensure_supervisor_links() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
declare
  v_profile uuid;
begin
  if new.profile_id is null then
    select p.id into v_profile from public.profiles p
     where p.id = new.created_by and p.role = 'supervisor';
    if v_profile is null and new.email is not null then
      select p.id into v_profile from public.profiles p
       where p.role = 'supervisor' and lower(p.email) = lower(new.email) limit 1;
    end if;
    if v_profile is not null then new.profile_id := v_profile; end if;
  end if;
  return new;
end;
$$;

DROP TRIGGER IF EXISTS ensure_intern_links_trg ON public.interns;
CREATE TRIGGER ensure_intern_links_trg
  BEFORE INSERT OR UPDATE ON public.interns
  FOR EACH ROW EXECUTE FUNCTION public.ensure_intern_links();
DROP TRIGGER IF EXISTS ensure_supervisor_links_trg ON public.supervisors;
CREATE TRIGGER ensure_supervisor_links_trg
  BEFORE INSERT OR UPDATE ON public.supervisors
  FOR EACH ROW EXECUTE FUNCTION public.ensure_supervisor_links();

DROP POLICY IF EXISTS "evaluations select scoped" ON public.evaluations;
CREATE POLICY "evaluations select scoped" ON public.evaluations
  FOR SELECT TO authenticated USING (public.is_admin()
    OR intern_id=public.current_intern_id()
    OR supervisor_id=public.current_supervisor_id());
DROP POLICY IF EXISTS "admins manage evaluations" ON public.evaluations;
CREATE POLICY "admins manage evaluations" ON public.evaluations
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "supervisor inserts assigned evaluations" ON public.evaluations;
CREATE POLICY "supervisor inserts assigned evaluations" ON public.evaluations
  FOR INSERT TO authenticated WITH CHECK (
    supervisor_id=public.current_supervisor_id()
    AND intern_id IN (SELECT id FROM public.interns
      WHERE supervisor_id=public.current_supervisor_id()));
DROP POLICY IF EXISTS "announcements readable" ON public.announcements;
CREATE POLICY "announcements readable" ON public.announcements
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "admins manage announcements" ON public.announcements;
CREATE POLICY "admins manage announcements" ON public.announcements
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "announcement likes readable" ON public.announcement_likes;
CREATE POLICY "announcement likes readable" ON public.announcement_likes
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "users insert own announcement like" ON public.announcement_likes;
CREATE POLICY "users insert own announcement like" ON public.announcement_likes
  FOR INSERT TO authenticated WITH CHECK (user_id=auth.uid());
DROP POLICY IF EXISTS "users delete own announcement like" ON public.announcement_likes;
CREATE POLICY "users delete own announcement like" ON public.announcement_likes
  FOR DELETE TO authenticated USING (user_id=auth.uid());
DROP POLICY IF EXISTS "admins manage announcement likes" ON public.announcement_likes;
CREATE POLICY "admins manage announcement likes" ON public.announcement_likes
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "settings readable" ON public.settings;
CREATE POLICY "settings readable" ON public.settings
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "admins manage settings" ON public.settings;
CREATE POLICY "admins manage settings" ON public.settings
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "user reads own notifications" ON public.notifications;
CREATE POLICY "user reads own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (user_id=auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS "user updates own notifications" ON public.notifications;
CREATE POLICY "user updates own notifications" ON public.notifications
  FOR UPDATE TO authenticated USING (user_id=auth.uid())
  WITH CHECK (user_id=auth.uid());
DROP POLICY IF EXISTS "admins manage notifications" ON public.notifications;
CREATE POLICY "admins manage notifications" ON public.notifications
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "admins read audit logs" ON public.audit_logs;
CREATE POLICY "admins read audit logs" ON public.audit_logs
  FOR SELECT TO authenticated USING (public.is_admin());
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('intern-documents','intern-documents',false,5242880,
  ARRAY['application/pdf','image/png','image/jpeg','image/gif','image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT (id) DO UPDATE SET public=false, file_size_limit=5242880,
  allowed_mime_types=ARRAY['application/pdf','image/png','image/jpeg',
  'image/gif','image/webp','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
INSERT INTO storage.buckets (id, name, public)
VALUES ('institution-logos','institution-logos',true)
ON CONFLICT (id) DO UPDATE SET public=true;
INSERT INTO storage.buckets (id, name, public)
VALUES ('institution-moa','institution-moa',false)
ON CONFLICT (id) DO UPDATE SET public=false;

  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_links();
DROP POLICY IF EXISTS "intern documents private read" ON storage.objects;
CREATE POLICY "intern documents private read" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id='intern-documents'
    AND (public.is_admin()
      OR (storage.foldername(name))[1]=public.current_intern_id()::text
      OR EXISTS (SELECT 1 FROM public.interns i
        WHERE i.id::text=(storage.foldername(name))[1]
        AND i.supervisor_id=public.current_supervisor_id())));
DROP POLICY IF EXISTS "intern documents owner write" ON storage.objects;
CREATE POLICY "intern documents owner write" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id='intern-documents'
    AND (storage.foldername(name))[1]=public.current_intern_id()::text);
DROP POLICY IF EXISTS "intern documents owner delete" ON storage.objects;
CREATE POLICY "intern documents owner delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id='intern-documents'
    AND ((storage.foldername(name))[1]=public.current_intern_id()::text
      OR public.is_admin()));
DROP POLICY IF EXISTS "intern documents admin manage" ON storage.objects;
CREATE POLICY "intern documents admin manage" ON storage.objects
  FOR ALL TO authenticated USING (bucket_id='intern-documents' AND public.is_admin())
  WITH CHECK (bucket_id='intern-documents' AND public.is_admin());
DROP POLICY IF EXISTS "institution_logos_public_read" ON storage.objects;
CREATE POLICY "institution_logos_public_read" ON storage.objects
  FOR SELECT USING (bucket_id='institution-logos');
DROP POLICY IF EXISTS "institution_logos_admin_upload" ON storage.objects;
CREATE POLICY "institution_logos_admin_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id='institution-logos' AND public.is_admin());
DROP POLICY IF EXISTS "institution_logos_admin_delete" ON storage.objects;
CREATE POLICY "institution_logos_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id='institution-logos' AND public.is_admin());
DROP POLICY IF EXISTS "moa_admin_read" ON storage.objects;
CREATE POLICY "moa_admin_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id='institution-moa' AND public.is_admin());
DROP POLICY IF EXISTS "moa_admin_upload" ON storage.objects;
CREATE POLICY "moa_admin_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id='institution-moa' AND public.is_admin());
DROP POLICY IF EXISTS "moa_admin_delete" ON storage.objects;
CREATE POLICY "moa_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id='institution-moa' AND public.is_admin());
REVOKE ALL ON SCHEMA public FROM anon;
REVOKE CREATE ON SCHEMA public FROM public;
REVOKE CREATE ON SCHEMA public FROM authenticated;
REVOKE CREATE ON SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM public, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
REVOKE INSERT, UPDATE ON public.attendance FROM authenticated;
GRANT UPDATE (claimed_time_out, claim_status, claim_remarks)
  ON public.attendance TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.announcements FROM authenticated;
REVOKE UPDATE ON public.evaluations FROM authenticated;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','departments','supervisors',
    'institutions','programs','interns','attendance','daily_journals',
    'documents','evaluations','announcements','announcement_likes',
    'settings','notifications','audit_logs']
  LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
    END IF;
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
