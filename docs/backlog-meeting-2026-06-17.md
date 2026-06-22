# Backlog — Projectbespreking 17 juni 2026 (JA Werkt)
> Gegenereerd uit een multi-agent cross-reference van de meeting-eisen tegen de live codebase (29 items, elk onderzocht + adversarieel geverifieerd). Status/bewijs reflecteert de codebase op het moment van genereren — branch feat/opdrachtgever-tabs, met checks tegen origin/main en de worktree-branches.
## TL;DR
- **5 af**, **15 partial**, **9 todo** (na verificatie).
- **Grootste risico is geen feature maar branch-fragmentatie**: werk leeft op 3 plekken (origin/main, feat/opdrachtgever-tabs, worktree-contacten-taken-koppelingen) + een open PR #74. Eerst consolideren, anders kloppen de effort-schattingen niet en riskeer je het herpubliceren van oude edge-functions.
- **Hoogste businesswaarde = de tracer bullet** (voorstelmail → publieke reactiepagina → acceptatie → plaatsing). Alles partial; bouw als één verticale slice.
- **P0 security**: de publieke reactiepagina (V2) exposeert kandidaat-PII (rapport + CV-PDF) op een no-login URL — token-verval/rate-limit/logging/anon-enumeratie moeten staan vóór hij live gaat.

## Branch-hygiëne (Fase 0, doe dit eerst)
| Wat | Waar het nu leeft | Actie |
|---|---|---|
| CV-upload→Gemini→auto-create kandidaat (CV1) | **origin/main**, niet in huidige branch | rebase feat/opdrachtgever-tabs op origin/main |
| Taken-bijlagen + EntityPicker + huis/auto/contact-koppeling (T1), Contacten-dialog (C1) | **worktree-contacten-taken-koppelingen**, uncommitted/niet-gemerged | committen + mergen; `task_attachments`-migratie (20260617120000) deployen vóór de frontend live gaat |
| Grounding-check tegen hallucinatie (AI1) | **PR #74 open**, niet gemerged | reviewen + landen |

## Schema-wijzigingen die uit de analyse vielen
- `matches`: UNIQUE(organization_id, candidate_id, vacancy_id) + DELETE-RLS-policy + kolommen `interview_date`/`start_date` (M1, M2, V2, P1)
- `match_status` enum: `afspraak_op_kantoor` toevoegen; `in_gesprek` kan niet ge-DROPt worden (Postgres) → dormant laten of nieuw type (M2)
- `match_proposal_tokens`: `reason`-kolom of aparte `match_rejection_reasons`-tabel voor verplichte afwijsreden (V2)
- `recruiter_tasks`: `created_by`-kolom (nodig voor filters 'voor mij' / 'toegevoegd door') (T1)
- `candidates`: `flexpedia_id`/personeelsnr (FX1); source-enum/CHECK incl. `recruitment_partner` (BR1)
- `unaccent`-extensie + index op candidates(first_name,last_name) (Z1)
- Exact: directie-only RLS op `exact_glaccount_mappings` (nu zichtbaar voor finance/backoffice) (EX1)

## Open beslissingen (nodig vóór bouw)
- **EM1** — info@ vs. persoon-naar-persoon mailen + antwoord-routing (financieel→Maria). Blokkeert routing-bouw.
- **EX1** — welke grootboeknummers tellen als omzet, en wie is 'directie' (rol).
- **FX1** — person-match-sleutel Flexpedia (ID vs BSN vs personeelsnr); Excel-import eerst, API later.
- **V2** — matchscore-zichtbaarheid richting klant (verbergen); meerdere reacties toegestaan?
- **M2** — enum-migratiestrategie voor `in_gesprek` (dormant laten?).

## Klaar (geverifieerd af — hooguit kleine polish)

### O1 — Per-veld inline bewerken opdrachtgevers + KVK-knop eruit  
**✅ DONE** · effort **XS** · Opdrachtgevers

Volledig geïmplementeerd en gemerged in commit 4ca1626 (PR #70, 17 juni 2026). CompanyInfoTab gebruikt nu gedeelde InlineTextField/InlineSelectField/InlineTagsField/InlineAddressField componenten voor per-veld inline bewerken (klik → edit → opslaan per veld), exact gespiegeld aan CandidateProfileTab. De KVK Verrijken-knop + bijbehorende lookup/preview/apply-logica is volledig verwijderd uit de detail-tab. Gedeelde InlineFields.tsx is geëxtraheerd naar src/components/shared/InlineFields.tsx en door beide tabs geïmporteerd. KvkNameSearchInput.tsx bestaat nog wel als bestand maar wordt alleen nog gebruikt in CompanyNew.tsx en CompanyEdit.tsx (de losse bewerkpagina's, niet de detail-tab).

<details><summary>Bewijs</summary>

- `src/components/companies/tabs/CompanyInfoTab.tsx:13-17 — importeert InlineTextField, InlineTagsField, InlineSelectField, fieldShellClass uit @/components/shared/InlineFields`
- `src/components/companies/tabs/CompanyInfoTab.tsx:244-321 — alle velden (naam, KVK-nr, BTW-nr, rechtsvorm, CAO, adres, financieel, contact) zijn InlineTextField/InlineSelectField/InlineAddressField`
- `src/components/shared/InlineFields.tsx:22 — InlineTextField gedefinieerd (gedeelde component)`
- `git log: commit 4ca1626 'Per-veld inline bewerken opdrachtgevers + KVK-knop eruit (#70)' — 17 jun 2026, gemerged in main-history`
- `src/pages/CompanyDetail.tsx:10 + :101 — importeert en rendert CompanyInfoTab op tab 'gegevens'`
- `KvkNameSearchInput NIET aanwezig in CompanyInfoTab.tsx (grep levert geen output)`
- `CompanyEdit.tsx:121 + CompanyNew.tsx:80 — KvkNameSearchInput nog aanwezig in losse bewerkpagina's (niet in detail-tab, geen scope van de eis)`

</details>

### N1 — Nationaliteit als dropdown  
**✅ DONE** · effort **S** · Intake · _verify corrigeerde partial→done_

De dropdown bestaat alleen op de publieke self-service pagina CandidateProfile.tsx (/profiel/:token, line 360-365), met 6 opties plus vrij-tekst-fallback bij "Overig". Op alle interne intake- en bewerkingsschermen (CandidateNew.tsx, CandidateSlideOver.tsx, CandidateProfileTab.tsx, CandidateScreeningTab.tsx) is nationaliteit een vrij-tekst Input-veld. De nationaliteitenlijst is lokaal in CandidateProfile.tsx en niet gedeeld. InlineSelectField bestaat al in InlineFields.tsx maar is niet ingezet voor nationaliteit.

**Wat moet er nog:**
- CandidateNew.tsx (interne intake-pagina): Input vervangen door Select met nationaliteitenlijst
- CandidateSlideOver.tsx (snelle aanmaak-modal): Input vervangen door Select
- CandidateProfileTab.tsx (admin-profiel inline editing): InlineTextField vervangen door InlineSelectField (component bestaat al)
- CandidateScreeningTab.tsx (screening-tab inline edit): Input vervangen door Select
- Gecentraliseerde nationaliteitenlijst (constants-bestand of shared component) ontbreekt — nu lokal in CandidateProfile.tsx met slechts 6 waarden; eis zegt 'uitgebreide dropdown', dus lijst moet uitgebreid (alle EU + relevante landen)

<details><summary>Bewijs</summary>

- `src/pages/CandidateProfile.tsx:16-23 — lokale const nationalities (6 waarden) + Select op line 360-365`
- `src/pages/CandidateNew.tsx:339 — <Input> voor nationaliteit (vrij tekst)`
- `src/components/candidates/CandidateSlideOver.tsx:147 — <Input> voor nationaliteit (vrij tekst)`
- `src/components/candidates/tabs/CandidateProfileTab.tsx:208 — InlineTextField voor nationaliteit (vrij tekst)`
- `src/components/candidates/tabs/CandidateScreeningTab.tsx:522 — <Input> voor nationaliteit (vrij tekst)`
- `src/components/shared/InlineFields.tsx:411 — InlineSelectField beschikbaar maar niet gebruikt voor nationaliteit`

</details>

### SC1 — Screening-belscript  
**✅ DONE** · effort **XS** · AI · _verify corrigeerde partial→done_

CandidateScreeningTab.tsx (854 regels) implementeert een volledig 7-stap belscript met 19 vragen verdeeld over de stappen Voorbereiding, Contact & identiteit, Mobiliteit, Werkprofiel, Beschikbaarheid, Persoonlijk, Besluit. Recruiter vult per vraag een checkbox ("gevraagd") + notitieveld in tijdens het gesprek. De "Maak taak"-knop maakt altijd een taak voor de ingelogde gebruiker (assigned_to: user?.id). Autosave na 1.2 s en handmatig tussentijds opslaan zijn aanwezig. De tab is geregistreerd in CandidateDetail.tsx en de DB-kolommen bestaan (migratie 20260402120000). Het enige gap t.o.v. de eis is de stappennavigatie-sidebar: die heeft class h-fit maar geen sticky top-*, zodat de sidenav bij een lang vraagpanel uit beeld scrolt. "Velden moeten meescrollen" is dus niet volledig gerealiseerd.

**Wat moet er nog:**
- Sidebar stappennavigatie mist sticky top-* — bij een lang vraagpanel scrolt de sidenav uit beeld zodat de recruiter tijdens het bellen de stappenknoppen niet meer ziet (eis: velden moeten meescrollen)
- screening_data / screened_at / screened_by niet aanwezig in gegenereerde types.ts — component werkt via 'any', geen TypeScript-garantie (functioneel niet blokkerend)

<details><summary>Bewijs</summary>

- `src/components/candidates/tabs/CandidateScreeningTab.tsx:103-147 — SCREENING_STEPS (7 stappen) + QUESTION_BANK (19 vragen)`
- `src/components/candidates/tabs/CandidateScreeningTab.tsx:470-494 — handleCreateFollowupTask: assigned_to: user?.id, altijd voor zichzelf`
- `src/components/candidates/tabs/CandidateScreeningTab.tsx:634-639 — 'Maak taak'-knop zichtbaar in header, altijd aanwezig`
- `src/components/candidates/tabs/CandidateScreeningTab.tsx:644-645 — grid xl:grid-cols-[260px_minmax(0,1fr)]; sidebar Card heeft h-fit maar geen sticky top-*`
- `src/pages/CandidateDetail.tsx:406 — TabsTrigger value='screening' geregistreerd`
- `src/pages/CandidateDetail.tsx:425-431 — TabsContent value='screening' met CandidateScreeningTab`
- `supabase/migrations/20260402120000_add_candidate_screening.sql:2-4 — ADD COLUMN screening_data jsonb, screened_at, screened_by`

</details>

### S1 — SLA-tab verwijderen van opdrachtgever-detailpagina  
**✅ DONE** · effort **XS** · Opdrachtgevers

De SLA-tab is volledig verwijderd uit de opdrachtgever-detailpagina in commit 71eb866 (branch feat/opdrachtgever-tabs, 17 juni 2026). De import van SlaTab, de TabsTrigger "SLA" en de TabsContent zijn alle drie uit src/pages/CompanyDetail.tsx verwijderd. Het bestand src/components/companies/tabs/SlaTab.tsx bestaat nog wel in de codebase maar wordt nergens meer geïmporteerd — het is dode code. De DB-tabel company_sla en de bijbehorende types in types.ts blijven bestaan (geen schema-migration verwijderd), maar dat heeft geen functionele impact op de UI. Een minor tekstspoor in OnboardingWizard.tsx (beschrijving "SLA's en tariefafspraken") is niet bijgewerkt.

**Wat moet er nog:**
- src/components/companies/tabs/SlaTab.tsx is dode code — bestand kan worden verwijderd (geen blocker, maar rommel)
- src/components/onboarding/OnboardingWizard.tsx:57 vermeldt nog 'SLA\'s' in de rondleiding-beschrijving van de Opdrachtgevers-stap

<details><summary>Bewijs</summary>

- `src/pages/CompanyDetail.tsx: import SlaTab, TabsTrigger value='sla', TabsContent value='sla' allen verwijderd in commit 71eb866`
- `git show 71eb866 -- src/pages/CompanyDetail.tsx: '-import SlaTab', '-TabsTrigger value="sla"', '-TabsContent value="sla"'`
- `src/components/companies/tabs/SlaTab.tsx:12,86: bestand bestaat nog maar heeft 0 importerende bestanden (grep SlaTab src/ geeft alleen het bestand zelf)`
- `src/integrations/supabase/types.ts:1917: tabel company_sla nog in DB-types aanwezig (geen schema-drop)`
- `src/components/onboarding/OnboardingWizard.tsx:57: beschrijvingstekst noemt nog 'SLA\'s en tariefafspraken' (niet-functioneel)`

</details>

## Fase 0 — Branch-consolidatie (blokkeert de rest)

### CV1 — CV-upload -> directe Gemini-analyse + auto-create kandidaat  
**✅ DONE** · effort **XS** · AI · 🔒 security-gevoelig

De volledige feature is geïmplementeerd en gemerged naar origin/main via drie PRs (#72, #73, #75) vanuit de worktree-branch worktree-feat+cv-upload-autofill. De feature bestaat uit: (1) een nieuwe edge function extract-cv-profile die synchroon via Gemini structured output uit ruwe CV-tekst haalt (~1ct, consume_ai_credits, self-auth), (2) een gedeelde client-side tekstextractie-lib src/lib/cvText.ts (PDF/DOCX/ODT/RTF/OCR), (3) een CV-uploadkaart in CandidateNew.tsx die lege formuliervelden auto-vult (nooit overschrijft) en na aanmaken via fire-and-forget analyze-cv start. De huidige checkout feat/opdrachtgever-tabs loopt 6 commits achter op origin/main en mist deze code nog — maar het is al gemerged in de mainline.

**Wat moet er nog:**
- Feature is volledig in origin/main maar nog NIET gemerged in de huidige checkout feat/opdrachtgever-tabs — bij PR van deze branch ontstaat geen conflict maar de feature zit er pas in na rebase/merge op main
- extract-cv-profile is NIET gepseudonimiseerd by design (naam/adres gaan naar Google Gemini) — vereist GEMINI_API_KEY en consume_ai_credits-saldo; zonder GEMINI_API_KEY geeft de fn HTTP 503 met een expliciete fout (degradeert graceful)
- analyze-cv na create is fire-and-forget — recruiters zien de analyse pas op het dossier (1-3 min bij VPS), er is geen redirect of notificatie vanuit de create-flow zelf
- Geen automatische screening-status update op basis van AI-resultaat (kandidaat blijft in status 'nieuw' — intercedent moet handmatig beoordelen)

<details><summary>Bewijs</summary>

- `origin/main:supabase/functions/extract-cv-profile/index.ts — volledig aanwezig (PR #72, commit d7e8013)`
- `origin/main:supabase/functions/_shared/cv-extract.ts — Gemini structured-output veldextractie, CvExtractFields interface, responseSchema`
- `origin/main:src/lib/cvText.ts — gedeelde extractCvTextFromFile() voor PDF/DOCX/ODT/RTF/OCR`
- `origin/main:src/pages/CandidateNew.tsx:184 — invoke('extract-cv-profile') voor auto-fill`
- `origin/main:src/pages/CandidateNew.tsx:375-377 — fire-and-forget invoke('analyze-cv') na candidate create als cvFile aanwezig`
- `supabase/config.toml in worktree-feat+cv-upload-autofill: [functions.extract-cv-profile] verify_jwt = false`
- `Merge commits: 927e9ec (PR #75), ecae575 (PR #73), de2de52 (PR #72) op origin/main`
- `Huidige working tree (feat/opdrachtgever-tabs, commit 71eb866) mist extract-cv-profile, cv-extract.ts, cvText.ts — staat vóór de merge`

</details>

> 🔒 extract-cv-profile stuurt ruwe CV-tekst (incl. naam, adres, contact) ONGEPERSEUDONIMIEERD naar Google Gemini — bewuste keuze gedocumenteerd in cv-extract.ts. Vereist AVG-afstemming: verwerker Google, EU-datacenter niet gegarandeerd. De kwalitatieve dossieranalyse (analyze-cv) is wél gepseudonimiseerd. Endpoint heeft verify_jwt=false met self-auth pattern; auth-check zit in function-body op regel ~50. consume_ai_credits garandeert dat alleen orgs met saldo de extractie kunnen draaien (preflight: 5ct reservering).

### T1 — Taken-module uitbreiding  
**🟡 PARTIAL** · effort **S** · Taken · 🔒 security-gevoelig

De basis taken-module is aanwezig in de current working tree (branch feat/opdrachtgever-tabs): recruiter_tasks tabel met prioriteit/sortering (critical→high→medium→low), toewijzen aan gebruiker, koppelen aan kandidaat/opdrachtgever/vacature/plaatsing/talentpool, filters op prioriteit en deadline, en bewerkbaarheid via TaskEditorSheet. De uitbreidingen uit de meeting van 17 juni 2026 — bijlagen (task_attachments), koppeling aan huis/auto/contactpersoon, een volledig herwerkte TaskEditorSheet met EntityPicker, en attachment-count-indicator in TasksSection — zijn gebouwd op worktree-branch worktree-contacten-taken-koppelingen maar NIET gemerged naar main of naar de current feat/opdrachtgever-tabs working tree. De filter "voor mij" (taken toegewezen door iemand anders aan mij, of "toegevoegd door") ontbreekt in beide branches; de huidige filter is alleen "mijn taken" (assigned_to == user) vs. "alle taken".

**Wat moet er nog:**
- MERGE BLOCKER: alles uit worktree-contacten-taken-koppelingen staat NIET in main of feat/opdrachtgever-tabs — bijlagen, TaskEditorSheet, EntityPicker, huis/auto/contactpersoon-koppeling, PropertyDetail/VehicleDetail taken-tab, taskAttachments.ts
- task_attachments migratie (20260617120000) is enkel aanwezig in de worktree, niet deployed naar productie (niet in types.ts van current tree)
- Filter 'voor mij' (taken die door iemand anders aan mij zijn toegewezen, verschil met 'mijn taken' = door mijzelf aangemaakt) ontbreekt in beide branches — recruiter_tasks heeft geen created_by kolom
- Filter 'toegevoegd door' (geaggregeerd op aanmaker) ontbreekt en heeft ook geen DB-kolom
- ContactDetail.tsx in current working tree heeft géén TasksSection component — gebruikt een eigen query zonder bewerkbaarheid via TaskEditorSheet

<details><summary>Bewijs</summary>

- `src/pages/Tasks.tsx (feat/opdrachtgever-tabs): mijn/alle filter + prioriteit/deadline filter + prioriteitsortering (critical=0,high=1,medium=2,low=3), bewerken via TaskEditorSheet`
- `src/components/shared/TasksSection.tsx (feat/opdrachtgever-tabs): inline taak aanmaken + toewijzen aan gebruiker, entity-koppeling kandidaat/opdrachtgever/vacature/plaatsing`
- `src/lib/tasks.ts (feat/opdrachtgever-tabs): entityLinks/entityTypeLabels missen huis/auto/contact/vehicle/property entries`
- `src/integrations/supabase/types.ts: recruiter_tasks schema aanwezig, task_attachments AFWEZIG (kolommen: id, ai_generated, ai_reasoning, assigned_to, category, completed_at, created_at, description, due_date, organization_id, priority, related_entity_id, related_entity_type, status, title, updated_at — géén created_by kolom)`
- `.claude/worktrees/contacten-taken-koppelingen/src/components/shared/TaskAttachments.tsx: volledig bijlagen-component (upload/delete/signed-url preview, staged files bij nieuw aanmaken)`
- `.claude/worktrees/contacten-taken-koppelingen/src/lib/taskAttachments.ts: uploadTaskFiles helper naar documents bucket onder {org_id}/taken/{task_id}/`
- `.claude/worktrees/contacten-taken-koppelingen/supabase/migrations/20260617120000_task_attachments.sql: task_attachments tabel met RLS (tenant_select/insert/delete via get_user_org_id())`
- `.claude/worktrees/contacten-taken-koppelingen/src/lib/tasks.ts: TASK_ENTITY_TYPES incl. huis (properties), auto (vehicles), contactpersoon (company_contacts), talentpool; EntityPicker interface`

</details>

> 🔒 task_attachments RLS gebruikt get_user_org_id() voor tenant-isolatie (select/insert/delete). Opslaan via bestaande 'documents' bucket onder pad {org_id}/taken/{task_id}/ — zelfde bucket als CV/ID-documenten van kandidaten. Signed URL download (300s TTL) via supabase.storage. Geen publiek endpoint, geen cross-tenant risico in de code. Aandachtspunt bij merge: verificeer dat de migration correct deployed is vóór de frontend-code live gaat (anders silent insert-errors op bijlagen). De 'voor mij' filter vereist een created_by kolom (ADD COLUMN + migratie) als die alsnog gebouwd wordt.

### C1 — Contacten create/edit-pagina op /contacten  
**🟡 PARTIAL** · effort **XS** · Contacten

Create en edit vanaf /contacten zijn volledig uitgewerkt in de dirty working tree van worktree `worktree-contacten-taken-koppelingen` (pad: `.claude/worktrees/contacten-taken-koppelingen/`). De wijzigingen zijn nog niet gecommit of gemerged naar main of feat/opdrachtgever-tabs. In de huidige werkende branch (feat/opdrachtgever-tabs) ontbreekt de create-knop op /contacten en is edit alleen beschikbaar via de detailpagina (/contacten/:id). Het LinkedIn-veld is aanwezig in ContactDialog.tsx in de worktree, terwijl de eis "LinkedIn-veld weg" stelt.

**Wat moet er nog:**
- ContactDialog.tsx en gewijzigde Contacts.tsx zijn uncommitted in de worktree en niet gemerged naar main/feat/opdrachtgever-tabs — code bestaat alleen als dirty working tree
- LinkedIn-veld staat nog in ContactDialog.tsx (regel 161) terwijl de meeting-eis expliciet 'LinkedIn-veld weg' stelt
- ContactDetail.tsx (edit op detailpagina) bevat ook nog het LinkedIn-veld in zowel view (regel 225-229) als edit-form (regel 183)

<details><summary>Bewijs</summary>

- `.claude/worktrees/contacten-taken-koppelingen/src/components/contacts/ContactDialog.tsx:1-175 (nieuw bestand, nog unstaged/uncommitted)`
- `.claude/worktrees/contacten-taken-koppelingen/src/pages/Contacts.tsx:14 (import ContactDialog), :63-65 (openNew/openEdit state), :141-151 (Pencil-knop per rij), :177-181 (ContactDialog render)`
- `git -C .claude/worktrees/contacten-taken-koppelingen status: 'A src/components/contacts/ContactDialog.tsx', 'M src/pages/Contacts.tsx' — uncommitted`
- `src/pages/ContactDetail.tsx:22-88 (edit-functionaliteit op detailpagina — al gemerged in feat/opdrachtgever-tabs)`
- `src/App.tsx:186-187 (routes /contacten en /contacten/:id — al aanwezig in feat/opdrachtgever-tabs)`
- `.claude/worktrees/contacten-taken-koppelingen/src/components/contacts/ContactDialog.tsx:161 — linkedin_url input nog aanwezig ondanks eis 'LinkedIn-veld weg'`

</details>

> 🔒 Geen nieuwe publieke endpoints, geen tokenflows. company_contacts-tabel heeft bestaande RLS (organization_id-scoped). ContactDialog.tsx schrijft uitsluitend naar company_contacts via de Supabase client met de ingelogde user-sessie — zelfde patroon als de bestaande ContactsTab. Geen PII-risico boven het bestaande model.

### AI1 — Grounding-check tegen hallucinatie + certificaat-normalisatie  
**🟡 PARTIAL** · effort **S** · AI

De grounding-check voor gehallucineerde hard skills is volledig uitgewerkt op branch `worktree-feat+cv-skill-grounding` (PR #74, open per 2026-06-17) maar nog NIET gemerged naar main. Het commit `5577077` introduceert `resolveHardSkills()` in `_shared/cv-write.ts`: het model moet voortaan per hard skill een letterlijk bewijsfragment (`bewijs`) citeren, dat deterministisch geverifieerd wordt tegen de gepseudonimiseerde dossiertekst. De Gemini/Cloud-paden geven `dossierText` mee; het VPS-callback-pad (`analyze-cv-callback`) doet dat nog niet (bewuste back-compat). Certificaat-terminologie-normalisatie (Code 95 / CPC / driver card → 1 concept) is nergens geïmplementeerd, ook niet op de grounding-branch.

**Wat moet er nog:**
- PR #74 is OPEN maar niet gemerged; grounding-check is dus niet actief in productie (main branch mist commit 5577077)
- VPS-callback-pad (analyze-cv-callback): writeCvAnalysisToCandidate wordt aangeroepen zonder dossierText; plain-string hard_skills van de VPS-Qwen gaan de grounding-filter volledig voorbij (bewuste back-compat, maar de eis zegt 'NA de AI-call' — ook VPS-pad)
- Certificaat-terminologie-normalisatie ontbreekt volledig: 'Code 95', 'CPC', 'bestuurderkaart', 'driver card' zijn geen aliassen in SKILL_ALIAS_ENTRIES (matching-core.ts) en er is geen deduplicate-stap in cv-write.ts voor certifications
- cv-prompt.ts: certificaten-schema heeft geen bewijs-veld (zelfde grounding-aanpak als hard_skills is niet doorgezet naar certificaten)
- Soft skills en certifications worden niet ge-grounded — alleen hard_skills vallen onder de nieuwe filter

<details><summary>Bewijs</summary>

- `supabase/functions/_shared/cv-write.ts:resolveHardSkills() — branch worktree-feat+cv-skill-grounding, commit 5577077`
- `supabase/functions/_shared/cv-prompt.ts:hard_skills schema gewijzigd naar {vaardigheid,bron,bewijs} — branch worktree-feat+cv-skill-grounding`
- `supabase/functions/analyze-cv/index.ts:414 — writeCvAnalysisToCandidate(..., { dossierText: pseudonymized }) — branch worktree-feat+cv-skill-grounding`
- `supabase/functions/analyze-cv-batch/index.ts:261 — writeCvAnalysisToCandidate(..., { dossierText: pseudo }) — branch worktree-feat+cv-skill-grounding`
- `supabase/functions/analyze-cv-callback/index.ts:114 — writeCvAnalysisToCandidate zonder dossierText (VPS-pad, geen grounding-filter) — beide main en grounding-branch`
- `src/test/cv-skill-grounding.test.ts — 6 Vitest-cases incl. cross-lingual en back-compat — branch worktree-feat+cv-skill-grounding`
- `PR #74 status: OPEN (gh pr list bevestigt open, 2026-06-17)`
- `supabase/functions/_shared/matching-core.ts:SKILL_ALIAS_ENTRIES — geen Code 95/CPC/driver card entries in hardcoded aliassen`

</details>

> 🔒 Geen directe security-impact. De gehallucineerde skills kunnen in de matching-uitkomst lekken (kandidaat rankt op vacatures waarvoor hij niet kwalificeert) maar raken geen PII, tokens, RLS of financiële data.

## Fase 1 — Quick wins & bugs

### D1 — Dashboard opschoning  
**⬜ TODO** · effort **S** · Dashboard

Het dashboard (src/pages/Dashboard.tsx + src/components/dashboard/KpiDashboard.tsx) bevat alle vier de genoemde problemen ongewijzigd. "Bezetting" is niet hernoemd; "Actieve medewerkers" staat dubbel (stat card + KPI card); de urenkaart toont "Uren deze week" (huidige week, geen weeknummer), niet "gewerkte uren vorige week"; compactheid is niet verbeterd. Geen commits op enige branch die deze eis adresseren.

**Wat moet er nog:**
- 1. StatCard label 'Bezetting' hernomen naar 'Huisvestingsbezetting' (Dashboard.tsx:391)
- 2. Duplicaat 'Actieve medewerkers' kaart verwijderen — ofwel uit StatCard-rij (Dashboard.tsx:389), ofwel uit KpiDashboard-cards array (KpiDashboard.tsx:154)
- 3. Urenkaart omzetten: query aanpassen naar vorige ISO-week (startOfWeek/endOfWeek van subWeeks(now,1)), label tonen als 'Gewerkte uren wk {weekNr}' en weeknummer berekenen via date-fns getISOWeek
- 4. Optioneel: 7 management-widgets (DashboardWidgets) evalueren op overlap en overbodige componen­ten verwijderen voor compacter snapshot-gevoel

<details><summary>Bewijs</summary>

- `src/pages/Dashboard.tsx:391 — label="Bezetting" (niet hernoemd naar Huisvestingsbezetting)`
- `src/pages/Dashboard.tsx:389 — StatCard label="Actieve medewerkers"`
- `src/components/dashboard/KpiDashboard.tsx:154 — cards entry label: 'Actieve medewerkers' (zelfde metric, dubbel voor admin-rol)`
- `src/pages/Dashboard.tsx:392 — StatCard label="Uren deze week"; query gebruikt startOfWeek/endOfWeek van new Date() (huidige week)`
- `src/components/dashboard/KpiDashboard.tsx:153 — tweede 'Uren deze week' kaart`
- `src/pages/Dashboard.tsx:396 — KpiDashboard alleen zichtbaar voor profile?.role === 'admin' (dus admin ziet 2× actieve medewerkers + 2× uren)`
- `git grep huisvestingsbezetting --all: geen resultaten`
- `git grep 'vorige week' --all: geen resultaten`

</details>

### I1 — Invullink/intake-formulier versimpelen  
**⬜ TODO** · effort **XS** · Intake · 🔒 security-gevoelig

Het publieke profielformulier op /profiel/:token (src/pages/CandidateProfile.tsx) bevat nog steeds de velden vaardigheden (skills), certificaten (certifications) en aankomst/check-in (arrival_date) die verwijderd moeten worden. De gewenste velden (beschikbaarheid vanaf/tot, rijbewijs, CV-upload, optionele documenten, notitie) zijn al aanwezig. De edge function candidate-profile/index.ts spiegelt dezelfde velden in allowedFields en het GET-antwoord. Geen enkele branch bevat de vereiste versimpeling.

**Wat moet er nog:**
- Verwijder skills-veld (TagInput + form state + submit payload) uit CandidateProfile.tsx
- Verwijder certifications-veld (TagInput + form state + submit payload) uit CandidateProfile.tsx
- Verwijder arrival_date input uit het 3-koloms grid in sectie 'Werk & beschikbaarheid'; grid wordt dan 2-koloms
- Verwijder arrival_date uit form state initialisatie (regel 54) en uit handleSubmit payload (regel 223)
- Edge function: verwijder 'skills', 'certifications', 'arrival_date' uit allowedFields array (index.ts:169-174) — of laat ze staan als passthrough (geen veld meer in UI stuurt ze niet mee, maar ze veroorzaken ook geen schade)
- Edge function GET: verwijder skills, certifications, arrival_date uit candidate-response object als ze niet meer via de form aangevuld worden (optioneel — niet functioneel kritiek)

<details><summary>Bewijs</summary>

- `src/pages/CandidateProfile.tsx:447-449 — TagInput voor skills (Label 'Vaardigheden')`
- `src/pages/CandidateProfile.tsx:451-453 — TagInput voor certifications (Label 'Certificaten')`
- `src/pages/CandidateProfile.tsx:484 — Input arrival_date (Label 'Aankomst/check-in') naast available_from en available_until`
- `src/pages/CandidateProfile.tsx:50 — form state initialiseert skills:[] as string[], certifications:[] as string[], arrival_date:''`
- `supabase/functions/candidate-profile/index.ts:169-174 — allowedFields array bevat 'skills', 'certifications', 'arrival_date'`
- `supabase/functions/candidate-profile/index.ts:90-91 — GET-response retourneert skills: c?.skills, certifications: c?.certifications`
- `supabase/functions/candidate-profile/index.ts:95 — GET-response retourneert arrival_date: c?.arrival_date`
- `git log --all --source -- src/pages/CandidateProfile.tsx: geen branch met de gevraagde versimpeling`

</details>

> 🔒 Publiek endpoint (verify_jwt=false, token-based auth). Verwijderen van velden uit het formulier is veilig richting de edge function — de allowedFields-whitelist in index.ts is al de securityboundary die voorkomt dat willekeurige kolommen worden overschreven. De fields skills/certifications/arrival_date kunnen worden uitgesloten uit het POST-payload zonder risico; ze uit allowedFields verwijderen is optioneel maar clean. Geen RLS-wijziging nodig. Geen PII-impact (skills/certifications zijn niet-gevoelig).

### BR1 — Bron "recruitment partner"  
**⬜ TODO** · effort **XS** · Kandidaten

Het `candidates.source`-veld bestaat als free-text kolom (`string | null`) in de DB. In `CandidateSlideOver.tsx` is het al een Select-dropdown met 6 vaste opties (website, whatsapp, indeed, linkedin, referral, overig). In `CandidateProfileTab.tsx` is het een vrij-tekst `InlineTextField`. De optie "recruitment_partner" (of enige variant daarvan) ontbreekt in alle branches — `git grep` over alle refs geeft nul resultaten. Er is geen DB-enum voor candidate source; het veld is `text`. De LeadFunnelBoard heeft een apart `sourceLabel`-map met andere waarden (public_signup, carerix, etc.) die niet synchroon zijn met de SlideOver-lijst.

**Wat moet er nog:**
- Optie 'recruitment_partner' (of vergelijkbaar) ontbreekt in de sources-array in CandidateSlideOver.tsx
- CandidateProfileTab.tsx gebruikt een vrij-tekst veld in plaats van een Select; wijziging naar dropdown of toevoegen van optie is nodig voor consistentie
- LeadFunnelBoard.tsx sourceLabel-map is niet synchroon met de CandidateSlideOver sources-lijst; beide moeten 'recruitment_partner' kennen
- Fase 2 (welke partner) is nog niet ontworpen: geen partner_id-kolom, geen partners-tabel, geen FK. Vereist schema-uitbreiding als kwaliteitsmeting per partner gewenst is
- Geen DB-enum voor candidate source — uitbreidingen kunnen inconsistent worden zonder enum of CHECK-constraint

<details><summary>Bewijs</summary>

- `src/components/candidates/CandidateSlideOver.tsx:24-31 — sources array: website/whatsapp/indeed/linkedin/referral/overig (geen recruitment_partner)`
- `src/components/candidates/tabs/CandidateProfileTab.tsx:294 — InlineTextField voor 'Bron' (vrij tekst, geen dropdown)`
- `src/components/candidates/LeadFunnelBoard.tsx:72-79 — sourceLabel map met public_signup/linkedin/facebook/carerix (andere set, niet gesynchroniseerd)`
- `src/integrations/supabase/types.ts:897 — candidates.source: string | null (geen enum)`
- `src/integrations/supabase/types.ts:9305-9418 — Enums-sectie: geen candidate_source enum aanwezig`
- `git grep --all 'recruitment' → nul resultaten op alle branches`

</details>

> 🔒 Niet security-gevoelig. Het source-veld is intern beheer-data, geen PII, geen financieel veld, geen publiek endpoint.

### F1 — Functie-labels salaris/uurtarief + vacature aan/uit  
**🟡 PARTIAL** · effort **XS** · Functies

CompanyFunctionsTab.tsx (branch feat/opdrachtgever-tabs, commit 71eb866) heeft salary-range (salary_min/salary_max) al als aparte min/max-velden met labels "Salaris min (€/u)" en "Salaris max (€/u)". Het veld default_hourly_rate staat er nog in als "Standaard uurtarief (€)" met de tekst "Dit veld is voor backwards compatibility." — dit veld moet weg per de eis. De is_active toggle is volledig uit de UI verwijderd (commit-message bevestigt dit expliciet), zodat er momenteel géén "vacature aan/uit"-toggle bestaat. De Tarieven-tab (RateAgreementsTab) bestaat en is leeg/ongewijzigd in CompanyDetail.tsx.

**Wat moet er nog:**
- default_hourly_rate veld ('Standaard uurtarief') staat nog in de form met 'backwards compatibility'-tekst; eis = verwijderen (of hernoemen naar 'Vast tarief (optioneel)' als alternatief)
- Geen 'vacature aan/uit' toggle in de UI: is_active is removed from view entirely, not renamed. Eis = toggle hernoemen naar 'Vacature aan/uit' zodat gebruiker kan regelen of vacatures voor deze functie zichtbaar zijn; nu is het veld altijd true (default) en onwijzigbaar via UI
- Label 'Salaris min/max (€/u)' is functioneel correct maar de eis vraagt expliciet om duidelijk min/max — dit is grotendeels al ok; check of placeholder-tekst duidelijk genoeg is ('bv. 22.50' zegt niks over context)

<details><summary>Bewijs</summary>

- `src/components/companies/tabs/CompanyFunctionsTab.tsx:154-165 — labels 'Salaris min (€/u)' en 'Salaris max (€/u)' aanwezig; 'Standaard uurtarief' field met backwards-compat tekst nog aanwezig`
- `src/components/companies/tabs/CompanyFunctionsTab.tsx:162-166 — default_hourly_rate input en tekst 'Dit veld is voor backwards compatibility.' nog in de form; eis zegt: verwijderen`
- `src/components/companies/tabs/CompanyFunctionsTab.tsx:24,61,75 — is_active in state/form-state maar geen enkel UI-element (Switch/Checkbox/Toggle) in de form; 'vacature aan/uit' toggle ontbreekt volledig`
- `git log 71eb866 — commit-message: 'Functie toevoegen: actief/inactief-toggle + Status-kolom verwijderd (onnodig)' — toggle actief verwijderd, niet hernoemd naar 'vacature aan/uit'`
- `src/pages/CompanyDetail.tsx:93-104 — Tarieven-tab aanwezig (RateAgreementsTab), voldoet aan 'laten staan maar niet invullen'`
- `src/integrations/supabase/types.ts:1860-1916 — company_functions tabel heeft is_active (boolean|null), salary_min, salary_max, default_hourly_rate — alle kolommen bestaan in DB`

</details>

### DUP1 — Duplicaat-UX terugkeer: draft bewaren na "Bekijken"  
**⬜ TODO** · effort **S** · Kandidaten

De duplicaatwaarschuwing in CandidateNew.tsx toont een "Bekijk"-knop per mogelijke duplicaat (regel 440). Klikken roept `navigate(\`/kandidaten/${d.id}\`)` aan zonder enige state-overdracht of persistentie. De gehele formulierstatus leeft uitsluitend in lokale `useState`-hooks (regel 56-62) zonder useEffect, sessionStorage of localStorage. Na navigatie weg van /kandidaten/nieuw is de concept-invoer volledig verloren. Er is geen terugkeer-mechanisme gebouwd: geen URL-state, geen draft-record in de DB, geen router location.state passing. Dit geldt ook voor de nieuwere worktree-branch `worktree-feat+cv-upload-autofill` (uitgebreidere versie van het formulier), die hetzelfde patroon zonder persistentie volgt.

**Wat moet er nog:**
- Geen draft-persistentie bij navigatie weg van het formulier (sessionStorage, localStorage, of React Router location.state)
- Geen 'Terug naar concept' knop of herstel-logica op /kandidaten/nieuw bij terugkeer
- De 'Bekijk'-knop opent het kandidaatprofiel in dezelfde tab, waardoor de browser-history het formulier verlaat en de staat verloren gaat

<details><summary>Bewijs</summary>

- `src/pages/CandidateNew.tsx:440 — navigate(`/kandidaten/${d.id}`) zonder state-param`
- `src/pages/CandidateNew.tsx:56-62 — volledige formulierstatus in useState, geen useEffect/sessionStorage/localStorage`
- `src/hooks/useDeduplication.ts:26-93 — useQuery voor dupe-detectie, schrijft niets naar persistente opslag`
- `git log --all: geen commit-boodschap bevat 'draft', 'terugkeer', 'return form' of 'form restore'`
- `worktree-feat+cv-upload-autofill:src/pages/CandidateNew.tsx:713 — zelfde navigatiepatroon zonder persistentie`

</details>

> 🔒 Geen security-impact. De draft bevat wel PII-velden (BSN, IBAN, geboortedatum) — bij sessionStorage-opslag moet de data bij het sluiten/leegmaken van de sessie gewist worden. localStorage is ongeschikt voor BSN/IBAN vanwege AVG-persistentie-risico. Voorkeur: React Router location.state (in-memory, verdwijnt bij tab-sluiting) of een DB-draft zonder BSN/IBAN.

### Z1 — Accent-insensitief zoeken kandidaten  
**⬜ TODO** · effort **S** · Kandidaten

De kandidatenzoekfunctie gebruikt uitsluitend `ilike` (server-side, "Alle"-tab) en `.toLowerCase()` + `.includes()` (client-side, "In dienst"-tab). Beide methoden negeren diacrieten niet: "Jose" vindt "José" niet en vice versa. Er is nergens in de codebase (migraties, edge functions, frontend) gebruik van PostgreSQL `unaccent`, de `pg_trgm`-extensie met unaccent-wrapper, of JavaScript `String.prototype.normalize('NFD')` voor zoekdoeleinden.

**Wat moet er nog:**
- PostgreSQL unaccent-extensie is niet geactiveerd (CREATE EXTENSION IF NOT EXISTS unaccent)
- Geen unaccent()-wrapper rondom ilike-kolommen in Candidates.tsx:227 (alle tabs die server-side zoeken)
- Geen NFD-normalisatie in de client-side 'In dienst'-filter (Candidates.tsx:294-308)
- Geen unaccent-gebaseerde index op candidates(first_name, last_name) voor performance bij grote datasets
- rank-candidates edge function (index.ts:94) heeft hetzelfde gat — buiten scope van Z1 maar gerelateerd

<details><summary>Bewijs</summary>

- `src/pages/Candidates.tsx:227 — query.or(`first_name.ilike.%${search}%,...`) — geen unaccent-wrapper`
- `src/pages/Candidates.tsx:294-308 — haystack.includes(searchValue) na .toLowerCase() — geen NFD-normalize`
- `supabase/migrations/ — geen enkele migratie activeert unaccent-extensie of maakt unaccent-gebaseerde index aan`
- `supabase/functions/rank-candidates/index.ts:94 — q.or(`first_name.ilike.%${search}%,...`) — zelfde patroon in edge function`
- `git grep --all 'unaccent' — nul resultaten over alle branches`

</details>

> 🔒 Geen security-impact. Zoekvelden zijn read-only filterpaden, geen schrijfpaden. unaccent is een pure tekstfunctie zonder privilege-implicaties. ilike-parameters worden via PostgREST doorgegeven; SQL-injectie via ilike is niet van toepassing bij parameterized PostgREST-queries.

### DOC1 — Documenten-bug bij kandidaat  
**🟡 PARTIAL** · effort **S** · Documenten · 🔒 security-gevoelig

Twee afzonderlijke bugs. Bug 1: bestanden geüpload via de AI-tab (CandidateAiTab.tsx) komen terecht in de `documents` storage bucket en worden opgeslagen als `candidates.cv_file_url`, maar er wordt géén rij in de `documents` tabel aangemaakt. CandidateDocumentsTab.tsx leest uitsluitend tabel-rijen, waardoor het geüploade bestand daar onzichtbaar blijft. Bug 2: certificaat-foto's (type='certificaat', jpg/png) die wél correct als tabelrij bestaan (via Onboarding of handmatige upload) worden door `candidate-dossier.ts` uitgesloten van het AI-dossier — `scoreDocument` filtert niet-tekstbestanden weg (score < 2000) en `resolveCvVisionFile` staat alleen CV-type/CV-naam door als VISION-input (harde privacy-guard voor ID/paspoort). Certificaatfoto's vallen daarmee onder dezelfde uitsluiting terwijl ze nuttige informatie voor de AI bevatten.

**Wat moet er nog:**
- Bug 1: CandidateAiTab.tsx#handleFileUpload voegt na storage-upload geen rij in documents-tabel in (type='cv', name=bestandsnaam, file_path=pad, status='geldig'). Fix: na de storage upload en cv_file_url update een documents-insert toevoegen.
- Bug 2: certificate-foto's (type='certificaat') zijn uitgesloten van zowel tekst-extractie als VISION-fallback in candidate-dossier. De privacy-guard is terecht voor ID/paspoort, maar te breed voor certificaten. Fix-optie: resolveCvVisionFile uitbreiden om ook type='certificaat' of type='diploma' toe te staan als VISION-input (met expliciete documentatie dat deze naar Google gaan). Vereist afstemming over welke document-types privacy-sensitief zijn.
- Geen migratie of RLS-wijziging nodig voor Bug 1 — documents-tabel heeft al correcte insert-policy voor interne gebruikers (tenant_insert via is_internal_user())

<details><summary>Bewijs</summary>

- `src/components/candidates/tabs/CandidateAiTab.tsx:311-323 — upload naar storage + update cv_file_url, géén insert naar documents-tabel`
- `src/components/candidates/tabs/CandidateDocumentsTab.tsx:54 — query op supabase.from('documents') verwacht tabelrij`
- `supabase/functions/_shared/candidate-dossier.ts:306 — scoreDocument-filter: score < 2_000 slaat niet-tekstbestanden over`
- `supabase/functions/_shared/candidate-dossier.ts:358-359 — resolveCvVisionFile: isCv-check blokkeert type='certificaat' als VISION-input`
- `supabase/functions/_shared/candidate-dossier.ts:36-41 — VISION_MIME_BY_EXT en comment: privacy-guard, nooit ID/paspoort als ruwe scan`
- `supabase/functions/onboarding-submit/index.ts:268-275 — onboarding-submit wél correct: insert naar documents-tabel met candidate_id + file_path + type`
- `src/components/candidates/tabs/CandidateDocumentsTab.tsx:104-135 — handmatige upload via CandidateDocumentsTab wél correct: upload + insert naar documents-tabel`
- `branch worktree-feat+cv-upload-autofill:src/components/candidates/tabs/CandidateAiTab.tsx:134,141 — zelfde omissie, geen fix in die branch`

</details>

> 🔒 Bug 2-fix raakt AVG/privacy: certificaatfoto's (jpg/png) kunnen persoonsgegevens bevatten (naam, geboortedatum, pasfoto op diploma). De bestaande guard in resolveCvVisionFile (regel 37-40 + 358-359) sluit bewust alles uit behalve CV-documenten om te voorkomen dat ruwe scans naar Google (Gemini) gaan zonder pseudonimisering. Uitbreiding naar 'certificaat'/'diploma' vereist expliciete beslissing: ofwel accepteren dat deze types als raw bytes naar Gemini gaan, ofwel eerst een pseudonimiseerbare extractiestap bouwen. Bug 1 zelf is niet security-gevoelig — storage-upload is al tenantgeïsoleerd via het pad `{orgId}/{candidateId}/`.

## Fase 2 — Tracer bullet: voorstel → reactie → plaatsing

### V1 — Voorstelmail bewerkbaar + huisstijl  
**🟡 PARTIAL** · effort **L** · Voorstel · 🔒 security-gevoelig

De voorstelmail-infrastructuur bestaat: send-match-proposal edge function met preview-mode, sendViaOutlookAccount met CC-ondersteuning, en automatische huisstijl-handtekening via appendAccountSignatureIfMissing (outlook-signature.ts). De preview-dialoog in VacancyMatchesTab toont de gerenderde HTML in een iframe. Van de zeven deeleisen uit de meeting van 17 juni zijn er twee gedeeltelijk aanwezig (handtekening via mailbox-account, ontvanger wordt primaire contact geselecteerd) en vijf volledig afwezig: bewerkbare mailbody, AI-label weg richting klant, betrouwbaarheidsscore verbergen/aanpasbaar, BCC, afzender-keuzescherm in UI, CV-toggle als bijlage.

**Wat moet er nog:**
- Bewerkbare mailbody: preview-dialoog toont alleen read-only iframe; geen Textarea/RichTextEditor om de tekst aan te passen vóór versturen
- AI-label weg richting klant: 'AI-kandidaatrapport'-sectieheader is hardcoded in HTML-template; geen optie om de volledige AI-sectie te verbergen
- Betrouwbaarheidsscore weg/aanpasbaar: reliabilityScore-badge altijd gerenderd als niet-null; geen hide_reliability_score-vlag in request body of UI-toggle
- BCC: volledig afwezig — SendViaOutlookAccountParams heeft geen bcc-veld, Graph-call heeft geen bccRecipients, preview-dialoog heeft geen BCC-inputveld
- Afzender kiezen in UI: outlook-accounts infrastructuur (gedeeld/persoonlijk) bestaat, maar send-match-proposal accepteert geen accountId; preview-dialoog heeft geen afzender-dropdown
- Ontvanger kiezen in UI: edge function auto-selecteert primair contact (is_primary desc limit 1); preview-dialoog toont de To-waarde maar gebruiker kan niet wisselen tussen contacten (met ster) of algemeen e-mailadres
- CV meesturen toggle: volledig afwezig — geen attachments array in Graph-call, geen CV-selectie in UI, geen include_cv-vlag in edge function body

<details><summary>Bewijs</summary>

- `supabase/functions/send-match-proposal/index.ts:166 — body parsing: only {match_id, preview} destructured; no accountId/cc/bcc/customBody/includeCv/hideAi accepted`
- `supabase/functions/send-match-proposal/index.ts:64-150 — buildProposalEmailHtml: renders 'AI-kandidaatrapport' header (line 121), betrouwbaarheid badge (line 67), positiveSignals, riskFactors — no hide-flags`
- `supabase/functions/send-match-proposal/index.ts:213 — contacts ordered by is_primary desc, limit 1 — auto-select, no multi-contact chooser`
- `supabase/functions/send-match-proposal/index.ts:268-275 — sendViaOutlookAccount call passes only {orgId, to, subject, htmlBody, sentBy, companyId} — no accountId/cc/bcc`
- `supabase/functions/_shared/outlook-send.ts:15,18 — interface has cc?: string[] and accountId?: string | null — supported in the layer but not wired from send-match-proposal`
- `supabase/functions/_shared/outlook-send.ts:115,119 — Graph sendMail payload: no attachments array, no bccRecipients`
- `supabase/functions/_shared/outlook-signature.ts:58-74 — appendAccountSignatureIfMissing with signature_html + variable replacement (afzender_naam/email, organisatie_naam) — auto-applied in outlook-send.ts:106`
- `supabase/functions/_shared/outlook-accounts.ts:38,44,107-108 — scope: personal|organization, mailbox_mode: user|shared — infrastructure exists for sender selection, not exposed to send-match-proposal`

</details>

> 🔒 CV-bijlage vereist signed-URL generatie voor het candidaat-document uit de documents-bucket (presigned URL met korte TTL, nooit raw bucket-pad doorgeven aan client). AI-sectie bevat ai_risk_factors en ai_interview_questions — persoonsgebonden kandidaatdata; tonen aan externe opdrachtgever zonder expliciete opt-in is AVG-gevoelig (betrokkene-recht op niet-geautomatiseerde profilering). Afzender-selectie moet RLS-equivalent op edge-function-niveau afdwingen: sendViaOutlookAccount laadt de provider via loadProviderForAccount met grantAllows-check — dit werkt correct mits accountId uit het request niet bypassed wordt zonder auth-check. CC/BCC-adressen mogen niet door de client worden vrij ingevuld zonder validatie (open mail-relay risico via eigen Outlook-account).

### V2 — Publieke reactiepagina (match-response)  
**🟡 PARTIAL** · effort **L** · Voorstel · 🔒 security-gevoelig

De basisinfrastructuur is aanwezig en functioneel: publieke route /match/reageer/:token en /match-response/:token (src/App.tsx:229-230), pagina MatchResponse.tsx met token-lookup + reactie (interesse/geen_interesse), edge function match-response/index.ts met service-role, SEC-4 hardening (anon-enum policy gedropped), token-verval via expires_at, atomaire single-use update via .is("used_at", null). De eisen uit de meeting van 17 juni 2026 zijn echter grotendeels niet gebouwd: geen logo, geen AI-rapport/CV-PDF op de pagina, geen datum/tijd-kiezer voor gesprek of startdatum, geen verplichte reden-dropdown bij afwijzen, geen opmerking-veld, geen "vraag stellen via mail/WhatsApp (naar accountmanager)" functie.

**Wat moet er nog:**
- Logo van organisatie ontbreekt op publieke pagina (match-response edge fn geeft org-data niet terug)
- AI-rapport (summary, functionGroup, classification, reliabilityScore, positiveSignals, riskFactors, targetFunctions, interviewQuestions) niet beschikbaar op de reactiepagina — staat wel in de e-mail
- CV-PDF preview en download ontbreekt volledig (geen cv_file_url in response, geen PDF-viewer component)
- Reactie 'interesse' heeft geen datum/tijd-kiezer voor gesprek NOR optie 'direct starten + startdatum' — matches-tabel mist interview_date/start_date kolommen
- Afwijzing heeft geen verplichte reden-dropdown — match_proposal_tokens mist een reason/reden kolom, en er is geen match_rejection_reasons tabel of enum
- Geen opmerking/comment veld bij reactie (zowel DB-kolom als UI ontbreekt)
- Geen 'vraag stellen via mail/WhatsApp (naar accountmanager van de match)' — geen mailto/wa.me link, geen accountmanager lookup in token-context
- match-response edge function logt de reactie niet in audit_log of communications tabel
- Geen rate-limiting per IP op de match-response endpoint (token is voldoende geheim, maar brute-force op token-space is onbegrensd)

<details><summary>Bewijs</summary>

- `src/pages/MatchResponse.tsx:1-150 — enkel voornaam+achternaam kandidaat + vacaturetitel getoond; geen logo, geen rapport, geen CV-PDF, geen datum-kiezer, geen reden-dropdown, geen opmerking, geen contactknop`
- `supabase/functions/match-response/index.ts:36-51 — selecteert alleen first_name/last_name/title; geen org logo, ai_summary, ai_reliability_score, ai_positive_signals, cv_file_url`
- `supabase/functions/match-response/index.ts:63-83 — response enum is hardcoded ['interesse','geen_interesse']; geen reden-veld, geen opmerking, geen datum/tijd`
- `supabase/functions/send-match-proposal/index.ts:251-265 — token aanmaken + email versturen; email bevat volledig AI-rapport, maar publieke pagina ontvangt dit niet`
- `src/integrations/supabase/types.ts:5152-5184 — match_proposal_tokens schema: geen kolommen voor reden, opmerking, interview_date, start_date`
- `src/integrations/supabase/types.ts:5203-5224 — matches schema: geen interview_date of start_date kolom voor 'op gesprek + datum/tijd'`
- `src/App.tsx:229-230 — beide routes (match-response/:token en match/reageer/:token) bestaan`
- `supabase/config.toml:181-184 — verify_jwt = false voor match-response (correct)`

</details>

> 🔒 Publiek endpoint zonder login. Token-security is solide (32-byte token, expires_at, single-use atomaire update, SEC-4 anon-enum policy gedropped). Openstaande securitypunten: (1) geen rate-limit per IP op match-response edge function (token-enumeration kost O(2^256) maar ongelimiteerde requests zijn wel mogelijk); (2) bij toevoeging van CV-PDF download moet de presigned URL niet direct in de pagina-response zitten zonder token-verificatie — beschermd houden via dezelfde edge function; (3) AI-rapport bevat potentieel PII/persoonsgevoelige informatie (ai_positive_signals, ai_risk_factors) die op een publieke URL terechtkomt — de opdrachtgever-link is bedoeld maar de link moet niet deelbaar zijn buiten de geadresseerde; (4) geen audit-log bij token-gebruik (tracering van wie gereageerd heeft ontbreekt)."

### M1 — Matching-UX "Match maken"  
**🟡 PARTIAL** · effort **S** · Matching

De matching-UI is substantieel herbouwd en bevat al grote delen van de eis, maar drie specifieke punten uit de meeting van 17 juni zijn nog niet geïmplementeerd: (1) de actieknop heet nog "Voorstellen" / "Nieuwe match" (niet "Match maken"), (2) er is geen tekstzoekfunctie voor ALLE vacatures bij het aanmaken van een match vanuit kandidaatperspectief (CandidateVacancyMatchesTab toont ranked open vacatures tot limit=75 maar zonder vrij-tekst zoekbalk), en (3) er is geen verwijderknop voor matches in de UI en ook geen DB-level UNIQUE constraint op (candidate_id, vacancy_id) — duplicaten worden alleen client-side gefilterd via exclude_candidate_ids in rank-candidates.

**Wat moet er nog:**
- Knop hernoemen: 'Voorstellen' → 'Match maken' op alle vier locaties (VacancyMatchesTab regel 597/675, CandidateVacancyMatchesTab regel 212/251) + bulk-knop + toast-berichten bijwerken
- Tekstzoekbalk voor vacatures in CandidateVacancyMatchesTab: rank-vacancies edge fn accepteert geen 'search' param — zowel UI (Input + state) als edge fn moeten uitgebreid
- Verwijderknop voor matches: UI-component (Trash-knop per match-rij), DELETE RLS policy op matches (momenteel alleen SELECT + UPDATE), en optioneel een DB-level UNIQUE constraint op (organization_id, candidate_id, vacancy_id) als harde blokkade (nu alleen soft via client-side filtering)
- DB UNIQUE constraint op matches(organization_id, candidate_id, vacancy_id): zonder dit constraint kunnen bij race conditions of directe API-calls duplicaten aangemaakt worden; client-side exclude is niet waterdicht

<details><summary>Bewijs</summary>

- `src/components/vacancies/tabs/VacancyMatchesTab.tsx:641 — knop label 'Nieuwe match' (shortlist per kandidaat)`
- `src/components/vacancies/tabs/VacancyMatchesTab.tsx:597 — bulk knop label 'Voorstellen (N)'`
- `src/components/vacancies/tabs/VacancyMatchesTab.tsx:675 — MatchInspectorDialog action label 'Voorstellen'`
- `src/components/candidates/tabs/CandidateVacancyMatchesTab.tsx:212,251 — knoplabels 'Voorstellen'`
- `src/lib/match-status.ts:2 — status 'nieuwe_match' bestaat, pipeline-flow aanwezig`
- `src/components/vacancies/tabs/VacancyMatchesTab.tsx:120-148 — AI-shortlist via rank-candidates edge fn + scoreFilter (strong/60/70/80/all) + kandidaatzoekveld aanwezig (regel 565-568)`
- `src/components/candidates/tabs/CandidateVacancyMatchesTab.tsx:48-68 — reverse matching via rank-vacancies, limit=75, GEEN tekstzoekbalk`
- `supabase/migrations/20260528110000_0527_vacancy_signup_fast_path.sql:9 — alleen een INDEX op (org, vacancy_id, candidate_id), geen UNIQUE constraint`

</details>

### M2 — Match-statusflow opschonen  
**⬜ TODO** · effort **M** · Matching

De huidige match-statusflow bevat `in_gesprek` als actieve stap in de flow (src/lib/match-status.ts, regel 6 + NEXT_MATCH_STATUS regel 29), in de DB enum (types.ts:9377 + 9623), en als hardcoded target in de whatsapp-webhook edge function (index.ts:164). De eis vraagt `in_gesprek` te verwijderen en `afspraak_op_kantoor` toe te voegen na `voorgesteld_bij_klant` (met bevestigingsmail-trigger); geen `online_screening`-status bestaat al. Geen enkele van de vereiste wijzigingen is geïmplementeerd in de working tree of in enige andere branch (git grep op alle branches geeft nul hits voor `afspraak_op_kantoor`).

**Wat moet er nog:**
- DB enum: `in_gesprek` verwijderen is niet mogelijk via ALTER TYPE DROP (PostgreSQL ondersteunt geen enum value removal) — vereist workaround: nieuwe enum aanmaken, kolom migreren, oude droppen; OF `in_gesprek` in de UI verbergen maar in DB laten staan (pragmatische route).
- `afspraak_op_kantoor` toevoegen aan match_status DB enum (ALTER TYPE ADD VALUE)
- src/lib/match-status.ts: MATCH_STATUS_STEPS aanpassen — `in_gesprek` eruit, `afspraak_op_kantoor` toevoegen na `voorgesteld_bij_klant`
- NEXT_MATCH_STATUS flow aanpassen: voorgesteld_bij_klant → afspraak_op_kantoor → geaccepteerd
- whatsapp-webhook/index.ts:164 — 'match_ja' reply stuurt nu naar `in_gesprek`; moet naar `afspraak_op_kantoor` (of een andere logica als de semantiek verandert)
- Bevestigingsmail bij statusovergang naar `afspraak_op_kantoor`: edge function (bijv. send-placement-confirmation of nieuw endpoint) + trigger vanuit statusMutation in VacancyMatchesTab of server-side via DB trigger/edge fn
- src/lib/match-presenters.ts: case `in_gesprek` vervangen door case `afspraak_op_kantoor`
- CandidateVacancyMatchesTab + MatchStatusSelect + MatchPipeline.tsx: UI-labels controleren / aanpassen
- Bestaande matches met status `in_gesprek` in productie DB: data-migratie nodig (naar `afspraak_op_kantoor` of `voorgesteld_bij_klant`)
- `online_screening` bestaat al niet in de codebase — geen actie vereist

<details><summary>Bewijs</summary>

- `src/lib/match-status.ts:6 — { key: 'in_gesprek', label: 'In gesprek' } staat nog in MATCH_STATUS_STEPS`
- `src/lib/match-status.ts:29 — NEXT_MATCH_STATUS: voorgesteld_bij_klant → in_gesprek`
- `src/integrations/supabase/types.ts:9377 + 9623 — match_status enum bevat 'in_gesprek'`
- `supabase/functions/whatsapp-webhook/index.ts:164 — const newStatus = isYes ? 'in_gesprek' : 'afgewezen'`
- `src/lib/match-presenters.ts:60 — case 'in_gesprek': return 'Feedback vastleggen'`
- `git grep -i afspraak_op_kantoor --all → 0 hits op alle branches`
- `supabase/migrations/20260326150000_extend_placements_and_matches_meeting_26mar.sql:19-20 — alleen nieuwe_match en gescreend zijn ooit als ADD VALUE toegevoegd; afspraak_op_kantoor ontbreekt`

</details>

> 🔒 Niet direct security-gevoelig. De bevestigingsmail-trigger is een nieuwe uitgaande communicatie — moet langs de kill-switch (`_shared/outbound-pause.ts`) en de `logConceptCommunication`-guard. WhatsApp-webhook is een publiek endpoint maar de match-id wijziging raakt geen auth of RLS. Data-migratie van `in_gesprek` → andere status is een reguliere UPDATE binnen de eigen tenant (org-scoped).

### P1 — Acceptatie -> plaatsing-popup  
**🟡 PARTIAL** · effort **M** · Plaatsing · 🔒 security-gevoelig

De kern-infrastructuur bestaat: `PlacementSheet` (src/components/vacancies/PlacementSheet.tsx) opent na handmatig klikken op "Plaatsen" als `m.status === 'geaccepteerd'`. Het bevat startdatum, compliance-check (BSN, ID, contract), huisvesting-suggesties post-plaatsing, email-/telefoon-waarschuwingen, en een `PlacementConfirmationDialog`. `NewPlacementSheet` (src/components/placement/NewPlacementSheet.tsx) dekt directe plaatsing zonder match. Echter: automatisch openen van de popup bij statuswijziging naar `geaccepteerd`, voertuigselectie, NL-adres-check als pre-flight item, en contract-to-do als checklist-item ontbreken volledig. Er zit ook een bug: `PlacementSheet` geeft `candidateId` en `companyId` niet door aan `PlacementConfirmationDialog`, waardoor huisvesting-suggesties in dat dialoog nooit laden.

**Wat moet er nog:**
- AUTO-OPEN: statusMutation.onSuccess in VacancyMatchesTab triggert PlacementSheet niet automatisch bij status→geaccepteerd; gebruiker moet handmatig 'Plaatsen' klikken
- VOERTUIG: geen voertuigselectie (alleen beschikbare) en begin-km veld in PlacementSheet, NewPlacementSheet of PlacementConfirmationDialog; vehicle_assignments tabel bestaat wel (start_mileage nullable)
- NL-ADRES CHECK: has_dutch_address wordt niet gecheckt in useComplianceCheck.ts of als pre-flight item in de popup; alleen housing na plaatsing wordt gesuggereerd
- CONTRACT-TODO: contract wordt gecheckt via compliance (als document aanwezig), maar er is geen expliciete 'contract aanmaken/koppelen' checklist-stap in de popup
- BUG: PlacementSheet.tsx:310-328 geeft candidateId en companyId niet door aan PlacementConfirmationDialog → housing-suggesties in dat dialoog laden nooit (companyId guard line 81 faalt)

<details><summary>Bewijs</summary>

- `src/components/vacancies/tabs/VacancyMatchesTab.tsx:518-519 — 'Plaatsen'-knop verschijnt bij geaccepteerd, maar statusMutation.onSuccess opent niet automatisch PlacementSheet`
- `src/components/vacancies/PlacementSheet.tsx:63-219 — executePlacement: compliance-check, create_placement_transaction RPC, timesheet-templates, huisvesting-suggesties, WhatsApp, portal-invite, PlacementConfirmationDialog`
- `src/components/placement/PlacementConfirmationDialog.tsx:17-29 — props: candidateId? en companyId? optioneel; PlacementSheet.tsx:310-328 geeft ze NIET mee → housing-suggesties laden nooit in dit dialoog`
- `src/components/placement/PlacementTriggers.ts:76-168 — getHousingSuggestions: beschikbare units, team-clustering, rijafstand; PlacementSheet gebruikt dit AFTER plaatsing`
- `src/hooks/useComplianceCheck.ts:118 — BSN check aanwezig; geen has_dutch_address check`
- `src/components/placement/PlacementConfirmationDialog.tsx:289-297 — missingEmail/missingPhone badge aanwezig; Versturen geblokkeerd bij geen telefoon (missingPhone)`
- `src/integrations/supabase/types.ts:8304-8330 — vehicle_assignments tabel met start_mileage nullable; geen vehicle-selectie in PlacementSheet/NewPlacementSheet/PlacementConfirmationDialog`
- `src/components/placement/NewPlacementSheet.tsx:65-101 — directe plaatsing zonder match: compliance-check aanwezig, geen vehicle/NL-adres/contract-todo`

</details>

> 🔒 PlacementSheet gebruikt create_placement_transaction RPC (server-side, compliance-check en audit). Voertuig-koppeling (vehicle_assignments) vereist employee_id lookup — zorg voor org-scope check (organization_id) bij insert, anders cross-tenant toewijzing mogelijk. NL-adres is AVG-relevant persoonsdata. De bug met ontbrekende candidateId/companyId kan leiden tot stille housing-toewijzing zonder overboeking-check (de DB-trigger blokkeert, maar UX toont geen fout).

### NT1 — Notificaties bij acceptatie/plaatsing  
**🟡 PARTIAL** · effort **M** · Plaatsing

De eis omvat vier ontvangers: accountmanager (klant accepteerde + datum), Maria (to-do contract aanmaken met link), administratie (plaatsingsbevestiging + algemene voorwaarden), kandidaat/medewerker (bevestiging). Twee van de vier zijn gedeeltelijk gebouwd: (1) de kandidaat/medewerker krijgt een plaatsingsbevestiging via `send-placement-confirmation` (email + optioneel WhatsApp); (2) de opdrachtgever/administratie krijgt een plaatsingsbevestiging-email met algemene voorwaarden via diezelfde edge function. Geen van de interne-rol-notificaties bestaat: er wordt geen `recruiter_tasks`-rij aangemaakt voor 'Maria' (contract aanmaken) of de accountmanager, noch een `employee_notifications`-entry bij acceptatie of plaatsing. De `generate-notifications` edge function is bestaand maar beslaat alleen contract-verlopen, document-verlopen, openstaande uren en verjaardagen — niets over plaatsing/acceptatie.

**Wat moet er nog:**
- Accountmanager-notificatie (employee_notifications of recruiter_tasks) bij klant-acceptatie (match status → geaccepteerd) ontbreekt volledig
- Interne to-do 'contract aanmaken voor Maria' (recruiter_tasks insert met assigned_to Maria's profile_id, related_entity_type='plaatsing', link naar kandidaat/plaatsing) ontbreekt volledig
- Administratie-notificatie bij plaatsingsbevestiging is niet als apart intern kanaal gebouwd — huidige AV-email gaat alleen naar de opdrachtgever, niet naar interne administratie
- generate-notifications heeft geen trigger voor plaatsingsmoment (alleen cron-driven expiry-checks)
- Geen koppeling tussen match-status 'geaccepteerd' (via WhatsApp of UI) en een interne recruiter_task of employee_notification

<details><summary>Bewijs</summary>

- `supabase/functions/send-placement-confirmation/index.ts:1-603 — verstuurt email naar opdrachtgever (met AV) en kandidaat; geen recruiter_tasks/employee_notifications aanmaak`
- `supabase/functions/generate-notifications/index.ts:1-205 — 5 notificatietypen (contract_aflopend, document_verlopen, document_ontbrekend, uren_openstaand, verjaardag); geen plaatsing/acceptatie type`
- `src/components/vacancies/PlacementSheet.tsx:112-219 — post-placement triggers: timesheets, housing suggestions, WhatsApp, portal-invite; geen recruiter_tasks insert`
- `src/components/placement/PlacementTriggers.ts:181-214 — sendPlacementWhatsApp stuurt bericht naar kandidaat; geen accountmanager/backoffice notificatie`
- `src/components/placement/PlacementConfirmationDialog.tsx:157-184 — roept sendPlacementConfirmation aan voor klant + medewerker; geen interne taak`
- `supabase/functions/whatsapp-webhook/index.ts:152-178 — handleMatchInterest zet match naar in_gesprek/afgewezen bij WhatsApp-reply; geen recruiter_task bij geaccepteerd`
- `src/integrations/supabase/types.ts:7179-7244 — recruiter_tasks tabel bestaat (assigned_to, related_entity_id, related_entity_type) maar wordt niet gevuld bij plaatsing`
- `git grep main supabase/functions/housing-reminder-cron/index.ts:35 — recruiter_tasks aanmaken bestaat elders (APK, sick-report, housing), bewijst het patroon is beschikbaar`

</details>

> 🔒 recruiter_tasks heeft assigned_to als FK naar profiles — moet binnen org-scope worden aangemaakt (organization_id check). Geen publieke endpoint betrokken. Administratie-email verstuurt via bestaande Outlook-send-laag die al outbound-pause respecteert.

## Fase 3 — AI-kwaliteit (matching/screening)

### MG1 — Functiegroep-matching te grof (CE-chauffeur vs truck driver; oude irrelevante ervaring)  
**🟡 PARTIAL** · effort **M** · Matching

De specialist-guard (commit d5b2c4b, PR #24) dekt één kant van de eis: een specialist zonder skill-match én zonder functiesignaal wordt gecapt op ≤40 en valt uit de shortlist. Maar de twee concrete meeting-eisen van 17 juni zijn NOT gedekt: (1) er zijn geen skill-aliassen voor CE chauffeur ↔ truck driver — de token-matching faalt structureel omdat "CE" slechts 2 tekens heeft en gefilterd wordt en "chauffeur" geen token-overlap heeft met "truck" of "driver"; (2) er bestaat geen temporele weging van werkervaring — alle skills in candidates.skills worden flat en tijdloos gebruikt, ongeacht of de ervaring 2 of 20 jaar oud is. De ai_analysis JSONB bevat wel werkhistorie.werkgevers[].duur_maanden + periode, maar die worden nergens gelezen door scoreMatch().

**Wat moet er nog:**
- GAP 1 — Synoniem-aliassen CE chauffeur ↔ truck driver ontbreken volledig. hasFunctionSignal() faalt omdat 'CE' < 4 tekens en 'chauffeur'/'truck'/'driver' geen gedeelde tokens hebben. Nodig: skill-aliassen in SKILL_ALIAS_ENTRIES (of skill_aliases tabel) zoals ['ce chauffeur','vrachtrijder','truck driver','vrachtwagenchauffeur','chauffeur ce'] → canonieke term 'ce chauffeur' of 'vrachtrijden', en de bijbehorende vacature required_skills of hasFunctionSignal-uitbreiding.
- GAP 2 — Geen temporele weging van werkervaring. candidates.skills is een flat array zonder datumcontext. Barman 15-20 jaar geleden levert dezelfde skill-match als actuele ervaring. ai_analysis.werkhistorie.werkgevers[].duur_maanden + periode zit wel in de JSONB maar wordt NOOIT gelezen door scoreMatch() of rank-candidates. Nodig: ofwel (a) tijdens CV-analyse alleen recente (bv. <10 jaar) werkervaring meenemen bij het extraheren van hard_skills, of (b) een skill-recency-weging in scoreMatch() op basis van werkhistorie-data.
- GAP 3 — rijbewijs_types (CE, BE, C1) worden opgeslagen in ai_analysis JSONB maar zijn geen veld in MatchCandidate. Daarmee kan een 'CE rijbewijs vereist'-vacature niet matchen op specifiek rijbewijstype; alleen de binaire has_drivers_license wordt gebruikt. Dit raakt de CE-chauffeur-casus direct.

<details><summary>Bewijs</summary>

- `supabase/functions/_shared/matching-core.ts:103-142 — SKILL_ALIAS_ENTRIES: geen CE/truck-driver/vrachtwagen/transport-chauffeur entries`
- `supabase/functions/_shared/matching-core.ts:330-357 — hasFunctionSignal(): meaningful tokens ≥4 chars; 'CE'=2 chars (gefilterd), 'chauffeur'≠'truck'/'driver' → geen overlap → false`
- `supabase/functions/_shared/matching-core.ts:25-45 — MatchCandidate type: skills[] is flat array zonder datum/context; geen werkhistorie of recency-velden`
- `supabase/functions/_shared/matching-core.ts:443-455 — specialist-guard (commit d5b2c4b): cap op 40 als ai_classification==='specialist' && skillMatches.length===0 && !functionMatched`
- `supabase/functions/_shared/cv-prompt.ts:42-78 — CV-analyse schema: werkhistorie.werkgevers[].duur_maanden + periode wél opgeslagen in ai_analysis JSONB`
- `supabase/functions/_shared/cv-write.ts:31-96 — writeCvAnalysisToCandidate: slaat skills=hard_skills+soft_skills flat op; geen datum, geen recency-weging; werkhistorie.werkgevers wordt nergens doorgegeven aan candidates.skills`
- `supabase/functions/rank-candidates/index.ts:31 — CANDIDATE_FIELDS: haalt ai_function_group, ai_target_functions op, maar NIET ai_analysis of werkhistorie`
- `src/test/matching.test.ts — geen testcases voor CE-chauffeur↔truck-driver of temporal decay van skills`

</details>

### NS1 — Recruiter-notitie > CV + heranalyse-knop  
**⬜ TODO** · effort **M** · AI

De AI-analyse-pipeline (analyze-cv edge function + candidate-dossier.ts) laadt al notities uit de `notes`-tabel en voegt een prompt-instructie toe dat interne notities zwaarder wegen dan CV-claims (candidate-dossier.ts:555). De recruiter-screening staat echter in candidates.screening_data (JSONB) en wordt nergens ingeladen in het dossier. Er is geen "Opslaan en opnieuw screenen"-knop in CandidateAiTab of CandidateScreeningTab, op geen enkele branch. Screening-notities die de recruiter invult (professionele beoordeling, risiconiveau, antwoorden per stap, samenvatting) zijn volledig onzichtbaar voor de AI.

**Wat moet er nog:**
- candidates.screening_data (summary, professional.notes, personal.notes, antwoorden per stap) wordt niet ingeladen in buildCandidateDossier()
- CandidateForDossier interface mist screening_data-veld en de selectie in analyze-cv haalt het niet op
- Geen knop 'Opslaan en opnieuw screenen' in CandidateScreeningTab of CandidateAiTab
- CandidateScreeningTab schrijft screening-notities nooit naar de notes-tabel (de enige bron die het dossier nu leest), waardoor de recruiter-inhoud de AI niet bereikt via het bestaande notes-pad
- Screening-samenvatting als note opslaan (eis: 'screening wordt als notitie opgeslagen') is niet geïmplementeerd
- Specifieke conflict-weging (taalniveau, verlopen rijbewijs) voor screening vs CV heeft geen dedicated prompt-sectie of code-logica

<details><summary>Bewijs</summary>

- `supabase/functions/_shared/candidate-dossier.ts:44-65 — CandidateForDossier interface mist screening_data, screened_at, screened_by`
- `supabase/functions/_shared/candidate-dossier.ts:393-428 — loadNotes() leest notes-tabel, NIET candidates.screening_data`
- `supabase/functions/_shared/candidate-dossier.ts:555 — prompt-instructie 'interne notities mogen red flags/contra-indicaties zwaarder maken dan CV-claims' aanwezig, maar geen code-mechanisme`
- `supabase/functions/analyze-cv/index.ts:187 — .select() op candidates bevat geen screening_data`
- `src/components/candidates/tabs/CandidateAiTab.tsx:563-617 — 'AI analyse starten' dropdown aanwezig, geen recruiter-notitieveld, geen 'Opslaan en opnieuw screenen'-knop`
- `src/components/candidates/tabs/CandidateScreeningTab.tsx:378 — screening_data opslaan naar candidates, GEEN notes-tabel insert, GEEN analyze-cv invoke`
- `supabase/migrations/20260402120000_add_candidate_screening.sql:2-4 — candidates.screening_data jsonb + screened_at + screened_by bestaan in DB`
- `branches gecontroleerd: codex/candidate-availability-columns, codex/match-history-screening-context, origin/codex/prod-june-meeting-release, origin/launch-ready-fixes — geen van deze branches heeft het gevraagde feature`

</details>

> 🔒 Screening_data bevat recruiter-beoordelingen (risiconiveau, professionele noten) — gevoelig als PII, maar interne data die toch al onder dezelfde RLS-tenant-scope valt. Geen extra auth-risico bij inladen in het dossier; het dossier wordt server-side gepseudonimiseerd vóór verzending naar LLM (cv-pseudonymize.ts). De screening-samenvatting naar notes-tabel schrijven vereist wel dat de notes-tabel RLS een insert door authenticated internal users toelaat, wat al het geval is.

## Fase 4 — Integraties, comms & go-live data

### COM1 — Inbox per bedrijf (COM-tab)  
**🟡 PARTIAL** · effort **L** · Communicatie · 🔒 security-gevoelig

Een CommunicationTab component bestaat en is volledig ingebouwd in CompanyDetail (tab "Comm." op /opdrachtgevers/:id). De tab haalt alle `communications`-rijen op die company_id = bedrijf óf company_contact_id IN (contactpersonen van dit bedrijf) matchen, toont kanaaliconen inclusief whatsapp/email/voip/notitie/sms, en laat intercedenten handmatig een notitie/communicatie toevoegen. Echter: inkomende WhatsApp wordt alleen aan candidate_id gekoppeld (nooit company_id), en de outlook-mail edge function schrijft inkomende e-mails niet weg naar de communications-tabel. De tab toont daardoor uitsluitend handmatig gelogde berichten en uitgaande e-mails die via outlook-send-mail met company_id zijn verstuurd — geen echte inbox-aggregatie van bedrijf + contactpersoon e-mailverkeer.

**Wat moet er nog:**
- Inbound WhatsApp koppelt nooit aan company_id — whatsapp-webhook schrijft alleen candidate_id; bedrijfs-WhatsApp-berichten verschijnen niet in de tab
- Geen inbound email sync: outlook-mail fetcht e-mails van Graph API maar slaat ze niet op in communications — echte inbox-mails van bedrijf/contactpersonen zijn niet zichtbaar
- Geen realtime-subscriptie in CommunicationTab (geen supabase.channel().on()), tab refresht alleen bij mounten/invalidate
- Automatische koppeling van inkomend bericht aan company via e-mailadres of telefoon ontbreekt volledig (matching-logica niet gebouwd)

<details><summary>Bewijs</summary>

- `src/components/companies/tabs/CommunicationTab.tsx:44-64 — query aggregeert company_id + company_contact_id IN (...)`
- `src/pages/CompanyDetail.tsx:105 — tab 'communicatie' ingebouwd`
- `supabase/functions/whatsapp-webhook/index.ts:342 — insert communications zonder company_id (alleen candidate_id)`
- `supabase/functions/outlook-mail/index.ts — geen write naar communications table (0 hits)`
- `supabase/functions/outlook-send-mail/index.ts:132-146 — schrijft company_id + company_contact_id alleen bij outbound send`
- `src/integrations/supabase/types.ts:1544/1551 — communications.company_contact_id en company_id FK's bestaan`

</details>

> 🔒 Inbound e-mailsync vereist dat Graph API tokens (Outlook OAuth) ook bedrijfsberichten ontsluiten — scope en toegangsrechten moeten geaudit worden. Auto-koppelen van e-mail/WhatsApp op basis van e-mailadres/telefoonnummer aan een company_id vereist een lookup die cross-tenant niet mag lekken (RLS). Communications-tabel bevat potentieel bedrijfsvertrouwelijke correspondentie (AVG artikel 6 grondslag commercieel contact). company_contact_id FK in communications is nullable en niet door RLS extra afgeschermd — een intercedent van org A mag in theorie communications lezen van org B als RLS op de tabel niet correct is (te verifiëren).

### EM1 — Mailbox-/routing-strategie  
**🟡 PARTIAL** · effort **M** · E-mail · 🔒 security-gevoelig

De infrastructuur voor meerdere mailboxen (hoofd-org, gedeelde mailboxen, persoonlijke mailboxen per medewerker) is volledig gebouwd in `mail_accounts` + `mail_account_user_access` + `outlook-accounts.ts`. Automations sturen altijd via de org-default of de geselecteerde account (`sendViaOutlookAccount`, `outlook-send-mail`). Er is een heuristische client-side AI-triage in `EmailInbox.tsx` die berichten labelt (CV / Klantvraag / Partner / Ruis / Review) en een recruiter-taak aanmaakt — maar die taak wordt altijd aan de *huidige gebruiker* toegewezen, niet aan een role-gebaseerde target (financieel → Maria/administratie). Het `reply_to_email`-veld bestaat in de DB en in de `MailAccountRow`-type, maar wordt nergens in de send-paden ingevuld in het Graph `sendMail`-bericht. De open beslissing info@ vs persoon-naar-persoon is vertaald naar de keuze org-scope (gedeelde mailbox) vs personal-scope account, maar er is geen UI of configuratie die expliciet de strategie vastlegt of automatiseringen forceert naar één aanpak. Antwoord-routing naar een specifiek persoon/rol (financieel → administratie) ontbreekt volledig.

**Wat moet er nog:**
- reply_to_email-kolom wordt niet doorgegeven aan het Graph sendMail-bericht — de instelling heeft nu geen effect op uitgaande mail
- Antwoord-routing financieel→Maria/administratie ontbreekt volledig: geen rol-gebaseerde lookup bij triage-taak-aanmaak en geen Outlook inbox-regel-configuratie
- Geen configuratiescherm of documentatie die de info@ vs persoon-naar-persoon strategie-beslissing vastlegt en afdwingt voor automations (send-placement-confirmation, send-portal-invite, etc. gebruiken altijd org-default)
- Triage-taakaanmaak wijst altijd aan de ingelogde gebruiker toe (user?.id), niet aan een geconfigureerde role-eigenaar per categorie
- Geen server-side auto-forward of inbox-rule-beheer vanuit de app (Microsoft Graph ondersteunt mailboxRules API maar die is niet geïmplementeerd)

<details><summary>Bewijs</summary>

- `supabase/functions/_shared/outlook-accounts.ts:34-65 — MailAccountRow met reply_to_email:string|null, scope:'organization'|'personal', mailbox_mode:'user'|'shared'`
- `supabase/functions/_shared/outlook-accounts.ts:337-352 — loadDefaultOrganizationSender() selecteert altijd org-scope is_default_for_organization=true, geen routing op categorie/role`
- `supabase/functions/_shared/outlook-send.ts:63-166 — sendViaOutlookAccount() bouwt het Graph sendMail-bericht zonder replyTo-header; reply_to_email wordt geladen in provider.account maar nooit doorgestuurd naar de Graph API body`
- `supabase/functions/outlook-send-mail/index.ts:116-130 — interactieve send-flow (handmatige mail) bevat geen replyTo of routering op categorie`
- `src/components/email/EmailInbox.tsx:73-115 — classifyEmailMessage() heuristische triage (CV/Klantvraag/Partner/Ruis/Review), volledig client-side, geen server-side routing`
- `src/components/email/EmailInbox.tsx:274-292 — triageMutation maakt recruiter_task met assigned_to: user?.id — altijd huidige gebruiker, geen rol-lookup voor bijv. 'finance'→Maria`
- `src/components/settings/OutlookSettings.tsx:421 — UI beschrijft enkel 'standaard afzender voor systeemmails'; geen strategie-keuze info@ vs persoon-naar-persoon`
- `supabase/migrations/20260507150000_outlook_mail_accounts.sql:20 — reply_to_email text NULL aangemaakt maar zonder constraint/gebruik`

</details>

> 🔒 reply_to_email wordt opgeslagen maar niet gesanitized voordat het in het Graph-bericht zou verschijnen — implementeer cleanEmail() validatie voordat het wordt toegevoegd aan het bericht. Role-gebaseerde routering naar een specifiek gebruikersaccount vereist dat het user-ID voor die rol server-side wordt opgezocht (niet client-side), anders kan een kwaadaardige payload een taak aan de verkeerde gebruiker toewenen. Gedeelde mailbox (info@) exponeert alle berichten aan iedereen met mail_read-recht op dat account — RLS op mail_account_user_access borgt dit, maar de beslissing welke medewerkers toegang krijgen tot info@ is een PII/AVG-gevoelig instelbesluit.

### EX1 — Exact grootboek-omzet (directie)  
**🟡 PARTIAL** · effort **L** · Integratie · 🔒 security-gevoelig

De tabel `exact_glaccount_mappings` bestaat (migratie 20260409120000) en de UI `ExactGLAccountMappings.tsx` biedt een dropdown waarmee per uurtype (normaal, overwerk, toeslag, etc.) een grootboekrekening (Type 20 = Revenue, opgehaald via Exact API) geselecteerd kan worden. Deze mappings worden gebruikt in `exact-sync-invoice` om omzet op de juiste GL-rekening te boeken. Echter: (1) er is geen feature om omzetcijfers per geselecteerde grootboekrekening op te halen of te tonen als directie-rapport; (2) de bestaande Exact Online pagina is toegankelijk voor `finance` en `backoffice` (niet beperkt tot directie/admin); (3) de GL-mapping is bedoeld voor boeken van facturen, niet voor het ophalen/tonen van omzet-saldo's per rekening.

**Wat moet er nog:**
- Geen fetch of weergave van omzet-saldo's of boekingen per geselecteerde grootboekrekening vanuit Exact (financieel/financieel-rapport). De dropdown-config bestaat alleen voor boekings-routing, niet voor directie-rapportage.
- Geen dropdown-config in `exact_config` of `organizations.settings` voor 'welke GL-rekeningen zijn relevant voor omzet-rapportage voor directie'. De huidige mappings zijn gericht op uurtype → GL voor factuurlijnen, niet op GL-selectie voor aggregaat-omzet.
- Geen directie-specifieke toegangsrestrictie: de eis vereist 'alleen zichtbaar voor directie/beheer (dataminimalisatie)'. Nu hebben `finance` en `backoffice` ook toegang tot de Exact Online pagina. De edge function `exact-api` laat `admin`, `backoffice` en `finance` door — `backoffice` zou geblokkeerd moeten worden voor het omzet-rapport.
- Geen UI-component of pagina die omzetcijfers per geselecteerde grootboekrekening ophaalt (bijv. via financial/GLTransactions of budget/ReportingBalance in Exact API) en toont als directie-dashboard.
- Geen RLS-policy die het omzet-rapport beperkt tot admin-rol (nu is exact_glaccount_mappings toegankelijk voor alle authenticated users van de org, zonder role-check).

<details><summary>Bewijs</summary>

- `supabase/migrations/20260409120000_exact_integration_enhancements.sql:9 — CREATE TABLE exact_glaccount_mappings (hour_type_code, gl_account_id, gl_account_code)`
- `src/components/settings/ExactGLAccountMappings.tsx:63 — exactApiWithOrg: financial/GLAccounts?$filter=Type eq 20 (haalt omzetrekeningen op als dropdown)`
- `src/components/settings/ExactGLAccountMappings.tsx:88-113 — upsert mappings per hour_type_code naar exact_glaccount_mappings`
- `supabase/functions/exact-sync-invoice/index.ts:105-113 — leest exact_glaccount_mappings, bouwt glMap voor factuurregels`
- `supabase/functions/exact-api/index.ts:99 — role-check: alleen admin, backoffice, finance (niet beperkt tot directie)`
- `src/components/layout/AppSidebar.tsx:80 — Exact Online sidebar: roles=['finance','backoffice'] (admin ziet alles)`
- `src/integrations/supabase/types.ts:2996-3036 — exact_glaccount_mappings tabelstructuur aanwezig in gegenereerde types`

</details>

> 🔒 Financiële omzetcijfers zijn gevoelig (dataminimalisatie-eis). Benodigde maatregelen: (1) rol-gate in de edge function voor het nieuwe omzet-endpoint (alleen admin of een expliciete 'directie'-rol — nu is er geen 'directie' enum-waarde, rol admin is de dichtstbijzijnde); (2) RLS op een eventuele config-tabel voor geselecteerde GL-rekeningen moet beperkt zijn tot admin; (3) de Exact API proxy stuurt Bearer-tokens door naar Exact Online — het nieuwe endpoint mag geen willekeurige financial/GLTransactions queries toelaten zonder whitelist van toegestane endpoints (SSRF/endpoint-injection is al deels afgedekt in normalizeEndpoint maar financieel-specifieke endpoints vereisen expliciete whitelist of aparte action-handler).

### BB1 — Brandboek mail-layout  
**⬜ TODO** · effort **M** · E-mail

Er bestaat geen gedeelde branded e-mail-layout wrapper. Elke send-* edge function bouwt zijn eigen hardcoded HTML in dezelfde generieke slate-kleur (#1e293b header, #f4f4f5 achtergrond). De email_templates tabel en de TipTap-editor op /e-mailtemplates staan klaar voor vrije inhoud per org, maar de verzend-functies wrappen die body NIET in een huisstijl-frame (geen org-logo, geen accent_color, geen JA Werkt merkidentiteit). Alleen send-match-proposal en send-ai-analysis lezen logo_url uit organizations, maar ook zij gebruiken generieke slate-kleuren, niet het per-org accent_color uit organizations.settings. send-placement-confirmation bevat zelfs "SiteJob" hardcoded (8x) in place van de org-naam.

**Wat moet er nog:**
- Geen gedeelde _shared/email-layout.ts helper die org-logo, accent_color en een consistente JA Werkt-huisstijl-frame injecteert
- send-placement-confirmation, send-portal-invite, send-timesheet-approval, automated-messages lezen organizations.logo_url en organizations.settings.accent_color niet
- send-placement-confirmation heeft 'SiteJob' hardcoded als afzendernaam/footer (8x) — moet dynamisch org-naam worden
- email-campaign-processor wrapt body_html niet in een brand-frame; templates worden kaal verzonden
- email_templates.body_html is slechts de body-snippet; er is geen layout/wrapper-kolom of -concept in de DB
- EmailTemplateEditor preview toont geen realistisch email-frame (geen header met logo, geen footer) — designer kan het resultaat niet beoordelen
- Kleurwaarden in HTML-templates zijn hardcoded slate (#1e293b, #0f172a) i.p.v. afleidbaar uit org.settings.accent_color — niet multi-tenant-proof voor andere orgs op hetzelfde platform

<details><summary>Bewijs</summary>

- `supabase/functions/_shared/outlook-send.ts:1-166 — centrale verzender, geen HTML-wrapper of brand-inject`
- `supabase/functions/_shared/outlook-signature.ts:49-68 — fallbackSignature() en wrapSignature() bevatten geen org-kleuren, alleen generieke stijl`
- `supabase/functions/send-placement-confirmation/index.ts:122 — hardcoded 'SiteJob' in header h1; geen org logo_url fetch`
- `supabase/functions/send-placement-confirmation/index.ts:89 — '#1e293b' hardcoded header-kleur (niet accent_color uit org.settings)`
- `supabase/functions/send-portal-invite/index.ts:29 — '#1e293b' hardcoded, geen logo, geen org.settings fetch`
- `supabase/functions/send-timesheet-approval/index.ts:61-99 — generieke wrapper zonder org-logo of -kleur`
- `supabase/functions/send-match-proposal/index.ts:91-92 — wél logo_url (org.logo_url fetch op regel 203), maar hardcoded '#0f172a' header; geen org accent_color`
- `supabase/functions/send-ai-analysis/index.ts:94,204 — wél logo_url, maar eigen inline CSS, geen gedeelde brand-wrapper`

</details>

> 🔒 Geen directe security-impact. Let op: org.logo_url is een public URL die in de HTML terechtkomt; zorg voor escapeHtml() (al aanwezig in de functies die het gebruiken). Geen PII/AVG-issue specifiek voor de lay-out.

### FX1 — Flexpedia omzet/medewerkers  
**⬜ TODO** · effort **XL** · Integratie · 🔒 security-gevoelig

Flexpedia is alleen aanwezig als payroller-type in de enum en UI-labels. Er is een read-only referentie-tab in Invoices.tsx die goedgekeurde Flexpedia-timesheets toont (uren × uurtarief, gegroepeerd per bedrijf), maar dit is puur een weergave van al in de DB staande timesheets — geen Excel-import van omzet/marge per persoon/week. Er bestaat geen Flexpedia-API-koppeling, geen person-match-sleutel (geen flexpedia_id/personeelsnr-kolom op candidates), geen import-component, geen edge function, en geen DB-tabel voor Flexpedia-specifieke omzet/margedata. CLAUDE.md bevestigt expliciet "geen Flexpedia-API gebouwd". Er zijn geen branches of commits gevonden die deze feature (ook niet deels) implementeren.

**Wat moet er nog:**
- Excel-import van Flexpedia omzet/marge per persoon per week ontbreekt volledig (geen component, geen parser, geen DB-tabel voor Flexpedia-omzetdata)
- Person-match-sleutel ontbreekt: geen flexpedia_id, flexpedia_personeelsnr of vergelijkbaar veld op candidates-tabel
- Flexpedia-API-koppeling (employees ophalen/aanmaken) is niet gebouwd: geen edge function, geen OAuth/credentials-opslag, geen sync-logica
- De huidige referentie-tab in Invoices.tsx berekent een geschatte omzet op basis van interne timesheets × uurtarief — dit is NIET de Flexpedia-eigen omzet/margedata

<details><summary>Bewijs</summary>

- `src/lib/payroller.ts:1-16 — Flexpedia enkel als label/badge, en expliciet uitgesloten van JA_WERKT_PAYROLLERS`
- `src/integrations/supabase/types.ts:9382 — payroller_type enum bevat 'flexpedia'`
- `src/pages/Invoices.tsx:72-139 — read-only referentie-tab: haalt goedgekeurde timesheets op voor flexpedia-plaatsingen, toont uren + geschatte omzet; geen import-functionaliteit`
- `supabase/migrations/20260326150000_extend_placements_and_matches_meeting_26mar.sql:2 — enige migratie met 'flexpedia': aanmaken van de payroller_type enum`
- `supabase/functions/ — geen flexpedia-* edge function aanwezig`
- `src/pages/ImportData.tsx — generieke kandidaat/bedrijf CSV/Excel import, geen Flexpedia-omzet/marge velden of mapping`
- `git log --all --oneline: geen commit gevonden met 'flexpedia' + 'import'/'omzet'/'marge'; enige relevante commit a8fc428 voegt de referentie-tab toe`
- `git branch -a: geen flexpedia-branch`

</details>

> 🔒 Flexpedia-omzetdata per persoon bevat potentieel AVG-gevoelige PII (BSN/personeelsnr als match-sleutel). Een Excel-import-endpoint moet RLS + org-isolatie afdwingen. API-koppeling vereist credential-opslag via Vault (zelfde patroon als Exact/WhatsApp). Omzetdata per medewerker is financieel-gevoelig: RLS moet voorkomen dat intercedenten andermans organisatie-omzet kunnen inzien.

### DATA1 — Carerix resync + data-prep  
**🟡 PARTIAL** · effort **M** · Go-live · 🔒 security-gevoelig

De sync-infrastructuur (carerix-sync-start/-worker, AcceptanceTab met go/no-go checks, delta via modified_since) is gebouwd en deels gedeployed. De go/no-go AcceptanceTab is aanwezig in src/pages/CarerixImport.tsx. Echter: (1) de UI biedt geen modified_since-invoer voor een delta-resync, (2) de dedup-fallback code (findExistingCandidate, DOB+email/naam) die in commit a5fde54 werd gebouwd is bewust teruggedraaid/niet opgenomen in de fase1-oplevering (a0e238a) en ontbreekt nu in runner.ts — de MEMORY-note bevestigt "carerix-sync-worker moet nog gedeployed worden", (3) KVK-nummer wordt niet gemapped in de Carerix-sync (mapCompany returnt alleen name+org_id, CXCompany type heeft geen kvk-veld), (4) geen UI/tooling voor testdata-opschoning of beleid voor kandidaten zonder e-mail/telefoon.

**Wat moet er nog:**
- Resync-workflow: de UI (CarerixImport.tsx ImportTab) stuurt nooit modified_since mee — er is geen date-picker/input voor een delta-sync; een productie-resync kan alleen als full import worden gestart
- Testdata opschonen: geen UI-module, geen SQL-utility, geen edge function om testdata (aanpassingen na eerste sync) selectief te verwijderen voor een schone herstart; dit is puur operationele SQL-taak zonder tooling
- Dedup-fallback (findExistingCandidate, DOB+email/naam) is aanwezig in commit a5fde54 maar ontbreekt volledig in de huidige runner.ts (7addf6f = HEAD); bij een resync zonder dedup maakt de sync nieuwe kandidaat-rijen aan naast bestaande
- KVK handmatig matchen: Carerix companies worden via mapCompany() zonder kvk_number geïmporteerd (CXCompany-type heeft het veld niet); de kvk-lookup edge function bestaat maar wordt niet aangeroepen vanuit de sync; KVK-koppeling is volledig handmatig werk buiten de app
- Beleid kandidaten zonder e-mail/telefoon: runner.ts heeft geen skip-/flagging-logica voor kandidaten zonder e-mail of phone; CandidateQualityFlags.tsx toont 'Telefoon ontbreekt' maar dat is post-import UI, niet sync-policy; er is geen gedefinieerd gedrag (importeren met waarschuwing vs overslaan)
- 06-nummers aanvullen: als 06-nummers in Carerix als binnenlands formaat opgeslagen staan worden ze door isDutchPhone() herkend en naar phone/phone_nl gerouteerd — dit werkt al; maar als Carerix ze als buitenlands +31 heeft (of niet heeft) biedt de sync geen enrichment-stap vanuit externe bron

<details><summary>Bewijs</summary>

- `supabase/functions/carerix-sync-start/index.ts:14-19 — StartBody interface heeft modified_since veld (delta sync-support backend)`
- `supabase/functions/_shared/carerix/queries.ts:346-355 — watermarkQualifier() bouwt Carerix modificationDate qualifier voor delta sync`
- `supabase/functions/_shared/carerix/runner.ts:153 — modifiedSince wordt doorgegeven aan alle page-runners`
- `src/pages/CarerixImport.tsx:426-435 — startMut stuurt nooit modified_since mee: body = { mode, only } — UI mist delta-invoer`
- `src/pages/CarerixImport.tsx:648-1000 — AcceptanceTab aanwezig: CR*-scope, entity-coverage, aantallen, document-bytes, failures checks + go/no-go oordeel`
- `supabase/functions/_shared/carerix/mappers.ts:308-314 — mapCompany returnt alleen name+org_id, geen kvk_number, geen CRCompany-type`
- `supabase/functions/_shared/carerix/types.ts:37-41 — CXCompany interface heeft alleen _id, name, displayName; geen KVK-veld`
- `git show a5fde54:supabase/functions/_shared/carerix/runner.ts:264,266,337 — DedupResult type + findExistingCandidate() aanwezig in dedup-commit`

</details>

> 🔒 Dedup-fallback ontbreekt: een resync zonder dedup kan duplicate kandidaatrecords aanmaken die elk eigen plaatsingen/documenten/notes krijgen; dit heeft AVG-impact (dubbele dossiers zijn onbedoeld bewaard persoonsgegevens). KVK-matching via kvk-lookup edge function raakt bedrijfsidentiteit en is input voor Exact Online-sync (ChamberOfCommerce-veld in exact-sync-account:94 en exact-sync-invoice:153); foutieve KVK-nummers op companies propageren naar financiële exports.
