import { useMemo, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toFriendlyError } from '@/lib/errorMessages';
import {
  HOURS_MAIL_TYPES, HOURS_MAIL_TYPE_PARTY, describeMailType, describeParty, readMailRules,
  type HoursMailProfile, type HoursMailParty, type HoursMailRuleView, type HoursMailType,
} from '@/lib/hours-outbox';

/**
 * Which messages go out for one client, to whom, and when.
 *
 * The rules are stored in the planner's own shape (`_shared/hours-schedule.ts`),
 * so what this screen edits is exactly what the unattended run reads. Nothing is
 * pre-filled and nothing is assumed: an empty profile sends nothing at all, and
 * every recipient and every moment is somebody's explicit choice.
 */

const WEEKDAYS = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];
/** "Everyone on this week"; the server expands it per week to real people. */
export const EVERY_MEMBER = '*';

export interface RecipientOption { id: string; label: string; party: HoursMailParty }

export interface HoursMailProfilePanelProps {
  profile: HoursMailProfile;
  recipients: RecipientOption[];
  onSave: (input: {
    rules: HoursMailRuleView[];
    lateApprovalMode: 'require_review' | 'send_if_window';
    lateApprovalWindowMinutes: number;
  }) => Promise<void>;
  onReload?: () => void;
}

function blankRule(index: number): HoursMailRuleView {
  return {
    id: `regel-${index + 1}-${Math.random().toString(36).slice(2, 8)}`,
    enabled: false,
    mailType: 'hours_request',
    party: 'customer',
    recipientIds: [],
    at: { kind: 'week_time', weekOffset: 1, weekday: 1, time: '09:00' },
    templateId: '',
    language: 'nl',
  };
}

function RuleEditor({ rule, recipients, templates, onChange, onRemove }: {
  rule: HoursMailRuleView; recipients: RecipientOption[]; templates: string[];
  onChange: (next: HoursMailRuleView) => void; onRemove: () => void;
}) {
  const parties = HOURS_MAIL_TYPE_PARTY[rule.mailType];
  const options = recipients.filter(option => option.party === rule.party);
  const week = rule.at.kind === 'week_time' ? rule.at : null;
  const offset = rule.at.kind === 'deadline_offset' ? rule.at : null;

  const setType = (mailType: HoursMailType) => {
    const allowed = HOURS_MAIL_TYPE_PARTY[mailType];
    // A party that this message type cannot go to would be refused by the
    // server, so the screen moves it rather than letting it be saved.
    const party = allowed.includes(rule.party) ? rule.party : allowed[0];
    onChange({ ...rule, mailType, party, recipientIds: party === rule.party ? rule.recipientIds : [] });
  };

  return <li className="space-y-3 rounded-lg border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Switch id={`rule-enabled-${rule.id}`} checked={rule.enabled}
          onCheckedChange={enabled => onChange({ ...rule, enabled })} />
        <Label htmlFor={`rule-enabled-${rule.id}`}>
          {rule.enabled ? 'Staat aan' : 'Staat uit — verstuurt niets'}
        </Label>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={onRemove}>Verwijderen</Button>
    </div>

    <div className="grid gap-3 md:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor={`rule-type-${rule.id}`}>Berichtsoort</Label>
        <select id={`rule-type-${rule.id}`} className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
          value={rule.mailType} onChange={event => setType(event.target.value as HoursMailType)}>
          {HOURS_MAIL_TYPES.map(type => <option key={type} value={type}>{describeMailType(type)}</option>)}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`rule-party-${rule.id}`}>Partij</Label>
        <select id={`rule-party-${rule.id}`} className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
          value={rule.party} disabled={parties.length === 1}
          onChange={event => onChange({ ...rule, party: event.target.value as HoursMailParty, recipientIds: [] })}>
          {parties.map(party => <option key={party} value={party}>{describeParty(party)}</option>)}
        </select>
      </div>
    </div>

    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">Ontvangers</legend>
      {rule.party === 'employee' && <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={rule.recipientIds.includes(EVERY_MEMBER)}
          onChange={event => onChange({ ...rule, recipientIds: event.target.checked ? [EVERY_MEMBER] : [] })} />
        Alle medewerkers van de week
      </label>}
      {!rule.recipientIds.includes(EVERY_MEMBER) && (options.length
        ? options.map(option => <label key={option.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={rule.recipientIds.includes(option.id)}
            onChange={event => onChange({
              ...rule,
              recipientIds: event.target.checked
                ? [...rule.recipientIds, option.id]
                : rule.recipientIds.filter(id => id !== option.id),
            })} />
          <span data-no-translate="true">{option.label}</span>
        </label>)
        : <p className="text-xs text-muted-foreground">
          Er zijn nog geen ontvangers bekend voor deze partij.
        </p>)}
    </fieldset>

    <div className="space-y-1.5">
      <Label htmlFor={`rule-moment-${rule.id}`}>Verzendmoment</Label>
      <select id={`rule-moment-${rule.id}`} className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
        value={rule.at.kind}
        onChange={event => onChange({
          ...rule,
          at: event.target.value === 'week_time'
            ? { kind: 'week_time', weekOffset: 1, weekday: 1, time: '09:00' }
            : { kind: 'deadline_offset', deadline: 'submission', offsetMinutes: -60 },
        })}>
        <option value="week_time">Op een vaste dag en tijd</option>
        <option value="deadline_offset">Ten opzichte van een deadline</option>
      </select>
      {week && <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`rule-weekday-${rule.id}`}>Dag</Label>
          <select id={`rule-weekday-${rule.id}`} className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={week.weekday}
            onChange={event => onChange({ ...rule, at: { ...week, weekday: Number(event.target.value) as 1 } })}>
            {WEEKDAYS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`rule-weekoffset-${rule.id}`}>Week</Label>
          <select id={`rule-weekoffset-${rule.id}`} className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={week.weekOffset}
            onChange={event => onChange({ ...rule, at: { ...week, weekOffset: Number(event.target.value) } })}>
            <option value={0}>in de werkweek zelf</option>
            <option value={1}>de week erna</option>
            <option value={2}>twee weken erna</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`rule-time-${rule.id}`}>Tijd</Label>
          <Input id={`rule-time-${rule.id}`} type="time" value={week.time}
            onChange={event => onChange({ ...rule, at: { ...week, time: event.target.value } })} />
        </div>
      </div>}
      {offset && <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`rule-deadline-${rule.id}`}>Deadline</Label>
          <select id={`rule-deadline-${rule.id}`} className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={offset.deadline}
            onChange={event => onChange({
              ...rule, at: { ...offset, deadline: event.target.value as 'submission' | 'approval' },
            })}>
            <option value="submission">aanleverdeadline</option>
            <option value="approval">akkoorddeadline</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`rule-offset-${rule.id}`}>Minuten ervoor (negatief) of erna</Label>
          <Input id={`rule-offset-${rule.id}`} type="number" value={offset.offsetMinutes}
            onChange={event => onChange({
              ...rule, at: { ...offset, offsetMinutes: Number(event.target.value) },
            })} />
        </div>
      </div>}
    </div>

    <div className="grid gap-3 md:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor={`rule-template-${rule.id}`}>Tekst</Label>
        <select id={`rule-template-${rule.id}`} className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
          value={rule.templateId} onChange={event => onChange({ ...rule, templateId: event.target.value })}>
          <option value="">Kies een tekst</option>
          {templates.map(template => <option key={template} value={template}>{template}</option>)}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`rule-language-${rule.id}`}>Taal</Label>
        <select id={`rule-language-${rule.id}`} className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
          value={rule.language}
          onChange={event => onChange({ ...rule, language: event.target.value as 'nl' | 'en' | 'pl' })}>
          <option value="nl">Nederlands</option>
          <option value="en">Engels</option>
          <option value="pl">Pools</option>
        </select>
      </div>
    </div>
  </li>;
}

export function HoursMailProfilePanel({ profile, recipients, onSave, onReload }: HoursMailProfilePanelProps) {
  const parsed = useMemo(() => readMailRules(profile.rules), [profile.rules]);
  const [rules, setRules] = useState<HoursMailRuleView[]>(parsed.rules);
  const [mode, setMode] = useState(profile.late_approval_mode);
  const [window, setWindow] = useState(String(profile.late_approval_window_minutes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const templates = useMemo(
    () => [...new Set(profile.templates.map(template => template.template_id))].sort(),
    [profile.templates]);

  async function save() {
    if (busy) return;
    const minutes = Number(window);
    if (!Number.isInteger(minutes) || minutes < 1) {
      setError('Kies een akkoordvenster van ten minste één minuut.');
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await onSave({ rules, lateApprovalMode: mode, lateApprovalWindowMinutes: minutes });
      setSaved(true);
    } catch (failure) {
      setError(toFriendlyError(failure, 'Het mailprofiel is niet opgeslagen. Probeer het opnieuw.'));
    } finally { setBusy(false); }
  }

  return <section className="space-y-4" aria-label="Mailprofiel">
    {profile.last_issues.length > 0 && <Alert variant="destructive"><AlertDescription>
      <p>De laatste planning kon deze instelling niet uitvoeren; zolang dat zo is verstuurt die regel niets:</p>
      <ul className="mt-2 list-disc pl-5">
        {profile.last_issues.map(issue => <li key={`${issue.scope}:${issue.code}`}>
          <span data-no-translate="true">{issue.scope}</span>: {issue.message}
        </li>)}
      </ul>
    </AlertDescription></Alert>}

    {parsed.unreadable > 0 && <Alert variant="destructive"><AlertDescription>
      {parsed.unreadable === 1
        ? 'Eén opgeslagen berichtregel is niet leesbaar door dit scherm en wordt bij opslaan verwijderd.'
        : `${parsed.unreadable} opgeslagen berichtregels zijn niet leesbaar door dit scherm en worden bij opslaan verwijderd.`}
    </AlertDescription></Alert>}

    {rules.length === 0
      ? <p className="text-sm text-muted-foreground">
        Er gaat nog niets uit voor deze opdrachtgever. Voeg een berichtsoort toe en zet hem aan.
      </p>
      : <ul className="space-y-3">
        {rules.map((rule, index) => <RuleEditor key={rule.id} rule={rule} recipients={recipients}
          templates={templates}
          onChange={next => setRules(rules.map((item, position) => position === index ? next : item))}
          onRemove={() => setRules(rules.filter((_, position) => position !== index))} />)}
      </ul>}

    <Button type="button" size="sm" variant="outline"
      onClick={() => setRules([...rules, blankRule(rules.length)])}>Berichtsoort toevoegen</Button>

    <div className="grid gap-3 md:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="late-mode">Late aanlevering</Label>
        <select id="late-mode" className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
          value={mode} onChange={event => setMode(event.target.value as typeof mode)}>
          <option value="require_review">altijd eerst laten beoordelen</option>
          <option value="send_if_window">versturen als er genoeg tijd over is</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="late-window">Minimaal akkoordvenster (minuten)</Label>
        <Input id="late-window" type="number" min={1} value={window}
          onChange={event => setWindow(event.target.value)} />
      </div>
    </div>

    {error && <Alert variant="destructive"><AlertDescription>
      {error}
      {onReload && <div className="mt-2">
        <Button type="button" size="sm" variant="outline" onClick={onReload}>Actuele stand laden</Button>
      </div>}
    </AlertDescription></Alert>}
    {saved && <Alert><AlertDescription>Het mailprofiel is opgeslagen.</AlertDescription></Alert>}

    <Button type="button" disabled={busy} onClick={() => void save()}>
      {busy ? 'Opslaan…' : 'Mailprofiel opslaan'}
    </Button>
  </section>;
}

export default HoursMailProfilePanel;
