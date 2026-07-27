import { createAdminClient, jsonResponse, requireRolePermission } from "../_shared/auth.ts";
import { cleanEmail } from "../_shared/outlook-accounts.ts";
import { sendViaOutlookAccount } from "../_shared/outlook-send.ts";
import { type BrandTheme, escapeHtml, loadBrandTheme, renderBrandedEmail } from "../_shared/email-layout.ts";

import { CORS_HEADERS as corsHeaders } from "../_shared/http.ts";

type DomainType = "exact" | "wildcard";
type DomainStatus = "pending" | "verified" | "misconfigured" | "error" | "removed";

type VercelProjectDomain = {
  name?: string;
  apexName?: string;
  verified?: boolean;
  verification?: unknown[];
  [key: string]: unknown;
};

const VERCEL_API = "https://api.vercel.com";

function json(body: unknown, status = 200) {
  return jsonResponse(body, status, corsHeaders);
}

function normalizeHost(input: string): string {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "")
    .replace(/:\d+$/, "");
}

function apexFromDomain(domain: string): string {
  return domain.replace(/^\*\./, "");
}

function defaultPrimaryHostname(domain: string, domainType: DomainType): string {
  if (domainType === "wildcard") return `app.${domain.replace(/^\*\./, "")}`;
  return domain;
}

function validateDomainInput(domainInput: string, domainType: DomainType, primaryHostnameInput?: string) {
  const domain = normalizeHost(domainInput);
  if (!domain || !domain.includes(".")) throw new Error("Vul een geldig domein in");
  if (domain.includes("/") || domain.includes(" ")) throw new Error("Domein mag geen pad of spaties bevatten");
  if (domainType === "wildcard" && !domain.startsWith("*.")) throw new Error("Wildcard-domeinen moeten beginnen met *.");
  if (domainType === "exact" && domain.startsWith("*.")) throw new Error("Kies type wildcard voor domeinen die beginnen met *.");

  const primaryHostname = normalizeHost(primaryHostnameInput || defaultPrimaryHostname(domain, domainType));
  if (!primaryHostname || primaryHostname.startsWith("*.")) {
    throw new Error("Primaire hostname moet een concrete hostname zijn, bijvoorbeeld app.klant.nl");
  }
  if (domainType === "wildcard") {
    const apex = domain.replace(/^\*\./, "");
    if (primaryHostname !== apex && !primaryHostname.endsWith(`.${apex}`)) {
      throw new Error("Primaire hostname moet onder het wildcard-domein vallen");
    }
  } else if (primaryHostname !== domain) {
    throw new Error("Bij een exact domein moet de primaire hostname gelijk zijn aan het domein");
  }

  return {
    domain,
    apexDomain: apexFromDomain(domain),
    primaryHostname,
  };
}

function vercelProjectId(): string {
  const projectId = Deno.env.get("VERCEL_PROJECT_ID");
  if (!projectId) throw new Error("VERCEL_PROJECT_ID ontbreekt");
  return projectId;
}

async function vercelFetch(path: string, init: RequestInit = {}) {
  const token = Deno.env.get("VERCEL_TOKEN");
  if (!token) throw new Error("VERCEL_TOKEN ontbreekt");
  const teamId = Deno.env.get("VERCEL_TEAM_ID");
  const separator = path.includes("?") ? "&" : "?";
  const teamQuery = teamId ? `${separator}teamId=${encodeURIComponent(teamId)}` : "";

  const res = await fetch(`${VERCEL_API}${path}${teamQuery}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = body?.error?.message || body?.message || `Vercel API fout (${res.status})`;
    throw new Error(message);
  }
  return body;
}

async function addProjectDomain(domain: string): Promise<VercelProjectDomain> {
  return await vercelFetch(`/v10/projects/${encodeURIComponent(vercelProjectId())}/domains`, {
    method: "POST",
    body: JSON.stringify({ name: domain }),
  });
}

async function getProjectDomain(domain: string): Promise<VercelProjectDomain | null> {
  try {
    return await vercelFetch(`/v9/projects/${encodeURIComponent(vercelProjectId())}/domains/${encodeURIComponent(domain)}`);
  } catch (err) {
    if (String((err as Error).message || "").toLowerCase().includes("not found")) return null;
    throw err;
  }
}

async function verifyProjectDomain(domain: string): Promise<VercelProjectDomain> {
  return await vercelFetch(`/v9/projects/${encodeURIComponent(vercelProjectId())}/domains/${encodeURIComponent(domain)}/verify`, {
    method: "POST",
  });
}

async function removeProjectDomain(domain: string) {
  return await vercelFetch(`/v9/projects/${encodeURIComponent(vercelProjectId())}/domains/${encodeURIComponent(domain)}`, {
    method: "DELETE",
  });
}

async function getDomainConfig(domain: string) {
  try {
    return await vercelFetch(`/v6/domains/${encodeURIComponent(domain)}/config`);
  } catch (err) {
    return { error: (err as Error).message };
  }
}

// Vercel kent twee losse begrippen die makkelijk verward worden:
//   projectDomain.verified  -> eigendom van het domein is bevestigd
//   dnsConfig.misconfigured -> de DNS wijst (niet) naar Vercel
// Alleen het tweede zegt of het domein daadwerkelijk bereikbaar is. Voor een domein
// waarvoor Vercel geen TXT-challenge vraagt is `verified` direct true, dus wanneer dat
// eerst wordt getoetst staat een domein zonder enkel DNS-record al op "Actief".
// Faalt de config-call, dan weten we niets over de DNS en houden we de huidige status.
function statusFromVercel(
  projectDomain: VercelProjectDomain | null,
  dnsConfig: Record<string, unknown>,
  currentStatus?: DomainStatus,
): DomainStatus {
  if (dnsConfig?.error) return currentStatus ?? "pending";
  if (dnsConfig?.misconfigured === true) return "misconfigured";
  if (projectDomain?.verified) return "verified";
  return "pending";
}

function dnsInstructions(domain: string, domainType: DomainType, primaryHostname: string, projectDomain: VercelProjectDomain | null) {
  const verification = Array.isArray(projectDomain?.verification) ? projectDomain?.verification : [];
  const base = domain.replace(/^\*\./, "");

  if (domainType === "wildcard") {
    return {
      kind: "wildcard",
      records: [
        { type: "CNAME", name: `*.${base}`, value: "cname.vercel-dns.com", purpose: "Route alle subdomeinen naar Vercel" },
        { type: "CNAME", name: primaryHostname, value: "cname.vercel-dns.com", purpose: "Primaire app-hostname" },
      ],
      verification,
      warning:
        "Voor wildcard-certificaten heeft Vercel DNS-controle nodig. Gebruik Vercel nameservers of de door Vercel gevraagde _acme-challenge NS/TXT-records. Let op: nameservers wijzigen kan bestaande DNS zoals mail beïnvloeden.",
    };
  }

  const isSubdomain = domain.split(".").length > 2;
  return {
    kind: "exact",
    records: isSubdomain
      ? [{ type: "CNAME", name: domain, value: "cname.vercel-dns.com", purpose: "Route dit subdomein naar Vercel" }]
      : [{ type: "A", name: "@", value: "76.76.21.21", purpose: "Route apex-domein naar Vercel" }],
    verification,
  };
}

async function syncDomainStatus(admin: ReturnType<typeof createAdminClient>, row: any, doVerify: boolean) {
  const vercelDomain = doVerify ? await verifyProjectDomain(row.domain) : await getProjectDomain(row.domain);
  const dnsConfig = await getDomainConfig(row.domain);
  const status = statusFromVercel(vercelDomain, dnsConfig, row.status as DomainStatus);
  const now = new Date().toISOString();

  const updates = {
    status,
    vercel_project_domain: vercelDomain ?? {},
    dns_config: {
      ...(typeof dnsConfig === "object" && dnsConfig ? dnsConfig : {}),
      instructions: dnsInstructions(row.domain, row.domain_type, row.primary_hostname, vercelDomain),
    },
    verification: { records: vercelDomain?.verification ?? [] },
    last_checked_at: now,
    verified_at: status === "verified" ? row.verified_at ?? now : row.verified_at,
  };

  const { data, error } = await admin
    .from("organization_domains")
    .update(updates)
    .eq("id", row.id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

type DnsRecord = { type?: string; name?: string; value?: string; purpose?: string };

function recordTable(records: DnsRecord[], theme: BrandTheme): string {
  const head = ["Type", "Naam", "Waarde"]
    .map((label) =>
      `<th align="left" style="padding:8px 10px;border-bottom:2px solid ${theme.navyHex};color:${theme.navyHex};font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">${label}</th>`
    )
    .join("");

  const rows = records.map((record) => {
    const cell = (value: unknown, mono = true) =>
      `<td style="padding:10px;border-bottom:1px solid #e2e8f0;font-size:13px;${mono ? "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;" : ""}color:${theme.textHex};word-break:break-all;">${escapeHtml(value ?? "")}</td>`;
    const purpose = record.purpose
      ? `<tr><td colspan="3" style="padding:0 10px 10px;border-bottom:1px solid #e2e8f0;color:${theme.mutedHex};font-size:12px;">${escapeHtml(record.purpose)}</td></tr>`
      : "";
    return `<tr>${cell(record.type)}${cell(record.name)}${cell(record.value)}</tr>${purpose}`;
  }).join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 20px;">
    <thead><tr>${head}</tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function buildDnsInstructionEmail(data: {
  row: any;
  theme: BrandTheme;
  note?: string | null;
  requestedBy?: string | null;
}): string {
  const { row, theme } = data;
  const instructions = row.dns_config?.instructions ?? {};
  const records: DnsRecord[] = Array.isArray(instructions.records) ? instructions.records : [];
  const verification: DnsRecord[] = Array.isArray(instructions.verification) ? instructions.verification : [];
  const isWildcard = row.domain_type === "wildcard";
  const zone = row.apex_domain || row.domain;

  const note = data.note?.trim()
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr>
        <td style="padding:12px 14px;background:#f8fafc;border-left:3px solid ${theme.accentHex};color:${theme.textHex};font-size:13px;">
          ${escapeHtml(data.note.trim()).replace(/\n/g, "<br>")}
        </td></tr></table>`
    : "";

  const warning = instructions.warning
    ? `<p style="margin:0 0 20px;padding:12px 14px;background:#fff7ed;border-left:3px solid #f97316;color:#9a3412;font-size:13px;">
        <strong>Let op:</strong> ${escapeHtml(instructions.warning)}
      </p>`
    : "";

  const verificationBlock = verification.length
    ? `<h3 style="margin:24px 0 8px;color:${theme.navyHex};font-size:15px;">Extra verificatie-records</h3>
       <p style="margin:0 0 12px;color:${theme.textHex};font-size:14px;">
         Vercel vraagt daarnaast om onderstaande record(s) om het eigendom van het domein te bevestigen.
       </p>
       ${recordTable(verification, theme)}`
    : "";

  const content = `<h2 style="margin:0 0 16px;color:${theme.navyHex};font-size:18px;">DNS-instellingen voor ${escapeHtml(row.domain)}</h2>

    <p style="margin:0 0 16px;color:${theme.textHex};font-size:14px;">
      ${escapeHtml(theme.orgName)} gaat de software gebruiken op
      <strong>${escapeHtml(row.primary_hostname)}</strong>. Om dat te laten werken moet in de DNS-zone van
      <strong>${escapeHtml(zone)}</strong> onderstaande instelling worden toegevoegd.
    </p>

    ${note}

    <h3 style="margin:24px 0 8px;color:${theme.navyHex};font-size:15px;">Toe te voegen record${records.length === 1 ? "" : "s"}</h3>
    ${records.length ? recordTable(records, theme) : `<p style="margin:0 0 20px;color:${theme.mutedHex};font-size:13px;">Geen records beschikbaar — neem contact op met de afzender van deze mail.</p>`}

    <p style="margin:0 0 20px;color:${theme.mutedHex};font-size:13px;">
      TTL: laat op de standaardwaarde staan (of 3600). Proxy/CDN-opties van de DNS-provider
      moeten uit — het verkeer moet rechtstreeks naar de hosting gaan.
    </p>

    ${warning}
    ${verificationBlock}

    <h3 style="margin:24px 0 8px;color:${theme.navyHex};font-size:15px;">Daarna</h3>
    <p style="margin:0 0 16px;color:${theme.textHex};font-size:14px;">
      Zodra het record actief is, wordt het TLS-certificaat automatisch aangevraagd — dat duurt
      meestal een paar minuten. Er hoeft niets geïnstalleerd of geconfigureerd te worden op een server.
      ${isWildcard ? "" : "Bestaande records voor de website en e-mail van dit domein blijven ongewijzigd."}
    </p>
    <p style="margin:0 0 16px;color:${theme.textHex};font-size:14px;">
      Een bevestiging dat het record staat is genoeg — daarna controleren wij de koppeling aan onze kant.
    </p>

    <p style="margin:20px 0 0;color:${theme.textHex};font-size:14px;">
      Met vriendelijke groet,<br><strong>${escapeHtml(data.requestedBy || theme.orgName)}</strong>
    </p>`;

  return renderBrandedEmail({
    theme,
    contentHtml: content,
    preheader: `DNS-record voor ${row.domain}`,
    footerNote: "Deze mail bevat geen inloggegevens en geen persoonsgegevens.",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const auth = await requireRolePermission(req, "settings.manage", corsHeaders);
    if (auth instanceof Response) return auth;

    const admin = createAdminClient();
    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    if (action === "list") {
      const { data, error } = await admin
        .from("organization_domains")
        .select("*")
        .eq("organization_id", auth.organizationId)
        .is("removed_at", null)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return json({ domains: data ?? [] });
    }

    if (action === "add") {
      const domainType = (body.domain_type === "wildcard" ? "wildcard" : "exact") as DomainType;
      const { domain, apexDomain, primaryHostname } = validateDomainInput(body.domain, domainType, body.primary_hostname);

      const projectDomain = await addProjectDomain(domain);
      const dnsConfig = await getDomainConfig(domain);
      const status = statusFromVercel(projectDomain, dnsConfig);

      const { count } = await admin
        .from("organization_domains")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", auth.organizationId)
        .is("removed_at", null);

      const isPrimary = count === 0 || body.is_primary === true;
      if (isPrimary) {
        await admin
          .from("organization_domains")
          .update({ is_primary: false, updated_by: auth.userId })
          .eq("organization_id", auth.organizationId)
          .is("removed_at", null);
      }

      const { data, error } = await admin
        .from("organization_domains")
        .insert({
          organization_id: auth.organizationId,
          domain,
          apex_domain: apexDomain,
          domain_type: domainType,
          primary_hostname: primaryHostname,
          is_primary: isPrimary,
          status,
          vercel_project_domain: projectDomain,
          dns_config: {
            ...(typeof dnsConfig === "object" && dnsConfig ? dnsConfig : {}),
            instructions: dnsInstructions(domain, domainType, primaryHostname, projectDomain),
          },
          verification: { records: projectDomain?.verification ?? [] },
          last_checked_at: new Date().toISOString(),
          verified_at: status === "verified" ? new Date().toISOString() : null,
          created_by: auth.userId,
          updated_by: auth.userId,
        })
        .select("*")
        .single();
      if (error) throw error;

      await admin.from("audit_log").insert({
        organization_id: auth.organizationId,
        user_id: auth.userId,
        action: "create",
        table_name: "organization_domains",
        record_id: data.id,
        new_values: { domain, domain_type: domainType, primary_hostname: primaryHostname, status },
      });

      return json({ domain: data });
    }

    if (["check", "verify", "set_primary", "remove", "send_instructions"].includes(action)) {
      const { data: row, error } = await admin
        .from("organization_domains")
        .select("*")
        .eq("id", body.id)
        .eq("organization_id", auth.organizationId)
        .is("removed_at", null)
        .maybeSingle();
      if (error) throw error;
      if (!row) return json({ error: "Domein niet gevonden" }, 404);

      if (action === "check" || action === "verify") {
        const domain = await syncDomainStatus(admin, row, action === "verify");
        return json({ domain });
      }

      // Mailt de DNS-instructies naar de partij die de zone beheert (vaak een externe
      // developer of hostingpartij). Bewust vanaf een gekoppelde mailbox van de
      // organisatie, zodat de ontvanger een afzender ziet die hij herkent.
      if (action === "send_instructions") {
        const to = cleanEmail(body.to);
        if (!to) return json({ error: "Vul een geldig e-mailadres in" }, 400);

        const cc = (Array.isArray(body.cc) ? body.cc : [body.cc])
          .map((value: unknown) => cleanEmail(value))
          .filter((value: string | null): value is string => Boolean(value) && value !== to);

        // Verse stand ophalen, zodat de developer nooit verouderde records krijgt —
        // en de admin meteen ziet of het domein inmiddels al goed staat.
        const domain = await syncDomainStatus(admin, row, false);

        const { data: profile } = await admin
          .from("profiles")
          .select("full_name")
          .eq("id", auth.userId)
          .maybeSingle();

        const theme = await loadBrandTheme(admin, auth.organizationId);
        const html = buildDnsInstructionEmail({
          row: domain,
          theme,
          note: typeof body.note === "string" ? body.note : null,
          requestedBy: profile?.full_name ?? null,
        });

        const sendResult = await sendViaOutlookAccount({
          orgId: auth.organizationId,
          to,
          cc: cc.length ? cc : undefined,
          subject: `DNS-instelling voor ${domain.domain}`,
          htmlBody: html,
          accountId: typeof body.account_id === "string" ? body.account_id : null,
          sentBy: auth.userId,
          senderName: null,
          require: "mail_send",
        });

        if (!sendResult.success) {
          return json({
            sent: false,
            error: sendResult.error ?? "Versturen mislukt",
            communication_paused: sendResult.communicationPaused ?? false,
            domain,
          }, sendResult.communicationPaused ? 200 : 502);
        }

        await admin.from("audit_log").insert({
          organization_id: auth.organizationId,
          user_id: auth.userId,
          action: "update",
          table_name: "organization_domains",
          record_id: domain.id,
          new_values: { sent_dns_instructions_to: to, cc, domain: domain.domain },
        });

        return json({ sent: true, to, cc, from: sendResult.from ?? null, domain });
      }

      if (action === "set_primary") {
        if (row.status !== "verified") return json({ error: "Alleen geverifieerde domeinen kunnen primair worden" }, 400);
        await admin
          .from("organization_domains")
          .update({ is_primary: false, updated_by: auth.userId })
          .eq("organization_id", auth.organizationId)
          .is("removed_at", null);
        const { data, error: updateError } = await admin
          .from("organization_domains")
          .update({ is_primary: true, updated_by: auth.userId })
          .eq("id", row.id)
          .select("*")
          .single();
        if (updateError) throw updateError;
        return json({ domain: data });
      }

      if (action === "remove") {
        await removeProjectDomain(row.domain).catch((err) => console.warn("Vercel remove domain failed:", err.message));
        const { data, error: updateError } = await admin
          .from("organization_domains")
          .update({
            status: "removed",
            is_primary: false,
            removed_at: new Date().toISOString(),
            updated_by: auth.userId,
          })
          .eq("id", row.id)
          .select("*")
          .single();
        if (updateError) throw updateError;
        await admin.from("audit_log").insert({
          organization_id: auth.organizationId,
          user_id: auth.userId,
          action: "delete",
          table_name: "organization_domains",
          record_id: row.id,
          old_values: { domain: row.domain, domain_type: row.domain_type, primary_hostname: row.primary_hostname },
        });
        return json({ domain: data });
      }
    }

    return json({ error: "Onbekende actie" }, 400);
  } catch (err) {
    console.error("domain-management error:", err);
    const message = (err as Error).message || "Onbekende fout";
    if (/^VERCEL_(TOKEN|PROJECT_ID|TEAM_ID)?/.test(message) || message.includes("VERCEL_TOKEN") || message.includes("VERCEL_PROJECT_ID")) {
      return json({
        error: "Vercel-koppeling is nog niet geconfigureerd in Supabase secrets. Zet VERCEL_TOKEN en VERCEL_PROJECT_ID voordat je domeinen koppelt.",
        code: "vercel_config_missing",
      }, 503);
    }
    return json({ error: message }, 500);
  }
});
