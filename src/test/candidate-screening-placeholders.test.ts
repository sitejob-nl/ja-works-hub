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

  it('wist een bestaand telefoonnummer of e-mailadres niet met een leeg concept', () => {
    const payload = buildCandidateScreeningProfilePayload(
      leegDraft,
      { available_from: '', available_until: '', arrival_date: '' } as any,
      { phone: '+48 601 234 567', phone_nl: '0612345678', email: 'jan@example.com' } as any,
    );
    expect(payload.phone).toBe('+48 601 234 567');
    expect(payload.phone_nl).toBe('0612345678');
    expect(payload.email).toBe('jan@example.com');
  });

  it('laat een placeholder een bestaande waarde niet overschrijven én niet wissen', () => {
    const payload = buildCandidateScreeningProfilePayload(
      { ...leegDraft, phone: '[TELEFOON]', email: '[EMAIL]' },
      { available_from: '', available_until: '', arrival_date: '' } as any,
      { phone: '0612345678', phone_nl: null, email: 'jan@example.com' } as any,
    );
    expect(payload.phone).toBe('0612345678');
    expect(payload.email).toBe('jan@example.com');
  });

  it('schrijft een ingevuld concept gewoon weg over de bestaande waarde', () => {
    // Buitenlands nummer: een NL-nummer zou door mergeCandidatePhoneFields naar
    // phone_nl worden geleid, en dan test deze rij het telefoonpaar i.p.v. de guard.
    const payload = buildCandidateScreeningProfilePayload(
      { ...leegDraft, phone: '+48 601 999 888', email: 'nieuw@example.com' },
      { available_from: '', available_until: '', arrival_date: '' } as any,
      { phone: '+48 601 234 567', phone_nl: null, email: 'oud@example.com' } as any,
    );
    expect(payload.phone).toBe('+48 601 999 888');
    expect(payload.email).toBe('nieuw@example.com');
  });

  it('leidt een NL-nummer uit het concept naar phone_nl zonder het buitenlandse nummer te wissen', () => {
    const payload = buildCandidateScreeningProfilePayload(
      { ...leegDraft, phone: '0687654321' },
      { available_from: '', available_until: '', arrival_date: '' } as any,
      { phone: '+48 601 234 567', phone_nl: null, email: null } as any,
    );
    expect(payload.phone_nl).toBe('+31687654321');
    expect(payload.phone).toBe('+48 601 234 567');
  });
});
