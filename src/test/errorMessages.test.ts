import { describe, it, expect } from 'vitest';
import { toFriendlyError } from '@/lib/errorMessages';

describe('toFriendlyError', () => {
  it('mapt bekende Postgres-codes naar NL', () => {
    expect(toFriendlyError({ code: '23505', message: 'duplicate key value violates unique constraint "x"' })).toMatch(/bestaat al/i);
    expect(toFriendlyError({ code: '23503' })).toMatch(/gekoppelde gegevens/i);
    expect(toFriendlyError({ code: '42501' })).toMatch(/geen rechten/i);
  });

  it('herkent netwerk- en sessie-fouten', () => {
    expect(toFriendlyError(new Error('Failed to fetch'))).toMatch(/verbinding/i);
    expect(toFriendlyError(new Error('JWT expired'))).toMatch(/sessie/i);
  });

  it('verbergt technische SQL-strings achter de fallback', () => {
    const tech = new Error('null value in column "x" violates not-null constraint');
    expect(toFriendlyError(tech)).toBe('Er ging iets mis. Probeer het opnieuw.');
  });

  it('laat door de app gegooide NL-meldingen ongemoeid door', () => {
    const friendly = 'Verwijderen niet toegestaan — alleen een beheerder kan dit.';
    expect(toFriendlyError(new Error(friendly))).toBe(friendly);
  });

  it('valt terug op de fallback bij lege/onbekende fout', () => {
    expect(toFriendlyError(null)).toMatch(/iets mis/i);
    expect(toFriendlyError(undefined, 'Aangepast')).toBe('Aangepast');
  });

  it('pakt nested supabase-shape (error.message)', () => {
    expect(toFriendlyError({ error: { message: 'Failed to fetch' } })).toMatch(/verbinding/i);
  });
});
