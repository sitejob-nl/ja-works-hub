import { describe, expect, it } from 'vitest';
import { mergeCandidatePhoneFields, normalizeCandidatePhone, normalizeDutchMobilePhone } from '@/lib/phone';

describe('normalizeDutchMobilePhone', () => {
  it('normaliseert Nederlandse mobiele notaties naar E.164', () => {
    expect(normalizeDutchMobilePhone('06 12 34 56 78')).toBe('+31612345678');
    expect(normalizeDutchMobilePhone('+31 6 12345678')).toBe('+31612345678');
    expect(normalizeDutchMobilePhone('0031 6 12345678')).toBe('+31612345678');
  });

  it('laat buitenlandse of niet-conforme nummers met rust', () => {
    expect(normalizeDutchMobilePhone('+48 600 100 200')).toBe('');
    expect(normalizeDutchMobilePhone('040 1234567')).toBe('');
  });
});

describe('normalizeCandidatePhone', () => {
  it('plaatst Nederlandse mobiel in phone_nl', () => {
    expect(normalizeCandidatePhone('0031 6 12345678')).toEqual({
      phone: '',
      phone_nl: '+31612345678',
    });
  });

  it('plaatst overige nummers in phone', () => {
    expect(normalizeCandidatePhone('+48 600 100 200')).toEqual({
      phone: '+48 600 100 200',
      phone_nl: '',
    });
  });
});

describe('mergeCandidatePhoneFields', () => {
  it('verplaatst een buitenlands nummer uit phone_nl naar phone als phone leeg is', () => {
    expect(mergeCandidatePhoneFields({ phone: '', phone_nl: '+48 600 100 200' })).toEqual({
      phone: '+48 600 100 200',
      phone_nl: '',
    });
  });
});
