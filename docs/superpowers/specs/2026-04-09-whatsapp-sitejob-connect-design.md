# WhatsApp Integratie via SiteJob Connect - Design Spec

**Datum:** 2026-04-09
**Status:** Draft
**Scope:** Volledige herbouw WhatsApp integratie (edge functions + chat UI + campaigns)

## Context

JA Werkt heeft een bestaande WhatsApp integratie die functioneel is maar significante kwaliteitsproblemen heeft: geen paginatie (alle berichten geladen), 10s polling ipv realtime, fragiele phone matching, gebrekkig rate limiting met coarse windows, en een onvolledig campaign systeem zonder scheduler of retries. De integratie loopt via SiteJob Connect als tussenschakel voor OAuth en webhook routing, terwijl berichten direct naar de Meta WhatsApp Cloud API (v25.0) worden verstuurd.

Deze herbouw vervangt alle bestaande WhatsApp code met een schone implementatie volgens de actuele SiteJob Connect documentatie, met focus op performance, betrouwbaarheid en een professionele WhatsApp Web-achtige chat ervaring.

## Architectuur

```
Jouw systeem ──── berichten versturen ────→ Meta WhatsApp Cloud API (v25.0)
                                                    ↓ webhooks
                                            SiteJob Connect (hub)
Jouw systeem ←── webhook doorgestuurd ───── SiteJob Connect
```

**Rolverdeling:**
- **SiteJob Connect:** OAuth setup, webhook routing (doorsturen inkomende events), token refresh
- **JA Werkt:** Berichten versturen (direct Meta API), webhooks verwerken, UI, campaigns

## Aanpak: Gelaagde Herbouw

Drie lagen, elk onafhankelijk testbaar:

1. **Laag 1 - Backend:** Edge functions + DB schema + phone normalisatie
2. **Laag 2 - Chat UI:** WhatsApp-style 3-panel interface met media + templates
3. **Laag 3 - Campaigns:** Bulk processor met queue, retries, scheduler, analytics

---

## Laag 1: Edge Functions (Backend)

### Gedeelde utilities

**`supabase/functions/_shared/whatsapp-utils.ts`**
- `normalizePhone(phone: string): string` — Normaliseert elk NL telefoonformat naar E.164 (`+316xxxxxxxx`). Ondersteunt: `06-`, `+316`, `00316`, `316`, spaties, streepjes.
- `getWhatsAppCredentials(supabase, orgId): { phone_number_id, access_token, waba_id, display_phone, webhook_secret }` — Wrapper rond `get_whatsapp_token()` RPC
- `META_API_BASE = "https://graph.facebook.com/v25.0"`

### Edge Function: `whatsapp-register`

**Trigger:** POST van frontend (authenticated)
**Auth:** Bearer JWT → extract org_id via profiles
**Flow:**
1. Check of `whatsapp_config` al bestaat voor deze org
2. POST naar `https://xeshjkznwdrxjjhbpisn.supabase.co/functions/v1/whatsapp-register-tenant` met `X-API-Key: {CONNECT_API_KEY}` header
3. Body: `{ name: org.name, webhook_url: "{SUPABASE_URL}/functions/v1/whatsapp-webhook" }`
4. Response bevat `tenant_id` + `webhook_secret`
5. Upsert in `whatsapp_config`: tenant_id, webhook_secret (encrypted), is_active=false
6. Return: `{ setup_url: "https://connect.sitejob.nl/whatsapp-setup?tenant_id={id}" }`

**Idempotent:** Bij bestaande config, retourneer setup URL zonder opnieuw te registreren.

### Edge Function: `whatsapp-config`

**Trigger:** POST van SiteJob Connect (public, verify_jwt=false)
**Auth:** `X-Webhook-Secret` header validatie
**Flow:**
1. Parse body: check `action` field
2. **Credential push (geen action field of action=config):**
   - Lookup org via `tenant_id` in `whatsapp_config`
   - Valideer `X-Webhook-Secret` tegen opgeslagen (decrypted) `webhook_secret`
   - Update `whatsapp_config`: phone_number_id, access_token (encrypted), display_phone, waba_id, is_active=true
3. **Disconnect (action=disconnect):**
   - Lookup org via `tenant_id`
   - Valideer secret
   - Clear credentials, set is_active=false
4. Return 200 OK

**O(1) lookup:** Direct query op `tenant_id` kolom (indexed), geen loop over alle configs.

### Edge Function: `whatsapp-send`

**Trigger:** POST van frontend of bulk-campaign-processor (authenticated)
**Auth:** Bearer JWT → extract org_id
**Input:**
```typescript
{
  to: string,              // Telefoonnummer (wordt genormaliseerd)
  type: "text" | "template" | "image" | "video" | "audio" | "document" | "reaction",
  // Type-specifieke velden:
  text?: { body: string, preview_url?: boolean },
  template?: { name: string, language: string, components?: TemplateComponent[] },
  image?: { link?: string, id?: string, caption?: string },
  video?: { link?: string, id?: string, caption?: string },
  audio?: { link?: string, id?: string },
  document?: { link?: string, id?: string, caption?: string, filename?: string },
  reaction?: { message_id: string, emoji: string },
  // Meta:
  candidate_id?: string,   // Optioneel, voor logging
  context?: { message_id: string }  // Reply-to
}
```

**Flow:**
1. Normaliseer telefoonnummer naar E.164
2. Check opt-out status in `communication_preferences`
3. Check rate limit (sliding window)
4. Decrypt credentials via `getWhatsAppCredentials()`
5. POST naar `{META_API_BASE}/{phone_number_id}/messages`
6. Log in `communications` tabel:
   - channel: 'whatsapp', direction: 'outbound'
   - whatsapp_message_id: response.messages[0].id
   - whatsapp_status: 'pending' (webhook update naar sent/delivered/read)
   - candidate_id: matched of meegegeven
7. Record rate limit usage
8. Return: `{ success: true, message_id: wamid }`

**Read receipts:** Apart endpoint pad — als `type` = "read_receipt", stuur mark-as-read naar Meta.

### Edge Function: `whatsapp-webhook`

**Trigger:** POST van SiteJob Connect (public, verify_jwt=false)
**Auth:** `X-Webhook-Secret` header
**Flow:**
1. Valideer `X-Webhook-Secret` header: query `whatsapp_config` via `tenant_id` (uit webhook payload `id` field = WABA ID, matcht `waba_id` kolom) voor O(1) lookup. Decrypt webhook_secret en vergelijk.
2. Parse payload changes array

**Inkomende berichten (`value.messages`):**
- Extract: from, id, timestamp, type, type-specifieke data
- Normaliseer `from` naar E.164
- Match kandidaat: query `candidates` WHERE normalized phone = normalized from AND org_id
- Deduplicatie: check `whatsapp_message_id` unique constraint
- Opt-out detectie: check body tegen keywords (STOP, afmelden, uitschrijven, stoppen) — case-insensitive, hele woord match
  - Bij opt-out: update `communication_preferences`, update pending `campaign_recipients`
- Insert `communications`:
  - channel: 'whatsapp', direction: 'inbound'
  - message_type: msg.type
  - body: tekst body of `[Type: beschrijving]`
  - whatsapp_message_id, candidate_id (als matched)
  - media_url: voor media types, sla media_id op (lazy download)

**Status updates (`value.statuses`):**
- Lookup communication via `whatsapp_message_id`
- Update `whatsapp_status` (sent → delivered → read, of failed)
- Bij failed: sla error code + message op

**Altijd 200 OK retourneren.**

---

## Laag 2: Chat UI

### Component Structuur

```
src/pages/WhatsApp.tsx (hoofdpagina)
├── src/components/whatsapp/ConversationList.tsx
│   ├── ConversationSearch.tsx
│   ├── ConversationFilter.tsx
│   └── ConversationItem.tsx
├── src/components/whatsapp/ChatThread.tsx
│   ├── ChatHeader.tsx
│   ├── MessageList.tsx
│   │   ├── MessageBubble.tsx
│   │   ├── MediaMessage.tsx
│   │   └── DateSeparator.tsx
│   ├── ChatInput.tsx
│   │   ├── AttachmentPicker.tsx
│   │   └── TemplatePickerModal.tsx
│   └── ChatEmpty.tsx (geen conversatie geselecteerd)
├── src/components/whatsapp/ContactPanel.tsx
│   ├── ContactInfo.tsx
│   └── SharedMediaGallery.tsx
└── src/hooks/useWhatsAppRealtime.ts
```

### WhatsApp.tsx (Hoofdpagina)

**Layout:** 3-panel, WhatsApp Web-style
- Links: ConversationList (280px vast)
- Midden: ChatThread (flex grow)
- Rechts: ContactPanel (300px, togglable via knop in ChatHeader)

**State:**
- `selectedConversation: string | null` (phone nummer als key)
- `showContactPanel: boolean`

**Responsive:**
- Desktop (>1024px): 3 panels
- Tablet (768-1024px): 2 panels (conversaties + chat), contact als overlay
- Mobiel (<768px): 1 panel, navigatie via back button

### ConversationList

**Data:** Query `communications` gegroepeerd per genormaliseerd telefoonnummer
- JOIN met `candidates` voor naam + avatar
- Sorteer op laatste bericht timestamp DESC
- Unread count: COUNT WHERE direction='inbound' AND read_at IS NULL

**Features:**
- Zoekbalk: filter op naam of telefoon (client-side voor geladen data)
- Filter tabs: Alle | Ongelezen | Kandidaten | Onbekend
- Virtualized rendering (react-window, moet geinstalleerd worden: `npm i react-window @types/react-window`) voor performance
- Nieuwe conversatie starten: telefoon invoer of kandidaat zoeken

**Realtime:** Supabase Realtime subscription op `communications` INSERT events → update conversatielijst

### ChatThread

**MessageList:**
- Cursor-based paginatie: laad laatste 30 berichten, infinite scroll omhoog voor meer
- Datum-scheiders: "Vandaag", "Gisteren", of datum
- Auto-scroll naar nieuw bericht (tenzij gebruiker omhoog heeft gescrolld)

**MessageBubble:**
- Inbound: links, lichtgrijs achtergrond
- Outbound: rechts, groene/accent achtergrond
- Timestamp + status indicator (klok/vinkjes)
- Context menu: reageren (emoji), reply-to
- Failed berichten: rode achtergrond met error tooltip

**MediaMessage:**
- Image: thumbnail (max 300px breed), klik voor lightbox
- Video: thumbnail met play overlay, klik voor video player
- Audio: inline waveform player met play/pause
- Document: icon + bestandsnaam + download link
- Sticker: render als afbeelding
- Location: statische kaart thumbnail (Google Maps embed of placeholder)
- Contacts: naam + telefoon weergave

**ChatInput:**
- Multi-line textarea (auto-grow)
- Enter = verstuur, Shift+Enter = newline
- Attachment knop: file picker (accept image/video/audio/document)
- Template knop: opent TemplatePicker modal
- Send knop (disabled als leeg of sending)
- Upload progress indicator voor media

### TemplatePicker Modal

**Data:** Gecached in `whatsapp_templates` tabel, sync via Meta API
- Lijst van goedgekeurde templates (status=APPROVED)
- Filter op taal (nl, en, pl, ro — veelvoorkomend bij arbeidsmigranten)

**Flow:**
1. Selecteer template
2. Vul parameters in (tekstvelden per component parameter)
3. Live preview van samengesteld bericht
4. Verstuur → roept `whatsapp-send` aan met type=template

### ContactPanel

- Kandidaat avatar, volledige naam, telefoon
- Status badge
- Quick actions: "Profiel openen" (link naar `/kandidaten/:id`), "Documenten" (link naar documenten tab)
- Shared media: grid van uitgewisselde afbeeldingen/documenten
- Opt-out status: indicator of persoon heeft afgezegd

### useWhatsAppRealtime Hook

```typescript
// Subscribe to realtime changes on communications table
// Filter: channel = 'whatsapp', organization_id = current org
// Events: INSERT (nieuw bericht), UPDATE (status change)
// Returns: callback triggers React Query invalidation
```

---

## Laag 3: Campaigns

### Database Wijzigingen

**Nieuwe tabel: `whatsapp_templates`**
```sql
CREATE TABLE whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  template_name text NOT NULL,
  language text NOT NULL,
  category text,              -- MARKETING, UTILITY, AUTHENTICATION
  status text,                -- APPROVED, PENDING, REJECTED
  components jsonb,           -- Template structure from Meta
  last_synced_at timestamptz,
  UNIQUE(organization_id, template_name, language)
);
```

**Wijzigingen bestaande tabellen:**
```sql
ALTER TABLE campaign_recipients ADD COLUMN retry_count integer DEFAULT 0;
ALTER TABLE campaign_recipients ADD COLUMN next_retry_at timestamptz;
ALTER TABLE bulk_campaigns ADD COLUMN paused_at timestamptz;
ALTER TABLE bulk_campaigns ADD COLUMN cancelled_at timestamptz;
```

### CampaignWizard (Verbeterd)

**Stap 1 - Basis:** Naam, kanaal (WhatsApp)
**Stap 2 - Doelgroep:** SegmentBuilder filters + live count + sample preview (10 kandidaten)
**Stap 3 - Bericht:**
- Toggle: Vrij bericht / Template bericht
- Vrij bericht: tekst + merge fields + auto STOP-footer + preview met voorbeeld data
- Template: TemplatePicker + parameter merge fields
- Validatie: check of merge fields geldig zijn

**Stap 4 - Planning:**
- Nu versturen / Inplannen (datetime picker)
- Rate limit config (standaard: 20/min, 1000/uur)
- Samenvatting: aantal ontvangers, geschatte verzendtijd, bericht preview

### bulk-campaign-processor (Herbouwd)

**Flow:**
1. Load campaign + recipients (status=pending of status=failed AND retry_count < 3 AND next_retry_at <= now())
2. Verwerk in batches van 50
3. Per batch: 5 concurrent sends (Promise.allSettled)
4. Sliding window rate limiting: tel berichten per seconde, throttle als limiet bereikt
5. Per recipient: merge fields → whatsapp-send → update status
6. Failed: increment retry_count, set next_retry_at (exponential: 1min, 5min, 15min)
7. Check campaign status elke batch: als paused/cancelled, stop
8. Na alle recipients: set campaign status=completed
9. Realtime progress: update sent_count/failed_count na elke batch

**Scheduler:**
- pg_cron job (elke minuut): query `bulk_campaigns WHERE status='scheduled' AND scheduled_at <= now()`
- Voor elke: zet status=running, roep bulk-campaign-processor aan

### Campaign Dashboard

**Overzicht pagina (`/bulk-campaigns`):**
- Tabel: naam, status (badge), kanaal, ontvangers, sent/failed/opted_out, progress bar, datum
- Acties: Bekijken, Pauzeren/Hervatten, Annuleren

**Detail pagina (`/bulk-campaigns/:id`):**
- Campaign info header
- Progress cards: Totaal, Verstuurd, Mislukt, Opt-out
- Recipient tabel: naam, telefoon, status, error, retry count
- Delivery analytics: pie chart (sent/delivered/read/failed)

---

## Database Schema Wijzigingen Samenvatting

1. **Index toevoegen:** `whatsapp_config.tenant_id` (voor O(1) webhook lookup)
2. **Index toevoegen:** `candidates.phone` (voor phone matching, genormaliseerd)
3. **Nieuwe tabel:** `whatsapp_templates` (template cache)
4. **Alter:** `campaign_recipients` + retry_count, next_retry_at
5. **Alter:** `bulk_campaigns` + paused_at, cancelled_at
6. **Alter:** `communications` + message_type kolom (text/image/video/etc.), media_id kolom

---

## Beveiliging

- **Webhook validatie:** X-Webhook-Secret header op elk inkomend webhook request
- **Credential opslag:** access_token en webhook_secret via Supabase Vault (`encrypt_sensitive()`)
- **Token refresh:** Afgehandeld door SiteJob Connect (tokens verlopen na 60 dagen)
- **Opt-out compliance:** Altijd checken voor verzending, STOP-footer op campagne berichten
- **Rate limiting:** Sliding window per org per kanaal, voorkomt Meta API throttling
- **CORS:** Alleen eigen domein toestaan op edge functions
- **RLS:** Alle queries gefilterd op organization_id

---

## Verificatie

### Laag 1 (Backend) testen:
1. `whatsapp-register`: Roep aan via frontend → check whatsapp_config record aangemaakt
2. `whatsapp-config`: Simuleer Connect callback → check credentials opgeslagen
3. `whatsapp-send`: Verstuur tekstbericht → check Meta API call + communications record
4. `whatsapp-webhook`: POST simulatie van inkomend bericht → check communications record + candidate matching

### Laag 2 (Chat UI) testen:
1. Open `/whatsapp` → conversatielijst laadt
2. Selecteer conversatie → berichten laden met paginatie
3. Verstuur bericht → optimistic update + edge function call
4. Ontvang bericht (via webhook) → realtime update in UI
5. Stuur media → upload + preview in chat
6. Template picker → selecteer, vul params, verstuur
7. Mobiel: responsive layout test

### Laag 3 (Campaigns) testen:
1. Maak campagne → wizard flow compleet
2. Verstuur nu → processor start, progress updates realtime
3. Pauzeer/hervat campagne → processor respecteert status
4. Failed berichten → retry na interval
5. Scheduled campagne → pg_cron triggert op tijd
6. Dashboard → analytics correct weergegeven

---

## Bestanden om te wijzigen/maken

### Nieuwe bestanden:
- `supabase/functions/_shared/whatsapp-utils.ts`
- `src/components/whatsapp/ConversationList.tsx`
- `src/components/whatsapp/ConversationSearch.tsx`
- `src/components/whatsapp/ConversationFilter.tsx`
- `src/components/whatsapp/ConversationItem.tsx`
- `src/components/whatsapp/ChatThread.tsx`
- `src/components/whatsapp/ChatHeader.tsx`
- `src/components/whatsapp/MessageList.tsx`
- `src/components/whatsapp/MessageBubble.tsx`
- `src/components/whatsapp/MediaMessage.tsx`
- `src/components/whatsapp/DateSeparator.tsx`
- `src/components/whatsapp/ChatInput.tsx`
- `src/components/whatsapp/AttachmentPicker.tsx`
- `src/components/whatsapp/TemplatePicker.tsx`
- `src/components/whatsapp/ChatEmpty.tsx`
- `src/components/whatsapp/ContactPanel.tsx`
- `src/components/whatsapp/ContactInfo.tsx`
- `src/components/whatsapp/SharedMediaGallery.tsx`
- `src/hooks/useWhatsAppRealtime.ts`

### Te vervangen bestanden:
- `supabase/functions/whatsapp-register/index.ts` (herbouw)
- `supabase/functions/whatsapp-config/index.ts` (herbouw)
- `supabase/functions/whatsapp-send/index.ts` (herbouw)
- `supabase/functions/whatsapp-webhook/index.ts` (herbouw)
- `supabase/functions/bulk-campaign-processor/index.ts` (herbouw)
- `src/pages/WhatsApp.tsx` (herbouw)
- `src/components/campaigns/CampaignWizard.tsx` (verbeter)
- `src/components/settings/WhatsAppSettings.tsx` (update)

### Bestaande bestanden hergebruiken:
- `src/integrations/supabase/client.ts` — Supabase client
- `src/hooks/useOrganizationId.ts` — org context
- `src/lib/audit.ts` — logAudit()
- `src/lib/format.ts` — datum/valuta formatting
- `src/components/ui/*` — shadcn/ui componenten
- `supabase/functions/_shared/cors.ts` — CORS headers
