import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const today = new Date().toISOString().split("T")[0];
    const thirtyDays = new Date();
    thirtyDays.setDate(thirtyDays.getDate() + 30);
    const thirtyDaysStr = thirtyDays.toISOString().split("T")[0];

    // 1. Mark expired documents
    const { data: expired } = await adminClient
      .from("documents")
      .update({ status: "verlopen" })
      .lt("expiry_date", today)
      .neq("status", "verlopen")
      .not("expiry_date", "is", null)
      .select("id, candidate_id");

    // 2. Mark expiring soon
    const { data: expiring } = await adminClient
      .from("documents")
      .update({ status: "verloopt_binnenkort" })
      .gte("expiry_date", today)
      .lt("expiry_date", thirtyDaysStr)
      .neq("status", "verloopt_binnenkort")
      .not("expiry_date", "is", null)
      .select("id, candidate_id");

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

    // 5. Create notifications for expired and expiring documents
    const notifications: any[] = [];
    for (const doc of (expired ?? []) as any[]) {
      if (doc.candidate_id) {
        notifications.push({
          candidate_id: doc.candidate_id,
          title: "Document verlopen",
          message: `Een document is verlopen. Controleer je documenten en upload een nieuw exemplaar.`,
          read: false,
        });
      }
    }
    for (const doc of (expiring ?? []) as any[]) {
      if (doc.candidate_id) {
        notifications.push({
          candidate_id: doc.candidate_id,
          title: "Document verloopt binnenkort",
          message: `Een document verloopt binnen 30 dagen. Zorg voor een verlenging.`,
          read: false,
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
