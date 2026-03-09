

# Fase 3: Bulk Communicatie met Gesegmenteerde WhatsApp Outreach

## Samenvatting
Implementatie van een compleet bulk communicatie systeem met:
- Gesegmenteerde WhatsApp campagnes met visual query builder
- Rate limiting (20 msg/min, 1000/uur)
- Anti-spam bescherming
- Opt-out management per kanaal
- Real-time voortgang tracking

## Huidige Situatie

**Bestaande WhatsApp infrastructuur:**
- ✅ `whatsapp-send` edge function voor 1-op-1 berichten
- ✅ `whatsapp-webhook` voor inkomende berichten en status updates
- ✅ `whatsapp_config` tabel (organization_id, tenant_id, phone_number_id, access_token, webhook_secret)
- ✅ `communications` tabel met channel enum (whatsapp, email, voip, sms, notitie)
- ✅ WhatsApp UI pagina voor conversaties
- ✅ Candidates tabel met phone veld

**Ontbrekend:**
- Geen bulk messaging capability
- Geen opt-out/voorkeuren management
- Geen rate limiting
- Geen campagne tracking
- Geen segment builder

## Database Schema (4 nieuwe tabellen)

### 1. communication_preferences
Opt-out beheer per kanaal per kandidaat
```
- id: uuid (PK)
- organization_id: uuid (FK, NOT NULL)
- candidate_id: uuid (FK candidates, NOT NULL)
- channel: communication_channel (FK naar bestaand enum)
- opted_out: boolean (default false)
- opted_out_at: timestamptz
- opted_out_reason: text
- created_at/updated_at: timestamptz
- UNIQUE constraint op (candidate_id, channel, organization_id)
```

### 2. bulk_campaigns
Campagne metadata en configuratie
```
- id: uuid (PK)
- organization_id: uuid (FK, NOT NULL)
- name: text (NOT NULL)
- channel: communication_channel (default 'whatsapp')
- status: enum (draft, scheduled, running, paused, completed, cancelled)
- message_template: text (NOT NULL) - met {{first_name}}, {{last_name}} placeholders
- segment_filter: jsonb - {"status": ["beschikbaar"], "skills": ["VCA"]}
- total_recipients: integer (default 0)
- sent_count: integer (default 0)
- failed_count: integer (default 0)
- opted_out_count: integer (default 0)
- scheduled_at: timestamptz (nullable)
- started_at: timestamptz (nullable)
- completed_at: timestamptz (nullable)
- created_by: uuid (FK profiles)
- rate_limit_per_minute: integer (default 20)
- rate_limit_per_hour: integer (default 1000)
- created_at/updated_at: timestamptz
```

### 3. campaign_recipients
Per-kandidaat tracking voor campagnes
```
- id: uuid (PK)
- organization_id: uuid (FK, NOT NULL)
- campaign_id: uuid (FK bulk_campaigns, ON DELETE CASCADE)
- candidate_id: uuid (FK candidates)
- status: enum (pending, sent, failed, opted_out)
- sent_at: timestamptz (nullable)
- communication_id: uuid (FK communications, nullable)
- error_message: text (nullable)
- created_at: timestamptz
- INDEX op (campaign_id, status)
- INDEX op (organization_id, candidate_id)
```

### 4. rate_limit_tracking
Sliding window rate limiting per organisatie
```
- id: uuid (PK)
- organization_id: uuid (FK, NOT NULL)
- channel: communication_channel
- window_start: timestamptz (NOT NULL)
- window_type: enum (minute, hour)
- messages_sent: integer (default 0)
- created_at: timestamptz
- UNIQUE op (organization_id, channel, window_type, window_start)
```

### Enums
```sql
CREATE TYPE campaign_status AS ENUM ('draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled');
CREATE TYPE campaign_recipient_status AS ENUM ('pending', 'sent', 'failed', 'opted_out');
CREATE TYPE rate_limit_window AS ENUM ('minute', 'hour');
```

### Database Functies
```sql
-- Get filtered candidates voor campagne (SECURITY DEFINER)
CREATE FUNCTION get_campaign_candidates(
  p_org_id uuid,
  p_filter jsonb,
  p_channel communication_channel
) RETURNS TABLE (
  candidate_id uuid,
  phone text,
  first_name text,
  last_name text
)

-- Check rate limit (STABLE)
CREATE FUNCTION check_rate_limit(
  p_org_id uuid, 
  p_channel communication_channel,
  p_window_type rate_limit_window
) RETURNS boolean

-- Record send (VOLATILE)
CREATE FUNCTION record_rate_limit(
  p_org_id uuid,
  p_channel communication_channel
) RETURNS void
```

## Edge Functions

### 1. bulk-campaign-processor (NIEUW)
Batch verwerking engine
- Input: `{ campaign_id }`
- Logica:
  1. Load campaign + segment_filter
  2. Get matching candidates via `get_campaign_candidates()`
  3. Exclude opted-out (join communication_preferences)
  4. Insert campaign_recipients (status=pending)
  5. Set campaign status=running, started_at=now()
  6. FOR EACH batch (50 kandidaten):
     - Check rate limits (both minute + hour)
     - IF limit reached: sleep 60s, retry
     - FOR EACH candidate:
       - Replace {{first_name}}, {{last_name}} in template
       - Call whatsapp-send
       - Update campaign_recipients.status
       - Increment campaign metrics
     - Sleep 3s tussen batches
  7. Set status=completed, completed_at=now()

### 2. opt-out-handler (NIEUW)
Opt-out management
- Input: `{ candidate_id, channel, reason? }`
- Logica:
  1. Upsert communication_preferences (opted_out=true)
  2. Update all pending campaign_recipients for kandidaat → status=opted_out
  3. Decrement campaign.opted_out_count

### 3. whatsapp-send (UPDATE)
Pre-send validatie toevoegen
```typescript
// TOEVOEGEN vóór Meta API call:

// 1. Check opt-out status
const { data: prefs } = await supabase
  .from('communication_preferences')
  .select('opted_out')
  .eq('candidate_id', candidate_id)
  .eq('channel', 'whatsapp')
  .maybeSingle();

if (prefs?.opted_out) {
  return Response(400, { error: 'Kandidaat heeft zich afgemeld' });
}

// 2. Check + record rate limit
const canSend = await supabase.rpc('check_rate_limit', {
  p_org_id: orgId,
  p_channel: 'whatsapp',
  p_window_type: 'minute'
});

if (!canSend) {
  return Response(429, { error: 'Rate limit bereikt' });
}

await supabase.rpc('record_rate_limit', { 
  p_org_id: orgId, 
  p_channel: 'whatsapp' 
});
```

### 4. whatsapp-webhook (UPDATE)
Keyword detectie toevoegen
```typescript
// NA line 59 (bodyText extractie):

// Keyword detection
const keywords = ['stop', 'uitschrijven', 'unsubscribe', 'afmelden'];
const lowercaseBody = bodyText.toLowerCase();

if (keywords.some(k => lowercaseBody.includes(k))) {
  // Trigger opt-out
  await supabase.functions.invoke('opt-out-handler', {
    body: {
      candidate_id: candidateId,
      channel: 'whatsapp',
      reason: `Keyword detected: ${bodyText}`
    }
  });
}
```

## Frontend Componenten

### 1. BulkCampaigns Page (`src/pages/BulkCampaigns.tsx`)

**Layout:**
```
┌─────────────────────────────────────────┐
│ Bulk Campagnes                          │
│ ┌──────────┐  [Filter ▼] [Status ▼]    │
│ │+ Nieuw   │                            │
│ └──────────┘                            │
├─────────────────────────────────────────┤
│ Campagne lijst (Table)                  │
│ - Naam                                  │
│ - Kanaal badge                          │
│ - Status badge (running/completed/etc.) │
│ - Voortgang (sent/total) + progress bar │
│ - Created at                            │
│ - Acties (bekijk/pauzeer/annuleer)      │
└─────────────────────────────────────────┘
```

**Realtime updates:**
```typescript
useEffect(() => {
  const channel = supabase
    .channel('bulk-campaigns-realtime')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'bulk_campaigns',
      filter: `organization_id=eq.${orgId}`
    }, payload => {
      queryClient.setQueryData(['bulk-campaigns'], old => 
        old.map(c => c.id === payload.new.id ? payload.new : c)
      );
    })
    .subscribe();
  
  return () => { channel.unsubscribe(); };
}, []);
```

### 2. CampaignWizard (Dialog Component)

5-stappen wizard:
1. **Basis**: Naam input, kanaal select (WhatsApp fixed voor nu)
2. **Segment**: SegmentBuilder component
3. **Bericht**: Textarea met merge fields helper ({{first_name}}, {{last_name}})
4. **Schema**: RadioGroup (Nu/Later) + DateTimePicker
5. **Review**: Preview aantal + segment summary + bevestiging

### 3. SegmentBuilder Component (`src/components/bulk/SegmentBuilder.tsx`)

Visual query builder:
```tsx
<div className="space-y-4">
  <Select label="Status" multiple>
    <option>nieuw</option>
    <option>beschikbaar</option>
    <option>in dienst</option>
  </Select>
  
  <TagInput label="Skills" />
  
  <Select label="Compliance">
    <option>compliant</option>
    <option>incompleet</option>
  </Select>
  
  <Input label="Stad" />
  
  <Checkbox checked disabled>
    Heeft telefoonnummer (verplicht)
  </Checkbox>
  
  <Alert>
    <Users className="h-4 w-4" />
    <AlertDescription>
      <strong>247 kandidaten</strong> voldoen aan deze criteria
    </AlertDescription>
  </Alert>
</div>
```

JSONB output format:
```json
{
  "status": ["beschikbaar", "nieuw"],
  "skills": ["VCA", "Heftruck"],
  "compliance_status": ["compliant"],
  "city": "Amsterdam",
  "has_phone": true
}
```

### 4. CampaignDetail View

Klik op campagne in lijst → navigeer naar `/bulk-campaigns/:id`

```
┌─────────────────────────────────────────┐
│ ← Terug    [Pauzeer] [Annuleer]         │
├─────────────────────────────────────────┤
│ Campagne naam                           │
│ Status: Running                         │
│                                         │
│ Progress: 145/250 (58%)                 │
│ ████████████░░░░░░░░                    │
│                                         │
│ ┌─────────┬─────────┬─────────┬───────┐│
│ │ Sent    │ Failed  │Opted out│Pending││
│ │   145   │    3    │    2    │  100  ││
│ └─────────┴─────────┴─────────┴───────┘│
│                                         │
│ Recipients lijst (Table)                │
│ - Naam                                  │
│ - Status badge                          │
│ - Sent at                               │
│ - Error (indien failed)                 │
└─────────────────────────────────────────┘
```

### 5. CandidatePreferences (in CandidateDetail)

Nieuw tabblad "Communicatie"
```tsx
<Table>
  <thead>
    <tr>
      <th>Kanaal</th>
      <th>Status</th>
      <th>Afgemeld op</th>
      <th>Reden</th>
      <th>Acties</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><Badge>WhatsApp</Badge></td>
      <td>
        <Switch 
          checked={!optedOut} 
          onCheckedChange={handleToggle}
        />
      </td>
      <td>12-01-2024</td>
      <td>Keyword: STOP</td>
      <td><Button variant="ghost">Wijzig</Button></td>
    </tr>
  </tbody>
</Table>
```

## Anti-Spam & Rate Limiting

**Rate Limits:**
- 20 berichten/minuut per organisatie
- 1000 berichten/uur per organisatie
- Configureerbaar per campagne
- Sliding window implementatie via `rate_limit_tracking`
- Auto-pause campagne bij Meta API 429 error

**Anti-Spam:**
- Verplichte opt-out footer in bulk berichten: "\n\nStuur STOP om je af te melden"
- Duplicate check: blokkeer identiek bericht binnen 24u naar zelfde kandidaat
- Min. 3 seconden delay tussen batches
- Audit log voor alle bulk sends

**Opt-Out:**
- Kanaal-specifiek (WhatsApp ≠ Email)
- Auto-detectie keywords: "STOP", "UITSCHRIJVEN", "UNSUBSCRIBE", "AFMELDEN"
- Manual opt-out via UI
- Auto-exclude in segment builder (join communication_preferences WHERE opted_out=false)

## Implementatie Volgorde

1. **Database migrations** (4 tabellen + 3 enums + 3 functies + RLS policies)
2. **opt-out-handler** edge function
3. **Update whatsapp-send** voor pre-checks
4. **bulk-campaign-processor** edge function
5. **Update whatsapp-webhook** voor keyword detectie
6. **BulkCampaigns pagina** skeleton + routing
7. **SegmentBuilder** component
8. **CampaignWizard** dialog
9. **CampaignDetail** view + realtime
10. **CandidatePreferences** component

## Technische Details

**Merge fields replacement:**
```typescript
// Client-side preview
const preview = template
  .replace(/\{\{first_name\}\}/g, candidate.first_name)
  .replace(/\{\{last_name\}\}/g, candidate.last_name);

// Server-side in bulk-campaign-processor
const message = campaign.message_template
  .replace(/\{\{first_name\}\}/g, candidate.first_name || '')
  .replace(/\{\{last_name\}\}/g, candidate.last_name || '');
```

**Batch processing pseudocode:**
```
1. Load campaign
2. Get candidates (get_campaign_candidates function)
3. Filter opted-out (LEFT JOIN communication_preferences)
4. Insert campaign_recipients (bulk insert, status=pending)
5. Update campaign.total_recipients
6. Set status=running, started_at=now()
7. LOOP batches (50 per batch):
     - Check minute limit → sleep if needed
     - Check hour limit → pause campaign if needed
     - FOR EACH candidate:
         - Replace merge fields
         - Call whatsapp-send
         - IF success: status=sent, increment sent_count
         - IF failed: status=failed, increment failed_count, store error
         - Update communication_id FK
     - Sleep 3000ms
8. Set status=completed, completed_at=now()
```

**Realtime progress:**
- Supabase Realtime op `bulk_campaigns` tabel
- Frontend subscribed tijdens campagne detail view
- Live update progress bar elke 2s

## RLS Policies

Alle nieuwe tabellen:
```sql
-- SELECT
CREATE POLICY tenant_select ON <table>
FOR SELECT USING (organization_id = get_user_org_id());

-- INSERT
CREATE POLICY tenant_insert ON <table>
FOR INSERT WITH CHECK (organization_id = get_user_org_id());

-- UPDATE
CREATE POLICY tenant_update ON <table>
FOR UPDATE USING (organization_id = get_user_org_id());

-- DELETE (admin only)
CREATE POLICY tenant_delete ON <table>
FOR DELETE USING (
  organization_id = get_user_org_id() 
  AND get_user_role() = 'admin'
);
```

## Schatting

- **Database**: 4 tabellen, 3 enums, 3 functies, RLS policies (~350 LOC SQL)
- **Edge Functions**: 2 nieuwe, 2 updates (~800 LOC TypeScript)
- **Frontend**: 1 pagina, 5 componenten, wizard flow (~2000 LOC React/TypeScript)
- **Totaal**: ~3150 LOC
- **Geschatte tijd**: 3-4 dagen werk

