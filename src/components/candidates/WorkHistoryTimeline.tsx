import { Badge } from '@/components/ui/badge';

interface WorkEntry {
  bedrijf: string;
  functie: string;
  periode: string;
  duur_maanden: number;
}

interface Gap {
  periode: string;
  duur_maanden: number;
  mogelijke_verklaring: string;
}

interface Props {
  werkgevers?: WorkEntry[];
  gaten?: Gap[];
  totaleJaren?: number;
}

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Parse "2019 - 2021" or "jan 2020 - mrt 2022" into approximate start/end years.
 * Harde grens op het huidige jaar: een CV-typo ("2027") of een mis-geparste
 * "tot heden" mag de tijdlijn nooit naar de toekomst laten doorlopen. "Heden"/
 * "present" (zonder eindjaar) mapt naar het huidige jaar i.p.v. start + 1.
 */
function parseYearRange(periode: string): { start: number; end: number } {
  const nums = periode.match(/\d{4}/g);
  const ongoing = /heden|present|current|\bnu\b|now/i.test(periode);
  if (!nums || nums.length === 0) return { start: CURRENT_YEAR - 1, end: CURRENT_YEAR };
  const start = Math.min(parseInt(nums[0]), CURRENT_YEAR);
  let end = nums.length > 1
    ? Math.min(parseInt(nums[nums.length - 1]), CURRENT_YEAR)
    : (ongoing ? CURRENT_YEAR : Math.min(start + 1, CURRENT_YEAR));
  if (end < start) end = start;
  return { start, end };
}

const WorkHistoryTimeline = ({ werkgevers = [], gaten = [], totaleJaren }: Props) => {
  if (werkgevers.length === 0) return null;

  // Calculate timeline bounds
  const allRanges = werkgevers.map(w => parseYearRange(w.periode));
  const gapRanges = gaten.map(g => parseYearRange(g.periode));
  const minYear = Math.min(...allRanges.map(r => r.start), ...gapRanges.map(r => r.start));
  const maxYear = Math.max(...allRanges.map(r => r.end), ...gapRanges.map(r => r.end), new Date().getFullYear());
  const totalSpan = maxYear - minYear || 1;

  const COLORS = [
    'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-teal-500',
    'bg-indigo-500', 'bg-cyan-500', 'bg-emerald-500',
  ];

  // Year markers
  const years: number[] = [];
  for (let y = minYear; y <= maxYear; y++) years.push(y);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Tijdlijn werkgeschiedenis</span>
        {totaleJaren && <Badge variant="secondary" className="text-xs">{totaleJaren} jaar ervaring</Badge>}
      </div>

      {/* Timeline bar */}
      <div className="relative">
        {/* Year markers */}
        <div className="flex justify-between mb-1">
          {years.filter((_, i) => i % Math.max(1, Math.floor(years.length / 8)) === 0 || i === years.length - 1).map(y => (
            <span key={y} className="text-[10px] text-muted-foreground">{y}</span>
          ))}
        </div>

        {/* Track */}
        <div className="relative h-7 bg-muted/40 rounded-md overflow-hidden">
          {/* Gaps (red) */}
          {gaten.map((g, i) => {
            const range = parseYearRange(g.periode);
            const left = ((range.start - minYear) / totalSpan) * 100;
            const width = Math.max(((range.end - range.start) / totalSpan) * 100, 1);
            return (
              <div
                key={`gap-${i}`}
                className="absolute top-0 h-full bg-orange-200 border-l border-r border-orange-300"
                style={{ left: `${left}%`, width: `${width}%` }}
                title={`Gap: ${g.periode} (${g.duur_maanden} mnd) — ${g.mogelijke_verklaring}`}
              />
            );
          })}

          {/* Work periods */}
          {werkgevers.map((w, i) => {
            const range = parseYearRange(w.periode);
            const left = ((range.start - minYear) / totalSpan) * 100;
            const width = Math.max(((range.end - range.start) / totalSpan) * 100, 2);
            return (
              <div
                key={i}
                className={`absolute top-0.5 h-6 rounded ${COLORS[i % COLORS.length]} opacity-90`}
                style={{ left: `${left}%`, width: `${width}%` }}
                title={`${w.functie} @ ${w.bedrijf} (${w.periode}, ${w.duur_maanden} mnd)`}
              />
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {werkgevers.map((w, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs">
            <span className={`h-2.5 w-2.5 rounded-sm ${COLORS[i % COLORS.length]}`} />
            <span className="text-muted-foreground">{w.bedrijf}</span>
            <span className="font-medium">({w.duur_maanden} mnd)</span>
          </div>
        ))}
        {gaten.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="h-2.5 w-2.5 rounded-sm bg-orange-200 border border-orange-300" />
            <span className="text-orange-600">Gap ({gaten.length})</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkHistoryTimeline;
