-- ============================================================================
-- 0019 — Create intern rows for orphan intern profiles + harden current_intern_id
-- ============================================================================
-- CONTEXT: after 0018 the intern<->profile link is repaired for interns that
-- already HAD an interns row. But 5 profiles still have role='intern' with NO
-- interns row at all (intern_id = NULL, no matching email). Logging in as those
-- accounts yields useAuth().internId = NULL, so every attendance / journal /
-- document INSERT fails the WITH CHECK (intern_id = current_intern_id()) with
-- "new row violates row-level security policy".
--
-- FIX:
--   1. Create a minimal interns row for every intern-profile that lacks one,
--      then link BOTH sides (interns.profile_id and profiles.intern_id).
--   2. Harden public.current_intern_id() so it resolves from EITHER side of the
--      link (interns.profile_id OR the cached profiles.intern_id). This makes
--      the RLS robust even if one side of the link is ever missing again.
-- Both steps are idempotent / safe to re-run.
-- ============================================================================

-- 1. Create interns rows for orphan intern profiles (those with role='intern'
--    and no interns row pointing at them). student_number is NOT NULL, so we
--    derive a stable placeholder from the profile id when none exists.
insert into public.interns (id, profile_id, full_name, student_number, email, status, required_hours)
select
  gen_random_uuid(),
  p.id,
  p.full_name,
  'INT-' || replace(p.id::text, '-', ''),
  p.email,
  'active',
  300
from public.profiles p
where p.role = 'intern'
  and not exists (select 1 from public.interns i where i.profile_id = p.id);

-- 2. Backfill profiles.intern_id from the (now created) interns rows.
update public.profiles p
set intern_id = i.id
from public.interns i
where p.intern_id is null
  and p.role = 'intern'
  and i.profile_id = p.id;

-- 3. Harden current_intern_id(): resolve from interns.profile_id OR the cached
--    profiles.intern_id, so the RLS works regardless of which side is populated.
create or replace function public.current_intern_id()
  returns uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select coalesce(
    (select i.id
       from public.interns i
       join public.profiles p on p.id = i.profile_id
      where p.id = auth.uid()),
    (select p.intern_id
       from public.profiles p
      where p.id = auth.uid()
        and p.intern_id is not null)
  )
$$;

-- 4. Reload PostgREST schema cache.
notify pgrst, 'reload schema';
