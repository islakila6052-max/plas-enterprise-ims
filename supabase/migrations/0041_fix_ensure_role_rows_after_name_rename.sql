-- ============================================================================
-- 0041 - Fix ensure_role_rows after intern name column rename
-- ============================================================================
-- Migration 0040 renamed interns.full_name -> first_name/last_name (dropping
-- the legacy student_number column and re-adding full_name as a GENERATED
-- column). The ensure_role_rows() trigger function still inserted
-- interns(student_number, full_name), which broke EVERY new user creation:
--
--   42703  column "student_number" of relation "interns" does not exist
--   25P02  current transaction is aborted
--   500    POST /auth/v1/admin/users
--
-- This migration rewrites the function to insert first_name / last_name
-- (derived from the profile's full_name) and to stop writing the generated
-- full_name column directly.
--
-- SAFE TO RE-RUN: CREATE OR REPLACE is idempotent.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ensure_role_rows()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_dept uuid;
  should_create boolean := false;
  v_full_name text;
BEGIN
  -- Only create on INSERT, or when role changes TO intern/supervisor
  IF TG_OP = 'INSERT' THEN
    should_create := true;
  ELSIF TG_OP = 'UPDATE' THEN
    should_create := (OLD.role IS DISTINCT FROM NEW.role);
  END IF;

  IF NOT should_create THEN
    RETURN NEW;
  END IF;

  v_full_name := btrim(coalesce(NEW.full_name, ''));

  IF NEW.role = 'intern' THEN
    IF NOT EXISTS (SELECT 1 FROM public.interns i WHERE i.profile_id = NEW.id) THEN
      SELECT d.id INTO v_dept FROM public.departments d ORDER BY d.id LIMIT 1;
      -- interns.full_name is a GENERATED column (first_name || ' ' ||
      -- last_name) and interns.student_number no longer exists, so insert
      -- first_name / last_name split from the profile's full name.
      INSERT INTO public.interns (
        id, profile_id, first_name, last_name, email, status, required_hours, department_id
      ) VALUES (
        gen_random_uuid(),
        NEW.id,
        coalesce(nullif(split_part(v_full_name, ' ', 1), ''), ''),
        nullif(btrim(regexp_replace(v_full_name, '^\S+\s*', '')), ''),
        NEW.email,
        'active',
        300,
        v_dept
      );
    END IF;
  END IF;

  IF NEW.role = 'supervisor' THEN
    IF NOT EXISTS (SELECT 1 FROM public.supervisors s WHERE s.profile_id = NEW.id) THEN
      SELECT d.id INTO v_dept FROM public.departments d ORDER BY d.id LIMIT 1;
      INSERT INTO public.supervisors (id, profile_id, full_name, email, department_id)
      VALUES (
        gen_random_uuid(),
        NEW.id,
        NEW.full_name,
        NEW.email,
        v_dept
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
