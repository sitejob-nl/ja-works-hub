
-- Drop existing overly permissive storage policies
DROP POLICY IF EXISTS "Authenticated users can upload documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can view own org documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete documents" ON storage.objects;

-- Tenant-isolated upload policy: only allow uploading to own org folder
CREATE POLICY "Tenant upload documents"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'documents'
  AND (storage.foldername(name))[1] = (SELECT organization_id::text FROM public.profiles WHERE id = auth.uid())
);

-- Tenant-isolated view policy: only allow viewing own org documents
CREATE POLICY "Tenant view documents"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'documents'
  AND (storage.foldername(name))[1] = (SELECT organization_id::text FROM public.profiles WHERE id = auth.uid())
);

-- Tenant-isolated delete policy: only allow deleting own org documents
CREATE POLICY "Tenant delete documents"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'documents'
  AND (storage.foldername(name))[1] = (SELECT organization_id::text FROM public.profiles WHERE id = auth.uid())
);

-- Tenant-isolated update policy
CREATE POLICY "Tenant update documents"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'documents'
  AND (storage.foldername(name))[1] = (SELECT organization_id::text FROM public.profiles WHERE id = auth.uid())
);
