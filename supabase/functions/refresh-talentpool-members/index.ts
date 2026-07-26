// Refresh dynamische talentpools op basis van filter_criteria.
//
// Twee modes:
//   - { talentpool_id }      → één pool (handmatig, vereist actieve interne user + candidates.edit)
//   - { mode: "cron", frequency: "daily"|"weekly" }  → alle dynamische pools
//                              met die frequency (vereist CRON_SECRET header)
//
// Voor elke pool:
//   - filter_criteria toepassen op candidates van die organisatie
//   - bestaande filter-leden vergelijken, alleen diff toevoegen/verwijderen
//   - handmatige leden (added_by_filter=false) blijven altijd staan
//   - last_refreshed_at + last_refresh_meta updaten

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireRolePermission } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface FilterCriteria {
  status?: string[];
  skills?: string[];
  languages?: string[];
  compliance_status?: string[];
  city?: string;
  cv_search?: string;
}

interface Pool {
  id: string;
  organization_id: string;
  name: string;
  is_dynamic: boolean;
  filter_criteria: FilterCriteria | null;
}

interface RefreshResult {
  talentpool_id: string;
  pool_name: string;
  added: number;
  removed: number;
  total_after: number;
  error?: string;
}

async function refreshOne(admin: SupabaseClient, pool: Pool): Promise<RefreshResult> {
  const result: RefreshResult = {
    talentpool_id: pool.id,
    pool_name: pool.name,
    added: 0,
    removed: 0,
    total_after: 0,
  };

  if (!pool.is_dynamic) {
    return { ...result, error: "Pool is niet dynamisch" };
  }

  const filter = pool.filter_criteria ?? {};
  if (Object.keys(filter).length === 0) {
    return { ...result, error: "Geen filter_criteria — sla over" };
  }

  // 1. Match candidates op basis van filter
  let q = admin
    .from("candidates")
    .select("id")
    .eq("organization_id", pool.organization_id)
    .limit(5000);

  if (filter.status?.length) q = q.in("status", filter.status);
  if (filter.compliance_status?.length) q = q.in("compliance_status", filter.compliance_status);
  if (filter.skills?.length) q = q.overlaps("skills", filter.skills);
  if (filter.languages?.length) q = q.overlaps("languages", filter.languages);
  if (filter.city) q = q.ilike("address_city", `%${filter.city}%`);
  if (filter.cv_search) q = q.textSearch("cv_raw_text", filter.cv_search, { config: "dutch" });

  const { data: matches, error: matchErr } = await q;
  if (matchErr) {
    return { ...result, error: `Filter-query mislukt: ${matchErr.message}` };
  }
  const matchedIds = new Set((matches ?? []).map((c: { id: string }) => c.id));

  // 2. Huidige filter-toegevoegde leden ophalen
  const { data: currentMembers, error: memberErr } = await admin
    .from("talentpool_members")
    .select("candidate_id, added_by_filter")
    .eq("talentpool_id", pool.id);
  if (memberErr) {
    return { ...result, error: `Members-query mislukt: ${memberErr.message}` };
  }

  const allCurrentIds = new Set((currentMembers ?? []).map((m: { candidate_id: string }) => m.candidate_id));
  const filterMemberIds = new Set(
    (currentMembers ?? [])
      .filter((m: { added_by_filter: boolean }) => m.added_by_filter)
      .map((m: { candidate_id: string }) => m.candidate_id),
  );

  // 3. Diff berekenen
  const toAdd = [...matchedIds].filter((id) => !allCurrentIds.has(id));
  const toRemove = [...filterMemberIds].filter((id) => !matchedIds.has(id));

  // 4. Toevoegen
  if (toAdd.length > 0) {
    const rows = toAdd.map((candidate_id) => ({
      talentpool_id: pool.id,
      candidate_id,
      added_by_filter: true,
    }));
    const { error: insErr } = await admin.from("talentpool_members").insert(rows);
    if (insErr) {
      return { ...result, error: `Insert mislukt: ${insErr.message}` };
    }
    result.added = toAdd.length;
  }

  // 5. Verwijderen (alleen filter-toegevoegde, handmatige blijven)
  if (toRemove.length > 0) {
    const { error: delErr } = await admin
      .from("talentpool_members")
      .delete()
      .eq("talentpool_id", pool.id)
      .eq("added_by_filter", true)
      .in("candidate_id", toRemove);
    if (delErr) {
      return { ...result, error: `Delete mislukt: ${delErr.message}` };
    }
    result.removed = toRemove.length;
  }

  // 6. Pool-stats updaten
  const totalAfter = allCurrentIds.size + result.added - result.removed;
  result.total_after = totalAfter;

  await admin
    .from("talentpools")
    .update({
      last_refreshed_at: new Date().toISOString(),
      last_refresh_meta: {
        added: result.added,
        removed: result.removed,
        total: totalAfter,
        matched: matchedIds.size,
      },
    })
    .eq("id", pool.id);

  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let poolsToRefresh: Pool[] = [];

    if (body.mode === "cron") {
      // Cron-mode: vereist CRON_SECRET header
      const cronSecret = Deno.env.get("CRON_SECRET");
      const provided = req.headers.get("x-cron-secret");
      if (!cronSecret || provided !== cronSecret) {
        return new Response(JSON.stringify({ error: "Cron auth mislukt" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const frequency = body.frequency === "weekly" ? "weekly" : "daily";
      const { data, error } = await admin
        .from("talentpools")
        .select("id, organization_id, name, is_dynamic, filter_criteria")
        .eq("is_dynamic", true)
        .eq("refresh_frequency", frequency);
      if (error) throw error;
      poolsToRefresh = (data ?? []) as Pool[];
    } else {
      // Single-pool mode: vereist candidates.edit én RLS-toegang tot deze pool.
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Niet geautoriseerd" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const auth = await requireRolePermission(req, "candidates.edit", corsHeaders);
      if (auth instanceof Response) return auth;

      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );

      const talentpoolId = body.talentpool_id;
      if (!talentpoolId) {
        return new Response(JSON.stringify({ error: "talentpool_id is verplicht" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // RLS-aware fetch via user-client → user mag pool zien
      const { data: pool, error: poolErr } = await userClient
        .from("talentpools")
        .select("id, organization_id, name, is_dynamic, filter_criteria")
        .eq("id", talentpoolId)
        .single();
      if (poolErr || !pool) {
        return new Response(JSON.stringify({ error: "Pool niet gevonden of geen toegang" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      poolsToRefresh = [pool as Pool];
    }

    const results: RefreshResult[] = [];
    for (const pool of poolsToRefresh) {
      try {
        const r = await refreshOne(admin, pool);
        results.push(r);
      } catch (e) {
        results.push({
          talentpool_id: pool.id,
          pool_name: pool.name,
          added: 0,
          removed: 0,
          total_after: 0,
          error: (e as Error).message,
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        total_added: results.reduce((s, r) => s + r.added, 0),
        total_removed: results.reduce((s, r) => s + r.removed, 0),
        results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[refresh-talentpool-members] fatal:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
