import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { onboardingResult, saveOnboardingProfile } from "../_shared/onboarding-profile.ts";

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
      const userAgent = req.headers.get("user-agent") ?? "unknown";
      if (!token) {
        console.log(`[onboarding-submit] GET missing token, ua=${userAgent}`);
        return json({ error: "Token required" }, 400);
      }
      const tokenPrefix = token.slice(0, 8);

      const { data: tokenData, error: tErr } = await admin
        .from("onboarding_tokens")
        .select("id, employee_id, candidate_id, organization_id, expires_at, used_at, form_id")
        .eq("token", token)
        .maybeSingle();

      if (tErr || !tokenData) {
        console.log(`[onboarding-submit] GET token-not-found prefix=${tokenPrefix} err=${tErr?.message ?? "none"} ua=${userAgent}`);
        return json({ error: "Ongeldige link" }, 404);
      }
      if (tokenData.used_at) {
        console.log(`[onboarding-submit] GET token-already-used prefix=${tokenPrefix} used_at=${tokenData.used_at}`);
        return json({ error: "Deze link is al gebruikt" }, 400);
      }
      if (new Date(tokenData.expires_at) < new Date()) {
        console.log(`[onboarding-submit] GET token-expired prefix=${tokenPrefix} expires_at=${tokenData.expires_at}`);
        return json({ error: "Deze link is verlopen" }, 400);
      }
      console.log(`[onboarding-submit] GET token-ok prefix=${tokenPrefix} candidate=${tokenData.candidate_id} form_id=${tokenData.form_id ?? "none"}`);

      // Personalisatie voor de publieke pagina: alléén voornaam + org-branding
      // (geen gevoelige kandidaatdata — de link kan gedeeld/doorgestuurd zijn).
      let candidateFirstName: string | null = null;
      let organizationName: string | null = null;
      let organizationLogo: string | null = null;
      if (tokenData.candidate_id) {
        const { data: cand } = await admin
          .from("candidates")
          .select("first_name")
          .eq("id", tokenData.candidate_id)
          .maybeSingle();
        candidateFirstName = cand?.first_name ?? null;
      }
      {
        const { data: org } = await admin
          .from("organizations")
          .select("name, logo_url")
          .eq("id", tokenData.organization_id)
          .maybeSingle();
        organizationName = org?.name ?? null;
        organizationLogo = org?.logo_url ?? null;
      }

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

      return json({
        valid: true,
        form,
        candidate_first_name: candidateFirstName,
        organization_name: organizationName,
        organization_logo: organizationLogo,
      });
    }

    // ─── POST: submit onboarding data ───
    if (req.method === "POST") {
      const body = await req.json();
      const { token, documents_accepted } = body;

      if (!token) return json({ error: "Token required" }, 400);

      // Validate token
      const { data: tokenData, error: tErr } = await admin
        .from("onboarding_tokens")
        .select("id, employee_id, candidate_id, organization_id, expires_at, used_at, form_id")
        .eq("token", token)
        .maybeSingle();

      if (tErr || !tokenData) return json({ error: "Ongeldige link" }, 404);
      if (tokenData.used_at) return json({ error: "Deze link is al gebruikt" }, 400);
      if (new Date(tokenData.expires_at) < new Date()) return json({ error: "Deze link is verlopen" }, 400);

      // Resolve candidate_id (prefer candidate_id, fall back to employee_id lookup)
      let candidateId = tokenData.candidate_id;
      if (!candidateId && tokenData.employee_id) {
        // TRANSITIONAL: fallback to employees table lookup during migration to candidate-centric model.
        // Remove once all onboarding_tokens have candidate_id populated and employees table is dropped.
        const { data: employee } = await admin
          .from("employees")
          .select("candidate_id")
          .eq("id", tokenData.employee_id)
          .single();
        candidateId = employee?.candidate_id;
      }
      if (!candidateId) return json({ error: "Kandidaat niet gevonden" }, 404);

      await saveOnboardingProfile(admin, tokenData, candidateId, body);

      // Upload document files if provided
      const uploadedDocs = body.documents;
      if (Array.isArray(uploadedDocs)) {
        for (const doc of uploadedDocs) {
          if (!doc.data || !doc.type || !doc.name) continue;
          try {
            // Convert base64 data URL to binary
            const base64Data = doc.data.split(",")[1];
            if (!base64Data) continue;
            const binaryData = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
            const ext = doc.name.split(".").pop() || "bin";
            const storagePath = `${tokenData.organization_id}/${candidateId}/${crypto.randomUUID()}.${ext}`;

            await onboardingResult(admin.storage.from("documents").upload(storagePath, binaryData, {
              contentType: doc.data.split(";")[0]?.split(":")[1] || "application/octet-stream",
            }), "Het document kon niet worden geüpload. Probeer het opnieuw.");

            await onboardingResult(admin.from("documents").insert({
              organization_id: tokenData.organization_id,
              candidate_id: candidateId,
              name: doc.name,
              type: doc.type, // id_bewijs, rijbewijs, certificaat
              file_path: storagePath,
              status: "geldig",
            }), "Het document kon niet worden opgeslagen. Probeer het opnieuw.");
          } catch (uploadErr) {
            throw new Error("Een document kon niet worden opgeslagen. Probeer het opnieuw.");
          }
        }
      }

      // Create reglement document if accepted
      if (documents_accepted) {
        await onboardingResult(admin.from("documents").insert({
          organization_id: tokenData.organization_id,
          candidate_id: candidateId,
          name: "Reglement akkoord",
          type: "reglement",
          status: "geldig",
        }), "Je akkoord kon niet worden opgeslagen. Probeer het opnieuw.");
      }

      // Consume the link only after every profile/document write succeeded.
      await onboardingResult(admin.from("candidates").update({
        onboarding_completed: true,
        onboarding_completed_at: new Date().toISOString(),
      }).eq("organization_id", tokenData.organization_id).eq("id", candidateId).select("id").single(),
      "De onboarding kon niet worden afgerond. Probeer het opnieuw.");
      await onboardingResult(admin.from("onboarding_tokens").update({ used_at: new Date().toISOString() })
        .eq("id", tokenData.id).select("id").single(), "De onboardinglink kon niet worden afgerond. Probeer het opnieuw.");

      return json({ success: true });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    console.error("onboarding-submit error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
