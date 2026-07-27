import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type DomainRow = {
  domain: string;
  domain_type: "exact" | "wildcard";
  primary_hostname: string | null;
  is_primary: boolean;
  status: string;
};

/**
 * Laatste vangnet wanneer een organisatie geen eigen domein heeft en `SITE_URL` niet
 * gezet is. Blijft bewust de Vercel-project-URL: die is altijd bereikbaar, ook als een
 * nieuw platformdomein nog niet door DNS is geactiveerd.
 */
export const DEFAULT_PUBLIC_BASE_URL = "https://ja-works-hub.vercel.app";

/**
 * Het beoogde platformdomein. Wordt de daadwerkelijke default zodra de `SITE_URL`
 * secret hierop gezet is — dat gebeurt pas nadat het domein bij Vercel geverifieerd is,
 * zodat links nooit naar een hostname wijzen die nog niet resolveert.
 */
export const PLATFORM_BASE_URL = "https://ats.sitejob.nl";

function sanitizeHostname(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
}

function baseUrlFromHost(host: string): string {
  const clean = sanitizeHostname(host);
  if (!clean) throw new Error("Geen publieke hostname geconfigureerd");
  return `https://${clean}`;
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

function envSiteUrl(): string | null {
  const value = Deno.env.get("SITE_URL") ?? Deno.env.get("FRONTEND_URL") ?? null;
  return value ? value.replace(/\/+$/, "") : null;
}

export function defaultPublicBaseUrl(): string {
  return envSiteUrl() ?? DEFAULT_PUBLIC_BASE_URL;
}

export async function getOrganizationPublicBaseUrl(
  admin: SupabaseClient,
  organizationId: string,
): Promise<string> {
  const { data, error } = await admin
    .from("organization_domains")
    .select("domain, domain_type, primary_hostname, is_primary, status")
    .eq("organization_id", organizationId)
    .eq("is_primary", true)
    .eq("status", "verified")
    .is("removed_at", null)
    .maybeSingle();

  if (error) throw error;

  const domain = data as DomainRow | null;
  if (domain) {
    return baseUrlFromHost(domain.primary_hostname || domain.domain.replace(/^\*\./, "app."));
  }

  const fallback = envSiteUrl();
  if (fallback) return fallback;

  return DEFAULT_PUBLIC_BASE_URL;
}

export async function buildOrganizationPublicUrl(
  admin: SupabaseClient,
  organizationId: string,
  path: string,
): Promise<string> {
  return joinUrl(await getOrganizationPublicBaseUrl(admin, organizationId), path);
}
