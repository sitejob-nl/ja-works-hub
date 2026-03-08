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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
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
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const organizationId = profile.organization_id;

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

    if (!query || typeof query !== "string") {
      return new Response(JSON.stringify({ error: "query is required" }), {
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

    // Build Exa request
    const exaBody: Record<string, unknown> = {
      query,
      type: "neural",
      category: "person",
      numResults: Math.min(Math.max(numResults, 5), 100),
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

    console.log("Calling Exa API with body:", JSON.stringify(exaBody));

    const exaRes = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "x-api-key": EXA_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(exaBody),
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
    const results = exaData.results || [];

    // Use service role for upserts
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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
        new_count: newCount,
        results: mappedResults,
        cost: exaData.costDollars || null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
