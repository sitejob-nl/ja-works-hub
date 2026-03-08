

# Plan: WhatsApp Chat Page + Edge Function Audit

## What's Missing

1. **No dedicated WhatsApp page** - There's no `/whatsapp` route or chat-style UI. WhatsApp messages currently only appear in the generic Communications table.
2. **Edge function issues** to verify against the spec.

## Edge Function Audit

### `whatsapp-webhook` (existing)
- Correctly validates `X-Webhook-Secret` header
- Correctly returns 200 even on errors (prevents retries)
- Handles all message types (text, image, video, audio, document, sticker, location, contacts, reaction, interactive, button)
- Handles status updates (`sent`, `delivered`, `read`, `failed`)
- Deduplicates by `whatsapp_message_id`
- Matches candidates by phone number variants
- **Issue**: No `sent_at` field for status updates -- minor, acceptable
- **Overall: Looks correct per spec**

### `whatsapp-config` (existing)
- Validates `X-Webhook-Secret` header
- Handles disconnect action (clears credentials, sets `is_active: false`)
- Handles config push (stores `phone_number_id`, `access_token`, `display_phone`, `waba_id`)
- **Overall: Correct per spec**

### `whatsapp-register` (existing)
- Authenticates user via JWT
- Gets org from profile
- Calls SiteJob Connect `whatsapp-register-tenant` with `X-API-Key` header
- Stores `tenant_id` and `webhook_secret` in `whatsapp_config`
- Returns `setup_url`
- **Overall: Correct per spec**

### `whatsapp-send` (existing)
- Authenticates user via JWT
- Gets WhatsApp config via service role
- Sends directly to Meta API `graph.facebook.com/v25.0/{phone_number_id}/messages`
- Stores outbound message in `communications`
- **Issue**: Uses `getClaims()` which may not exist on older SDK -- but function is deployed and working per config
- **Overall: Correct per spec**

## Plan: Build WhatsApp Chat Page

### 1. Create `/whatsapp` route and page (`src/pages/WhatsApp.tsx`)

A chat-style interface for WhatsApp conversations:

**Layout**:
- Left panel: Conversation list (grouped by phone number / candidate)
- Right panel: Chat thread with message bubbles

**Left panel (conversations)**:
- Query `communications` where `channel = 'whatsapp'`, group by candidate or phone number
- Show last message preview, timestamp, unread indicator
- Search bar to filter conversations
- Status badges (delivered, read, etc.)

**Right panel (chat thread)**:
- Message bubbles: inbound on left (gray), outbound on right (primary color)
- Show message content, timestamp, status (sent/delivered/read checkmarks)
- Bottom: text input + send button
- Calls `whatsapp-send` edge function on submit
- Auto-scroll to latest message

**Header**:
- Contact name (linked to candidate detail if matched)
- Phone number
- Connection status indicator

### 2. Add route to `App.tsx`
- Add `/whatsapp` route pointing to the new page

### 3. Add sidebar nav item in `AppSidebar.tsx`
- Add WhatsApp entry with MessageSquare icon (green variant)
- Module key: `whatsapp`

### 4. No database changes needed
- All data already stored in `communications` table with `channel = 'whatsapp'`

## Technical Details

- Group conversations using a query that selects distinct phone numbers from `communications` where `channel = 'whatsapp'`, with latest message per conversation
- For the chat thread, query messages filtered by the selected phone number (extracted from subject or a new approach using candidate_id)
- Use React Query with short polling interval (or manual refresh) for near-realtime updates
- Reuse existing `whatsapp-send` function invocation pattern from Communications page
- Format phone numbers for display using existing format utils

