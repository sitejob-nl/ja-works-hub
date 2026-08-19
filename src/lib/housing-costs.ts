// Eén bron voor "wat telt mee als maandlast van een pand".
//
// Deze optelling stond op vier plekken los uitgeschreven (pandpagina-kop, KPI op de
// huisvestingslijst, kostenoverzicht en het bewerkpaneel). Toen afval- en internetkosten
// erbij kwamen, werden er maar twee bijgewerkt — waardoor de kop van een pand een ander
// totaal gaf dan de kaart "Totaal per maand" op datzelfde scherm. Nieuw kostenveld?
// Alleen hier toevoegen.

export const PROPERTY_COST_FIELDS = [
  'monthly_rent',
  'cost_gas',
  'cost_water',
  'cost_electra',
  'cost_municipal_tax',
  'cost_waste',
  'cost_internet',
  'cost_other',
] as const;

export type PropertyCostField = (typeof PROPERTY_COST_FIELDS)[number];

/** Alle maandlasten van één pand bij elkaar. Accepteert getallen, strings en null. */
export function totalMonthlyPropertyCost(
  source: Partial<Record<PropertyCostField, unknown>> | null | undefined,
): number {
  if (!source) return 0;
  return PROPERTY_COST_FIELDS.reduce((sum, field) => sum + (Number(source[field]) || 0), 0);
}

/** Hetzelfde totaal over een lijst panden. */
export function totalMonthlyPropertyCosts(
  sources: Array<Partial<Record<PropertyCostField, unknown>>> | null | undefined,
): number {
  return (sources ?? []).reduce((sum, property) => sum + totalMonthlyPropertyCost(property), 0);
}
