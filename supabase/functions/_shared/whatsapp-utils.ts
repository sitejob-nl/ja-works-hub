import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isOutboundPaused, logConceptCommunication } from "./outbound-pause.ts";

export const META_API_BASE = "https://graph.facebook.com/v25.0";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

/** Standard JSON success response with CORS */
export function jsonOk(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Standard JSON error response with CORS */
export function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Normalize any Dutch phone number format to E.164 (+316xxxxxxxx).
 * Handles: 06-, +316, 00316, 316, with spaces/dashes/parentheses.
 */
export function normalizePhone(phone: string): string {
  // Strip all whitespace, dashes, parentheses
  let digits = phone.replace(/[\s\-().]/g, "");

  // +31... → strip leading +
  if (digits.startsWith("+")) {
    digits = digits.slice(1);
  }

  // 0031... → strip leading 00
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  // 316xxxxxxxx → already country-prefixed (without +)
  if (digits.startsWith("316") && digits.length === 11) {
    return "+" + digits;
  }

  // 31xxxxxxxxx (9-digit subscriber without mobile prefix) → keep as-is
  if (digits.startsWith("31") && digits.length === 11) {
    return "+" + digits;
  }

  // 06xxxxxxxx → Dutch mobile without country code
  if (digits.startsWith("06") && digits.length === 10) {
    return "+31" + digits.slice(1); // replace leading 0 with +31
  }

  // 6xxxxxxxx → Dutch mobile without leading 0
  if (digits.startsWith("6") && digits.length === 9) {
    return "+31" + digits;
  }

  // Fallback: return with + prefix as-is
  return "+" + digits;
}

export interface WhatsAppCredentials {
  phone_number_id: string;
  access_token: string;
  waba_id: string;
  display_phone: string;
  webhook_secret: string;
}

/**
 * Fetch and decrypt WhatsApp credentials for an organisation.
 * Calls the `get_whatsapp_token` RPC which handles Vault decryption.
 * Returns null when no config exists or on RPC error.
 */
export async function getWhatsAppCredentials(
  supabase: SupabaseClient,
  orgId: string
): Promise<WhatsAppCredentials | null> {
  const { data, error } = await supabase.rpc("get_whatsapp_token", {
    p_org_id: orgId,
  });

  if (error || !data || data.length === 0) {
    return null;
  }

  const row = data[0];
  return {
    phone_number_id: row.phone_number_id,
    access_token: row.decrypted_access_token,
    waba_id: row.waba_id,
    display_phone: row.display_phone,
    webhook_secret: row.decrypted_webhook_secret,
  };
}

export interface AuthenticatedOrg {
  orgId: string;
  userId: string;
}

/**
 * Extract and validate the Bearer token from the request, resolve the user,
 * then look up the user's organisation_id from the profiles table.
 *
 * Returns either an `AuthenticatedOrg` object on success, or a `Response`
 * (error) that the caller should return immediately.
 */
export async function getAuthenticatedOrg(
  req: Request,
  supabase: SupabaseClient
): Promise<AuthenticatedOrg | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return jsonError("Missing or invalid Authorization header", 401);
  }

  const token = authHeader.replace("Bearer ", "");

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return jsonError("Unauthorized", 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();

  if (profileError || !profile?.organization_id) {
    return jsonError("Organization not found", 403);
  }

  return { orgId: profile.organization_id, userId: user.id };
}

export type WhatsAppLifecycleClient = {
  from: (table: string) => any;
  rpc?: (fn: string, args?: Record<string, unknown>) => any;
};

export type WhatsAppMessageKind =
  | "text"
  | "template"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "reaction"
  | "interactive";

export type WhatsAppProviderSendInput = {
  credentials: WhatsAppCredentials;
  payload: Record<string, unknown>;
};

export type WhatsAppProviderSendResult = {
  messageId?: string | null;
  raw?: unknown;
};

export type WhatsAppProviderAdapter = {
  sendMessage: (input: WhatsAppProviderSendInput) => Promise<WhatsAppProviderSendResult>;
  markMessageRead?: (input: {
    credentials: WhatsAppCredentials;
    messageId: string;
  }) => Promise<unknown>;
};

export class WhatsAppProviderError extends Error {
  providerStatus: number;
  providerCode?: string | number | null;
  providerBody?: unknown;

  constructor(message: string, options: {
    providerStatus: number;
    providerCode?: string | number | null;
    providerBody?: unknown;
  }) {
    super(message);
    this.name = "WhatsAppProviderError";
    this.providerStatus = options.providerStatus;
    this.providerCode = options.providerCode ?? null;
    this.providerBody = options.providerBody;
  }
}

async function readProviderBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function providerErrorMessage(body: unknown): string {
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as any).error;
    return err?.message ?? err?.error_user_msg ?? "WhatsApp-providerfout";
  }
  if (typeof body === "string" && body.trim()) return body.slice(0, 500);
  return "WhatsApp-providerfout";
}

/**
 * Vertaalt een Meta/WhatsApp-foutcode naar een begrijpelijke Nederlandse melding voor
 * de eindgebruiker. Rauwe Engelse Meta-teksten tonen we nooit — die alleen server-side
 * loggen. Onbekende codes vallen terug op `fallback`.
 */
export function metaErrorToDutch(
  code?: string | number | null,
  _raw?: string | null,
  fallback = "Versturen via WhatsApp is mislukt. Probeer het later opnieuw.",
): string {
  const c = code != null ? String(code) : "";
  const map: Record<string, string> = {
    // 24-uurs servicevenster / re-engagement
    "131047": "Je kunt dit bericht niet sturen: er zijn meer dan 24 uur voorbij sinds het laatste bericht van de kandidaat. Stuur een goedgekeurde template om het gesprek te heropenen.",
    "470": "Het 24-uurs venster is gesloten. Stuur een goedgekeurde template om het gesprek te heropenen.",
    "131051": "Dit berichttype wordt niet ondersteund.",
    // Bezorging / nummer
    "131026": "Dit bericht kon niet worden bezorgd. Het nummer gebruikt mogelijk geen WhatsApp of kan geen berichten ontvangen.",
    "133010": "Dit telefoonnummer is niet geregistreerd voor WhatsApp.",
    "1013": "Dit lijkt geen geldig WhatsApp-nummer.",
    // Rate limiting
    "131056": "Te veel berichten naar dit nummer in korte tijd. Probeer het later opnieuw.",
    "80007": "Te veel verzoeken naar WhatsApp. Probeer het later opnieuw.",
    "131048": "Er zijn te veel berichten verstuurd. Probeer het later opnieuw.",
    // Templates
    "132000": "De gekozen template klopt niet meer (verwijderd, gepauzeerd, of het aantal variabelen wijkt af). Synchroniseer de templates opnieuw.",
    "132001": "De gekozen template bestaat niet (meer). Synchroniseer de templates opnieuw.",
    "132005": "De template is afgekeurd door WhatsApp.",
    "132007": "De template-inhoud voldoet niet aan de WhatsApp-richtlijnen.",
    "132012": "De variabelen van deze template kloppen niet met wat is goedgekeurd.",
    "132015": "Deze template is gepauzeerd door WhatsApp.",
    "132016": "Deze template is uitgeschakeld door WhatsApp.",
    // Auth / koppeling
    "190": "De WhatsApp-koppeling is verlopen. Koppel WhatsApp opnieuw in Instellingen.",
    "0": "De WhatsApp-koppeling is verlopen of ongeldig. Koppel WhatsApp opnieuw in Instellingen.",
    "10": "De WhatsApp-koppeling heeft onvoldoende rechten voor deze actie.",
    "200": "De WhatsApp-koppeling heeft onvoldoende rechten voor deze actie.",
    // Algemeen ongeldig verzoek
    "100": "Het verzoek naar WhatsApp was ongeldig. Controleer de invoer en probeer opnieuw.",
    "131000": "Er ging iets mis bij WhatsApp. Probeer het later opnieuw.",
    "131009": "Een van de waarden in dit bericht is ongeldig.",
  };
  return (c && map[c]) || fallback;
}

function providerErrorCode(body: unknown): string | number | null {
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as any).error;
    return err?.code ?? err?.type ?? null;
  }
  return null;
}

export const metaGraphWhatsAppAdapter: WhatsAppProviderAdapter = {
  async sendMessage({ credentials, payload }) {
    const res = await fetch(`${META_API_BASE}/${credentials.phone_number_id}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const body = await readProviderBody(res);
    if (!res.ok) {
      throw new WhatsAppProviderError(providerErrorMessage(body), {
        providerStatus: res.status,
        providerCode: providerErrorCode(body),
        providerBody: body,
      });
    }
    return {
      messageId: (body as any)?.messages?.[0]?.id ?? null,
      raw: body,
    };
  },

  async markMessageRead({ credentials, messageId }) {
    const res = await fetch(`${META_API_BASE}/${credentials.phone_number_id}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      }),
    });
    const body = await readProviderBody(res);
    if (!res.ok) {
      throw new WhatsAppProviderError(providerErrorMessage(body), {
        providerStatus: res.status,
        providerCode: providerErrorCode(body),
        providerBody: body,
      });
    }
    return body;
  },
};

export type BuildWhatsAppPayloadInput = {
  to: string;
  type: WhatsAppMessageKind | string;
  text?: { body?: string | null; preview_url?: boolean | null } | null;
  template?: { name?: string | null; language?: string | null; components?: unknown[] | null } | null;
  image?: Record<string, unknown> | null;
  video?: Record<string, unknown> | null;
  audio?: Record<string, unknown> | null;
  document?: Record<string, unknown> | null;
  reaction?: { emoji?: string | null; [key: string]: unknown } | null;
  interactive?: any;
  context?: { message_id?: string | null } | null;
};

export type BuiltWhatsAppPayload = {
  normalizedTo: string;
  messageType: string;
  messageBody: string;
  payload: Record<string, unknown>;
};

export function buildWhatsAppProviderPayload(input: BuildWhatsAppPayloadInput): BuiltWhatsAppPayload {
  const normalizedTo = normalizePhone(input.to);
  const payload: Record<string, unknown> = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizedTo.replace("+", ""),
  };
  let messageBody = "";

  switch (input.type) {
    case "text":
      payload.type = "text";
      payload.text = {
        body: input.text?.body ?? "",
        preview_url: input.text?.preview_url ?? false,
      };
      messageBody = input.text?.body ?? "";
      break;

    case "template":
      payload.type = "template";
      payload.template = {
        name: input.template?.name,
        language: { code: input.template?.language ?? "nl" },
        components: input.template?.components ?? [],
      };
      messageBody = `[Template: ${input.template?.name ?? "onbekend"}]`;
      break;

    case "image":
      payload.type = "image";
      payload.image = input.image ?? {};
      messageBody = (input.image?.caption as string | undefined) ?? "[Afbeelding]";
      break;

    case "video":
      payload.type = "video";
      payload.video = input.video ?? {};
      messageBody = (input.video?.caption as string | undefined) ?? "[Video]";
      break;

    case "audio":
      payload.type = "audio";
      payload.audio = input.audio ?? {};
      messageBody = "[Audio]";
      break;

    case "document":
      payload.type = "document";
      payload.document = input.document ?? {};
      messageBody = (input.document?.caption as string | undefined)
        ?? `[Document: ${(input.document?.filename as string | undefined) ?? "bestand"}]`;
      break;

    case "reaction":
      payload.type = "reaction";
      payload.reaction = input.reaction ?? {};
      messageBody = `[Reactie: ${input.reaction?.emoji ?? ""}]`;
      break;

    case "interactive":
      payload.type = "interactive";
      payload.interactive = input.interactive ?? {};
      if (input.interactive?.type === "button") {
        messageBody = `[Knoppen: ${input.interactive?.body?.text ?? ""}]`;
      } else if (input.interactive?.type === "list") {
        messageBody = `[Lijst: ${input.interactive?.body?.text ?? ""}]`;
      } else {
        messageBody = "[Interactief bericht]";
      }
      break;

    default:
      throw new Error(`Onbekend berichttype: ${input.type}`);
  }

  if (input.context?.message_id) {
    payload.context = { message_id: input.context.message_id };
  }

  return {
    normalizedTo,
    messageType: input.type,
    messageBody,
    payload,
  };
}

export type SendOutboundWhatsAppInput = BuildWhatsAppPayloadInput & {
  orgId: string;
  candidateId?: string | null;
  companyId?: string | null;
  companyContactId?: string | null;
  matchId?: string | null;
  placementId?: string | null;
  sentBy?: string | null;
  subject?: string | null;
  communicationBody?: string | null;
  messageType?: string | null;
  logCommunication?: boolean;
  provider?: WhatsAppProviderAdapter;
};

export type SendOutboundWhatsAppResult = {
  success: boolean;
  paused?: boolean;
  reason?: "paused" | "not_configured" | "provider_error" | "invalid_request" | "log_error";
  error?: string;
  httpStatus?: number;
  providerStatus?: number | null;
  providerCode?: string | number | null;
  messageId?: string | null;
  communicationId?: string | null;
  normalizedTo?: string;
  messageBody?: string;
};

function providerStatusToHttp(status: number | null | undefined): number {
  if (status === 400 || status === 401 || status === 403 || status === 404) return status;
  if (status === 429) return 429;
  return 502;
}

export async function sendOutboundWhatsApp(
  client: WhatsAppLifecycleClient,
  input: SendOutboundWhatsAppInput,
): Promise<SendOutboundWhatsAppResult> {
  let built: BuiltWhatsAppPayload;
  try {
    built = buildWhatsAppProviderPayload(input);
  } catch (err) {
    return {
      success: false,
      reason: "invalid_request",
      error: (err as Error).message,
      httpStatus: 400,
    };
  }

  const subject = input.subject ?? `WhatsApp naar ${built.normalizedTo}`;
  const communicationBody = input.communicationBody ?? built.messageBody;

  if (await isOutboundPaused(client as any, input.orgId, "whatsapp")) {
    await logConceptCommunication(client as any, {
      orgId: input.orgId,
      channel: "whatsapp",
      subject,
      body: communicationBody,
      candidateId: input.candidateId ?? null,
      companyId: input.companyId ?? null,
      companyContactId: input.companyContactId ?? null,
      matchId: input.matchId ?? null,
      placementId: input.placementId ?? null,
      sentBy: input.sentBy ?? null,
    });
    return {
      success: false,
      paused: true,
      reason: "paused",
      error: "WhatsApp staat op pauze (kill-switch). Bericht is als concept opgeslagen.",
      httpStatus: 200,
      normalizedTo: built.normalizedTo,
      messageBody: communicationBody,
    };
  }

  const credentials = await getWhatsAppCredentials(client as any, input.orgId);
  if (!credentials) {
    return {
      success: false,
      reason: "not_configured",
      error: "WhatsApp niet geconfigureerd",
      httpStatus: 400,
      normalizedTo: built.normalizedTo,
      messageBody: communicationBody,
    };
  }

  try {
    const provider = input.provider ?? metaGraphWhatsAppAdapter;
    const providerResult = await provider.sendMessage({
      credentials,
      payload: built.payload,
    });
    let communicationId: string | null = null;

    if (input.logCommunication !== false) {
      const { data, error } = await client
        .from("communications")
        .insert({
          organization_id: input.orgId,
          channel: "whatsapp",
          direction: "outbound",
          subject,
          body: communicationBody,
          candidate_id: input.candidateId ?? null,
          company_id: input.companyId ?? null,
          company_contact_id: input.companyContactId ?? null,
          match_id: input.matchId ?? null,
          placement_id: input.placementId ?? null,
          sent_by: input.sentBy ?? null,
          sent_at: new Date().toISOString(),
          whatsapp_message_id: providerResult.messageId ?? null,
          whatsapp_status: providerResult.messageId ? "pending" : null,
          message_type: input.messageType ?? built.messageType,
        } as any)
        .select("id")
        .maybeSingle();

      if (error) {
        console.error("WhatsApp communication log failed:", error);
      } else {
        communicationId = data?.id ?? null;
      }
    }

    return {
      success: true,
      messageId: providerResult.messageId ?? null,
      communicationId,
      normalizedTo: built.normalizedTo,
      messageBody: communicationBody,
    };
  } catch (err) {
    if (err instanceof WhatsAppProviderError) {
      // Rauwe Meta-tekst alleen loggen; naar de gebruiker een NL-melding op basis van de code.
      console.error("WhatsApp provider error:", err.providerStatus, err.providerCode, err.providerBody);
      return {
        success: false,
        reason: "provider_error",
        error: metaErrorToDutch(err.providerCode, err.message),
        httpStatus: providerStatusToHttp(err.providerStatus),
        providerStatus: err.providerStatus,
        providerCode: err.providerCode ?? null,
        normalizedTo: built.normalizedTo,
        messageBody: communicationBody,
      };
    }

    console.error("WhatsApp send error:", err);
    return {
      success: false,
      reason: "provider_error",
      error: "Versturen via WhatsApp is mislukt. Probeer het later opnieuw.",
      httpStatus: 502,
      normalizedTo: built.normalizedTo,
      messageBody: communicationBody,
    };
  }
}

export async function sendOutboundWhatsAppText(
  client: WhatsAppLifecycleClient,
  input: Omit<SendOutboundWhatsAppInput, "type" | "text"> & { text: string },
): Promise<SendOutboundWhatsAppResult> {
  return sendOutboundWhatsApp(client, {
    ...input,
    type: "text",
    text: { body: input.text },
  });
}

export async function isOutboundWhatsAppConfigured(
  client: WhatsAppLifecycleClient,
  orgId: string,
): Promise<boolean> {
  return Boolean(await getWhatsAppCredentials(client as any, orgId));
}

export async function isOutboundWhatsAppPaused(
  client: WhatsAppLifecycleClient,
  orgId: string,
): Promise<boolean> {
  return isOutboundPaused(client as any, orgId, "whatsapp");
}

export async function markWhatsAppMessageRead(
  client: WhatsAppLifecycleClient,
  input: {
    orgId: string;
    messageId: string;
    provider?: WhatsAppProviderAdapter;
  },
): Promise<SendOutboundWhatsAppResult> {
  const credentials = await getWhatsAppCredentials(client as any, input.orgId);
  if (!credentials) {
    return {
      success: false,
      reason: "not_configured",
      error: "WhatsApp niet geconfigureerd",
      httpStatus: 400,
    };
  }

  try {
    const provider = input.provider ?? metaGraphWhatsAppAdapter;
    if (!provider.markMessageRead) {
      return {
        success: false,
        reason: "provider_error",
        error: "WhatsApp-provider ondersteunt geen leesbevestigingen",
        httpStatus: 502,
      };
    }
    await provider.markMessageRead({
      credentials,
      messageId: input.messageId,
    });
    return { success: true };
  } catch (err) {
    if (err instanceof WhatsAppProviderError) {
      return {
        success: false,
        reason: "provider_error",
        error: err.message,
        httpStatus: providerStatusToHttp(err.providerStatus),
        providerStatus: err.providerStatus,
        providerCode: err.providerCode ?? null,
      };
    }
    return {
      success: false,
      reason: "provider_error",
      error: (err as Error)?.message ?? "Leesbevestiging versturen mislukt",
      httpStatus: 502,
    };
  }
}
