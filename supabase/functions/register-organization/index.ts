import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { company_name, full_name, email, password, phone } = await req.json();

    if (!company_name || !full_name || !email || !password) {
      return new Response(JSON.stringify({ error: "Alle verplichte velden moeten ingevuld zijn" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Generate slug from company name
    const slug = company_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .substring(0, 50);

    // Check if slug already exists
    const { data: existingOrg } = await supabaseAdmin
      .from("organizations")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    const finalSlug = existingOrg ? `${slug}-${Date.now().toString(36)}` : slug;

    // 1. Create organization
    const { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .insert({
        name: company_name,
        slug: finalSlug,
        email: email,
        phone: phone,
        is_active: true,
      })
      .select()
      .single();

    if (orgError) {
      console.error("Org create error:", orgError);
      return new Response(JSON.stringify({ error: "Kon organisatie niet aanmaken" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Create auth user
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) {
      // Rollback org
      await supabaseAdmin.from("organizations").delete().eq("id", org.id);
      console.error("Auth create error:", authError);
      const msg = authError.message.includes("already been registered")
        ? "Dit e-mailadres is al geregistreerd"
        : "Kon account niet aanmaken";
      return new Response(JSON.stringify({ error: msg }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Create profile
    const { error: profileError } = await supabaseAdmin.from("profiles").insert({
      id: authUser.user.id,
      email,
      full_name: full_name,
      role: "admin",
      organization_id: org.id,
      is_active: true,
      phone: phone,
    });

    if (profileError) {
      console.error("Profile create error:", profileError);
    }

    // 4. Seed ALL modules
    const defaultModules = [
      "workbench", "opdrachtgevers", "kandidaten", "medewerkers",
      "vacatures", "planning", "uren", "huisvesting", "transport",
      "tankpas-analyse", "communicatie", "whatsapp", "bulk-campaigns",
      "kennisbank", "vacaturebank", "kandidaten-zoeken", "exact-online",
      "importeren", "cv-tool", "ai-analyse", "ai-matching", "ai-prioriteiten",
    ];

    await supabaseAdmin.from("organization_modules").insert(
      defaultModules.map((m) => ({
        organization_id: org.id,
        module_name: m,
        enabled: true,
      }))
    );

    return new Response(
      JSON.stringify({ success: true, organization_id: org.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Register error:", err);
    return new Response(JSON.stringify({ error: "Interne fout" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
