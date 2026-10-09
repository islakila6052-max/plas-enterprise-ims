-- ============================================================================
-- 0052 - Fix text -> enum casts in the review RPCs
-- ============================================================================
-- journal_review() and document_review() validate p_status as TEXT and then
-- assign it straight to an ENUM column:
--
--     update daily_journals set status = p_status   -- status is journal_status
--
-- PostgreSQL has no implicit text -> enum cast, so the UPDATE (and therefore
-- the whole RPC) fails at runtime with:
--
--     42804: column "status" is of type journal_status
--            but expression is of type text
--
-- That made "approve/reject journal" (supervisor) and "approve/reject
-- document" (admin) unusable: the frontend surfaced the raw error and the row
-- never changed. Verified by scripts/verify-db.mjs before this migration.
--
-- The value is already restricted to a known-good set immediately above, so
-- the explicit cast cannot raise. Both functions keep their exact previous
-- behaviour otherwise (permission checks, audit of the old value, NOT NULL
-- guard), and CREATE OR REPLACE preserves the EXECUTE grants applied in 0051.
-- ============================================================================


drop function if exists public.journal_review (uuid, text, text);
create or replace function public.journal_review (
  p_journal_id uuid,
  p_status text,
  p_comment text default null)
  returns public.daily_journals
  language plpgsql
  security definer
  set search_path = public
as $function$
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
     set status            = p_status::public.journal_status,
         supervisor_comment = nullif(btrim(p_comment), ''),
         supervisor_id      = coalesce(v_sup, supervisor_id)
   where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$function$;


drop function if exists public.document_review (uuid, text);
create or replace function public.document_review (p_document_id uuid, p_status text)
  returns public.documents
  language plpgsql
  security definer
  set search_path = public
as $function$
declare
  v_row public.documents;
begin
  if p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'Invalid document status.'
      using errcode = 'check_violation';
  end if;

  -- Document review is an administrator decision (see documentService.review);
  -- supervisors only ever read documents.
  if not public.is_admin() then
    raise exception 'Only administrators may review documents.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.documents
     set status = p_status::public.document_status
   where id = p_document_id
   returning * into v_row;

  if v_row.id is null then
    raise exception 'Document not found.'
      using errcode = 'no_data_found';
  end if;

  return v_row;
end;
$function$;


-- Make sure the RPCs stay reachable from PostgREST after the recreate.
revoke execute on function public.journal_review (uuid, text, text) from public, anon;
grant  execute on function public.journal_review (uuid, text, text) to authenticated, service_role;
revoke execute on function public.document_review (uuid, text) from public, anon;
grant  execute on function public.document_review (uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
