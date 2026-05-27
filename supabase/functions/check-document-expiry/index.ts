import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WARNING_DAYS = new Set([30, 14, 7]);

function dateOnly(value: Date): string {
  return value.toISOString().split("T")[0];
}

function daysUntil(expiryDate: string): number {
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const expiry = new Date(`${expiryDate}T00:00:00.000Z`);
  const expiryUtc = Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate());
  return Math.round((expiryUtc - todayUtc) / DAY_MS);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Optional auth check — allow both authenticated users and cron
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (authHeader?.startsWith("Bearer ")) {
      const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { error } = await anonClient.auth.getUser();
      if (error) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const today = dateOnly(new Date());
    const thirtyDays = new Date();
    thirtyDays.setDate(thirtyDays.getDate() + 30);
    const thirtyDaysStr = dateOnly(thirtyDays);

    // 1. Mark expired documents
    const { data: expired } = await adminClient
      .from("documents")
      .update({ status: "verlopen" })
      .lt("expiry_date", today)
      .neq("status", "verlopen")
      .not("expiry_date", "is", null)
      .select("id, candidate_id, organization_id, name, type, expiry_date");

    // 2. Mark expiring soon
    const { data: expiring } = await adminClient
      .from("documents")
      .update({ status: "verloopt_binnenkort" })
      .gte("expiry_date", today)
      .lt("expiry_date", thirtyDaysStr)
      .neq("status", "verloopt_binnenkort")
      .not("expiry_date", "is", null)
      .select("id, candidate_id, organization_id, name, type, expiry_date");

    // 3. Revalidate documents that are now valid again
    const { data: valid } = await adminClient
      .from("documents")
      .update({ status: "geldig" })
      .gte("expiry_date", thirtyDaysStr)
      .in("status", ["verloopt_binnenkort", "verlopen"])
      .not("expiry_date", "is", null)
      .select("id");

    // 4. Update candidate compliance for expired docs
    const affectedCandidateIds = [
      ...(expired ?? []).map((d: any) => d.candidate_id),
    ].filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);

    for (const candidateId of affectedCandidateIds) {
      await adminClient
        .from("candidates")
        .update({ compliance_status: "verlopen" })
        .eq("id", candidateId);
    }

    // 5. Create notifications for expired and exactly 30/14/7-day warnings.
    const notifications: any[] = [];
    for (const doc of (expired ?? []) as any[]) {
      if (doc.candidate_id) {
        const type = "document_expired";
        const { data: existing } = await adminClient
          .from("employee_notifications")
          .select("id")
          .eq("type", type)
          .eq("reference_table", "documents")
          .eq("reference_id", doc.id)
          .maybeSingle();

        if (!existing) {
          notifications.push({
            organization_id: doc.organization_id,
            candidate_id: doc.candidate_id,
            title: "Document verlopen",
            message: `${doc.name ?? "Document"} is verlopen op ${doc.expiry_date}. Controleer het dossier en vraag een nieuw document op.`,
            type,
            severity: "urgent",
            reference_table: "documents",
            reference_id: doc.id,
            due_date: doc.expiry_date,
            is_read: false,
          });
        }
      }
    }
    for (const doc of (expiring ?? []) as any[]) {
      if (doc.candidate_id && doc.expiry_date) {
        const days = daysUntil(doc.expiry_date);
        if (!WARNING_DAYS.has(days)) continue;

        const type = `document_expiry_${days}d`;
        const { data: existing } = await adminClient
          .from("employee_notifications")
          .select("id")
          .eq("type", type)
          .eq("reference_table", "documents")
          .eq("reference_id", doc.id)
          .maybeSingle();

        if (existing) continue;

        notifications.push({
          organization_id: doc.organization_id,
          candidate_id: doc.candidate_id,
          title: `Document verloopt over ${days} dagen`,
          message: `${doc.name ?? "Document"} verloopt op ${doc.expiry_date}. Vraag tijdig een verlenging of nieuw document op.`,
          type,
          severity: days <= 7 ? "urgent" : "warning",
          reference_table: "documents",
          reference_id: doc.id,
          due_date: doc.expiry_date,
          is_read: false,
        });
      }
    }
    if (notifications.length > 0) {
      await adminClient.from("employee_notifications").insert(notifications);
    }

    return new Response(
      JSON.stringify({
        expired: expired?.length ?? 0,
        expiring: expiring?.length ?? 0,
        revalidated: valid?.length ?? 0,
        candidates_updated: affectedCandidateIds.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("check-document-expiry error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
