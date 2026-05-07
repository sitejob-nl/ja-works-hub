import { createAdminClient, requireInternalProfile } from "../_shared/auth.ts";
import {
  calendarEventsPath,
  calendarViewPath,
  graphJson,
  graphUrl,
  json,
  loadProviderForAccount,
  type OutlookCapability,
} from "../_shared/outlook-accounts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, corsHeaders);

  const auth = await requireInternalProfile(req, corsHeaders);
  if (auth instanceof Response) return auth;

  const body = await req.json().catch(() => ({}));
  const action = body.action || "list";
  const required: OutlookCapability = action === "list" ? "calendar_read" : "calendar_write";
  const admin = createAdminClient();

  try {
    const provider = await loadProviderForAccount(admin, auth.organizationId, {
      accountId: body.account_id,
      userId: auth.userId,
      role: auth.role,
      require: required,
    });

    if (action === "list") {
      const start = body.startDateTime || new Date().toISOString();
      const end = body.endDateTime || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
      const data = await graphJson(admin, provider, graphUrl(calendarViewPath(provider.account), {
        startDateTime: start,
        endDateTime: end,
        "$top": Math.min(Number(body.top || 100), 100),
        "$select": "id,subject,start,end,location,isAllDay,showAs,organizer,attendees,body,importance",
        "$orderby": "start/dateTime",
      }));
      return json(data, 200, corsHeaders);
    }

    if (action === "create") {
      const data = await graphJson(admin, provider, calendarEventsPath(provider.account), {
        method: "POST",
        body: JSON.stringify(body.payload || {}),
      });
      return json(data, 200, corsHeaders);
    }

    if (action === "update") {
      if (!body.event_id) return json({ error: "event_id_required" }, 400, corsHeaders);
      const data = await graphJson(admin, provider, `${calendarEventsPath(provider.account)}/${encodeURIComponent(body.event_id)}`, {
        method: "PATCH",
        body: JSON.stringify(body.payload || {}),
      });
      return json(data, 200, corsHeaders);
    }

    if (action === "delete") {
      if (!body.event_id) return json({ error: "event_id_required" }, 400, corsHeaders);
      await graphJson(admin, provider, `${calendarEventsPath(provider.account)}/${encodeURIComponent(body.event_id)}`, {
        method: "DELETE",
      });
      return json({ ok: true }, 200, corsHeaders);
    }

    return json({ error: "unknown_action" }, 400, corsHeaders);
  } catch (error) {
    const err = error as any;
    return json({ error: err.message || "outlook_calendar_failed", retry_after: err.retryAfter }, err.status || 400, corsHeaders);
  }
});
