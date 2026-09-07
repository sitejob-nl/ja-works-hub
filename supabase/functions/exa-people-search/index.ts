import { AiAccountingError, meteredAiFetch } from "../_shared/ai-accounting.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireRolePermission } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// URL patterns that indicate a vacancy/job listing rather than a person profile
const VACANCY_URL_PATTERNS = [
  "indeed.com", "indeed.nl", "indeed.de", "indeed.be",
  "linkedin.com/jobs",
  "glassdoor.com/job", "glassdoor.nl",
  "jigler.nl/vacature", "jigler.nl/baan",
  "werkzoeken.nl", "nationalevacaturebank.nl",
  "jobbird.com", "jobbird.nl",
  "monsterboard.nl", "monster.com",
  "randstad.nl/vacature", "randstad.com/jobs",
  "tempo-team.nl/vacature",
  "yacht.nl/vacature",
  "hays.nl/vacature", "hays.com/job",
  "brunel.nl/vacature", "brunel.net/job",
  "manpower.nl/vacature",
  "werk.nl/vacature",
  "intermediair.nl/vacature",
  "techniekwerkt.nl/vacature",
  "uitzendbureau.nl",
  "staffinggroup.nl/vacature",
  "olympia.nl/vacature",
  "adecco.nl/vacature",
  "unique.nl/vacature",
  "start-people.nl/vacature",
  "leerwerk.nl/vacature",
  "technischebanen.nl",
  "productiebanen.nl",
  "logistiekebanen.nl",
  "/vacature/", "/vacatures/",
  "/job-opening/", "/job-listings/",
  "/careers/", "/career/",
  "/jobs/", "/baan/", "/banen/",
];

// Title patterns that indicate a vacancy
const VACANCY_TITLE_PATTERNS = [
  "vacature", "vacancy", "job opening", "solliciteer",
  "we're hiring", "we are hiring", "now hiring",
  "gezocht", "wanted", "apply now", "solliciteren",
  "werken bij", "werk bij", "medewerker gezocht",
  "zoekt een", "zoekt medewerker",
];

function isVacancyResult(result: Record<string, unknown>): boolean {
  const url = ((result.url as string) || "").toLowerCase();
  const title = ((result.title as string) || "").toLowerCase();

  // Check URL patterns
  for (const pattern of VACANCY_URL_PATTERNS) {
    if (url.includes(pattern)) return true;
  }

  // Check title patterns
  for (const pattern of VACANCY_TITLE_PATTERNS) {
    if (title.includes(pattern)) return true;
  }

  return false;
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

    const auth = await requireRolePermission(req, "candidates.edit", corsHeaders);
    if (auth instanceof Response) return auth;
    const organizationId = auth.organizationId;

    const {
      query,
      userLocation = "NL",
      numResults = 20,
      includeText = false,
      highlightsQuery,
      maxCharacters = 2000,
      numSentences = 3,
      highlightsPerUrl = 3,
    } = await req.json();

    if (!query || typeof query !== "string" || query.length > 10000
      || typeof numResults !== "number" || !Number.isFinite(numResults)
      || typeof maxCharacters !== "number" || !Number.isFinite(maxCharacters)
      || typeof numSentences !== "number" || !Number.isFinite(numSentences)
      || typeof highlightsPerUrl !== "number" || !Number.isFinite(highlightsPerUrl)
      || (highlightsQuery != null && (typeof highlightsQuery !== "string" || highlightsQuery.length > 10000))) {
      return new Response(JSON.stringify({ error: "Ongeldige zoekopdracht of zoeklimieten." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const EXA_API_KEY = Deno.env.get("EXA_API_KEY");
    if (!EXA_API_KEY) {
      return new Response(JSON.stringify({ error: "EXA_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Request 1.5x results to compensate for vacancy filtering
    const requestedResults = Math.min(Math.max(Math.floor(numResults), 5), 100);
    const overFetchResults = Math.min(Math.ceil(requestedResults * 1.5), 100);

    // Build Exa request
    const exaBody: Record<string, unknown> = {
      query,
      type: "neural",
      category: "person",
      numResults: overFetchResults,
      useAutoprompt: true,
    };

    if (userLocation) exaBody.userLocation = userLocation;

    // Contents config
    const contents: Record<string, unknown> = {};
    if (includeText) {
      contents.text = { maxCharacters: Math.min(Math.max(maxCharacters, 100), 10000) };
    }
    if (highlightsQuery) {
      contents.highlights = {
        query: highlightsQuery,
        numSentences: Math.min(Math.max(numSentences, 1), 10),
        highlightsPerUrl: Math.min(Math.max(highlightsPerUrl, 1), 10),
      };
    }
    if (Object.keys(contents).length > 0) {
      exaBody.contents = contents;
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { response: exaRes } = await meteredAiFetch({
      admin: adminClient,
      organizationId,
      userId: auth.userId,
      feature: "people_search",
    }, {
      provider: "exa",
      model: "exa-search",
      url: "https://api.exa.ai/search",
      headers: {
        "x-api-key": EXA_API_KEY,
        "Content-Type": "application/json",
      },
      body: exaBody,
    });

    if (!exaRes.ok) {
      const errorBody = await exaRes.text();
      console.error("Exa API error:", exaRes.status, errorBody);
      return new Response(
        JSON.stringify({ error: `Exa API error [${exaRes.status}]: ${errorBody}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const exaData = await exaRes.json();
    const allResults = exaData.results || [];

    // Filter out vacancy results
    const filteredResults = allResults.filter((r: Record<string, unknown>) => !isVacancyResult(r));
    const filteredCount = allResults.length - filteredResults.length;

    // Trim to requested number
    const results = filteredResults.slice(0, requestedResults);

    console.log(`Exa returned ${allResults.length} results, filtered ${filteredCount} vacancies, keeping ${results.length}`);

    let newCount = 0;
    const mappedResults = results.map((r: Record<string, unknown>) => ({
      organization_id: organizationId,
      external_id: r.id as string,
      name: (r.author as string) || (r.title as string)?.split("|")[0]?.trim() || null,
      title: r.title as string || null,
      url: r.url as string || null,
      image_url: r.image as string || null,
      published_date: r.publishedDate as string || null,
      text_content: r.text as string || null,
      highlights: (r.highlights as string[]) || null,
      highlight_scores: (r.highlightScores as number[]) || null,
      search_query: query,
      raw_data: r,
    }));

    if (mappedResults.length > 0) {
      const { data: upserted, error: upsertError } = await adminClient
        .from("people_search_results")
        .upsert(mappedResults, {
          onConflict: "organization_id,external_id",
          ignoreDuplicates: false,
        })
        .select("id");

      if (upsertError) {
        console.error("Upsert error:", upsertError);
      } else {
        newCount = upserted?.length ?? 0;
      }
    }

    return new Response(
      JSON.stringify({
        total: results.length,
        total_before_filter: allResults.length,
        filtered_count: filteredCount,
        new_count: newCount,
        results: mappedResults,
        cost: exaData.costDollars || null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    if (err instanceof AiAccountingError) {
      return new Response(JSON.stringify({ error: err.message, code: err.code }), {
        status: err.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.error("Edge function error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
