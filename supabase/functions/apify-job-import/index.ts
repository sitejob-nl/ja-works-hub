import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function mapJobToRow(job: Record<string, unknown>, organizationId: string, index: number) {
  return {
    organization_id: organizationId,
    external_id: String(job.id || job.url || `${index}-${Math.random()}`),
    title: job.title || "Untitled",
    organization_name: job.organization || null,
    organization_url: job.organization_url || null,
    organization_logo: job.organization_logo || null,
    url: job.url || null,
    locations_derived: job.locations_derived || null,
    country:
      (job.countries_derived as Array<{ country?: string }>)?.[0]?.country || null,
    city:
      (job.cities_derived as Array<{ city?: string }>)?.[0]?.city || null,
    description_text: job.description_text || null,
    source: job.source || null,
    source_type: job.source_type || null,
    employment_type: job.employment_type || null,
    work_arrangement: job.ai_work_arrangement || null,
    ai_taxonomies: job.ai_taxonomies_a || null,
    ai_key_skills: job.ai_key_skills || null,
    ai_salary_currency: job.ai_salary_currency || null,
    ai_salary_min: job.ai_salary_minvalue || null,
    ai_salary_max: job.ai_salary_maxvalue || null,
    ai_salary_unit: job.ai_salary_unit || null,
    date_posted: job.date_posted || null,
    // AI fields
    ai_experience_level: job.ai_experience_level || null,
    ai_employment_type: job.ai_employment_type || null,
    ai_benefits: job.ai_benefits || null,
    ai_core_responsibilities: job.ai_core_responsibilities || null,
    ai_requirements_summary: job.ai_requirements_summary || null,
    ai_education_requirements: job.ai_education_requirements || null,
    ai_keywords: job.ai_keywords || null,
    ai_visa_sponsorship: typeof job.ai_visa_sponsorship === "boolean" ? job.ai_visa_sponsorship : null,
    ai_hiring_manager_name: job.ai_hiring_manager_name || null,
    ai_hiring_manager_email: job.ai_hiring_manager_email_address || null,
    ai_working_hours: typeof job.ai_working_hours === "number" ? job.ai_working_hours : null,
    // Derived fields
    domain_derived: job.domain_derived || null,
    remote_derived: typeof job.remote_derived === "boolean" ? job.remote_derived : null,
    // LinkedIn fields
    linkedin_org_industry: job.linkedin_org_industry || null,
    linkedin_org_employees: typeof job.linkedin_org_employees === "number" ? job.linkedin_org_employees : null,
    linkedin_org_url: job.linkedin_org_url || null,
    linkedin_org_type: job.linkedin_org_type || null,
    linkedin_org_headquarters: job.linkedin_org_headquarters || null,
    linkedin_org_description: job.linkedin_org_description || null,
    linkedin_org_specialties: job.linkedin_org_specialties || null,
    linkedin_org_founded_date: job.linkedin_org_foundeddate || null,
    linkedin_org_slug: job.linkedin_org_slug || null,
    linkedin_org_followers: typeof job.linkedin_org_followers === "number" ? job.linkedin_org_followers : null,
    linkedin_org_size: job.linkedin_org_size || null,
    linkedin_org_recruitment_agency: typeof job.linkedin_org_recruitment_agency_derived === "boolean" ? job.linkedin_org_recruitment_agency_derived : null,
    raw_data: job,
  };
}

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

    const userId = user.id;
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", userId)
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
      timeRange = "7d",
      limit = 100,
      titleSearch, titleExclusionSearch,
      locationSearch, locationExclusionSearch,
      descriptionSearch, descriptionExclusionSearch,
      organizationSearch, organizationExclusionSearch,
      domainFilter, domainExclusionFilter,
      ats, atsExclusionFilter,
      aiTaxonomiesFilter, aiTaxonomiesPrimaryFilter, aiTaxonomiesExclusionFilter,
      aiWorkArrangementFilter, aiEmploymentTypeFilter, aiExperienceLevelFilter,
      aiHasSalary, aiVisaSponsorshipFilter,
      liIndustryFilter, liOrganizationEmployeesLte, liOrganizationEmployeesGte,
      removeAgency,
      includeAi = true,
      includeLinkedIn = true,
    } = body;

    const apifyInput: Record<string, unknown> = {
      timeRange,
      limit: Math.min(Math.max(limit, 10), 5000),
      includeAi,
      includeLinkedIn,
      descriptionType: "text",
      populateAiRemoteLocation: false,
      populateAiRemoteLocationDerived: false,
    };

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

    if (typeof aiHasSalary === "boolean") apifyInput.aiHasSalary = aiHasSalary;
    if (typeof aiVisaSponsorshipFilter === "boolean") apifyInput.aiVisaSponsorshipFilter = aiVisaSponsorshipFilter;
    if (typeof removeAgency === "boolean") apifyInput.removeAgency = removeAgency;
    if (typeof liOrganizationEmployeesLte === "number") apifyInput.liOrganizationEmployeesLte = liOrganizationEmployeesLte;
    if (typeof liOrganizationEmployeesGte === "number") apifyInput.liOrganizationEmployeesGte = liOrganizationEmployeesGte;

    const apifyUrl = `https://api.apify.com/v2/acts/fantastic-jobs~career-site-job-listing-api/run-sync-get-dataset-items?token=${apifyToken}`;

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
      filters_used: apifyInput,
      status: "completed",
    });

    return new Response(
      JSON.stringify({ total: jobs.length, new_count: newCount }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
