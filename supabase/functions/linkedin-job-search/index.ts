import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mapJobToRow } from "../_shared/map-job-to-row.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const apifyToken = Deno.env.get("APIFY_API_KEY");

    if (!apifyToken) {
      return new Response(
        JSON.stringify({ error: "APIFY_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const organizationId = profile.organization_id;
    const body = await req.json();
    const {
      keywords,
      locations,
      linkedinIndustries,
      organizationEmployeesGte,
      organizationEmployeesLte,
      employmentTypeFilter,
      datePostedAfter,
      removeAgency,
      limit = 100,
      includeAi = true,
      includeLinkedIn = true,
      descriptionSearch,
      organizationSearch,
    } = body;

    const apifyInput: Record<string, unknown> = {
      limit: Math.min(Math.max(limit, 10), 5000),
      includeAi,
      includeLinkedIn,
      descriptionType: "text",
    };

    if (keywords) apifyInput.keywords = keywords;
    if (typeof removeAgency === "boolean") apifyInput.removeAgency = removeAgency;
    if (typeof organizationEmployeesGte === "number") apifyInput.organizationEmployeesGte = organizationEmployeesGte;
    if (typeof organizationEmployeesLte === "number") apifyInput.organizationEmployeesLte = organizationEmployeesLte;
    if (datePostedAfter) apifyInput.datePostedAfter = datePostedAfter;

    const arrayFields: [string, unknown][] = [
      ["locations", locations],
      ["linkedinIndustries", linkedinIndustries],
      ["employmentTypeFilter", employmentTypeFilter],
      ["descriptionSearch", descriptionSearch],
      ["organizationSearch", organizationSearch],
    ];

    for (const [key, value] of arrayFields) {
      if (Array.isArray(value) && value.length > 0) {
        apifyInput[key] = value;
      }
    }

    const apifyUrl = `https://api.apify.com/v2/acts/fantastic-jobs~advanced-linkedin-job-search-api/run-sync-get-dataset-items?token=${apifyToken}`;

    const apifyResponse = await fetch(apifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(apifyInput),
    });

    if (!apifyResponse.ok) {
      const errText = await apifyResponse.text();
      return new Response(
        JSON.stringify({ error: "Apify API error", details: errText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const jobs = await apifyResponse.json();

    if (!Array.isArray(jobs)) {
      return new Response(
        JSON.stringify({ error: "Unexpected Apify response format" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    let newCount = 0;

    for (let i = 0; i < jobs.length; i += 50) {
      const batch = jobs.slice(i, i + 50);
      const rows = batch.map((job: Record<string, unknown>, idx: number) =>
        mapJobToRow(job, organizationId, i + idx)
      );

      const { data: upserted, error: upsertError } = await adminClient
        .from("job_listings")
        .upsert(rows, {
          onConflict: "organization_id,external_id",
          ignoreDuplicates: false,
        })
        .select("id");

      if (upsertError) {
        console.error("Upsert error:", upsertError);
      } else {
        newCount += upserted?.length || 0;
      }
    }

    await adminClient.from("job_import_logs").insert({
      organization_id: organizationId,
      total_jobs: jobs.length,
      new_jobs: newCount,
      filters_used: { ...apifyInput, source: "linkedin_search" },
      status: "completed",
    });

    return new Response(
      JSON.stringify({ total: jobs.length, new_count: newCount }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
