-- ============================================================================
-- 0018 — Link missing interns rows to their profiles (fixes attendance RLS)
-- ============================================================================
-- DIAGNOSIS: an intern timing in from the Intern Attendance page hits the
-- attendance policy "intern manages own attendance" whose WITH CHECK requires
--   intern_id = public.current_intern_id()
-- current_intern_id() resolves the intern via
--   interns.profile_id = profiles.id  WHERE profiles.id = auth.uid()
-- If that link is broken/missing for an intern, current_intern_id() returns
-- NULL and EVERY attendance INSERT is rejected with
--   "new row violates row-level security policy for table \"attendance\"".
--
-- This is the same root cause that broke supervisors (see 0014/0015): the
-- intern<->profile link that RLS depends on does not exist or is out of sync.
--
-- OBSERVED STATE on the live DB: interns.profile_id is NULL for ALL interns and
-- profiles.intern_id is NULL for ALL intern profiles — the link was never
-- established. The two sides are matched by email (case-insensitive), which is
-- unique enough to pair every intern record to its auth/profile row.
--
-- FIX (idempotent — only fills NULL/missing links, never overwrites a good one):
--   1. Set interns.profile_id from the matching profile (by lower(email)).
--   2. Set profiles.intern_id from the matching intern (by lower(email)).
--   3. Reload the PostgREST schema cache.
-- Re-running is safe.
-- ============================================================================

-- 1. Backfill interns.profile_id from the profile matched by email.
update public.interns i
set profile_id = p.id
from public.profiles p
where i.profile_id is null
  and lower(p.email) = lower(i.email)
  and p.role = 'intern';

-- 2. Backfill profiles.intern_id from the intern matched by email.
update public.profiles p
set intern_id = i.id
from public.interns i
where p.intern_id is null
  and p.role = 'intern'
  and lower(p.email) = lower(i.email);

-- 3. Reload PostgREST schema cache so the new links take effect immediately.
notify pgrst, 'reload schema';
