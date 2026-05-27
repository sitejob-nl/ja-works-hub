import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface WhatsAppAutomationSettings {
  bulk_enabled: boolean;
  bulk_rate_limit_per_minute: number;
  bulk_rate_limit_per_hour: number;
  bulk_batch_size: number;
  bulk_max_concurrent: number;
  bulk_delay_between_batches_ms: number;
  onboarding_reminders_enabled: boolean;
  onboarding_reminder_days: number[];
  document_expiry_enabled: boolean;
  document_expiry_days: number[];
  placement_employee_whatsapp_enabled: boolean;
  placement_client_whatsapp_enabled: boolean;
  sick_report_enabled: boolean;
  sick_report_ask_reason: boolean;
  sick_report_deadline_time: string;
  sick_report_after_deadline_task_priority: string;
  sick_report_confirmation_message: string;
  document_expiry_message: string;
  placement_employee_message: string;
  placement_client_message: string;
}

export const DEFAULT_WHATSAPP_AUTOMATION_SETTINGS: WhatsAppAutomationSettings = {
  bulk_enabled: true,
  bulk_rate_limit_per_minute: 20,
  bulk_rate_limit_per_hour: 1000,
  bulk_batch_size: 50,
  bulk_max_concurrent: 5,
  bulk_delay_between_batches_ms: 2000,
  onboarding_reminders_enabled: true,
  onboarding_reminder_days: [1, 3, 7],
  document_expiry_enabled: false,
  document_expiry_days: [30, 14, 7, 0],
  placement_employee_whatsapp_enabled: false,
  placement_client_whatsapp_enabled: false,
  sick_report_enabled: true,
  sick_report_ask_reason: true,
  sick_report_deadline_time: "09:00",
  sick_report_after_deadline_task_priority: "urgent",
  sick_report_confirmation_message:
    "Hoi {{first_name}}, je ziekmelding is geregistreerd. Beterschap! Je intercedent neemt contact met je op.",
  document_expiry_message:
    "Hoi {{first_name}}, {{document_name}} {{expiry_text}}. Upload of verleng dit document zo snel mogelijk via je portaal.",
  placement_employee_message:
    "Hoi {{first_name}}, je plaatsing als {{function_name}} bij {{company_name}} is bevestigd. Startdatum: {{start_date}}. Werklocatie: {{work_location}}.",
  placement_client_message:
    "Beste {{contact_name}}, hierbij bevestigen wij de plaatsing van {{employee_name}} als {{function_name}}. Startdatum: {{start_date}}.",
};

function numberArray(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return fallback;
  const parsed = value.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v >= 0);
  return parsed.length > 0 ? parsed : fallback;
}

function num(value: unknown, fallback: number, min = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function normalizeWhatsAppAutomationSettings(raw: any): WhatsAppAutomationSettings {
  const defaults = DEFAULT_WHATSAPP_AUTOMATION_SETTINGS;
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    bulk_enabled: source.bulk_enabled !== false,
    bulk_rate_limit_per_minute: num(source.bulk_rate_limit_per_minute, defaults.bulk_rate_limit_per_minute, 1),
    bulk_rate_limit_per_hour: num(source.bulk_rate_limit_per_hour, defaults.bulk_rate_limit_per_hour, 1),
    bulk_batch_size: num(source.bulk_batch_size, defaults.bulk_batch_size, 1),
    bulk_max_concurrent: num(source.bulk_max_concurrent, defaults.bulk_max_concurrent, 1),
    bulk_delay_between_batches_ms: num(source.bulk_delay_between_batches_ms, defaults.bulk_delay_between_batches_ms, 0),
    onboarding_reminders_enabled: source.onboarding_reminders_enabled !== false,
    onboarding_reminder_days: numberArray(source.onboarding_reminder_days, defaults.onboarding_reminder_days),
    document_expiry_enabled: source.document_expiry_enabled === true,
    document_expiry_days: numberArray(source.document_expiry_days, defaults.document_expiry_days),
    placement_employee_whatsapp_enabled: source.placement_employee_whatsapp_enabled === true,
    placement_client_whatsapp_enabled: source.placement_client_whatsapp_enabled === true,
    sick_report_enabled: source.sick_report_enabled !== false,
    sick_report_ask_reason: source.sick_report_ask_reason !== false,
    sick_report_deadline_time: str(source.sick_report_deadline_time, defaults.sick_report_deadline_time),
    sick_report_after_deadline_task_priority: str(
      source.sick_report_after_deadline_task_priority,
      defaults.sick_report_after_deadline_task_priority,
    ),
    sick_report_confirmation_message: str(source.sick_report_confirmation_message, defaults.sick_report_confirmation_message),
    document_expiry_message: str(source.document_expiry_message, defaults.document_expiry_message),
    placement_employee_message: str(source.placement_employee_message, defaults.placement_employee_message),
    placement_client_message: str(source.placement_client_message, defaults.placement_client_message),
  };
}

export async function getWhatsAppAutomationSettings(
  service: SupabaseClient,
  orgId: string,
): Promise<WhatsAppAutomationSettings> {
  const { data } = await service
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();

  return normalizeWhatsAppAutomationSettings((data?.settings as any)?.whatsapp_automation_settings);
}

export function mergeTemplate(text: string, vars: Record<string, unknown>): string {
  return Object.entries(vars).reduce(
    (out, [key, value]) => out.replaceAll(`{{${key}}}`, String(value ?? "")),
    text,
  );
}
