import { createAdminClient, requireInternalProfile } from "../_shared/auth.ts";
import {
  graphJson,
  graphUrl,
  json,
  loadProviderForAccount,
  mailboxBasePath,
  type OutlookCapability,
} from "../_shared/outlook-accounts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type MailAction = "folders" | "list" | "detail" | "attachment" | "delete" | "mark_read" | "move";

const WELL_KNOWN = new Set(["inbox", "sentitems", "drafts", "deleteditems", "archive", "junkemail"]);
const MAX_TOP = 50;

function folderSegment(input: unknown) {
  const raw = String(input || "inbox").trim();
  const lower = raw.toLowerCase();
  if (WELL_KNOWN.has(lower)) return lower;
  const hasControlChar = [...raw].some((char) => {
    const code = char.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (!raw || hasControlChar) throw new Error("folder_id_invalid");
  return encodeURIComponent(raw);
}

function safeNextLink(input: unknown, basePath: string) {
  if (!input) return null;
  const url = new URL(String(input));
  if (url.origin !== "https://graph.microsoft.com") throw new Error("invalid_graph_next_link");
  const path = url.pathname.replace(/^\/v1\.0/, "");
  if (!path.startsWith(`${basePath}/mailFolders/`) || !path.includes("/messages")) throw new Error("invalid_graph_next_link");
  return url;
}

function recipient(value: any) {
  return {
    name: value?.emailAddress?.name ?? null,
    address: value?.emailAddress?.address ?? null,
  };
}

function recipients(values: any[] | undefined) {
  return (values ?? []).map(recipient).filter((r) => r.address);
}

function mapMessage(message: any) {
  return {
    id: message.id,
    folder_id: message.parentFolderId ?? null,
    subject: message.subject || "(Geen onderwerp)",
    from: recipient(message.from ?? message.sender),
    to: recipients(message.toRecipients),
    cc: recipients(message.ccRecipients),
    received_at: message.receivedDateTime ?? message.sentDateTime ?? null,
    sent_at: message.sentDateTime ?? null,
    is_read: Boolean(message.isRead),
    preview: message.bodyPreview ?? "",
    has_attachments: Boolean(message.hasAttachments),
    importance: message.importance ?? "normal",
    web_link: message.webLink ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, corsHeaders);

  const auth = await requireInternalProfile(req, corsHeaders);
  if (auth instanceof Response) return auth;

  const body = await req.json().catch(() => ({}));
  const action = (body.action || "list") as MailAction;
  const required: OutlookCapability = action === "delete" || action === "move" ? "mail_delete" : "mail_read";
  const admin = createAdminClient();

  try {
    const provider = await loadProviderForAccount(admin, auth.organizationId, {
      accountId: body.account_id,
      userId: auth.userId,
      role: auth.role,
      require: required,
    });
    const base = mailboxBasePath(provider.account);

    if (action === "folders") {
      const data = await graphJson<{ value?: any[] }>(admin, provider, graphUrl(`${base}/mailFolders`, {
        "$select": "id,displayName,totalItemCount,unreadItemCount,isHidden",
        "$top": 100,
      }));
      return json({
        mailbox: { account_id: provider.account.id, email: provider.account.mailbox_email || provider.account.from_email, mode: provider.account.mailbox_mode },
        folders: (data.value ?? []).filter((f: any) => !f.isHidden).map((f: any) => ({
          id: f.id,
          display_name: f.displayName || "Map",
          total_item_count: f.totalItemCount ?? 0,
          unread_item_count: f.unreadItemCount ?? 0,
        })),
      }, 200, corsHeaders);
    }

    if (action === "list") {
      const top = Math.min(Math.max(Number(body.top || 25), 1), MAX_TOP);
      const skip = Math.max(Number(body.skip || 0), 0);
      const search = String(body.search || "").trim();
      const next = safeNextLink(body.next_link, base);
      const url = next ?? (search
        ? graphUrl(`${base}/messages`, {
          "$search": `"${search.replace(/"/g, '\\"')}"`,
          "$select": "id,parentFolderId,subject,from,sender,toRecipients,receivedDateTime,sentDateTime,isRead,bodyPreview,hasAttachments,importance,webLink",
          "$top": top,
          "$skip": skip,
        })
        : graphUrl(`${base}/mailFolders/${folderSegment(body.folder_id)}/messages`, {
          "$select": "id,parentFolderId,subject,from,sender,toRecipients,receivedDateTime,sentDateTime,isRead,bodyPreview,hasAttachments,importance,webLink",
          "$top": top,
          "$skip": skip,
          "$orderby": String(body.folder_id || "").toLowerCase() === "sentitems" ? "sentDateTime desc" : "receivedDateTime desc",
        }));
      const data = await graphJson<{ value?: any[]; "@odata.nextLink"?: string }>(admin, provider, url);
      return json({ messages: (data.value ?? []).map(mapMessage), next_link: data["@odata.nextLink"] ?? null }, 200, corsHeaders);
    }

    if (action === "detail") {
      if (!body.message_id) return json({ error: "message_id_required" }, 400, corsHeaders);
      const messagePath = `${base}/messages/${encodeURIComponent(body.message_id)}`;
      const message = await graphJson<any>(admin, provider, graphUrl(messagePath, {
        "$select": "id,parentFolderId,subject,from,sender,toRecipients,ccRecipients,receivedDateTime,sentDateTime,isRead,body,bodyPreview,hasAttachments,importance,webLink",
      }), { headers: { Prefer: 'outlook.body-content-type="html"' } });
      const attachments = message.hasAttachments
        ? await graphJson<{ value?: any[] }>(admin, provider, graphUrl(`${messagePath}/attachments`, {
          "$select": "id,name,contentType,contentId,size,isInline",
        }))
        : { value: [] };
      return json({
        message: {
          ...mapMessage(message),
          body_html: message.body?.content ?? "",
          body_type: message.body?.contentType ?? "html",
          attachments: (attachments.value ?? []).map((a: any) => ({
            id: a.id,
            name: a.name || "bijlage",
            content_type: a.contentType || "application/octet-stream",
            content_id: a.contentId ?? null,
            size: a.size ?? 0,
            is_inline: Boolean(a.isInline),
          })),
        },
      }, 200, corsHeaders);
    }

    if (action === "attachment") {
      if (!body.message_id || !body.attachment_id) return json({ error: "message_id_and_attachment_id_required" }, 400, corsHeaders);
      const attachment = await graphJson<any>(admin, provider, `${base}/messages/${encodeURIComponent(body.message_id)}/attachments/${encodeURIComponent(body.attachment_id)}`);
      return json({ attachment: {
        id: attachment.id,
        name: attachment.name || "bijlage",
        content_type: attachment.contentType || "application/octet-stream",
        size: attachment.size ?? 0,
        content_base64: attachment.contentBytes,
      } }, 200, corsHeaders);
    }

    if (action === "delete") {
      if (!body.message_id) return json({ error: "message_id_required" }, 400, corsHeaders);
      await graphJson(admin, provider, `${base}/messages/${encodeURIComponent(body.message_id)}/move`, {
        method: "POST",
        body: JSON.stringify({ destinationId: "deleteditems" }),
      });
      await admin.from("audit_log").insert({
        organization_id: auth.organizationId,
        action: "delete",
        table_name: "outlook_message",
        record_id: provider.account.id,
        old_values: { message_id: body.message_id, account_id: provider.account.id },
      } as any).then(() => {});
      return json({ ok: true }, 200, corsHeaders);
    }

    if (action === "mark_read") {
      if (!body.message_id) return json({ error: "message_id_required" }, 400, corsHeaders);
      await graphJson(admin, provider, `${base}/messages/${encodeURIComponent(body.message_id)}`, {
        method: "PATCH",
        body: JSON.stringify({ isRead: true }),
      });
      return json({ ok: true }, 200, corsHeaders);
    }

    if (action === "move") {
      if (!body.message_id) return json({ error: "message_id_required" }, 400, corsHeaders);
      const destinationId = folderSegment(body.destination_id || "archive");
      await graphJson(admin, provider, `${base}/messages/${encodeURIComponent(body.message_id)}/move`, {
        method: "POST",
        body: JSON.stringify({ destinationId }),
      });
      return json({ ok: true }, 200, corsHeaders);
    }

    return json({ error: "unknown_action" }, 400, corsHeaders);
  } catch (error) {
    const err = error as any;
    return json({ error: err.message || "outlook_mail_failed", retry_after: err.retryAfter }, err.status || 400, corsHeaders);
  }
});
