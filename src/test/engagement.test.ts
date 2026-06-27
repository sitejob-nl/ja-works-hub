import { describe, it, expect } from 'vitest';
import {
  normalizeEngagementSettings,
  normalizeFiscalMileagePolicy,
  normalizeDamageContactSettings,
  DEFAULT_ENGAGEMENT_SETTINGS,
} from '@/lib/engagement';

describe('normalizeEngagementSettings', () => {
  it('valt terug op de defaults bij lege input', () => {
    const s = normalizeEngagementSettings({});
    expect(s.birthday_enabled).toBe(true);
    expect(s.birthday_send_time).toBe('07:00');
    expect(s.birthday_bonus_points).toBe(120);
  });

  it('neemt overrides over en coerced numbers', () => {
    const s = normalizeEngagementSettings({ birthday_enabled: false, birthday_bonus_points: '200' });
    expect(s.birthday_enabled).toBe(false);
    expect(s.birthday_bonus_points).toBe(200);
  });

  it('normaliseert de zendtijd met padding en fallback', () => {
    expect(normalizeEngagementSettings({ birthday_send_time: '7:05' }).birthday_send_time).toBe('07:05');
    expect(normalizeEngagementSettings({ birthday_send_time: 'kwart over 7' }).birthday_send_time)
      .toBe(DEFAULT_ENGAGEMENT_SETTINGS.birthday_send_time);
  });
});

describe('normalizeFiscalMileagePolicy', () => {
  it('gebruikt de defaults', () => {
    const p = normalizeFiscalMileagePolicy(undefined);
    expect(p.analysis_enabled).toBe(true);
    expect(p.business_margin_pct).toBe(15);
    expect(p.monthly_private_allowance_km).toBe(300);
  });

  it('coerced numerieke strings', () => {
    expect(normalizeFiscalMileagePolicy({ business_margin_pct: '20' }).business_margin_pct).toBe(20);
  });
});

describe('normalizeDamageContactSettings', () => {
  it('gebruikt de defaults', () => {
    const d = normalizeDamageContactSettings(null);
    expect(d.contact_route).toBe('internal_fleet');
    expect(d.show_driver_contact_to_roles).toEqual(['admin', 'backoffice']);
    expect(d.internal_email).toBeNull();
  });

  it('houdt een geldige rollen-array en negeert een niet-array', () => {
    expect(normalizeDamageContactSettings({ show_driver_contact_to_roles: ['finance'] }).show_driver_contact_to_roles)
      .toEqual(['finance']);
    expect(normalizeDamageContactSettings({ show_driver_contact_to_roles: 'finance' }).show_driver_contact_to_roles)
      .toEqual(['admin', 'backoffice']);
  });
});
