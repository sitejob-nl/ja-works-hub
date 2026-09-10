import { createAdminClient, jsonResponse, requireRolePermission } from "../_shared/auth.ts";
import { cleanEmail } from "../_shared/outlook-accounts.ts";
import {
  buildInstructionText,
  dnsInstructions,
  type DnsRecord,
  type DomainType,
} from "../_shared/domain-instructions.ts";
import { sendViaOutlookAccount } from "../_shared/outlook-send.ts";
import { type BrandTheme, escapeHtml, loadBrandTheme, renderBrandedEmail } from "../_shared/email-layout.ts";
import { captureEdgeException, withCronMonitor } from "../_shared/sentry.ts";

import { CORS_HEADERS as corsHeaders } from "../_shared/http.ts";

const FN = "domain-management";
// pg_cron leest de crontab in de Postgres-tijdzone, en die staat op productie op UTC.
// Sentry moet dus óók UTC krijgen (de helper default is Europe/Amsterdam) — anders staat
// de monitor 1-2 uur scheef en meldt Sentry runs als 'gemist' die gewoon gedraaid zijn.
const CRON_TZ = "UTC";

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
      instructions: dnsInstructions(row.domain, row.domain_type, row.primary_hostname, vercelDomain, dnsConfig),
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

/** Bovengrens per sweep, zodat één run niet in een timeout loopt bij veel domeinen. */
const SWEEP_LIMIT = 100;
const CATEGORY_DOMAIN_DNS = "domein_dns";

/**
 * Hercontroleert alle actieve domeinen tegen Vercel. Zonder deze sweep verandert een
 * domeinstatus alleen wanneer een admin handmatig op Check klikt — een domein dat later
 * omvalt (DNS gewijzigd, record verwijderd) zou dan `verified` blijven en de basis voor
 * links in uitgaande mail blijven vormen.
 *
 * Bij een terugval van `verified` naar iets anders wordt een taak aangemaakt, want dat is
 * het geval dat iemand moet zien: de organisatie valt vanaf dat moment terug op de
 * platform-URL en klanten zien een ander domein dan ze gewend zijn.
 */
async function runDomainStatusSweep(admin: ReturnType<typeof createAdminClient>) {
  const { data: rows, error } = await admin
    .from("organization_domains")
    .select("*")
    .is("removed_at", null)
    .neq("status", "removed")
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(SWEEP_LIMIT);
  if (error) throw error;

  const { count: totalActive } = await admin
    .from("organization_domains")
    .select("id", { count: "exact", head: true })
    .is("removed_at", null)
    .neq("status", "removed");

  const checked: Array<{ domain: string; from: string; to: string }> = [];
  const failed: Array<{ domain: string; error: string }> = [];
  let tasksCreated = 0;

  for (const row of (rows ?? []) as any[]) {
    try {
      const updated = await syncDomainStatus(admin, row, false);
      if (updated.status !== row.status) {
        checked.push({ domain: row.domain, from: row.status, to: updated.status });
      }

      const regressed = row.status === "verified" && updated.status !== "verified";
      if (!regressed) continue;

      // Idempotent: zolang de vorige melding nog open staat geen tweede aanmaken.
      const { data: existing } = await admin
        .from("recruiter_tasks")
        .select("id")
        .eq("organization_id", row.organization_id)
        .eq("related_entity_type", "domein")
        .eq("related_entity_id", row.id)
        .eq("category", CATEGORY_DOMAIN_DNS)
        .eq("status", "open")
        .maybeSingle();
      if (existing) continue;

      await admin.from("recruiter_tasks").insert({
        organization_id: row.organization_id,
        title: `Domein onbereikbaar: ${row.domain}`,
        description:
          `De DNS van ${row.domain} wijst niet meer correct naar de hosting, dus het domein is ` +
          `niet meer actief. Links in uitgaande e-mail vallen tot die tijd terug op de standaard ` +
          `platform-URL. Controleer de DNS-records via Instellingen → Domeinen; daar staat ook ` +
          `de knop om de instructies naar de beheerder van de zone te mailen.`,
        category: CATEGORY_DOMAIN_DNS,
        priority: row.is_primary ? "high" : "medium",
        status: "open",
        related_entity_type: "domein",
        related_entity_id: row.id,
        ai_generated: true,
        ai_reasoning: `Auto-gegenereerd door domain-management sweep (status ${row.status} → ${updated.status}).`,
      } as any);
      tasksCreated++;
    } catch (err) {
      // Eén onbereikbaar domein mag de rest van de sweep niet stoppen.
      failed.push({ domain: row.domain, error: (err as Error).message });
    }
  }

  const skipped = Math.max(0, (totalActive ?? 0) - (rows?.length ?? 0));
  if (skipped > 0) {
    console.warn(`domain sweep: ${skipped} domeinen niet gecontroleerd (limiet ${SWEEP_LIMIT} per run)`);
  }

  return {
    scanned: rows?.length ?? 0,
    total_active: totalActive ?? 0,
    not_scanned_this_run: skipped,
    status_changes: checked,
    tasks_created: tasksCreated,
    failed,
  };
}

/**
 * Eén record als kaart met veld-labels, in plaats van een brede tabel. Mailclients op
 * mobiel knijpen een 3-koloms tabel met lange TXT-waarden onleesbaar samen; deze vorm
 * blijft leesbaar en houdt de waarde in één selecteerbaar blok, zodat de ontvanger hem
 * in één keer kan kopiëren.
 */
function recordCard(record: DnsRecord, index: number, total: number, theme: BrandTheme): string {
  const mono = "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";
  const field = (label: string, value: unknown, emphasise = false) => `
    <tr>
      <td width="70" valign="top" style="padding:4px 10px 4px 0;color:${theme.mutedHex};font-size:11px;text-transform:uppercase;letter-spacing:0.6px;white-space:nowrap;">${escapeHtml(label)}</td>
      <td valign="top" style="padding:4px 0;${mono};font-size:${emphasise ? "13px" : "13px"};color:${theme.textHex};word-break:break-all;line-height:1.5;">${escapeHtml(value ?? "")}</td>
    </tr>`;

  const counter = total > 1
    ? `<span style="display:inline-block;min-width:20px;height:20px;line-height:20px;text-align:center;border-radius:10px;background:${theme.accentHex};color:#ffffff;font-size:11px;font-weight:700;${mono};margin-right:8px;">${index + 1}</span>`
    : "";

  const purpose = record.purpose
    ? `<p style="margin:10px 0 0;padding-top:10px;border-top:1px solid #eef2f7;color:${theme.mutedHex};font-size:12px;line-height:1.5;">${escapeHtml(record.purpose)}</p>`
    : "";

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 12px;border:1px solid #e2e8f0;border-radius:8px;">
    <tr><td style="padding:14px 16px;">
      <p style="margin:0 0 10px;color:${theme.navyHex};font-size:13px;font-weight:700;">
        ${counter}${escapeHtml(record.type ?? "RECORD")}-record
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${field("Naam", record.name)}
        ${field("Waarde", record.value, true)}
        ${field("TTL", "standaard (of 3600)")}
      </table>
      ${purpose}
    </td></tr>
  </table>`;
}

function recordCards(records: DnsRecord[], theme: BrandTheme): string {
  return records.map((record, index) => recordCard(record, index, records.length, theme)).join("");
}

/**
 * Nameservers krijgen een eigen blok en niet de record-kaart: ze worden bij de registrar
 * gewijzigd, niet als record in de zone toegevoegd. Dat verschil is precies waar het
 * misgaat als je het als "NS-record" presenteert.
 */
function nameserverBlock(nameservers: string[], theme: BrandTheme): string {
  const mono = "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";
  const rows = nameservers
    .map(
      (ns) =>
        `<tr><td style="padding:5px 0;${mono};font-size:13px;color:${theme.textHex};word-break:break-all;">${escapeHtml(ns)}</td></tr>`,
    )
    .join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 12px;border:1px solid #e2e8f0;border-radius:8px;">
    <tr><td style="padding:14px 16px;">
      <p style="margin:0 0 10px;color:${theme.navyHex};font-size:13px;font-weight:700;">Nameservers</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
      <p style="margin:10px 0 0;padding-top:10px;border-top:1px solid #eef2f7;color:${theme.mutedHex};font-size:12px;line-height:1.5;">
        Deze wijziging gebeurt bij de <strong>registrar</strong> van het domein, niet in de
        DNS-zone zelf. De huidige nameservers worden volledig vervangen.
      </p>
    </td></tr>
  </table>`;
}

function sectionHeading(step: string | null, title: string, theme: BrandTheme): string {
  const badge = step
    ? `<span style="display:inline-block;padding:2px 8px;border-radius:4px;background:${theme.navyHex};color:#ffffff;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;margin-right:8px;vertical-align:middle;">${escapeHtml(step)}</span>`
    : "";
  return `<h3 style="margin:26px 0 12px;color:${theme.navyHex};font-size:15px;line-height:1.4;">${badge}${escapeHtml(title)}</h3>`;
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
  const nameservers: string[] = Array.isArray(instructions.nameservers) ? instructions.nameservers : [];
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

  const totalSteps = verification.length ? 3 : 2;
  const verificationBlock = verification.length
    ? `${sectionHeading("Stap 2", `Verificatie-record${verification.length === 1 ? "" : "s"}`, theme)}
       <p style="margin:0 0 14px;color:${theme.textHex};font-size:14px;line-height:1.6;">
         Daarnaast is onderstaand record nodig om te bevestigen dat het domein van
         ${escapeHtml(theme.orgName)} is. Dit record kan blijven staan.
       </p>
       ${recordCards(verification, theme)}`
    : "";

  const content = `<h2 style="margin:0 0 6px;color:${theme.navyHex};font-size:19px;line-height:1.35;">
      DNS-instelling voor ${escapeHtml(row.domain)}
    </h2>
    <p style="margin:0 0 18px;color:${theme.mutedHex};font-size:13px;">
      ${totalSteps} ${totalSteps === 2 ? "korte stappen" : "korte stappen"} · circa 5 minuten werk
    </p>

    <p style="margin:0 0 18px;color:${theme.textHex};font-size:14px;line-height:1.6;">
      ${escapeHtml(theme.orgName)} gaat de personeelssoftware gebruiken op
      <strong style="color:${theme.navyHex};">${escapeHtml(row.primary_hostname)}</strong>.
      ${isWildcard
        ? `Omdat het om een wildcard (<strong>${escapeHtml(row.domain)}</strong>) gaat, moeten de
           nameservers van <strong style="color:${theme.navyHex};">${escapeHtml(zone)}</strong>
           naar Vercel wijzen — dat is de enige manier waarop een wildcard-certificaat kan worden
           uitgegeven.`
        : `Om dat te laten werken moet in de DNS-zone van
           <strong style="color:${theme.navyHex};">${escapeHtml(zone)}</strong> het onderstaande
           worden toegevoegd. Er is geen server-configuratie nodig.`}
    </p>

    ${note}

    ${sectionHeading("Stap 1", isWildcard ? "Nameservers wijzigen" : `Record${records.length === 1 ? "" : "s"} toevoegen`, theme)}
    ${isWildcard
      ? nameserverBlock(nameservers, theme)
      : records.length
        ? recordCards(records, theme)
        : `<p style="margin:0 0 20px;color:${theme.mutedHex};font-size:13px;">Geen records beschikbaar — neem contact op met de afzender van deze mail.</p>`}

    ${isWildcard
      ? ""
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px;"><tr>
      <td style="padding:12px 14px;background:#f1f5f9;border-radius:6px;color:${theme.textHex};font-size:13px;line-height:1.55;">
        <strong style="color:${theme.navyHex};">Proxy of CDN uitzetten</strong><br>
        Staat deze hostname achter een proxy (bij Cloudflare de oranje wolk), zet die dan uit —
        het verkeer moet rechtstreeks doorgezet worden. Anders ontstaat er een redirect-lus.
      </td></tr>
    </table>`}

    ${warning}
    ${verificationBlock}

    ${sectionHeading(`Stap ${totalSteps}`, "Laten weten dat het staat", theme)}
    <p style="margin:0 0 14px;color:${theme.textHex};font-size:14px;line-height:1.6;">
      Een kort berichtje terug is genoeg — daarna controleren wij de koppeling aan onze kant.
      Het TLS-certificaat wordt automatisch aangevraagd zodra de records actief zijn; dat duurt
      meestal een paar minuten.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0;"><tr>
      <td style="padding:12px 14px;border:1px solid ${isWildcard ? "#fdba74" : "#e2e8f0"};border-radius:6px;color:${isWildcard ? "#9a3412" : theme.mutedHex};font-size:12px;line-height:1.55;">
        ${isWildcard
          ? "<strong>Belangrijk:</strong> bij een nameserver-wijziging vervalt de huidige DNS-zone volledig. " +
            "Alle bestaande records moeten eerst in Vercel DNS staan — MX plus SPF, DKIM en DMARC voor " +
            "e-mail, bestaande subdomeinen en verificatie-records. Ontbreken die op het moment dat de " +
            "wijziging doorwerkt, dan valt e-mail op dit domein uit."
          : "Bestaande records voor de website en e-mail van dit domein blijven ongewijzigd — er wordt alleen één hostname toegevoegd."}
      </td></tr>
    </table>

    <p style="margin:22px 0 0;color:${theme.textHex};font-size:14px;line-height:1.6;">
      Met vriendelijke groet,<br>
      <strong style="color:${theme.navyHex};">${escapeHtml(data.requestedBy || theme.orgName)}</strong>
      ${data.requestedBy ? `<br><span style="color:${theme.mutedHex};font-size:13px;">${escapeHtml(theme.orgName)}</span>` : ""}
    </p>`;

  return renderBrandedEmail({
    theme,
    contentHtml: content,
    preheader: `Eén DNS-record voor ${row.primary_hostname} — circa 5 minuten werk`,
    footerNote: "Deze mail bevat geen inloggegevens en geen persoonsgegevens.",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  // Buiten de try zodat het catch-blok weet of withCronMonitor de fout al heeft gemeld.
  let reportedByMonitor = false;

  try {
    // Cron-modus (pg_cron): hercontroleert alle domeinen over alle organisaties. Staat
    // vóór de gebruikersauthenticatie omdat er geen JWT bij een cron-aanroep zit.
    const cronSecret = Deno.env.get("CRON_SECRET");
    const providedSecret = req.headers.get("x-cron-secret");
    if (cronSecret && providedSecret === cronSecret) {
      // Alleen deze sweep is de geplande run; de action-gebaseerde UI-aanroepen hieronder niet.
      reportedByMonitor = true;
      const result = await withCronMonitor(
        {
          monitorSlug: "domain-status-sweep-daily",
          schedule: "15 3 * * *",
          timezone: CRON_TZ,
          maxRuntimeMinutes: 10,
          checkinMarginMinutes: 5,
          fn: FN,
        },
        () => runDomainStatusSweep(createAdminClient()),
      );
      return json({ mode: "cron", ...result });
    }

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
            instructions: dnsInstructions(domain, domainType, primaryHostname, projectDomain, dnsConfig),
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
        const preview = body.preview === true;
        const to = cleanEmail(body.to);
        if (!to && !preview) return json({ error: "Vul een geldig e-mailadres in" }, 400);

        const cc = (Array.isArray(body.cc) ? body.cc : [body.cc])
          .map((value: unknown) => cleanEmail(value))
          .filter((value: string | null): value is string => Boolean(value) && value !== to);

        // Verse stand ophalen, zodat de developer nooit verouderde records krijgt —
        // en de admin meteen ziet of het domein inmiddels al goed staat. Ook in
        // preview-modus, zodat wat je ziet exact is wat er verstuurd wordt.
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
        const subject = `DNS-instelling voor ${domain.domain}`;

        if (preview) {
          return json({
            preview: true,
            subject,
            html,
            text: buildInstructionText(domain, theme.orgName),
            domain,
          });
        }

        const sendResult = await sendViaOutlookAccount({
          orgId: auth.organizationId,
          to: to!,
          cc: cc.length ? cc : undefined,
          subject,
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
    // withCronMonitor rapporteert de fouten van het werk dat het omhult al zelf.
    if (!reportedByMonitor) {
      await captureEdgeException(err, { fn: FN });
    }
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
