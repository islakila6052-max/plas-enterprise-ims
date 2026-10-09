-- ============================================================================
-- 0017 — Allow users to write their own audit_log rows
-- ============================================================================
-- DIAGNOSIS: audit_logs RLS was admin-only for both read and write.
-- Every intern/supervisor action that calls recordAudit() (time in/out,
-- journal submit, evaluation create, etc.) therefore failed its INSERT
-- with a row-level-security violation. recordAudit() swallows the error,
-- so the primary action still succeeded but NO audit trail was recorded
-- for non-admins.
--
-- FIX: keep read admin-only, but allow any authenticated user to
-- INSERT a row where user_id = auth.uid() (their own row). Admins
-- retain full read/write. This matches the "append-only activity
-- trail" intent without opening other users' rows.
-- ============================================================================

drop policy if exists "admins write audit logs" on public.audit_logs;
create policy "users write own audit logs"
  on public.audit_logs for insert to authenticated
  with check (user_id = auth.uid());

-- Reload PostgREST schema cache.
notify pgrst, 'reload schema';
