import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const { match_id, candidate_id, vacancy_id } = await req.json();
    if (!candidate_id || !vacancy_id) {
      return new Response(JSON.stringify({ error: "candidate_id and vacancy_id required" }), { status: 400, headers: corsHeaders });
    }

    // Fetch candidate
    const { data: candidate, error: cErr } = await userClient
      .from("candidates")
      .select("first_name, last_name, skills, certifications, languages, notes, availability_notes")
      .eq("id", candidate_id)
      .single();
    if (cErr) throw cErr;

    // Fetch vacancy
    const { data: vacancy, error: vErr } = await userClient
      .from("vacancies")
      .select("title, description, function_name, required_count, skills_required, companies!vacancies_company_id_fkey(name, address_city)")
      .eq("id", vacancy_id)
      .single();
    if (vErr) throw vErr;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const prompt = `Beoordeel de match tussen deze kandidaat en vacature.

KANDIDAAT:
- Naam: ${candidate.first_name} ${candidate.last_name}
- Vaardigheden: ${(candidate.skills ?? []).join(", ") || "geen opgegeven"}
- Certificeringen: ${(candidate.certifications ?? []).join(", ") || "geen"}
- Talen: ${(candidate.languages ?? []).join(", ") || "geen opgegeven"}
- Beschikbaarheid: ${candidate.availability_notes ?? "niet opgegeven"}

VACATURE:
- Titel: ${vacancy.title}
- Functie: ${vacancy.function_name ?? vacancy.title}
- Bedrijf: ${(vacancy.companies as any)?.name ?? "onbekend"} (${(vacancy.companies as any)?.address_city ?? ""})
- Beschrijving: ${vacancy.description ?? "geen"}
- Gewenste vaardigheden: ${(vacancy.skills_required ?? []).join(", ") || "niet gespecificeerd"}

Geef een score van 0-100 en een korte onderbouwing in het Nederlands.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "Je bent een AI-recruiter die kandidaten matcht aan vacatures. Gebruik de score_match tool." },
          { role: "user", content: prompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "score_match",
            description: "Geef de match score en onderbouwing",
            parameters: {
              type: "object",
              properties: {
                score: { type: "number", description: "Match score 0-100" },
                reasoning: { type: "string", description: "Korte onderbouwing in het Nederlands" },
              },
              required: ["score", "reasoning"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "score_match" } },
      }),
    });

    if (response.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limit bereikt" }), { status: 429, headers: corsHeaders });
    }
    if (response.status === 402) {
      return new Response(JSON.stringify({ error: "Onvoldoende credits" }), { status: 402, headers: corsHeaders });
    }
    if (!response.ok) {
      console.error("AI error:", response.status, await response.text());
      throw new Error("AI scoring failed");
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call response");

    const { score, reasoning } = JSON.parse(toolCall.function.arguments);

    // Update match if match_id provided
    if (match_id) {
      await serviceClient
        .from("matches")
        .update({ match_score: score, match_reasoning: reasoning })
        .eq("id", match_id);
    }

    return new Response(JSON.stringify({ score, reasoning }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("calculate-match error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
