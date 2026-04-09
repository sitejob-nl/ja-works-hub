import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mapJobToRow } from "../_shared/map-job-to-row.ts";

const ACTOR_URLS: Record<string, string> = {
  career_site: "fantastic-jobs~career-site-job-listing-feed",
  linkedin: "fantastic-jobs~advanced-linkedin-job-search-api",
};

const SCHEDULE_TIME_RANGE: Record<string, string> = {
  hourly: "1h",
  daily: "24h",
  weekly: "7d",
};

const SCHEDULE_INTERVALS_MS: Record<string, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

Deno.serve(async (req) => {
  // Only POST allowed
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Auth via shared secret (no JWT — called by pg_cron)
  const secret = req.headers.get("x-webhook-secret");
  const expectedSecret = Deno.env.get("JOB_FEED_SECRET");
  if (!expectedSecret || secret !== expectedSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const apifyToken = Deno.env.get("APIFY_API_KEY");

  if (!apifyToken) {
    return new Response(JSON.stringify({ error: "APIFY_API_KEY not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  // Get all active feed configs
  const { data: configs, error: configError } = await adminClient
    .from("job_feed_configs")
    .select("*")
    .eq("is_active", true);

  if (configError) {
    console.error("Error fetching configs:", configError);
    return new Response(JSON.stringify({ error: configError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!configs || configs.length === 0) {
    return new Response(JSON.stringify({ message: "No active feeds" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const now = Date.now();
  const results: Array<{ id: string; name: string; status: string; jobs: number }> = [];

  for (const config of configs) {
    // Check if it's time to run based on schedule
    const intervalMs = SCHEDULE_INTERVALS_MS[config.schedule] || SCHEDULE_INTERVALS_MS.daily;
    if (config.last_run_at) {
      const lastRun = new Date(config.last_run_at).getTime();
      if (now - lastRun < intervalMs * 0.9) {
        // Not due yet (0.9 factor for clock drift tolerance)
        continue;
      }
    }

    try {
      const actorName = ACTOR_URLS[config.source_type];
      if (!actorName) {
        console.error(`Unknown source_type: ${config.source_type}`);
        continue;
      }

      // Build input from stored filters_config
      const apifyInput: Record<string, unknown> = {
        ...(config.filters_config as Record<string, unknown>),
        descriptionType: "text",
      };

      // For career_site feeds, set timeRange based on schedule
      if (config.source_type === "career_site") {
        apifyInput.timeRange = SCHEDULE_TIME_RANGE[config.schedule] || "24h";
      }

      // Default limits
      if (!apifyInput.limit) apifyInput.limit = 500;
      if (apifyInput.includeAi === undefined) apifyInput.includeAi = true;
      if (apifyInput.includeLinkedIn === undefined) apifyInput.includeLinkedIn = true;

      const apifyUrl = `https://api.apify.com/v2/acts/${actorName}/run-sync-get-dataset-items?token=${apifyToken}`;

      const apifyResponse = await fetch(apifyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apifyInput),
      });

      if (!apifyResponse.ok) {
        const errText = await apifyResponse.text();
        console.error(`Apify error for feed ${config.name}:`, errText);

        await adminClient
          .from("job_feed_configs")
          .update({ last_run_at: new Date().toISOString(), last_run_status: "error" })
          .eq("id", config.id);

        results.push({ id: config.id, name: config.name, status: "error", jobs: 0 });
        continue;
      }

      const jobs = await apifyResponse.json();

      if (!Array.isArray(jobs)) {
        console.error(`Unexpected response for feed ${config.name}`);
        await adminClient
          .from("job_feed_configs")
          .update({ last_run_at: new Date().toISOString(), last_run_status: "error" })
          .eq("id", config.id);

        results.push({ id: config.id, name: config.name, status: "error", jobs: 0 });
        continue;
      }

      // Batch upsert
      let newCount = 0;
      for (let i = 0; i < jobs.length; i += 50) {
        const batch = jobs.slice(i, i + 50);
        const rows = batch.map((job: Record<string, unknown>, idx: number) =>
          mapJobToRow(job, config.organization_id, i + idx)
        );

        const { data: upserted, error: upsertError } = await adminClient
          .from("job_listings")
          .upsert(rows, {
            onConflict: "organization_id,external_id",
            ignoreDuplicates: false,
          })
          .select("id");

        if (upsertError) {
          console.error("Upsert error:", upsertError);
        } else {
          newCount += upserted?.length || 0;
        }
      }

      // Log import
      await adminClient.from("job_import_logs").insert({
        organization_id: config.organization_id,
        total_jobs: jobs.length,
        new_jobs: newCount,
        filters_used: { ...apifyInput, feed_id: config.id, feed_name: config.name },
        status: "completed",
      });

      // Update config
      await adminClient
        .from("job_feed_configs")
        .update({
          last_run_at: new Date().toISOString(),
          last_run_status: "completed",
          last_run_job_count: newCount,
        })
        .eq("id", config.id);

      results.push({ id: config.id, name: config.name, status: "completed", jobs: newCount });
    } catch (err) {
      console.error(`Error processing feed ${config.name}:`, err);

      await adminClient
        .from("job_feed_configs")
        .update({ last_run_at: new Date().toISOString(), last_run_status: "error" })
        .eq("id", config.id);

      results.push({ id: config.id, name: config.name, status: "error", jobs: 0 });
    }
  }

  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
