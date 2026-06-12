import { describe, expect, it } from 'vitest';
import { textSafeAccent } from '../lib/branding';

describe('textSafeAccent', () => {
  it('clamps light accents to a readable text lightness', () => {
    // Regressie: JA Werkt had accent "197 54% 95%" — e-mails, entity-links en
    // match-scores werden daardoor vrijwel wit (klantmelding oplevering fase 1).
    expect(textSafeAccent('197 54% 95%')).toBe('197 54% 38%');
    expect(textSafeAccent('197 100% 60%')).toBe('197 100% 38%');
  });

  it('keeps accents that are already dark enough', () => {
    expect(textSafeAccent('197 100% 35%')).toBe('197 100% 35%');
    expect(textSafeAccent('0 72% 30%')).toBe('0 72% 30%');
  });

  it('falls back to a readable default on unparseable input', () => {
    expect(textSafeAccent('')).toBe('197 100% 35%');
    expect(textSafeAccent('#3BB8F0')).toBe('197 100% 35%');
  });
});
