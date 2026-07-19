// Opbouw van Exact-verkoopfactuurregels uit JA Werkt-factuurregels.
//
// Een JA Werkt-regel bundelt meerdere factureerbare componenten (basisuren,
// overwerk, reiskosten, toeslagen) in één `line_total`. Exact wil ze los, omdat
// elk component op een eigen grootboekrekening hoort. Deze module is bewust puur
// (geen fetch, geen Deno) zodat de rekenregels unit-getest kunnen worden.

export type InvoiceLineInput = {
  description?: string | null;
  line_total?: number | string | null;
  hours?: number | string | null;
  hourly_rate?: number | string | null;
  overtime_hours?: number | string | null;
  overtime_rate?: number | string | null;
  travel_amount?: number | string | null;
  allowances_amount?: number | string | null;
  surcharge_amount?: number | string | null;
};

/** Uurtype-codes waarop een grootboekrekening gekoppeld kan worden. */
export const EXACT_HOUR_TYPE_CODES = ["normaal", "overwerk", "reis", "toeslagen"] as const;
export type ExactHourTypeCode = typeof EXACT_HOUR_TYPE_CODES[number];

export type ExactInvoiceLinePart = {
  Description: string;
  Quantity: number;
  NetPrice: number;
  hourTypeCode: ExactHourTypeCode;
};

export type BuildLinesResult = {
  parts: ExactInvoiceLinePart[];
  /** Regels waar de som van de componenten afweek van `line_total`. */
  warnings: string[];
};

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Exact accepteert geen negatieve prijs op een regel. Een negatief bedrag wordt
 * daarom uitgedrukt als negatief aantal × positieve prijs — het regeltotaal
 * blijft gelijk.
 */
function normalizeSign(part: ExactInvoiceLinePart): ExactInvoiceLinePart {
  if (part.NetPrice >= 0) return part;
  return { ...part, Quantity: -part.Quantity, NetPrice: -part.NetPrice };
}

/**
 * @param options.creditNote Zet dit voor een creditfactuur (Exact Type 8021).
 *   Exact verwacht op een creditnota **positieve** bedragen — het type bepaalt
 *   de richting — dus draaien we de tekens van alle componenten om.
 */
export function buildExactInvoiceLineParts(
  lines: InvoiceLineInput[] | null | undefined,
  options: { creditNote?: boolean } = {},
): BuildLinesResult {
  const parts: ExactInvoiceLinePart[] = [];
  const warnings: string[] = [];
  const sign = options.creditNote ? -1 : 1;

  for (const line of lines ?? []) {
    const lineTotal = num(line.line_total);
    const description = (line.description ?? "").trim() || "Werkzaamheden";
    const linePartsBefore = parts.length;

    const baseHours = num(line.hours);
    const baseRate = num(line.hourly_rate);
    if (baseHours !== 0 && baseRate !== 0) {
      parts.push({ Description: description, Quantity: baseHours, NetPrice: baseRate, hourTypeCode: "normaal" });
    }

    const overtimeHours = num(line.overtime_hours);
    const overtimeRate = num(line.overtime_rate);
    if (overtimeHours !== 0 && overtimeRate !== 0) {
      parts.push({
        Description: `${description} — overwerk`,
        Quantity: overtimeHours,
        NetPrice: overtimeRate,
        hourTypeCode: "overwerk",
      });
    }

    const travel = num(line.travel_amount);
    if (travel !== 0) {
      parts.push({ Description: `${description} — reiskosten`, Quantity: 1, NetPrice: travel, hourTypeCode: "reis" });
    }

    const allowances = num(line.allowances_amount);
    if (allowances !== 0) {
      parts.push({
        Description: `${description} — toeslagen`,
        Quantity: 1,
        NetPrice: allowances,
        hourTypeCode: "toeslagen",
      });
    }

    const surcharge = num(line.surcharge_amount);
    if (surcharge !== 0) {
      parts.push({
        Description: `${description} — toeslag`,
        Quantity: 1,
        NetPrice: surcharge,
        hourTypeCode: "toeslagen",
      });
    }

    // Het Exact-regeltotaal moet exact gelijk zijn aan line_total. Zonder
    // ontleedbare componenten sturen we één regel voor het hele bedrag; een
    // restant (afronding of een niet-gemapt bedrag) krijgt een eigen regel zodat
    // er nooit stilzwijgend onder-gefactureerd wordt.
    const emitted = parts.slice(linePartsBefore);
    const partsSum = emitted.reduce((sum, part) => sum + part.Quantity * part.NetPrice, 0);
    const residual = round2(lineTotal - partsSum);

    if (emitted.length === 0) {
      parts.push({ Description: description, Quantity: 1, NetPrice: lineTotal, hourTypeCode: "normaal" });
    } else if (Math.abs(residual) >= 0.01) {
      warnings.push(`Regel "${description}": restant € ${residual.toFixed(2)} wijkt af van de som van de componenten`);
      parts.push({ Description: `${description} — overig`, Quantity: 1, NetPrice: residual, hourTypeCode: "normaal" });
    }
  }

  const signed = sign === 1
    ? parts
    : parts.map((part) => ({ ...part, NetPrice: round2(part.NetPrice * sign) }));

  return { parts: signed.map(normalizeSign), warnings };
}
