import { describe, expect, it } from 'vitest';
// Pure regel-opbouw voor Exact; server-side gedeeld, hier rechtstreeks getest.
import {
  buildExactInvoiceLineParts,
  type InvoiceLineInput,
} from '../../supabase/functions/_shared/exact-invoice-lines.ts';

/** Regeltotaal zoals Exact het berekent: Quantity × NetPrice. */
const sum = (parts: Array<{ Quantity: number; NetPrice: number }>) =>
  Math.round(parts.reduce((total, part) => total + part.Quantity * part.NetPrice, 0) * 100) / 100;

describe('buildExactInvoiceLineParts', () => {
  it('splitst een regel in basis, overwerk, reis en toeslagen met eigen uurtype', () => {
    const line: InvoiceLineInput = {
      description: 'Productiemedewerker week 28',
      hours: 40,
      hourly_rate: 25,
      overtime_hours: 4,
      overtime_rate: 32.5,
      travel_amount: 45,
      allowances_amount: 30,
      surcharge_amount: 0,
      line_total: 40 * 25 + 4 * 32.5 + 45 + 30,
    };

    const { parts, warnings } = buildExactInvoiceLineParts([line]);

    expect(warnings).toEqual([]);
    expect(parts.map((p) => p.hourTypeCode)).toEqual(['normaal', 'overwerk', 'reis', 'toeslagen']);
    expect(sum(parts)).toBe(1205);
  });

  it('valt terug op één regel voor het volledige bedrag als er niets te ontleden valt', () => {
    const { parts, warnings } = buildExactInvoiceLineParts([
      { description: 'Vaste vergoeding', line_total: 500 },
    ]);

    expect(warnings).toEqual([]);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ Quantity: 1, NetPrice: 500, hourTypeCode: 'normaal' });
  });

  it('corrigeert een restant zodat het Exact-totaal gelijk blijft aan line_total, en waarschuwt', () => {
    // line_total bevat 100 euro die niet uit de componenten volgt.
    const { parts, warnings } = buildExactInvoiceLineParts([
      { description: 'Uren', hours: 10, hourly_rate: 20, line_total: 300 },
    ]);

    expect(warnings).toHaveLength(1);
    expect(sum(parts)).toBe(300);
    expect(parts.at(-1)).toMatchObject({ Description: 'Uren — overig', NetPrice: 100 });
  });

  it('drukt een negatief bedrag uit als negatief aantal — Exact accepteert geen negatieve prijs', () => {
    const { parts } = buildExactInvoiceLineParts([
      { description: 'Correctie', travel_amount: -45, line_total: -45 },
    ]);

    expect(parts).toHaveLength(1);
    expect(parts[0].NetPrice).toBe(45);
    expect(parts[0].Quantity).toBe(-1);
    expect(sum(parts)).toBe(-45);
  });

  it('draait de tekens om voor een creditnota zodat Exact positieve bedragen krijgt', () => {
    const { parts } = buildExactInvoiceLineParts(
      [{ description: 'Creditering uren', hours: 8, hourly_rate: -30, line_total: -240 }],
      { creditNote: true },
    );

    expect(parts).toHaveLength(1);
    expect(parts[0].NetPrice).toBe(30);
    expect(parts[0].Quantity).toBe(8);
    expect(sum(parts)).toBe(240);
  });

  it('slaat componenten met een nul-tarief of nul-uren over', () => {
    const { parts } = buildExactInvoiceLineParts([
      { description: 'Uren', hours: 0, hourly_rate: 25, overtime_hours: 3, overtime_rate: 0, line_total: 0 },
    ]);

    // Geen enkel component is factureerbaar → één regel voor het (nul) totaal.
    expect(parts).toHaveLength(1);
    expect(parts[0].NetPrice).toBe(0);
  });

  it('verwerkt meerdere regels onafhankelijk van elkaar', () => {
    const { parts } = buildExactInvoiceLineParts([
      { description: 'Week 28', hours: 40, hourly_rate: 25, line_total: 1000 },
      { description: 'Week 29', hours: 32, hourly_rate: 25, line_total: 800 },
    ]);

    expect(parts).toHaveLength(2);
    expect(sum(parts)).toBe(1800);
  });

  it('geeft een lege lijst terug zonder invoerregels', () => {
    expect(buildExactInvoiceLineParts(null).parts).toEqual([]);
    expect(buildExactInvoiceLineParts([]).parts).toEqual([]);
  });
});
