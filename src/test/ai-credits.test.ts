import { describe, expect, it } from 'vitest';
import { formatAiProviderUsd, parseAiCreditCents } from '@/lib/ai-credits';

describe('AI-credit monetary input', () => {
  it('converts Dutch and dot decimals to exact integer cents', () => {
    expect(parseAiCreditCents('50,00')).toBe(5000);
    expect(parseAiCreditCents('0.29')).toBe(29);
    expect(parseAiCreditCents(' 1,2 ')).toBe(120);
    expect(parseAiCreditCents('-0,22')).toBe(-22);
    expect(parseAiCreditCents('0')).toBe(0);
  });

  it.each(['50abc', '5e2', '1,999', '1.000,00', 'Infinity', '', '-', '21474836,48'])('rejects ambiguous or out-of-range amount %s', (value) => {
    expect(parseAiCreditCents(value)).toBeNull();
  });

  it('never displays an unknown provider cost as zero', () => {
    expect(formatAiProviderUsd(null)).toBe('Onbekend');
    expect(formatAiProviderUsd(0)).toContain('0,0000');
    expect(formatAiProviderUsd(0.0123)).toContain('0,0123');
  });
});
