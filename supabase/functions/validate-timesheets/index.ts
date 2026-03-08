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

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const { timesheet_ids } = await req.json();
    if (!timesheet_ids?.length) {
      return new Response(JSON.stringify({ error: "No timesheet_ids provided" }), { status: 400, headers: corsHeaders });
    }

    // Fetch timesheets with context
    const { data: timesheets, error: tsError } = await userClient
      .from("timesheets")
      .select(`
        id, work_date, hours, overtime_hours, status, employee_id, placement_id,
        employees!timesheets_employee_id_fkey(
          contract_hours,
          candidates!employees_candidate_id_fkey(first_name, last_name)
        ),
        placements!timesheets_placement_id_fkey(
          function_name,
          companies!placements_company_id_fkey(name)
        )
      `)
      .in("id", timesheet_ids);

    if (tsError) throw tsError;
    if (!timesheets?.length) {
      return new Response(JSON.stringify({ error: "No timesheets found" }), { status: 404, headers: corsHeaders });
    }

    // Group by employee for weekly analysis
    const byEmployee = new Map<string, any[]>();
    for (const ts of timesheets) {
      const key = ts.employee_id;
      if (!byEmployee.has(key)) byEmployee.set(key, []);
      byEmployee.get(key)!.push(ts);
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const results: { id: string; status: string; issues: string[] }[] = [];

    for (const [employeeId, entries] of byEmployee) {
      const emp = entries[0].employees as any;
      const pl = entries[0].placements as any;
      const name = `${emp?.candidates?.first_name ?? ""} ${emp?.candidates?.last_name ?? ""}`.trim();
      const contractHours = emp?.contract_hours ?? 40;

      const prompt = `Valideer de volgende urenregistraties voor medewerker "${name}" (contracturen: ${contractHours}/week, functie: ${pl?.function_name ?? "onbekend"}, bedrijf: ${(pl?.companies as any)?.name ?? "onbekend"}).

Uren:
${entries.map((e: any) => `- ${e.work_date}: ${e.hours}u regulier, ${e.overtime_hours ?? 0}u overwerk`).join("\n")}

Controleer op:
1. Meer dan 12 uur op één dag
2. Meer dan 60 uur totaal per week
3. Weekend-uren (za/zo) zonder overwerk-markering
4. Ongebruikelijk patroon (plotselinge grote afwijkingen)
5. Meer uren dan contracturen zonder overwerk-markering`;

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: "Je bent een AI-assistent die urenregistraties valideert voor een uitzendbureau. Gebruik de validate_timesheets tool om je resultaat te geven." },
            { role: "user", content: prompt },
          ],
          tools: [{
            type: "function",
            function: {
              name: "validate_timesheets",
              description: "Geef de validatieresultaten voor de uren",
              parameters: {
                type: "object",
                properties: {
                  entries: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        work_date: { type: "string" },
                        status: { type: "string", enum: ["groen", "oranje", "rood"] },
                        issues: { type: "array", items: { type: "string" } },
                      },
                      required: ["work_date", "status", "issues"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["entries"],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "validate_timesheets" } },
        }),
      });

      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit bereikt, probeer het later opnieuw" }), { status: 429, headers: corsHeaders });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Onvoldoende credits, vul uw saldo aan" }), { status: 402, headers: corsHeaders });
      }
      if (!response.ok) {
        console.error("AI gateway error:", response.status, await response.text());
        throw new Error("AI validation failed");
      }

      const aiResult = await response.json();
      const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall) throw new Error("No tool call in AI response");

      const parsed = JSON.parse(toolCall.function.arguments);
      const validatedEntries = parsed.entries ?? [];

      // Map back to timesheets and update
      for (const ts of entries) {
        const validation = validatedEntries.find((v: any) => v.work_date === ts.work_date) ?? { status: "groen", issues: [] };
        results.push({ id: ts.id, status: validation.status, issues: validation.issues });

        await serviceClient
          .from("timesheets")
          .update({
            status: validation.status,
            ai_validation_result: { status: validation.status, issues: validation.issues },
            ai_validated_at: new Date().toISOString(),
          })
          .eq("id", ts.id);
      }
    }

    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("validate-timesheets error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
