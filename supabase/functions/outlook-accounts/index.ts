import { createAdminClient, requireInternalProfile } from "../_shared/auth.ts";
import {
  cleanEmail,
  graphJson,
  graphUrl,
  json,
  listVisibleAccounts,
  loadAccount,
  loadProviderForAccount,
  mailboxBasePath,
  toAccountOption,
  isConsentError,
  type MailAccountRow,
  type OutlookCapability,
} from "../_shared/outlook-accounts.ts";
import { sanitizeEmailHtml } from "../_shared/outlook-signature.ts";

import { CORS_HEADERS as corsHeaders } from "../_shared/http.ts";

type GrantInput = {
  user_id?: string;
  can_read_mail?: boolean;
  can_send_mail?: boolean;
  can_delete_mail?: boolean;
  can_read_calendar?: boolean;
  can_write_calendar?: boolean;
};

function isAdmin(role: string | null | undefined) {
  return role === "admin";
}

function cleanName(input: unknown, fallback: string) {
  return String(input ?? "").trim().slice(0, 120) || fallback;
}

function parseSignatureJson(input: unknown): unknown | null {
  if (!input) return null;
  if (typeof input === "string") {
    try {
      return JSON.parse(input);
    } catch {
      return null;
    }
  }
  return input;
}

async function internalUsers(admin: ReturnType<typeof createAdminClient>, organizationId: string) {
  const { data, error } = await admin
    .from("profiles")
    .select("id, full_name, email, role")
    .eq("organization_id", organizationId)
    .in("role", ["admin", "intercedent", "backoffice", "finance"]);
  if (error) throw error;
  return data ?? [];
}

async function adminList(admin: ReturnType<typeof createAdminClient>, organizationId: string, userId: string) {
  const [accountsRes, grantsRes, users] = await Promise.all([
    admin.from("mail_accounts").select("*").eq("organization_id", organizationId).eq("provider", "outlook").is("deleted_at", null).order("scope").order("display_name"),
    admin.from("mail_account_user_access").select("*").eq("organization_id", organizationId),
    internalUsers(admin, organizationId),
  ]);
  if (accountsRes.error) throw accountsRes.error;
  if (grantsRes.error) throw grantsRes.error;

  const grantsByAccount = new Map<string, any[]>();
  for (const grant of grantsRes.data ?? []) {
    const id = String(grant.mail_account_id);
    const next = grantsByAccount.get(id) ?? [];
    next.push(grant);
    grantsByAccount.set(id, next);
  }

  return {
    users,
    accounts: ((accountsRes.data ?? []) as MailAccountRow[]).map((account) => ({
      ...toAccountOption(account, null, userId, "admin"),
      raw: account,
      grants: grantsByAccount.get(account.id) ?? [],
    })),
  };
}

function errorMessage(error: unknown, fallback = "Outlook test mislukt") {
  const message = error instanceof Error ? error.message : String(error || fallback);
  return (message || fallback).slice(0, 500);
}

async function markTestFailure(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  accountId: unknown,
  error: unknown,
) {
  const id = String(accountId ?? "");
  if (!id) return;

  const account = await loadAccount(admin, organizationId, id);
  if (!account) return;

  const last_error = errorMessage(error);
  const status = isConsentError(last_error) ? "needs_reconnect" : "failed";
  await admin.from("mail_accounts").update({ status, last_error }).eq("id", account.id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, corsHeaders);

  const auth = await requireInternalProfile(req, corsHeaders);
  if (auth instanceof Response) return auth;

  const admin = createAdminClient();
  const body = await req.json().catch(() => ({}));
  const action = body.action || "visible";

  try {
    if (action === "visible") {
      const accounts = await listVisibleAccounts(admin, auth.organizationId, auth.userId, (body.capability || "any") as OutlookCapability, auth.role);
      return json({ accounts }, 200, corsHeaders);
    }

    if (action === "update_signature") {
      const account = await loadAccount(admin, auth.organizationId, body.account_id);
      if (!account) return json({ error: "mail_account_not_found" }, 404, corsHeaders);
      const canManage = isAdmin(auth.role) || (account.scope === "personal" && account.owner_user_id === auth.userId);
      if (!canManage) return json({ error: "Je mag deze handtekening niet beheren" }, 403, corsHeaders);

      const signatureHtml = sanitizeEmailHtml(String(body.signature_html ?? "")).trim();
      if (signatureHtml.length > 50000) return json({ error: "Handtekening is te groot" }, 400, corsHeaders);

      const { error } = await admin.from("mail_accounts").update({
        signature_enabled: body.signature_enabled !== false,
        signature_html: signatureHtml || null,
        signature_json: parseSignatureJson(body.signature_json),
      }).eq("id", account.id);
      if (error) throw error;
      return json({ ok: true }, 200, corsHeaders);
    }

    if (!isAdmin(auth.role)) return json({ error: "Alleen admins kunnen Outlook mailboxen beheren" }, 403, corsHeaders);

    if (action === "admin_list") {
      return json(await adminList(admin, auth.organizationId, auth.userId), 200, corsHeaders);
    }

    if (action === "create_shared") {
      const email = cleanEmail(body.mailbox_email);
      if (!email) return json({ error: "mailbox_email_invalid" }, 400, corsHeaders);
      const { data: credential, error: credentialError } = await admin
        .from("mail_accounts")
        .select("id, status")
        .eq("organization_id", auth.organizationId)
        .eq("provider", "outlook")
        .eq("scope", "organization")
        .eq("mailbox_mode", "user")
        .is("auth_account_id", null)
        .is("deleted_at", null)
        .order("is_default_for_organization", { ascending: false })
        .order("last_connected_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (credentialError) throw credentialError;
      if (!credential?.id || credential.status !== "connected") return json({ error: "Koppel eerst het Microsoft hoofdaccount" }, 400, corsHeaders);

      const name = cleanName(body.display_name, email);
      const { data, error } = await admin.from("mail_accounts").insert({
        organization_id: auth.organizationId,
        provider: "outlook",
        scope: "organization",
        owner_user_id: null,
        auth_account_id: credential.id,
        display_name: name,
        from_email: email,
        mailbox_mode: "shared",
        mailbox_email: email,
        mailbox_name: name,
        calendar_owner_email: email,
        status: "needs_test",
        last_error: "Test de Microsoft 365-rechten voordat deze mailbox gebruikt kan worden",
        created_by: auth.userId,
      }).select("id").single();
      if (error) throw error;
      return json({ ok: true, account_id: data.id }, 200, corsHeaders);
    }

    if (action === "update_account") {
      const account = await loadAccount(admin, auth.organizationId, body.account_id);
      if (!account) return json({ error: "mail_account_not_found" }, 404, corsHeaders);
      const email = cleanEmail(body.mailbox_email) || account.mailbox_email || account.from_email;
      const name = cleanName(body.display_name, email || "Outlook");
      const { error } = await admin.from("mail_accounts").update({
        display_name: name,
        from_email: account.mailbox_mode === "shared" ? email : account.from_email,
        mailbox_email: account.mailbox_mode === "shared" ? email : account.mailbox_email,
        mailbox_name: account.mailbox_mode === "shared" ? name : account.mailbox_name,
        calendar_owner_email: account.mailbox_mode === "shared" ? email : account.calendar_owner_email,
        status: account.mailbox_mode === "shared" ? "needs_test" : account.status,
        last_error: account.mailbox_mode === "shared" ? "Opnieuw testen na wijziging" : account.last_error,
      }).eq("id", account.id);
      if (error) throw error;
      return json({ ok: true }, 200, corsHeaders);
    }

    if (action === "update_reply_to") {
      // EM1: antwoord-adres per mailaccount. Leeg → wissen (null). Antwoorden landen dan op dit
      // adres (bv. info@) i.p.v. de verzendende mailbox; gebruikt door buildReplyTo in de senders.
      const account = await loadAccount(admin, auth.organizationId, body.account_id);
      if (!account) return json({ error: "mail_account_not_found" }, 404, corsHeaders);
      const replyTo = body.reply_to_email ? cleanEmail(body.reply_to_email) : null;
      if (body.reply_to_email && !replyTo) return json({ error: "invalid_email" }, 400, corsHeaders);
      const { error } = await admin.from("mail_accounts").update({ reply_to_email: replyTo }).eq("id", account.id);
      if (error) throw error;
      return json({ ok: true }, 200, corsHeaders);
    }

    if (action === "delete_account") {
      const account = await loadAccount(admin, auth.organizationId, body.account_id);
      if (!account) return json({ error: "mail_account_not_found" }, 404, corsHeaders);
      const now = new Date().toISOString();
      await admin.from("mail_account_user_access").delete().eq("mail_account_id", account.id);
      await admin.from("mail_account_secrets").delete().eq("mail_account_id", account.id);
      const { error } = await admin.from("mail_accounts").update({
        deleted_at: now,
        status: "disconnected",
        last_error: null,
      }).eq("id", account.id);
      if (error) throw error;
      return json({ ok: true }, 200, corsHeaders);
    }

    if (action === "set_grants") {
      const account = await loadAccount(admin, auth.organizationId, body.account_id);
      if (!account || account.scope !== "organization") return json({ error: "mail_account_not_found" }, 404, corsHeaders);
      const users = await internalUsers(admin, auth.organizationId);
      const allowedUserIds = new Set(users.map((u: any) => u.id));
      const grants = (body.grants ?? []) as GrantInput[];
      const rows = grants
        .filter((grant) => grant.user_id && allowedUserIds.has(grant.user_id))
        .map((grant) => ({
          organization_id: auth.organizationId,
          mail_account_id: account.id,
          user_id: grant.user_id!,
          can_read_mail: Boolean(grant.can_read_mail || grant.can_delete_mail),
          can_send_mail: Boolean(grant.can_send_mail),
          can_delete_mail: Boolean(grant.can_delete_mail),
          can_read_calendar: Boolean(grant.can_read_calendar || grant.can_write_calendar),
          can_write_calendar: Boolean(grant.can_write_calendar),
          created_by: auth.userId,
        }))
        .filter((grant) => grant.can_read_mail || grant.can_send_mail || grant.can_delete_mail || grant.can_read_calendar || grant.can_write_calendar);

      const { error: deleteError } = await admin.from("mail_account_user_access").delete().eq("mail_account_id", account.id);
      if (deleteError) throw deleteError;
      if (rows.length > 0) {
        const { error: insertError } = await admin.from("mail_account_user_access").insert(rows);
        if (insertError) throw insertError;
      }
      return json({ ok: true }, 200, corsHeaders);
    }

    if (action === "set_default") {
      const account = await loadAccount(admin, auth.organizationId, body.account_id);
      if (!account || account.scope !== "organization") return json({ error: "mail_account_not_found" }, 404, corsHeaders);
      await admin.from("mail_accounts").update({ is_default_for_organization: false }).eq("organization_id", auth.organizationId).eq("scope", "organization").is("deleted_at", null);
      const { error } = await admin.from("mail_accounts").update({ is_default_for_organization: true }).eq("id", account.id);
      if (error) throw error;
      return json({ ok: true }, 200, corsHeaders);
    }

    if (action === "test_mail") {
      try {
        const provider = await loadProviderForAccount(admin, auth.organizationId, {
          accountId: body.account_id,
          userId: auth.userId,
          role: auth.role,
          require: "none",
          allowUnready: true,
        });
        await graphJson(admin, provider, `${mailboxBasePath(provider.account)}/mailFolders/inbox`, {
          headers: { Prefer: 'outlook.body-content-type="text"' },
        });
        const { error } = await admin.from("mail_accounts").update({
          mail_read_enabled: true,
          mail_send_enabled: true,
          mail_delete_enabled: provider.account.mailbox_mode === "shared",
          status: "connected",
          last_error: null,
          last_connected_at: new Date().toISOString(),
        }).eq("id", provider.account.id);
        if (error) throw error;
        return json({ ok: true }, 200, corsHeaders);
      } catch (error) {
        await markTestFailure(admin, auth.organizationId, body.account_id, error);
        throw error;
      }
    }

    if (action === "test_calendar") {
      try {
        const provider = await loadProviderForAccount(admin, auth.organizationId, {
          accountId: body.account_id,
          userId: auth.userId,
          role: auth.role,
          require: "none",
          allowUnready: true,
        });
        const start = new Date();
        const end = new Date(Date.now() + 24 * 60 * 60 * 1000);
        let patch: Record<string, unknown> = {
          calendar_read_enabled: true,
          calendar_write_enabled: true,
          calendar_path_kind: "mailbox_primary",
          calendar_id: null,
          status: "connected",
          last_error: null,
        };
        try {
          await graphJson(admin, provider, graphUrl(`${mailboxBasePath(provider.account)}/calendar/calendarView`, {
            startDateTime: start.toISOString(),
            endDateTime: end.toISOString(),
            "$top": 1,
          }));
        } catch (err) {
          if (provider.account.mailbox_mode !== "shared") throw err;
          const calendars = await graphJson<{ value?: any[] }>(admin, provider, graphUrl("/me/calendars", {
            "$select": "id,name,owner,canEdit",
            "$top": 100,
          }));
          const found = (calendars.value ?? []).find((cal: any) =>
            String(cal.owner?.address ?? "").toLowerCase() === String(provider.account.mailbox_email ?? "").toLowerCase()
          );
          if (!found?.id) throw err;
          await graphJson(admin, provider, graphUrl(`/me/calendars/${encodeURIComponent(found.id)}/calendarView`, {
            startDateTime: start.toISOString(),
            endDateTime: end.toISOString(),
            "$top": 1,
          }));
          patch = {
            ...patch,
            calendar_path_kind: "graph_calendar_id",
            calendar_id: found.id,
            calendar_write_enabled: Boolean(found.canEdit ?? true),
          };
        }

        const { error } = await admin.from("mail_accounts").update(patch).eq("id", provider.account.id);
        if (error) throw error;
        return json({ ok: true, locator: patch.calendar_path_kind }, 200, corsHeaders);
      } catch (error) {
        await markTestFailure(admin, auth.organizationId, body.account_id, error);
        throw error;
      }
    }

    return json({ error: "unknown_action" }, 400, corsHeaders);
  } catch (error) {
    const err = error as Error & { status?: number; retryAfter?: number };
    const status = Number.isInteger(err.status) && err.status! >= 400 && err.status! < 600 ? err.status! : 400;
    return json({ error: err.message, retry_after: err.retryAfter }, status, corsHeaders);
  }
});
