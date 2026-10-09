-- ============================================================================
-- clean_all_data.sql
-- ============================================================================
-- Wipes ALL application data so you can start testing from a clean slate.
-- It does NOT drop tables, enums, functions, triggers, RLS policies, or the
-- seeded admin account (plas-admin@company.com) — only the rows are removed.
--
-- HOW TO RUN:
--   1. Open the Supabase dashboard -> SQL Editor.
--   2. Paste this entire file and click "Run".
--   (Or run it via psql / the Supabase CLI against your project.)
--
-- ORDER MATTERS: child tables are cleared before parents to avoid FK violations.
-- We use TRUNCATE ... RESTART IDENTITY CASCADE which is the fastest, cleanest
-- way and resets any serial/identity counters.
-- ============================================================================

-- 1) Child tables that reference interns / profiles / supervisors.
truncate table if exists public.audit_logs        restart identity cascade;
truncate table if exists public.notifications     restart identity cascade;
truncate table if exists public.evaluations       restart identity cascade;
truncate table if exists public.documents         restart identity cascade;
truncate table if exists public.daily_journals    restart identity cascade;
truncate table if exists public.attendance        restart identity cascade;

-- 2) Intern + supervisor + announcement data.
truncate table if exists public.interns           restart identity cascade;
truncate table if exists public.supervisors       restart identity cascade;
truncate table if exists public.announcements     restart identity cascade;

-- 3) Programs / institutions (referenced by interns via set-null; safe to clear).
truncate table if exists public.programs          restart identity cascade;
truncate table if exists public.institutions      restart identity cascade;

-- 4) Departments.
truncate table if exists public.departments       restart identity cascade;

-- 5) Profiles (keeps the schema + RLS). The seeded admin profile is re-created
--    below so you can still log in after the wipe.
truncate table if exists public.profiles          restart identity cascade;

-- 6) Settings singleton row — keep the row but reset to defaults (id stays 1).
--    If you prefer a truly empty settings table, delete this block.
update public.settings
  set company_name = null,
      internship_duration = null,
      required_hours = 300,
      updated_at = now()
  where id = 1;

-- 7) Re-seed the admin account so the app remains usable after the wipe.
--    (auth.users row is NOT truncated above; we just ensure the profile exists.)
do $$
declare
  v_user_id uuid;
begin
  select id into v_user_id from auth.users where email = 'plas-admin@company.com';
  if v_user_id is not null then
    insert into public.profiles (id, full_name, email, role, created_at, updated_at)
    values (v_user_id, 'Plas Admin', 'plas-admin@company.com', 'admin', now(), now())
    on conflict (id) do update
      set role = 'admin', full_name = 'Plas Admin', email = 'plas-admin@company.com', updated_at = now();
  end if;
end $$;

-- Reload PostgREST schema cache.
notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFY (optional): run these to confirm the tables are empty.
--   select count(*) from public.profiles;
--   select count(*) from public.interns;
--   select count(*) from public.attendance;
--   select count(*) from public.daily_journals;
--   select count(*) from public.documents;
--   select count(*) from public.evaluations;
-- ============================================================================
