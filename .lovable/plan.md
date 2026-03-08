

## Plan: Vacaturebank Module met Apify Integratie

### Samenvatting
Nieuwe "Vacaturebank" module die externe vacatures importeert via de Apify Career Site Job Listing API. Bevat een edge function voor de API-aanroep, een database tabel voor gecachte jobs, en een frontend pagina met filters.

### Stap 1: API Key Secret
Vraag de gebruiker om hun Apify API token op te slaan als Supabase secret `APIFY_API_TOKEN`. Dit is vereist voordat de edge function kan werken.

### Stap 2: Database Migration
Nieuwe tabel `job_listings`:
- `id` (uuid PK), `organization_id` (uuid FK, not null), `external_id` (text, not null)
- `title`, `organization_name`, `organization_url`, `organization_logo`, `url` (text)
- `locations_derived` (jsonb), `country`, `city` (text)
- `description_text` (text)
- `source` (text — ATS platform), `employment_type` (text[])
- `work_arrangement` (text — Remote/Hybrid/On-site)
- `ai_taxonomies` (text[]), `ai_key_skills` (text[])
- `ai_salary_currency` (text), `ai_salary_min`, `ai_salary_max` (numeric), `ai_salary_unit` (text)
- `date_posted` (timestamptz), `date_imported` (timestamptz default now())
- `linkedin_org_industry` (text), `linkedin_org_employees` (int)
- `raw_data` (jsonb)
- UNIQUE constraint op `(organization_id, external_id)`
- Standard tenant RLS policies

Nieuwe tabel `job_import_logs`:
- `id`, `organization_id`, `imported_at` (default now()), `total_jobs` (int), `new_jobs` (int), `filters_used` (jsonb), `status` (text)
- Standard tenant RLS

### Stap 3: Edge Function `apify-job-import`
- `supabase/functions/apify-job-import/index.ts`
- Config: `verify_jwt = false` (validates auth in code)
- Authenticates user via Authorization header, gets `organization_id` from profiles
- Accepts body: `{ timeRange, limit, locationSearch, aiTaxonomiesFilter, ats, aiWorkArrangementFilter }`
- Calls Apify REST API: `POST https://api.apify.com/v2/acts/fantastic-jobs~career-site-job-listing-api/run-sync-get-dataset-items?token=APIFY_API_TOKEN`
- Maps results → upserts into `job_listings` (on conflict `organization_id, external_id` do update)
- Logs import to `job_import_logs`
- Returns `{ total, new_count }`

### Stap 4: Frontend — `src/pages/Vacaturebank.tsx`
- Route: `/vacaturebank`
- Header met statistieken (totaal vacatures, landen, bronnen)
- "Importeren" button opent Sheet met filter-opties:
  - Tijdsperiode (1h/24h/7d), Max aantal (10-5000)
  - Locatie zoeken (text input), Branche/taxonomie (multi-select), ATS platform (multi-select), Werkarrangement (select)
- Zoekbare/filterbare tabel met kolommen: Titel, Bedrijf, Locatie, Branche, ATS, Werkarrangement, Datum, Link
- Client-side filters op gecachte data + zoekbalk
- Paginatie (25 per pagina)

### Stap 5: Routing & Sidebar
- `App.tsx`: route `/vacaturebank` → `Vacaturebank`
- `AppSidebar.tsx`: nieuw nav item `{ label: 'Vacaturebank', icon: Search, path: '/vacaturebank', moduleKey: 'vacaturebank' }`
- `SuperAdminPlans.tsx`: voeg `'vacaturebank'` toe aan `ALL_MODULES`

### Bestanden
| Actie | Bestand |
|-------|---------|
| Create | `src/pages/Vacaturebank.tsx` |
| Create | `supabase/functions/apify-job-import/index.ts` |
| Create | DB migration (job_listings + job_import_logs) |
| Edit | `src/App.tsx` |
| Edit | `src/components/layout/AppSidebar.tsx` |
| Edit | `src/pages/superadmin/SuperAdminPlans.tsx` |
| Edit | `supabase/config.toml` |

