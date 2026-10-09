-- ============================================================================
-- 0013 — Make evaluation RLS resilient to supervisor/profile link gaps
-- ============================================================================
-- Root cause of "new row violates row-level security policy for table
-- evaluations": the supervisor evaluation policies compared supervisor_id
-- against public.current_supervisor_id(), which is derived ONLY from
-- supervisors.profile_id (the reverse link). If that link is NULL for a
-- given supervisor (e.g. the row was created before the sync trigger, or
-- the trigger did not populate it), current_supervisor_id() returns NULL and
-- NO supervisor_id can ever satisfy `supervisor_id = NULL`, so every
-- evaluation INSERT/UPDATE by that supervisor is rejected.
--
-- Fix: introduce current_supervisor_id() that resolves the supervisor id
-- from EITHER link (supervisors.profile_id OR the cached
-- profiles.supervisor_id). Recreate the evaluation policies to use it. This
-- keeps role isolation intact (a supervisor can only touch rows whose
-- supervisor_id equals THEIR OWN id) while no longer depending on a single
-- fragile link.
-- ============================================================================

-- 1. Drop the old function and recreate it to resolve from either link.
drop function if exists public.current_supervisor_id() cascade;

create or replace function public.current_supervisor_id()
  returns uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select coalesce(
    -- Primary: supervisors row linked to the current profile.
    (
      select s.id
      from public.supervisors s
      where s.profile_id = auth.uid()
      limit 1
    ),
    -- Fallback: the cached supervisor_id on the current profile.
    (
      select p.supervisor_id
      from public.profiles p
      where p.id = auth.uid()
    )
  );
$$;

-- 2. Recreate evaluation policies using the resilient resolver.
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
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "supervisor manages assigned evaluations" on public.evaluations;
create policy "supervisor manages assigned evaluations"
  on public.evaluations for all to authenticated
  using (supervisor_id = public.current_supervisor_id())
  with check (supervisor_id = public.current_supervisor_id());

drop policy if exists "intern reads own evaluation" on public.evaluations;
create policy "intern reads own evaluation"
  on public.evaluations for select to authenticated
  using (intern_id = public.current_intern_id());

-- 3. Reload PostgREST schema cache so the new function/policies take effect.
notify pgrst, 'reload schema';
