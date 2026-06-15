import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cascadeSickReport } from "../_shared/sick-report-handler.ts";

import { CORS_HEADERS as corsHeaders } from "../_shared/http.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const { sick_report_id } = body as { sick_report_id: string };
    if (!sick_report_id) return json({ error: "sick_report_id required" }, 400);

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify the user has access to this sick_report (via org_id)
    const { data: profile } = await service
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    const { data: report } = await service
      .from("sick_reports")
      .select("organization_id")
      .eq("id", sick_report_id)
      .maybeSingle();

    if (!report || report.organization_id !== profile?.organization_id) {
      return json({ error: "Sick report not found" }, 404);
    }

    const result = await cascadeSickReport(service, sick_report_id, user.id);
    return json(result);
  } catch (err: any) {
    console.error("process-sick-report error:", err);
    return json({ error: err.message ?? "Unknown error" }, 500);
  }
});
