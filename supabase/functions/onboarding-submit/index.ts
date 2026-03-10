import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    // ─── GET: validate token & return dynamic form ───
    if (req.method === "GET") {
      const url = new URL(req.url);
      const token = url.searchParams.get("token");
      if (!token) return json({ error: "Token required" }, 400);

      const { data: tokenData, error: tErr } = await admin
        .from("onboarding_tokens")
        .select("id, employee_id, organization_id, expires_at, used_at, form_id")
        .eq("token", token)
        .maybeSingle();

      if (tErr || !tokenData) return json({ error: "Ongeldige link" }, 404);
      if (tokenData.used_at) return json({ error: "Deze link is al gebruikt" }, 400);
      if (new Date(tokenData.expires_at) < new Date()) return json({ error: "Deze link is verlopen" }, 400);

      // If a form_id is linked, load the dynamic form
      let form = null;
      if (tokenData.form_id) {
        const { data: formData } = await admin
          .from("onboarding_forms")
          .select("id, name, description")
          .eq("id", tokenData.form_id)
          .maybeSingle();

        if (formData) {
          const { data: stepsData } = await admin
            .from("onboarding_form_steps")
            .select("id, title, description, sort_order")
            .eq("form_id", formData.id)
            .eq("is_active", true)
            .order("sort_order", { ascending: true });

          const stepIds = (stepsData ?? []).map((s: any) => s.id);

          let fieldsData: any[] = [];
          if (stepIds.length > 0) {
            const { data: fData } = await admin
              .from("onboarding_form_fields")
              .select("id, step_id, label, field_type, is_required, placeholder, help_text, options, width, validation_regex, validation_message, maps_to_table, maps_to_column, document_type, sort_order")
              .in("step_id", stepIds)
              .eq("is_active", true)
              .order("sort_order", { ascending: true });
            fieldsData = fData ?? [];
          }

          form = {
            id: formData.id,
            name: formData.name,
            description: formData.description,
            steps: (stepsData ?? []).map((step: any) => ({
              ...step,
              fields: fieldsData.filter((f: any) => f.step_id === step.id),
            })),
          };
        }
      } else {
        // Try to find default form for this org
        const { data: defaultForm } = await admin
          .from("onboarding_forms")
          .select("id, name, description")
          .eq("organization_id", tokenData.organization_id)
          .eq("is_default", true)
          .eq("is_active", true)
          .maybeSingle();

        if (defaultForm) {
          const { data: stepsData } = await admin
            .from("onboarding_form_steps")
            .select("id, title, description, sort_order")
            .eq("form_id", defaultForm.id)
            .eq("is_active", true)
            .order("sort_order", { ascending: true });

          const stepIds = (stepsData ?? []).map((s: any) => s.id);

          let fieldsData: any[] = [];
          if (stepIds.length > 0) {
            const { data: fData } = await admin
              .from("onboarding_form_fields")
              .select("id, step_id, label, field_type, is_required, placeholder, help_text, options, width, validation_regex, validation_message, maps_to_table, maps_to_column, document_type, sort_order")
              .in("step_id", stepIds)
              .eq("is_active", true)
              .order("sort_order", { ascending: true });
            fieldsData = fData ?? [];
          }

          form = {
            id: defaultForm.id,
            name: defaultForm.name,
            description: defaultForm.description,
            steps: (stepsData ?? []).map((step: any) => ({
              ...step,
              fields: fieldsData.filter((f: any) => f.step_id === step.id),
            })),
          };
        }
      }

      return json({ valid: true, form });
    }

    // ─── POST: submit onboarding data ───
    if (req.method === "POST") {
      const body = await req.json();
      const { token, personal_data, documents_accepted, form_id, responses } = body;

      if (!token) return json({ error: "Token required" }, 400);

      // Validate token
      const { data: tokenData, error: tErr } = await admin
        .from("onboarding_tokens")
        .select("id, employee_id, organization_id, expires_at, used_at, form_id")
        .eq("token", token)
        .maybeSingle();

      if (tErr || !tokenData) return json({ error: "Ongeldige link" }, 404);
      if (tokenData.used_at) return json({ error: "Deze link is al gebruikt" }, 400);
      if (new Date(tokenData.expires_at) < new Date()) return json({ error: "Deze link is verlopen" }, 400);

      // Get employee + candidate
      const { data: employee, error: eErr } = await admin
        .from("employees")
        .select("id, candidate_id")
        .eq("id", tokenData.employee_id)
        .single();
      if (eErr || !employee) return json({ error: "Medewerker niet gevonden" }, 404);

      const activeFormId = form_id || tokenData.form_id;

      // ── Dynamic form submission ──
      if (activeFormId && responses && typeof responses === "object") {
        // Load field definitions to get mappings
        const { data: formSteps } = await admin
          .from("onboarding_form_steps")
          .select("id")
          .eq("form_id", activeFormId);

        const stepIds = (formSteps ?? []).map((s: any) => s.id);

        let fieldDefs: any[] = [];
        if (stepIds.length > 0) {
          const { data: fData } = await admin
            .from("onboarding_form_fields")
            .select("id, maps_to_table, maps_to_column, document_type, field_type")
            .in("step_id", stepIds);
          fieldDefs = fData ?? [];
        }

        // Build candidate updates from mapped fields
        const candidateUpdates: Record<string, string> = {};
        const responseInserts: any[] = [];

        for (const [fieldId, value] of Object.entries(responses)) {
          if (!value || typeof value !== "string") continue;

          const fieldDef = fieldDefs.find((f: any) => f.id === fieldId);
          if (!fieldDef) continue;

          // Map to candidate table if configured
          if (fieldDef.maps_to_table === "candidates" && fieldDef.maps_to_column) {
            candidateUpdates[fieldDef.maps_to_column] = value;
          }

          // Store in onboarding_responses
          responseInserts.push({
            organization_id: tokenData.organization_id,
            employee_id: employee.id,
            form_id: activeFormId,
            field_id: fieldId,
            value: value,
          });
        }

        // Apply candidate updates
        if (Object.keys(candidateUpdates).length > 0) {
          await admin.from("candidates").update(candidateUpdates).eq("id", employee.candidate_id);
        }

        // Store responses
        if (responseInserts.length > 0) {
          await admin.from("onboarding_responses").insert(responseInserts);
        }
      }
      // ── Legacy fallback submission ──
      else if (personal_data) {
        const allowed = ["bsn", "iban", "date_of_birth", "nationality", "address_street", "address_postal", "address_city", "address_country", "phone", "email"];
        const updates: Record<string, any> = {};
        for (const key of allowed) {
          if (personal_data[key] !== undefined && personal_data[key] !== null && personal_data[key] !== "") {
            updates[key] = personal_data[key];
          }
        }
        if (Object.keys(updates).length > 0) {
          await admin.from("candidates").update(updates).eq("id", employee.candidate_id);
        }
      }

      // Create reglement document if accepted
      if (documents_accepted) {
        await admin.from("documents").insert({
          organization_id: tokenData.organization_id,
          candidate_id: employee.candidate_id,
          name: "Reglement akkoord",
          type: "reglement",
          status: "geldig",
        });
      }

      // Mark token as used
      await admin.from("onboarding_tokens").update({ used_at: new Date().toISOString() }).eq("id", tokenData.id);

      // Mark onboarding completed
      await admin.from("employees").update({
        onboarding_completed: true,
        onboarding_completed_at: new Date().toISOString(),
      }).eq("id", employee.id);

      return json({ success: true });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    console.error("onboarding-submit error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
