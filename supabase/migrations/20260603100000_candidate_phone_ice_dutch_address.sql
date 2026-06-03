-- Review 27 mei: extra kandidaatvelden.
--
-- 1. Twee telefoonnummers: bestaande `phone` blijft het EU/internationale nummer
--    (gebruikt door WhatsApp/campagnes/tel:), nieuw `phone_nl` is het Nederlandse nummer.
-- 2. ICE-noodcontact (naam + telefoon).
-- 3. `has_dutch_address`: zelfgerapporteerd in de profiellink, zodat de backoffice ziet of
--    de kandidaat al een (vast) adres in Nederland heeft.
ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS phone_nl text,
  ADD COLUMN IF NOT EXISTS emergency_contact_name text,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone text,
  ADD COLUMN IF NOT EXISTS has_dutch_address boolean NOT NULL DEFAULT false;

-- Backfill: bestaande kandidaten met een NL-adres krijgen has_dutch_address = true,
-- zodat de vlag meteen klopt met reeds bekende adresdata.
UPDATE public.candidates
SET has_dutch_address = true
WHERE has_dutch_address = false
  AND coalesce(address_street, '') <> ''
  AND coalesce(address_city, '') <> ''
  AND (address_country IS NULL OR address_country ILIKE 'nederland%' OR address_country ILIKE 'netherlands%' OR address_country ILIKE 'nl');
