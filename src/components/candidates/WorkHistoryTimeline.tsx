import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { durationRailClass, durationToneClass, formatWorkDuration } from '@/lib/candidateScreening';
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
const GAP_BAR_CLASS = 'bg-orange-400';
const GAP_BADGE_CLASS = 'bg-orange-100 text-orange-800 border-0';

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

  const offsets = (row: { start: number; end: number }) => ({
    left: `${((row.start - minYear) / totalSpan) * 100}%`,
    width: `${Math.max(((row.end - row.start) / totalSpan) * 100, 1.5)}%`,
  });

  const visibleRows = compact ? rows.slice(0, COMPACT_ROW_LIMIT) : rows;
  const hiddenRows = rows.length - visibleRows.length;
  const showHeader = title != null || totaleJaren != null;

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
        <div className={cn('relative overflow-hidden rounded-md bg-muted/40', compact ? 'h-5' : 'h-7')}>
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
              className={cn('absolute top-0.5 rounded', compact ? 'h-4' : 'h-6', durationRailClass(row.months))}
              style={offsets(row)}
              title={`${row.title} — ${row.meta} (${formatWorkDuration(row.months)})`}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default WorkHistoryTimeline;
