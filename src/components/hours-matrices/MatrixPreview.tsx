import { useEffect, useState } from 'react';
import type { ClassifiedHoursDay, HoursMatrixVersion, HoursResult, HoursBreak } from '../../../supabase/functions/_shared/hours-calculation';
import { formatMatrixMinutes, previewHoursMatrix } from '@/lib/hours-matrices';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { matrixSelectClass } from './MatrixConfigFields';

export function MatrixPreview({ matrix, onReady }: { matrix: HoursMatrixVersion; onReady: (ready: boolean) => void }) {
  const [workDate, setWorkDate] = useState(matrix.validFrom);
  const [duration, setDuration] = useState('');
  const [mode, setMode] = useState<'total' | 'categories' | 'shift'>('total');
  const [categories, setCategories] = useState([{ sourceCode: '', duration: '' }]);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [nextDay, setNextDay] = useState(false);
  const [breaks, setBreaks] = useState<HoursBreak[]>([]);
  const [breaksConfirmed, setBreaksConfirmed] = useState(false);
  const [result, setResult] = useState<HoursResult<ClassifiedHoursDay> | null>(null);
  const matrixKey = JSON.stringify(matrix);
  useEffect(() => { setResult(null); onReady(false); }, [matrixKey, onReady]); // Invalidate an old calculation after any matrix edit.
  const change = (update: () => void) => { update(); setResult(null); onReady(false); };
  const calculate = () => {
    if (mode === 'shift' && !breaksConfirmed) {
      setResult({ ok: false, issues: [{ code: 'UNCONFIRMED_BREAKS', message: 'Controleer en bevestig de pauzes, ook als er geen pauze was.' }] });
      onReady(false);
      return;
    }
    const next = previewHoursMatrix(matrix, {
      workDate, duration,
      ...(mode === 'categories' ? { categories } : {}),
      ...(mode === 'shift' ? { shifts: [{ start, end, endDayOffset: nextDay ? 1 : 0, breaks }] } : {}),
    });
    setResult(next);
    onReady(next.ok);
  };
  return <section className="space-y-4 rounded-xl border bg-muted/20 p-4" aria-label="Rekenvoorbeeld">
    <div><h3 className="font-medium">Rekenvoorbeeld controleren</h3><p className="mt-1 text-sm text-muted-foreground">Test de ingevulde versie met een bekende werkdag. Deze berekening slaat geen uren op. Een geslaagd voorbeeld bewijst alleen deze invoer; de afgesproken regels blijven leidend.</p></div>
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1"><Label htmlFor="preview-date">Werkdatum voorbeeld</Label><Input id="preview-date" type="date" value={workDate} onChange={event => change(() => setWorkDate(event.target.value))} /></div>
      <div className="space-y-1"><Label htmlFor="preview-duration">Netto-uren voorbeeld</Label><Input id="preview-duration" placeholder="Bijvoorbeeld 8:30" value={duration} onChange={event => change(() => setDuration(event.target.value))} /></div>
      <div className="space-y-1"><Label htmlFor="preview-mode">Gegevens van de werkdag</Label><select id="preview-mode" className={matrixSelectClass} value={mode} onChange={event => change(() => setMode(event.target.value as typeof mode))}><option value="total">Alleen dagtotaal</option><option value="categories">Dagtotaal en broncategorieën</option><option value="shift">Dagtotaal, dienst en pauzes</option></select></div>
    </div>
    {mode === 'categories' && <div className="space-y-3">
      {categories.map((category, index) => <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]" key={index}>
        <Input aria-label={`Voorbeeld broncode ${index + 1}`} placeholder="Broncode, bijvoorbeeld OV1" value={category.sourceCode} onChange={event => change(() => setCategories(categories.map((item, i) => i === index ? { ...item, sourceCode: event.target.value } : item)))} />
        <Input aria-label={`Voorbeeld uren broncode ${index + 1}`} placeholder="Uren" value={category.duration} onChange={event => change(() => setCategories(categories.map((item, i) => i === index ? { ...item, duration: event.target.value } : item)))} />
        <Button type="button" variant="outline" aria-label={`Voorbeeld broncode ${index + 1} verwijderen`} onClick={() => change(() => setCategories(categories.filter((_, i) => i !== index)))}>Verwijderen</Button>
      </div>)}
      <Button type="button" variant="outline" onClick={() => change(() => setCategories([...categories, { sourceCode: '', duration: '' }]))}>Categorie aan voorbeeld toevoegen</Button>
    </div>}
    {mode === 'shift' && <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1"><Label htmlFor="preview-shift-start">Dienst begint</Label><Input id="preview-shift-start" type="time" value={start} onChange={event => change(() => setStart(event.target.value))} /></div><div className="space-y-1"><Label htmlFor="preview-shift-end">Dienst eindigt</Label><Input id="preview-shift-end" type="time" value={end} onChange={event => change(() => setEnd(event.target.value))} /></div></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={nextDay} onChange={event => change(() => setNextDay(event.target.checked))} />Dienst eindigt de volgende dag</label>
      {breaks.map((pause, index) => {
        const update = (patch: Partial<HoursBreak>) => change(() => { setBreaks(breaks.map((item, i) => i === index ? { ...item, ...patch } : item)); setBreaksConfirmed(false); });
        return <div className="space-y-2 rounded-lg border p-3" key={index} role="group" aria-label={`Pauze ${index + 1}`}>
          <div className="grid gap-2 sm:grid-cols-2"><Input aria-label={`Pauze ${index + 1} begint`} type="time" value={pause.start} onChange={event => update({ start: event.target.value })} /><Input aria-label={`Pauze ${index + 1} eindigt`} type="time" value={pause.end} onChange={event => update({ end: event.target.value })} /></div>
          <div className="flex flex-wrap gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pause.startDayOffset === 1} onChange={event => update({ startDayOffset: event.target.checked ? 1 : 0 })} />Pauze begint volgende dag</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pause.endDayOffset === 1} onChange={event => update({ endDayOffset: event.target.checked ? 1 : 0 })} />Pauze eindigt volgende dag</label></div>
          <Button type="button" variant="outline" onClick={() => change(() => { setBreaks(breaks.filter((_, i) => i !== index)); setBreaksConfirmed(false); })}>Pauze {index + 1} verwijderen</Button>
        </div>;
      })}
      <Button type="button" variant="outline" onClick={() => change(() => { setBreaks([...breaks, { start: '', end: '', startDayOffset: 0, endDayOffset: 0 }]); setBreaksConfirmed(false); })}>Pauze toevoegen</Button>
      <label className="flex items-start gap-2 text-sm"><input className="mt-0.5" type="checkbox" checked={breaksConfirmed} onChange={event => change(() => setBreaksConfirmed(event.target.checked))} />{breaks.length ? 'Ik heb alle pauzes gecontroleerd.' : 'Ik bevestig dat deze dienst geen pauzes heeft.'}</label>
    </div>}
    <Button type="button" variant="outline" onClick={calculate}>Voorbeeld berekenen</Button>
    {result?.ok === false && <div role="alert" className="text-sm text-destructive">{result.issues.map((issue, i) => <p key={i}>{issue.message}</p>)}</div>}
    {result?.ok === true && <div role="status" className="space-y-2">
      <p className="text-sm font-medium">Voorbeeld sluit aan: {formatMatrixMinutes(result.value.totalMinutes)} uur.</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="py-2 pr-3">Uurcode</th><th className="pr-3">Factor</th><th className="pr-3">Uren</th><th>Broncode</th></tr></thead><tbody>{result.value.allocations.map((allocation, index) => <tr className="border-b last:border-0" key={index}><td className="py-2 pr-3" data-no-translate="true">{allocation.categoryCode}</td><td className="pr-3">{allocation.factor}</td><td className="pr-3">{formatMatrixMinutes(allocation.minutes)}</td><td data-no-translate="true">{allocation.sourceCategory ?? 'Indelingsregel'}</td></tr>)}</tbody></table></div>
    </div>}
  </section>;
}
