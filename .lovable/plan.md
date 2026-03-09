

# Volgende stap: Edge Functions + Frontend

## Status

| Stap | Status |
|------|--------|
| 1. Database migrations (4 tabellen, enums, functies, RLS) | ✅ Done |
| 2. opt-out-handler edge function | Todo |
| 3. Update whatsapp-send met pre-checks | Todo |
| 4. bulk-campaign-processor edge function | Todo |
| 5. Update whatsapp-webhook met keyword detectie | Todo |
| 6-10. Frontend (pagina, wizard, segment builder, detail, preferences) | Todo |

## Wat nu gebouwd wordt

### Edge Functions (stappen 2-5)

**A. `opt-out-handler` (nieuw)**
- Upsert `communication_preferences` (opted_out=true)
- Update alle pending `campaign_recipients` naar status=opted_out
- Increment `opted_out_count` op bijbehorende campagnes

**B. Update `whatsapp-send`**
- Pre-send check: opt-out status via `communication_preferences`
- Pre-send check: rate limit via `check_rate_limit()` RPC
- Record send via `record_rate_limit()` RPC
- Return 429 bij rate limit, 400 bij opt-out

**C. `bulk-campaign-processor` (nieuw)**
- Load campaign + segment_filter
- Get candidates via `get_campaign_candidates()` RPC
- Insert `campaign_recipients` (status=pending)
- Batch processing (50 per batch, 3s delay)
- Per candidate: merge fields, call whatsapp-send, update status + metrics
- Auto-append opt-out footer

**D. Update `whatsapp-webhook`**
- Keyword detectie ("stop", "uitschrijven", "unsubscribe", "afmelden")
- Auto-trigger opt-out-handler bij match

### Frontend (stappen 6-10)

**E. BulkCampaigns pagina + routing**
- `/bulk-campaigns` route in App.tsx
- Sidebar link toevoegen
- Campagne lijst met status badges en progress bars
- Realtime updates via Supabase Realtime

**F. SegmentBuilder component**
- Visual filters: status, skills, stad, compliance
- Live kandidaat count preview
- JSONB output

**G. CampaignWizard dialog**
- 5 stappen: basis → segment → bericht → planning → review
- Merge field helpers ({{first_name}}, {{last_name}})
- Auto opt-out footer preview

**H. CampaignDetail view**
- Progress bar, metrics (sent/failed/opted_out/pending)
- Pause/Resume/Cancel knoppen
- Recipients tabel

**I. CandidatePreferences**
- Nieuw tabblad in kandidaat detail
- Opt-out toggles per kanaal

## Implementatie aanpak

Alles in 1 batch bouwen:
1. Alle 4 edge functions (2 nieuw, 2 updates) + config.toml updates
2. Frontend pagina met alle componenten
3. Routing + sidebar integratie

