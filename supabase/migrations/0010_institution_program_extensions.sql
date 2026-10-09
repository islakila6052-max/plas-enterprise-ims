-- ============================================================================
-- 0010 — Extend institutions & programs, link interns to programs
-- ============================================================================
-- Idempotent. Extends the schema created by 0009 with the fields required by
-- the Institution Management module and links interns to an institution/program
-- so intern statistics can be computed automatically.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- institutions: contact + logo fields
-- ----------------------------------------------------------------------------
alter table public.institutions
  add column if not exists contact_person text,
  add column if not exists contact_number text,
  add column if not exists email           text,
  add column if not exists logo_url        text;

-- ----------------------------------------------------------------------------
-- programs: rename hours_to_render -> required_hours, add program_code
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'programs'
      and column_name  = 'hours_to_render'
  ) then
    alter table public.programs rename column hours_to_render to required_hours;
  end if;
end $$;

alter table public.programs
  add column if not exists program_code text;

-- Unique program_code (when provided) so duplicates are rejected at the DB level.
create unique index if not exists programs_program_code_unique
  on public.programs (program_code)
  where program_code is not null and program_code <> '';

-- ----------------------------------------------------------------------------
-- interns: link to institution + program
-- ----------------------------------------------------------------------------
alter table public.interns
  add column if not exists institution_id uuid
    references public.institutions (institution_id) on delete set null,
  add column if not exists program_id uuid
    references public.programs (program_id) on delete set null;

create index if not exists idx_interns_institution on public.interns (institution_id);
create index if not exists idx_interns_program     on public.interns (program_id);

-- Reload PostgREST schema cache so the new columns/relationships are visible.
notify pgrst, 'reload schema';
