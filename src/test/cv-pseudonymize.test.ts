import { describe, it, expect } from 'vitest';
import { pseudonymizeCv } from '../../supabase/functions/_shared/cv-pseudonymize.ts';

const kandidaat = { first_name: 'Tomasz', last_name: 'Wieczorek' };

describe('pseudonymizeCv — volgorde van maskeren', () => {
  it('maskeert een e-mail die de achternaam bevat volledig', () => {
    // Regressie: de naam werd vóór de e-mail vervangen, waardoor
    // "t.wieczorek@example.com" -> "t.[KANDIDAAT]@example.com" en de e-mailregex
    // daarna niet meer matchte. Initiaal en domein bleven zichtbaar.
    const { text, meta } = pseudonymizeCv('Mail: t.wieczorek@example.com', kandidaat);
    expect(text).toBe('Mail: [EMAIL]');
    expect(text).not.toContain('example.com');
    expect(meta.email).toBe(1);
  });

  it('maskeert ook een e-mail met de volledige naam erin', () => {
    const { text } = pseudonymizeCv('tomasz.wieczorek@gmail.com', kandidaat);
    expect(text).toBe('[EMAIL]');
  });

  it('maskeert een NL-telefoonnummer', () => {
    const { text, meta } = pseudonymizeCv('Tel: 06 12 34 56 78', kandidaat);
    expect(text).toBe('Tel: [TELEFOON]');
    expect(meta.phone).toBe(1);
  });

  it('vervangt de naam nog steeds in gewone tekst', () => {
    const { text, meta } = pseudonymizeCv('Tomasz Wieczorek is lasser.', kandidaat);
    expect(text).toBe('[KANDIDAAT] is lasser.');
    expect(meta.name).toBeGreaterThan(0);
  });

  it('laat een BSN met geldige 11-proef niet staan', () => {
    // 111222333 voldoet aan de 11-proef.
    const { text } = pseudonymizeCv('BSN 111222333', kandidaat);
    expect(text).toBe('BSN [BSN]');
  });

  it('maskeert alles tegelijk zonder elkaar te beschadigen', () => {
    const { text } = pseudonymizeCv(
      'Tomasz Wieczorek, t.wieczorek@example.com, 06 12 34 56 78, NL91ABNA0417164300',
      kandidaat,
    );
    expect(text).toBe('[KANDIDAAT], [EMAIL], [TELEFOON], [IBAN]');
    expect(text).not.toMatch(/wieczorek|example\.com/i);
  });
});
