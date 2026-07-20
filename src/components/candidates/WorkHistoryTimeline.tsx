import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { DURATION_BANDS, durationBand, durationRailClass, durationToneClass, formatWorkDuration } from '@/lib/candidateScreening';
import { buildTickYears, buildTimelineRows, type WorkEntry, type WorkGap } from '@/lib/work-history';

interface Props {
  werkgevers?: WorkEntry[];
  gaten?: WorkGap[];
  totaleJaren?: number;
  compact?: boolean;
  /**
   * false = alleen de overzichtsbalk, zonder regels per functie. Voor schermen die
   * de losse dienstverbanden al in eigen kaarten tonen (screening, matchcontext),
   * zodat dezelfde feiten niet twee keer onder elkaar staan.
   */
  showDetails?: boolean;
  /** null onderdrukt de kop, bijvoorbeeld wanneer de omliggende kaart al "Werkhistorie" heet. */
  title?: string | null;
  className?: string;
}

const COMPACT_ROW_LIMIT = 3;
const MIN_BAR_WIDTH_PCT = 1.5;
const GAP_BAR_CLASS = 'bg-orange-400';
const GAP_BADGE_CLASS = 'bg-orange-100 text-orange-800 border-0';
/**
 * Aangrenzende werkgevers kunnen dezelfde duur-kleur krijgen (30 en 40 maanden
 * zijn allebei groen). Zonder scheidingslijn lopen die twee balken visueel als
 * één blok door en is niet te zien waar de ene werkgever ophoudt. De ring in de
 * achtergrondkleur zet er een dunne naad tussen, in licht én donker thema.
 */
const BAR_SEPARATOR_CLASS = 'ring-1 ring-background';

const WorkHistoryTimeline = ({
  werkgevers = [],
  gaten = [],
  totaleJaren,
  compact = false,
  showDetails = true,
  title = 'Tijdlijn werkgeschiedenis',
  className = '',
}: Props) => {
  if (werkgevers.length === 0) return null;

  const rows = buildTimelineRows(werkgevers, gaten);
  const minYear = Math.min(...rows.map((r) => r.start));
  const maxYear = Math.max(...rows.map((r) => r.end), new Date().getFullYear());
  const totalSpan = maxYear - minYear || 1;
  const tickYears = buildTickYears(minYear, maxYear, compact ? 4 : 6);

  const offsets = (row: { start: number; end: number }) => {
    const width = Math.max(((row.end - row.start) / totalSpan) * 100, MIN_BAR_WIDTH_PCT);
    // Clampen op de rechterrand: een dienstverband in het lopende jaar krijgt
    // anders left: 100% en valt door de overflow-hidden volledig weg.
    const left = Math.min(Math.max(((row.start - minYear) / totalSpan) * 100, 0), 100 - width);
    return { left: `${left}%`, width: `${width}%` };
  };

  const visibleRows = compact ? rows.slice(0, COMPACT_ROW_LIMIT) : rows;

  /**
   * Legenda. De kleur codeert duur, niet identiteit — drie banen van 2+ jaar zijn
   * alle drie groen. Zonder sleutel leest dat als "waarom zie ik drie dezelfde
   * kleuren?". We tonen alleen de banden die in dít dossier voorkomen, zodat de
   * legenda uitlegt wat er staat in plaats van een volledige schaal op te dreunen.
   */
  const usedBands = DURATION_BANDS.filter((band) =>
    rows.some((row) => row.kind === 'werk' && durationBand(row.months) === band));
  const hasGap = rows.some((row) => row.kind === 'gat');
  const showLegend = !compact && (usedBands.length > 1 || hasGap);
  const hiddenRows = rows.length - visibleRows.length;
  const showHeader = title != null || totaleJaren != null;

  // Tekstalternatief voor de overzichtsbalk: die balk is de enige weergave in
  // de showDetails={false}-tak, dus zonder dit label draagt kleur daar wél de
  // betekenis. De omliggende kaarten tonen bovendien geen gaten.
  const overviewLabel = [
    `Werkhistorie ${minYear} tot ${maxYear}`,
    ...rows.map((row) => `${row.title}: ${row.meta}, ${formatWorkDuration(row.months)}`),
  ].join('. ');

  return (
    <div className={cn(compact ? 'space-y-2' : 'space-y-3', className)}>
      {showHeader && (
        <div className="flex items-center justify-between gap-2">
          {title != null
            ? <span className="text-xs font-medium text-muted-foreground">{title}</span>
            : <span />}
          {totaleJaren != null && <Badge variant="secondary" className="text-xs">{totaleJaren} jaar ervaring</Badge>}
        </div>
      )}

      {/* Jaar-as: één keer bovenaan, alle balken eronder delen dezelfde schaal. */}
      <div className="relative h-4" aria-hidden="true">
        {tickYears.map((y, i) => (
          <span
            key={y}
            className="absolute top-0 text-[10px] tabular-nums text-muted-foreground"
            style={{
              left: `${((y - minYear) / totalSpan) * 100}%`,
              transform: i === 0
                ? 'translateX(0)'
                : i === tickYears.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
            }}
          >
            {y}
          </span>
        ))}
      </div>

      {showDetails ? (
        <ul className={compact ? 'space-y-1.5' : 'space-y-2.5'}>
          {visibleRows.map((row) => (
            <li key={row.key} className="space-y-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={cn(
                    'font-medium leading-snug',
                    compact ? 'truncate text-xs' : 'text-sm',
                    row.kind === 'gat' && 'text-orange-700',
                  )}>
                    {row.title}
                  </p>
                  {/* Periode staat in de regel zelf: de recruiter hoeft geen kleur
                      terug te zoeken in de balk om te zien wanneer dit was. */}
                  <p className={cn('leading-snug text-muted-foreground', compact ? 'truncate text-[11px]' : 'text-xs')}>
                    {row.meta}
                  </p>
                  {!compact && row.note && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">{row.note}</p>
                  )}
                </div>
                <Badge className={cn('shrink-0 text-[11px]', row.kind === 'gat' ? GAP_BADGE_CLASS : durationToneClass(row.months))}>
                  {formatWorkDuration(row.months)}
                </Badge>
              </div>
              {/* Puur visueel: elk feit staat al als tekst in de regel hierboven. */}
              <div className="relative h-1.5 overflow-hidden rounded-full bg-muted/50" aria-hidden="true">
                <span
                  className={cn('absolute top-0 h-full rounded-full', row.kind === 'gat' ? GAP_BAR_CLASS : durationRailClass(row.months))}
                  style={offsets(row)}
                />
              </div>
            </li>
          ))}
          {hiddenRows > 0 && (
            <li className="text-xs text-muted-foreground">+{hiddenRows} eerdere periode{hiddenRows === 1 ? '' : 's'}</li>
          )}
        </ul>
      ) : (
        /* role="img" + label: de balk is een plaatje, maar wel een plaatje dat
           hier de enige weergave is. Screenreaders krijgen dezelfde feiten als
           de ziende gebruiker uit de tooltips haalt. */
        <div
          role="img"
          aria-label={overviewLabel}
          className={cn('relative overflow-hidden rounded-md bg-muted/40', compact ? 'h-5' : 'h-7')}
        >
          {/* Gaten als achtergrondband, dienstverbanden daarbovenop — anders dekt een
              gat een kortere baan af die er deels overheen loopt. */}
          {rows.filter((r) => r.kind === 'gat').map((row) => (
            <div
              key={row.key}
              className="absolute top-0 h-full bg-orange-200 border-l border-r border-orange-300"
              style={offsets(row)}
              title={`${row.title} — ${row.meta} (${formatWorkDuration(row.months)})`}
            />
          ))}
          {rows.filter((r) => r.kind === 'werk').map((row) => (
            <div
              key={row.key}
              className={cn(
                'absolute top-0.5 rounded',
                compact ? 'h-4' : 'h-6',
                durationRailClass(row.months),
                BAR_SEPARATOR_CLASS,
              )}
              style={offsets(row)}
              title={`${row.title} — ${row.meta} (${formatWorkDuration(row.months)})`}
            />
          ))}
        </div>
      )}

      {showLegend && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>Kleur = hoe lang bij één werkgever:</span>
          {usedBands.map((band) => (
            <span key={band.label} className="inline-flex items-center gap-1">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', band.railClass)} aria-hidden="true" />
              {band.label}
            </span>
          ))}
          {hasGap && (
            <span className="inline-flex items-center gap-1">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', GAP_BAR_CLASS)} aria-hidden="true" />
              gat tussen banen
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default WorkHistoryTimeline;
