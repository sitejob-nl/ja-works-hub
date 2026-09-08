import { Badge } from '@/components/ui/badge';
import { formatHours } from './presentation';
import type { HoursClassificationView } from './types';

export function HoursClassificationDetails({ classification, revisionId }: { classification?: HoursClassificationView | null; revisionId: string }) {
  const result = classification?.revisionId === revisionId ? classification : null;
  if (!result) return <p className="text-xs text-muted-foreground">Uursoorten nog niet gecontroleerd voor deze versie.</p>;
  return <div className="space-y-2 rounded-lg border p-3" aria-label="Uursoortencontrole">
    <div className="flex flex-wrap gap-2 items-center"><Badge variant={result.status === 'blocked' ? 'destructive' : 'secondary'}>{result.status === 'classified' ? 'Uursoorten ingedeeld' : result.status === 'no_hours' ? 'Geen uren vastgesteld' : 'Uurindeling geblokkeerd'}</Badge><span className="text-xs text-muted-foreground">Controle van deze dagversie</span></div>
    {result.matrixName && <p className="text-xs">Matrix: <span data-no-translate="true">{result.matrixName}</span>{result.basisPinned ? ' · vastgelegde basis' : ''}</p>}
    {result.status === 'blocked' && <ul className="space-y-1 text-sm text-destructive">{result.issues.map((issue, index) => <li key={index}>{issue.message}{issue.expectedMinutes != null && issue.actualMinutes != null ? ` Berekend: ${formatHours(issue.expectedMinutes)} uur; aangeleverd: ${formatHours(issue.actualMinutes)} uur.` : ''}</li>)}</ul>}
    {result.status === 'classified' && <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b"><th className="py-1 pr-3">Uurcode</th><th className="pr-3">Factor</th><th className="pr-3">Uren</th><th>Broncode</th></tr></thead><tbody>{result.allocations.map((allocation, index) => <tr key={index}><td className="py-1 pr-3 break-all" data-no-translate="true">{allocation.categoryCode}</td><td className="pr-3">{allocation.factor}</td><td className="pr-3">{formatHours(allocation.minutes)}</td><td className="break-all" data-no-translate="true">{allocation.sourceCategory ?? 'Indelingsregel'}</td></tr>)}</tbody></table></div>}
    <p className="text-xs text-muted-foreground">Medewerkerakkoord en interne controle blijven apart nodig. Deze uitkomst is geen payrollvrijgave.</p>
  </div>;
}
