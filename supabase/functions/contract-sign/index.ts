import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // GET — fetch contract by sign_token
    if (req.method === "GET") {
      const url = new URL(req.url);
      const token = url.searchParams.get("token");

      if (!token) {
        return new Response(JSON.stringify({ error: "Token ontbreekt" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: contract, error } = await supabase
        .from("contracts")
        .select("id, title, content, status, signed_at")
        .eq("sign_token", token)
        .maybeSingle();

      if (error) {
        console.error("Contract fetch error:", error);
        return new Response(JSON.stringify({ error: "Server error" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!contract) {
        return new Response(JSON.stringify({ error: "Contract niet gevonden" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (contract.status === "getekend") {
        return new Response(
          JSON.stringify({ contract: { title: contract.title, status: contract.status, signed_at: contract.signed_at } }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ contract: { title: contract.title, content: contract.content, status: contract.status } }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // POST — sign the contract
    if (req.method === "POST") {
      const body = await req.json();
      const { token, full_name } = body;

      if (!token || !full_name?.trim()) {
        return new Response(JSON.stringify({ error: "Token en naam zijn verplicht" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: contract, error: fetchError } = await supabase
        .from("contracts")
        .select("id, status")
        .eq("sign_token", token)
        .maybeSingle();

      if (fetchError || !contract) {
        return new Response(JSON.stringify({ error: "Contract niet gevonden" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (contract.status === "getekend") {
        return new Response(
          JSON.stringify({ error: "Contract is al ondertekend", already_signed: true }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const clientIp =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        "onbekend";

      const signedAt = new Date().toISOString();
      const timestamp = new Date().toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam" });

      const { error: updateError } = await supabase
        .from("contracts")
        .update({
          status: "getekend",
          signed_at: signedAt,
          pdf_url: `Digitaal getekend door: ${full_name.trim()} op ${timestamp} | IP: ${clientIp}`,
        })
        .eq("sign_token", token);

      if (updateError) {
        console.error("Contract sign error:", updateError);
        return new Response(JSON.stringify({ error: "Ondertekenen mislukt" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.log(`Contract ${contract.id} signed by ${full_name.trim()} from ${clientIp}`);

      return new Response(
        JSON.stringify({ success: true, signed_at: signedAt }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  } catch (err) {
    console.error("Contract-sign error:", err);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
