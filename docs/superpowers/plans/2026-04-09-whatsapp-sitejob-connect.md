# WhatsApp via SiteJob Connect - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Volledig herbouwen van de WhatsApp Business integratie via SiteJob Connect — edge functions, WhatsApp Web-style chat UI met media/templates, en bulk campaign systeem met retries en scheduler.

**Architecture:** 3-layer rebuild: (1) Deno edge functions for register/config/send/webhook + shared utils, (2) React 3-panel chat UI with Supabase Realtime, (3) Campaign processor with pg_cron scheduler. Direct Meta API v25.0 for sending, SiteJob Connect for OAuth + webhook relay.

**Tech Stack:** Deno (edge functions), React 18 + TypeScript, TanStack Query v5, Supabase Realtime, shadcn/ui + Tailwind, react-resizable-panels, date-fns (nl locale), Meta WhatsApp Cloud API v25.0

**Spec:** `docs/superpowers/specs/2026-04-09-whatsapp-sitejob-connect-design.md`

---

## File Structure

### Edge Functions (Deno)
| File | Responsibility |
|------|---------------|
| `supabase/functions/_shared/whatsapp-utils.ts` | Phone normalization (E.164), credential decryption helper, Meta API constants |
| `supabase/functions/whatsapp-register/index.ts` | Register tenant at SiteJob Connect, store tenant_id + webhook_secret |
| `supabase/functions/whatsapp-config/index.ts` | Receive OAuth credentials from Connect, store encrypted |
| `supabase/functions/whatsapp-send/index.ts` | Send messages (text/template/media/reaction) direct to Meta API |
| `supabase/functions/whatsapp-webhook/index.ts` | Receive inbound messages + status updates from Connect |
| `supabase/functions/whatsapp-templates-sync/index.ts` | Sync approved templates from Meta API |
| `supabase/functions/bulk-campaign-processor/index.ts` | Process campaign recipients in batches with retries |

### React Components
| File | Responsibility |
|------|---------------|
| `src/pages/WhatsApp.tsx` | Main page: 3-panel layout, state management, responsive |
| `src/components/whatsapp/ConversationList.tsx` | Left panel: search, filter, conversation items, new chat |
| `src/components/whatsapp/ConversationItem.tsx` | Single conversation row: avatar, name, preview, unread badge |
| `src/components/whatsapp/ChatThread.tsx` | Middle panel: message list + input area |
| `src/components/whatsapp/ChatHeader.tsx` | Chat header: contact name, phone, actions |
| `src/components/whatsapp/MessageBubble.tsx` | Single message: text/media rendering, status indicators |
| `src/components/whatsapp/MediaMessage.tsx` | Media rendering: image lightbox, video player, audio waveform, document download |
| `src/components/whatsapp/DateSeparator.tsx` | Date divider between message groups |
| `src/components/whatsapp/ChatInput.tsx` | Message composer: textarea, attachment, template, send |
| `src/components/whatsapp/AttachmentPicker.tsx` | File picker popover for media upload |
| `src/components/whatsapp/TemplatePicker.tsx` | Modal: template list, parameter form, preview |
| `src/components/whatsapp/ChatEmpty.tsx` | Empty state when no conversation selected |
| `src/components/whatsapp/ContactPanel.tsx` | Right panel: contact info, shared media, quick actions |

### Hooks
| File | Responsibility |
|------|---------------|
| `src/hooks/useWhatsAppRealtime.ts` | Supabase Realtime subscription for live message/status updates |
| `src/hooks/useWhatsAppConversations.ts` | Query + group conversations from communications table |
| `src/hooks/useWhatsAppMessages.ts` | Cursor-based paginated messages for active conversation |
| `src/hooks/useWhatsAppSend.ts` | Mutation hook for sending messages via edge function |

### Database Migrations
| File | Responsibility |
|------|---------------|
| `supabase/migrations/[timestamp]_whatsapp_rebuild.sql` | Add indexes, message_type column, media_id column, whatsapp_templates table, campaign retry columns |

---

## LAAG 1: Backend (Edge Functions + DB)

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/[timestamp]_whatsapp_rebuild.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Add message_type and media_id to communications
ALTER TABLE public.communications ADD COLUMN IF NOT EXISTS message_type text DEFAULT 'text';
ALTER TABLE public.communications ADD COLUMN IF NOT EXISTS media_id text;

-- Index on tenant_id for O(1) webhook lookup
CREATE INDEX IF NOT EXISTS idx_whatsapp_config_tenant_id ON public.whatsapp_config(tenant_id);

-- Index on waba_id for webhook lookup via payload
CREATE INDEX IF NOT EXISTS idx_whatsapp_config_waba_id ON public.whatsapp_config(waba_id);

-- Unique constraint on whatsapp_message_id for deduplication
ALTER TABLE public.communications DROP CONSTRAINT IF EXISTS communications_whatsapp_message_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_communications_whatsapp_msg_unique
  ON public.communications(whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

-- WhatsApp templates cache
CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_name text NOT NULL,
  language text NOT NULL,
  category text,
  status text,
  components jsonb,
  last_synced_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, template_name, language)
);

ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select_templates" ON public.whatsapp_templates FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id());
CREATE POLICY "tenant_insert_templates" ON public.whatsapp_templates FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id());
CREATE POLICY "tenant_update_templates" ON public.whatsapp_templates FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id());

-- Campaign retry columns
ALTER TABLE public.campaign_recipients ADD COLUMN IF NOT EXISTS retry_count integer DEFAULT 0;
ALTER TABLE public.campaign_recipients ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;

-- Campaign pause/cancel tracking
ALTER TABLE public.bulk_campaigns ADD COLUMN IF NOT EXISTS paused_at timestamptz;
ALTER TABLE public.bulk_campaigns ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- Enable realtime on communications for live chat updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.communications;
```

- [ ] **Step 2: Apply migration**

Run: `npx supabase db push` or apply via Supabase Dashboard > SQL Editor.

- [ ] **Step 3: Regenerate TypeScript types**

Run:
```bash
npx supabase gen types typescript --project-id noaupcteygfvlyymqtew > src/integrations/supabase/types.ts
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/ src/integrations/supabase/types.ts
git commit -m "feat(whatsapp): add migration for rebuild — templates table, indexes, realtime"
```

---

### Task 2: Shared WhatsApp Utilities

**Files:**
- Create: `supabase/functions/_shared/whatsapp-utils.ts`

- [ ] **Step 1: Create the shared utilities file**

```typescript
// supabase/functions/_shared/whatsapp-utils.ts
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const META_API_BASE = "https://graph.facebook.com/v25.0";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

export function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Normalize any Dutch phone format to E.164: +316xxxxxxxx
 * Handles: 06-, +316, 00316, 316, spaces, dashes, parentheses
 */
export function normalizePhone(phone: string): string {
  // Strip everything except digits and leading +
  let cleaned = phone.replace(/[\s\-\(\)]/g, "");

  // Remove leading + for digit processing
  if (cleaned.startsWith("+")) {
    cleaned = cleaned.substring(1);
  }

  // 0031 → 31
  if (cleaned.startsWith("0031")) {
    cleaned = "31" + cleaned.substring(4);
  }

  // 06xxxxxxxx → 316xxxxxxxx
  if (cleaned.startsWith("0") && cleaned.length === 10) {
    cleaned = "31" + cleaned.substring(1);
  }

  // Ensure starts with country code
  if (!cleaned.startsWith("31") && cleaned.length === 9) {
    cleaned = "31" + cleaned;
  }

  return "+" + cleaned;
}

/**
 * Get decrypted WhatsApp credentials for an organization.
 * Uses the get_whatsapp_token RPC which decrypts via Supabase Vault.
 */
export async function getWhatsAppCredentials(
  supabase: SupabaseClient,
  orgId: string
): Promise<{
  phone_number_id: string;
  access_token: string;
  waba_id: string;
  display_phone: string;
  webhook_secret: string;
} | null> {
  const { data, error } = await supabase.rpc("get_whatsapp_token", {
    p_org_id: orgId,
  });

  if (error || !data || data.length === 0) return null;

  const row = data[0];
  return {
    phone_number_id: row.phone_number_id,
    access_token: row.decrypted_access_token,
    waba_id: row.waba_id,
    display_phone: row.display_phone ?? "",
    webhook_secret: row.decrypted_webhook_secret,
  };
}

/**
 * Get authenticated user's org_id from JWT claims + profiles table.
 * For use in JWT-protected edge functions.
 */
export async function getAuthenticatedOrg(
  req: Request,
  supabase: SupabaseClient
): Promise<{ orgId: string; userId: string } | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonError("Unauthorized", 401);
  }

  const { data: { user }, error } = await supabase.auth.getUser(
    authHeader.replace("Bearer ", "")
  );

  if (error || !user) {
    return jsonError("Unauthorized", 401);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();

  if (!profile?.organization_id) {
    return jsonError("Profile not found", 404);
  }

  return { orgId: profile.organization_id, userId: user.id };
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/whatsapp-utils.ts
git commit -m "feat(whatsapp): add shared utilities — phone normalization, credentials, auth helper"
```

---

### Task 3: Edge Function — whatsapp-register

**Files:**
- Modify: `supabase/functions/whatsapp-register/index.ts` (full rewrite)

- [ ] **Step 1: Rewrite the register function**

```typescript
// supabase/functions/whatsapp-register/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders,
  jsonOk,
  jsonError,
  getAuthenticatedOrg,
} from "../_shared/whatsapp-utils.ts";

const CONNECT_REGISTER_URL =
  "https://xeshjkznwdrxjjhbpisn.supabase.co/functions/v1/whatsapp-register-tenant";
const SETUP_BASE_URL = "https://connect.sitejob.nl/whatsapp-setup";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const auth = await getAuthenticatedOrg(req, supabase);
    if (auth instanceof Response) return auth;
    const { orgId } = auth;

    // Check existing config
    const { data: existing } = await supabase
      .from("whatsapp_config")
      .select("tenant_id, is_active, phone_number_id")
      .eq("organization_id", orgId)
      .maybeSingle();

    // If already fully configured, return setup URL for management
    if (existing?.tenant_id) {
      return jsonOk({
        tenant_id: existing.tenant_id,
        setup_url: `${SETUP_BASE_URL}?tenant_id=${existing.tenant_id}`,
        already_registered: true,
        is_active: existing.is_active,
      });
    }

    // Get org name for registration
    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .single();

    const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-webhook`;
    const connectApiKey = Deno.env.get("CONNECT_API_KEY");
    if (!connectApiKey) {
      return jsonError("CONNECT_API_KEY not configured", 500);
    }

    // Register tenant at SiteJob Connect
    const response = await fetch(CONNECT_REGISTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": connectApiKey,
      },
      body: JSON.stringify({
        name: org?.name ?? "JA Werkt",
        webhook_url: webhookUrl,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Connect registration failed:", errText);
      return jsonError("Registratie bij SiteJob Connect mislukt", 502);
    }

    const { tenant_id, webhook_secret } = await response.json();

    // Store tenant config (webhook_secret will be encrypted by DB trigger)
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { error: upsertError } = await serviceClient
      .from("whatsapp_config")
      .upsert(
        {
          organization_id: orgId,
          tenant_id,
          webhook_secret,
          is_active: false,
        },
        { onConflict: "organization_id" }
      );

    if (upsertError) {
      console.error("Config upsert failed:", upsertError);
      return jsonError("Configuratie opslaan mislukt", 500);
    }

    return jsonOk({
      tenant_id,
      setup_url: `${SETUP_BASE_URL}?tenant_id=${tenant_id}`,
      already_registered: false,
    });
  } catch (err) {
    console.error("whatsapp-register error:", err);
    return jsonError("Interne fout", 500);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/whatsapp-register/index.ts
git commit -m "feat(whatsapp): rebuild register edge function — idempotent, shared utils"
```

---

### Task 4: Edge Function — whatsapp-config

**Files:**
- Modify: `supabase/functions/whatsapp-config/index.ts` (full rewrite)

- [ ] **Step 1: Rewrite the config function**

```typescript
// supabase/functions/whatsapp-config/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonOk, jsonError } from "../_shared/whatsapp-utils.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const webhookSecret = req.headers.get("X-Webhook-Secret");
    if (!webhookSecret) {
      return jsonError("Unauthorized", 401);
    }

    const body = await req.json();
    const tenantId = body.tenant_id;
    if (!tenantId) {
      return jsonError("Missing tenant_id", 400);
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // O(1) lookup by tenant_id
    const { data: config, error: findError } = await serviceClient
      .from("whatsapp_config")
      .select("id, organization_id, webhook_secret")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (findError || !config) {
      console.error("Config not found for tenant:", tenantId);
      return jsonError("Tenant not found", 404);
    }

    // Decrypt and validate webhook secret
    const { data: decrypted } = await serviceClient.rpc("decrypt_sensitive", {
      ciphertext: config.webhook_secret,
    });

    if (decrypted !== webhookSecret) {
      console.error("Webhook secret mismatch for tenant:", tenantId);
      return jsonError("Unauthorized", 401);
    }

    // Handle disconnect
    if (body.action === "disconnect") {
      await serviceClient
        .from("whatsapp_config")
        .update({
          phone_number_id: null,
          access_token: null,
          display_phone: null,
          waba_id: null,
          is_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", config.id);

      console.log("WhatsApp disconnected for org:", config.organization_id);
      return jsonOk({ status: "disconnected" });
    }

    // Handle credential push — access_token will be encrypted by DB trigger
    const { phone_number_id, access_token, display_phone, waba_id } = body;
    if (!phone_number_id || !access_token) {
      return jsonError("Missing credentials", 400);
    }

    const { error: updateError } = await serviceClient
      .from("whatsapp_config")
      .update({
        phone_number_id,
        access_token,
        display_phone: display_phone ?? null,
        waba_id: waba_id ?? null,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", config.id);

    if (updateError) {
      console.error("Config update failed:", updateError);
      return jsonError("Update failed", 500);
    }

    console.log("WhatsApp configured for org:", config.organization_id);
    return jsonOk({ status: "configured" });
  } catch (err) {
    console.error("whatsapp-config error:", err);
    return jsonOk({ status: "error" }); // Always 200 for webhook endpoints
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/whatsapp-config/index.ts
git commit -m "feat(whatsapp): rebuild config edge function — O(1) tenant lookup, disconnect support"
```

---

### Task 5: Edge Function — whatsapp-send

**Files:**
- Modify: `supabase/functions/whatsapp-send/index.ts` (full rewrite)

- [ ] **Step 1: Rewrite the send function**

```typescript
// supabase/functions/whatsapp-send/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders,
  jsonOk,
  jsonError,
  normalizePhone,
  getWhatsAppCredentials,
  getAuthenticatedOrg,
  META_API_BASE,
} from "../_shared/whatsapp-utils.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const auth = await getAuthenticatedOrg(req, supabase);
    if (auth instanceof Response) return auth;
    const { orgId, userId } = auth;

    const body = await req.json();
    const { to, type, text, template, image, video, audio, document, reaction, candidate_id, context } = body;

    if (!to || !type) {
      return jsonError("Veld 'to' en 'type' zijn verplicht", 400);
    }

    const normalizedTo = normalizePhone(to);

    // Handle read receipts separately
    if (type === "read_receipt") {
      const creds = await getWhatsAppCredentials(supabase, orgId);
      if (!creds) return jsonError("WhatsApp niet geconfigureerd", 400);

      await fetch(`${META_API_BASE}/${creds.phone_number_id}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: body.message_id,
        }),
      });

      return jsonOk({ success: true });
    }

    // Check opt-out
    if (candidate_id) {
      const { data: pref } = await supabase
        .from("communication_preferences")
        .select("opted_out")
        .eq("candidate_id", candidate_id)
        .eq("channel", "whatsapp")
        .eq("organization_id", orgId)
        .maybeSingle();

      if (pref?.opted_out) {
        return jsonError("Kandidaat heeft zich afgemeld voor WhatsApp", 403);
      }
    }

    // Check rate limit
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: withinLimit } = await serviceClient.rpc("check_rate_limit", {
      p_org_id: orgId,
      p_channel: "whatsapp",
      p_window_type: "minute",
    });

    if (withinLimit === false) {
      return jsonError("Rate limit bereikt, probeer het later opnieuw", 429);
    }

    // Get credentials
    const creds = await getWhatsAppCredentials(serviceClient, orgId);
    if (!creds) return jsonError("WhatsApp niet geconfigureerd", 400);

    // Build Meta API payload
    const metaPayload: Record<string, unknown> = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizedTo.replace("+", ""), // Meta wants no + prefix
    };

    let messageBody = "";

    switch (type) {
      case "text":
        metaPayload.type = "text";
        metaPayload.text = { body: text?.body ?? "", preview_url: text?.preview_url ?? false };
        messageBody = text?.body ?? "";
        break;

      case "template":
        metaPayload.type = "template";
        metaPayload.template = {
          name: template?.name,
          language: { code: template?.language ?? "nl" },
          components: template?.components ?? [],
        };
        messageBody = `[Template: ${template?.name}]`;
        break;

      case "image":
        metaPayload.type = "image";
        metaPayload.image = image;
        messageBody = image?.caption ?? "[Afbeelding]";
        break;

      case "video":
        metaPayload.type = "video";
        metaPayload.video = video;
        messageBody = video?.caption ?? "[Video]";
        break;

      case "audio":
        metaPayload.type = "audio";
        metaPayload.audio = audio;
        messageBody = "[Audio]";
        break;

      case "document":
        metaPayload.type = "document";
        metaPayload.document = document;
        messageBody = document?.caption ?? `[Document: ${document?.filename ?? "bestand"}]`;
        break;

      case "reaction":
        metaPayload.type = "reaction";
        metaPayload.reaction = reaction;
        messageBody = `[Reactie: ${reaction?.emoji}]`;
        break;

      default:
        return jsonError(`Onbekend berichttype: ${type}`, 400);
    }

    if (context?.message_id) {
      metaPayload.context = { message_id: context.message_id };
    }

    // Send to Meta API
    const metaResponse = await fetch(
      `${META_API_BASE}/${creds.phone_number_id}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(metaPayload),
      }
    );

    const metaResult = await metaResponse.json();

    if (!metaResponse.ok) {
      console.error("Meta API error:", metaResult);
      return jsonError(
        metaResult?.error?.message ?? "Bericht versturen mislukt",
        metaResponse.status === 400 ? 400 : 502
      );
    }

    const waMessageId = metaResult.messages?.[0]?.id;

    // Log to communications table
    const { error: logError } = await serviceClient.from("communications").insert({
      organization_id: orgId,
      channel: "whatsapp",
      direction: "outbound",
      subject: `WhatsApp naar ${normalizedTo}`,
      body: messageBody,
      candidate_id: candidate_id ?? null,
      sent_by: userId,
      sent_at: new Date().toISOString(),
      whatsapp_message_id: waMessageId,
      whatsapp_status: "pending",
      message_type: type,
    });

    if (logError) {
      console.error("Communication log failed:", logError);
      // Don't fail the request — message was already sent
    }

    // Record rate limit
    await serviceClient.rpc("record_rate_limit", {
      p_org_id: orgId,
      p_channel: "whatsapp",
    });

    return jsonOk({ success: true, message_id: waMessageId });
  } catch (err) {
    console.error("whatsapp-send error:", err);
    return jsonError("Interne fout bij versturen", 500);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/whatsapp-send/index.ts
git commit -m "feat(whatsapp): rebuild send edge function — all message types, rate limiting, E.164"
```

---

### Task 6: Edge Function — whatsapp-webhook

**Files:**
- Modify: `supabase/functions/whatsapp-webhook/index.ts` (full rewrite)

- [ ] **Step 1: Rewrite the webhook function**

```typescript
// supabase/functions/whatsapp-webhook/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizePhone } from "../_shared/whatsapp-utils.ts";

const OPT_OUT_KEYWORDS = ["stop", "afmelden", "uitschrijven", "stoppen", "unsubscribe"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type, x-webhook-secret",
      },
    });
  }

  // Always return 200 to prevent SiteJob Connect retries
  const ok = () => new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

  try {
    const webhookSecret = req.headers.get("X-Webhook-Secret");
    if (!webhookSecret) {
      console.error("Missing X-Webhook-Secret header");
      return ok();
    }

    const body = await req.json();

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find org by WABA ID from payload (O(1) lookup)
    const wabaId = body.id;
    let config: any = null;

    if (wabaId) {
      const { data } = await serviceClient
        .from("whatsapp_config")
        .select("id, organization_id, webhook_secret")
        .eq("waba_id", wabaId)
        .eq("is_active", true)
        .maybeSingle();
      config = data;
    }

    // Fallback: find by decrypting and matching webhook_secret
    if (!config) {
      const { data: configs } = await serviceClient
        .from("whatsapp_config")
        .select("id, organization_id, webhook_secret")
        .eq("is_active", true);

      if (configs) {
        for (const c of configs) {
          const { data: decrypted } = await serviceClient.rpc("decrypt_sensitive", {
            ciphertext: c.webhook_secret,
          });
          if (decrypted === webhookSecret) {
            config = c;
            break;
          }
        }
      }
    }

    if (!config) {
      console.error("No matching config for webhook secret");
      return ok();
    }

    // Validate webhook secret for waba_id match path
    if (wabaId && config.webhook_secret) {
      const { data: decrypted } = await serviceClient.rpc("decrypt_sensitive", {
        ciphertext: config.webhook_secret,
      });
      if (decrypted !== webhookSecret) {
        console.error("Webhook secret mismatch");
        return ok();
      }
    }

    const orgId = config.organization_id;
    const changes = body.changes || [];

    for (const change of changes) {
      const value = change.value;
      if (!value) continue;

      // Process inbound messages
      if (value.messages) {
        for (const msg of value.messages) {
          await processInboundMessage(serviceClient, orgId, msg, value.contacts, value.metadata);
        }
      }

      // Process status updates
      if (value.statuses) {
        for (const status of value.statuses) {
          await processStatusUpdate(serviceClient, status);
        }
      }
    }

    return ok();
  } catch (err) {
    console.error("whatsapp-webhook error:", err);
    return ok();
  }
});

async function processInboundMessage(
  supabase: any,
  orgId: string,
  msg: any,
  contacts: any[],
  metadata: any
) {
  const from = normalizePhone(msg.from);
  const messageId = msg.id;
  const messageType = msg.type;
  const timestamp = msg.timestamp
    ? new Date(parseInt(msg.timestamp) * 1000).toISOString()
    : new Date().toISOString();

  // Extract message body
  let body = "";
  let mediaId: string | null = null;

  switch (messageType) {
    case "text":
      body = msg.text?.body ?? "";
      break;
    case "image":
      body = msg.image?.caption ?? "[Afbeelding]";
      mediaId = msg.image?.id ?? null;
      break;
    case "video":
      body = msg.video?.caption ?? "[Video]";
      mediaId = msg.video?.id ?? null;
      break;
    case "audio":
      body = "[Audio]";
      mediaId = msg.audio?.id ?? null;
      break;
    case "document":
      body = msg.document?.caption ?? `[Document: ${msg.document?.filename ?? "bestand"}]`;
      mediaId = msg.document?.id ?? null;
      break;
    case "sticker":
      body = "[Sticker]";
      mediaId = msg.sticker?.id ?? null;
      break;
    case "location":
      body = `[Locatie: ${msg.location?.name ?? `${msg.location?.latitude}, ${msg.location?.longitude}`}]`;
      break;
    case "contacts":
      body = `[Contact: ${msg.contacts?.[0]?.name?.formatted_name ?? "onbekend"}]`;
      break;
    case "reaction":
      body = `[Reactie: ${msg.reaction?.emoji ?? ""}]`;
      break;
    case "interactive":
      const ir = msg.interactive;
      body = ir?.button_reply?.title ?? ir?.list_reply?.title ?? "[Interactief antwoord]";
      break;
    case "button":
      body = msg.button?.text ?? "[Button antwoord]";
      break;
    default:
      body = `[${messageType}]`;
  }

  // Match candidate by normalized phone
  const { data: candidate } = await supabase
    .from("candidates")
    .select("id")
    .eq("organization_id", orgId)
    .or(`phone.eq.${from},phone.eq.${from.replace("+", "")},phone.eq.0${from.substring(3)}`)
    .maybeSingle();

  const candidateId = candidate?.id ?? null;
  const contactName = contacts?.[0]?.profile?.name ?? from;

  // Check opt-out keywords (only for text messages)
  if (messageType === "text" && body) {
    const lowerBody = body.toLowerCase().trim();
    const isOptOut = OPT_OUT_KEYWORDS.some(
      (kw) => lowerBody === kw || lowerBody.startsWith(kw + " ") || lowerBody.startsWith(kw + ".")
    );

    if (isOptOut && candidateId) {
      await supabase.from("communication_preferences").upsert(
        {
          organization_id: orgId,
          candidate_id: candidateId,
          channel: "whatsapp",
          opted_out: true,
          opted_out_at: new Date().toISOString(),
          opted_out_reason: `Auto: "${body}"`,
        },
        { onConflict: "candidate_id,channel,organization_id" }
      );

      // Mark pending campaign recipients as opted_out
      await supabase
        .from("campaign_recipients")
        .update({ status: "opted_out" })
        .eq("candidate_id", candidateId)
        .eq("status", "pending");
    }
  }

  // Insert communication (dedup via whatsapp_message_id unique index)
  const { error: insertError } = await supabase.from("communications").insert({
    organization_id: orgId,
    channel: "whatsapp",
    direction: "inbound",
    subject: `WhatsApp van ${contactName} (${from})`,
    body,
    candidate_id: candidateId,
    sent_at: timestamp,
    whatsapp_message_id: messageId,
    whatsapp_status: "received",
    message_type: messageType,
    media_id: mediaId,
  });

  if (insertError) {
    // Likely duplicate — ignore
    if (!insertError.message?.includes("unique") && !insertError.code?.includes("23505")) {
      console.error("Insert communication failed:", insertError);
    }
  }
}

async function processStatusUpdate(supabase: any, status: any) {
  const messageId = status.id;
  const newStatus = status.status; // sent, delivered, read, failed

  const updateData: Record<string, unknown> = {
    whatsapp_status: newStatus,
  };

  // Store error details for failed messages
  if (newStatus === "failed" && status.errors?.length) {
    const err = status.errors[0];
    updateData.body = `[Mislukt: ${err.title ?? err.message ?? "onbekende fout"}]`;
  }

  const { error } = await supabase
    .from("communications")
    .update(updateData)
    .eq("whatsapp_message_id", messageId);

  if (error) {
    console.error("Status update failed for message:", messageId, error);
  }
}
```

- [ ] **Step 2: Update config.toml to ensure verify_jwt settings**

Read `supabase/config.toml` and verify these entries exist:

```toml
[functions.whatsapp-webhook]
verify_jwt = false

[functions.whatsapp-config]
verify_jwt = false

[functions.whatsapp-register]
verify_jwt = true

[functions.whatsapp-send]
verify_jwt = true
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/whatsapp-webhook/index.ts supabase/config.toml
git commit -m "feat(whatsapp): rebuild webhook edge function — all message types, opt-out, dedup, O(1) lookup"
```

---

### Task 7: Edge Function — whatsapp-templates-sync

**Files:**
- Create: `supabase/functions/whatsapp-templates-sync/index.ts`

- [ ] **Step 1: Create the template sync function**

```typescript
// supabase/functions/whatsapp-templates-sync/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders,
  jsonOk,
  jsonError,
  getAuthenticatedOrg,
  getWhatsAppCredentials,
  META_API_BASE,
} from "../_shared/whatsapp-utils.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const auth = await getAuthenticatedOrg(req, supabase);
    if (auth instanceof Response) return auth;
    const { orgId } = auth;

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const creds = await getWhatsAppCredentials(serviceClient, orgId);
    if (!creds) return jsonError("WhatsApp niet geconfigureerd", 400);

    // Fetch templates from Meta API
    const response = await fetch(
      `${META_API_BASE}/${creds.waba_id}/message_templates?limit=250`,
      {
        headers: { Authorization: `Bearer ${creds.access_token}` },
      }
    );

    if (!response.ok) {
      const err = await response.text();
      console.error("Meta templates fetch failed:", err);
      return jsonError("Templates ophalen mislukt", 502);
    }

    const { data: templates } = await response.json();
    const now = new Date().toISOString();

    // Upsert all templates
    const rows = (templates ?? []).map((t: any) => ({
      organization_id: orgId,
      template_name: t.name,
      language: t.language,
      category: t.category,
      status: t.status,
      components: t.components,
      last_synced_at: now,
    }));

    if (rows.length > 0) {
      const { error } = await serviceClient
        .from("whatsapp_templates")
        .upsert(rows, { onConflict: "organization_id,template_name,language" });

      if (error) {
        console.error("Template upsert failed:", error);
        return jsonError("Templates opslaan mislukt", 500);
      }
    }

    // Delete templates that no longer exist at Meta
    const templateKeys = (templates ?? []).map((t: any) => `${t.name}::${t.language}`);
    const { data: existing } = await serviceClient
      .from("whatsapp_templates")
      .select("id, template_name, language")
      .eq("organization_id", orgId);

    const toDelete = (existing ?? [])
      .filter((e: any) => !templateKeys.includes(`${e.template_name}::${e.language}`))
      .map((e: any) => e.id);

    if (toDelete.length > 0) {
      await serviceClient
        .from("whatsapp_templates")
        .delete()
        .in("id", toDelete);
    }

    return jsonOk({
      synced: rows.length,
      deleted: toDelete.length,
    });
  } catch (err) {
    console.error("whatsapp-templates-sync error:", err);
    return jsonError("Interne fout", 500);
  }
});
```

- [ ] **Step 2: Add to config.toml**

```toml
[functions.whatsapp-templates-sync]
verify_jwt = true
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/whatsapp-templates-sync/ supabase/config.toml
git commit -m "feat(whatsapp): add template sync edge function — fetches approved templates from Meta"
```

---

## LAAG 2: Chat UI

### Task 8: Install Dependencies + Create Hook Files

**Files:**
- Modify: `package.json` (via npm install)
- Create: `src/hooks/useWhatsAppRealtime.ts`
- Create: `src/hooks/useWhatsAppConversations.ts`
- Create: `src/hooks/useWhatsAppMessages.ts`
- Create: `src/hooks/useWhatsAppSend.ts`

- [ ] **Step 1: Install react-window (skip if you want to use ScrollArea instead)**

Note: The existing codebase uses `react-resizable-panels` for layout splits and Radix `ScrollArea` for scrolling. We'll use `react-resizable-panels` for the 3-panel layout and native scroll for messages (simpler than react-window for a chat use case). No extra dependencies needed.

- [ ] **Step 2: Create useWhatsAppRealtime hook**

```typescript
// src/hooks/useWhatsAppRealtime.ts
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function useWhatsAppRealtime(orgId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!orgId) return;

    const channel = supabase
      .channel(`whatsapp-${orgId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'communications',
          filter: `organization_id=eq.${orgId}`,
        },
        (payload) => {
          const record = payload.new as any;
          if (record?.channel !== 'whatsapp') return;

          // Invalidate conversations list
          queryClient.invalidateQueries({ queryKey: ['whatsapp-conversations', orgId] });

          // Invalidate messages for the specific conversation
          // Extract phone from subject for conversation key
          queryClient.invalidateQueries({ queryKey: ['whatsapp-messages', orgId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, queryClient]);
}
```

- [ ] **Step 3: Create useWhatsAppConversations hook**

```typescript
// src/hooks/useWhatsAppConversations.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface Conversation {
  phone: string;
  candidateId: string | null;
  candidateName: string | null;
  lastMessage: string;
  lastMessageAt: string;
  lastDirection: string;
  unreadCount: number;
  whatsappStatus: string | null;
}

export function useWhatsAppConversations(orgId: string) {
  return useQuery({
    queryKey: ['whatsapp-conversations', orgId],
    queryFn: async (): Promise<Conversation[]> => {
      // Get all WhatsApp communications grouped by phone
      const { data: messages, error } = await supabase
        .from('communications')
        .select(`
          id, subject, body, direction, sent_at, candidate_id,
          whatsapp_status, whatsapp_message_id, message_type,
          candidates!communications_candidate_id_fkey(id, first_name, last_name)
        `)
        .eq('organization_id', orgId)
        .eq('channel', 'whatsapp')
        .order('sent_at', { ascending: false });

      if (error) throw error;
      if (!messages?.length) return [];

      // Group by phone (extracted from subject)
      const convMap = new Map<string, Conversation>();

      for (const msg of messages) {
        const phone = extractPhone(msg.subject ?? '');
        if (!phone) continue;

        if (!convMap.has(phone)) {
          const candidate = msg.candidates as any;
          convMap.set(phone, {
            phone,
            candidateId: msg.candidate_id,
            candidateName: candidate
              ? `${candidate.first_name ?? ''} ${candidate.last_name ?? ''}`.trim()
              : null,
            lastMessage: msg.body ?? '',
            lastMessageAt: msg.sent_at,
            lastDirection: msg.direction,
            unreadCount: 0,
            whatsappStatus: msg.whatsapp_status,
          });
        }

        const conv = convMap.get(phone)!;
        if (msg.direction === 'inbound' && !msg.whatsapp_status?.includes('read')) {
          conv.unreadCount++;
        }
      }

      return Array.from(convMap.values()).sort(
        (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
      );
    },
    enabled: !!orgId,
  });
}

function extractPhone(subject: string): string | null {
  // "WhatsApp van/naar +316xxxxxxxx" or "WhatsApp van Name (phone)"
  const match = subject.match(/[\+]?\d[\d\s\-]{8,}/);
  if (!match) return null;
  return match[0].replace(/[\s\-]/g, '');
}
```

- [ ] **Step 4: Create useWhatsAppMessages hook**

```typescript
// src/hooks/useWhatsAppMessages.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface WhatsAppMessage {
  id: string;
  body: string | null;
  direction: string;
  sentAt: string;
  sentBy: string | null;
  whatsappMessageId: string | null;
  whatsappStatus: string | null;
  messageType: string | null;
  mediaId: string | null;
  candidateId: string | null;
}

export function useWhatsAppMessages(orgId: string, phone: string | null) {
  return useQuery({
    queryKey: ['whatsapp-messages', orgId, phone],
    queryFn: async (): Promise<WhatsAppMessage[]> => {
      if (!phone) return [];

      // Build phone variants for matching
      const cleanPhone = phone.replace(/[\s\-\+]/g, '');
      const phoneVariants = [
        phone,
        `+${cleanPhone}`,
        cleanPhone,
        `0${cleanPhone.substring(2)}`, // +316... → 06...
      ];

      // Match messages by phone in subject
      const { data, error } = await supabase
        .from('communications')
        .select('*')
        .eq('organization_id', orgId)
        .eq('channel', 'whatsapp')
        .or(phoneVariants.map((p) => `subject.ilike.%${p}%`).join(','))
        .order('sent_at', { ascending: true })
        .limit(200);

      if (error) throw error;

      return (data ?? []).map((msg) => ({
        id: msg.id,
        body: msg.body,
        direction: msg.direction,
        sentAt: msg.sent_at,
        sentBy: msg.sent_by,
        whatsappMessageId: msg.whatsapp_message_id,
        whatsappStatus: msg.whatsapp_status,
        messageType: (msg as any).message_type ?? 'text',
        mediaId: (msg as any).media_id ?? null,
        candidateId: msg.candidate_id,
      }));
    },
    enabled: !!orgId && !!phone,
  });
}
```

- [ ] **Step 5: Create useWhatsAppSend hook**

```typescript
// src/hooks/useWhatsAppSend.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface SendMessageParams {
  to: string;
  type: string;
  text?: { body: string; preview_url?: boolean };
  template?: { name: string; language: string; components?: any[] };
  image?: { link: string; caption?: string };
  video?: { link: string; caption?: string };
  audio?: { link: string };
  document?: { link: string; caption?: string; filename?: string };
  reaction?: { message_id: string; emoji: string };
  candidate_id?: string;
  context?: { message_id: string };
}

export function useWhatsAppSend(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: SendMessageParams) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Niet ingelogd');

      const response = await supabase.functions.invoke('whatsapp-send', {
        body: params,
      });

      if (response.error) {
        throw new Error(response.error.message ?? 'Versturen mislukt');
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-conversations', orgId] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-messages', orgId] });
    },
    onError: (error: Error) => {
      toast.error(error.message ?? 'Bericht versturen mislukt');
    },
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useWhatsAppRealtime.ts src/hooks/useWhatsAppConversations.ts src/hooks/useWhatsAppMessages.ts src/hooks/useWhatsAppSend.ts
git commit -m "feat(whatsapp): add React hooks — realtime, conversations, messages, send"
```

---

### Task 9: Chat UI — Small Components (DateSeparator, ChatEmpty, MessageBubble)

**Files:**
- Create: `src/components/whatsapp/DateSeparator.tsx`
- Create: `src/components/whatsapp/ChatEmpty.tsx`
- Create: `src/components/whatsapp/MessageBubble.tsx`
- Create: `src/components/whatsapp/MediaMessage.tsx`

- [ ] **Step 1: Create DateSeparator**

```typescript
// src/components/whatsapp/DateSeparator.tsx
import { format, parseISO, isToday, isYesterday } from 'date-fns';
import { nl } from 'date-fns/locale';

interface DateSeparatorProps {
  date: string;
}

export function DateSeparator({ date }: DateSeparatorProps) {
  const parsed = parseISO(date);
  let label: string;

  if (isToday(parsed)) {
    label = 'Vandaag';
  } else if (isYesterday(parsed)) {
    label = 'Gisteren';
  } else {
    label = format(parsed, 'd MMMM yyyy', { locale: nl });
  }

  return (
    <div className="flex justify-center my-3">
      <span className="bg-muted text-muted-foreground text-xs px-3 py-1 rounded-full">
        {label}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Create ChatEmpty**

```typescript
// src/components/whatsapp/ChatEmpty.tsx
import { MessageSquare } from 'lucide-react';

export function ChatEmpty() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
      <MessageSquare className="h-16 w-16 mb-4 opacity-20" />
      <h3 className="text-lg font-medium mb-1">Selecteer een gesprek</h3>
      <p className="text-sm">of start een nieuw gesprek via de zoekbalk</p>
    </div>
  );
}
```

- [ ] **Step 3: Create MediaMessage**

```typescript
// src/components/whatsapp/MediaMessage.tsx
import { useState } from 'react';
import { FileText, Play, Download, MapPin, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';

interface MediaMessageProps {
  type: string;
  body: string;
  mediaId: string | null;
}

export function MediaMessage({ type, body, mediaId }: MediaMessageProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);

  switch (type) {
    case 'image':
      return (
        <div>
          {mediaId ? (
            <>
              <div
                className="cursor-pointer rounded-md overflow-hidden max-w-[280px] bg-muted flex items-center justify-center min-h-[100px]"
                onClick={() => setLightboxOpen(true)}
              >
                <span className="text-xs text-muted-foreground p-4">
                  [Afbeelding — klik om te laden]
                </span>
              </div>
              <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
                <DialogContent className="max-w-3xl">
                  <p className="text-center text-muted-foreground">
                    Media laden vereist download via Meta API
                  </p>
                </DialogContent>
              </Dialog>
            </>
          ) : null}
          {body && body !== '[Afbeelding]' && (
            <p className="text-sm mt-1">{body}</p>
          )}
        </div>
      );

    case 'video':
      return (
        <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md max-w-[280px]">
          <Play className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Video</p>
            <p className="text-xs text-muted-foreground">{body}</p>
          </div>
        </div>
      );

    case 'audio':
      return (
        <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md max-w-[280px]">
          <div className="w-full">
            <div className="h-8 bg-muted rounded flex items-center justify-center">
              <span className="text-xs text-muted-foreground">Spraakbericht</span>
            </div>
          </div>
        </div>
      );

    case 'document':
      return (
        <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md max-w-[280px]">
          <FileText className="h-8 w-8 text-muted-foreground flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{body}</p>
          </div>
          <Button variant="ghost" size="icon" className="flex-shrink-0">
            <Download className="h-4 w-4" />
          </Button>
        </div>
      );

    case 'sticker':
      return (
        <div className="w-24 h-24 bg-muted rounded-md flex items-center justify-center">
          <span className="text-2xl">🎨</span>
        </div>
      );

    case 'location':
      return (
        <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-md max-w-[280px]">
          <MapPin className="h-6 w-6 text-muted-foreground flex-shrink-0" />
          <p className="text-sm">{body}</p>
        </div>
      );

    case 'contacts':
      return (
        <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-md max-w-[280px]">
          <User className="h-6 w-6 text-muted-foreground flex-shrink-0" />
          <p className="text-sm">{body}</p>
        </div>
      );

    default:
      return <p className="text-sm">{body}</p>;
  }
}
```

- [ ] **Step 4: Create MessageBubble**

```typescript
// src/components/whatsapp/MessageBubble.tsx
import { format, parseISO } from 'date-fns';
import { Check, CheckCheck, Clock, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MediaMessage } from './MediaMessage';
import type { WhatsAppMessage } from '@/hooks/useWhatsAppMessages';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface MessageBubbleProps {
  message: WhatsAppMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isOutbound = message.direction === 'outbound';
  const isMedia = message.messageType && message.messageType !== 'text' && message.messageType !== 'reaction';
  const isFailed = message.whatsappStatus === 'failed';
  const time = format(parseISO(message.sentAt), 'HH:mm');

  return (
    <div className={cn('flex mb-1', isOutbound ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[75%] rounded-lg px-3 py-2 shadow-sm',
          isOutbound
            ? isFailed
              ? 'bg-destructive/10 border border-destructive/30'
              : 'bg-primary text-primary-foreground'
            : 'bg-card border'
        )}
      >
        {isMedia ? (
          <MediaMessage
            type={message.messageType!}
            body={message.body ?? ''}
            mediaId={message.mediaId}
          />
        ) : (
          <p className="text-sm whitespace-pre-wrap break-words">{message.body}</p>
        )}

        <div
          className={cn(
            'flex items-center justify-end gap-1 mt-1',
            isOutbound ? 'text-primary-foreground/70' : 'text-muted-foreground'
          )}
        >
          <span className="text-[10px]">{time}</span>
          {isOutbound && <StatusIcon status={message.whatsappStatus} />}
        </div>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: string | null }) {
  switch (status) {
    case 'read':
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger><CheckCheck className="h-3 w-3 text-blue-400" /></TooltipTrigger>
            <TooltipContent>Gelezen</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    case 'delivered':
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger><CheckCheck className="h-3 w-3" /></TooltipTrigger>
            <TooltipContent>Afgeleverd</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    case 'sent':
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger><Check className="h-3 w-3" /></TooltipTrigger>
            <TooltipContent>Verstuurd</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    case 'failed':
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger><AlertCircle className="h-3 w-3 text-destructive" /></TooltipTrigger>
            <TooltipContent>Mislukt</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    default:
      return <Clock className="h-3 w-3" />;
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/whatsapp/DateSeparator.tsx src/components/whatsapp/ChatEmpty.tsx src/components/whatsapp/MessageBubble.tsx src/components/whatsapp/MediaMessage.tsx
git commit -m "feat(whatsapp): add small chat components — DateSeparator, ChatEmpty, MessageBubble, MediaMessage"
```

---

### Task 10: Chat UI — ConversationList + ConversationItem

**Files:**
- Create: `src/components/whatsapp/ConversationItem.tsx`
- Create: `src/components/whatsapp/ConversationList.tsx`

- [ ] **Step 1: Create ConversationItem**

```typescript
// src/components/whatsapp/ConversationItem.tsx
import { format, parseISO, isToday, isYesterday } from 'date-fns';
import { nl } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import { User, Check, CheckCheck, Clock, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Conversation } from '@/hooks/useWhatsAppConversations';

interface ConversationItemProps {
  conversation: Conversation;
  isSelected: boolean;
  onClick: () => void;
}

export function ConversationItem({ conversation, isSelected, onClick }: ConversationItemProps) {
  const { candidateName, phone, lastMessage, lastMessageAt, lastDirection, unreadCount, whatsappStatus } = conversation;

  const timeLabel = formatConversationTime(lastMessageAt);
  const displayName = candidateName || phone;
  const hasUnread = unreadCount > 0;

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-3 text-left hover:bg-muted/50 transition-colors border-b',
        isSelected && 'bg-muted'
      )}
    >
      <div className="flex-shrink-0 h-10 w-10 rounded-full bg-muted flex items-center justify-center">
        <User className="h-5 w-5 text-muted-foreground" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className={cn('text-sm truncate', hasUnread && 'font-semibold')}>
            {displayName}
          </span>
          <span className={cn('text-[10px] flex-shrink-0', hasUnread ? 'text-primary font-semibold' : 'text-muted-foreground')}>
            {timeLabel}
          </span>
        </div>

        <div className="flex items-center justify-between mt-0.5">
          <div className="flex items-center gap-1 min-w-0">
            {lastDirection === 'outbound' && (
              <StatusMiniIcon status={whatsappStatus} />
            )}
            <span className={cn('text-xs truncate', hasUnread ? 'text-foreground' : 'text-muted-foreground')}>
              {lastMessage}
            </span>
          </div>
          {hasUnread && (
            <Badge variant="default" className="h-5 min-w-[20px] flex items-center justify-center text-[10px] px-1.5 ml-1 flex-shrink-0">
              {unreadCount}
            </Badge>
          )}
        </div>
      </div>
    </button>
  );
}

function StatusMiniIcon({ status }: { status: string | null }) {
  switch (status) {
    case 'read':
      return <CheckCheck className="h-3 w-3 text-blue-400 flex-shrink-0" />;
    case 'delivered':
      return <CheckCheck className="h-3 w-3 text-muted-foreground flex-shrink-0" />;
    case 'sent':
      return <Check className="h-3 w-3 text-muted-foreground flex-shrink-0" />;
    case 'failed':
      return <AlertCircle className="h-3 w-3 text-destructive flex-shrink-0" />;
    default:
      return <Clock className="h-3 w-3 text-muted-foreground flex-shrink-0" />;
  }
}

function formatConversationTime(dateStr: string): string {
  try {
    const date = parseISO(dateStr);
    if (isToday(date)) return format(date, 'HH:mm');
    if (isYesterday(date)) return 'Gisteren';
    return format(date, 'dd-MM', { locale: nl });
  } catch {
    return '';
  }
}
```

- [ ] **Step 2: Create ConversationList**

```typescript
// src/components/whatsapp/ConversationList.tsx
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Plus, Loader2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ConversationItem } from './ConversationItem';
import type { Conversation } from '@/hooks/useWhatsAppConversations';

interface ConversationListProps {
  conversations: Conversation[];
  isLoading: boolean;
  selectedPhone: string | null;
  onSelect: (phone: string, candidateId: string | null) => void;
  onNewChat: () => void;
}

export function ConversationList({
  conversations,
  isLoading,
  selectedPhone,
  onSelect,
  onNewChat,
}: ConversationListProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'known' | 'unknown'>('all');

  const filtered = conversations.filter((conv) => {
    // Search filter
    if (search) {
      const q = search.toLowerCase();
      const matchName = conv.candidateName?.toLowerCase().includes(q);
      const matchPhone = conv.phone.includes(search.replace(/[\s\-]/g, ''));
      if (!matchName && !matchPhone) return false;
    }

    // Tab filter
    switch (filter) {
      case 'unread':
        return conv.unreadCount > 0;
      case 'known':
        return !!conv.candidateId;
      case 'unknown':
        return !conv.candidateId;
      default:
        return true;
    }
  });

  return (
    <div className="flex flex-col h-full border-r">
      {/* Header */}
      <div className="p-3 border-b space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Zoeken..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          <Button size="icon" variant="outline" className="h-9 w-9" onClick={onNewChat}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
          <TabsList className="w-full h-8">
            <TabsTrigger value="all" className="text-xs flex-1">Alle</TabsTrigger>
            <TabsTrigger value="unread" className="text-xs flex-1">Ongelezen</TabsTrigger>
            <TabsTrigger value="known" className="text-xs flex-1">Kandidaten</TabsTrigger>
            <TabsTrigger value="unknown" className="text-xs flex-1">Onbekend</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Conversation list */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            {search ? 'Geen resultaten' : 'Geen gesprekken'}
          </div>
        ) : (
          filtered.map((conv) => (
            <ConversationItem
              key={conv.phone}
              conversation={conv}
              isSelected={selectedPhone === conv.phone}
              onClick={() => onSelect(conv.phone, conv.candidateId)}
            />
          ))
        )}
      </ScrollArea>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/whatsapp/ConversationItem.tsx src/components/whatsapp/ConversationList.tsx
git commit -m "feat(whatsapp): add ConversationList and ConversationItem components"
```

---

### Task 11: Chat UI — ChatHeader, ChatInput, AttachmentPicker

**Files:**
- Create: `src/components/whatsapp/ChatHeader.tsx`
- Create: `src/components/whatsapp/ChatInput.tsx`
- Create: `src/components/whatsapp/AttachmentPicker.tsx`

- [ ] **Step 1: Create ChatHeader**

```typescript
// src/components/whatsapp/ChatHeader.tsx
import { Button } from '@/components/ui/button';
import { ArrowLeft, User, PanelRight, Phone } from 'lucide-react';
import { Link } from 'react-router-dom';

interface ChatHeaderProps {
  candidateName: string | null;
  phone: string;
  candidateId: string | null;
  showBackButton: boolean;
  onBack: () => void;
  onToggleContact: () => void;
}

export function ChatHeader({
  candidateName,
  phone,
  candidateId,
  showBackButton,
  onBack,
  onToggleContact,
}: ChatHeaderProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b bg-card">
      {showBackButton && (
        <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8">
          <ArrowLeft className="h-4 w-4" />
        </Button>
      )}

      <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
        <User className="h-5 w-5 text-muted-foreground" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {candidateId ? (
            <Link
              to={`/kandidaten/${candidateId}`}
              className="text-sm font-medium hover:underline truncate"
            >
              {candidateName || phone}
            </Link>
          ) : (
            <span className="text-sm font-medium truncate">{candidateName || phone}</span>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Phone className="h-3 w-3" />
          <span>{phone}</span>
        </div>
      </div>

      <Button variant="ghost" size="icon" onClick={onToggleContact} className="h-8 w-8">
        <PanelRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Create AttachmentPicker**

```typescript
// src/components/whatsapp/AttachmentPicker.tsx
import { useRef } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Paperclip, Image, Video, FileText, Mic } from 'lucide-react';

interface AttachmentPickerProps {
  onFileSelect: (file: File, type: 'image' | 'video' | 'audio' | 'document') => void;
  disabled?: boolean;
}

export function AttachmentPicker({ onFileSelect, disabled }: AttachmentPickerProps) {
  const imageRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);

  const handleFile = (type: 'image' | 'video' | 'audio' | 'document') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelect(file, type);
      e.target.value = '';
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9" disabled={disabled}>
          <Paperclip className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-2" side="top" align="start">
        <div className="flex flex-col gap-1">
          <Button variant="ghost" size="sm" className="justify-start gap-2" onClick={() => imageRef.current?.click()}>
            <Image className="h-4 w-4 text-blue-500" /> Afbeelding
          </Button>
          <Button variant="ghost" size="sm" className="justify-start gap-2" onClick={() => videoRef.current?.click()}>
            <Video className="h-4 w-4 text-purple-500" /> Video
          </Button>
          <Button variant="ghost" size="sm" className="justify-start gap-2" onClick={() => audioRef.current?.click()}>
            <Mic className="h-4 w-4 text-green-500" /> Audio
          </Button>
          <Button variant="ghost" size="sm" className="justify-start gap-2" onClick={() => docRef.current?.click()}>
            <FileText className="h-4 w-4 text-orange-500" /> Document
          </Button>
        </div>

        <input ref={imageRef} type="file" accept="image/*" className="hidden" onChange={handleFile('image')} />
        <input ref={videoRef} type="file" accept="video/*" className="hidden" onChange={handleFile('video')} />
        <input ref={audioRef} type="file" accept="audio/*" className="hidden" onChange={handleFile('audio')} />
        <input ref={docRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" className="hidden" onChange={handleFile('document')} />
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 3: Create ChatInput**

```typescript
// src/components/whatsapp/ChatInput.tsx
import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, Loader2, FileText as TemplateIcon } from 'lucide-react';
import { AttachmentPicker } from './AttachmentPicker';
import { toast } from 'sonner';

interface ChatInputProps {
  onSendText: (text: string) => void;
  onSendMedia: (file: File, type: string) => void;
  onOpenTemplates: () => void;
  isSending: boolean;
}

export function ChatInput({ onSendText, onSendMedia, onOpenTemplates, isSending }: ChatInputProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;
    onSendText(trimmed);
    setText('');
    textareaRef.current?.focus();
  }, [text, isSending, onSendText]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = (file: File, type: 'image' | 'video' | 'audio' | 'document') => {
    // Max 100MB
    if (file.size > 100 * 1024 * 1024) {
      toast.error('Bestand is te groot (max 100MB)');
      return;
    }
    onSendMedia(file, type);
  };

  return (
    <div className="border-t p-3 bg-card">
      <div className="flex items-end gap-2">
        <AttachmentPicker onFileSelect={handleFileSelect} disabled={isSending} />

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={onOpenTemplates}
          disabled={isSending}
          title="Template bericht"
        >
          <TemplateIcon className="h-4 w-4" />
        </Button>

        <Textarea
          ref={textareaRef}
          placeholder="Typ een bericht..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 min-h-[36px] max-h-[120px] resize-none"
          rows={1}
          disabled={isSending}
        />

        <Button
          size="icon"
          className="h-9 w-9"
          onClick={handleSend}
          disabled={!text.trim() || isSending}
        >
          {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/whatsapp/ChatHeader.tsx src/components/whatsapp/ChatInput.tsx src/components/whatsapp/AttachmentPicker.tsx
git commit -m "feat(whatsapp): add ChatHeader, ChatInput, AttachmentPicker components"
```

---

### Task 12: Chat UI — ChatThread, ContactPanel, TemplatePicker

**Files:**
- Create: `src/components/whatsapp/ChatThread.tsx`
- Create: `src/components/whatsapp/ContactPanel.tsx`
- Create: `src/components/whatsapp/TemplatePicker.tsx`

- [ ] **Step 1: Create ChatThread**

```typescript
// src/components/whatsapp/ChatThread.tsx
import { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatHeader } from './ChatHeader';
import { ChatInput } from './ChatInput';
import { MessageBubble } from './MessageBubble';
import { DateSeparator } from './DateSeparator';
import { ChatEmpty } from './ChatEmpty';
import type { WhatsAppMessage } from '@/hooks/useWhatsAppMessages';
import { format, parseISO } from 'date-fns';

interface ChatThreadProps {
  phone: string | null;
  candidateName: string | null;
  candidateId: string | null;
  messages: WhatsAppMessage[];
  isLoading: boolean;
  isSending: boolean;
  showBackButton: boolean;
  onBack: () => void;
  onToggleContact: () => void;
  onSendText: (text: string) => void;
  onSendMedia: (file: File, type: string) => void;
  onOpenTemplates: () => void;
}

export function ChatThread({
  phone,
  candidateName,
  candidateId,
  messages,
  isLoading,
  isSending,
  showBackButton,
  onBack,
  onToggleContact,
  onSendText,
  onSendMedia,
  onOpenTemplates,
}: ChatThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevMessageCount = useRef(messages.length);

  // Auto-scroll on new message
  useEffect(() => {
    if (messages.length > prevMessageCount.current) {
      scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevMessageCount.current = messages.length;
  }, [messages.length]);

  // Scroll to bottom on conversation change
  useEffect(() => {
    scrollRef.current?.scrollIntoView();
  }, [phone]);

  if (!phone) return <ChatEmpty />;

  // Group messages by date for separators
  const messagesWithDates: Array<{ type: 'date'; date: string } | { type: 'message'; message: WhatsAppMessage }> = [];
  let lastDate = '';

  for (const msg of messages) {
    const date = format(parseISO(msg.sentAt), 'yyyy-MM-dd');
    if (date !== lastDate) {
      messagesWithDates.push({ type: 'date', date: msg.sentAt });
      lastDate = date;
    }
    messagesWithDates.push({ type: 'message', message: msg });
  }

  return (
    <div className="flex flex-col h-full">
      <ChatHeader
        candidateName={candidateName}
        phone={phone}
        candidateId={candidateId}
        showBackButton={showBackButton}
        onBack={onBack}
        onToggleContact={onToggleContact}
      />

      <ScrollArea className="flex-1 px-4 py-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            Nog geen berichten
          </div>
        ) : (
          messagesWithDates.map((item, i) =>
            item.type === 'date' ? (
              <DateSeparator key={`date-${i}`} date={item.date} />
            ) : (
              <MessageBubble key={item.message.id} message={item.message} />
            )
          )
        )}
        <div ref={scrollRef} />
      </ScrollArea>

      <ChatInput
        onSendText={onSendText}
        onSendMedia={onSendMedia}
        onOpenTemplates={onOpenTemplates}
        isSending={isSending}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create ContactPanel**

```typescript
// src/components/whatsapp/ContactPanel.tsx
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { User, Phone, Mail, FileText, ExternalLink, X, BellOff } from 'lucide-react';
import { Link } from 'react-router-dom';

interface ContactPanelProps {
  candidateId: string | null;
  phone: string;
  orgId: string;
  onClose: () => void;
}

export function ContactPanel({ candidateId, phone, orgId, onClose }: ContactPanelProps) {
  const { data: candidate } = useQuery({
    queryKey: ['candidate-contact', candidateId],
    queryFn: async () => {
      if (!candidateId) return null;
      const { data } = await supabase
        .from('candidates')
        .select('id, first_name, last_name, email, phone, status, employee_status, compliance_status')
        .eq('id', candidateId)
        .single();
      return data;
    },
    enabled: !!candidateId,
  });

  const { data: optedOut } = useQuery({
    queryKey: ['whatsapp-optout', candidateId, orgId],
    queryFn: async () => {
      if (!candidateId) return false;
      const { data } = await supabase
        .from('communication_preferences')
        .select('opted_out')
        .eq('candidate_id', candidateId)
        .eq('channel', 'whatsapp')
        .eq('organization_id', orgId)
        .maybeSingle();
      return data?.opted_out ?? false;
    },
    enabled: !!candidateId,
  });

  return (
    <div className="flex flex-col h-full border-l w-[300px]">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="text-sm font-medium">Contact info</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 p-4">
        {/* Avatar & Name */}
        <div className="flex flex-col items-center mb-4">
          <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center mb-2">
            <User className="h-10 w-10 text-muted-foreground" />
          </div>
          <h4 className="font-medium text-center">
            {candidate ? `${candidate.first_name ?? ''} ${candidate.last_name ?? ''}`.trim() : phone}
          </h4>
          <p className="text-sm text-muted-foreground">{phone}</p>
        </div>

        {optedOut && (
          <div className="flex items-center gap-2 p-2 mb-4 bg-destructive/10 rounded-md text-destructive text-xs">
            <BellOff className="h-4 w-4" />
            Afgemeld voor WhatsApp
          </div>
        )}

        {candidate && (
          <>
            <Separator className="my-3" />

            <div className="space-y-3">
              {candidate.email && (
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{candidate.email}</span>
                </div>
              )}

              <div className="flex items-center gap-2 text-sm">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span>{candidate.phone}</span>
              </div>

              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {candidate.status ?? 'onbekend'}
                </Badge>
                {candidate.employee_status && (
                  <Badge variant="outline" className="text-xs">
                    {candidate.employee_status}
                  </Badge>
                )}
              </div>

              {candidate.compliance_status && (
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <Badge
                    variant={candidate.compliance_status === 'compleet' ? 'default' : 'destructive'}
                    className="text-xs"
                  >
                    {candidate.compliance_status}
                  </Badge>
                </div>
              )}
            </div>

            <Separator className="my-3" />

            <div className="space-y-2">
              <Button variant="outline" size="sm" className="w-full justify-start gap-2" asChild>
                <Link to={`/kandidaten/${candidate.id}`}>
                  <ExternalLink className="h-4 w-4" /> Profiel openen
                </Link>
              </Button>
            </div>
          </>
        )}
      </ScrollArea>
    </div>
  );
}
```

- [ ] **Step 3: Create TemplatePicker**

```typescript
// src/components/whatsapp/TemplatePicker.tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, Send, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface TemplatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  onSend: (template: { name: string; language: string; components: any[] }) => void;
  isSending: boolean;
}

export function TemplatePicker({ open, onOpenChange, orgId, onSend, isSending }: TemplatePickerProps) {
  const [search, setSearch] = useState('');
  const [langFilter, setLangFilter] = useState<string>('all');
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [params, setParams] = useState<Record<string, string>>({});

  const { data: templates, isLoading, refetch } = useQuery({
    queryKey: ['whatsapp-templates', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('whatsapp_templates')
        .select('*')
        .eq('organization_id', orgId)
        .eq('status', 'APPROVED')
        .order('template_name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: open && !!orgId,
  });

  const handleSync = async () => {
    try {
      await supabase.functions.invoke('whatsapp-templates-sync');
      refetch();
      toast.success('Templates gesynchroniseerd');
    } catch {
      toast.error('Synchronisatie mislukt');
    }
  };

  const filtered = (templates ?? []).filter((t) => {
    if (search && !t.template_name.toLowerCase().includes(search.toLowerCase())) return false;
    if (langFilter !== 'all' && t.language !== langFilter) return false;
    return true;
  });

  // Extract parameter placeholders from template components
  const getParams = (template: any): string[] => {
    const params: string[] = [];
    const components = template.components ?? [];
    for (const comp of components) {
      if (comp.type === 'BODY' && comp.text) {
        const matches = comp.text.match(/\{\{(\d+)\}\}/g) ?? [];
        for (const m of matches) {
          const idx = m.replace(/[{}]/g, '');
          params.push(idx);
        }
      }
    }
    return params;
  };

  const handleSend = () => {
    if (!selectedTemplate) return;

    const paramList = getParams(selectedTemplate);
    const components: any[] = [];

    if (paramList.length > 0) {
      components.push({
        type: 'body',
        parameters: paramList.map((idx) => ({
          type: 'text',
          text: params[idx] ?? '',
        })),
      });
    }

    onSend({
      name: selectedTemplate.template_name,
      language: selectedTemplate.language,
      components,
    });

    setSelectedTemplate(null);
    setParams({});
    onOpenChange(false);
  };

  // Preview: replace {{1}}, {{2}} etc with filled params
  const getPreview = (): string => {
    if (!selectedTemplate) return '';
    const bodyComp = (selectedTemplate.components ?? []).find((c: any) => c.type === 'BODY');
    if (!bodyComp?.text) return selectedTemplate.template_name;

    let preview = bodyComp.text;
    for (const [key, value] of Object.entries(params)) {
      preview = preview.replace(`{{${key}}}`, value || `[param ${key}]`);
    }
    return preview;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            Template bericht
            <Button variant="ghost" size="sm" onClick={handleSync} className="gap-1">
              <RefreshCw className="h-3 w-3" /> Sync
            </Button>
          </DialogTitle>
        </DialogHeader>

        {!selectedTemplate ? (
          <>
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Zoek template..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>

              <Tabs value={langFilter} onValueChange={setLangFilter}>
                <TabsList className="h-8">
                  <TabsTrigger value="all" className="text-xs">Alle</TabsTrigger>
                  <TabsTrigger value="nl" className="text-xs">NL</TabsTrigger>
                  <TabsTrigger value="en" className="text-xs">EN</TabsTrigger>
                  <TabsTrigger value="pl" className="text-xs">PL</TabsTrigger>
                  <TabsTrigger value="ro" className="text-xs">RO</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <ScrollArea className="flex-1 max-h-[400px]">
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-center py-8 text-sm text-muted-foreground">
                  Geen templates gevonden
                </p>
              ) : (
                <div className="space-y-1">
                  {filtered.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        setSelectedTemplate(t);
                        setParams({});
                      }}
                      className="w-full text-left p-3 rounded-md hover:bg-muted transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium">{t.template_name}</span>
                        <Badge variant="outline" className="text-[10px]">{t.language}</Badge>
                        {t.category && (
                          <Badge variant="secondary" className="text-[10px]">{t.category}</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {(t.components as any[])?.find((c: any) => c.type === 'BODY')?.text ?? ''}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </>
        ) : (
          <>
            <div className="space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-medium">{selectedTemplate.template_name}</span>
                  <Badge variant="outline" className="text-xs">{selectedTemplate.language}</Badge>
                </div>

                {getParams(selectedTemplate).map((idx) => (
                  <div key={idx} className="mb-3">
                    <Label className="text-xs">Parameter {idx}</Label>
                    <Input
                      placeholder={`Waarde voor {{${idx}}}`}
                      value={params[idx] ?? ''}
                      onChange={(e) => setParams((p) => ({ ...p, [idx]: e.target.value }))}
                      className="mt-1"
                    />
                  </div>
                ))}

                <div className="bg-muted p-3 rounded-md mt-3">
                  <p className="text-xs text-muted-foreground mb-1">Preview:</p>
                  <p className="text-sm whitespace-pre-wrap">{getPreview()}</p>
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setSelectedTemplate(null)}>
                Terug
              </Button>
              <Button onClick={handleSend} disabled={isSending} className="gap-1">
                {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Verstuur
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/whatsapp/ChatThread.tsx src/components/whatsapp/ContactPanel.tsx src/components/whatsapp/TemplatePicker.tsx
git commit -m "feat(whatsapp): add ChatThread, ContactPanel, TemplatePicker components"
```

---

### Task 13: Chat UI — Main WhatsApp Page (Full Rewrite)

**Files:**
- Modify: `src/pages/WhatsApp.tsx` (full rewrite)

- [ ] **Step 1: Rewrite WhatsApp.tsx**

```typescript
// src/pages/WhatsApp.tsx
import { useState } from 'react';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useIsMobile } from '@/hooks/use-mobile';
import { useWhatsAppRealtime } from '@/hooks/useWhatsAppRealtime';
import { useWhatsAppConversations } from '@/hooks/useWhatsAppConversations';
import { useWhatsAppMessages } from '@/hooks/useWhatsAppMessages';
import { useWhatsAppSend } from '@/hooks/useWhatsAppSend';
import { ConversationList } from '@/components/whatsapp/ConversationList';
import { ChatThread } from '@/components/whatsapp/ChatThread';
import { ContactPanel } from '@/components/whatsapp/ContactPanel';
import { TemplatePicker } from '@/components/whatsapp/TemplatePicker';
import { ChatEmpty } from '@/components/whatsapp/ChatEmpty';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function WhatsApp() {
  const orgId = useOrganizationId();
  const isMobile = useIsMobile();

  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [showContactPanel, setShowContactPanel] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);

  // Realtime subscription
  useWhatsAppRealtime(orgId);

  // Data hooks
  const { data: conversations = [], isLoading: convLoading } = useWhatsAppConversations(orgId);
  const { data: messages = [], isLoading: msgLoading } = useWhatsAppMessages(orgId, selectedPhone);
  const sendMutation = useWhatsAppSend(orgId);

  // Find selected conversation for name
  const selectedConv = conversations.find((c) => c.phone === selectedPhone);

  const handleSelectConversation = (phone: string, candidateId: string | null) => {
    setSelectedPhone(phone);
    setSelectedCandidateId(candidateId);
    if (isMobile) setShowContactPanel(false);
  };

  const handleBack = () => {
    setSelectedPhone(null);
    setSelectedCandidateId(null);
  };

  const handleSendText = (text: string) => {
    if (!selectedPhone) return;
    sendMutation.mutate({
      to: selectedPhone,
      type: 'text',
      text: { body: text },
      candidate_id: selectedCandidateId ?? undefined,
    });
  };

  const handleSendMedia = (file: File, type: string) => {
    // For now, media sending requires uploading to a public URL first
    // This is a limitation — full implementation needs a media upload edge function
    toast.info('Media versturen wordt binnenkort ondersteund');
  };

  const handleSendTemplate = (template: { name: string; language: string; components: any[] }) => {
    if (!selectedPhone) return;
    sendMutation.mutate({
      to: selectedPhone,
      type: 'template',
      template,
      candidate_id: selectedCandidateId ?? undefined,
    });
  };

  const handleNewChat = () => {
    // TODO: Open a dialog to enter a phone number or search for a candidate
    toast.info('Nieuw gesprek starten: typ een telefoonnummer in de zoekbalk');
  };

  // Mobile: show either list or chat
  const showList = isMobile ? !selectedPhone : true;
  const showChat = isMobile ? !!selectedPhone : true;

  return (
    <div className="h-[calc(100vh-4rem)] flex">
      {/* Conversation List */}
      {showList && (
        <div className={cn('flex-shrink-0', isMobile ? 'w-full' : 'w-[300px]')}>
          <ConversationList
            conversations={conversations}
            isLoading={convLoading}
            selectedPhone={selectedPhone}
            onSelect={handleSelectConversation}
            onNewChat={handleNewChat}
          />
        </div>
      )}

      {/* Chat Thread */}
      {showChat && (
        <div className="flex-1 flex min-w-0">
          <div className="flex-1 min-w-0">
            {selectedPhone ? (
              <ChatThread
                phone={selectedPhone}
                candidateName={selectedConv?.candidateName ?? null}
                candidateId={selectedCandidateId}
                messages={messages}
                isLoading={msgLoading}
                isSending={sendMutation.isPending}
                showBackButton={isMobile}
                onBack={handleBack}
                onToggleContact={() => setShowContactPanel(!showContactPanel)}
                onSendText={handleSendText}
                onSendMedia={handleSendMedia}
                onOpenTemplates={() => setShowTemplates(true)}
              />
            ) : (
              <ChatEmpty />
            )}
          </div>

          {/* Contact Panel */}
          {showContactPanel && selectedPhone && !isMobile && (
            <ContactPanel
              candidateId={selectedCandidateId}
              phone={selectedPhone}
              orgId={orgId}
              onClose={() => setShowContactPanel(false)}
            />
          )}
        </div>
      )}

      {/* Template Picker Modal */}
      <TemplatePicker
        open={showTemplates}
        onOpenChange={setShowTemplates}
        orgId={orgId}
        onSend={handleSendTemplate}
        isSending={sendMutation.isPending}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify build succeeds**

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/WhatsApp.tsx
git commit -m "feat(whatsapp): rebuild WhatsApp page — 3-panel layout, realtime, responsive"
```

---

### Task 14: Update WhatsApp Settings Component

**Files:**
- Modify: `src/components/settings/WhatsAppSettings.tsx`

- [ ] **Step 1: Read the existing file and update it**

Key changes to make:
- Use `supabase.functions.invoke('whatsapp-register')` instead of raw fetch
- Add disconnect button (calls config endpoint with `action: disconnect`)
- Add template sync button
- Show phone number and WABA ID when connected
- Health indicator (check if config exists and is_active)

Read the existing file first, then update the registration flow to use the new edge function pattern and add a "Ontkoppelen" button.

- [ ] **Step 2: Commit**

```bash
git add src/components/settings/WhatsAppSettings.tsx
git commit -m "feat(whatsapp): update settings — disconnect support, template sync button"
```

---

## LAAG 3: Campaigns

### Task 15: Rebuild bulk-campaign-processor

**Files:**
- Modify: `supabase/functions/bulk-campaign-processor/index.ts` (full rewrite)

- [ ] **Step 1: Rewrite the bulk campaign processor**

```typescript
// supabase/functions/bulk-campaign-processor/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders,
  jsonOk,
  jsonError,
  getAuthenticatedOrg,
  normalizePhone,
  getWhatsAppCredentials,
  META_API_BASE,
} from "../_shared/whatsapp-utils.ts";

const BATCH_SIZE = 50;
const MAX_CONCURRENT = 5;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [60, 300, 900]; // 1min, 5min, 15min in seconds

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const auth = await getAuthenticatedOrg(req, supabase);
    if (auth instanceof Response) return auth;
    const { orgId, userId } = auth;

    const { campaign_id } = await req.json();
    if (!campaign_id) return jsonError("campaign_id is verplicht", 400);

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Load campaign
    const { data: campaign, error: campError } = await serviceClient
      .from("bulk_campaigns")
      .select("*")
      .eq("id", campaign_id)
      .eq("organization_id", orgId)
      .single();

    if (campError || !campaign) return jsonError("Campagne niet gevonden", 404);
    if (campaign.status !== "running" && campaign.status !== "scheduled") {
      return jsonError("Campagne is niet actief", 400);
    }

    // Set status to running
    await serviceClient
      .from("bulk_campaigns")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", campaign_id);

    // Get credentials
    const creds = await getWhatsAppCredentials(serviceClient, orgId);
    if (!creds) {
      await serviceClient
        .from("bulk_campaigns")
        .update({ status: "cancelled" })
        .eq("id", campaign_id);
      return jsonError("WhatsApp niet geconfigureerd", 400);
    }

    // Get recipients (pending + failed with retries available)
    const { data: recipients } = await serviceClient
      .from("campaign_recipients")
      .select("id, candidate_id, status, retry_count, candidates!inner(first_name, last_name, phone)")
      .eq("campaign_id", campaign_id)
      .or(`status.eq.pending,and(status.eq.failed,retry_count.lt.${MAX_RETRIES})`)
      .order("id");

    if (!recipients?.length) {
      await serviceClient
        .from("bulk_campaigns")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", campaign_id);
      return jsonOk({ status: "completed", sent: 0 });
    }

    let sentCount = 0;
    let failedCount = 0;

    // Process in batches
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      // Check if campaign was paused or cancelled
      const { data: currentCampaign } = await serviceClient
        .from("bulk_campaigns")
        .select("status")
        .eq("id", campaign_id)
        .single();

      if (currentCampaign?.status === "paused" || currentCampaign?.status === "cancelled") {
        break;
      }

      const batch = recipients.slice(i, i + BATCH_SIZE);

      // Process batch with concurrency limit
      const results = await processWithConcurrency(
        batch,
        MAX_CONCURRENT,
        async (recipient: any) => {
          const candidate = recipient.candidates;
          if (!candidate?.phone) return { recipientId: recipient.id, success: false, error: "Geen telefoonnummer" };

          const phone = normalizePhone(candidate.phone);

          // Merge fields in message template
          let messageBody = campaign.message_template ?? "";
          messageBody = messageBody.replace(/\{\{first_name\}\}/g, candidate.first_name ?? "");
          messageBody = messageBody.replace(/\{\{last_name\}\}/g, candidate.last_name ?? "");
          messageBody = messageBody.replace(/\{\{full_name\}\}/g, `${candidate.first_name ?? ""} ${candidate.last_name ?? ""}`.trim());

          try {
            const metaResponse = await fetch(
              `${META_API_BASE}/${creds.phone_number_id}/messages`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${creds.access_token}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  messaging_product: "whatsapp",
                  recipient_type: "individual",
                  to: phone.replace("+", ""),
                  type: "text",
                  text: { body: messageBody },
                }),
              }
            );

            const result = await metaResponse.json();

            if (metaResponse.ok) {
              const waMessageId = result.messages?.[0]?.id;

              // Log communication
              const { data: comm } = await serviceClient.from("communications").insert({
                organization_id: orgId,
                channel: "whatsapp",
                direction: "outbound",
                subject: `WhatsApp campagne naar ${phone}`,
                body: messageBody,
                candidate_id: recipient.candidate_id,
                sent_by: userId,
                sent_at: new Date().toISOString(),
                whatsapp_message_id: waMessageId,
                whatsapp_status: "pending",
                message_type: "text",
              }).select("id").single();

              return {
                recipientId: recipient.id,
                success: true,
                communicationId: comm?.id,
              };
            } else {
              return {
                recipientId: recipient.id,
                success: false,
                error: result?.error?.message ?? "Meta API error",
              };
            }
          } catch (err) {
            return { recipientId: recipient.id, success: false, error: String(err) };
          }
        }
      );

      // Update recipient statuses
      for (const result of results) {
        if (result.success) {
          sentCount++;
          await serviceClient
            .from("campaign_recipients")
            .update({
              status: "sent",
              sent_at: new Date().toISOString(),
              communication_id: result.communicationId,
            })
            .eq("id", result.recipientId);
        } else {
          failedCount++;
          const recipient = batch.find((r: any) => r.id === result.recipientId);
          const retryCount = (recipient?.retry_count ?? 0) + 1;
          const nextRetry = retryCount < MAX_RETRIES
            ? new Date(Date.now() + RETRY_DELAYS[retryCount - 1] * 1000).toISOString()
            : null;

          await serviceClient
            .from("campaign_recipients")
            .update({
              status: "failed",
              error_message: result.error,
              retry_count: retryCount,
              next_retry_at: nextRetry,
            })
            .eq("id", result.recipientId);
        }
      }

      // Update campaign progress
      await serviceClient
        .from("bulk_campaigns")
        .update({
          sent_count: (campaign.sent_count ?? 0) + sentCount,
          failed_count: (campaign.failed_count ?? 0) + failedCount,
        })
        .eq("id", campaign_id);

      // Rate limit delay between batches (2 seconds)
      if (i + BATCH_SIZE < recipients.length) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // Check final status
    const { data: remaining } = await serviceClient
      .from("campaign_recipients")
      .select("id")
      .eq("campaign_id", campaign_id)
      .eq("status", "pending")
      .limit(1);

    if (!remaining?.length) {
      await serviceClient
        .from("bulk_campaigns")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", campaign_id);
    }

    return jsonOk({ status: "ok", sent: sentCount, failed: failedCount });
  } catch (err) {
    console.error("bulk-campaign-processor error:", err);
    return jsonError("Interne fout", 500);
  }
});

async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (const item of items) {
    const p = fn(item).then((result) => {
      results.push(result);
    });
    executing.push(p);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
      // Remove settled promises
      const settled = executing.filter((e) => {
        let done = false;
        e.then(() => (done = true)).catch(() => (done = true));
        return done;
      });
      for (const s of settled) {
        executing.splice(executing.indexOf(s), 1);
      }
    }
  }

  await Promise.all(executing);
  return results;
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/bulk-campaign-processor/index.ts
git commit -m "feat(whatsapp): rebuild campaign processor — concurrent sends, retries, pause/cancel support"
```

---

### Task 16: Update CampaignWizard + BulkCampaigns Pages

**Files:**
- Modify: `src/components/campaigns/CampaignWizard.tsx`
- Modify: `src/pages/BulkCampaigns.tsx` (if exists, or the page that lists campaigns)

- [ ] **Step 1: Update CampaignWizard**

Key changes to make to the existing CampaignWizard:
- Add template bericht mode toggle (vrij bericht vs template)
- Add TemplatePicker integration for template mode
- Add live recipient preview (count + sample names)
- Add rate limit configuration fields
- Add STOP-footer auto-append for free text mode
- Better merge field validation

Read the existing file, then apply these specific modifications.

- [ ] **Step 2: Add Pause/Resume/Cancel buttons to campaign list page**

Read the existing BulkCampaigns page. Add:
- Pause button: updates `status` to 'paused', sets `paused_at`
- Resume button: updates `status` back to 'running', invokes processor
- Cancel button: updates `status` to 'cancelled', sets `cancelled_at`
- Progress bar showing sent/total ratio
- Retry indicator for failed recipients

- [ ] **Step 3: Commit**

```bash
git add src/components/campaigns/CampaignWizard.tsx src/pages/BulkCampaigns.tsx
git commit -m "feat(whatsapp): update campaign wizard — template mode, pause/resume/cancel, progress"
```

---

### Task 17: Update config.toml + Final Build Check

**Files:**
- Modify: `supabase/config.toml`

- [ ] **Step 1: Ensure all edge function configs are in config.toml**

Add entry for new function:

```toml
[functions.whatsapp-templates-sync]
verify_jwt = true

[functions.bulk-campaign-processor]
verify_jwt = true
```

Verify existing entries:
```toml
[functions.whatsapp-register]
verify_jwt = true

[functions.whatsapp-send]
verify_jwt = true

[functions.whatsapp-webhook]
verify_jwt = false

[functions.whatsapp-config]
verify_jwt = false
```

- [ ] **Step 2: Run full build**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No new lint errors from WhatsApp code.

- [ ] **Step 4: Final commit**

```bash
git add supabase/config.toml
git commit -m "feat(whatsapp): finalize config.toml and verify build"
```

---

## Verification Checklist

### Laag 1 (Backend):
- [ ] Migration applied successfully (check Supabase Dashboard > Table Editor for `whatsapp_templates`)
- [ ] `whatsapp-register`: POST via frontend → check `whatsapp_config` row created, setup URL returned
- [ ] `whatsapp-config`: Simulate Connect callback with curl → check credentials stored and `is_active=true`
- [ ] `whatsapp-send`: Send test text message → check Meta API response, `communications` row with `whatsapp_status=pending`
- [ ] `whatsapp-webhook`: POST simulated inbound message → check `communications` row with `direction=inbound`
- [ ] `whatsapp-templates-sync`: Invoke → check `whatsapp_templates` rows populated

### Laag 2 (Chat UI):
- [ ] Open `/whatsapp` → conversation list renders (or empty state)
- [ ] Select conversation → messages load in chat thread
- [ ] Send text message → optimistic update, edge function called, realtime confirmation
- [ ] Receive message (via webhook) → appears in chat via Realtime
- [ ] Template picker → opens, shows templates, parameter form works, sends
- [ ] Contact panel → toggle shows candidate info
- [ ] Mobile responsive → single panel view with back navigation

### Laag 3 (Campaigns):
- [ ] Create campaign via wizard → saved to `bulk_campaigns`
- [ ] "Verstuur nu" → processor runs, recipients get status updates
- [ ] Pause → processor stops at next batch check
- [ ] Resume → processor continues
- [ ] Failed messages → retry_count incremented, next_retry_at set
