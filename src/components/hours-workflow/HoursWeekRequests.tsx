import { useState } from 'react';
import { Mail } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatHoursDate } from './presentation';
import { weekRequestState, weekRequestSubjectTag, type HoursWeekRequest } from '@/lib/hours-sources';

/**
 * The reference that ties a reply back to exactly this client week.
 *
 * The code is deliberately not a secret, and the screen says so: it travels in a
 * subject line that will be quoted and forwarded, it gives no access, and it
 * makes no hours. A reply still has to come from somebody this client knows, and
 * applying still needs a named internal user.
 */

export interface HoursWeekRequestsProps {
  canManage: boolean;
  requests: HoursWeekRequest[];
  onIssue: (label: string, validDays: number) => void;
  onRevoke: (requestId: string, note: string | null) => void;
  busy: boolean;
}

export function HoursWeekRequests({ canManage, requests, onIssue, onRevoke, busy }: HoursWeekRequestsProps) {
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');
  const [validDays, setValidDays] = useState('30');
  const [revoking, setRevoking] = useState<string | null>(null);
  const [note, setNote] = useState('');

  return <div className="space-y-3 rounded-lg border p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <p className="flex items-center gap-1.5 font-medium">
          <Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Uitvraag per e-mail
        </p>
        <p className="text-xs text-muted-foreground">
          Zet de referentie in het onderwerp van de urenmail. Een antwoord daarop wordt vanzelf uit de
          gekoppelde postbus gehaald en komt hier als bron met voorstel binnen. De referentie is
          <strong> geen geheim</strong>: zij zegt alleen bij welke week een antwoord hoort.
        </p>
      </div>
      {canManage && !creating && <Button type="button" size="sm" variant="outline" disabled={busy}
        onClick={() => { setCreating(true); setLabel(''); }}>Uitvraag maken</Button>}
    </div>

    {creating && <div className="space-y-3 rounded-md bg-muted/40 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="week-request-label">Waar gaat deze uitvraag heen?</Label>
          <Input id="week-request-label" value={label} disabled={busy} maxLength={200}
            placeholder="Bijvoorbeeld: Planning Acme" onChange={event => setLabel(event.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="week-request-days">Geldig (dagen)</Label>
          <Input id="week-request-days" type="number" min={1} max={120} value={validDays} disabled={busy}
            onChange={event => setValidDays(event.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy}
          onClick={() => { onIssue(label.trim(), Number(validDays) || 30); setCreating(false); }}>
          Referentie aanmaken
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy}
          onClick={() => setCreating(false)}>Annuleren</Button>
      </div>
    </div>}

    {requests.length === 0
      ? <p className="text-sm text-muted-foreground">Er is nog geen uitvraag voor deze week.</p>
      : requests.map(request => {
        const state = weekRequestState(request);
        const tag = weekRequestSubjectTag(request.code);
        return <div key={request.id} className="space-y-2 rounded-md border p-3"
          role="group" aria-label={`Uitvraag ${request.code}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <code className="rounded bg-muted px-1.5 py-0.5 text-sm" data-no-translate="true">{tag}</code>
              {request.label && <p className="mt-1 text-sm" data-no-translate="true">{request.label}</p>}
              <p className="text-xs text-muted-foreground">
                {request.received === 0
                  ? 'Nog geen antwoord binnengekomen'
                  : `${request.received} ${request.received === 1 ? 'antwoord verwerkt' : 'antwoorden verwerkt'}`}
                {' · geldig tot '}{formatHoursDate(request.expires_at.slice(0, 10))}
              </p>
              {request.revoke_note && <p className="text-xs text-muted-foreground"
                data-no-translate="true">{request.revoke_note}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={state === 'active' ? 'secondary' : 'outline'}>
                {state === 'active' ? 'Actief' : state === 'revoked' ? 'Ingetrokken' : 'Verlopen'}
              </Badge>
              {canManage && state === 'active' && revoking !== request.id &&
                <Button type="button" size="sm" variant="ghost" disabled={busy}
                  onClick={() => { setRevoking(request.id); setNote(''); }}>Intrekken</Button>}
            </div>
          </div>
          {revoking === request.id && <div className="space-y-2 rounded-md bg-muted/40 p-2">
            <div className="space-y-1">
              <Label htmlFor={`revoke-request-${request.id}`}>Waarom trekt u deze uitvraag in?</Label>
              <Input id={`revoke-request-${request.id}`} value={note} disabled={busy} maxLength={2000}
                onChange={event => setNote(event.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">
              Wat al is binnengekomen blijft staan. Een later antwoord op deze referentie gaat daarna
              zichtbaar naar de controlebak in plaats van naar deze week.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="destructive" disabled={busy}
                onClick={() => { onRevoke(request.id, note.trim() || null); setRevoking(null); }}>
                Definitief intrekken
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={busy}
                onClick={() => setRevoking(null)}>Annuleren</Button>
            </div>
          </div>}
        </div>;
      })}
  </div>;
}
