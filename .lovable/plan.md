

# Bugfix Plan: 8 Issues

## 1. KRITIEK — Vacature detailpagina laadt niet

**Oorzaak**: De Supabase query in `VacancyDetail.tsx` (regel 39) doet een join op `company_contacts!company_contacts_company_id_fkey`, maar die FK verwijst naar `companies`, niet naar `vacancies`. PostgREST kan die relatie niet resolven via `vacancies` en gooit een error, waardoor de query faalt en de pagina op "Laden..." blijft hangen.

**Fix**: Verwijder de `company_contacts` join uit de `.select()`. Haal contactpersonen op in een aparte query of via de company relatie.

**Bestand**: `src/pages/VacancyDetail.tsx` regel 39

---

## 2. Globale zoekbalk werkt niet

**Oorzaak**: De zoekbalk in `TopBar.tsx` is een statische `<input>` zonder event handlers — geen `onChange`, geen `onKeyDown`, geen navigatie.

**Fix**: Implementeer een functionele zoekbalk:
- State voor zoekterm
- Bij Enter of na debounce: navigeer naar een zoekresultatenpagina of filter op kandidaten/medewerkers/opdrachtgevers
- Simpelste aanpak: bij Enter navigeer naar `/kandidaten?q=...` of een dedicated `/zoeken?q=...` route
- Alternatief: Command palette (Cmd+K) met zoekresultaten uit meerdere tabellen

**Bestand**: `src/components/layout/TopBar.tsx`

---

## 3. Marge is overal €0

**Oorzaak**: In `KpiDashboard.tsx` worden revenue en cost beide berekend met dezelfde `hourly_rate`. De `placements` tabel heeft maar één `hourly_rate` kolom (= kostprijs). Er is geen apart verkooptarief.

De `rate_agreements` tabel bevat wél een `hourly_rate` per company/functie, maar die wordt niet gebruikt in de KPI-berekening.

**Fix**:
1. Voeg een `client_hourly_rate` kolom toe aan de `placements` tabel (= factuurtarief aan klant)
2. Update de KPI-query: revenue = `client_hourly_rate × uren`, cost = `hourly_rate × uren`
3. Fallback: als `client_hourly_rate` leeg is, gebruik `rate_agreements.hourly_rate` voor de betreffende company
4. Update de PlacementSheet/forms om het verkooptarief in te vullen

**Database migratie**: `ALTER TABLE placements ADD COLUMN client_hourly_rate numeric;`

**Bestanden**: `src/components/dashboard/KpiDashboard.tsx`, placement-gerelateerde formulieren

---

## 4. DialogTitle ontbreekt (accessibility)

**Oorzaak**: `CommandDialog` in `src/components/ui/command.tsx` wraps `DialogContent` zonder `DialogTitle`.

**Fix**: Voeg een visueel verborgen `DialogTitle` toe met `sr-only` class.

**Bestand**: `src/components/ui/command.tsx`

---

## 5. Dashboard X-as labels overlappen

**Oorzaak**: De omzetgrafiek is een horizontale bar chart met `XAxis` die `€0k, €0k, €1k` toont — te veel ticks voor kleine bedragen.

**Fix**: Configureer `XAxis` met `tickCount`, `allowDecimals={false}`, en een betere formatter die lage bedragen als gehele euro's toont i.p.v. k-notatie.

**Bestand**: `src/components/dashboard/KpiDashboard.tsx`

---

## 6. Ontbrekende documenten — geen actieknop

**Fix**: Voeg een "Upload document" knop toe per medewerker in de `MissingDocumentsCard`, die direct navigeert naar het documenten-tab van die medewerker.

**Bestand**: `src/components/dashboard/DashboardWidgets.tsx`

---

## 7. Inactieve opdrachtgevers in margetabel

**Fix**: Filter `revenueByClient` om alleen entries met `hours > 0` of `revenue > 0` te tonen, zodat companies zonder activiteit niet verschijnen.

**Bestand**: `src/components/dashboard/KpiDashboard.tsx`

---

## 8. Notificatiebel altijd leeg

**Oorzaak**: De `employee_notifications` tabel wordt uitgelezen maar er worden nergens automatisch records aangemaakt. Er is geen trigger of cron-job die notificaties genereert op basis van aflopende documenten, achterstallige huur, etc.

**Fix**: Maak een Supabase Edge Function `generate-notifications` die periodiek:
- Aflopende contracten → `contract_aflopend` notificatie
- Verlopen documenten → `document_verlopen` notificatie
- Ontbrekende documenten → `document_ontbrekend` notificatie
- Openstaande uren → `uren_openstaand` notificatie
- Verjaardagen → `verjaardag` notificatie

Roep deze aan vanuit de dashboard-pagina (lazy) of via een cron trigger. De functie controleert of er al een recente notificatie bestaat om duplicaten te voorkomen.

**Bestanden**: Nieuwe edge function + aanroep vanuit Dashboard

---

## Samenvatting volgorde

1. Vacature detail fix (kritiek, 1 regel)
2. Marge fix (DB migratie + code)
3. Zoekbalk implementatie
4. Notificatie-generatie
5. Overige UX fixes (DialogTitle, chart labels, actieknoppen, filters)

