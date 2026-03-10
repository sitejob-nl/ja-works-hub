import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // GET: validate token and return candidate data
    if (req.method === "GET") {
      const url = new URL(req.url);
      const token = url.searchParams.get("token");
      if (!token) {
        return new Response(
          JSON.stringify({ error: "Token ontbreekt" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: tokenRow, error: tokenErr } = await supabase
        .from("candidate_profile_tokens")
        .select("*, candidates(*), organizations:organization_id(name)")
        .eq("token", token)
        .maybeSingle();

      if (tokenErr || !tokenRow) {
        return new Response(
          JSON.stringify({ status: "invalid" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check if already used
      if (tokenRow.used_at) {
        return new Response(
          JSON.stringify({
            status: "used",
            first_name: tokenRow.candidates?.first_name,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check expiry
      if (new Date(tokenRow.expires_at) < new Date()) {
        return new Response(
          JSON.stringify({ status: "expired" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Update last_accessed_at
      await supabase
        .from("candidate_profile_tokens")
        .update({ last_accessed_at: new Date().toISOString() })
        .eq("id", tokenRow.id);

      const candidate = tokenRow.candidates;
      return new Response(
        JSON.stringify({
          status: "valid",
          organization_name: (tokenRow as any).organizations?.name ?? "",
          candidate_id: tokenRow.candidate_id,
          organization_id: tokenRow.organization_id,
          candidate: {
            first_name: candidate?.first_name,
            last_name: candidate?.last_name,
            phone: candidate?.phone,
            email: candidate?.email,
            date_of_birth: candidate?.date_of_birth,
            nationality: candidate?.nationality,
            languages: candidate?.languages,
            address_street: candidate?.address_street,
            address_postal: candidate?.address_postal,
            address_city: candidate?.address_city,
            address_country: candidate?.address_country,
            skills: candidate?.skills,
            certifications: candidate?.certifications,
            has_drivers_license: candidate?.has_drivers_license,
            drivers_license_expiry: candidate?.drivers_license_expiry,
            availability_notes: candidate?.availability_notes,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // POST: submit profile data
    if (req.method === "POST") {
      const body = await req.json();
      const { token, profile, cv_file_url, photo_file_url } = body;

      if (!token || !profile) {
        return new Response(
          JSON.stringify({ error: "Ongeldige data" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate token
      const { data: tokenRow, error: tokenErr } = await supabase
        .from("candidate_profile_tokens")
        .select("*")
        .eq("token", token)
        .maybeSingle();

      if (tokenErr || !tokenRow || tokenRow.used_at || new Date(tokenRow.expires_at) < new Date()) {
        return new Response(
          JSON.stringify({ error: "Token ongeldig of verlopen" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Update candidate
      const candidateUpdate: Record<string, unknown> = {};
      const fields = [
        "phone", "email", "date_of_birth", "nationality", "languages",
        "address_street", "address_postal", "address_city", "address_country",
        "skills", "certifications", "has_drivers_license", "drivers_license_expiry",
        "availability_notes",
      ];

      for (const f of fields) {
        if (profile[f] !== undefined) {
          candidateUpdate[f] = profile[f] === "" ? null : profile[f];
        }
      }

      if (cv_file_url) {
        candidateUpdate.cv_file_url = cv_file_url;
      }

      const { error: updateErr } = await supabase
        .from("candidates")
        .update(candidateUpdate)
        .eq("id", tokenRow.candidate_id);

      if (updateErr) {
        return new Response(
          JSON.stringify({ error: updateErr.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // If CV was uploaded, create document record
      if (cv_file_url) {
        await supabase.from("documents").insert({
          candidate_id: tokenRow.candidate_id,
          organization_id: tokenRow.organization_id,
          name: "CV (zelf geüpload)",
          type: "cv",
          file_path: cv_file_url,
          status: "geldig",
        });
      }

      // Mark token as used
      await supabase
        .from("candidate_profile_tokens")
        .update({ used_at: new Date().toISOString() })
        .eq("id", tokenRow.id);

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
