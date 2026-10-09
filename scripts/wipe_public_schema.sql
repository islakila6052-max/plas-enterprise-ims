-- ===========================================================================
-- DESTRUCTIVE - INTENTIONALLY NOT SAFE TO RUN UNSUPERVISED
-- ===========================================================================
-- Wipe everything in the public schema (tables, views, functions, data)
-- so migrations can be applied cleanly from 0001.
--
-- SECURITY (L8): the line below is `drop schema public cascade`, which
-- destroys every intern record, document reference and audit trail. This script
-- also re-grants broad default privileges at the bottom, so it must never be
-- pointed at production.
--
-- Before running ANYWHERE:
--   1. Confirm you are pointed at a throwaway/local project, NOT production.
--      Check the project ref in the Supabase dashboard URL.
--   2. Take a backup, or confirm PITR is enabled and note the restore point.
--   3. Prefer `supabase db reset` for a local dev database - this script is for
--      one-off manual teardown only.
--
-- The tripwire below must run BEFORE the drop, so an accidental paste cannot
-- destroy anything.
-- ===========================================================================

do $$
begin
  if current_setting('ims.allow_destructive_wipe', true) is distinct from 'YES-I-AM-SURE' then
    raise exception
      'Refusing to run. This drops the entire public schema. Set the session '
      'variable first: SET ims.allow_destructive_wipe = ''YES-I-AM-SURE'';';
  end if;
end $$;

drop schema public cascade;
create schema public;

-- Restore default grants Supabase expects
grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to postgres, service_role;

alter default privileges in schema public
  grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to postgres, anon, authenticated, service_role;
