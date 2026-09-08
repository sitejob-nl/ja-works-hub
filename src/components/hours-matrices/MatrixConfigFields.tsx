import type { MatrixConfig } from '@/lib/hours-matrices';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const matrixSelectClass = 'h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm';
const weekdays = ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag'];
const newId = () => crypto.randomUUID();

function CodeSelect({ value, onChange, config, label }: { value: string; onChange: (value: string) => void; config: MatrixConfig; label: string }) {
  return <select aria-label={label} className={matrixSelectClass} value={value} onChange={event => onChange(event.target.value)}>
    <option value="">Kies een uurcode</option>
    {value && !config.categories.some(category => category.code === value) && <option value={value}>{value} (onbekende uurcode)</option>}
    {config.categories.filter(category => category.code).map((category, index) => <option key={index} value={category.code}>{category.code}</option>)}
  </select>;
}

export function MatrixConfigFields({ config, onChange, readOnly }: { config: MatrixConfig; onChange: (value: MatrixConfig) => void; readOnly: boolean }) {
  const automatic = config.automaticRules;
  return <fieldset disabled={readOnly} className="space-y-6 min-w-0">
    <legend className="sr-only">Uurcodes en indelingsregels</legend>
    <section className="space-y-3" aria-label="Uurcodes">
      <h3 className="font-medium">Uurcodes en factoren</h3>
      <p className="text-sm text-muted-foreground">Vul de bevestigde uurcodes en bijbehorende factor in. Gebruik een punt voor decimalen, bijvoorbeeld 1.25. De factor wordt bewaard; er wordt geen loonbedrag berekend.</p>
      {config.categories.map((category, index) => <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end" key={index}>
        <div className="space-y-1"><Label htmlFor={`category-${index}`}>Uurcode {index + 1}</Label><Input id={`category-${index}`} value={category.code} onChange={event => onChange({ ...config, categories: config.categories.map((item, i) => i === index ? { ...item, code: event.target.value } : item) })} /></div>
        <div className="space-y-1"><Label htmlFor={`factor-${index}`}>Factor {index + 1}</Label><Input id={`factor-${index}`} value={category.factor} inputMode="decimal" onChange={event => onChange({ ...config, categories: config.categories.map((item, i) => i === index ? { ...item, factor: event.target.value } : item) })} /></div>
        {!readOnly && <Button type="button" variant="outline" aria-label={`Uurcode ${index + 1} verwijderen`} onClick={() => onChange({ ...config, categories: config.categories.filter((_, i) => i !== index) })}>Verwijderen</Button>}
      </div>)}
      {!readOnly && <Button type="button" variant="outline" onClick={() => onChange({ ...config, categories: [...config.categories, { code: '', factor: '' }] })}>Uurcode toevoegen</Button>}
    </section>
    <section className="space-y-3" aria-label="Broncategorieën">
      <h3 className="font-medium">Codes uit aangeleverde uren</h3>
      <p className="text-sm text-muted-foreground">Koppel iedere broncode, zoals OV1, aan precies één uurcode. Onbekende broncodes blokkeren de indeling.</p>
      {config.categoryMappings.map((mapping, index) => <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end" key={mapping.id}>
        <div className="space-y-1"><Label htmlFor={`mapping-${index}`}>Broncode {index + 1}</Label><Input id={`mapping-${index}`} value={mapping.sourceCode} onChange={event => onChange({ ...config, categoryMappings: config.categoryMappings.map((item, i) => i === index ? { ...item, sourceCode: event.target.value } : item) })} /></div>
        <div className="space-y-1"><Label>Doeluurcode</Label><CodeSelect label={`Uurcode voor broncode ${index + 1}`} value={mapping.categoryCode} config={config} onChange={categoryCode => onChange({ ...config, categoryMappings: config.categoryMappings.map((item, i) => i === index ? { ...item, categoryCode } : item) })} /></div>
        {!readOnly && <Button type="button" variant="outline" aria-label={`Broncode ${index + 1} verwijderen`} onClick={() => onChange({ ...config, categoryMappings: config.categoryMappings.filter((_, i) => i !== index) })}>Verwijderen</Button>}
      </div>)}
      {!readOnly && <Button type="button" variant="outline" onClick={() => onChange({ ...config, categoryMappings: [...config.categoryMappings, { id: newId(), sourceCode: '', categoryCode: '' }] })}>Broncode toevoegen</Button>}
    </section>
    <section className="space-y-3" aria-label="Automatische indeling">
      <div className="space-y-1"><Label htmlFor="matrix-rule-kind">Indeling zonder broncategorieën</Label><select id="matrix-rule-kind" className={matrixSelectClass} value={automatic.kind} onChange={event => onChange({ ...config, automaticRules: event.target.value === 'flat' ? { kind: 'flat', rule: { id: newId(), categoryCode: '' } } : event.target.value === 'time_windows' ? { kind: 'time_windows', rules: [] } : { kind: 'explicit_only' } })}>
        <option value="explicit_only">Alleen expliciet aangeleverde categorieën</option><option value="flat">Alle uren naar één uurcode</option><option value="time_windows">Indelen volgens tijdvensters</option>
      </select></div>
      {automatic.kind === 'flat' && <CodeSelect label="Vaste uurcode" value={automatic.rule.categoryCode} config={config} onChange={categoryCode => onChange({ ...config, automaticRules: { ...automatic, rule: { ...automatic.rule, categoryCode } } })} />}
      {automatic.kind === 'time_windows' && <>
        <p className="text-sm text-muted-foreground">Vensters mogen niet overlappen. Bij een venster over middernacht geldt de gekozen startdag. Gebruik 00:00–24:00 voor een volledige dag.</p>
        {automatic.rules.map((rule, index) => {
          const update = (patch: Partial<typeof rule>) => onChange({ ...config, automaticRules: { ...automatic, rules: automatic.rules.map((item, i) => i === index ? { ...item, ...patch } : item) } });
          return <div key={rule.id} className="space-y-3 rounded-lg border p-3" role="group" aria-label={`Tijdvenster ${index + 1}`}>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1"><Label>Uurcode</Label><CodeSelect label={`Uurcode tijdvenster ${index + 1}`} value={rule.categoryCode} config={config} onChange={categoryCode => update({ categoryCode })} /></div>
              <div className="space-y-1"><Label htmlFor={`window-start-${index}`}>Begintijd {index + 1}</Label><Input id={`window-start-${index}`} placeholder="06:00" value={rule.start} onChange={event => update({ start: event.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor={`window-end-${index}`}>Eindtijd {index + 1}</Label><Input id={`window-end-${index}`} placeholder="24:00" value={rule.end} onChange={event => update({ end: event.target.value })} /></div>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-2">{weekdays.map((day, i) => <label key={day} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rule.daysOfWeek.includes(i + 1)} onChange={event => update({ daysOfWeek: event.target.checked ? [...rule.daysOfWeek, i + 1].sort() : rule.daysOfWeek.filter(value => value !== i + 1) })} />{day}</label>)}</div>
            {!readOnly && <Button type="button" variant="outline" onClick={() => onChange({ ...config, automaticRules: { ...automatic, rules: automatic.rules.filter((_, i) => i !== index) } })}>Tijdvenster {index + 1} verwijderen</Button>}
          </div>;
        })}
        {!readOnly && <Button type="button" variant="outline" onClick={() => onChange({ ...config, automaticRules: { ...automatic, rules: [...automatic.rules, { id: newId(), categoryCode: '', daysOfWeek: [], start: '', end: '' }] } })}>Tijdvenster toevoegen</Button>}
      </>}
    </section>
  </fieldset>;
}
