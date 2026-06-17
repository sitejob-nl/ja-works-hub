import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type SignupLink = {
  id: string;
  organization_id: string;
  vacancy_id: string | null;
  slug: string;
  title: string;
  description: string | null;
  source_tag: string | null;
  is_active: boolean | null;
  expires_at: string | null;
  max_signups: number | null;
  current_signups: number | null;
  show_cv_upload: boolean | null;
  show_languages: boolean | null;
  show_nationality: boolean | null;
  show_drivers_license: boolean | null;
  show_availability: boolean | null;
  organizations?: {
    name: string;
    logo_url: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  vacancies?: {
    id: string;
    title: string | null;
    status: string | null;
    companies?: {
      name: string | null;
    } | null;
  } | null;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const normalizeEmail = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const cleanString = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim() : "";

const cleanIsoDate = (value: FormDataEntryValue | null) => {
  const text = cleanString(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
};

const cleanList = (value: FormDataEntryValue | null): string[] => {
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 25);
    }
  } catch {
    // Comma/semicolon/newline input is also accepted.
  }

  return trimmed
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 25);
};

const cleanFileName = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "cv.pdf";

const publicLinkState = (link: SignupLink | null) => {
  if (!link || link.is_active === false) return "not_found";
  if (link.expires_at && new Date(link.expires_at) < new Date()) return "expired";
  if (
    typeof link.max_signups === "number" &&
    link.max_signups > 0 &&
    (link.current_signups ?? 0) >= link.max_signups
  ) {
    return "full";
  }
  return "valid";
};

const getSignupLink = async (slug: string) => {
  const { data, error } = await admin
    .from("candidate_signup_links")
    .select("*, organizations(name, logo_url, email, phone), vacancies!candidate_signup_links_vacancy_id_fkey(id, title, status, companies!vacancies_company_id_fkey(name))")
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;
  return data as SignupLink | null;
};

const publicPayload = (link: SignupLink, skills: string[] = []) => ({
  valid: true,
  link: {
    slug: link.slug,
    title: link.title,
    description: link.description,
    source_tag: link.source_tag,
    show_cv_upload: link.show_cv_upload !== false,
    show_languages: link.show_languages !== false,
    show_nationality: link.show_nationality !== false,
    show_drivers_license: link.show_drivers_license !== false,
    show_availability: link.show_availability !== false,
  },
  // Actieve org-skillcatalogus zodat de publieke pagina een dropdown kan tonen
  // (skills is niet anon-leesbaar via RLS, daarom hier via service-role meegegeven).
  skills,
  organization: {
    name: link.organizations?.name ?? "",
    logo_url: link.organizations?.logo_url ?? null,
    email: link.organizations?.email ?? null,
    phone: link.organizations?.phone ?? null,
  },
  vacancy: link.vacancy_id
    ? {
        id: link.vacancy_id,
        title: link.vacancies?.title ?? "Vacature",
        company_name: link.vacancies?.companies?.name ?? null,
        status: link.vacancies?.status ?? null,
      }
    : null,
});

const errorPayload = (reason: string, status = 400) =>
  json({ valid: false, reason, error: reason }, status);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const slug = url.searchParams.get("slug")?.trim();
      if (!slug) return errorPayload("missing_slug");

      const link = await getSignupLink(slug);
      const state = publicLinkState(link);
      if (state !== "valid" || !link) {
        return json({ valid: false, reason: state }, state === "not_found" ? 404 : 400);
      }

      const { data: skillRows } = await admin
        .from("skills")
        .select("name")
        .eq("organization_id", link.organization_id)
        .eq("is_active", true)
        .order("name");
      const skills = (skillRows ?? []).map((r) => r.name as string).filter(Boolean);

      return json(publicPayload(link, skills));
    }

    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    const form = await req.formData();
    const slug = cleanString(form.get("slug"));
    if (!slug) return errorPayload("missing_slug");

    const link = await getSignupLink(slug);
    const state = publicLinkState(link);
    if (state !== "valid" || !link) {
      return json({ valid: false, reason: state }, state === "not_found" ? 404 : 400);
    }

    const firstName = cleanString(form.get("first_name"));
    const lastName = cleanString(form.get("last_name"));
    const email = normalizeEmail(form.get("email"));
    const phone = cleanString(form.get("phone")) || null;
    const nationality = cleanString(form.get("nationality")) || null;
    const availableFrom = cleanIsoDate(form.get("available_from"));
    const availableUntil = cleanIsoDate(form.get("available_until"));
    const arrivalDate = cleanIsoDate(form.get("arrival_date"));
    const availabilityNotes = cleanString(form.get("availability_notes")) || null;
    const cvText = cleanString(form.get("cv_text"));
    const hasDriversLicense = cleanString(form.get("has_drivers_license")) === "true";
    const languages = cleanList(form.get("languages"));
    const skills = cleanList(form.get("skills"));
    const certifications = cleanList(form.get("certifications"));
    const cv = form.get("cv");

    if (!firstName || !lastName || !email) {
      return errorPayload("missing_required_fields");
    }
    if (!(cv instanceof File) || cv.size === 0) {
      return errorPayload("missing_cv");
    }
    if (cv.size > 15 * 1024 * 1024) {
      return errorPayload("cv_too_large");
    }

    const candidatePayload = {
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      nationality,
      available_from: availableFrom,
      available_until: availableUntil,
      arrival_date: arrivalDate,
      availability_notes: availabilityNotes,
      has_drivers_license: hasDriversLicense,
      languages: languages.length ? languages : null,
      skills: skills.length ? skills : null,
      certifications: certifications.length ? certifications : null,
      source: link.source_tag ?? "public_signup",
      signup_link_id: link.id,
      organization_id: link.organization_id,
      compliance_status: "incompleet",
      ai_status: "idle",
      ai_summary: cvText.length >= 50
        ? "Publieke intake ontvangen; CV-tekst is beschikbaar voor recruiterreview."
        : "Publieke intake ontvangen; CV is geupload en wacht op review.",
      cv_raw_text: cvText.length >= 50 ? cvText.slice(0, 200000) : null,
      status: "lead",
    };

    const { data: existingCandidate, error: existingErr } = await admin
      .from("candidates")
      .select("id, status, cv_file_url")
      .eq("organization_id", link.organization_id)
      .eq("email", email)
      .maybeSingle();

    if (existingErr) throw existingErr;

    let candidateId = existingCandidate?.id as string | undefined;
    const isNewCandidate = !candidateId;

    if (candidateId) {
      const keepStatus = existingCandidate?.status &&
        !["lead", "nieuw", "in_behandeling"].includes(existingCandidate.status);
      const { error: updateErr } = await admin
        .from("candidates")
        .update({
          first_name: firstName,
          last_name: lastName,
          phone,
          nationality,
          available_from: availableFrom,
          available_until: availableUntil,
          arrival_date: arrivalDate,
          availability_notes: availabilityNotes,
          has_drivers_license: hasDriversLicense,
          languages: languages.length ? languages : null,
          skills: skills.length ? skills : null,
          certifications: certifications.length ? certifications : null,
          source: link.source_tag ?? "public_signup",
          signup_link_id: link.id,
          ai_status: candidatePayload.ai_status,
          ai_summary: candidatePayload.ai_summary,
          cv_raw_text: candidatePayload.cv_raw_text,
          status: keepStatus ? existingCandidate.status : "lead",
        })
        .eq("id", candidateId);
      if (updateErr) throw updateErr;
    } else {
      const { data: inserted, error: insertErr } = await admin
        .from("candidates")
        .insert(candidatePayload)
        .select("id")
        .single();
      if (insertErr) throw insertErr;
      candidateId = inserted.id;
    }

    const storagePath = `${link.organization_id}/candidate-signups/${candidateId}/${crypto.randomUUID()}-${cleanFileName(cv.name)}`;
    const { error: uploadErr } = await admin.storage
      .from("documents")
      .upload(storagePath, cv, {
        contentType: cv.type || "application/pdf",
        upsert: false,
      });

    if (uploadErr) throw uploadErr;

    const { error: documentErr } = await admin.from("documents").insert({
      candidate_id: candidateId,
      organization_id: link.organization_id,
      type: "cv",
      name: cv.name || "CV publieke aanmelding",
      file_path: storagePath,
      status: "geldig",
      source: "public_signup",
      notes: `Publieke intake via ${link.title}`,
    });

    if (documentErr) throw documentErr;

    await admin
      .from("candidates")
      .update({ cv_file_url: storagePath })
      .eq("id", candidateId);

    if (isNewCandidate) {
      await admin
        .from("candidate_signup_links")
        .update({ current_signups: (link.current_signups ?? 0) + 1 })
        .eq("id", link.id);
    }

    const vacancyTitle = link.vacancies?.title?.trim() || null;
    const vacancyCompany = link.vacancies?.companies?.name?.trim() || null;
    const vacancyLabel = vacancyTitle
      ? `${vacancyTitle}${vacancyCompany ? ` bij ${vacancyCompany}` : ""}`
      : null;

    let matchId: string | null = null;
    if (link.vacancy_id) {
      const { data: existingMatch, error: existingMatchErr } = await admin
        .from("matches")
        .select("id")
        .eq("organization_id", link.organization_id)
        .eq("vacancy_id", link.vacancy_id)
        .eq("candidate_id", candidateId)
        .maybeSingle();
      if (existingMatchErr) throw existingMatchErr;

      if (existingMatch?.id) {
        matchId = existingMatch.id;
      } else {
        const { data: insertedMatch, error: matchErr } = await admin
          .from("matches")
          .insert({
            organization_id: link.organization_id,
            vacancy_id: link.vacancy_id,
            candidate_id: candidateId,
            status: "nieuwe_match",
            source: "website_sollicitatie",
            notes: `Website-sollicitatie via ${link.title}${vacancyLabel ? ` voor ${vacancyLabel}` : ""}.`,
          })
          .select("id")
          .single();
        if (matchErr) throw matchErr;
        matchId = insertedMatch.id;
      }
    }

    const detailLines = [
      `Bron: ${link.title}${link.source_tag ? ` (${link.source_tag})` : ""}`,
      vacancyLabel ? `Vacature: ${vacancyLabel}` : null,
      `Naam: ${firstName} ${lastName}`,
      `E-mail: ${email}`,
      phone ? `Telefoon: ${phone}` : null,
      skills.length ? `Skills: ${skills.join(", ")}` : null,
      certifications.length ? `Certificaten: ${certifications.join(", ")}` : null,
      availableFrom ? `Beschikbaar vanaf: ${availableFrom}` : null,
      availableUntil ? `Beschikbaar tot: ${availableUntil}` : null,
      arrivalDate ? `Aankomst/check-in: ${arrivalDate}` : null,
      availabilityNotes ? `Beschikbaarheidsnotities: ${availabilityNotes}` : null,
      "CV is verplicht ontvangen en staat klaar voor review.",
    ].filter(Boolean).join("\n");

    await admin.from("recruiter_tasks").insert({
      organization_id: link.organization_id,
      title: link.vacancy_id
        ? `Nieuwe vacature-sollicitatie: ${firstName} ${lastName}`
        : `Nieuwe kandidaatlead: ${firstName} ${lastName}`,
      description: detailLines,
      priority: "high",
      status: "open",
      category: link.vacancy_id ? "vacature sollicitatie" : "lead intake",
      related_entity_type: "kandidaat",
      related_entity_id: candidateId,
      ai_generated: true,
      ai_reasoning: link.vacancy_id
        ? "Aangemaakt vanuit publieke vacature-sollicitatie: recruiter moet CV beoordelen, match opvolgen en kandidaatstatus bewaken."
        : "Aangemaakt vanuit publieke 05-14 intakefunnel: recruiter moet CV beoordelen, ontbrekende data aanvullen en lead eventueel promoveren naar kandidaat.",
    });

    const { error: notificationErr } = await admin.from("employee_notifications").insert({
      organization_id: link.organization_id,
      candidate_id: candidateId,
      type: "overig",
      severity: "urgent",
      title: link.vacancy_id
        ? `Nieuwe vacature-sollicitatie: ${firstName} ${lastName}`
        : `Nieuwe kandidaatlead: ${firstName} ${lastName}`,
      message: link.vacancy_id
        ? `${email} heeft gesolliciteerd${vacancyLabel ? ` op ${vacancyLabel}` : ""}. CV is ontvangen en er staat een match klaar.`
        : `${email} heeft zich aangemeld via ${link.title}. CV is ontvangen en wacht op recruiterreview.`,
      reference_table: matchId ? "matches" : "candidates",
      reference_id: matchId ?? candidateId,
    });
    if (notificationErr) throw notificationErr;

    return json({ success: true, candidate_id: candidateId, match_id: matchId });
  } catch (err) {
    console.error("candidate-signup error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
