-- ============================================================================
-- RBAC hardening — enforce role-based data isolation at the database layer.
-- ============================================================================
-- Goal: satisfy the access-control requirements even if a client is bypassed.
--
--   * HR Admin / HR Staff  -> global visibility + full management.
--   * Supervisor            -> ONLY their assigned interns (and that interns'
--                             attendance / journals / documents / evaluations).
--                             A supervisor CANNOT read another supervisor's interns.
--   * Intern                -> ONLY their own row + their own attendance /
--                             journals / documents / evaluations.
--                             An intern CANNOT read supervisor or admin data.
--
-- This replaces the previous "readable by authenticated using (true)" policies
-- (which leaked cross-role data to any signed-in token) with owner/admin
-- scoped policies. The UI already filters correctly; this makes the API
-- itself return 403/empty for out-of-scope access.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper: is the current user an admin OR hr_staff? (already exists, reused)
-- ---------------------------------------------------------------------------
-- public.is_admin() already returns boolean for ('admin','hr_staff').

-- ---------------------------------------------------------------------------
-- profiles: everyone reads profiles (needed for names/emails in lists), but
-- only admins manage, and a user may update their own row.
-- ---------------------------------------------------------------------------
drop policy if exists "profiles readable by authenticated" on public.profiles;
create policy "profiles readable by authenticated"
  on public.profiles for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- supervisors: readable by all authenticated (names shown in dropdowns),
-- managed only by admins. A supervisor may also read their OWN supervisor row.
-- ---------------------------------------------------------------------------
drop policy if exists "supervisors readable" on public.supervisors;
create policy "supervisors readable"
  on public.supervisors for select to authenticated
  using (true);

drop policy if exists "admins manage supervisors" on public.supervisors;
create policy "admins manage supervisors"
  on public.supervisors for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- interns: the core isolation table.
--   * admin              -> all
--   * supervisor        -> only interns where supervisor_id = their id
--                          OR created_by = their profile id
--   * intern            -> only their own intern row
-- ---------------------------------------------------------------------------
drop policy if exists "interns readable" on public.interns;
create policy "interns readable"
  on public.interns for select to authenticated
  using (
    public.is_admin()
    or id = public.current_intern_id()
    or supervisor_id = public.current_supervisor_id()
    or created_by = auth.uid()
  );

drop policy if exists "admins manage interns" on public.interns;
create policy "admins manage interns"
  on public.interns for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "intern reads own row" on public.interns;
create policy "intern reads own row"
  on public.interns for select to authenticated
  using (id = public.current_intern_id());

drop policy if exists "supervisor reads assigned interns" on public.interns;
create policy "supervisor reads assigned interns"
  on public.interns for select to authenticated
  using (supervisor_id = public.current_supervisor_id());

-- Supervisor may UPDATE assigned interns only (no INSERT).
drop policy if exists "supervisor modifies assigned interns" on public.interns;
create policy "supervisor modifies assigned interns"
  on public.interns for update to authenticated
  using (
    supervisor_id = public.current_supervisor_id()
  )
  with check (
    supervisor_id = public.current_supervisor_id()
    and department_id = public.current_supervisor_department_id()
  );

-- Supervisor may DELETE assigned interns only.
drop policy if exists "supervisor deletes assigned interns" on public.interns;
create policy "supervisor deletes assigned interns"
  on public.interns for delete to authenticated
  using (
    supervisor_id = public.current_supervisor_id()
  );

-- ---------------------------------------------------------------------------
-- attendance: intern owns their rows; supervisor sees only assigned interns';
-- attendance; admin sees all.
-- ---------------------------------------------------------------------------
drop policy if exists "attendance readable" on public.attendance;
create policy "attendance readable"
  on public.attendance for select to authenticated
  using (
    public.is_admin()
    or intern_id = public.current_intern_id()
    or intern_id in (
      select id from public.interns
      where supervisor_id = public.current_supervisor_id()
    )
  );

drop policy if exists "admins manage attendance" on public.attendance;
create policy "admins manage attendance"
  on public.attendance for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "intern manages own attendance" on public.attendance;
create policy "intern manages own attendance"
  on public.attendance for all to authenticated
  using (intern_id = public.current_intern_id())
  with check (intern_id = public.current_intern_id());

drop policy if exists "supervisor reads assigned attendance" on public.attendance;
create policy "supervisor reads assigned attendance"
  on public.attendance for select to authenticated
  using (
    intern_id in (
      select id from public.interns
      where supervisor_id = public.current_supervisor_id()
    )
  );

-- ---------------------------------------------------------------------------
-- daily_journals: same shape as attendance.
-- ---------------------------------------------------------------------------
drop policy if exists "journals readable" on public.daily_journals;
create policy "journals readable"
  on public.daily_journals for select to authenticated
  using (
    public.is_admin()
    or intern_id = public.current_intern_id()
    or intern_id in (
      select id from public.interns
      where supervisor_id = public.current_supervisor_id()
    )
  );

drop policy if exists "admins manage journals" on public.daily_journals;
create policy "admins manage journals"
  on public.daily_journals for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "intern manages own journals" on public.daily_journals;
create policy "intern manages own journals"
  on public.daily_journals for all to authenticated
  using (intern_id = public.current_intern_id())
  with check (intern_id = public.current_intern_id());

drop policy if exists "supervisor reviews assigned journals" on public.daily_journals;
create policy "supervisor reviews assigned journals"
  on public.daily_journals for update to authenticated
  using (
    intern_id in (
      select id from public.interns
      where supervisor_id = public.current_supervisor_id()
    )
  );

-- ---------------------------------------------------------------------------
-- documents: same shape.
-- ---------------------------------------------------------------------------
drop policy if exists "documents readable" on public.documents;
create policy "documents readable"
  on public.documents for select to authenticated
  using (
    public.is_admin()
    or intern_id = public.current_intern_id()
    or intern_id in (
      select id from public.interns
      where supervisor_id = public.current_supervisor_id()
    )
  );

drop policy if exists "admins manage documents" on public.documents;
create policy "admins manage documents"
  on public.documents for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "intern manages own documents" on public.documents;
create policy "intern manages own documents"
  on public.documents for all to authenticated
  using (intern_id = public.current_intern_id())
  with check (intern_id = public.current_intern_id());

-- ---------------------------------------------------------------------------
-- evaluations: supervisor manages only their own evaluations; intern reads own.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- announcements: readable by all authenticated; managed by admins only.
-- ---------------------------------------------------------------------------
drop policy if exists "announcements readable" on public.announcements;
create policy "announcements readable"
  on public.announcements for select to authenticated using (true);

drop policy if exists "admins manage announcements" on public.announcements;
create policy "admins manage announcements"
  on public.announcements for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- settings: readable by all authenticated; managed by admins only.
-- ---------------------------------------------------------------------------
drop policy if exists "settings readable" on public.settings;
create policy "settings readable"
  on public.settings for select to authenticated using (true);

drop policy if exists "admins manage settings" on public.settings;
create policy "admins manage settings"
  on public.settings for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- audit_logs: admin-only (read + write). No other role may touch them.
-- ---------------------------------------------------------------------------
alter table public.audit_logs enable row level security;

drop policy if exists "admins read audit logs" on public.audit_logs;
create policy "admins read audit logs"
  on public.audit_logs for select to authenticated
  using (public.is_admin());

drop policy if exists "admins write audit logs" on public.audit_logs;
create policy "admins write audit logs"
  on public.audit_logs for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- notifications: a user reads/updates ONLY their own notifications.
-- ---------------------------------------------------------------------------
alter table public.notifications enable row level security;

drop policy if exists "user reads own notifications" on public.notifications;
create policy "user reads own notifications"
  on public.notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "user manages own notifications" on public.notifications;
create policy "user manages own notifications"
  on public.notifications for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "admins manage notifications" on public.notifications;
create policy "admins manage notifications"
  on public.notifications for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Storage: intern uploads only into their own folder; all authenticated may
-- read (so supervisors/admins can review). Admins manage.
-- ---------------------------------------------------------------------------
drop policy if exists "documents storage readable" on storage.objects;
create policy "documents storage readable"
  on storage.objects for select to authenticated
  using (bucket_id = 'intern-documents');

drop policy if exists "intern uploads own documents" on storage.objects;
create policy "intern uploads own documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'intern-documents'
    and (storage.foldername(name))[1] = public.current_intern_id()::text
  );

drop policy if exists "admins manage storage" on storage.objects;
create policy "admins manage storage"
  on storage.objects for all to authenticated
  using (bucket_id = 'intern-documents')
  with check (bucket_id = 'intern-documents');
