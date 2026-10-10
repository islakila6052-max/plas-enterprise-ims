-- ============================================================================
-- 0023 — Seed the initial admin account
-- ============================================================================
-- Creates the first admin so the app can be used after a full wipe. The app's
-- user-creation flow is admin-gated, so without this there is no way to log in.
-- Idempotent: if the admin already exists (by email), it does nothing.
--
-- !! CHANGE THE DEFAULT PASSWORD before running in production: replace
-- !! __CHANGE_ME__ below, then change it again from the UI after first login.
-- !! The md doc ATTENDANCE_SCHEMA_SUMMARY.md references these credentials;
-- !! update that doc if you change them.
--
-- The handle_new_user trigger auto-creates a profiles row when the auth user
-- is inserted, so we just UPDATE that profile to role='admin' (and set name)
-- instead of inserting a second profile.
-- ============================================================================

do $$
declare
  v_user_id uuid;
  c_seed_password text := '__CHANGE_ME__';
begin
  if c_seed_password = '__CHANGE_ME__' then
    raise exception '0023_seed_admin: replace __CHANGE_ME__ with a real password before running';
  end if;

  -- Create the auth user if it does not already exist.
  if not exists (select 1 from auth.users where email = 'plas-admin@company.com') then
    insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data)
    values (
      'plas-admin@company.com',
      crypt(c_seed_password, gen_salt('bf')),
      now(),
      '{"full_name": "Plas Admin"}'::jsonb
    )
    returning id into v_user_id;

    -- Promote the auto-created profile to admin.
    update public.profiles
    set role = 'admin', full_name = 'Plas Admin', email = 'plas-admin@company.com'
    where id = v_user_id;
  end if;
end $$;

-- Reload PostgREST schema cache.
notify pgrst, 'reload schema';
