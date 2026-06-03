// geocode-backfill — vult address_lat/lng voor kandidaten + bedrijven via PDOK (gratis NL-geocoder).
//
// Alleen NL-adressen: we eisen een NL-postcode (NNNN AA) in het adres én valideren dat PDOK een
// resultaat met dezelfde 4 postcijfers teruggeeft — zo voorkomen we foute matches op buitenlandse
// of rommelige adressen (die laten we ongemoeid). Niet-destructief: vult alleen lege coördinaten.
//
// Auth: service-role (self-trigger), superadmin (org via body) of org-admin (eigen org).
// Self-batcht op een soft-deadline. Body: { organization_id?, max?, dry_run? }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { internalFunctionHeaders, isServiceRoleRequest } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const PDOK = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free";
const SOFT_DEADLINE_MS = 110_000;
const THROTTLE_MS = 120;
const NL_POSTCODE = /(\d{4})\s?([A-Za-z]{2})\b/;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parsePoint(point?: string | null): { lat: number; lng: number } | null {
  const m = point?.match(/POINT\(([-\d.]+)\s+([-\d.]+)\)/);
  return m ? { lng: Number(m[1]), lat: Number(m[2]) } : null;
}

async function pdokQuery(q: string, type: "adres" | "postcode"): Promise<{ point: string; postcode: string } | null> {
  const params = new URLSearchParams({ q, rows: "1", fq: `type:${type}`, fl: "postcode,centroide_ll" });
  try {
    const res = await fetch(`${PDOK}?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    const doc = data?.response?.docs?.[0];
    if (!doc?.centroide_ll) return null;
    return { point: doc.centroide_ll, postcode: String(doc.postcode ?? "").replace(/\s+/g, "") };
  } catch {
    return null;
  }
}

// Geocodeer één NL-adres. Coords alleen als de NL-postcode (4 cijfers) klopt.
// Twee pogingen: (1) volledig adres (straat-niveau); (2) fallback op de KALE postcode
// (postcode-centroid) voor adressen waar de postcode in rommelige tekst verstopt zit.
async function geocodeNL(q: string): Promise<{ lat: number; lng: number } | null> {
  const pc = q.match(NL_POSTCODE);
  if (!pc) return null; // geen NL-postcode → niet geocoderen (waarschijnlijk buitenland/junk)
  const wanted = pc[1];
  const bare = `${pc[1]} ${pc[2].toUpperCase()}`;

  const full = await pdokQuery(q, "adres");
  if (full && full.postcode.slice(0, 4) === wanted) {
    const p = parsePoint(full.point);
    if (p) return p;
  }
  const pcRes = await pdokQuery(bare, "postcode");
  if (pcRes && pcRes.postcode.slice(0, 4) === wanted) {
    const p = parsePoint(pcRes.point);
    if (p) return p;
  }
  return null;
}

async function selfTrigger(orgId: string) {
  await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/geocode-backfill`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, ...internalFunctionHeaders() },
    body: JSON.stringify({ organization_id: orgId }),
  }).catch((e) => console.error("[geocode-backfill] self-trigger:", e));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const max = Math.max(0, Number(body.max) || 0);

    // --- Auth ---
    let orgId: string | null = body.organization_id || null;
    if (isServiceRoleRequest(req)) {
      if (!orgId) return json({ error: "organization_id verplicht voor interne jobs" }, 400);
    } else {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) return json({ error: "Niet geautoriseerd" }, 401);
      const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
      const { data: { user }, error } = await userClient.auth.getUser();
      if (error || !user) return json({ error: "Ongeldige sessie" }, 401);
      const { data: isSuper } = await userClient.rpc("is_superadmin");
      if (isSuper) { if (!orgId) return json({ error: "organization_id verplicht voor superadmin" }, 400); }
      else {
        const { data: profile } = await admin.from("profiles").select("organization_id, role").eq("id", user.id).single();
        if (!profile || profile.role !== "admin") return json({ error: "Alleen admins of superadmins" }, 403);
        orgId = profile.organization_id;
      }
    }
    if (!orgId) return json({ error: "organization_id onbekend" }, 400);

    const started = Date.now();
    let candDone = 0, candSkipped = 0, compDone = 0, compSkipped = 0, processed = 0;
    const sample: Array<{ type: string; id: string; lat: number; lng: number; q: string }> = [];

    // --- Bedrijven eerst (klein, en vacatures hangen eraan) ---
    const { data: comps } = await admin.from("companies")
      .select("id, address_street, address_postal, address_city, visit_address_street, visit_address_postal, visit_address_city")
      .eq("organization_id", orgId).is("visit_address_lat", null).is("address_lat", null);
    for (const c of (comps ?? []) as any[]) {
      const q = [c.visit_address_street || c.address_street, c.visit_address_postal || c.address_postal, c.visit_address_city || c.address_city].filter(Boolean).join(" ").trim();
      const coords = await geocodeNL(q);
      await sleep(THROTTLE_MS);
      if (!coords) { compSkipped++; continue; }
      if (!dryRun) await admin.from("companies").update({ address_lat: coords.lat, address_lng: coords.lng }).eq("id", c.id).eq("organization_id", orgId);
      compDone++; if (sample.length < 15) sample.push({ type: "company", id: c.id, ...coords, q });
      if (Date.now() - started > SOFT_DEADLINE_MS) break;
    }

    // --- Kandidaten ---
    const { data: cands } = await admin.from("candidates")
      .select("id, address_street, address_postal, address_city")
      .eq("organization_id", orgId)
      .in("status", ["nieuw", "in_behandeling", "beschikbaar", "werkzoekend"])
      .is("address_lat", null)
      .not("address_postal", "is", null)
      .limit(2000);
    for (const c of (cands ?? []) as any[]) {
      if (max && processed >= max) break;
      if (Date.now() - started > SOFT_DEADLINE_MS) { await selfTrigger(orgId); return json({ success: true, continued: true, candDone, candSkipped, compDone, compSkipped, sample }); }
      const q = [c.address_street, c.address_postal, c.address_city].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      processed++;
      const coords = await geocodeNL(q);
      await sleep(THROTTLE_MS);
      if (!coords) { candSkipped++; continue; }
      if (!dryRun) await admin.from("candidates").update({ address_lat: coords.lat, address_lng: coords.lng }).eq("id", c.id).eq("organization_id", orgId);
      candDone++; if (sample.length < 15) sample.push({ type: "candidate", id: c.id, ...coords, q });
    }

    return json({ success: true, done_all: true, candDone, candSkipped, compDone, compSkipped, sample });
  } catch (e) {
    console.error("[geocode-backfill] fatal:", e);
    return json({ error: "Interne fout bij geocoderen" }, 500);
  }
});
