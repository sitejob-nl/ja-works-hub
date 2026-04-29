-- Carerix-import zet source='carerix' om migratie-documenten te kunnen
-- onderscheiden van native upload/whatsapp/portaal/systeem-bronnen.
-- Zonder deze uitbreiding faalde de runDocumentsPage-runner met
-- documents_source_check op elke insert.

ALTER TABLE public.documents DROP CONSTRAINT documents_source_check;
ALTER TABLE public.documents
  ADD CONSTRAINT documents_source_check
  CHECK (source = ANY (ARRAY['upload', 'whatsapp', 'portaal', 'systeem', 'carerix']));
