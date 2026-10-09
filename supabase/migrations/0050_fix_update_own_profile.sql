-- ============================================================================
-- 0050 - FIX: update_own_profile(...) missing from the PostgREST schema cache
-- ============================================================================
-- Symptom fixed (Profile page -> Save):
--   Could not find the function public.update_own_profile(
--     p_avatar_url, p_bio, p_contact_number, p_full_name) in the schema cache
--
-- Same root cause as 0049: the write RPCs created by 0045 / 0046 / 0047 were
-- never applied to the live database. This file is the focused, additive repair
-- for the Profile page. It:
--   * removes any stale/mismatched update_own_profile overloads,
--   * (re)creates public.update_own_profile(text, text, text, text),
--   * restores the EXECUTE grants for `authenticated`,
--   * reloads the PostgREST schema cache.
--
-- NOTE: many other RPCs from that same batch are still missing on the live DB
-- (journal_review, document_review, evaluation_create, announcement_create /
-- update / delete, notify_user, write_audit_log, profile_ids_by_role,
-- supervisor_profile_id, intern_profile_id, ...). They will keep producing the
-- same 404 one route at a time. Running
-- supabase/migrations/0048_repair_high_security.sql applies the whole batch at
-- once and is the recommended complete fix.
--
-- SAFE TO RE-RUN: create-or-replace / drop-if-exists only. No row is inserted,
-- updated or deleted by this file.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Drop any stale / mismatched overloads of update_own_profile
-- ---------------------------------------------------------------------------
do $$
declare
  v_sig text;
begin
  for v_sig in
    select format('%I.%I(%s)', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid))
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'update_own_profile'
       and replace(pg_get_function_identity_arguments(p.oid), ' ', '')
           <> 'text,text,text,text'
  loop
    execute 'drop function if exists ' || v_sig;
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- 2. The self-service profile update RPC
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER + an explicit allowlist: `role`, `email`, `intern_id` and
-- `supervisor_id` are not reachable from the client at all. The target row is
-- resolved from the caller's JWT via auth.uid(), never from the request body.
create or replace function public.update_own_profile (
  p_full_name text default null,
  p_contact_number text default null,
  p_bio text default null,
  p_avatar_url text default null
)
  returns public.profiles
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_row public.profiles;
begin
  update public.profiles
     set full_name      = coalesce(p_full_name, full_name),
         contact_number = coalesce(p_contact_number, contact_number),
         bio            = coalesce(p_bio, bio),
         avatar_url     = coalesce(p_avatar_url, avatar_url)
   where id = auth.uid ()
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Profile not found for the current user'
      using errcode = 'no_data_found';
  end if;

  return v_row;
end;
$$;


-- ---------------------------------------------------------------------------
-- 3. Grants
-- ---------------------------------------------------------------------------
revoke all on function public.update_own_profile (text, text, text, text) from public, anon;
grant execute on function public.update_own_profile (text, text, text, text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 4. Reload the PostgREST schema cache  (REQUIRED - keep this last)
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- 5. Verification - expect one row: update_own_profile | text, text, text, text
-- ---------------------------------------------------------------------------
-- select p.proname, pg_get_function_identity_arguments(p.oid) as signature
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname = 'update_own_profile';