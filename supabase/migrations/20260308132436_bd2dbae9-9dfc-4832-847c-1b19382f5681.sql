
INSERT INTO storage.buckets (id, name, public) VALUES ('organization-logos', 'organization-logos', true);

CREATE POLICY "Authenticated users can upload logos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'organization-logos');

CREATE POLICY "Public read access for logos"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'organization-logos');

CREATE POLICY "Authenticated users can update logos"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'organization-logos');

CREATE POLICY "Authenticated users can delete logos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'organization-logos');
