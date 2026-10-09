-- ============================================================================
-- 0045 - CRITICAL security fixes (privilege escalation, public storage, RLS)
-- ============================================================================
-- Fixes, in order of severity:
--
--   C1  Service-role key must never live in a tracked file.  (Repo-side change:
--       .env.example now ships placeholders only.  The key itself MUST be
--       rotated in the Supabase dashboard - see the note at the bottom.)
--
--   C2  profiles.role was self-writable.  The "users manage own profile"
--       policy had a USING clause but no WITH CHECK, so any authenticated user
--       could PATCH their own row and set role = 'admin'.  Now the role is
--       pinned by WITH CHECK, and a SECURITY DEFINER RPC performs the
--       legitimate self-service update with an explicit column allowlist.
--
--   C3  The 'intern-documents' bucket was public = true, so every resume / MOA
--       / endorsement was readable by anyone with the URL, forever, bypassing
--       RLS entirely.  Bucket is now private and served through short-lived
--       signed URLs.
--
--   C4  Six tables had `using (true)` read policies, which made every scoped
--       policy below them inert (Postgres ORs permissive policies together).
--       Any intern could read every intern's attendance, journals, documents
--       and evaluations.  Each is now role-scoped.
--
-- SAFE TO RE-RUN: every statement is drop-if-exists / create-or-replace.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. Helper: profile ids by role (SECURITY DEFINER)
-- ---------------------------------------------------------------------------
-- Why this exists: the notification fan-out (activityService.getProfileIdsByRole,
-- documentService admin notification) needs the *ids* of admins / supervisors
-- so it can address them.  Once `profiles` SELECT is scoped (step 4), an intern
-- can no longer list those rows from the client.  This function returns ONLY
-- the uuid column - never email, contact_number or bio - so no PII leaks.
create or replace function public.profile_ids_by_role (p_role text)
  returns setof uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select p.id from public.profiles p where p.role::text = p_role;
$$;

revoke all on function public.profile_ids_by_role (text) from public;
grant execute on function public.profile_ids_by_role (text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 0b. Helpers: resolve a supervisors/interns ROW id -> the auth profile id
-- ---------------------------------------------------------------------------
-- The app stores interns.supervisor_id -> supervisors.id and
-- profiles.supervisor_id -> supervisors.id.  The notification paths were
-- comparing a *supervisors.id* against *profiles.id*, which could never match.
-- These helpers do the join correctly AND return only the uuid, so they do not
-- require the caller to hold read access to the whole profiles table.
create or replace function public.supervisor_profile_id (p_supervisor_row_id uuid)
  returns uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select p.id from public.profiles p where p.supervisor_id = p_supervisor_row_id limit 1;
$$;

create or replace function public.intern_profile_id (p_intern_row_id uuid)
  returns uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select p.id from public.profiles p where p.intern_id = p_intern_row_id limit 1;
$$;

revoke all on function public.supervisor_profile_id (uuid) from public;
revoke all on function public.intern_profile_id (uuid) from public;
grant execute on function public.supervisor_profile_id (uuid) to authenticated, service_role;
grant execute on function public.intern_profile_id (uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- C3 (part 1) - make the document bucket PRIVATE
-- ---------------------------------------------------------------------------
-- `public = true` serves objects with no authentication at all and ignores the
-- storage RLS policies.  Files are now reached only through createSignedUrl().
update storage.buckets
   set public = false
 where id = 'intern-documents';

-- Objects uploaded while the bucket was public are already published; remove
-- the cached public URLs from the database so no client can render one again.
update public.documents
   set file_url = null
 where file_url is not null;


-- ---------------------------------------------------------------------------
-- C3 (part 2) - storage policies
-- ---------------------------------------------------------------------------
-- READ: previously `using (bucket_id = 'intern-documents')` for every
-- authenticated user, i.e. any intern could fetch any other intern's resume.
-- Now: owner, the intern's assigned supervisor, or an admin.
drop policy if exists "documents storage readable" on storage.objects;
create policy "documents storage readable"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'intern-documents'
    and (
      public.is_admin()
      or (storage.foldername (name))[1] = public.current_intern_id ()::text
      or (storage.foldername (name))[1] in (
        select i.id::text from public.interns i
        where i.supervisor_id = public.current_supervisor_id ()
      )
    )
  );

-- H1: "admins manage storage" was `for all` with ONLY a bucket_id check, so
-- any signed-in intern could delete or overwrite anybody's document object.
drop policy if exists "admins manage storage" on storage.objects;
create policy "admins manage storage"
  on storage.objects for all to authenticated
  using (bucket_id = 'intern-documents' and public.is_admin ())
  with check (bucket_id = 'intern-documents' and public.is_admin ());

-- An intern may delete only their own object (used by documentService.remove).
drop policy if exists "intern deletes own document object" on storage.objects;
create policy "intern deletes own document object"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'intern-documents'
    and (storage.foldername (name))[1] = public.current_intern_id ()::text
  );


-- ---------------------------------------------------------------------------
-- C2 - stop users promoting themselves
-- ---------------------------------------------------------------------------
-- A permissive UPDATE policy with USING but no WITH CHECK implicitly reuses
-- the USING expression as the check, which only constrains WHICH row may be
-- written - never WHICH COLUMNS.  Pinning role = current_role() closes it.
-- (current_role() reads the pre-update snapshot, so "new role must equal the
-- old role" is exactly what is enforced.)
drop policy if exists "users manage own profile" on public.profiles;
create policy "users manage own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid ())
  with check (id = auth.uid () and role = public.current_role ());

-- Defence in depth: the self-service write path used by the Profile page.
-- SECURITY DEFINER + an explicit allowlist means `role`, `email`,
-- `intern_id` and `supervisor_id` are not reachable from the client at all,
-- even if the policy above were later edited by mistake.
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

revoke all on function public.update_own_profile (text, text, text, text) from public;
grant execute on function public.update_own_profile (text, text, text, text) to authenticated, service_role;

-- 0c. Helper: ids of the interns assigned to the calling supervisor
-- ---------------------------------------------------------------------------
create or replace function public.current_supervisor_intern_ids ()
  returns setof uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select i.id from public.interns i
  where i.supervisor_id = public.current_supervisor_id();
$$;

revoke all on function public.current_supervisor_intern_ids () from public;
grant execute on function public.current_supervisor_intern_ids () to authenticated, service_role;



-- ---------------------------------------------------------------------------
-- C4 (1/6) - profiles
-- ---------------------------------------------------------------------------
-- Was: `using (true)` - every user could read every profile row, including
-- email, contact_number and bio of every intern in the company.
drop policy if exists "profiles readable by authenticated" on public.profiles;
create policy "profiles readable scoped"
  on public.profiles for select to authenticated
  using (id = auth.uid () or public.is_admin ());


-- ---------------------------------------------------------------------------
-- C4 (2/6) - supervisors
-- ---------------------------------------------------------------------------
-- Was: `using (true)`.  Supervisors are staff, not company-wide directory
-- data; only admins and the supervisor themselves need the row.
drop policy if exists "supervisors readable" on public.supervisors;
create policy "supervisors readable scoped"
  on public.supervisors for select to authenticated
  using (id = public.current_supervisor_id () or public.is_admin ());


-- ---------------------------------------------------------------------------
-- C4 (3/6) - attendance
-- ---------------------------------------------------------------------------
-- Was: `using (true)`, which made "intern manages own attendance" and
-- "supervisor reads assigned attendance" inert.
drop policy if exists "attendance readable" on public.attendance;
create policy "attendance readable scoped"
  on public.attendance for select to authenticated
  using (
    public.is_admin ()
    or intern_id = public.current_intern_id ()
    or intern_id in (select i.id from public.interns i
                     where i.supervisor_id = public.current_supervisor_id ())
  );


-- ---------------------------------------------------------------------------
-- C4 (4/6) - daily_journals
-- ---------------------------------------------------------------------------
-- Was: `using (true)` - any intern could read every intern's journal entries.
drop policy if exists "journals readable" on public.daily_journals;
create policy "journals readable scoped"
  on public.daily_journals for select to authenticated
  using (
    public.is_admin ()
    or intern_id = public.current_intern_id ()
    or intern_id in (select i.id from public.interns i
                     where i.supervisor_id = public.current_supervisor_id ())
  );

-- M8 bonus: the UPDATE policy had no WITH CHECK either, letting a supervisor


-- ---------------------------------------------------------------------------
-- C4 (5/6) - documents
-- ---------------------------------------------------------------------------
-- Was: `using (true)`, exposing every document row (and, before the bucket was
-- made private, a working public URL to the underlying file).
drop policy if exists "documents readable" on public.documents;
create policy "documents readable scoped"
  on public.documents for select to authenticated
  using (
    public.is_admin ()
    or intern_id = public.current_intern_id ()
    or intern_id in (select i.id from public.interns i
                     where i.supervisor_id = public.current_supervisor_id ())
  );


-- ---------------------------------------------------------------------------
-- C4 (6/6) - evaluations
-- ---------------------------------------------------------------------------
-- Was: `using (true)`.  Evaluation comments are confidential supervisor
-- assessments and must never be readable by peer interns.
drop policy if exists "evaluations readable" on public.evaluations;
create policy "evaluations readable scoped"
  on public.evaluations for select to authenticated
  using (
    public.is_admin ()
    or intern_id = public.current_intern_id ()
    or supervisor_id = public.current_supervisor_id ()
  );


-- ---------------------------------------------------------------------------
-- Bonus: institutions / programs had no RLS policy in this repo at all.
-- Guarded by a to_regclass check so the migration is safe on databases where
-- those tables have not been created yet.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass ('public.institutions') is not null then
    execute 'alter table public.institutions enable row level security';
    execute 'drop policy if exists "institutions readable" on public.institutions';
    execute 'create policy "institutions readable" on public.institutions
             for select to authenticated using (true)';
    execute 'drop policy if exists "admins manage institutions" on public.institutions';
    execute 'create policy "admins manage institutions" on public.institutions
             for all to authenticated
             using (public.is_admin()) with check (public.is_admin())';
  end if;

  if to_regclass ('public.programs') is not null then
    execute 'alter table public.programs enable row level security';
    execute 'drop policy if exists "programs readable" on public.programs';
    execute 'create policy "programs readable" on public.programs
             for select to authenticated using (true)';
    execute 'drop policy if exists "admins manage programs" on public.programs';
    execute 'create policy "admins manage programs" on public.programs
             for all to authenticated
             using (public.is_admin()) with check (public.is_admin())';
  end if;
end $$;


-- ============================================================================
-- !! ACTION REQUIRED OUTSIDE THE DATABASE (C1) !!
-- ============================================================================
-- The service-role key is committed in .env.example.  It must be rotated:
--   1. Supabase Dashboard -> Project Settings -> API -> Reset service_role key
--   2. Vercel -> Settings -> Environment Variables -> update
--      SUPABASE_SERVICE_ROLE_KEY with the NEW value
--   3. git filter-repo --invert-paths --path .env.example  (then force-push)
--   4. Re-clone for every collaborator
-- Rotation alone is sufficient to neutralise the leak; the history rewrite is
-- hygiene.

-- rewrite intern_id and move a journal to a different intern.  Pin it.
drop policy if exists "supervisor reviews assigned journals" on public.daily_journals;
create policy "supervisor reviews assigned journals"
  on public.daily_journals for update to authenticated
  using (
    intern_id in (select i.id from public.interns i
                  where i.supervisor_id = public.current_supervisor_id ())
  )
  with check (
    intern_id in (select i.id from public.interns i
                  where i.supervisor_id = public.current_supervisor_id ())
  );
