import { describe, expect, it } from 'vitest';
import {
  PROPERTY_COST_FIELDS,
  totalMonthlyPropertyCost,
  totalMonthlyPropertyCosts,
} from '@/lib/housing-costs';

// Deze optelling stond op vier plekken los uitgeschreven. Toen afval- en internetkosten
// erbij kwamen werden er twee bijgewerkt, en gaf de kop van een pand een ander totaal dan
// de kaart op datzelfde scherm. Deze tests pinnen de gedeelde bron vast.
describe('totalMonthlyPropertyCost', () => {
  it('telt alle kostenvelden op', () => {
    expect(totalMonthlyPropertyCost({
      monthly_rent: 1800,
      cost_gas: 120,
      cost_water: 45,
      cost_electra: 160,
      cost_municipal_tax: 55,
      cost_waste: 30,
      cost_internet: 40,
      cost_other: 80,
    })).toBe(2330);
  });

  it('telt afval en internet daadwerkelijk mee', () => {
    const zonder = totalMonthlyPropertyCost({ monthly_rent: 1000 });
    const met = totalMonthlyPropertyCost({ monthly_rent: 1000, cost_waste: 30, cost_internet: 40 });
    expect(met - zonder).toBe(70);
  });

  it('behandelt null, undefined en lege strings als nul', () => {
    expect(totalMonthlyPropertyCost({ monthly_rent: null, cost_gas: undefined, cost_water: '' })).toBe(0);
    expect(totalMonthlyPropertyCost(null)).toBe(0);
    expect(totalMonthlyPropertyCost(undefined)).toBe(0);
  });

  it('accepteert strings uit een formulier', () => {
    expect(totalMonthlyPropertyCost({ monthly_rent: '1000', cost_waste: '25.50' })).toBe(1025.5);
  });

  it('negeert onbekende velden', () => {
    expect(totalMonthlyPropertyCost({ monthly_rent: 100, cost_price: 999 } as any)).toBe(100);
  });

  it('somt over meerdere panden', () => {
    expect(totalMonthlyPropertyCosts([
      { monthly_rent: 1000, cost_waste: 25 },
      { monthly_rent: 500, cost_internet: 40 },
    ])).toBe(1565);
    expect(totalMonthlyPropertyCosts([])).toBe(0);
    expect(totalMonthlyPropertyCosts(null)).toBe(0);
  });

  it('kent precies de velden die de UI aanbiedt', () => {
    expect([...PROPERTY_COST_FIELDS]).toEqual([
      'monthly_rent', 'cost_gas', 'cost_water', 'cost_electra',
      'cost_municipal_tax', 'cost_waste', 'cost_internet', 'cost_other',
    ]);
  });
});
