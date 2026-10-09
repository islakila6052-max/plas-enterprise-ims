# 2 — Flash

Sync the documented schema files to match the new migration from Task H3.

---

## Task F3 — Update RLS policy block in `DATABASE_SCHEMA.sql`

**File:** `DATABASE_SCHEMA.sql`

Delete lines 517–536 (the two supervisor policies: `"supervisor reads assigned interns"` and `"supervisor manages assigned interns"`).

Insert in their place:

```sql
-- Supervisor may READ assigned interns or interns they created.
create policy "supervisor reads assigned interns"
  on public.interns for select to authenticated
  using (
    supervisor_id = public.current_supervisor_id()
    or created_by = auth.uid()
  );

-- Supervisor may UPDATE assigned interns only (no INSERT).
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
create policy "supervisor deletes assigned interns"
  on public.interns for delete to authenticated
  using (
    supervisor_id = public.current_supervisor_id()
  );
```

---

## Task F4 — Update RLS policy block in `0006_rbac_hardening.sql`

**File:** `supabase/migrations/0006_rbac_hardening.sql`

Delete lines 76–92 (the two supervisor policies for `public.interns`).

Insert in their place:

```sql
-- Supervisor may READ assigned interns.
create policy "supervisor reads assigned interns"
  on public.interns for select to authenticated
  using (supervisor_id = public.current_supervisor_id());

-- Supervisor may UPDATE assigned interns only (no INSERT).
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
create policy "supervisor deletes assigned interns"
  on public.interns for delete to authenticated
  using (
    supervisor_id = public.current_supervisor_id()
  );
```
