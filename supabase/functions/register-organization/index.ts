import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { CORS_HEADERS as corsHeaders } from "../_shared/http.ts";
import { assertPasswordAcceptable } from "../_shared/password-policy.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PER_IP_PER_HOUR = 5;
const MAX_GLOBAL_PER_HOUR = 30;

async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  return xff.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

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

    // Basis-inputvalidatie (publiek, ongeauthenticeerd endpoint).
    if (
      typeof email !== "string" || !EMAIL_RE.test(email.trim()) ||
      typeof password !== "string" || password.length < 8 ||
      typeof company_name !== "string" || company_name.trim().length < 2 || company_name.length > 100
    ) {
      return new Response(
        JSON.stringify({ error: "Ongeldige invoer: controleer e-mail, wachtwoord (min. 8 tekens) en bedrijfsnaam." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // admin.createUser bypasses the GoTrue password policy -> enforce complexity + leaked here.
    const pwError = await assertPasswordAcceptable(password, "nl");
    if (pwError) {
      return new Response(
        JSON.stringify({ error: pwError }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Rate-limiting: stopt scriptmatige massa-registratie (DB-bloat + misbruik van
    // het per-org geseedde AI-credit op de gedeelde provider-key). IP wordt gehasht.
    const ipHash = await hashIp(clientIp(req));
    const since = new Date(Date.now() - 3600_000).toISOString();
    const [{ count: ipCount }, { count: globalCount }] = await Promise.all([
      supabaseAdmin.from("registration_attempts").select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash).gte("created_at", since),
      supabaseAdmin.from("registration_attempts").select("id", { count: "exact", head: true })
        .gte("created_at", since),
    ]);
    if ((ipCount ?? 0) >= MAX_PER_IP_PER_HOUR || (globalCount ?? 0) >= MAX_GLOBAL_PER_HOUR) {
      return new Response(
        JSON.stringify({ error: "Te veel registratiepogingen. Probeer het later opnieuw." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const { data: attemptRow } = await supabaseAdmin
      .from("registration_attempts")
      .insert({ ip_hash: ipHash, email: String(email).slice(0, 200) })
      .select("id")
      .single();

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

    if (attemptRow?.id) {
      await supabaseAdmin.from("registration_attempts").update({ succeeded: true }).eq("id", attemptRow.id);
    }

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
