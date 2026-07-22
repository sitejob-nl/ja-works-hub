import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { assertPasswordAcceptable } from "../_shared/password-policy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Portaaltalen; alles daarbuiten valt terug op Nederlands. */
const PORTAL_LANGUAGES = ["nl", "en"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { token, password, language: rawLanguage, action } = await req.json();
    const language = PORTAL_LANGUAGES.includes(rawLanguage) ? rawLanguage : "nl";

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

    // admin.createUser bypasses the GoTrue password policy, so enforce it here.
    const pwError = await assertPasswordAcceptable(password, language === "nl" ? "nl" : "en");
    if (pwError) {
      return new Response(
        JSON.stringify({ error: pwError }),
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

    // 3. Profiel, kandidaatkoppeling, employees-spiegel en het afstempelen van de uitnodiging
    // gebeuren in één transactie. Deden we dat los, dan kon een fout halverwege een half
    // account achterlaten: inloggen lukt, portaal blijft leeg, uitnodiging blijft ongebruikt
    // en een tweede poging strandt op 409.
    const { error: activateErr } = await supabaseAdmin.rpc("activate_portal_account", {
      p_token: token,
      p_user_id: newUserId,
      p_language: language,
    });

    if (activateErr) {
      // De auth-gebruiker valt buiten de transactie, dus die draaien we hier zelf terug.
      // Zonder deze compensatie blokkeert het zojuist aangemaakte account elke nieuwe poging
      // met "e-mailadres bestaat al", terwijl er geen bruikbaar profiel bij hoort.
      const { error: cleanupErr } = await supabaseAdmin.auth.admin.deleteUser(newUserId);
      if (cleanupErr) {
        console.error("portal-activate: opruimen auth-gebruiker mislukt", newUserId, cleanupErr);
      }
      throw activateErr;
    }

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
