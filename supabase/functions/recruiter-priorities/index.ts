import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireRolePermission } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const auth = await requireRolePermission(req, "candidates.view", corsHeaders);
    if (auth instanceof Response) return auth;
    const userId = auth.userId;

    // Get user's org
    const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", userId).single();
    if (!profile) throw new Error("Profile not found");
    const orgId = auth.organizationId;

    // Gather signals for AI prioritization
    const now = new Date().toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const threeDaysFromNow = new Date(Date.now() + 3 * 86400000).toISOString().split("T")[0];

    // 1. Expiring documents (next 7 days)
    const { data: expiringDocs } = await supabase
      .from("documents")
      .select("id, name, type, expiry_date, candidate_id, candidates(first_name, last_name)")
      .lte("expiry_date", threeDaysFromNow)
      .gte("expiry_date", now.split("T")[0])
      .neq("status", "verlopen");

    // 2. Candidates without follow-up (status in_behandeling, no comms in 7 days)
    const { data: staleCandidates } = await supabase
      .from("candidates")
      .select("id, first_name, last_name, status, updated_at")
      .eq("status", "in_behandeling")
      .lt("updated_at", sevenDaysAgo)
      .limit(20);

    // 3. Open vacancies needing matches
    const { data: openVacancies } = await supabase
      .from("vacancies" as any)
      .select("id, title, required_count, filled_count, start_date, companies(name)")
      .eq("status", "open")
      .limit(20);

    // 4. Employees with incomplete onboarding
    const { data: incompleteOnboarding } = await supabase
      .from("employees")
      .select("id, candidate_id, start_date, candidates(first_name, last_name)")
      .eq("onboarding_completed", false)
      .eq("status", "onboarding")
      .limit(20);

    // 5. Unnotified sick reports
    const { data: sickReports } = await supabase
      .from("sick_reports")
      .select("id, employee_id, reported_at, employees(candidates(first_name, last_name))")
      .eq("client_notified", false)
      .is("actual_return_date", null)
      .limit(10);

    // Build context for AI
    const context = {
      expiringDocs: (expiringDocs || []).map((d: any) => ({
        docName: d.name, type: d.type, expiryDate: d.expiry_date,
        candidate: `${d.candidates?.first_name} ${d.candidates?.last_name}`,
        candidateId: d.candidate_id,
      })),
      staleCandidates: (staleCandidates || []).map((c: any) => ({
        id: c.id, name: `${c.first_name} ${c.last_name}`, lastUpdate: c.updated_at,
      })),
      openVacancies: (openVacancies || []).map((v: any) => ({
        id: v.id, title: v.title, company: v.companies?.name,
        needed: (v.required_count || 1) - (v.filled_count || 0), startDate: v.start_date,
      })),
      incompleteOnboarding: (incompleteOnboarding || []).map((e: any) => ({
        employeeId: e.id, candidateId: e.candidate_id, startDate: e.start_date,
        name: `${e.candidates?.first_name} ${e.candidates?.last_name}`,
      })),
      sickReports: (sickReports || []).map((s: any) => ({
        id: s.id, reportedAt: s.reported_at,
        name: `${s.employees?.candidates?.first_name} ${s.employees?.candidates?.last_name}`,
      })),
    };

    // Call AI to generate prioritized tasks
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `Je bent een AI-assistent voor een uitzendbureau. Analyseer de huidige signalen en genereer een geprioriteerde takenlijst voor de recruiter.
Categorieën: compliance, opvolging, matching, onboarding, ziekte.
Prioriteiten: critical (vandaag), high (deze week), medium (binnenkort), low (optioneel).
Genereer maximaal 15 taken. Focus op urgentie en impact.`,
          },
          {
            role: "user",
            content: `Huidige datum: ${now.split("T")[0]}\nRecruiter: ${profile.full_name}\n\nSignalen:\n${JSON.stringify(context, null, 2)}\n\nGenereer taken gesorteerd op urgentie.`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "generate_tasks",
              description: "Generate prioritized recruiter tasks based on signals.",
              parameters: {
                type: "object",
                properties: {
                  tasks: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string" },
                        description: { type: "string" },
                        priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
                        category: { type: "string", enum: ["compliance", "opvolging", "matching", "onboarding", "ziekte"] },
                        related_entity_type: { type: "string", enum: ["candidate", "employee", "vacancy", "document", "sick_report"] },
                        related_entity_id: { type: "string" },
                        reasoning: { type: "string" },
                      },
                      required: ["title", "description", "priority", "category", "reasoning"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["tasks"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "generate_tasks" } },
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit bereikt, probeer later opnieuw." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "Tegoed op, voeg credits toe." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI error:", aiResponse.status, errText);
      throw new Error("AI gateway error");
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No structured AI response");

    const { tasks: aiTasks } = JSON.parse(toolCall.function.arguments);

    // Upsert tasks into DB
    const taskRecords = aiTasks.map((t: any) => ({
      organization_id: orgId,
      assigned_to: userId,
      title: t.title,
      description: t.description,
      priority: t.priority,
      category: t.category,
      related_entity_type: t.related_entity_type || null,
      related_entity_id: t.related_entity_id || null,
      ai_generated: true,
      ai_reasoning: t.reasoning,
      status: "open",
    }));

    // Clear old AI tasks for this user that are still open, then insert new ones
    await supabase
      .from("recruiter_tasks" as any)
      .delete()
      .eq("assigned_to", userId)
      .eq("ai_generated", true)
      .eq("status", "open");

    if (taskRecords.length > 0) {
      const { error: insertError } = await supabase
        .from("recruiter_tasks" as any)
        .insert(taskRecords);
      if (insertError) console.error("Insert error:", insertError);
    }

    return new Response(JSON.stringify({ tasks: aiTasks, count: aiTasks.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("recruiter-priorities error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
