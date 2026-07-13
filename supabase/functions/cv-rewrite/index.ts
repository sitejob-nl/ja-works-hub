import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, requireRolePermission } from "../_shared/auth.ts";
import { pseudonymizeCv } from "../_shared/cv-pseudonymize.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireRolePermission(req, "candidates.screening.manage", corsHeaders);
    if (auth instanceof Response) return auth;

    const body = await req.json();
    const { language, anonymous } = body;
    const candidateId = body.candidate_id ?? body.candidate?.id;
    if (!candidateId) {
      return new Response(JSON.stringify({ error: "candidate_id is verplicht" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const admin = createAdminClient();
    const { data: candidate, error: candidateError } = await admin
      .from("candidates")
      .select("id, first_name, last_name, skills, languages, certifications, ai_summary, ai_target_functions, ai_function_group")
      .eq("id", candidateId)
      .eq("organization_id", auth.organizationId)
      .single();

    if (candidateError || !candidate) {
      return new Response(JSON.stringify({ error: "Kandidaat niet gevonden" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: employee } = await admin
      .from("employees")
      .select("id")
      .eq("candidate_id", candidateId)
      .eq("organization_id", auth.organizationId)
      .maybeSingle();

    const { data: placements } = employee
      ? await admin
        .from("placements")
        .select("function_name, start_date, end_date, status, companies(name)")
        .eq("employee_id", employee.id)
        .eq("organization_id", auth.organizationId)
        .order("start_date", { ascending: false })
      : { data: [] };

    const langMap: Record<string, string> = {
      nl: "Nederlands",
      en: "English",
      pl: "Polski",
    };
    const targetLang = langMap[language] || "Nederlands";

    // B2/AVG: never send direct identifiers (name, email, phone, DOB, nationality,
    // address) to the third-party AI gateway. The real name/contact are re-attached
    // client-side after generation, so the prompt only needs the professional profile.
    void anonymous; // output styling only; the data sent is always identifier-free now
    const candidateProfile = {
      reference: candidate.id?.substring(0, 6)?.toUpperCase() || "REF",
      skills: candidate.skills,
      languages: candidate.languages,
      certifications: candidate.certifications,
      summary: candidate.ai_summary,
      target_functions: candidate.ai_target_functions,
      function_group: candidate.ai_function_group,
    };

    const systemPrompt = `Je bent een professionele CV-schrijver voor een uitzendbureau. Schrijf een professioneel CV in het ${targetLang}.
Gebruik het verstrekte kandidaatprofiel en de plaatsingshistorie om een professioneel profiel te genereren.
Schrijf in de derde persoon, professioneel en beknopt. Focus op relevante werkervaring en vaardigheden.
Gebruik GEEN namen of contactgegevens; verwijs neutraal naar de kandidaat.`;

    const rawUserPrompt = `Kandidaatprofiel:
${JSON.stringify(candidateProfile, null, 2)}

Plaatsingshistorie:
${JSON.stringify(placements || [], null, 2)}

Genereer een professioneel CV met de volgende secties.`;

    // Belt-and-suspenders: scrub any name/email/phone/BSN/IBAN that may have leaked
    // into free-text fields (ai_summary, company names, function titles) before sending.
    const { text: userPrompt } = pseudonymizeCv(rawUserPrompt, {
      first_name: candidate.first_name,
      last_name: candidate.last_name,
    });

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "generate_cv",
              description: "Generate structured CV sections for a candidate profile.",
              parameters: {
                type: "object",
                properties: {
                  summary: { type: "string", description: "Professional summary / profile description (2-4 sentences)" },
                  experience: { type: "string", description: "Work experience section with bullet points, based on placements history" },
                  skills: { type: "string", description: "Skills section, comma-separated or bullet points" },
                  education: { type: "string", description: "Education section, based on certifications or inferred background" },
                  languages: { type: "string", description: "Languages section with proficiency levels" },
                  certifications: { type: "string", description: "Certifications and qualifications" },
                },
                required: ["summary", "experience", "skills", "education", "languages", "certifications"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "generate_cv" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit bereikt, probeer later opnieuw." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Tegoed op, voeg credits toe." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(JSON.stringify({ error: "No structured response from AI" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sections = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify({ sections }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("cv-rewrite error:", e);
    return new Response(JSON.stringify({ error: "Genereren van het CV is mislukt. Probeer het later opnieuw." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
