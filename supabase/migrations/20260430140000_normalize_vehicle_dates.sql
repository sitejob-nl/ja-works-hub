-- Normalise vehicles date fields from RDW raw format (YYYYMMDD) to ISO (YYYY-MM-DD).
-- Both columns blijven text omdat de TypeScript-types daar op gerenderd zijn;
-- migratie naar `date` is een aparte change.

UPDATE public.vehicles
   SET apk_expiry = substring(apk_expiry, 1, 4) || '-' || substring(apk_expiry, 5, 2) || '-' || substring(apk_expiry, 7, 2)
 WHERE apk_expiry ~ '^\d{8}$';

UPDATE public.vehicles
   SET first_registration = substring(first_registration, 1, 4) || '-' || substring(first_registration, 5, 2) || '-' || substring(first_registration, 7, 2)
 WHERE first_registration ~ '^\d{8}$';
