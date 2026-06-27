# Data-laag conventies

> Status: levend document. Ingevoerd als onderdeel van de data-laag-adoptie (tech-debt
> programma, Track B). Doel: de ad-hoc directe Supabase-calls in components/pages
> incrementeel naar de bestaande dunne data-laag brengen — **zonder gedragswijziging**.

## De doelvorm: in-place, geen repository-laag

Een query blijft **inline in de component/hook** via drie bestaande primitieven:

- `qk.*` (`src/lib/query-keys.ts`) — één bron van waarheid voor cache-keys.
- `unwrap` / `unwrapList` (`src/lib/db.ts`) — vervangen de `if (error) throw error; return data ?? []`-boilerplate.
- `useOrgQuery` (`src/lib/org-scope.ts`) — **alleen** voor onvoorwaardelijke org-queries (zie waarschuwing onder).

We introduceren **geen** `src/data/<domain>.ts`-repositorylaag. Kolomselecties zijn per scherm;
een repository-hop zou voor ~80% van de queries alleen ceremonie toevoegen. Het canonieke
voorbeeld is [`TimesheetEntrySheet.tsx`](../src/components/timesheets/TimesheetEntrySheet.tsx) —
volledig gemigreerd, leest schoon, nul nieuwe abstractie.

### Before → after

```ts
// VOOR
const { data: hourTypes = [] } = useQuery({
  queryKey: ['placement-hour-types', placementId],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('placement_hour_types').select('*').eq('placement_id', placementId).order('sort_order');
    if (error) throw error;
    return data ?? [];
  },
  enabled: !!placementId,
});

// NA — identieke key (qk geeft dezelfde array), boilerplate weg
const { data: hourTypes = [] } = useQuery({
  queryKey: qk.placements.hourTypes(placementId),
  queryFn: () => unwrapList(
    supabase.from('placement_hour_types').select('*').eq('placement_id', placementId).order('sort_order'),
  ),
  enabled: !!placementId,
});
```

## De gouden regel: leidend token verbatim

TanStack invalideert op **prefix**. Bestaande code doet o.a.
`invalidateQueries({ queryKey: ['vehicle-damage', id] })` (6×), `['property']` (12×), `['candidates']` (17×).
Een `qk.*`-entry **moet het bestaande leidende token exact reproduceren**, anders stopt een scherm
stil met auto-verversen na een mutatie — met groene CI.

Daarom: **elke nieuwe `qk.*`-entry krijgt een assertie in
[`src/test/query-keys.test.ts`](../src/test/query-keys.test.ts)** die de exacte array pint. Dat is de
deterministische, CI-gated regressie-vanger (waardevoller dan de ESLint-guard, die alleen het
boilerplate-patroon flagt). Grep vóór migratie de `invalidateQueries`-tokens van het domein en
reproduceer ze 1-op-1.

## `useOrgQuery` ⚠️ alleen onvoorwaardelijk

`useOrgQuery` roept `useOrganizationId()` **onvoorwaardelijk** aan, en die hook **throwt** als er geen
org is. Veel call-sites gebruiken bewust `enabled: !!orgId` als defensieve short-circuit. **Migreer die
NIET naar `useOrgQuery`** — houd de gewone `useQuery` + `enabled: !!orgId` en wissel alleen de
queryFn-body (`unwrap`/`unwrapList`) en de queryKey (`qk.*`). `useOrgQuery` is uitsluitend voor
sites die `useOrganizationId()` al onvoorwaardelijk aanroepen (zoals het talentpools-voorbeeld in
zijn eigen docstring).

## `unwrap` behoudt null

`unwrap<T>()` geeft `data` ongewijzigd terug (kan `null` zijn), net als de oude `data as T`-paden.
**Laat downstream optional chaining staan** (`data?.settings`). Raak tijdens een migratie alleen de
queryFn-body + key aan — niet de render/afgeleide code. Gebruik `unwrapList` voor lijst-queries
(geeft `[]` i.p.v. `null`, spiegelt het `?? []`-idioom).

## Allowlist — wat rauw mag blijven

Niet alles hoort door `unwrap`. Laat rauw (met een korte comment) staan:

- **Storage** (`supabase.storage.from(...).createSignedUrl/upload/download`).
- **Auth** (`supabase.auth.*`).
- **Bewust ge-swallowde fouten** (bv. `const { data } = await ...` zonder `error`, zoals
  `useModuleEnabled.ts`) — die mogen niet throwen.
- **Edge functions** (`supabase/functions/**`) — die kunnen `src/lib/db.ts` niet importeren; de
  data-laag is uitsluitend frontend.

De ESLint-guard (Track B2) staat op `warn` en matcht alleen het `const { data, error } = await supabase…`-
boilerplate; voor een legitieme uitzondering: `// eslint-disable-next-line no-restricted-syntax` met een
één-regel-rechtvaardiging.

## Promoveren naar een hook — alleen bij echte dedup

Een query "promoveert" naar een gedeelde hook in `src/hooks/use<Domain>*.ts` **alléén** wanneer:

1. hij door ≥2 componenten wordt hergebruikt, **of**
2. hij niet-triviale post-fetch-transformatie draagt (zie `useWhatsAppConversations.ts`).

Anders blijft hij inline. Geen single-consumer wrapper-hooks.

## Migratie-volgorde & gevoelige paden

Volgorde op churn × dichtheid: **transport → zware pagina's (FuelCardAnalysis/VehicleDetail) →
housing → employees**, daarna opportunistisch (de `warn`-regel vuurt op aangeraakte files). Cap op
**3–4 files per PR** zodat de diff leesbaar blijft.

**Migrate-last / niet opportunistisch aanraken:** `src/pages/superadmin/*` (laag-churn, hoog-risico)
en decrypt-paden (`useDecryptedCandidate.ts` e.d. raken gedecrypte PII). En: **log nooit unwrapped
rij-data** in een toekomstige hook of in `toastError` — die surfacet alleen `error.message`, houd dat zo.
