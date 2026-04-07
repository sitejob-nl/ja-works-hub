# Sprint 3: Huisvesting — Design Spec

**Datum:** 2026-04-07
**Scope:** Afstand-tot-werk, auto-toewijzing, huisvestingscontrole planning, wekelijkse huur
**Architectuur:** Frontend-first (past bij bestaande app-structuur)
**Geparkeerd:** Buddy huisvesting-migratie (CSV-structuur nog onbekend)

---

## Context

JA Werkt is een uitzendbureau voor arbeidsmigranten. Huisvesting is een kernproces: medewerkers worden gehuisvest in panden dicht bij hun werkplek. Sprint 3 maakt het huisvestingsproces slimmer:

- **Afstand-tot-werk** zodat de beste kamer wordt gesuggereerd op basis van rijafstand naar het bedrijf
- **Auto-toewijzing** zodat huisvesting automatisch wordt voorgesteld bij plaatsing
- **Planning-waarschuwing** zodat intercedenten zien wanneer een medewerker geen huisvesting heeft
- **Wekelijkse huur** omdat de marktstandaard weekhuur is, niet maandhuur

### Huidige staat

Het huisvestingsmodule heeft al: PropertySlideOver (6 tabs), 3-stap bewoner-wizard, `v_unit_occupancy` view, overbooking-trigger, en `getHousingSuggestions()` die rankt op collega-count + bezetting. Wat ontbreekt: afstandsberekening, automatische toewijzing, planning-integratie, en weekhuur-ondersteuning.

---

## 1. Database Migratie

### Nieuwe kolommen

**`properties` tabel:**
```sql
ALTER TABLE properties ADD COLUMN address_lat numeric;
ALTER TABLE properties ADD COLUMN address_lng numeric;
```

**`companies` tabel:**
```sql
ALTER TABLE companies ADD COLUMN address_lat numeric;
ALTER TABLE companies ADD COLUMN address_lng numeric;
```

**`housing_assignments` tabel:**
```sql
ALTER TABLE housing_assignments ADD COLUMN payment_frequency text
  CHECK (payment_frequency IN ('wekelijks', 'maandelijks'))
  DEFAULT 'wekelijks';
ALTER TABLE housing_assignments ADD COLUMN deduction_amount numeric;
-- monthly_deduction blijft voor backwards compatibility
-- Nieuwe code gebruikt deduction_amount + payment_frequency
```

### View update: `v_unit_occupancy`

Toevoegen aan de view:
- `weekly_cost` (van units)
- `monthly_cost` (van units, legacy)
- `address_lat`, `address_lng` (van properties, via unit → property join)
- `address_postal` (van properties, fallback)

---

## 2. S3.1 — Afstand-tot-werk

### Nieuw bestand: `src/lib/distance.ts`

**`geocodeAddress(street, postal, city): Promise<{lat, lng} | null>`**
- Roept PDOK Locatieserver aan: `https://api.pdok.nl/bzk/locatieserver/search/v3_1/free`
- Gratis, geen API key, CORS-friendly
- Retourneert centroïde coördinaten
- Wordt aangeroepen bij property en company create/edit

**`getDrivingDistance(fromLat, fromLng, toLat, toLng): Promise<{distanceKm, durationMin} | null>`**
- Mapbox Directions API: `https://api.mapbox.com/directions/v5/mapbox/driving/`
- Berekent echte rijafstand + rijtijd (geen hemelsbreed)
- Env var: `VITE_MAPBOX_TOKEN` (public access token, veilig voor client-side)
- Mapbox free tier: 100.000 requests/maand (ruim voldoende)

### Geocoding bij property save

**Bestand:** `src/components/housing/PropertySlideOver.tsx`

Na succesvolle property save: fire-and-forget `geocodeAddress()` call die `address_lat`/`address_lng` update op de property row. Geen blokkering van de save-flow.

### Geocoding bij company save

Zelfde patroon in company create/edit flows. `geocodeAddress()` → update `companies.address_lat/lng`.

### Suggestie-ranking uitbreiden

**Bestand:** `src/components/placement/PlacementTriggers.ts`

`getHousingSuggestions()` wijzigingen:
- Nieuwe parameter: `companyLat/Lng` (van de company bij de placement)
- Voor elke beschikbare unit: `getDrivingDistance(propertyLat, propertyLng, companyLat, companyLng)`
- `HousingSuggestion` interface uitbreiden met `distanceKm`, `durationMin`, `weeklyCost`
- Ranking: `distanceKm ASC` (primair) → `colleagueCount DESC` (secundair) → `currentOccupancy ASC`
- Fallback zonder coördinaten: huidige ranking (collega's + bezetting)

---

## 3. S3.2 — Auto-toewijzing bij plaatsing

### PlacementConfirmationDialog uitbreiden

**Bestand:** `src/components/placement/PlacementConfirmationDialog.tsx`

Bij openen van het bevestigingsdialoog:
1. Roep `getHousingSuggestions()` aan met company-coördinaten
2. Pre-fill de top-suggestie in een nieuwe "Huisvesting" sectie
3. Toon: kamernaam, pandnaam, rijafstand (km), rijtijd (min), collega-count, weekprijs, bezetting
4. Dropdown "Wijzig kamer" voor alternatieve suggesties
5. Optie "Geen huisvesting nodig" (checkbox) voor medewerkers die zelf wonen

Bij bevestiging:
- Als kamer geselecteerd → `INSERT housing_assignments` met:
  - `status: 'ingecheckt'`
  - `deduction_amount`: `unit.weekly_cost` (primair) of `unit.monthly_cost` (fallback)
  - `payment_frequency`: `'wekelijks'` als `weekly_cost` beschikbaar, anders `'maandelijks'`
  - `candidate_id`, `unit_id`, `check_in_date`
- Update `placements.housing_assignment_id` naar de nieuwe assignment

### Uitstroom-prompt

In de bestaande beëindiging/uitstroom flow:
- Check of medewerker een actieve `housing_assignment` heeft (status = `'ingecheckt'`)
- Zo ja: toon prompt "Bewoner uitchecken uit [kamernaam]?" met check-out datumveld
- Bij bevestiging: update assignment `status → 'uitgecheckt'`, set `check_out_date`
- Niet automatisch — intercedent bevestigt expliciet

---

## 4. S3.4 — Huisvestingscontrole bij planning

**Bestand:** `src/pages/Planning.tsx`

Bij het laden van placements in het weekoverzicht:
- Check per placement of `housing_assignment_id IS NULL`
- Zo ja: oranje waarschuwingsbadge op de placement card: "⚠️ Geen huisvesting"
- In de popover-detail: regel "Huisvesting: ⚠️ Niet toegewezen"
- Niet blokkerend — puur visuele hint voor de intercedent

---

## 5. S3.5 — Wekelijkse huur

### ResidentsTab wizard

**Bestand:** `src/components/housing/tabs/ResidentsTab.tsx`

Stap 3 van de bewoner-wizard:
- Voeg `payment_frequency` toggle toe: "Wekelijks" / "Maandelijks" (default: wekelijks)
- Label past zich aan: "Wekelijkse inhouding" of "Maandelijkse inhouding"
- Pre-fill `deduction_amount` vanuit `unit.weekly_cost` (bij wekelijks) of `unit.monthly_cost` (bij maandelijks)
- Sla op als `deduction_amount` + `payment_frequency`

### CostsTab

**Bestand:** `src/components/housing/tabs/CostsTab.tsx`

- Bewonerskosten tabel: toont `deduction_amount` + frequentie-label ("€95/week" of "€400/maand")
- Maandoverzicht: wekelijkse bedragen × 4,33 voor vergelijking met pandkosten (maandbasis)
- Netto resultaat berekent alles op maandbasis: `(som inhoudingen omgerekend naar maand) - pandkosten`
- Fallback: als `deduction_amount` null, gebruik `monthly_deduction` (backwards compat)

### HousingSuggestionsCard

**Bestand:** `src/components/placement/HousingSuggestionsCard.tsx`

- Toont `weeklyCost` primair: "€95/week" (i.p.v. huidige `monthlyCost` die null kan zijn)
- Toont rijafstand: "4.2 km · 8 min"
- Fix huidige bug: weekprijs-kamers toonden null omdat view alleen `monthly_cost` had

### Portal

**Bestand:** `src/components/portal/PortalHousing.tsx` (of equivalent)

- Toont `deduction_amount` + frequentie-label i.p.v. hardcoded "€X/mnd"

---

## 6. Bugfix — v_unit_occupancy view

De huidige view mist `weekly_cost`. Aangezien units nu primair `weekly_cost` gebruiken (migratie 20260326120000), moeten suggesties en cards dit veld gebruiken. De view-update in sectie 1 lost dit op.

---

## Bestanden overzicht

| Bestand | Actie | Beschrijving |
|---------|-------|--------------|
| Nieuwe migratie `.sql` | NIEUW | lat/lng, payment_frequency, deduction_amount, view update |
| `src/lib/distance.ts` | NIEUW | PDOK geocoding + Mapbox driving distance |
| `src/components/placement/PlacementTriggers.ts` | WIJZIG | getHousingSuggestions met afstand + weeklyCost |
| `src/components/placement/HousingSuggestionsCard.tsx` | WIJZIG | weeklyCost + afstand tonen, fix null-bug |
| `src/components/placement/PlacementConfirmationDialog.tsx` | WIJZIG | Huisvesting pre-fill sectie + auto-assign |
| `src/components/housing/PropertySlideOver.tsx` | WIJZIG | Geocoding na save |
| `src/components/housing/tabs/ResidentsTab.tsx` | WIJZIG | payment_frequency in wizard stap 3 |
| `src/components/housing/tabs/CostsTab.tsx` | WIJZIG | Week/maand support + omrekening |
| `src/pages/Planning.tsx` | WIJZIG | Waarschuwingsbadge geen huisvesting |
| `src/components/portal/PortalHousing.tsx` | WIJZIG | Frequentie-label |
| Company create/edit component(s) | WIJZIG | Geocoding na save |
| `src/integrations/supabase/types.ts` | REGENERATE | Na migratie |

---

## Env vars

| Var | Waar | Doel |
|-----|------|------|
| `VITE_MAPBOX_TOKEN` | `.env` (frontend) | Mapbox Directions API public token |

---

## Verificatie

1. **Migratie:** Run migratie, check dat kolommen bestaan en view correct is
2. **Geocoding:** Maak een property aan met adres in Mierlo → check dat lat/lng worden ingevuld
3. **Afstand:** Maak een placement aan → check dat suggesties rijafstand tonen en correct gerankt zijn
4. **Auto-assign:** Bevestig een plaatsing → check dat huisvesting pre-filled is en assignment wordt aangemaakt
5. **Planning:** Bekijk planning met medewerker zonder huisvesting → check oranje badge
6. **Weekhuur:** Wijs bewoner toe met weekprijs → check CostsTab maandoverzicht berekening
7. **Portal:** Login als medewerker → check dat huisvestingskosten correct frequentie-label tonen
8. **Bugfix:** Check dat HousingSuggestionsCard weekprijs toont i.p.v. null
