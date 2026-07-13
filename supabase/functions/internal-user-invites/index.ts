import {
  createAdminClient,
  EDGE_PERMISSION_KEYS,
  jsonResponse,
  requireInternalProfile,
  type EdgePermissionKey,
} from "../_shared/auth.ts";
import { type BrandTheme, brandButton, escapeHtml, renderBrandedEmail, resolveBrandTheme } from "../_shared/email-layout.ts";
import { CORS_HEADERS as corsHeaders } from "../_shared/http.ts";
import { sendViaOutlookAccount } from "../_shared/outlook-send.ts";
import { buildOrganizationPublicUrl } from "../_shared/public-url.ts";

type InternalRole = "admin" | "intercedent" | "backoffice" | "finance";

const INTERNAL_ROLES: InternalRole[] = ["admin", "intercedent", "backoffice", "finance"];
const PERMISSION_KEY_SET = new Set<EdgePermissionKey>(EDGE_PERMISSION_KEYS);
const ROLE_LABELS: Record<InternalRole, string> = {
  admin: "Admin",
  intercedent: "Intercedent",
  backoffice: "Backoffice",
  finance: "Finance",
};

const json = (body: unknown, status = 200) => jsonResponse(body, status, corsHeaders);

function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function cleanName(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function assertPermissionOverrides(value: unknown): Partial<Record<EdgePermissionKey, boolean>> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Individuele rechten moeten als object worden aangeleverd");
  }

  const overrides: Partial<Record<EdgePermissionKey, boolean>> = {};
  for (const [permission, allowed] of Object.entries(value as Record<string, unknown>)) {
    if (!PERMISSION_KEY_SET.has(permission as EdgePermissionKey)) {
      throw new Error(`Onbekend recht: ${permission}`);
    }
    if (typeof allowed !== "boolean") {
      throw new Error(`Recht ${permission} moet true of false zijn`);
    }
    overrides[permission as EdgePermissionKey] = allowed;
  }
  return overrides;
}

function assertInternalRole(value: unknown): InternalRole {
  if (INTERNAL_ROLES.includes(value as InternalRole)) return value as InternalRole;
  throw new Error("Kies een geldige interne rol");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function inviteStatus(invite: any) {
  if (invite.used_at) return "accepted";
  if (invite.revoked_at) return "revoked";
  if (new Date(invite.expires_at) < new Date()) return "expired";
  if (invite.sent_at) return "sent";
  return "created";
}

function buildInviteEmailHtml(data: {
  fullName: string;
  role: InternalRole;
  activationUrl: string;
  theme: BrandTheme;
}): string {
  const roleLabel = ROLE_LABELS[data.role];
  const content = `<h2 style="margin:0 0 16px;color:${data.theme.navyHex};font-size:18px;">Je bent uitgenodigd voor ${escapeHtml(data.theme.orgName)}</h2>
          <p style="margin:0 0 16px;color:${data.theme.textHex};font-size:14px;">Hoi ${escapeHtml(data.fullName)},</p>
          <p style="margin:0 0 16px;color:${data.theme.textHex};font-size:14px;">
            Er is een account voor je klaargezet in JA Werkt met de rol <strong>${escapeHtml(roleLabel)}</strong>.
            Stel je wachtwoord in om toegang te krijgen.
          </p>
          ${brandButton("Account activeren", data.activationUrl, data.theme)}
          <p style="margin:16px 0 0;color:#64748b;font-size:12px;">Deze link is 7 dagen geldig. Vraag je organisatie-admin om een nieuwe uitnodiging als de link verlopen is.</p>`;

  return renderBrandedEmail({
    theme: data.theme,
    contentHtml: content,
    preheader: `Activeer je ${data.theme.orgName}-account`,
    footerNote: "Automatische gebruikersuitnodiging.",
  });
}

async function loadInviteTheme(admin: ReturnType<typeof createAdminClient>, orgId: string) {
  const { data } = await admin
    .from("organizations")
    .select("name, logo_url, settings")
    .eq("id", orgId)
    .maybeSingle();
  return resolveBrandTheme(data);
}

async function activationUrl(admin: ReturnType<typeof createAdminClient>, orgId: string, token: string) {
  return await buildOrganizationPublicUrl(admin, orgId, `/gebruikers/activeren/${token}`);
}

async function writeAudit(admin: ReturnType<typeof createAdminClient>, data: {
  organizationId: string;
  userId: string;
  action: string;
  recordId: string;
  values?: Record<string, unknown>;
  oldValues?: Record<string, unknown>;
  reason?: string;
}) {
  await admin.from("audit_log").insert({
    organization_id: data.organizationId,
    user_id: data.userId,
    action: data.action,
    table_name: "internal_user_invites",
    record_id: data.recordId,
    old_values: data.oldValues ?? null,
    new_values: data.values ?? null,
    reason: data.reason ?? null,
  });
}

async function sendInvite(admin: ReturnType<typeof createAdminClient>, invite: any, sentBy: string, accountId?: string | null) {
  const theme = await loadInviteTheme(admin, invite.organization_id);
  const url = await activationUrl(admin, invite.organization_id, invite.token);
  const subject = `Welkom bij ${theme.orgName} - activeer je account`;
  const html = buildInviteEmailHtml({
    fullName: invite.full_name,
    role: invite.role,
    activationUrl: url,
    theme,
  });

  const result = await sendViaOutlookAccount({
    orgId: invite.organization_id,
    to: invite.email,
    subject,
    htmlBody: html,
    accountId,
    sentBy,
    senderName: null,
  });

  const now = new Date().toISOString();
  const updates = result.success
    ? { sent_at: now, sent_channel: "email", sent_by: sentBy, last_error: null }
    : { last_error: result.error ?? "Uitnodiging kon niet worden verzonden" };

  const { data, error } = await admin
    .from("internal_user_invites")
    .update(updates)
    .eq("id", invite.id)
    .select("*")
    .single();
  if (error) throw error;

  return {
    invite: { ...data, status: inviteStatus(data) },
    sent: result.success,
    send_error: result.error,
    communication_paused: result.communicationPaused === true,
    activation_url: url,
  };
}

async function listUsersAndInvites(admin: ReturnType<typeof createAdminClient>, orgId: string) {
  const [
    { data: users, error: usersError },
    { data: invites, error: invitesError },
    { data: permissionOverrides, error: permissionOverridesError },
  ] = await Promise.all([
    admin
      .from("profiles")
      .select("id, email, full_name, role, is_active, created_at, updated_at")
      .eq("organization_id", orgId)
      .in("role", INTERNAL_ROLES)
      .order("full_name", { ascending: true }),
    admin
      .from("internal_user_invites")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("user_permission_overrides")
      .select("user_id, permission_key, allowed")
      .eq("organization_id", orgId),
  ]);

  if (usersError) throw usersError;
  if (invitesError) throw invitesError;
  if (permissionOverridesError) throw permissionOverridesError;

  const overridesByUser = new Map<string, Partial<Record<EdgePermissionKey, boolean>>>();
  for (const row of permissionOverrides ?? []) {
    const current = overridesByUser.get(row.user_id) ?? {};
    if (PERMISSION_KEY_SET.has(row.permission_key as EdgePermissionKey) && typeof row.allowed === "boolean") {
      current[row.permission_key as EdgePermissionKey] = row.allowed;
    }
    overridesByUser.set(row.user_id, current);
  }

  return {
    users: (users ?? []).map((user) => {
      const overrides = overridesByUser.get(user.id) ?? {};
      return {
        ...user,
        permission_overrides: overrides,
        permission_override_count: Object.keys(overrides).length,
      };
    }),
    invites: (invites ?? []).map((invite) => ({ ...invite, status: inviteStatus(invite) })),
  };
}

async function ensureNotLastActiveAdmin(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  profileId: string,
  nextRole?: InternalRole,
  nextActive?: boolean,
) {
  const { data: target, error } = await admin
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", profileId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!target) throw new Error("Gebruiker niet gevonden");

  const demotesAdmin = target.role === "admin" && nextRole && nextRole !== "admin";
  const deactivatesAdmin = target.role === "admin" && nextActive === false;
  if (!demotesAdmin && !deactivatesAdmin) return;

  const { count, error: countError } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("role", "admin")
    .eq("is_active", true);
  if (countError) throw countError;
  if ((count ?? 0) <= 1) {
    throw new Error("Je kunt de laatste actieve admin niet aanpassen of deactiveren");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const auth = await requireInternalProfile(req, corsHeaders);
    if (auth instanceof Response) return auth;
    if (auth.role !== "admin") return json({ error: "Alleen admins kunnen gebruikers beheren" }, 403);

    const admin = createAdminClient();
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "list");

    if (action === "list") {
      return json(await listUsersAndInvites(admin, auth.organizationId));
    }

    if (action === "update_permissions") {
      const profileId = String(body.profile_id ?? "");
      const overrides = assertPermissionOverrides(body.permission_overrides);

      const { data: target, error: targetError } = await admin
        .from("profiles")
        .select("id, role")
        .eq("id", profileId)
        .eq("organization_id", auth.organizationId)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target) return json({ error: "Gebruiker niet gevonden" }, 404);
      if (target.role === "admin") {
        return json({ error: "Adminrechten kunnen niet individueel worden aangepast" }, 400);
      }
      if (!["intercedent", "backoffice", "finance"].includes(target.role)) {
        return json({ error: "Alleen interne gebruikers ondersteunen individuele rechten" }, 400);
      }

      const { data: savedOverrides, error: saveError } = await admin.rpc(
        "replace_user_permission_overrides",
        {
          p_organization_id: auth.organizationId,
          p_user_id: profileId,
          p_actor_id: auth.userId,
          p_overrides: overrides,
        },
      );
      if (saveError) throw saveError;

      return json({
        profile_id: profileId,
        permission_overrides: savedOverrides ?? {},
        permission_override_count: Object.keys(savedOverrides ?? {}).length,
      });
    }

    if (action === "create") {
      const email = normalizeEmail(body.email);
      const fullName = cleanName(body.full_name);
      const role = assertInternalRole(body.role);
      if (!email || !email.includes("@")) return json({ error: "Vul een geldig e-mailadres in" }, 400);
      if (!fullName) return json({ error: "Naam is verplicht" }, 400);

      const { data: existingProfile, error: existingError } = await admin
        .from("profiles")
        .select("id")
        .eq("organization_id", auth.organizationId)
        .eq("email", email)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existingProfile) return json({ error: "Er bestaat al een gebruiker met dit e-mailadres" }, 409);

      await admin
        .from("internal_user_invites")
        .update({ revoked_at: new Date().toISOString(), revoked_by: auth.userId })
        .eq("organization_id", auth.organizationId)
        .eq("email", email)
        .is("used_at", null)
        .is("revoked_at", null);

      const { data: invite, error: insertError } = await admin
        .from("internal_user_invites")
        .insert({
          organization_id: auth.organizationId,
          email,
          full_name: fullName,
          role,
          invited_by: auth.userId,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .select("*")
        .single();
      if (insertError) throw insertError;

      await writeAudit(admin, {
        organizationId: auth.organizationId,
        userId: auth.userId,
        action: "create",
        recordId: invite.id,
        values: { email, full_name: fullName, role },
      });

      const sendResult = await sendInvite(admin, invite, auth.userId, body.account_id ?? null);
      return json(sendResult, sendResult.sent ? 200 : 202);
    }

    if (action === "resend") {
      const id = String(body.id ?? "");
      const { data: current, error: currentError } = await admin
        .from("internal_user_invites")
        .select("*")
        .eq("id", id)
        .eq("organization_id", auth.organizationId)
        .maybeSingle();
      if (currentError) throw currentError;
      if (!current) return json({ error: "Uitnodiging niet gevonden" }, 404);
      if (current.used_at) return json({ error: "Uitnodiging is al geaccepteerd" }, 400);
      if (current.revoked_at) return json({ error: "Uitnodiging is ingetrokken" }, 400);

      const { data: invite, error: updateError } = await admin
        .from("internal_user_invites")
        .update({
          token: randomToken(),
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          last_error: null,
        })
        .eq("id", current.id)
        .select("*")
        .single();
      if (updateError) throw updateError;

      await writeAudit(admin, {
        organizationId: auth.organizationId,
        userId: auth.userId,
        action: "resend",
        recordId: invite.id,
        values: { email: invite.email, role: invite.role },
      });

      const sendResult = await sendInvite(admin, invite, auth.userId, body.account_id ?? null);
      return json(sendResult, sendResult.sent ? 200 : 202);
    }

    if (action === "revoke") {
      const id = String(body.id ?? "");
      const { data: invite, error } = await admin
        .from("internal_user_invites")
        .update({ revoked_at: new Date().toISOString(), revoked_by: auth.userId })
        .eq("id", id)
        .eq("organization_id", auth.organizationId)
        .is("used_at", null)
        .is("revoked_at", null)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!invite) return json({ error: "Open uitnodiging niet gevonden" }, 404);

      await writeAudit(admin, {
        organizationId: auth.organizationId,
        userId: auth.userId,
        action: "revoke",
        recordId: invite.id,
        values: { email: invite.email, role: invite.role },
      });

      return json({ invite: { ...invite, status: inviteStatus(invite) } });
    }

    if (action === "update_user") {
      const profileId = String(body.profile_id ?? "");
      const updates: Record<string, unknown> = {};
      if (body.role !== undefined) updates.role = assertInternalRole(body.role);
      if (body.is_active !== undefined) updates.is_active = body.is_active === true;
      if (body.full_name !== undefined) {
        const name = cleanName(body.full_name);
        if (!name) return json({ error: "Naam is verplicht" }, 400);
        updates.full_name = name;
      }
      if (Object.keys(updates).length === 0) return json({ error: "Geen wijzigingen opgegeven" }, 400);
      if (profileId === auth.userId && updates.is_active === false) {
        return json({ error: "Je kunt je eigen account niet deactiveren" }, 400);
      }

      await ensureNotLastActiveAdmin(
        admin,
        auth.organizationId,
        profileId,
        updates.role as InternalRole | undefined,
        updates.is_active as boolean | undefined,
      );

      const { data: before } = await admin
        .from("profiles")
        .select("id, email, full_name, role, is_active")
        .eq("id", profileId)
        .eq("organization_id", auth.organizationId)
        .maybeSingle();
      if (!before) return json({ error: "Gebruiker niet gevonden" }, 404);

      const { data: user, error } = await admin
        .from("profiles")
        .update(updates)
        .eq("id", profileId)
        .eq("organization_id", auth.organizationId)
        .select("id, email, full_name, role, is_active, created_at, updated_at")
        .single();
      if (error) throw error;

      await writeAudit(admin, {
        organizationId: auth.organizationId,
        userId: auth.userId,
        action: "update",
        recordId: profileId,
        oldValues: before,
        values: user,
        reason: "internal_user_profile_update",
      });

      return json({ user });
    }

    return json({ error: "Onbekende actie" }, 400);
  } catch (err) {
    console.error("internal-user-invites error:", err);
    return json({ error: (err as Error).message || "Gebruikersbeheer mislukt" }, 500);
  }
});
