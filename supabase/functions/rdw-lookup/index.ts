import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// RDW Open Data API (gratis, geen API key nodig)
const RDW_VEHICLE_URL = "https://opendata.rdw.nl/resource/m9d7-ebf2.json";
const RDW_FUEL_URL = "https://opendata.rdw.nl/resource/8ys7-d773.json";

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

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { license_plate } = body;

    if (!license_plate) {
      return new Response(JSON.stringify({ error: "license_plate is vereist" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Normalize plate: remove dashes/spaces, uppercase
    const plate = license_plate.replace(/[-\s]/g, "").toUpperCase();

    // Fetch vehicle data and fuel data in parallel
    const [vehicleRes, fuelRes] = await Promise.all([
      fetch(`${RDW_VEHICLE_URL}?kenteken=${plate}`),
      fetch(`${RDW_FUEL_URL}?kenteken=${plate}`),
    ]);

    if (!vehicleRes.ok) {
      return new Response(JSON.stringify({ error: "RDW API fout" }), {
        status: vehicleRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const vehicles = await vehicleRes.json();
    const fuels = fuelRes.ok ? await fuelRes.json() : [];

    if (!vehicles.length) {
      return new Response(JSON.stringify({ error: "Geen voertuig gevonden met dit kenteken" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const v = vehicles[0];
    const fuel = fuels[0] || {};

    const result = {
      license_plate: v.kenteken,
      brand: v.merk,
      model: v.handelsbenaming,
      color: v.eerste_kleur,
      body_type: v.inrichting,
      fuel_type: fuel.brandstof_omschrijving || null,
      engine_capacity: v.cilinderinhoud ? parseInt(v.cilinderinhoud) : null,
      power_kw: v.vermogen_massarijklaar ? parseInt(v.vermogen_massarijklaar) : null,
      weight: v.massa_ledig_voertuig ? parseInt(v.massa_ledig_voertuig) : null,
      max_weight: v.toegestane_maximum_massa_voertuig ? parseInt(v.toegestane_maximum_massa_voertuig) : null,
      seats: v.aantal_zitplaatsen ? parseInt(v.aantal_zitplaatsen) : null,
      doors: v.aantal_deuren ? parseInt(v.aantal_deuren) : null,
      first_registration: v.datum_eerste_toelating || null,
      first_registration_nl: v.datum_eerste_tenaamstelling_in_nederland || null,
      apk_expiry: v.vervaldatum_apk || null,
      insurance_expiry: v.vervaldatum_apk_dt || null,
      emission_class: v.zuinigheidsclassificatie || null,
      co2_emission: fuel.co2_uitstoot_gecombineerd ? parseInt(fuel.co2_uitstoot_gecombineerd) : null,
      fuel_consumption: fuel.brandstofverbruik_gecombineerd ? parseFloat(fuel.brandstofverbruik_gecombineerd) : null,
      status: v.tenaamstellen_mogelijk === "Ja" ? "actief" : "niet-actief",
      exported: v.export_indicator === "Ja",
      stolen: v.gestolen_indicator === "Ja",
      wam_insured: v.wam_verzekerd === "Ja",
      raw: v,
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("RDW lookup error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
