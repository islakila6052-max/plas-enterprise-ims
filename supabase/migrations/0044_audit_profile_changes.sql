-- ============================================================================
-- 0044 - Audit trail for profile changes (name, contact number, bio, role)
-- ============================================================================
-- Adds an AFTER UPDATE trigger on public.profiles that writes every tracked
-- change to public.audit_logs as { from, to } pairs, so the admin Audit Logs
-- view can render the previous value in red and the updated value in green.
--
-- Why a trigger (and not a client-side insert):
--   * The true previous value comes from OLD - never stale or guessed.
--   * SECURITY DEFINER bypasses RLS, so the audit row is ALWAYS written,
--     even if the acting user's role cannot insert into audit_logs.
--   * Covers every path: the user's own Profile page, an admin edit, or a
--     service-role script - nothing can change a profile without an audit.
--
-- Notes
--   * Fires only when a tracked column actually changed; routine updates
--     (updated_at, intern_id / supervisor_id link syncs) produce no rows.
--   * user_id = auth.uid() - the person who made the change. Service-role
--     writes have no JWT, so those rows show as "system" in the admin view.
--   * SAFE TO RE-RUN: drop trigger if exists + create or replace function.
-- ============================================================================

-- 1. Trigger function ---------------------------------------------------------
create or replace function public.audit_profile_changes()
returns trigger
language plpgsql
security definer
set search_path to public
as $$
declare
  v_user uuid := auth.uid ();
  v_changes jsonb := '{}'::jsonb;
begin
  if new.full_name is distinct from old.full_name then
    v_changes := jsonb_set (
      v_changes,
      '{full_name}',
      jsonb_build_object ('from', old.full_name, 'to', new.full_name)
    );
  end if;

  if new.contact_number is distinct from old.contact_number then
    v_changes := jsonb_set (
      v_changes,
      '{contact_number}',
      jsonb_build_object ('from', old.contact_number, 'to', new.contact_number)
    );
  end if;

  if new.bio is distinct from old.bio then
    v_changes := jsonb_set (
      v_changes,
      '{bio}',
      jsonb_build_object ('from', old.bio, 'to', new.bio)
    );
  end if;

  if new.role is distinct from old.role then
    v_changes := jsonb_set (
      v_changes,
      '{role}',
      jsonb_build_object ('from', old.role, 'to', new.role)
    );
  end if;

  -- Nothing tracked changed (e.g. an updated_at refresh or a link sync):
  -- write no audit row.
  if v_changes = '{}'::jsonb then
    return null;
  end if;

  insert into public.audit_logs (user_id, action, resource_type, resource_id, changes)
  values (v_user, 'update', 'profile', new.id, v_changes);

  return null;
end;
$$;

-- 2. Trigger ------------------------------------------------------------------
drop trigger if exists audit_profile_changes on public.profiles;
create trigger audit_profile_changes
  after update on public.profiles
  for each row
  execute function public.audit_profile_changes ();
