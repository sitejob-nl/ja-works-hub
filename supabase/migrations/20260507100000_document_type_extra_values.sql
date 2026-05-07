-- Extra document_type enum-waarden voor klant-feedback review 30-04:
-- CV, Onboarding-formulier, Diploma, Werkfoto, Pasfoto.
-- ALTER TYPE ... ADD VALUE kan niet binnen een transactie — daarom geen BEGIN/COMMIT.

ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'cv';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'onboarding_formulier';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'diploma';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'werkfoto';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'pasfoto';
