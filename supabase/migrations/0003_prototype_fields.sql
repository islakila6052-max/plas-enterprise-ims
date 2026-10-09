-- ============================================================================
-- Internship Management System — Prototype fields
-- ============================================================================
-- Adds columns the frontend prototype relies on but the initial schema lacked:
--   * announcements.pinned  — pin/unpin + pinned-first sorting in the UI
--   * documents.file_name   — original file name for upload/download labels
-- Safe to run on an existing project (uses `if not exists`).

-- ---------------------------------------------------------------------------
-- announcements: pin support
-- ---------------------------------------------------------------------------
alter table public.announcements
  add column if not exists pinned boolean not null default false;

create index if not exists announcements_pinned_idx
  on public.announcements (pinned);

-- ---------------------------------------------------------------------------
-- documents: original file name
-- ---------------------------------------------------------------------------
alter table public.documents
  add column if not exists file_name text;
