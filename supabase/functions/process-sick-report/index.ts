import { cascadeSickReport } from "../_shared/sick-report-handler.ts";
import { createAdminClient, getAuthenticatedProfile } from "../_shared/auth.ts";

import { CORS_HEADERS as corsHeaders } from "../_shared/http.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const INTERNAL_ROLES = new Set(["admin", "intercedent", "backoffice", "finance"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const auth = await getAuthenticatedProfile(req, corsHeaders);
    if (auth instanceof Response) return auth;

    const body = await req.json();
    const { sick_report_id } = body as { sick_report_id: string };
    if (!sick_report_id) return json({ error: "sick_report_id required" }, 400);

    const service = createAdminClient();

    // Verify the user has access to this sick_report. Internal users may process
    // org reports; portal employees may process only their own report.
    const { data: report } = await service
      .from("sick_reports")
      .select("organization_id, candidate_id, employee_id")
      .eq("id", sick_report_id)
      .maybeSingle();

    if (!report) {
      return json({ error: "Sick report not found" }, 404);
    }

    const sameOrg = report.organization_id === auth.organizationId;
    const isInternal = sameOrg && INTERNAL_ROLES.has(String(auth.role));
    let isOwnPortalReport = false;

    if (sameOrg && auth.role === "medewerker") {
      const { data: candidate } = await service
        .from("candidates")
        .select("id")
        .eq("id", report.candidate_id)
        .eq("auth_user_id", auth.userId)
        .maybeSingle();

      if (candidate?.id && report.employee_id) {
        const { data: employee } = await service
          .from("employees")
          .select("id")
          .eq("id", report.employee_id)
          .eq("candidate_id", candidate.id)
          .eq("auth_user_id", auth.userId)
          .maybeSingle();
        isOwnPortalReport = !!employee?.id;
      }
    }

    if (!isInternal && !isOwnPortalReport) {
      return json({ error: "Forbidden" }, 403);
    }

    const result = await cascadeSickReport(service, sick_report_id, auth.userId);
    return json(result);
  } catch (err: any) {
    console.error("process-sick-report error:", err);
    return json({ error: err.message ?? "Unknown error" }, 500);
  }
});
