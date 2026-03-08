import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } =
      await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.claims.sub;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ error: "Profile not found" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const organizationId = profile.organization_id;
    const body = await req.json();
    const {
      timeRange = "7d",
      limit = 100,
      // Search arrays
      titleSearch,
      titleExclusionSearch,
      locationSearch,
      locationExclusionSearch,
      descriptionSearch,
      descriptionExclusionSearch,
      organizationSearch,
      organizationExclusionSearch,
      // Domain filters
      domainFilter,
      domainExclusionFilter,
      // ATS
      ats,
      atsExclusionFilter,
      // AI filters
      aiTaxonomiesFilter,
      aiTaxonomiesPrimaryFilter,
      aiTaxonomiesExclusionFilter,
      aiWorkArrangementFilter,
      aiEmploymentTypeFilter,
      aiExperienceLevelFilter,
      aiHasSalary,
      aiVisaSponsorshipFilter,
      // LinkedIn filters
      liIndustryFilter,
      liOrganizationEmployeesLte,
      liOrganizationEmployeesGte,
      // Other
      removeAgency,
      includeAi = true,
      includeLinkedIn = true,
    } = body;

    // Build Apify input
    const apifyInput: Record<string, unknown> = {
      timeRange,
      limit: Math.min(Math.max(limit, 10), 5000),
      includeAi,
      includeLinkedIn,
      descriptionType: "text",
      populateAiRemoteLocation: false,
      populateAiRemoteLocationDerived: false,
    };

    // Array filters — only add if non-empty
    const arrayFields: [string, unknown][] = [
      ["titleSearch", titleSearch],
      ["titleExclusionSearch", titleExclusionSearch],
      ["locationSearch", locationSearch],
      ["locationExclusionSearch", locationExclusionSearch],
      ["descriptionSearch", descriptionSearch],
      ["descriptionExclusionSearch", descriptionExclusionSearch],
      ["organizationSearch", organizationSearch],
      ["organizationExclusionSearch", organizationExclusionSearch],
      ["domainFilter", domainFilter],
      ["domainExclusionFilter", domainExclusionFilter],
      ["ats", ats],
      ["atsExclusionFilter", atsExclusionFilter],
      ["aiTaxonomiesFilter", aiTaxonomiesFilter],
      ["aiTaxonomiesPrimaryFilter", aiTaxonomiesPrimaryFilter],
      ["aiTaxonomiesExclusionFilter", aiTaxonomiesExclusionFilter],
      ["aiWorkArrangementFilter", aiWorkArrangementFilter],
      ["aiEmploymentTypeFilter", aiEmploymentTypeFilter],
      ["aiExperienceLevelFilter", aiExperienceLevelFilter],
      ["liIndustryFilter", liIndustryFilter],
    ];

    for (const [key, value] of arrayFields) {
      if (Array.isArray(value) && value.length > 0) {
        apifyInput[key] = value;
      }
    }

    // Boolean filters
    if (typeof aiHasSalary === "boolean") apifyInput.aiHasSalary = aiHasSalary;
    if (typeof aiVisaSponsorshipFilter === "boolean") apifyInput.aiVisaSponsorshipFilter = aiVisaSponsorshipFilter;
    if (typeof removeAgency === "boolean") apifyInput.removeAgency = removeAgency;

    // LinkedIn company size
    if (typeof liOrganizationEmployeesLte === "number") apifyInput.liOrganizationEmployeesLte = liOrganizationEmployeesLte;
    if (typeof liOrganizationEmployeesGte === "number") apifyInput.liOrganizationEmployeesGte = liOrganizationEmployeesGte;

    // Call Apify API
    const apifyUrl = `https://api.apify.com/v2/acts/fantastic-jobs~career-site-job-listing-api/run-sync-get-dataset-items?token=${apifyToken}`;

    const apifyResponse = await fetch(apifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(apifyInput),
    });

    if (!apifyResponse.ok) {
      const errText = await apifyResponse.text();
      return new Response(
        JSON.stringify({
          error: "Apify API error",
          details: errText,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const jobs = await apifyResponse.json();

    if (!Array.isArray(jobs)) {
      return new Response(
        JSON.stringify({ error: "Unexpected Apify response format" }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Use service role for upserts to bypass RLS
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    let newCount = 0;

    for (let i = 0; i < jobs.length; i += 50) {
      const batch = jobs.slice(i, i + 50);
      const rows = batch.map((job: Record<string, unknown>) => ({
        organization_id: organizationId,
        external_id: String(job.id || job.url || `${i}-${Math.random()}`),
        title: job.title || "Untitled",
        organization_name: job.organization || null,
        organization_url: job.organization_url || null,
        organization_logo: job.organization_logo || null,
        url: job.url || null,
        locations_derived: job.locations_derived || null,
        country:
          (job.countries_derived as Array<{ country?: string }>)?.[0]?.country ||
          null,
        city:
          (job.cities_derived as Array<{ city?: string }>)?.[0]?.city || null,
        description_text: job.description_text || null,
        source: job.source || null,
        employment_type: job.employment_type || null,
        work_arrangement: job.ai_work_arrangement || null,
        ai_taxonomies: job.ai_taxonomies_a || null,
        ai_key_skills: job.ai_key_skills || null,
        ai_salary_currency: job.ai_salary_currency || null,
        ai_salary_min: job.ai_salary_minvalue || null,
        ai_salary_max: job.ai_salary_maxvalue || null,
        ai_salary_unit: job.ai_salary_unit || null,
        date_posted: job.date_posted || null,
        linkedin_org_industry: job.linkedin_org_industry || null,
        linkedin_org_employees: job.linkedin_org_employees || null,
        raw_data: job,
      }));

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
      filters_used: apifyInput,
      status: "completed",
    });

    return new Response(
      JSON.stringify({ total: jobs.length, new_count: newCount }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
