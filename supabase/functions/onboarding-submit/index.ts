import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { token, personal_data, documents_accepted } = await req.json();
    if (!token) {
      return new Response(JSON.stringify({ error: "Token required" }), { status: 400, headers: corsHeaders });
    }

    // Validate token
    const { data: tokenData, error: tErr } = await admin
      .from("onboarding_tokens")
      .select("id, employee_id, organization_id, expires_at, used_at")
      .eq("token", token)
      .maybeSingle();

    if (tErr || !tokenData) {
      return new Response(JSON.stringify({ error: "Ongeldige link" }), { status: 404, headers: corsHeaders });
    }
    if (tokenData.used_at) {
      return new Response(JSON.stringify({ error: "Deze link is al gebruikt" }), { status: 400, headers: corsHeaders });
    }
    if (new Date(tokenData.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: "Deze link is verlopen" }), { status: 400, headers: corsHeaders });
    }

    // Get employee + candidate
    const { data: employee, error: eErr } = await admin
      .from("employees")
      .select("id, candidate_id")
      .eq("id", tokenData.employee_id)
      .single();
    if (eErr || !employee) {
      return new Response(JSON.stringify({ error: "Medewerker niet gevonden" }), { status: 404, headers: corsHeaders });
    }

    // Update candidate personal data
    if (personal_data) {
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

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("onboarding-submit error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
