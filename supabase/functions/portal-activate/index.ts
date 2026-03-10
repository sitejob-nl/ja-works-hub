import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

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
    const { token, user_id, password, language } = await req.json();

    if (!token || !password) {
      return new Response(
        JSON.stringify({ error: "Token en wachtwoord zijn verplicht" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Validate token
    const { data: invite, error: inviteErr } = await supabaseAdmin
      .from("portal_invites")
      .select("*, employees!portal_invites_employee_id_fkey(id, candidate_id, organization_id, candidates!employees_candidate_id_fkey(first_name, last_name, email))")
      .eq("token", token)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (inviteErr || !invite) {
      return new Response(
        JSON.stringify({ error: "Ongeldige of verlopen uitnodiging" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const employee = invite.employees;
    const candidate = employee.candidates;
    const fullName = `${candidate.first_name} ${candidate.last_name}`;

    // 2. Create auth user
    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: invite.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (authErr) {
      // If user already exists, try to find them
      if (authErr.message?.includes("already been registered")) {
        return new Response(
          JSON.stringify({ error: "Er bestaat al een account met dit e-mailadres. Probeer in te loggen." }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw authErr;
    }

    const newUserId = authData.user.id;

    // 3. Insert profile
    const { error: profileErr } = await supabaseAdmin
      .from("profiles")
      .insert({
        id: newUserId,
        organization_id: employee.organization_id,
        email: invite.email,
        full_name: fullName,
        role: "medewerker",
      });

    if (profileErr) throw profileErr;

    // 4. Update employee
    const { error: empErr } = await supabaseAdmin
      .from("employees")
      .update({
        auth_user_id: newUserId,
        portal_activated_at: new Date().toISOString(),
        portal_language: language || "nl",
      })
      .eq("id", employee.id);

    if (empErr) throw empErr;

    // 5. Mark invite as used
    const { error: usedErr } = await supabaseAdmin
      .from("portal_invites")
      .update({ used_at: new Date().toISOString() })
      .eq("id", invite.id);

    if (usedErr) throw usedErr;

    return new Response(
      JSON.stringify({ success: true, user_id: newUserId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("portal-activate error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Er ging iets mis" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
