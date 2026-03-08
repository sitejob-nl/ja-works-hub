

# Fase 2: CV Tool + Dynamische Compliance

## Deel 1: CV Tool met JA Werkt Huisstijl

### Nieuwe bestanden

**1. Edge Function: `supabase/functions/cv-rewrite/index.ts`**
- Accepts candidate data + target language (nl/en/pl) + anonymous flag
- Uses Lovable AI (gemini-3-flash-preview) with tool calling to return structured CV sections:
  - `{ summary, experience, skills, education, languages }`
- System prompt instructs AI to rewrite in professional recruiter style, in the target language
- If anonymous: strips name, replaces with "Kandidaat [ref]", removes photo/contact info

**2. Page: `src/pages/CvTool.tsx`**
- Accessible from candidate detail page ("CV Genereren" button) and from sidebar
- Route: `/cv-tool/:candidateId`
- Layout:
  - Left panel: settings (language selector NL/EN/PL, anonymous toggle, AI rewrite button)
  - Right panel: live preview of the CV in JA Werkt template
- Fetches candidate data (profile, skills, languages, certifications, placements history, documents)
- "AI Herschrijven" button calls the edge function, populates the preview
- Manual edit: all sections are editable text areas before export
- "Download PDF" button: uses browser print-to-PDF (`window.print()`) with a print-specific CSS stylesheet
- Match score badge if candidate has active matches

**3. Component: `src/components/cv/CvTemplate.tsx`**
- JA Werkt branded template rendered as HTML (print-friendly)
- Header: company logo (from organization), candidate name (or "Kandidaat [ref]" if anonymous)
- Sections: Samenvatting, Werkervaring, Vaardigheden, Talen, Certificaten, Opleiding
- Color scheme uses CSS variables from the organization's accent color
- `@media print` styles for clean PDF output
- Props: `{ candidate, sections, anonymous, language, orgLogo, orgName }`

**4. Component: `src/components/cv/CvSettingsPanel.tsx`**
- Language picker (NL/EN/PL)
- Anonymous toggle
- AI rewrite button with loading state
- Section visibility toggles

### Changes to existing files

- **`src/pages/CandidateDetail.tsx`**: Add "CV Genereren" button next to "Bewerken"
- **`src/App.tsx`**: Add route `/cv-tool/:candidateId`
- **`src/components/layout/AppSidebar.tsx`**: No sidebar entry needed (accessed from candidate detail)
- **`supabase/config.toml`**: Add `[functions.cv-rewrite]` with `verify_jwt = false`

### Data flow
```text
CandidateDetail → "CV Genereren" → /cv-tool/:candidateId
  → Load candidate + placements + documents
  → User clicks "AI Herschrijven"
  → Edge function rewrites sections in target language
  → Preview updates live
  → User edits if needed
  → "Download PDF" triggers window.print()
```

---

## Deel 2: Dynamische Compliance Formulieren

### Database migration

New table: `compliance_rules`
```sql
create table public.compliance_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  name text not null,
  sector text,                    -- e.g. 'bouw', 'logistiek', 'agri'
  contract_type text,             -- e.g. 'uitzend', 'detachering'
  required_documents text[] not null default '{}',  -- document_type values
  required_fields text[] not null default '{}',     -- candidate field names
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.compliance_rules enable row level security;
-- Standard tenant RLS policies (select/insert/update/delete)
```

### New files

**5. Component: `src/components/settings/ComplianceRulesSettings.tsx`**
- CRUD interface for compliance rules within Settings page
- Form fields: name, sector, contract_type, required_documents (multi-select from document_type enum), required_fields (multi-select: bsn, iban, date_of_birth, nationality, address), description
- Presets button: "Bouw" preset (adds VCA, A1-verklaring requirements), "Logistiek" preset (adds rijbewijs), "Standaard" preset (current hardcoded set)

**6. Updated: `src/hooks/useComplianceCheck.ts`**
- Accept optional `sector` and `contractType` parameters
- Query `compliance_rules` matching sector/contract_type for the organization
- If rules exist: use those instead of the hardcoded checks
- If no rules: fall back to current hardcoded behavior (id_bewijs, contract, reglement, bsn, iban, date_of_birth)
- Return `{ passed, issues, rulesApplied: string }` so UI can show which ruleset was used

### Changes to existing files

- **`src/pages/Settings.tsx`**: Add "Compliance regels" tab with ComplianceRulesSettings
- **`src/components/vacancies/PlacementSheet.tsx`**: Pass vacancy's sector/contract info to checkCompliance
- **`src/components/employees/tabs/EmployeeOnboardingTab.tsx`**: Load applicable compliance rules to dynamically build the checklist instead of using the hardcoded `checkItems` array

### Flow
```text
Settings → Compliance Regels tab → CRUD rules per sector
PlacementSheet → checkCompliance(candidateId, { sector, contractType })
  → Queries compliance_rules for matching sector
  → Validates candidate against those rules
  → Shows ComplianceWarningDialog with specific issues
```

---

## Summary of all changes

| # | File | Action |
|---|------|--------|
| 1 | `supabase/functions/cv-rewrite/index.ts` | Create |
| 2 | `src/pages/CvTool.tsx` | Create |
| 3 | `src/components/cv/CvTemplate.tsx` | Create |
| 4 | `src/components/cv/CvSettingsPanel.tsx` | Create |
| 5 | `src/components/settings/ComplianceRulesSettings.tsx` | Create |
| 6 | `src/hooks/useComplianceCheck.ts` | Update (dynamic rules) |
| 7 | `src/pages/CandidateDetail.tsx` | Add CV button |
| 8 | `src/pages/Settings.tsx` | Add Compliance tab |
| 9 | `src/App.tsx` | Add CV route |
| 10 | `src/components/employees/tabs/EmployeeOnboardingTab.tsx` | Dynamic checklist |
| 11 | `supabase/config.toml` | Add cv-rewrite function |
| 12 | Migration SQL | Create compliance_rules table |

