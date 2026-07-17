# WhatsApp Cloud API + SiteJob Connect — integratie-audit (2026-07-17)

Volledige doorlichting van de WhatsApp-integratie: **koppelen, ontkoppelen, templates
(maken/lijst/verwijderen/synchroniseren), berichten versturen en de inkomende webhook**.
Getoetst tegen (a) de `sitejob-connect-integratie`-referentie (push-model), en (b) de
**officiële Meta WhatsApp Cloud API-docs** (primaire bron, geverifieerd per claim).

Basis: `origin/main` (`290101c`). Let op: de lokale `main`-checkout liep 132 commits achter;
productie draait het gerefactorde `outbound-whatsapp-module` (o.a. `sendOutboundWhatsApp`,
provider-adapter). Audit + fixes zijn op een verse worktree vanaf `origin/main` gedaan.

## Wat al goed staat (geen wijziging nodig)

- **Koppelen** (`whatsapp-register`): registreert tenant idempotent bij Connect, encrypt het
  `webhook_secret`, slaat config op, opent de setup-popup. Sinds kort per-org webhook-URL
  (`?organization_id=`). Gated op `settings.manage`.
- **Config-push** (`whatsapp-config`): valideert `X-Webhook-Secret`, verwerkt de 3 gevallen
  (initiële credentials, refresh, `action: disconnect|suspended`), encrypt het `access_token`.
- **Ontkoppelen** (`whatsapp-disconnect`): roept Connect `tenant-disconnect` (secret in header),
  wist lokale credentials. Gated op `settings.manage`.
- **Templates synchroniseren** (`whatsapp-templates-sync`): haalt Meta-templates op, upsert +
  verwijdert verweesde. Gated op `settings.manage`.
- **Webhook** (`whatsapp-webhook`): shape `{ id: WABA_ID, changes: [...] }` klopt met wat Connect
  doorstuurt; `entry[].id` = WABA-id (Meta-conform); secret-validatie; dedup via unique index;
  ziekmelding-/opt-out-flows. De `match_ja:`/`match_nee:`-knoppen worden als **interactive**
  buttons verstuurd, dus de `interactive.button_reply.id`-tak vangt ze correct af.
- **Graph API v25.0**: bevestigd als actuele, niet-deprecated versie (Meta, uitgebracht 2026-02-18).

## Gevonden & gefixt

### 1. Autorisatie-gat: `whatsapp-send` en `whatsapp-api` niet rol-gated (HIGH)
`whatsapp-register/-disconnect/-templates-sync` gaten al op `settings.manage`, maar
`whatsapp-send` en `whatsapp-api` gebruikten `getAuthenticatedOrg` (alleen org-lidmaatschap).
Beide functies draaien met de **service-role client** en omzeilen RLS — dus een portal-rol
(`medewerker`/`opdrachtgever`) met een geldige JWT kon:
- namens de organisatie WhatsApp **versturen** (kosten/spam/reputatie), en
- via de generieke Meta-proxy **templates aanmaken/verwijderen**, profiel wijzigen, QR-codes en
  analytics beheren.

**Fix:** beide nu gegated met `requireInternalProfile` (`_shared/auth.ts`) — blokkeert alleen
portal-rollen, alle interne rollen behouden toegang. `/whatsapp` heeft geen route-gate, dus de
edge-functie is het echte handhavingspunt.

### 2. Template maken — verkeerde/ontbrekende Meta-velden (functioneel, "templates maken")
Getoetst tegen Meta's template-create-docs + supported-languages-tabel:
- **Locale `pt` bestaat niet** bij Meta (alleen `pt_BR` / `pt_PT`). Een template aanmaken óf
  versturen met `language: pt` faalt. → vervangen door **`pt_PT`** (Portugees) + **`pt_BR`**
  (Braziliaans). `en`/`es` bare codes zijn wél geldig (geverifieerd — blijven ongewijzigd).
- **Media-header zonder handle.** Bij een IMAGE/VIDEO/DOCUMENT-header stuurde de UI
  `{ type:'HEADER', format }` zónder `example.header_handle`. Meta **vereist** een handle uit de
  Resumable Upload API bij het aanmaken → Meta weigert de template. Die upload-infra (Meta App-ID)
  hebben we niet. → media-header-opties **verwijderd** uit de create-dialog; tekst-headers en
  geen-header werken betrouwbaar (de use-cases van een uitzendbureau: uitnodiging, bevestiging,
  documentherinnering).
- **`parameter_format` expliciet.** Body gebruikt positionele `{{1}}`. `POSITIONAL` is default,
  maar expliciet meesturen voorkomt afwijzing als de WABA-default op `NAMED` staat.

### 3. Template verwijderen — verwijderde alle taalvarianten (minor)
`TemplateManager` gaf `id` mee, maar `whatsapp-api delete_template` verwacht `hsm_id`. Zonder
`hsm_id` verwijdert Meta **alle** taalvarianten met die naam. → nu per-taal via `hsm_id` (met
numerieke guard; valt terug op naam-delete als het geen echt Meta-id is). Belangrijker nu we
`pt_PT`/`pt_BR` (zelfde naam, andere taal) ondersteunen.

### 4. Taal-labels aangevuld (cosmetisch)
`pt_PT`/`pt_BR` (+ overige codes) toegevoegd aan de labelmaps in `TemplateCard`/`TemplatePicker`.

## Geverifieerd tegen primaire Meta-bron (kernpunten)

- Create-payload is **UPPERCASE** (`HEADER`/`BODY`/`BUTTONS`, `MARKETING`/`UTILITY`/`AUTHENTICATION`);
  send-payload is **lowercase** (`header`/`body`, `quick_reply`). De code doet dit correct.
- `TRANSACTIONAL`/`OTP` zijn géén categorieën meer (UI biedt ze niet aan — goed).
- Body-voorbeelden = array-of-arrays `example.body_text:[[...]]` (correct in code).
- Webhook-signatuur naar Connect = `X-Webhook-Secret` (Connect-model); Meta's eigen
  `X-Hub-Signature-256` wordt door Connect afgehandeld vóór doorsturen.

## Niet gewijzigd — bewuste keuzes / opvolgpunten

- **`whatsapp_templates` DELETE-RLS is org-only** (niet intern-gated) in productie. Laag risico:
  de UI verwijdert templates via de Meta-API (`whatsapp-api`, nu intern-gated), niet via directe
  tabel-DELETE. Kan later met een migratie strakker.
- **AUTHENTICATION-categorie** in de create-dialog: Meta eist voor auth-templates een vaste
  OTP-structuur; een vrije body wordt geweigerd. Een uitzendbureau maakt deze niet — gelaten,
  eventueel later uit de dropdown halen.
- **24-uurs venster** bij de match-interesse-knoppen: interactive buttons kunnen alleen binnen
  het servicevenster; eerste-contact-outreach vereist een template. Bestaand ontwerp, buiten
  scope van deze audit.

## Verificatie

`npm run typecheck` ✓ · `npm run lint` ✓ (0 errors) · `npm run test` ✓ (288) · `npm run build` ✓ ·
`deno check` op alle gewijzigde edge-functions ✓.

## Nog te doen om live te gaan

De edge-functie-fixes (`whatsapp-send`, `whatsapp-api`) worden **niet** live door een merge —
die deployt alleen de frontend (Vercel). Deploy vereist:

```
supabase functions deploy whatsapp-send whatsapp-api --project-ref noaupcteygfvlyymqtew
```

(CLI bundelt `_shared/auth.ts` + `_shared/whatsapp-utils.ts` automatisch en leest `verify_jwt`
uit `config.toml`; draai buiten de sandbox.)
