import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ─── GET: validate token & return candidate + org data ───
    if (req.method === "GET") {
      const url = new URL(req.url);
      const token = url.searchParams.get("token");
      if (!token) return json({ valid: false, reason: "no_token" }, 400);

      // Fetch token row with candidate and organization
      const { data: tokenRow, error: tokenErr } = await supabase
        .from("candidate_profile_tokens")
        .select("*, candidates(*)")
        .eq("token", token)
        .maybeSingle();

      if (tokenErr || !tokenRow) {
        return json({ valid: false, reason: "not_found" }, 404);
      }

      // Already used
      if (tokenRow.used_at) {
        return json({ valid: false, reason: "already_used" });
      }

      // Expired
      if (new Date(tokenRow.expires_at) < new Date()) {
        return json({ valid: false, reason: "expired" }, 404);
      }

      // Update last_accessed_at
      await supabase
        .from("candidate_profile_tokens")
        .update({ last_accessed_at: new Date().toISOString() })
        .eq("id", tokenRow.id);

      // Fetch organization
      const { data: org } = await supabase
        .from("organizations")
        .select("name, logo_url")
        .eq("id", tokenRow.organization_id)
        .single();

      const c = tokenRow.candidates;

      return json({
        valid: true,
        organization_id: tokenRow.organization_id,
        candidate: {
          id: c?.id,
          first_name: c?.first_name,
          last_name: c?.last_name,
          phone: c?.phone,
          phone_nl: c?.phone_nl,
          emergency_contact_name: c?.emergency_contact_name,
          emergency_contact_phone: c?.emergency_contact_phone,
          email: c?.email,
          date_of_birth: c?.date_of_birth,
          nationality: c?.nationality,
          languages: c?.languages,
          has_dutch_address: c?.has_dutch_address,
          address_street: c?.address_street,
          address_postal: c?.address_postal,
          address_city: c?.address_city,
          address_country: c?.address_country,
          address_lat: c?.address_lat,
          address_lng: c?.address_lng,
          skills: c?.skills,
          certifications: c?.certifications,
          has_drivers_license: c?.has_drivers_license,
          drivers_license_expiry: c?.drivers_license_expiry,
          available_from: c?.available_from,
          available_until: c?.available_until,
          arrival_date: c?.arrival_date,
          availability_notes: c?.availability_notes,
          cv_file_url: c?.cv_file_url,
        },
        organization: {
          name: org?.name ?? "",
          logo_url: org?.logo_url ?? null,
        },
      });
    }

    // ─── POST: save profile data ───
    if (req.method === "POST") {
      const body = await req.json();
      const { token, candidate_data, documents, cv_file, photo_file } = body;

      if (!token) return json({ error: "Token ontbreekt" }, 400);

      // Validate token
      const { data: tokenRow, error: tokenErr } = await supabase
        .from("candidate_profile_tokens")
        .select("*")
        .eq("token", token)
        .maybeSingle();

      if (tokenErr || !tokenRow) {
        return json({ error: "Token niet gevonden" }, 404);
      }
      if (tokenRow.used_at) {
        return json({ error: "Token is al gebruikt" }, 400);
      }
      if (new Date(tokenRow.expires_at) < new Date()) {
        return json({ error: "Token is verlopen" }, 400);
      }

      const candidateId = tokenRow.candidate_id;
      const organizationId = tokenRow.organization_id;

      // B-upload: upload CV/photo here with the service-role client. The public
      // page is anonymous, and the documents bucket INSERT policy is TO authenticated,
      // so a direct client upload silently fails and the file is lost. We accept the
      // file as base64 and write it server-side (with a size + extension guard).
      const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
      const ALLOWED_EXT = /\.(pdf|docx?|odt|rtf|txt|png|jpe?g|webp|heic)$/i;
      async function uploadProfileFile(
        file: { name?: string; data?: string } | null | undefined,
        prefix: string,
      ): Promise<string | null> {
        if (!file?.data || !file?.name || !ALLOWED_EXT.test(file.name)) return null;
        let bytes: Uint8Array;
        try {
          const bin = atob(file.data);
          bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        } catch {
          return null;
        }
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) return null;
        const ext = file.name.split(".").pop() ?? "bin";
        const path = `${organizationId}/candidates/${candidateId}/${prefix}_${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("documents").upload(path, bytes, { upsert: false });
        if (error) {
          console.error(`${prefix} upload failed:`, error.message);
          return null;
        }
        return path;
      }
      const cvPath = await uploadProfileFile(cv_file, "cv");
      const photoPath = await uploadProfileFile(photo_file, "photo");

      // Build update payload — COALESCE logic: only update non-empty values
      if (candidate_data && typeof candidate_data === "object") {
        const allowedFields = [
          "phone", "phone_nl", "emergency_contact_name", "emergency_contact_phone",
          "email", "date_of_birth", "nationality", "languages",
          "skills", "certifications", "has_dutch_address", "address_street", "address_postal",
          "address_city", "address_country", "address_lat", "address_lng", "has_drivers_license",
          "drivers_license_expiry", "available_from", "available_until", "arrival_date", "availability_notes",
          "cv_file_url", "profile_photo_url",
        ];

        const updatePayload: Record<string, unknown> = {};

        for (const field of allowedFields) {
          const value = candidate_data[field];
          // Skip undefined/null — don't overwrite existing data
          if (value === undefined || value === null) continue;
          // Skip empty strings — treat as "not filled in"
          if (typeof value === "string" && value.trim() === "") continue;
          // Skip empty arrays
          if (Array.isArray(value) && value.length === 0) continue;

          updatePayload[field] = value;
        }

        // Update status from 'nieuw' to 'in_behandeling'
        // Only if currently 'nieuw' to avoid overwriting more advanced statuses
        const { data: currentCandidate } = await supabase
          .from("candidates")
          .select("status")
          .eq("id", candidateId)
          .single();

        if (currentCandidate?.status === "nieuw") {
          updatePayload.status = "in_behandeling";
        }

        if (Object.keys(updatePayload).length > 0) {
          const { error: updateErr } = await supabase
            .from("candidates")
            .update(updatePayload)
            .eq("id", candidateId);

          if (updateErr) {
            return json({ error: updateErr.message }, 500);
          }
        }
      }

      // Persist uploaded file paths + register the CV as a document.
      const fileUpdate: Record<string, unknown> = {};
      if (cvPath) fileUpdate.cv_file_url = cvPath;
      if (photoPath) fileUpdate.profile_photo_url = photoPath;
      if (Object.keys(fileUpdate).length > 0) {
        await supabase.from("candidates").update(fileUpdate).eq("id", candidateId);
      }
      if (cvPath) {
        await supabase.from("documents").insert({
          candidate_id: candidateId,
          organization_id: organizationId,
          type: "cv",
          name: "CV (zelf geüpload)",
          file_path: cvPath,
          status: "geldig" as const,
        });
      }

      // Insert documents if provided
      if (Array.isArray(documents) && documents.length > 0) {
        const docRows = documents
          .filter((d: any) => d.file_path && d.name && d.type)
          .map((d: any) => ({
            candidate_id: candidateId,
            organization_id: organizationId,
            type: d.type,
            name: d.name,
            file_path: d.file_path,
            expiry_date: d.expiry_date || null,
            status: "geldig" as const,
          }));

        if (docRows.length > 0) {
          const { error: docErr } = await supabase
            .from("documents")
            .insert(docRows);

          if (docErr) {
            console.error("Document insert error:", docErr);
            // Don't fail the whole request for document errors
          }
        }
      }

      // Mark token as used
      await supabase
        .from("candidate_profile_tokens")
        .update({ used_at: new Date().toISOString() })
        .eq("id", tokenRow.id);

      return json({ success: true });
    }

    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  } catch (err) {
    console.error("candidate-profile error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
