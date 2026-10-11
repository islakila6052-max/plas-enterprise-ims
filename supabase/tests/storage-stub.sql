-- supabase/tests/storage-stub.sql
-- Test-only stand-in for the tables the Supabase Storage service creates.
-- The migrations create buckets and storage policies, so these must exist.
-- The tests do not exercise storage.
create table if not exists storage.buckets (
  id text primary key,
  name text,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
  language sql immutable
  as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;

-- In hosted Supabase the postgres role can manage buckets and object policies.
alter table storage.buckets owner to postgres;
alter table storage.objects owner to postgres;
alter function storage.foldername(text) owner to postgres;
grant usage, create on schema storage to postgres;
