import { createAdminClient, jsonResponse, requireInternalProfile } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

function statusFromVercel(projectDomain: VercelProjectDomain | null, dnsConfig: Record<string, unknown>): DomainStatus {
  if (projectDomain?.verified) return "verified";
  if (dnsConfig && dnsConfig.misconfigured === true) return "misconfigured";
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
  const status = statusFromVercel(vercelDomain, dnsConfig);
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const auth = await requireInternalProfile(req, corsHeaders);
    if (auth instanceof Response) return auth;
    if (auth.role !== "admin") return json({ error: "Alleen organisatie-admins kunnen domeinen beheren" }, 403);

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

    if (["check", "verify", "set_primary", "remove"].includes(action)) {
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
    return json({ error: (err as Error).message || "Onbekende fout" }, 500);
  }
});
