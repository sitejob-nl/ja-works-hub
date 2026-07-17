// supabase/functions/whatsapp-api/index.ts
// Generic proxy for ALL WhatsApp Cloud API (Meta Graph API v25.0) calls.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireInternalProfile } from "../_shared/auth.ts";
import {
  corsHeaders,
  jsonOk,
  jsonError,
  getWhatsAppCredentials,
  metaErrorToDutch,
  META_API_BASE,
} from "../_shared/whatsapp-utils.ts";

// Media-header handles voor templates lopen via SiteJob Connect (die heeft de Meta
// App-ID + doet de Resumable Upload). Wij sturen het voorbeeldbestand + tenant-secret.
const CONNECT_UPLOAD_HANDLE_URL =
  "https://xeshjkznwdrxjjhbpisn.supabase.co/functions/v1/whatsapp-upload-handle";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Internal-only: dit is een generieke Meta-proxy (templates aanmaken/verwijderen,
    // profiel, QR-codes, analytics). Portal-rollen mogen hier nooit bij.
    const auth = await requireInternalProfile(req, corsHeaders);
    if (auth instanceof Response) return auth;
    const orgId = auth.organizationId;

    // Service client for Vault-decrypted credential access (bypasses RLS)
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const creds = await getWhatsAppCredentials(serviceClient, orgId);
    if (!creds) return jsonError("WhatsApp niet geconfigureerd", 400);

    const { action, ...params } = await req.json();
    if (!action) return jsonError("Veld 'action' is verplicht", 400);

    const { phone_number_id, waba_id, access_token } = creds;
    const authHeader = { Authorization: `Bearer ${access_token}` };
    const jsonHeaders = { ...authHeader, "Content-Type": "application/json" };

    let url: string;
    let method: string;
    let body: string | undefined;

    switch (action) {
      // ── Business Profile ─────────────────────────────────────────────────

      case "get_profile": {
        url = `${META_API_BASE}/${phone_number_id}/whatsapp_business_profile` +
          `?fields=about,address,description,email,profile_picture_url,websites,vertical`;
        method = "GET";
        break;
      }

      case "update_profile": {
        url = `${META_API_BASE}/${phone_number_id}/whatsapp_business_profile`;
        method = "POST";
        body = JSON.stringify({ messaging_product: "whatsapp", ...params.data });
        break;
      }

      case "upload_profile_photo": {
        // Accepts base64-encoded image data, uploads to Meta, then sets as profile photo
        if (!params.image_base64 || !params.mime_type) {
          return jsonError("image_base64 en mime_type zijn verplicht", 400);
        }

        // Decode base64 to binary
        const binaryStr = atob(params.image_base64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }

        // Upload as media to get a handle
        const formData = new FormData();
        formData.append("messaging_product", "whatsapp");
        formData.append("file", new Blob([bytes], { type: params.mime_type }), "profile.jpg");
        formData.append("type", "image");

        const uploadRes = await fetch(`${META_API_BASE}/${phone_number_id}/media`, {
          method: "POST",
          headers: { Authorization: `Bearer ${access_token}` },
          body: formData,
        });

        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) {
          console.error("Media upload failed:", uploadData);
          return jsonError(metaErrorToDutch(uploadData?.error?.code, uploadData?.error?.message, "De foto kon niet worden geüpload."), 502);
        }

        // Now update profile with the media handle
        const profileRes = await fetch(
          `${META_API_BASE}/${phone_number_id}/whatsapp_business_profile`,
          {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({
              messaging_product: "whatsapp",
              profile_picture_handle: uploadData.id,
            }),
          }
        );

        const profileResult = await profileRes.json();
        if (!profileRes.ok) {
          console.error("Profile photo update failed:", profileResult);
          return jsonError(metaErrorToDutch(profileResult?.error?.code, profileResult?.error?.message, "De profielfoto kon niet worden ingesteld."), 502);
        }

        return jsonOk({ success: true, media_id: uploadData.id });
      }

      // ── Template media-header handle (via SiteJob Connect) ────────────────

      case "upload_header_media": {
        // Voorbeeldbestand voor een IMAGE/VIDEO/DOCUMENT-template-header. Meta eist bij het
        // aanmaken een example.header_handle uit de Resumable Upload API; die upload draait
        // op de Meta App-ID en gebeurt daarom bij SiteJob Connect.
        if (!params.base64 || !params.mime_type) {
          return jsonError("base64 en mime_type zijn verplicht", 400);
        }
        if (!creds.webhook_secret) {
          return jsonError("WhatsApp-koppeling incompleet (geen webhook secret)", 400);
        }

        const { data: cfg } = await serviceClient
          .from("whatsapp_config")
          .select("tenant_id")
          .eq("organization_id", orgId)
          .maybeSingle();
        if (!cfg?.tenant_id) return jsonError("WhatsApp niet gekoppeld", 400);

        const uploadRes = await fetch(CONNECT_UPLOAD_HANDLE_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Secret": creds.webhook_secret,
          },
          body: JSON.stringify({
            tenant_id: cfg.tenant_id,
            secret: creds.webhook_secret,
            file: {
              base64: params.base64,
              filename: params.filename ?? "template-header",
              mime_type: params.mime_type,
            },
            purpose: "template_header",
          }),
        });

        const uploadData = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok || !uploadData?.handle) {
          console.error("upload_header_media failed:", uploadData);
          return jsonError(
            "Het voorbeeldbestand kon niet worden geüpload. Gebruik een geldige JPG/PNG (afbeelding), MP4 (video) of PDF (document) en probeer opnieuw.",
            502,
          );
        }

        return jsonOk({ handle: uploadData.handle });
      }

      // ── Account / Phone Status ────────────────────────────────────────────

      case "get_phone_status": {
        url = `${META_API_BASE}/${phone_number_id}` +
          `?fields=verified_name,code_verification_status,quality_rating,platform_type,` +
          `throughput,display_phone_number,name_status,is_official_business_account`;
        method = "GET";
        break;
      }

      // ── Message Templates ─────────────────────────────────────────────────

      case "list_templates": {
        const qs = new URLSearchParams({ limit: "100" });
        if (params.status) qs.set("status", params.status);
        url = `${META_API_BASE}/${waba_id}/message_templates?${qs}`;
        method = "GET";
        break;
      }

      case "create_template": {
        url = `${META_API_BASE}/${waba_id}/message_templates`;
        method = "POST";
        body = JSON.stringify(params.data);
        break;
      }

      case "delete_template": {
        if (!params.name) return jsonError("Veld 'name' is verplicht voor delete_template", 400);
        const qs = new URLSearchParams({ name: params.name });
        if (params.hsm_id) qs.set("hsm_id", params.hsm_id);
        url = `${META_API_BASE}/${waba_id}/message_templates?${qs}`;
        method = "DELETE";
        break;
      }

      case "get_template": {
        if (!params.template_id) return jsonError("Veld 'template_id' is verplicht voor get_template", 400);
        url = `${META_API_BASE}/${params.template_id}`;
        method = "GET";
        break;
      }

      // ── QR Codes ──────────────────────────────────────────────────────────

      case "list_qr_codes": {
        url = `${META_API_BASE}/${phone_number_id}/message_qrdls`;
        method = "GET";
        break;
      }

      case "create_qr_code": {
        if (!params.prefilled_message) return jsonError("Veld 'prefilled_message' is verplicht voor create_qr_code", 400);
        url = `${META_API_BASE}/${phone_number_id}/message_qrdls`;
        method = "POST";
        body = JSON.stringify({
          prefilled_message: params.prefilled_message,
          generate_qr_image: params.format ?? "SVG",
        });
        break;
      }

      case "update_qr_code": {
        if (!params.qr_id) return jsonError("Veld 'qr_id' is verplicht voor update_qr_code", 400);
        url = `${META_API_BASE}/${phone_number_id}/message_qrdls/${params.qr_id}`;
        method = "POST";
        body = JSON.stringify({ prefilled_message: params.prefilled_message });
        break;
      }

      case "delete_qr_code": {
        if (!params.qr_id) return jsonError("Veld 'qr_id' is verplicht voor delete_qr_code", 400);
        url = `${META_API_BASE}/${phone_number_id}/message_qrdls/${params.qr_id}`;
        method = "DELETE";
        break;
      }

      // ── Analytics ─────────────────────────────────────────────────────────

      case "get_analytics": {
        const qs = new URLSearchParams();
        if (params.start) qs.set("start", params.start);
        if (params.end) qs.set("end", params.end);
        if (params.granularity) qs.set("granularity", params.granularity);
        url = `${META_API_BASE}/${waba_id}/analytics?${qs}`;
        method = "GET";
        break;
      }

      case "get_template_analytics": {
        const qs = new URLSearchParams();
        if (params.start) qs.set("start", params.start);
        if (params.end) qs.set("end", params.end);
        if (params.granularity) qs.set("granularity", params.granularity);
        url = `${META_API_BASE}/${waba_id}/template_analytics?${qs}`;
        method = "GET";
        break;
      }

      // ── Media ─────────────────────────────────────────────────────────────

      case "get_media_url": {
        if (!params.media_id) return jsonError("Veld 'media_id' is verplicht voor get_media_url", 400);
        url = `${META_API_BASE}/${params.media_id}`;
        method = "GET";
        break;
      }

      case "download_media": {
        // Twee stappen: media-URL ophalen, daarna de bytes zelf downloaden.
        // De lookaside-URL van Meta vereist het access token, dus de browser
        // kan dit niet rechtstreeks — we proxien de binary als base64.
        if (!params.media_id) return jsonError("Veld 'media_id' is verplicht voor download_media", 400);

        const metaRes = await fetch(`${META_API_BASE}/${params.media_id}`, { headers: authHeader });
        const metaInfo = await metaRes.json();
        if (!metaRes.ok || !metaInfo?.url) {
          console.error("download_media: media-info ophalen mislukt:", metaInfo);
          return jsonError(metaErrorToDutch(metaInfo?.error?.code, metaInfo?.error?.message, "Het bestand kon niet worden opgehaald."), 502);
        }

        const MAX_MEDIA_BYTES = 15 * 1024 * 1024;
        if (typeof metaInfo.file_size === "number" && metaInfo.file_size > MAX_MEDIA_BYTES) {
          return jsonError("Bestand is te groot om te downloaden (max 15 MB)", 413);
        }

        const fileRes = await fetch(metaInfo.url, { headers: authHeader });
        if (!fileRes.ok) {
          return jsonError(`Media-download mislukt (${fileRes.status})`, 502);
        }
        const buffer = await fileRes.arrayBuffer();
        if (buffer.byteLength > MAX_MEDIA_BYTES) {
          return jsonError("Bestand is te groot om te downloaden (max 15 MB)", 413);
        }

        const bytesArr = new Uint8Array(buffer);
        let binary = "";
        const chunkSize = 0x8000;
        for (let i = 0; i < bytesArr.length; i += chunkSize) {
          binary += String.fromCharCode(...bytesArr.subarray(i, i + chunkSize));
        }
        return jsonOk({
          base64: btoa(binary),
          mime_type: metaInfo.mime_type ?? "application/octet-stream",
          file_size: buffer.byteLength,
        });
      }

      case "delete_media": {
        if (!params.media_id) return jsonError("Veld 'media_id' is verplicht voor delete_media", 400);
        url = `${META_API_BASE}/${params.media_id}`;
        method = "DELETE";
        break;
      }

      default:
        return jsonError(`Onbekende action: '${action}'`, 400);
    }

    const fetchOptions: RequestInit = {
      method,
      headers: body ? jsonHeaders : authHeader,
    };
    if (body) fetchOptions.body = body;

    const metaResponse = await fetch(url, fetchOptions);
    const result = await metaResponse.json();

    if (!metaResponse.ok) {
      console.error(`whatsapp-api [${action}] Meta error:`, result);
      return jsonError(
        metaErrorToDutch(result?.error?.code, result?.error?.message, "De WhatsApp-actie is mislukt. Probeer het later opnieuw."),
        metaResponse.status >= 500 ? 502 : metaResponse.status
      );
    }

    return jsonOk(result);
  } catch (err) {
    console.error("whatsapp-api error:", err);
    return jsonError("Interne fout", 500);
  }
});
