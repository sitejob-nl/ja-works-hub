import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { emptySourceShift, type HoursSourceDraft, type SourceShiftDraft } from './hours-day-source';

const selectClass = 'h-10 w-full min-w-0 rounded-md border bg-background px-2 text-sm';
function DayOffset({ label, value, onChange }: { label: string; value: '' | '0' | '1'; onChange: (value: '' | '0' | '1') => void }) {
  return <select aria-label={label} className={selectClass} value={value} onChange={event => onChange(event.target.value as '' | '0' | '1')}><option value="">Kies de dag</option><option value="0">Op de werkdatum</option><option value="1">De volgende dag</option></select>;
}

export function HoursSourceEditor({ value, onChange, idPrefix }: { value: HoursSourceDraft; onChange: (value: HoursSourceDraft) => void; idPrefix: string }) {
  return <div className="min-w-0 space-y-4 rounded-lg border p-3" aria-label="Aangeleverde brongegevens">
    <div><p className="text-sm font-medium">Diensttijden en broncategorieën</p><p className="mt-1 text-xs text-muted-foreground">Vul uitsluitend de aangeleverde gegevens in. Deze gegevens worden met de dagversie bewaard. De matrixcontrole gebruikt daarna de opgeslagen versie.</p></div>
    <label className="flex items-start gap-2 text-sm"><input className="mt-0.5" type="checkbox" checked={value.includeShifts} onChange={event => onChange({ ...value, includeShifts: event.target.checked, shifts: event.target.checked && !value.shifts.length ? [emptySourceShift()] : value.shifts })} />Diensttijden vastleggen</label>
    {value.includeShifts && <div className="space-y-3">
      {value.shifts.map((shift, shiftIndex) => {
        const update = (patch: Partial<SourceShiftDraft>) => onChange({ ...value, shifts: value.shifts.map((item, index) => index === shiftIndex ? { ...item, ...patch } : item) });
        const id = `${idPrefix}-shift-${shiftIndex}`;
        return <div className="space-y-3 rounded-lg border bg-background p-3" role="group" aria-label={`Dienst ${shiftIndex + 1}`} key={shiftIndex}>
          <p className="text-sm font-medium">Dienst {shiftIndex + 1}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1"><Label htmlFor={`${id}-start`}>Begintijd dienst {shiftIndex + 1}</Label><Input id={`${id}-start`} type="time" value={shift.start} onChange={event => update({ start: event.target.value, breaksConfirmed: false })} /></div>
            <div className="space-y-1"><Label htmlFor={`${id}-end`}>Eindtijd dienst {shiftIndex + 1}</Label><Input id={`${id}-end`} type="time" value={shift.end} onChange={event => update({ end: event.target.value, breaksConfirmed: false })} /></div>
            <div className="space-y-1"><Label>Einddag dienst {shiftIndex + 1}</Label><DayOffset label={`Einddag dienst ${shiftIndex + 1}`} value={shift.endDayOffset} onChange={endDayOffset => update({ endDayOffset, breaksConfirmed: false })} /></div>
          </div>
          {shift.breaks.map((pause, pauseIndex) => {
            const updatePause = (patch: Partial<typeof pause>) => update({ breaksConfirmed: false, breaks: shift.breaks.map((item, index) => index === pauseIndex ? { ...item, ...patch } : item) });
            return <div className="grid gap-2 rounded-md border p-2 sm:grid-cols-2" role="group" aria-label={`Pauze ${pauseIndex + 1} van dienst ${shiftIndex + 1}`} key={pauseIndex}>
              <div className="space-y-1"><Label htmlFor={`${id}-break-${pauseIndex}-start`}>Pauze begint</Label><Input id={`${id}-break-${pauseIndex}-start`} type="time" value={pause.start} onChange={event => updatePause({ start: event.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor={`${id}-break-${pauseIndex}-end`}>Pauze eindigt</Label><Input id={`${id}-break-${pauseIndex}-end`} type="time" value={pause.end} onChange={event => updatePause({ end: event.target.value })} /></div>
              <DayOffset label={`Begindag pauze ${pauseIndex + 1} dienst ${shiftIndex + 1}`} value={pause.startDayOffset} onChange={startDayOffset => updatePause({ startDayOffset })} />
              <DayOffset label={`Einddag pauze ${pauseIndex + 1} dienst ${shiftIndex + 1}`} value={pause.endDayOffset} onChange={endDayOffset => updatePause({ endDayOffset })} />
              <Button type="button" size="sm" variant="outline" className="h-auto min-h-9 whitespace-normal sm:col-span-2" onClick={() => update({ breaksConfirmed: false, breaks: shift.breaks.filter((_, index) => index !== pauseIndex) })}>Pauze {pauseIndex + 1} verwijderen</Button>
            </div>;
          })}
          <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" className="h-auto min-h-9 whitespace-normal" disabled={shift.breaks.length >= 32} onClick={() => update({ breaksConfirmed: false, breaks: [...shift.breaks, { start: '', end: '', startDayOffset: '', endDayOffset: '' }] })}>Pauze toevoegen aan dienst {shiftIndex + 1}</Button><Button type="button" size="sm" variant="outline" className="h-auto min-h-9 whitespace-normal" onClick={() => onChange({ ...value, shifts: value.shifts.filter((_, index) => index !== shiftIndex) })}>Dienst {shiftIndex + 1} verwijderen</Button></div>
          <label className="flex items-start gap-2 text-sm"><input className="mt-0.5" type="checkbox" checked={shift.breaksConfirmed} onChange={event => update({ breaksConfirmed: event.target.checked })} />{shift.breaks.length ? `Alle pauzes van dienst ${shiftIndex + 1} zijn gecontroleerd.` : `Ik bevestig dat dienst ${shiftIndex + 1} geen pauzes heeft.`}</label>
        </div>;
      })}
      <Button type="button" size="sm" variant="outline" className="h-auto min-h-9 whitespace-normal" disabled={value.shifts.length >= 32} onClick={() => onChange({ ...value, shifts: [...value.shifts, emptySourceShift()] })}>Dienst toevoegen</Button>
    </div>}
    <label className="flex items-start gap-2 text-sm"><input className="mt-0.5" type="checkbox" checked={value.includeCategories} onChange={event => onChange({ ...value, includeCategories: event.target.checked, categories: event.target.checked && !value.categories.length ? [{ sourceCode: '', duration: '' }] : value.categories })} />Broncategorieën vastleggen</label>
    {value.includeCategories && <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Neem codes zoals OV1–OV5 letterlijk over. Vul per broncode de gewerkte uren in; de matrix bepaalt de uiteindelijke uurcode.</p>
      {value.categories.map((category, index) => <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end" key={index}>
        <div className="space-y-1"><Label htmlFor={`${idPrefix}-source-${index}`}>Broncode {index + 1}</Label><Input id={`${idPrefix}-source-${index}`} value={category.sourceCode} maxLength={200} onChange={event => onChange({ ...value, categories: value.categories.map((item, i) => i === index ? { ...item, sourceCode: event.target.value } : item) })} /></div>
        <div className="space-y-1"><Label htmlFor={`${idPrefix}-source-hours-${index}`}>Uren broncode {index + 1}</Label><Input id={`${idPrefix}-source-hours-${index}`} value={category.duration} placeholder="4,75 of 4:45" onChange={event => onChange({ ...value, categories: value.categories.map((item, i) => i === index ? { ...item, duration: event.target.value } : item) })} /></div>
        <Button type="button" size="sm" variant="outline" className="h-auto min-h-9 whitespace-normal" onClick={() => onChange({ ...value, categories: value.categories.filter((_, i) => i !== index) })}>Broncode {index + 1} verwijderen</Button>
      </div>)}
      <Button type="button" size="sm" variant="outline" className="h-auto min-h-9 whitespace-normal" disabled={value.categories.length >= 256} onClick={() => onChange({ ...value, categories: [...value.categories, { sourceCode: '', duration: '' }] })}>Broncategorie toevoegen</Button>
    </div>}
  </div>;
}
