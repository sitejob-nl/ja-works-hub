import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const KVK_BASE_URL = "https://api.kvk.nl/api/v1";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse request
    const body = await req.json();
    const { kvk_number, name } = body;

    if (!kvk_number && !name) {
      return new Response(JSON.stringify({ error: "kvk_number of name is vereist" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("KVK_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "KVK API key niet geconfigureerd" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build KVK API request
    let url: string;
    if (kvk_number) {
      // Direct lookup by KVK number — basisprofiel endpoint
      url = `${KVK_BASE_URL}/basisprofielen/${kvk_number}`;
    } else {
      // Search by name
      url = `${KVK_BASE_URL}/zoeken?naam=${encodeURIComponent(name!)}&pagina=1&resultatenPerPagina=10`;
    }

    const kvkRes = await fetch(url, {
      headers: {
        "apikey": apiKey,
        "Accept": "application/json",
      },
    });

    if (!kvkRes.ok) {
      const errText = await kvkRes.text();
      console.error("KVK API error:", kvkRes.status, errText);

      if (kvkRes.status === 404) {
        return new Response(JSON.stringify({ error: "Geen bedrijf gevonden met dit KVK-nummer" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "KVK API fout", details: errText }), {
        status: kvkRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const kvkData = await kvkRes.json();

    // Transform basisprofiel response to a normalized format
    if (kvk_number && kvkData) {
      const embedded = kvkData._embedded || {};
      const hoofdvestiging = embedded.hoofdvestiging || {};
      const adressen = hoofdvestiging.adressen || [];
      const bezoekadres = adressen.find((a: any) => a.type === "bezoekadres") || adressen[0] || {};
      const postadres = adressen.find((a: any) => a.type === "postadres");

      const result = {
        kvk_number: kvkData.kvkNummer,
        name: kvkData.naam,
        legal_form: kvkData.formeleRegistratiedatum ? undefined : undefined,
        sbi_codes: (hoofdvestiging.spiActiviteiten || []).map((s: any) => s.spiCode),
        sbi_descriptions: (hoofdvestiging.spiActiviteiten || []).map((s: any) => ({
          code: s.spiCode,
          description: s.spiOmschrijving,
        })),
        visit_address: {
          street: bezoekadres.straatnaam
            ? `${bezoekadres.straatnaam} ${bezoekadres.huisnummer || ""}${bezoekadres.huisletter || ""}${bezoekadres.huisnummerToevoeging ? `-${bezoekadres.huisnummerToevoeging}` : ""}`.trim()
            : null,
          postal: bezoekadres.postcode || null,
          city: bezoekadres.plaats || null,
          country: bezoekadres.land || "Nederland",
        },
        post_address: postadres
          ? {
              street: postadres.straatnaam
                ? `${postadres.straatnaam} ${postadres.huisnummer || ""}`.trim()
                : null,
              postal: postadres.postcode || null,
              city: postadres.plaats || null,
              country: postadres.land || "Nederland",
            }
          : null,
        total_employees: kvkData.totaalWerkzamePersonen,
        registration_date: kvkData.registratiedatum,
        raw: kvkData,
      };

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Return search results as-is
    return new Response(JSON.stringify(kvkData), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("KVK lookup error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
