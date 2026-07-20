import { describe, it, expect } from 'vitest';
import {
  buildCandidateScreeningProfilePayload,
  containsPseudonymPlaceholder,
  getAiProfileDiffs,
} from '@/lib/candidateScreening';

const leegDraft: any = {
  phone: '', phone_nl: '', email: '', date_of_birth: '', nationality: '',
  address_street: '', address_postal: '', address_city: '',
  has_drivers_license: false, drivers_license_expiry: '',
  skills: [], languages: [], certifications: [], availability_notes: '',
};

describe('containsPseudonymPlaceholder', () => {
  it('herkent een volledige placeholder', () => {
    expect(containsPseudonymPlaceholder('[TELEFOON]')).toBe(true);
  });

  it('herkent een gedeeltelijk gemaskeerde waarde', () => {
    expect(containsPseudonymPlaceholder('t.[KANDIDAAT]@example.com')).toBe(true);
  });

  it('laat echte waarden met rust', () => {
    expect(containsPseudonymPlaceholder('+48 601 234 567')).toBe(false);
  });
});

describe('getAiProfileDiffs', () => {
  const diffsVoor = (personalia: Record<string, unknown>) =>
    getAiProfileDiffs({ ai_analysis: { personalia } } as any, leegDraft).map((d) => d.label);

  it('biedt gepseudonimiseerde contactgegevens niet aan', () => {
    const labels = diffsVoor({ telefoon_gevonden: '[TELEFOON]', email_gevonden: 't.[KANDIDAAT]@example.com' });
    expect(labels).not.toContain('Telefoon EU/buitenland');
    expect(labels).not.toContain('E-mailadres');
  });

  it('biedt een echt buitenlands nummer wél aan', () => {
    // De maskering pakt alleen NL-nummers, dus dit is precies waar deze rij voor is.
    expect(diffsVoor({ telefoon_gevonden: '+48 601 234 567' })).toContain('Telefoon EU/buitenland');
  });
});

describe('buildCandidateScreeningProfilePayload', () => {
  it('schrijft een placeholder nooit naar het profiel', () => {
    const payload = buildCandidateScreeningProfilePayload(
      { ...leegDraft, phone: '[TELEFOON]', email: 't.[KANDIDAAT]@example.com', address_city: '[KANDIDAAT]' },
      { available_from: '', available_until: '', arrival_date: '' } as any,
    );
    expect(payload.phone).toBeNull();
    expect(payload.email).toBeNull();
    expect(payload.address_city).toBeNull();
  });
});
