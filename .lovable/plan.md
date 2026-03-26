

# Fix Plan: Build Errors + WhatsApp/Exact Encryption Issues

## Problem Analysis

There are **two categories** of issues:

### A. TypeScript Build Errors (4 files)
Simple type errors that block deployment.

### B. Encryption Breaking WhatsApp & Exact Connect (Root Cause)
The encryption triggers (`encrypt_exact_sensitive`, `encrypt_whatsapp_sensitive`) encrypt `webhook_secret` and `access_token` on write. But multiple edge functions read these values raw and use them for:
- **Authenticating with SiteJob Connect** (sending `webhook_secret` to `exact-token` endpoint)
- **Comparing incoming webhook secrets** (in `exact-config`, `exact-webhook`)

After encryption, the stored values are base64 ciphertext — not the original secrets. This breaks all authentication flows.

---

## Fix 1: TypeScript Build Errors

### 1a. `apify-job-import/index.ts` line 248
`err` is `unknown` — cast to `(err as Error).message`

### 1b. `bulk-campaign-processor/index.ts` line 239
Same fix: `(err as Error).message`

### 1c. `portal-activate/index.ts` line 111
Same fix: `(err as Error).message`

### 1d. `opt-out-handler/index.ts` line 112
`.catch()` doesn't exist on PostgREST builder. Wrap the `rpc` call in a try/catch instead.

### 1e. `src/pages/Invoices.tsx` line 46
`statusFilter` is `string` but `.eq('status', ...)` expects the enum type. Cast: `.eq('status', statusFilter as any)`

---

## Fix 2: Exact Online Edge Functions — Decrypt Before Use

### 2a. Create `get_exact_token` RPC function (migration)
Similar to `get_whatsapp_token`, create a Security Definer function that decrypts `webhook_secret` from `exact_config`:

```sql
CREATE OR REPLACE FUNCTION public.get_exact_token(p_org_id uuid)
RETURNS TABLE(tenant_id text, decrypted_webhook_secret text, division int, base_url text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault'
AS $$ ...decrypt_sensitive(webhook_secret)... $$;
```

### 2b. Update `exact-api/index.ts`
Replace raw `config.webhook_secret` read with `serviceClient.rpc('get_exact_token', { p_org_id })` call. Pass the decrypted secret to `getExactToken()`.

### 2c. Update `exact-config/index.ts`
Currently compares `config.webhook_secret !== webhookSecret` — but stored value is encrypted. Use `serviceClient.rpc('get_exact_token')` to get decrypted secret for comparison.

### 2d. Update `exact-webhook/index.ts`
Same issue: finds config by `webhook_secret` but stored value is encrypted. Change to: query all configs, then decrypt and compare (or add an RPC that looks up by decrypted secret).

---

## Fix 3: WhatsApp Edge Functions — Already Partially Fixed

`whatsapp-send` already uses `get_whatsapp_token` RPC — correct.
`whatsapp-config` already uses `get_whatsapp_token` for comparison — correct.
`whatsapp-webhook` needs checking — it may read raw encrypted values.

---

## Execution Order
1. Fix all 5 TypeScript errors (unblocks build)
2. Create `get_exact_token` RPC via migration
3. Update 3 Exact edge functions to use decrypted values
4. Verify whatsapp-webhook uses decryption

