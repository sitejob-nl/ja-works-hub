-- 05-14 recruitment intake funnel: afgeschermde lead-status voor publieke aanmeldingen.
ALTER TYPE public.candidate_status ADD VALUE IF NOT EXISTS 'lead';
