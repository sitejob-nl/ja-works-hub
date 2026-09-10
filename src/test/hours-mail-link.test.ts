import { describe, expect, it } from 'vitest';
import { extractRequestCodes, extractReplyIds } from '../../supabase/functions/_shared/hours-mail-link';

describe('de uitvraagreferentie uit een binnengekomen bericht', () => {
  it('leest de code uit het onderwerp van een antwoord', () => {
    expect(extractRequestCodes('RE: Uren week 37 [UR-7K3M-2XQ9]', '')).toEqual(['UR-7K3M-2XQ9']);
  });

  it('leest de code ook uit de nieuw geschreven tekst', () => {
    expect(extractRequestCodes('Uren', 'Zie ur-7k3m-2xq9, hierbij week 37.')).toEqual(['UR-7K3M-2XQ9']);
  });

  it('noemt dezelfde code maar één keer', () => {
    expect(extractRequestCodes('RE: [UR-7K3M-2XQ9]', 'kenmerk UR-7K3M-2XQ9')).toEqual(['UR-7K3M-2XQ9']);
  });

  it('geeft twee verschillende codes terug zodat de kern kan weigeren', () => {
    expect(extractRequestCodes('RE: [UR-7K3M-2XQ9]', 'of was het UR-4B8N-9PDT?').sort())
      .toEqual(['UR-4B8N-9PDT', 'UR-7K3M-2XQ9']);
  });

  it('leest niets uit de geciteerde geschiedenis, want die krijgt hij niet', () => {
    expect(extractRequestCodes('Uren', '')).toEqual([]);
  });

  it('herkent geen code met tekens die een mens verwart', () => {
    expect(extractRequestCodes('RE: [UR-0O1I-2XQ9]', '')).toEqual([]);
  });

  it('laat een code die in een langer woord zit staan', () => {
    expect(extractRequestCodes('XUR-7K3M-2XQ9X', '')).toEqual([]);
  });
});

describe('de antwoordketen', () => {
  it('leest In-Reply-To en References als losse bericht-ids', () => {
    expect(extractReplyIds({ 'in-reply-to': '<a@ja.invalid>',
      references: '<b@ja.invalid> <c@ja.invalid>' })).toEqual(
      ['<a@ja.invalid>', '<b@ja.invalid>', '<c@ja.invalid>']);
  });

  it('is leeg wanneer het bericht geen antwoord is', () => {
    expect(extractReplyIds({})).toEqual([]);
  });

  it('houdt hoogstens een handvol ids over uit een lange keten', () => {
    const many = Array.from({ length: 40 }, (_, index) => `<m${index}@ja.invalid>`).join(' ');
    expect(extractReplyIds({ references: many })).toHaveLength(20);
  });

  it('negeert wat niet als bericht-id geschreven is', () => {
    expect(extractReplyIds({ references: 'geen id, echt niet' })).toEqual([]);
  });
});
