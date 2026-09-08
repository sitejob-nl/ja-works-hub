-- Synthetic Storage shim for isolated intake QA, never for production.
-- Mirrors only the columns the intake migration and its policies rely on:
-- bucket registration, the object path and the metadata Storage writes back.
CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL REFERENCES storage.buckets(id),
  name text NOT NULL,
  owner_id text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (bucket_id, name)
);

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON storage.objects FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT ON storage.objects TO authenticated;
GRANT SELECT ON storage.buckets TO authenticated;
