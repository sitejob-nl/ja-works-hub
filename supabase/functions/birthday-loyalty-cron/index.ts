import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendViaOutlookAccount } from "../_shared/outlook-send.ts";
import { requireInternalProfile } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function amsterdamDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function amsterdamToday(): string {
  return amsterdamDate();
}

function amsterdamTime(): string {
  const parts = new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

function normalizeSendTime(value: string | null | undefined): string {
  const match = String(value ?? "07:00").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "07:00";
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function minutesSinceMidnight(value: string): number {
  const [hours, minutes] = normalizeSendTime(value).split(":").map((part) => Number(part));
  return (hours * 60) + minutes;
}

function cronWindowBirthdayDate(sendTime: string, nowTime: string, todayIso: string): string | null {
  const diff = minutesSinceMidnight(nowTime) - minutesSinceMidnight(sendTime);
  if (diff >= 0 && diff < 60) return todayIso;

  const wrappedDiff = minutesSinceMidnight(nowTime) + 1440 - minutesSinceMidnight(sendTime);
  if (wrappedDiff >= 0 && wrappedDiff < 60) {
    return amsterdamDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
  }

  return null;
}

function isAuthorizedCronRequest(req: Request): boolean {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const provided = req.headers.get("x-cron-secret");
  return Boolean(cronSecret && provided && provided === cronSecret);
}

function birthdayMatches(dateOfBirth: string | null, todayIso: string): boolean {
  if (!dateOfBirth) return false;
  return dateOfBirth.slice(5, 10) === todayIso.slice(5, 10);
}

function ageOnBirthday(dateOfBirth: string, todayIso: string): number {
  return Number(todayIso.slice(0, 4)) - Number(dateOfBirth.slice(0, 4));
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function mergeText(input: string, vars: Record<string, string>) {
  return Object.entries(vars).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, value), input);
}

function defaultBirthdayHtml(message: string) {
  return `<!doctype html><html lang="nl"><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
      <tr><td style="padding:24px 28px;background:#0f172a;color:#fff;"><h1 style="margin:0;font-size:20px;">Gefeliciteerd!</h1></td></tr>
      <tr><td style="padding:28px;color:#334155;font-size:15px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(message)}</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

async function resolveOrgIds(req: Request, admin: any): Promise<string[] | Response> {
  if (isAuthorizedCronRequest(req)) {
    const { data, error } = await admin.from("organizations").select("id").eq("is_active", true);
    if (error) return json({ error: error.message }, 500);
    return (data ?? []).map((org: any) => org.id);
  }

  const auth = await requireInternalProfile(req, corsHeaders);
  if (auth instanceof Response) return auth;
  return [auth.organizationId];
}

async function awardBirthdayPoints(admin: any, orgId: string, candidate: any, points: number, todayIso: string) {
  if (points <= 0) return null;
  const { data: account, error: accountError } = await admin
    .from("loyalty_accounts")
    .upsert({ organization_id: orgId, candidate_id: candidate.id }, { onConflict: "organization_id,candidate_id" })
    .select("id, balance_points, lifetime_earned_points")
    .single();
  if (accountError) throw accountError;

  const sourceRef = `birthday:${todayIso}`;
  const { data: tx, error: txError } = await admin
    .from("loyalty_transactions")
    .insert({
      organization_id: orgId,
      account_id: account.id,
      candidate_id: candidate.id,
      points,
      source: "birthday_bonus",
      source_ref: sourceRef,
      description: `Verjaardagsbonus ${todayIso}`,
      metadata: { birthday_date: todayIso },
    })
    .select("id")
    .single();

  if (txError) {
    if (txError.code === "23505") return null;
    throw txError;
  }

  const { error: updateError } = await admin
    .from("loyalty_accounts")
    .update({
      balance_points: Number(account.balance_points ?? 0) + points,
      lifetime_earned_points: Number(account.lifetime_earned_points ?? 0) + points,
      updated_at: new Date().toISOString(),
    })
    .eq("id", account.id);
  if (updateError) throw updateError;

  return tx.id as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const orgIds = await resolveOrgIds(req, admin);
    if (orgIds instanceof Response) return orgIds;

    const todayIso = amsterdamToday();
    const nowTime = amsterdamTime();
    const isCronRun = isAuthorizedCronRequest(req);
    const results: any[] = [];

    for (const orgId of orgIds) {
      const { data: org } = await admin
        .from("organizations")
        .select("id, name, settings")
        .eq("id", orgId)
        .maybeSingle();
      if (!org) continue;

      const settings = org.settings?.engagement_settings ?? {};
      if (settings.birthday_enabled === false) {
        results.push({ org_id: orgId, status: "skipped", reason: "birthday_disabled" });
        continue;
      }
      const sendTime = normalizeSendTime(settings.birthday_send_time);
      const birthdayDate = isCronRun ? cronWindowBirthdayDate(sendTime, nowTime, todayIso) : todayIso;
      if (!birthdayDate) {
        results.push({ org_id: orgId, status: "skipped", reason: "outside_send_time", send_time: sendTime, now_time: nowTime });
        continue;
      }

      const bonusPoints = Number(settings.birthday_bonus_points ?? 120);
      const emailEnabled = settings.birthday_email_enabled !== false;
      const pushEnabled = settings.birthday_push_enabled !== false;

      const { data: template } = settings.birthday_email_template_id
        ? await admin
          .from("email_templates")
          .select("id, subject, body_html")
          .eq("id", settings.birthday_email_template_id)
          .eq("organization_id", orgId)
          .maybeSingle()
        : { data: null };

      const { data: candidates, error: candidateError } = await admin
        .from("candidates")
        .select("id, first_name, last_name, email, date_of_birth, employee_status")
        .eq("organization_id", orgId)
        .not("date_of_birth", "is", null)
        .in("employee_status", ["actief", "onboarding"]);

      if (candidateError) throw candidateError;

      let completed = 0;
      let skipped = 0;
      let failed = 0;

      for (const candidate of candidates ?? []) {
        if (!birthdayMatches(candidate.date_of_birth, birthdayDate)) continue;

        const { data: existingLog } = await admin
          .from("birthday_campaign_logs")
          .select("id")
          .eq("organization_id", orgId)
          .eq("candidate_id", candidate.id)
          .eq("birthday_date", birthdayDate)
          .maybeSingle();
        if (existingLog) {
          skipped++;
          continue;
        }

        try {
          const vars = {
            voornaam: candidate.first_name ?? "",
            achternaam: candidate.last_name ?? "",
            naam: `${candidate.first_name ?? ""} ${candidate.last_name ?? ""}`.trim(),
            punten: String(bonusPoints),
            leeftijd: String(ageOnBirthday(candidate.date_of_birth, birthdayDate)),
            organisatie: org.name ?? "JA Werkt",
          };

          const subject = mergeText(template?.subject ?? settings.birthday_subject ?? "Gefeliciteerd {{voornaam}}!", vars);
          const message = mergeText(settings.birthday_message ?? "", vars);
          const html = template?.body_html ? mergeText(template.body_html, vars) : defaultBirthdayHtml(message);

          const transactionId = await awardBirthdayPoints(admin, orgId, candidate, bonusPoints, birthdayDate);

          let notificationId: string | null = null;
          if (pushEnabled) {
            const { data: notification } = await admin
              .from("employee_notifications")
              .insert({
                organization_id: orgId,
                candidate_id: candidate.id,
                type: "verjaardag",
                title: `Gefeliciteerd ${candidate.first_name}!`,
                message: bonusPoints > 0 ? `${bonusPoints} punten staan klaar in je portaal.` : "Van harte gefeliciteerd met je verjaardag.",
                severity: "info",
                reference_table: "loyalty_accounts",
                reference_id: candidate.id,
              })
              .select("id")
              .single();
            notificationId = notification?.id ?? null;
          }

          if (emailEnabled && candidate.email) {
            const sendResult = await sendViaOutlookAccount({
              orgId,
              to: candidate.email,
              subject,
              htmlBody: html,
              candidateId: candidate.id,
              senderName: null,
            });

            if (!sendResult.success && !sendResult.communicationPaused) {
              await admin.from("communications").insert({
                organization_id: orgId,
                candidate_id: candidate.id,
                channel: "email",
                direction: "outbound",
                subject,
                body: html,
                email_to: [candidate.email],
                message_type: "birthday",
              } as any);
            }
          }

          await admin.from("birthday_campaign_logs").insert({
            organization_id: orgId,
            candidate_id: candidate.id,
            birthday_date: birthdayDate,
            email_template_id: template?.id ?? null,
            notification_id: notificationId,
            loyalty_transaction_id: transactionId,
            points_awarded: transactionId ? bonusPoints : 0,
            status: "completed",
          });
          completed++;
        } catch (error) {
          failed++;
          await admin.from("birthday_campaign_logs").insert({
            organization_id: orgId,
            candidate_id: candidate.id,
            birthday_date: birthdayDate,
            status: "failed",
            error: (error as any)?.message ?? "Unknown error",
          }).then(() => {});
        }
      }

      results.push({ org_id: orgId, completed, skipped, failed });
    }

    return json({ date: todayIso, results });
  } catch (error) {
    console.error("birthday-loyalty-cron error", error);
    return json({ error: (error as any)?.message ?? "Unknown error" }, 500);
  }
});
