-- ============================================================================
-- 0048 - REPAIR: re-apply the missing security migrations 0045 + 0046 + 0047
-- ============================================================================
-- Verified against the live project (wsofrunlefoljliakrzc) on 2026-10-01:
-- the remote database has only 5 RPCs (current_intern_id, current_role,
-- current_supervisor_department_id, current_supervisor_id, is_admin). NONE of
-- the functions created by 0045, 0046 or 0047 exist, so all three migrations
-- failed or were never applied. That is why intern Time In failed with
--   Could not find the function public.attendance_clock_in(p_method)
--   in the schema cache
--
-- 0046 was additionally shipped CORRUPTED: its function bodies were detached
-- from their `create` headers, so notify_user() had an unterminated `$$` and
-- Postgres parsed all of attendance_clock_in() as part of notify_user()'s
-- body. 0046 has been repaired in place; the corrected definitions are
-- included below.
--
-- APPLY ORDER IS SIGNIFICANT: 0045 (policies + helper RPCs) -> 0046 (write
-- RPCs + grants) -> 0047 (audited RPCs, then FORCE ROW LEVEL SECURITY last).
--
-- SAFE TO RE-RUN: every statement is drop-if-exists / create-or-replace /
-- add column if not exists. No table is dropped or truncated, and the only
-- DELETE in this batch is inside announcement_delete(), which only runs when
-- an admin calls it.
--
-- NOTE: 0045 C1 requires rotating the service-role key, which was committed
-- at some point. See the note at the bottom of the 0045 section below.
-- ============================================================================


-- ###########################################################################
-- # BEGIN 0045_critical_security.sql
-- ###########################################################################

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
-- Also drop the NEW name: if 0045 already ran, the old name no longer exists and
-- the create below would fail with 42710 without this guard.
drop policy if exists "profiles readable scoped" on public.profiles;
create policy "profiles readable scoped"
  on public.profiles for select to authenticated
  using (id = auth.uid () or public.is_admin ());


-- ---------------------------------------------------------------------------
-- C4 (2/6) - supervisors
-- ---------------------------------------------------------------------------
-- Was: `using (true)`.  Supervisors are staff, not company-wide directory
-- data; only admins and the supervisor themselves need the row.
drop policy if exists "supervisors readable" on public.supervisors;
drop policy if exists "supervisors readable scoped" on public.supervisors;
create policy "supervisors readable scoped"
  on public.supervisors for select to authenticated
  using (id = public.current_supervisor_id () or public.is_admin ());


-- ---------------------------------------------------------------------------
-- C4 (3/6) - attendance
-- ---------------------------------------------------------------------------
-- Was: `using (true)`, which made "intern manages own attendance" and
-- "supervisor reads assigned attendance" inert.
drop policy if exists "attendance readable" on public.attendance;
drop policy if exists "attendance readable scoped" on public.attendance;
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
drop policy if exists "journals readable scoped" on public.daily_journals;
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
drop policy if exists "documents readable scoped" on public.documents;
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
drop policy if exists "evaluations readable scoped" on public.evaluations;
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


-- ###########################################################################
-- # END 0045_critical_security.sql
-- ###########################################################################


-- ###########################################################################
-- # BEGIN 0046_high_security.sql (REPAIRED)
-- ###########################################################################
-- ============================================================================
-- 0046 - HIGH security fixes (write-path integrity, audit logging, accounts)
-- ============================================================================
-- Follows 0045 (which fixed the CRITICAL privilege-escalation / public-storage
-- / over-broad RLS issues). This migration covers:
--
--   H2  The "intern manages own *" policies were FOR ALL with a row-only
--       WITH CHECK, so an intern could rewrite their OWN attendance `status`,
--       `total_hours` and `method`, self-approve a journal, or set their own
--       document to 'approved'. Every legitimate write is now a SECURITY
--       DEFINER RPC that computes the sensitive columns server-side, and the
--       direct table grants are revoked so the RPCs are the only path.
--
--   H3  handle_new_user() copied `role` out of raw_user_meta_data, which is
--       attacker-controlled - a self-signup could mint an admin. The role is
--       now hard-coded to the least-privileged value.
--
--   H4  audit_logs and notifications had RLS enabled but NO policies defined,
--       so audit writes were silently failing (the caller swallows the error)
--       and, on a DB where RLS was never enabled, anyone could forge or delete
--       audit rows. Real policies are now defined; audit_logs is append-only.
--
--   H7  `security definer` hardening: revoke CREATE on schema public so no
--       shadowing object can subvert is_admin(), and pin function grants.
--
--   H9  Role-capability functions so 'hr_staff' is not implicitly a superuser.
--
-- SAFE TO RE-RUN: every statement is drop-if-exists / create-or-replace.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Hours helper (server-side source of truth, mirrors utils/format diffHours)
-- ---------------------------------------------------------------------------
create or replace function public.attendance_hours (p_time_in timestamptz, p_time_out timestamptz)
  returns numeric
  language sql
  immutable
as $$
  select case
    when p_time_in is null or p_time_out is null then null
    when p_time_out <= p_time_in then 0
    else round((extract(epoch from (p_time_out - p_time_in)) / 3600.0)::numeric, 2)
  end;
$$;

-- The app measures the working day in Asia/Manila local time.
create or replace function public.attendance_today ()
  returns date
  language sql
  stable
as $$
  select (now() at time zone 'Asia/Manila')::date;
$$;


-- ---------------------------------------------------------------------------
-- H9 - explicit role capabilities
-- ---------------------------------------------------------------------------
-- is_admin() treats 'hr_staff' exactly like 'admin', so an HR account could
-- delete auth users and rewrite global settings. These functions let each
-- policy name the capability it actually needs.
create or replace function public.can_delete_users ()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  -- Deleting an auth account is destructive and unrecoverable: admin only.
  select exists (
    select 1 from public.profiles
    where id = auth.uid () and role = 'admin'
  );
$$;

create or replace function public.can_manage_settings ()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid () and role in ('admin', 'hr_staff')
  );
$$;

revoke all on function public.can_delete_users () from public;
revoke all on function public.can_manage_settings () from public;
revoke all on function public.attendance_hours (timestamptz, timestamptz) from public;
grant execute on function public.can_delete_users () to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- H3 - a self-signup must never be able to choose its own role
-- ---------------------------------------------------------------------------
-- raw_user_meta_data is supplied by the client, so
-- `coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'intern')` let
-- anyone who could reach signUp() create an admin profile directly. The role
-- is now always the least-privileged value; promotion is a service-role
-- action performed by api/admin/create-user.js after an RBAC check.
create or replace function public.handle_new_user ()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    'intern'::user_role
  )
  on conflict (id) do nothing;
  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- H4 - audit_logs and notifications: real policies
-- ---------------------------------------------------------------------------
-- These tables had `enable row level security` but no policies anywhere in
-- the repo. Two possible outcomes, both bad:
--   * policies missing  -> every insert fails, and recordAudit() swallows the
--                          error, so the audit trail was SILENTLY EMPTY while
--                          the UI implied it was recording.
--   * RLS never applied -> any authenticated user could read, forge or delete
--                          the audit trail.
-- Both are fixed here. audit_logs is INSERT-ONLY via SECURITY DEFINER trigger
-- functions; no client policy may modify or delete a row.
alter table public.audit_logs enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "admins read audit logs" on public.audit_logs;
create policy "admins read audit logs"
  on public.audit_logs for select to authenticated
  using (public.is_admin ());

drop policy if exists "users insert own audit logs" on public.audit_logs;
create policy "users insert own audit logs"
  on public.audit_logs for insert to authenticated
  with check (user_id = auth.uid ());

-- No UPDATE / DELETE policy exists on purpose: the audit trail is append-only.
-- The 0044 profile trigger and the serverless functions use the service role,
-- which bypasses RLS, so they keep working.

drop policy if exists "own notifications readable" on public.notifications;
create policy "own notifications readable"
  on public.notifications for select to authenticated
  using (user_id = auth.uid ());

drop policy if exists "own notifications updatable" on public.notifications;
create policy "own notifications updatable"
  on public.notifications for update to authenticated
  using (user_id = auth.uid ())
  with check (user_id = auth.uid ());

-- No INSERT policy: a user may only mark THEIR OWN notifications as read.
-- Fan-out happens through SECURITY DEFINER functions (below), which also stops
-- a user from spamming arbitrary rows into other people's notification lists.
-- NOTE: DROP first: the live DB may already hold these names with a different
-- return type (integer/uuid), and CREATE OR REPLACE cannot change that.
drop function if exists public.notify_role (text, text, text, text, text, jsonb);
drop function if exists public.notify_user (uuid, text, text, text, text, jsonb);
create or replace function public.notify_role (
  p_role text,
  p_type text,
  p_title text,
  p_message text,
  p_link text default null,
  p_metadata jsonb default '{}'::jsonb
)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, message, link, metadata)
  select p.id, p_type, p_title, p_message, p_link, coalesce(p_metadata, '{}'::jsonb)
  from public.profiles p
  where p.role::text = p_role;
end;
$$;

create or replace function public.notify_user (
  p_user_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_link text default null,
  p_metadata jsonb default '{}'::jsonb
)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if p_user_id is null then
    return;
  end if;
  insert into public.notifications (user_id, type, title, message, link, metadata)
  values (p_user_id, p_type, p_title, p_message, p_link, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

revoke all on function public.notify_role (text, text, text, text, text, jsonb) from public;
revoke all on function public.notify_user (uuid, text, text, text, text, jsonb) from public;
grant execute on function public.notify_role (text, text, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.notify_user (uuid, text, text, text, text, jsonb) to authenticated, service_role;


-- The OJT shift starts at 13:00 (780 minutes after midnight, Asia/Manila).
-- This used to live only in src/lib/constants.js, which the browser could
-- change at will. It is now a real column so the lateness rule is decided
-- server-side. `if not exists` keeps the migration safe to re-run and safe
-- on a database that already has the column.
--
-- This is declared at migration level, NOT inside attendance_clock_in():
-- plpgsql does not accept DDL in a function body.
alter table public.settings
  add column if not exists shift_start_minute integer not null default 780;

-- ---------------------------------------------------------------------------
-- H2 (1/4) - attendance: clock-in
-- ---------------------------------------------------------------------------
-- Replaces the client-side INSERT. `status` is derived here (late vs present)
-- from the server clock, so it can no longer be asserted by the caller.
create or replace function public.attendance_clock_in (p_method text default 'manual')
  returns public.attendance
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_intern uuid := public.current_intern_id ();
  v_today date := public.attendance_today ();
  v_shift integer;
  v_row public.attendance;
begin
  if v_intern is null then
    raise exception 'No intern profile is linked to this account.'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (
    select 1 from public.attendance
    where intern_id = v_intern and date = v_today
  ) then
    raise exception 'You have already submitted your attendance for today.'
      using errcode = 'unique_violation';
  end if;

  -- The OJT shift start is read from settings.shift_start_minute (the column
  -- is added at migration level above, since plpgsql cannot run DDL). 780
  -- = 13:00 Asia/Manila, mirroring src/lib/constants.js SHIFT_START_MINUTE.
  select coalesce(
    (select s.shift_start_minute from public.settings s where s.id = 1),
    780
  )
    into v_shift;

  insert into public.attendance (intern_id, date, time_in, method, status)
  values (
    v_intern,
    v_today,
    now(),
    coalesce(p_method, 'manual'),
    case
      when extract(hour from now() at time zone 'Asia/Manila') * 60
           + extract(minute from now() at time zone 'Asia/Manila')
           > v_shift
      then 'late'::attendance_status
      else 'present'::attendance_status
    end
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.attendance_clock_in (text) from public;
grant execute on function public.attendance_clock_in (text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- H2 (2/4) - attendance: clock-out
-- ---------------------------------------------------------------------------
-- total_hours is computed by the database. The caller can no longer post an
-- arbitrary duration and inflate the hours that feed evaluations and reports.
create or replace function public.attendance_clock_out (
  p_time_out timestamptz,
  p_remarks text default null
)
  returns public.attendance
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_intern uuid := public.current_intern_id ();
  v_row public.attendance;
begin
  if v_intern is null then
    raise exception 'No intern profile is linked to this account.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_row
    from public.attendance
   where id = (
     select a.id from public.attendance a
      where a.intern_id = v_intern
        and a.date = public.attendance_today()
        and a.time_out is null
      order by a.time_in desc
      limit 1
   )
   for update;

  if v_row.id is null then
    raise exception 'You do not have an open attendance record to close.'
      using errcode = 'no_data_found';
  end if;

  if p_time_out is null or p_time_out <= v_row.time_in then
    raise exception 'Time out must be after time in.'
      using errcode = 'check_violation';
  end if;

  update public.attendance
     set time_out   = p_time_out,
         total_hours = public.attendance_hours(time_in, p_time_out),
         remarks     = nullif(btrim(p_remarks), ''),
         method      = 'manual'
   where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.attendance_clock_out (timestamptz, text) from public;
grant execute on function public.attendance_clock_out (timestamptz, text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- H2 (3/4) - attendance: submit a missed clock-out claim
-- ---------------------------------------------------------------------------
create or replace function public.attendance_submit_claim (
  p_record_id uuid,
  p_claimed_time_out timestamptz,
  p_remarks text
)
  returns public.attendance
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_intern uuid := public.current_intern_id ();
  v_row public.attendance;
begin
  if v_intern is null then
    raise exception 'No intern profile is linked to this account.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from public.attendance
   where id = p_record_id and intern_id = v_intern
   for update;

  if v_row.id is null then
    raise exception 'Attendance record not found.'
      using errcode = 'no_data_found';
  end if;
  if v_row.time_out is not null then
    raise exception 'This attendance record already has a time out.'
      using errcode = 'check_violation';
  end if;
  if v_row.claim_status = 'pending' then
    raise exception 'You already have a pending claim for this record.'
      using errcode = 'check_violation';
  end if;
  if v_row.claim_status = 'approved' then
    raise exception 'This claim has already been approved.'
      using errcode = 'check_violation';
  end if;
  if p_claimed_time_out is null or p_claimed_time_out <= v_row.time_in then
    raise exception 'Claimed time out must be after time in.'
      using errcode = 'check_violation';
  end if;

  update public.attendance
     set claimed_time_out = p_claimed_time_out,
         claim_status     = 'pending',
         claim_remarks    = nullif(btrim(p_remarks), '')
   where id = v_row.id
   returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.attendance_submit_claim (uuid, timestamptz, text) from public;
grant execute on function public.attendance_submit_claim (uuid, timestamptz, text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- H2 (4/4) - attendance: supervisor/admin reviews a claim
-- ---------------------------------------------------------------------------
-- The reviewer id is taken from the JWT, never from the request body, and the
-- resulting time_out / total_hours / status are computed here. A supervisor can
-- only act on an intern assigned to them.
create or replace function public.attendance_review_claim (
  p_record_id uuid,
  p_decision text,
  p_comment text default null
)
  returns public.attendance
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_row public.attendance;
  v_sup uuid := public.current_supervisor_id ();
  v_allowed boolean;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.'
      using errcode = 'check_violation';
  end if;

  select * into v_row from public.attendance where id = p_record_id for update;

  if v_row.id is null then
    raise exception 'Attendance record not found.'
      using errcode = 'no_data_found';
  end if;

  select exists (
    select 1 from public.interns i
     where i.id = v_row.intern_id
       and (public.is_admin() or i.supervisor_id = v_sup)
  ) into v_allowed;

  if not v_allowed then
    raise exception 'You are not assigned to this intern.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_row.claimed_time_out is null then
    raise exception 'No claim exists for this attendance record.'
      using errcode = 'check_violation';
  end if;
  if v_row.claim_status <> 'pending' then
    raise exception 'This claim has already been reviewed.'
      using errcode = 'check_violation';
  end if;

  update public.attendance
     set claim_status          = p_decision,
         claim_reviewed_by     = auth.uid(),
         claim_reviewed_at     = now(),
         claim_review_comment  = nullif(btrim(p_comment), ''),
         remarks               = nullif(btrim(p_comment), ''),
         time_out              = case when p_decision = 'approved'
                                      then v_row.claimed_time_out else time_out end,
         total_hours           = case when p_decision = 'approved'
                                      then public.attendance_hours(v_row.time_in, v_row.claimed_time_out)
                                      else total_hours end,
         method                = case when p_decision = 'approved' then 'claimed' else method end,
         status                = case when p_decision = 'rejected'
                                      then 'absent'::attendance_status else status end
   where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.attendance_review_claim (uuid, text, text) from public;
grant execute on function public.attendance_review_claim (uuid, text, text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- H2 - journal: supervisor review (an intern can no longer self-approve)
-- ---------------------------------------------------------------------------
-- intern_id is immutable here, closing the M8 gap where a supervisor could
-- re-point a journal at a different intern.
create or replace function public.journal_review (
  p_journal_id uuid,
  p_status text,
  p_comment text default null
)
  returns public.daily_journals
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_row public.daily_journals;
  v_sup uuid := public.current_supervisor_id ();
begin
  if p_status not in ('approved', 'rejected', 'pending') then
    raise exception 'Invalid journal status.'
      using errcode = 'check_violation';
  end if;

  select * into v_row from public.daily_journals
   where id = p_journal_id for update;

  if v_row.id is null then
    raise exception 'Journal entry not found.'
      using errcode = 'no_data_found';
  end if;

  if not public.is_admin() and not (
    v_sup is not null and exists (
      select 1 from public.interns i
       where i.id = v_row.intern_id and i.supervisor_id = v_sup
    )
  ) then
    raise exception 'You are not assigned to this intern.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.daily_journals
     set status            = p_status,
         supervisor_comment = nullif(btrim(p_comment), ''),
         supervisor_id      = coalesce(v_sup, supervisor_id)
   where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.journal_review (uuid, text, text) from public;
grant execute on function public.journal_review (uuid, text, text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- H2 - document review (status is a reviewer decision, not a client field)
-- ---------------------------------------------------------------------------
create or replace function public.document_review (p_document_id uuid, p_status text)
  returns public.documents
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_row public.documents;
begin
  if p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'Invalid document status.'
      using errcode = 'check_violation';
  end if;
  if not public.is_admin() then
    raise exception 'Only administrators may review documents.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.documents
     set status = p_status
   where id = p_document_id
   returning * into v_row;

  if v_row.id is null then
    raise exception 'Document not found.'
      using errcode = 'no_data_found';
  end if;

  return v_row;
end;
$$;

revoke all on function public.document_review (uuid, text) from public;
grant execute on function public.document_review (uuid, text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- H2 - evaluation create (supervisor_id is bound to the caller server-side)
-- ---------------------------------------------------------------------------
create or replace function public.evaluation_create (
  p_intern_id uuid,
  p_attendance integer,
  p_communication integer,
  p_teamwork integer,
  p_initiative integer,
  p_technical_skills integer,
  p_professionalism integer,
  p_overall_rating integer,
  p_comments text default null,
  p_final_recommendation text default null
)
  returns public.evaluations
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_sup uuid := public.current_supervisor_id ();
  v_row public.evaluations;
begin
  if v_sup is null then
    raise exception 'Only supervisors may submit evaluations.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.interns i
     where i.id = p_intern_id and i.supervisor_id = v_sup
  ) then
    raise exception 'That intern is not assigned to you.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.evaluations (
    intern_id, supervisor_id, attendance, communication, teamwork,
    initiative, technical_skills, professionalism, overall_rating,
    comments, final_recommendation, status
  )
  values (
    p_intern_id, v_sup, p_attendance, p_communication, p_teamwork,
    p_initiative, p_technical_skills, p_professionalism, p_overall_rating,
    nullif(btrim(p_comments), ''), p_final_recommendation, 'pending'
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.evaluation_create (uuid, integer, integer, integer, integer, integer, integer, integer, text, text) from public;
grant execute on function public.evaluation_create (uuid, integer, integer, integer, integer, integer, integer, integer, text, text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- H2 - revoke the direct table writes the RPCs now replace
-- ---------------------------------------------------------------------------
-- The RLS row checks remain as defence in depth, but without these revokes an
-- intern could keep writing `status`, `total_hours` or `supervisor_comment`
-- straight through PostgREST. Revoking makes the SECURITY DEFINER functions
-- the ONLY path, which is what actually computes those values.
revoke update on public.evaluations from authenticated;
revoke update on public.documents from authenticated;
revoke update on public.daily_journals from authenticated;

-- Attendance: the intern may only touch the three claim columns directly;
-- clock-in, clock-out and claim review all go through the RPCs.
revoke insert, update on public.attendance from authenticated;
grant update (claimed_time_out, claim_status, claim_remarks)
  on public.attendance to authenticated;

-- documents DELETE is intentionally still granted - an intern must be able to
-- remove their own upload, and 0045 already scopes that at the row level.


-- ---------------------------------------------------------------------------
-- H11 - storage limits (defence in depth behind the client-side 5 MB check)
-- ---------------------------------------------------------------------------
update storage.buckets
   set file_size_limit   = 5242880,
       allowed_mime_types = array[
         'application/pdf',
         'image/png',
         'image/jpeg',
         'image/gif',
         'image/webp',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
       ]
 where id = 'intern-documents';


-- ---------------------------------------------------------------------------
-- H7 - security definer hardening
-- ---------------------------------------------------------------------------
-- No unprivileged role may create objects in `public`, so nothing can shadow
-- is_admin() or the other helpers and subvert an RLS decision.
revoke create on schema public from public;
revoke create on schema public from anon;
revoke create on schema public from authenticated;

-- The role helpers must not be callable by `anon` (unauthenticated callers).
revoke all on function public.is_admin () from public, anon;
revoke all on function public.current_role () from public, anon;
revoke all on function public.current_intern_id () from public, anon;
revoke all on function public.current_supervisor_id () from public, anon;
revoke all on function public.current_supervisor_department_id () from public, anon;
revoke all on function public.current_supervisor_intern_ids () from public, anon;

grant execute on function public.is_admin () to authenticated, service_role;
grant execute on function public.current_role () to authenticated, service_role;
grant execute on function public.current_intern_id () to authenticated, service_role;
grant execute on function public.current_supervisor_id () to authenticated, service_role;
grant execute on function public.current_supervisor_department_id () to authenticated, service_role;
grant execute on function public.current_supervisor_intern_ids () to authenticated, service_role;

-- notify_role() can insert notifications for EVERY user holding a role, so it
-- is server-only. The client uses notify_user() and the 0045 id helpers.
revoke all on function public.profile_ids_by_role (text) from anon;


-- ============================================================================
-- Remaining HIGH items that are NOT database migrations (see the code changes):
--   H5  rate limiting on the /api endpoints  -> api/admin/*.js
--   H6  password policy (>= 12 chars)       -> api/admin/*.js
--   H8  session idle / absolute timeout      -> src/contexts/AuthContext.jsx
--   H10 last-admin guard on user deletion    -> api/admin/delete-user.js
-- ============================================================================




grant execute on function public.can_manage_settings () to authenticated, service_role;
grant execute on function public.attendance_hours (timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.attendance_today () to authenticated, service_role;


-- ###########################################################################
-- # END 0046_high_security.sql
-- ###########################################################################


-- ###########################################################################
-- # BEGIN 0047_medium_security.sql
-- ###########################################################################
-- ============================================================================
-- 0047 - MEDIUM security fixes (defence in depth, scoping, audit fidelity)
-- ============================================================================
-- Follows 0045 (CRITICAL) and 0046 (HIGH). This migration covers:
--
--   M1  FORCE ROW LEVEL SECURITY, so the table owner no longer silently
--       bypasses every policy.
--   M3  audit_logs.ip_address / user_agent were permanently NULL, so an
--       incident could not be attributed to a device or network. A SECURITY
--       DEFINER writer captures them from the request headers.
--   M5  interns readable allowed `created_by = auth.uid()`, so a supervisor who
--       CREATED an intern kept permanent access to their PII even after being
--       reassigned. Access now follows the CURRENT supervisor assignment.
--   M6  Supervisors could hard-DELETE an intern row, and ON DELETE CASCADE then
--       destroyed that intern's attendance, journals, documents and
--       evaluations. Removal is now admin-only and archive-only.
--   M7  evaluations "supervisor manages assigned" was FOR ALL: a supervisor
--       could rewrite ratings and the final recommendation on an already
--       submitted/approved evaluation, and file one for an unassigned intern.
--   M9  Announcement create/update/delete produced no audit row, so content
--       removal was unattributable. All three now go through audited RPCs.
--
-- SAFE TO RE-RUN: every statement is drop-if-exists / create-or-replace.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- M1 - FORCE ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
-- RLS is bypassed entirely by the table OWNER. Without FORCE, any migration or
-- script that runs as the owner silently ignores every policy, and the
-- SECURITY DEFINER functions execute with the owner's rights. FORCE makes the
-- policies apply to the owner too, so a future mistake fails loudly instead of
-- quietly disabling access control.
-- (The DO block that applies this is at the end of the file, so it runs after
--  every policy above has been (re)created.)


-- ---------------------------------------------------------------------------
-- M3 - capture ip_address / user_agent on every audit row
-- ---------------------------------------------------------------------------
-- Both columns existed but nothing ever populated them, so the audit trail
-- could not answer "who and from where". The client cannot be trusted to send
-- its own headers, so this is resolved server-side from the request headers
-- PostgREST forwards.
--
-- SECURITY DEFINER so it still works now that M1 forces RLS on audit_logs even
-- for the owner, and so a client cannot forge the acting user.
create or replace function public.write_audit_log (
  p_action text,
  p_resource_type text,
  p_resource_id uuid default null,
  p_changes jsonb default '{}'::jsonb
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_id uuid;
  v_ip text;
  v_ua text;
begin
  -- Best-effort request metadata. These helpers return NULL (rather than
  -- erroring) when the statement did not arrive through PostgREST, e.g. from a
  -- migration or from inside another SECURITY DEFINER chain.
  begin
    v_ip := nullif(btrim(
      current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for'
    ), '');
  exception when others then
    v_ip := null;
  end;

  begin
    v_ua := nullif(left(btrim(
      current_setting('request.headers', true)::jsonb ->> 'user-agent'
    ), 512), '');
  exception when others then
    v_ua := null;
  end;

  insert into public.audit_logs (user_id, action, resource_type, resource_id, changes, ip_address, user_agent)
  values (auth.uid(), p_action, p_resource_type, p_resource_id,
          coalesce(p_changes, '{}'::jsonb), v_ip, v_ua)
  returning id into v_id;

  return v_id;
end;
$$;



-- ---------------------------------------------------------------------------
-- M5 - intern visibility follows the CURRENT assignment, not history
-- ---------------------------------------------------------------------------
-- `created_by = auth.uid()` meant a supervisor kept reading an intern's PII
-- forever, even after the intern was reassigned to someone else. Access is
-- granted by the current supervisor_id only.
drop policy if exists "interns readable" on public.interns;
create policy "interns readable"
  on public.interns for select to authenticated
  using (
    public.is_admin()
    or id = public.current_intern_id()
    or supervisor_id = public.current_supervisor_id()
  );

drop policy if exists "supervisor reads assigned interns" on public.interns;
create policy "supervisor reads assigned interns"
  on public.interns for select to authenticated
  using (supervisor_id = public.current_supervisor_id () or public.is_admin ());


-- ---------------------------------------------------------------------------
-- M6 - supervisors must not be able to destroy an intern's record
-- ---------------------------------------------------------------------------
-- A supervisor DELETE cascaded away attendance, journals, documents and
-- evaluations irrecoverably. The policy is removed; admins keep full control
-- and internService.archive() remains the soft-delete path.
drop policy if exists "supervisor deletes assigned interns" on public.interns;


-- ---------------------------------------------------------------------------
-- M7 - evaluations: insert-only while pending, and only for assigned interns
-- ---------------------------------------------------------------------------
-- "supervisor manages assigned evaluations" was FOR ALL, so a supervisor could
-- rewrite the ratings and final recommendation on an evaluation the intern had
-- already seen, and could file one for an intern they were not assigned to.
-- The broad policy is replaced by a narrow INSERT plus the already-existing
-- `evaluation_create` RPC (0046) which verifies the assignment server-side.
-- Update is intentionally NOT granted: an evaluation is immutable once filed.
drop policy if exists "supervisor manages assigned evaluations" on public.evaluations;
drop policy if exists "supervisor inserts assigned evaluations" on public.evaluations;
create policy "supervisor inserts assigned evaluations"
  on public.evaluations for insert to authenticated
  with check (
    supervisor_id = public.current_supervisor_id ()
    and exists (
      select 1 from public.interns i
       where i.id = intern_id and i.supervisor_id = public.current_supervisor_id ()
    )
  );

revoke all on function public.write_audit_log (text, text, uuid, jsonb) from public;
grant execute on function public.write_audit_log (text, text, uuid, jsonb) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- M9 - audited announcement writes
-- ---------------------------------------------------------------------------
-- Announcement create/update/delete wrote no audit row, so company-wide content
-- could be altered or removed with no attributable trace. Each mutation now
-- goes through a SECURITY DEFINER RPC that writes the audit entry in the same
-- transaction, so the record cannot be lost even if the client drops it.
create or replace function public.announcement_create (
  p_title text,
  p_body text,
  p_category text default 'company_news',
  p_pinned boolean default false
)
  returns public.announcements
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_row public.announcements;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may manage announcements.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.announcements (title, body, category, pinned, published_by)
  values (
    nullif(btrim(p_title), ''),
    nullif(btrim(p_body), ''),
    coalesce(p_category, 'company_news'),
    coalesce(p_pinned, false),
    auth.uid()
  )
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Title and body are required.'
      using errcode = 'check_violation';
  end if;

  perform public.write_audit_log(
    'create', 'announcement', v_row.id,
    jsonb_build_object('title', v_row.title, 'category', v_row.category, 'pinned', v_row.pinned)
  );

  return v_row;
end;
$$;

create or replace function public.announcement_update (
  p_id uuid,
  p_title text,
  p_body text,
  p_category text default null,
  p_pinned boolean default null
)
  returns public.announcements
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_row public.announcements;
  v_before public.announcements;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may manage announcements.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_before from public.announcements where id = p_id;
  if v_before.id is null then
    raise exception 'Announcement not found.' using errcode = 'no_data_found';
  end if;

  update public.announcements
     set title    = coalesce(nullif(btrim(p_title), ''), title),
         body     = coalesce(nullif(btrim(p_body), ''), body),
         category = coalesce(p_category, category),
         pinned   = coalesce(p_pinned, pinned)
   where id = p_id
  returning * into v_row;

  perform public.write_audit_log(
    'update', 'announcement', v_row.id,
    jsonb_build_object(
      'title_before', v_before.title, 'title_after', v_row.title,
      'pinned_before', v_before.pinned, 'pinned_after', v_row.pinned
    )
  );

  return v_row;
end;
$$;

create or replace function public.announcement_delete (p_id uuid)
  returns boolean
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_before public.announcements;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may manage announcements.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_before from public.announcements where id = p_id;
  if v_before.id is null then
    raise exception 'Announcement not found.' using errcode = 'no_data_found';
  end if;

  delete from public.announcements where id = p_id;

  -- Record what was removed, so the audit trail keeps the content after the
  -- row itself is gone.
  perform public.write_audit_log(
    'delete', 'announcement', p_id,
    jsonb_build_object('title', v_before.title, 'body', v_before.body, 'category', v_before.category)
  );

  return true;
end;
$$;

revoke all on function public.announcement_create (text, text, text, boolean) from public;
revoke all on function public.announcement_update (uuid, text, text, text, boolean) from public;
revoke all on function public.announcement_delete (uuid) from public;
grant execute on function public.announcement_create (text, text, text, boolean) to authenticated, service_role;
grant execute on function public.announcement_update (uuid, text, text, text, boolean) to authenticated, service_role;
grant execute on function public.announcement_delete (uuid) to authenticated, service_role;

-- The client no longer writes these rows directly, so the table grants are
-- dropped in favour of the audited RPCs above.
revoke insert, update, delete on public.announcements from authenticated;


-- ---------------------------------------------------------------------------
-- M1 (applied last) - FORCE ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
-- Deliberately last: FORCE makes RLS apply to the table OWNER as well. Every
-- policy and function above must already exist when this runs, otherwise a
-- SECURITY DEFINER function owned by that role would be evaluated against a
-- policy set that is still incomplete.
--
-- to_regclass guards each table so the block is a no-op for any table this
-- database does not have.
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'departments', 'supervisors', 'interns', 'attendance',
    'daily_journals', 'documents', 'evaluations', 'announcements',
    'settings', 'notifications', 'audit_logs', 'announcement_likes',
    'institutions', 'programs'
  ] loop
    if to_regclass ('public.' || t) is not null then
      execute format('alter table public.%I force row level security', t);
    end if;
  end loop;
end $$;



-- ###########################################################################
-- # END 0047_medium_security.sql
-- ###########################################################################

-- PostgREST caches its schema. After running this, reload it so the new RPCs
-- become callable:
--   select pg_notify('pgrst', 'reload schema');
-- Verify with:
--   select proname from pg_proc
--    where proname in ('attendance_clock_in','attendance_clock_out',
--                      'attendance_submit_claim','attendance_review_claim',
--                      'journal_review','document_review','evaluation_create');
