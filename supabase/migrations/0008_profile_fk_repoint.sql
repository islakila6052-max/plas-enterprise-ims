-- ================================================================
-- INTERNSHIP MANAGEMENT SYSTEM - PRODUCTION SCHEMA
-- Version: 3.0 (Production Ready)
-- Supports: Admin, HR Staff, Supervisor, Intern roles
-- Real data flow with proper relationships
-- ================================================================

-- ================================================================
-- 1. DROP EVERYTHING (Clean slate - use with caution!)
-- ================================================================

-- Drop triggers
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS sync_profile_intern ON public.interns;
DROP TRIGGER IF EXISTS sync_profile_supervisor ON public.supervisors;
DROP TRIGGER IF EXISTS set_profiles_updated ON public.profiles;
DROP TRIGGER IF EXISTS set_interns_updated ON public.interns;
DROP TRIGGER IF EXISTS set_settings_updated ON public.settings;
DROP TRIGGER IF EXISTS update_intern_updated_at ON public.interns;
DROP TRIGGER IF EXISTS update_profile_updated_at ON public.profiles;

-- Drop functions
DROP FUNCTION IF EXISTS public.current_role() CASCADE;
DROP FUNCTION IF EXISTS public.is_admin() CASCADE;
DROP FUNCTION IF EXISTS public.current_supervisor_id() CASCADE;
DROP FUNCTION IF EXISTS public.current_intern_id() CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.sync_profile_links() CASCADE;
DROP FUNCTION IF EXISTS public.update_updated_at_column() CASCADE;
DROP FUNCTION IF EXISTS public.get_intern_stats(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_supervisor_stats(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_admin_stats() CASCADE;

-- Drop tables
DROP TABLE IF EXISTS public.audit_logs CASCADE;
DROP TABLE IF EXISTS public.notifications CASCADE;
DROP TABLE IF EXISTS public.documents CASCADE;
DROP TABLE IF EXISTS public.evaluations CASCADE;
DROP TABLE IF EXISTS public.daily_journals CASCADE;
DROP TABLE IF EXISTS public.attendance CASCADE;
DROP TABLE IF EXISTS public.interns CASCADE;
DROP TABLE IF EXISTS public.supervisors CASCADE;
DROP TABLE IF EXISTS public.announcements CASCADE;
DROP TABLE IF EXISTS public.departments CASCADE;
DROP TABLE IF EXISTS public.settings CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- Drop enums
DROP TYPE IF EXISTS user_role CASCADE;
DROP TYPE IF EXISTS intern_status CASCADE;
DROP TYPE IF EXISTS attendance_status CASCADE;
DROP TYPE IF EXISTS journal_status CASCADE;
DROP TYPE IF EXISTS document_status CASCADE;
DROP TYPE IF EXISTS evaluation_status CASCADE;
DROP TYPE IF EXISTS notification_type CASCADE;

-- ================================================================
-- 2. EXTENSIONS
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS moddatetime SCHEMA extensions;

-- ================================================================
-- 3. ENUMS
-- ================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('admin', 'hr_staff', 'supervisor', 'intern');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'intern_status') THEN
    CREATE TYPE intern_status AS ENUM ('active', 'completed', 'archived');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_status') THEN
    CREATE TYPE attendance_status AS ENUM ('present', 'late', 'absent', 'pending');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'journal_status') THEN
    CREATE TYPE journal_status AS ENUM ('pending', 'approved', 'rejected');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_status') THEN
    CREATE TYPE document_status AS ENUM ('pending', 'approved', 'rejected');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'evaluation_status') THEN
    CREATE TYPE evaluation_status AS ENUM ('pending', 'completed', 'archived');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
    CREATE TYPE notification_type AS ENUM (
      'announcement',
      'journal_review',
      'document_review',
      'evaluation_created',
      'attendance_reminder',
      'intern_assigned',
      'account_created'
    );
  END IF;
END $$;

-- ================================================================
-- 4. CORE TABLES
-- ================================================================

-- -----------------------------------------------------------------
-- PROFILES (1:1 with auth.users)
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT,
  avatar_url TEXT,
  contact_number TEXT,
  bio TEXT,
  role user_role NOT NULL DEFAULT 'intern',
  intern_id UUID,
  supervisor_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------
-- DEPARTMENTS
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------
-- SUPERVISORS
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supervisors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  full_name TEXT,
  email TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------
-- INTERNS (Core entity - links to auth via profile_id)
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.interns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  student_number TEXT,
  school TEXT,
  course TEXT,
  contact_number TEXT,
  email TEXT,
  emergency_contact TEXT,
  department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  supervisor_id UUID REFERENCES public.supervisors(id) ON DELETE SET NULL,
  start_date DATE,
  end_date DATE,
  required_hours NUMERIC NOT NULL DEFAULT 300 CHECK (required_hours >= 0),
  status intern_status NOT NULL DEFAULT 'active',
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- Soft delete fields
  is_active BOOLEAN DEFAULT TRUE,
  archived_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  archived_reason TEXT,
  archived_at TIMESTAMPTZ,
  restored_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  restored_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------
-- ATTENDANCE
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intern_id UUID NOT NULL REFERENCES public.interns(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  time_in TIMESTAMPTZ,
  time_out TIMESTAMPTZ,
  total_hours NUMERIC NOT NULL DEFAULT 0 CHECK (total_hours >= 0),
  method TEXT DEFAULT 'manual',
  status attendance_status NOT NULL DEFAULT 'present',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------
-- DAILY JOURNALS
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_journals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intern_id UUID NOT NULL REFERENCES public.interns(id) ON DELETE CASCADE,
  supervisor_id UUID REFERENCES public.supervisors(id) ON DELETE SET NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  activities TEXT NOT NULL,
  hours_worked NUMERIC NOT NULL DEFAULT 0 CHECK (hours_worked >= 0),
  challenges TEXT,
  learnings TEXT,
  status journal_status NOT NULL DEFAULT 'pending',
  supervisor_comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------
-- DOCUMENTS
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intern_id UUID NOT NULL REFERENCES public.interns(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('resume', 'moa', 'endorsement', 'school_requirements', 'completion_report')),
  label TEXT,
  file_path TEXT,
  file_url TEXT,
  file_name TEXT,
  file_size INTEGER,
  mime_type TEXT,
  status document_status NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------
-- EVALUATIONS
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intern_id UUID NOT NULL REFERENCES public.interns(id) ON DELETE CASCADE,
  supervisor_id UUID REFERENCES public.supervisors(id) ON DELETE SET NULL,
  attendance INTEGER NOT NULL DEFAULT 0 CHECK (attendance BETWEEN 0 AND 5),
  communication INTEGER NOT NULL DEFAULT 0 CHECK (communication BETWEEN 0 AND 5),
  teamwork INTEGER NOT NULL DEFAULT 0 CHECK (teamwork BETWEEN 0 AND 5),
  initiative INTEGER NOT NULL DEFAULT 0 CHECK (initiative BETWEEN 0 AND 5),
  technical_skills INTEGER NOT NULL DEFAULT 0 CHECK (technical_skills BETWEEN 0 AND 5),
  professionalism INTEGER NOT NULL DEFAULT 0 CHECK (professionalism BETWEEN 0 AND 5),
  overall_rating INTEGER NOT NULL DEFAULT 0 CHECK (overall_rating BETWEEN 0 AND 5),
  comments TEXT,
  final_recommendation TEXT CHECK (
    final_recommendation IS NULL OR
    final_recommendation IN ('highly_recommend', 'recommend', 'neutral', 'do_not_recommend')
  ),
  status evaluation_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------
-- ANNOUNCEMENTS
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'company_news' CHECK (
    category IN ('company_news', 'schedule', 'deadline', 'reminder')
  ),
  published_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------
-- SETTINGS (Singleton - id = 1)
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name TEXT,
  internship_duration TEXT,
  required_hours NUMERIC NOT NULL DEFAULT 300 CHECK (required_hours >= 0),
  is_configured BOOLEAN DEFAULT false,
  timezone TEXT DEFAULT 'UTC',
  date_format TEXT DEFAULT 'YYYY-MM-DD',
  week_start_day INTEGER DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------
-- NOTIFICATIONS
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type notification_type NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------
-- AUDIT LOGS
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  changes JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ================================================================
-- 5. INDEXES (Performance)
-- ================================================================

-- Profiles
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_intern_id ON public.profiles(intern_id);
CREATE INDEX IF NOT EXISTS idx_profiles_supervisor_id ON public.profiles(supervisor_id);

-- Departments
CREATE INDEX IF NOT EXISTS idx_departments_name ON public.departments(name);

-- Supervisors
CREATE INDEX IF NOT EXISTS idx_supervisors_department ON public.supervisors(department_id);
CREATE INDEX IF NOT EXISTS idx_supervisors_created_by ON public.supervisors(created_by);
CREATE INDEX IF NOT EXISTS idx_supervisors_profile ON public.supervisors(profile_id);

-- Interns (most queried)
CREATE INDEX IF NOT EXISTS idx_interns_department ON public.interns(department_id);
CREATE INDEX IF NOT EXISTS idx_interns_supervisor ON public.interns(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_interns_status ON public.interns(status);
CREATE INDEX IF NOT EXISTS idx_interns_is_active ON public.interns(is_active);
CREATE INDEX IF NOT EXISTS idx_interns_created_by ON public.interns(created_by);
CREATE INDEX IF NOT EXISTS idx_interns_department_status ON public.interns(department_id, status);
CREATE INDEX IF NOT EXISTS idx_interns_supervisor_status ON public.interns(supervisor_id, status);
CREATE INDEX IF NOT EXISTS idx_interns_profile ON public.interns(profile_id);

-- Attendance
CREATE INDEX IF NOT EXISTS idx_attendance_intern ON public.attendance(intern_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON public.attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_intern_date ON public.attendance(intern_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON public.attendance(status);
CREATE INDEX IF NOT EXISTS idx_attendance_date_time ON public.attendance(date, time_in);

-- Unique open attendance per intern per day
CREATE UNIQUE INDEX IF NOT EXISTS attendance_open_unique
  ON public.attendance (intern_id, date)
  WHERE (time_out IS NULL);

-- Journals
CREATE INDEX IF NOT EXISTS idx_journals_intern ON public.daily_journals(intern_id);
CREATE INDEX IF NOT EXISTS idx_journals_status ON public.daily_journals(status);
CREATE INDEX IF NOT EXISTS idx_journals_supervisor ON public.daily_journals(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_journals_intern_status ON public.daily_journals(intern_id, status);
CREATE INDEX IF NOT EXISTS idx_journals_date ON public.daily_journals(date);
CREATE INDEX IF NOT EXISTS idx_journals_supervisor_status ON public.daily_journals(supervisor_id, status);

-- Documents
CREATE INDEX IF NOT EXISTS idx_documents_intern ON public.documents(intern_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON public.documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_intern_status ON public.documents(intern_id, status);

-- Evaluations
CREATE INDEX IF NOT EXISTS idx_evaluations_intern ON public.evaluations(intern_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_supervisor ON public.evaluations(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_status ON public.evaluations(status);
CREATE INDEX IF NOT EXISTS idx_evaluations_intern_status ON public.evaluations(intern_id, status);
CREATE INDEX IF NOT EXISTS idx_evaluations_supervisor_status ON public.evaluations(supervisor_id, status);

-- Announcements
CREATE INDEX IF NOT EXISTS idx_announcements_pinned ON public.announcements(pinned);
CREATE INDEX IF NOT EXISTS idx_announcements_created ON public.announcements(created_at DESC);

-- Notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON public.notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON public.notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON public.notifications(user_id, is_read);

-- Audit logs
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON public.audit_logs(resource_type, resource_id);

-- ================================================================
-- 6. HELPER FUNCTIONS
-- ================================================================

-- Get current user's role
CREATE OR REPLACE FUNCTION public.current_role()
  RETURNS user_role
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT role
  FROM public.profiles
  WHERE id = auth.uid()
$$;

-- Check if user is admin or HR staff
CREATE OR REPLACE FUNCTION public.is_admin()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'hr_staff')
  )
$$;

-- Get current supervisor's ID from their profile
CREATE OR REPLACE FUNCTION public.current_supervisor_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT s.id
  FROM public.supervisors s
  JOIN public.profiles p ON p.id = s.profile_id
  WHERE p.id = auth.uid()
$$;

-- Get current intern's ID from their profile
CREATE OR REPLACE FUNCTION public.current_intern_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT i.id
  FROM public.interns i
  JOIN public.profiles p ON p.id = i.profile_id
  WHERE p.id = auth.uid()
$$;

-- ================================================================
-- 7. TRIGGER FUNCTIONS
-- ================================================================

-- Auto-create profile when new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', ''),
    new.email,
    COALESCE((new.raw_user_meta_data->>'role')::user_role, 'intern')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

-- Sync profile links (cache intern_id and supervisor_id)
CREATE OR REPLACE FUNCTION public.sync_profile_links()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'interns' THEN
    IF TG_OP = 'DELETE' THEN
      UPDATE public.profiles SET intern_id = NULL WHERE intern_id = OLD.id;
      RETURN OLD;
    ELSE
      IF NEW.profile_id IS NOT NULL THEN
        UPDATE public.profiles SET intern_id = NEW.id WHERE id = NEW.profile_id;
      END IF;
      RETURN NEW;
    END IF;
  ELSIF TG_TABLE_NAME = 'supervisors' THEN
    IF TG_OP = 'DELETE' THEN
      UPDATE public.profiles SET supervisor_id = NULL WHERE supervisor_id = OLD.id;
      RETURN OLD;
    ELSE
      IF NEW.profile_id IS NOT NULL THEN
        UPDATE public.profiles SET supervisor_id = NEW.id WHERE id = NEW.profile_id;
      END IF;
      RETURN NEW;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

-- Update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ================================================================
-- 8. TRIGGERS
-- ================================================================

-- Auth user trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Sync profile links
DROP TRIGGER IF EXISTS sync_profile_intern ON public.interns;
CREATE TRIGGER sync_profile_intern
  AFTER INSERT OR UPDATE OR DELETE ON public.interns
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_links();

DROP TRIGGER IF EXISTS sync_profile_supervisor ON public.supervisors;
CREATE TRIGGER sync_profile_supervisor
  AFTER INSERT OR UPDATE OR DELETE ON public.supervisors
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_links();

-- Update timestamps
DROP TRIGGER IF EXISTS set_profiles_updated ON public.profiles;
CREATE TRIGGER set_profiles_updated
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

DROP TRIGGER IF EXISTS set_interns_updated ON public.interns;
CREATE TRIGGER set_interns_updated
  BEFORE UPDATE ON public.interns
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

DROP TRIGGER IF EXISTS set_settings_updated ON public.settings;
CREATE TRIGGER set_settings_updated
  BEFORE UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ================================================================
-- 9. FOREIGN KEY CONSTRAINTS (Add after tables exist)
-- ================================================================

-- Profile foreign keys
ALTER TABLE public.profiles
  ADD CONSTRAINT fk_profiles_intern_id
  FOREIGN KEY (intern_id) REFERENCES public.interns(id) ON DELETE SET NULL;

ALTER TABLE public.profiles
  ADD CONSTRAINT fk_profiles_supervisor_id
  FOREIGN KEY (supervisor_id) REFERENCES public.supervisors(id) ON DELETE SET NULL;

-- ================================================================
-- 10. ENABLE RLS
-- ================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ================================================================
-- 11. RLS POLICIES
-- ================================================================

-- ================================================================
-- PROFILES
-- ================================================================

DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;
CREATE POLICY "profiles_select_authenticated"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "profiles_admin_all" ON public.profiles;
CREATE POLICY "profiles_admin_all"
  ON public.profiles FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ================================================================
-- DEPARTMENTS
-- ================================================================

DROP POLICY IF EXISTS "departments_select_all" ON public.departments;
CREATE POLICY "departments_select_all"
  ON public.departments FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "departments_admin_all" ON public.departments;
CREATE POLICY "departments_admin_all"
  ON public.departments FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ================================================================
-- SUPERVISORS
-- ================================================================

DROP POLICY IF EXISTS "supervisors_select_all" ON public.supervisors;
CREATE POLICY "supervisors_select_all"
  ON public.supervisors FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "supervisors_admin_all" ON public.supervisors;
CREATE POLICY "supervisors_admin_all"
  ON public.supervisors FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ================================================================
-- INTERNS (Core isolation)
-- ================================================================

-- Read: Admin sees all, Supervisor sees assigned/created, Intern sees own
DROP POLICY IF EXISTS "interns_select" ON public.interns;
CREATE POLICY "interns_select"
  ON public.interns FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR id = public.current_intern_id()
    OR supervisor_id = public.current_supervisor_id()
    OR created_by = auth.uid()
  );

-- Admin: Full CRUD
DROP POLICY IF EXISTS "interns_admin_all" ON public.interns;
CREATE POLICY "interns_admin_all"
  ON public.interns FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Supervisor: Manage assigned/created interns
DROP POLICY IF EXISTS "interns_supervisor_manage" ON public.interns;
CREATE POLICY "interns_supervisor_manage"
  ON public.interns FOR ALL
  TO authenticated
  USING (
    supervisor_id = public.current_supervisor_id()
    OR created_by = auth.uid()
  )
  WITH CHECK (
    supervisor_id = public.current_supervisor_id()
    OR created_by = auth.uid()
  );

-- Intern: Read own only (already covered in SELECT policy)

-- ================================================================
-- ATTENDANCE
-- ================================================================

DROP POLICY IF EXISTS "attendance_select" ON public.attendance;
CREATE POLICY "attendance_select"
  ON public.attendance FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR intern_id = public.current_intern_id()
    OR intern_id IN (
      SELECT id FROM public.interns
      WHERE supervisor_id = public.current_supervisor_id()
    )
  );

DROP POLICY IF EXISTS "attendance_admin_all" ON public.attendance;
CREATE POLICY "attendance_admin_all"
  ON public.attendance FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "attendance_intern_manage" ON public.attendance;
CREATE POLICY "attendance_intern_manage"
  ON public.attendance FOR ALL
  TO authenticated
  USING (intern_id = public.current_intern_id())
  WITH CHECK (intern_id = public.current_intern_id());

-- ================================================================
-- DAILY JOURNALS
-- ================================================================

DROP POLICY IF EXISTS "journals_select" ON public.daily_journals;
CREATE POLICY "journals_select"
  ON public.daily_journals FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR intern_id = public.current_intern_id()
    OR intern_id IN (
      SELECT id FROM public.interns
      WHERE supervisor_id = public.current_supervisor_id()
    )
  );

DROP POLICY IF EXISTS "journals_admin_all" ON public.daily_journals;
CREATE POLICY "journals_admin_all"
  ON public.daily_journals FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "journals_intern_manage" ON public.daily_journals;
CREATE POLICY "journals_intern_manage"
  ON public.daily_journals FOR ALL
  TO authenticated
  USING (intern_id = public.current_intern_id())
  WITH CHECK (intern_id = public.current_intern_id());

DROP POLICY IF EXISTS "journals_supervisor_review" ON public.daily_journals;
CREATE POLICY "journals_supervisor_review"
  ON public.daily_journals FOR UPDATE
  TO authenticated
  USING (
    intern_id IN (
      SELECT id FROM public.interns
      WHERE supervisor_id = public.current_supervisor_id()
    )
  );

-- ================================================================
-- DOCUMENTS
-- ================================================================

DROP POLICY IF EXISTS "documents_select" ON public.documents;
CREATE POLICY "documents_select"
  ON public.documents FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR intern_id = public.current_intern_id()
    OR intern_id IN (
      SELECT id FROM public.interns
      WHERE supervisor_id = public.current_supervisor_id()
    )
  );

DROP POLICY IF EXISTS "documents_admin_all" ON public.documents;
CREATE POLICY "documents_admin_all"
  ON public.documents FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "documents_intern_manage" ON public.documents;
CREATE POLICY "documents_intern_manage"
  ON public.documents FOR ALL
  TO authenticated
  USING (intern_id = public.current_intern_id())
  WITH CHECK (intern_id = public.current_intern_id());

-- ================================================================
-- EVALUATIONS
-- ================================================================

DROP POLICY IF EXISTS "evaluations_select" ON public.evaluations;
CREATE POLICY "evaluations_select"
  ON public.evaluations FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR intern_id = public.current_intern_id()
    OR supervisor_id = public.current_supervisor_id()
  );

DROP POLICY IF EXISTS "evaluations_admin_all" ON public.evaluations;
CREATE POLICY "evaluations_admin_all"
  ON public.evaluations FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "evaluations_supervisor_manage" ON public.evaluations;
CREATE POLICY "evaluations_supervisor_manage"
  ON public.evaluations FOR ALL
  TO authenticated
  USING (supervisor_id = public.current_supervisor_id())
  WITH CHECK (supervisor_id = public.current_supervisor_id());

DROP POLICY IF EXISTS "evaluations_intern_read" ON public.evaluations;
CREATE POLICY "evaluations_intern_read"
  ON public.evaluations FOR SELECT
  TO authenticated
  USING (intern_id = public.current_intern_id());

-- ================================================================
-- ANNOUNCEMENTS
-- ================================================================

DROP POLICY IF EXISTS "announcements_select_all" ON public.announcements;
CREATE POLICY "announcements_select_all"
  ON public.announcements FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "announcements_admin_all" ON public.announcements;
CREATE POLICY "announcements_admin_all"
  ON public.announcements FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ================================================================
-- SETTINGS
-- ================================================================

DROP POLICY IF EXISTS "settings_select_all" ON public.settings;
CREATE POLICY "settings_select_all"
  ON public.settings FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "settings_admin_all" ON public.settings;
CREATE POLICY "settings_admin_all"
  ON public.settings FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ================================================================
-- NOTIFICATIONS
-- ================================================================

DROP POLICY IF EXISTS "notifications_user_read" ON public.notifications;
CREATE POLICY "notifications_user_read"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_user_manage" ON public.notifications;
CREATE POLICY "notifications_user_manage"
  ON public.notifications FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_system_insert" ON public.notifications;
CREATE POLICY "notifications_system_insert"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "notifications_admin_all" ON public.notifications;
CREATE POLICY "notifications_admin_all"
  ON public.notifications FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ================================================================
-- AUDIT LOGS
-- ================================================================

DROP POLICY IF EXISTS "audit_logs_admin_read" ON public.audit_logs;
CREATE POLICY "audit_logs_admin_read"
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "audit_logs_system_insert" ON public.audit_logs;
CREATE POLICY "audit_logs_system_insert"
  ON public.audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ================================================================
-- 12. STORAGE BUCKET
-- ================================================================

-- Create bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('intern-documents', 'intern-documents', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
DROP POLICY IF EXISTS "storage_select_all" ON storage.objects;
CREATE POLICY "storage_select_all"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'intern-documents');

DROP POLICY IF EXISTS "storage_intern_upload" ON storage.objects;
CREATE POLICY "storage_intern_upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'intern-documents'
    AND (storage.foldername(name))[1] = public.current_intern_id()::text
  );

DROP POLICY IF EXISTS "storage_admin_all" ON storage.objects;
CREATE POLICY "storage_admin_all"
  ON storage.objects FOR ALL
  TO authenticated
  USING (bucket_id = 'intern-documents' AND public.is_admin())
  WITH CHECK (bucket_id = 'intern-documents' AND public.is_admin());

-- ================================================================
-- 13. INITIAL DATA
-- ================================================================

-- Insert default settings
INSERT INTO public.settings (id, company_name, internship_duration, required_hours, is_configured)
VALUES (1, 'My Company', '6 months', 300, true)
ON CONFLICT (id) DO NOTHING;

-- Insert default departments
INSERT INTO public.departments (name, description) VALUES
  ('Information Technology', 'Software development and IT infrastructure'),
  ('Marketing', 'Brand, campaigns and communications'),
  ('Finance', 'Accounting, payroll and reporting'),
  ('Human Resources', 'Recruitment, onboarding and culture'),
  ('Operations', 'Logistics and business operations')
ON CONFLICT (name) DO NOTHING;

-- ================================================================
-- 14. SEED DATA (For Testing - Remove in Production!)
-- ================================================================

-- Create test accounts (users must be created in auth.users first)
-- These are examples - you should create actual users via auth.admin.createUser()

-- ================================================================
-- 15. VERIFICATION QUERIES
-- ================================================================

-- Check all tables
SELECT
  schemaname,
  tablename,
  tableowner
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- Check RLS policies
SELECT
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename;

-- Check indexes
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- ================================================================
-- 16. USEFUL QUERIES FOR TESTING
-- ================================================================

-- Get current user's profile
SELECT * FROM public.profiles WHERE id = auth.uid();

-- Get current user's role
SELECT public.current_role();

-- Check if current user is admin
SELECT public.is_admin();

-- Get current supervisor ID
SELECT public.current_supervisor_id();

-- Get current intern ID
SELECT public.current_intern_id();

-- Count active interns
SELECT COUNT(*) FROM public.interns WHERE status = 'active';

-- Get interns with supervisor names
SELECT
  i.id,
  i.full_name,
  i.student_number,
  d.name as department,
  s.full_name as supervisor
FROM public.interns i
LEFT JOIN public.departments d ON i.department_id = d.id
LEFT JOIN public.supervisors s ON i.supervisor_id = s.id
WHERE i.status = 'active'
ORDER BY i.full_name;

-- Get attendance for today
SELECT
  i.full_name,
  a.time_in,
  a.time_out,
  a.total_hours,
  a.status
FROM public.attendance a
JOIN public.interns i ON a.intern_id = i.id
WHERE a.date = CURRENT_DATE
ORDER BY a.time_in DESC;

-- Get pending journals for supervisor
SELECT
  j.id,
  i.full_name as intern_name,
  j.date,
  j.activities,
  j.status
FROM public.daily_journals j
JOIN public.interns i ON j.intern_id = i.id
WHERE j.supervisor_id = public.current_supervisor_id()
  AND j.status = 'pending'
ORDER BY j.date ASC;

-- ================================================================
-- DONE! Your Internship Management System is ready.
-- ================================================================










-- ============================================================================
-- 0008 — Repoint profile_id FKs to public.profiles (fixes PostgREST embed error)
-- ============================================================================
-- Your live database was built from the pasted schema where
-- supervisors.profile_id / interns.profile_id reference auth.users(id).
-- The services layer embeds `profile:profile_id (full_name, email)`, which
-- requires the FK to point at public.profiles(id) so PostgREST can resolve the
-- relationship. profiles.id already references auth.users(id), so the chain
-- (auth.users -> profiles -> supervisors/interns) still holds.
--
-- Run this in the Supabase SQL Editor. Safe to re-run (uses DROP ... IF EXISTS).
-- ============================================================================

-- supervisors -----------------------------------------------------------------
alter table public.supervisors
  drop constraint if exists supervisors_profile_id_fkey;

alter table public.supervisors
  add constraint supervisors_profile_id_fkey
  foreign key (profile_id) references public.profiles(id) on delete set null;

-- interns ---------------------------------------------------------------------
alter table public.interns
  drop constraint if exists interns_profile_id_fkey;

alter table public.interns
  add constraint interns_profile_id_fkey
  foreign key (profile_id) references public.profiles(id) on delete set null;

-- Reload PostgREST schema cache immediately so the relationship is visible
-- without waiting for the next auto-refresh.
notify pgrst, 'reload schema';
