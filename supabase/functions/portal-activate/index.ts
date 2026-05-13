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
    const { token, password, language, action } = await req.json();

    if (!token) {
      return new Response(
        JSON.stringify({ error: "Token is verplicht" }),
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
      .select("*, candidates!portal_invites_candidate_id_fkey(id, first_name, last_name, email, organization_id)")
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

    const candidate = invite.candidates;
    if (!candidate) {
      return new Response(
        JSON.stringify({ error: "Kandidaat niet gevonden" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const fullName = `${candidate.first_name} ${candidate.last_name}`;

    if (action === "inspect") {
      return new Response(
        JSON.stringify({ success: true, email: invite.email, full_name: fullName }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!password) {
      return new Response(
        JSON.stringify({ error: "Wachtwoord is verplicht" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
        organization_id: candidate.organization_id,
        email: invite.email,
        full_name: fullName,
        role: "medewerker",
      });

    if (profileErr) throw profileErr;

    // 4. Update candidate with portal fields
    const { error: candErr } = await supabaseAdmin
      .from("candidates")
      .update({
        auth_user_id: newUserId,
        portal_enabled: true,
        portal_activated_at: new Date().toISOString(),
        portal_language: language || "nl",
      })
      .eq("id", candidate.id);

    if (candErr) throw candErr;

    // 5. Mirror auth link on the employee record. Portal RLS self-policies
    // use employees.auth_user_id, while older portal screens still read
    // candidate portal fields for backwards compatibility.
    const employeeUpdate = supabaseAdmin
      .from("employees")
      .update({
        auth_user_id: newUserId,
        portal_enabled: true,
        portal_activated_at: new Date().toISOString(),
        portal_language: language || "nl",
      });

    const { error: employeeErr } = invite.employee_id
      ? await employeeUpdate.eq("id", invite.employee_id)
      : await employeeUpdate.eq("candidate_id", candidate.id);

    if (employeeErr) throw employeeErr;

    // 6. Mark invite as used
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
      JSON.stringify({ error: (err as Error).message || "Er ging iets mis" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
