export interface EngagementSettings {
  birthday_enabled: boolean;
  birthday_send_time: string;
  birthday_bonus_points: number;
  birthday_email_enabled: boolean;
  birthday_push_enabled: boolean;
  birthday_email_template_id: string | null;
  birthday_subject: string;
  birthday_message: string;
}

export const DEFAULT_ENGAGEMENT_SETTINGS: EngagementSettings = {
  birthday_enabled: true,
  birthday_send_time: '07:00',
  birthday_bonus_points: 120,
  birthday_email_enabled: true,
  birthday_push_enabled: true,
  birthday_email_template_id: null,
  birthday_subject: 'Gefeliciteerd {{voornaam}}!',
  birthday_message: 'Van harte gefeliciteerd met je verjaardag. We hebben {{punten}} punten voor je klaargezet in je portaal.',
};

const normalizeTime = (value: unknown, fallback = DEFAULT_ENGAGEMENT_SETTINGS.birthday_send_time) => {
  const match = String(value ?? fallback).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return fallback;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
};

export const normalizeEngagementSettings = (raw: any): EngagementSettings => ({
  birthday_enabled: raw?.birthday_enabled ?? DEFAULT_ENGAGEMENT_SETTINGS.birthday_enabled,
  birthday_send_time: normalizeTime(raw?.birthday_send_time),
  birthday_bonus_points: Number(raw?.birthday_bonus_points ?? DEFAULT_ENGAGEMENT_SETTINGS.birthday_bonus_points),
  birthday_email_enabled: raw?.birthday_email_enabled ?? DEFAULT_ENGAGEMENT_SETTINGS.birthday_email_enabled,
  birthday_push_enabled: raw?.birthday_push_enabled ?? DEFAULT_ENGAGEMENT_SETTINGS.birthday_push_enabled,
  birthday_email_template_id: raw?.birthday_email_template_id ?? null,
  birthday_subject: raw?.birthday_subject ?? DEFAULT_ENGAGEMENT_SETTINGS.birthday_subject,
  birthday_message: raw?.birthday_message ?? DEFAULT_ENGAGEMENT_SETTINGS.birthday_message,
});

export interface FiscalMileagePolicy {
  analysis_enabled: boolean;
  business_margin_pct: number;
  monthly_private_allowance_km: number;
  warning_text: string;
}

export const DEFAULT_FISCAL_MILEAGE_POLICY: FiscalMileagePolicy = {
  analysis_enabled: true,
  business_margin_pct: 15,
  monthly_private_allowance_km: 300,
  warning_text: 'Deze analyse is alleen een signaal en geen fiscale conclusie.',
};

export const normalizeFiscalMileagePolicy = (raw: any): FiscalMileagePolicy => ({
  analysis_enabled: raw?.analysis_enabled ?? DEFAULT_FISCAL_MILEAGE_POLICY.analysis_enabled,
  business_margin_pct: Number(raw?.business_margin_pct ?? DEFAULT_FISCAL_MILEAGE_POLICY.business_margin_pct),
  monthly_private_allowance_km: Number(raw?.monthly_private_allowance_km ?? DEFAULT_FISCAL_MILEAGE_POLICY.monthly_private_allowance_km),
  warning_text: raw?.warning_text ?? DEFAULT_FISCAL_MILEAGE_POLICY.warning_text,
});

export interface DamageContactSettings {
  contact_route: 'internal_fleet' | 'external_garage' | 'category_based';
  internal_email: string | null;
  show_driver_contact_to_roles: string[];
  share_driver_phone_externally: boolean;
}

export const DEFAULT_DAMAGE_CONTACT_SETTINGS: DamageContactSettings = {
  contact_route: 'internal_fleet',
  internal_email: null,
  show_driver_contact_to_roles: ['admin', 'backoffice'],
  share_driver_phone_externally: false,
};

export const normalizeDamageContactSettings = (raw: any): DamageContactSettings => ({
  contact_route: raw?.contact_route ?? DEFAULT_DAMAGE_CONTACT_SETTINGS.contact_route,
  internal_email: raw?.internal_email ?? null,
  show_driver_contact_to_roles: Array.isArray(raw?.show_driver_contact_to_roles)
    ? raw.show_driver_contact_to_roles
    : DEFAULT_DAMAGE_CONTACT_SETTINGS.show_driver_contact_to_roles,
  share_driver_phone_externally: raw?.share_driver_phone_externally ?? DEFAULT_DAMAGE_CONTACT_SETTINGS.share_driver_phone_externally,
});
