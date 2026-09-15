import { useMemo, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toFriendlyError } from '@/lib/errorMessages';
import type { HoursMailTemplateView } from '@/lib/hours-outbox';

/**
 * The words of one message, per language.
 *
 * There is no built-in text: a message type without a template lands in the
 * outbox as a draft that says so, and is never sent with an empty body. The
 * placeholders below are the only ones substituted; anything else stays in the
 * text exactly as it was typed.
 */

export const TEMPLATE_PLACEHOLDERS: { name: string; meaning: string }[] = [
  { name: '{{opdrachtgever}}', meaning: 'naam van de opdrachtgever' },
  { name: '{{week}}', meaning: 'weeknummer' },
  { name: '{{weekstart}}', meaning: 'maandag van de werkweek' },
  { name: '{{ontvanger}}', meaning: 'naam van de ontvanger' },
  { name: '{{code}}', meaning: 'uitvraagcode (gaat sowieso in het onderwerp)' },
  { name: '{{deadline}}', meaning: 'aanleverdeadline' },
  { name: '{{akkoorddeadline}}', meaning: 'akkoorddeadline' },
  { name: '{{ontbrekend}}', meaning: 'medewerkers zonder uren, komma-gescheiden' },
];

export interface HoursMailTemplatePanelProps {
  templates: HoursMailTemplateView[];
  canManage: boolean;
  onSave: (input: {
    templateId: string; language: 'nl' | 'en' | 'pl'; subject: string; body: string;
  }) => Promise<void>;
}

export function HoursMailTemplatePanel({ templates, canManage, onSave }: HoursMailTemplatePanelProps) {
  const keys = useMemo(
    () => templates.map(template => `${template.template_id}:${template.language}`), [templates]);
  const [selected, setSelected] = useState('');
  const current = templates.find(template => `${template.template_id}:${template.language}` === selected);

  const [templateId, setTemplateId] = useState('');
  const [language, setLanguage] = useState<'nl' | 'en' | 'pl'>('nl');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const choose = (key: string) => {
    setSelected(key);
    setSaved(false);
    setError(null);
    const found = templates.find(template => `${template.template_id}:${template.language}` === key);
    setTemplateId(found?.template_id ?? '');
    setLanguage(found?.language ?? 'nl');
    setSubject(found?.subject ?? '');
    setBody(found?.body ?? '');
  };

  async function save() {
    if (busy) return;
    if (!templateId.trim()) { setError('Geef de tekst een korte naam, bijvoorbeeld "uitvraag".'); return; }
    if (!subject.trim()) { setError('Een bericht zonder onderwerp wordt niet verstuurd.'); return; }
    if (!body.trim()) { setError('Een bericht zonder tekst wordt niet verstuurd.'); return; }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await onSave({ templateId: templateId.trim(), language, subject: subject.trim(), body });
      setSaved(true);
    } catch (failure) {
      setError(toFriendlyError(failure, 'De tekst is niet opgeslagen. Probeer het opnieuw.'));
    } finally { setBusy(false); }
  }

  return <section className="space-y-3" aria-label="Berichtteksten">
    {templates.length === 0 && <p className="text-sm text-muted-foreground">
      Er is nog geen tekst vastgelegd. Zonder tekst blijft elk bericht een concept en gaat er niets uit.
    </p>}

    <div className="max-w-md space-y-1.5">
      <Label htmlFor="template-pick">Bestaande tekst</Label>
      <select id="template-pick" className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
        value={selected} onChange={event => choose(event.target.value)}>
        <option value="">Nieuwe tekst</option>
        {keys.map(key => <option key={key} value={key}>{key}</option>)}
      </select>
    </div>

    {canManage && <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="template-id">Naam</Label>
          <Input id="template-id" value={templateId} disabled={Boolean(current)}
            placeholder="uitvraag" onChange={event => setTemplateId(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="template-language">Taal</Label>
          <select id="template-language" className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={language} disabled={Boolean(current)}
            onChange={event => setLanguage(event.target.value as 'nl' | 'en' | 'pl')}>
            <option value="nl">Nederlands</option>
            <option value="en">Engels</option>
            <option value="pl">Pools</option>
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="template-subject">Onderwerp</Label>
        <Input id="template-subject" value={subject} maxLength={200}
          onChange={event => setSubject(event.target.value)} />
        <p className="text-xs text-muted-foreground">
          Bij een bericht aan de opdrachtgever wordt de uitvraagcode er automatisch achter gezet, zodat het
          antwoord aan de juiste week gekoppeld kan worden.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="template-body">Tekst</Label>
        <Textarea id="template-body" rows={8} maxLength={10000} value={body}
          onChange={event => setBody(event.target.value)} />
        <p className="text-xs text-muted-foreground">
          Beschikbaar: {TEMPLATE_PLACEHOLDERS.map(placeholder => placeholder.name).join(', ')}. Wat er niet
          bij staat blijft letterlijk staan.
        </p>
      </div>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {saved && <Alert><AlertDescription>De tekst is opgeslagen.</AlertDescription></Alert>}
      <Button type="button" disabled={busy} onClick={() => void save()}>
        {busy ? 'Opslaan…' : 'Tekst opslaan'}
      </Button>
    </div>}
  </section>;
}

export default HoursMailTemplatePanel;
