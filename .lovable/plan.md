

## Plan: Volledige Apify-integratie afronden

Na het doornemen van de volledige API-documentatie zijn er twee categorieën verbeteringen nodig:

### 1. Input filters: correcte waarden gebruiken

De huidige code gebruikt **verkeerde opties** voor sommige filters:

| Filter | Huidig (fout) | Correct (per API docs) |
|--------|--------------|----------------------|
| `EMPLOYMENT_TYPES` | Full-time, Part-time, Contract, Internship, Temporary | `FULL_TIME`, `PART_TIME`, `CONTRACTOR`, `TEMPORARY`, `INTERN`, `VOLUNTEER`, `PER_DIEM`, `OTHER` |
| `EXPERIENCE_LEVELS` | Internship, Entry level, Associate, etc. | `0-2`, `2-5`, `5-10`, `10+` |
| `ATS_OPTIONS` | 18 items | Alle 54 ATS platforms toevoegen |
| `TAXONOMY_OPTIONS` | 18 items | Alle 33 taxonomies toevoegen |

### 2. Output: meer velden opslaan en tonen

De API retourneert veel meer velden dan we opslaan. We moeten:

**A. Database migratie** — Nieuwe kolommen toevoegen aan `job_listings`:

- `ai_experience_level` (text) — 0-2, 2-5, 5-10, 10+
- `ai_employment_type` (text[]) — FULL_TIME etc.
- `ai_benefits` (text[])
- `ai_core_responsibilities` (text)
- `ai_requirements_summary` (text)
- `ai_education_requirements` (text[])
- `ai_keywords` (text[])
- `ai_visa_sponsorship` (boolean)
- `ai_hiring_manager_name` (text)
- `ai_hiring_manager_email` (text)
- `ai_working_hours` (integer)
- `domain_derived` (text)
- `source_type` (text) — ats/career-site
- `remote_derived` (boolean)
- `linkedin_org_url` (text)
- `linkedin_org_type` (text)
- `linkedin_org_headquarters` (text)
- `linkedin_org_description` (text)
- `linkedin_org_specialties` (text[])
- `linkedin_org_founded_date` (text)
- `linkedin_org_slug` (text)
- `linkedin_org_followers` (integer)
- `linkedin_org_size` (text)
- `linkedin_org_recruitment_agency` (boolean)

**B. Edge function** — Map alle nieuwe velden in de upsert rows.

**C. Detail slide-over** — Alle nieuwe data tonen in gegroepeerde secties:
- AI Samenvatting (verantwoordelijkheden, vereisten, opleiding)
- AI Details (ervaringsniveau, werkuren, visum, benefits, hiring manager)
- LinkedIn Bedrijfsdata (alle LI velden gegroepeerd)
- Huidige secties (salaris, skills, taxonomies, beschrijving, meta) blijven

### 3. Wijzigingen per bestand

**`supabase/migrations/` — Nieuwe migratie**: ALTER TABLE met ~24 nieuwe kolommen

**`supabase/functions/apify-job-import/index.ts`**: Uitbreiden van de row-mapping met alle nieuwe velden

**`src/pages/Vacaturebank.tsx`**:
- Fix `ATS_OPTIONS` naar alle 54 platforms
- Fix `TAXONOMY_OPTIONS` naar alle 33 opties
- Fix `EMPLOYMENT_TYPES` naar correcte API waarden (`FULL_TIME` etc.)
- Fix `EXPERIENCE_LEVELS` naar `0-2`, `2-5`, `5-10`, `10+`
- Detail slide-over uitbreiden met nieuwe data secties

