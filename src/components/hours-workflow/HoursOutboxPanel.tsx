import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toFriendlyError } from '@/lib/errorMessages';
import { formatHoursDeadline } from './presentation';
import {
  describeBlockReason, describeMailType, describeParty, isPendingApproval,
  type HoursOutboxMessage,
} from '@/lib/hours-outbox';

/**
 * The outgoing hours mail, seen from the office.
 *
 * Nothing here sends. A draft that needs a person shows what would go out, to
 * whom, and offers exactly one approval — of the words on screen and the hours
 * they were written about. The server refuses anything else as a conflict, so a
 * message that changed while this list was open can never be approved by
 * accident.
 */

const STATUS_LABEL: Record<HoursOutboxMessage['status'], string> = {
  concept: 'Concept',
  gereed: 'Staat klaar',
  goedgekeurd: 'Goedgekeurd',
  verzonden: 'Verzonden',
  mislukt: 'Mislukt',
  vervallen: 'Vervallen',
};

const STATUS_VARIANT: Record<HoursOutboxMessage['status'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
  concept: 'outline',
  gereed: 'secondary',
  goedgekeurd: 'default',
  verzonden: 'default',
  mislukt: 'destructive',
  vervallen: 'outline',
};

export interface HoursOutboxPanelProps {
  messages: HoursOutboxMessage[];
  canManage: boolean;
  onApprove: (input: { id: string; contentHash: string; sourceRevision: string }) => Promise<void>;
  onWithdraw: (input: { id: string; note: string | null }) => Promise<void>;
  onReload?: () => void;
}

function MessageRow({ message, canManage, onApprove, onWithdraw, onReload }: {
  message: HoursOutboxMessage; canManage: boolean;
  onApprove: HoursOutboxPanelProps['onApprove'];
  onWithdraw: HoursOutboxPanelProps['onWithdraw'];
  onReload?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const blocked = describeBlockReason(message.block_reason);
  const pending = isPendingApproval(message);

  async function act(action: 'approve' | 'withdraw') {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (action === 'approve') {
        // Exactly what is on screen: the hashes travel back untouched.
        await onApprove({
          id: message.id, contentHash: message.content_hash,
          sourceRevision: message.source_revision,
        });
      } else {
        await onWithdraw({ id: message.id, note: note.trim() || null });
      }
    } catch (failure) {
      setError(toFriendlyError(failure, action === 'approve'
        ? 'Het bericht is niet goedgekeurd. Lees de actuele stand opnieuw.'
        : 'Het bericht is niet ingetrokken. Probeer het opnieuw.'));
    } finally { setBusy(false); }
  }

  return <li className="rounded-lg border p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="space-y-1">
        <p className="text-sm font-medium">
          {describeMailType(message.mail_type)} · {describeParty(message.party)}
        </p>
        <p className="text-xs text-muted-foreground">
          <span data-no-translate="true">{message.company_name}</span> · week van {message.week_start}
          {' · '}gepland {formatHoursDeadline(message.effective_at)}
        </p>
        {message.recipients.length > 0 && <p className="text-xs text-muted-foreground">
          Aan: <span data-no-translate="true">{message.recipients.join(', ')}</span>
        </p>}
      </div>
      <Badge variant={STATUS_VARIANT[message.status]}>{STATUS_LABEL[message.status]}</Badge>
    </div>

    {blocked && <p className="mt-2 text-xs text-muted-foreground">{blocked}</p>}
    {message.sent_at && <p className="mt-2 text-xs text-muted-foreground">
      Verzonden op {formatHoursDeadline(message.sent_at)}
    </p>}
    {message.status === 'mislukt' && message.last_error && <Alert variant="destructive" className="mt-2">
      <AlertDescription className="break-words text-xs">{message.last_error}</AlertDescription>
    </Alert>}

    {message.subject && <details className="mt-2 text-xs" open={open}
      onToggle={event => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-muted-foreground">Bericht bekijken</summary>
      <p className="mt-2 font-medium" data-no-translate="true">{message.subject}</p>
      {/* The stored body is what was rendered for approval; showing it as text
          keeps a mail template from styling this screen. */}
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2"
        data-no-translate="true">{message.body_html}</pre>
    </details>}

    {error && <Alert variant="destructive" className="mt-2"><AlertDescription>
      {error}
      {onReload && <div className="mt-2">
        <Button type="button" size="sm" variant="outline" onClick={onReload}>Actuele stand laden</Button>
      </div>}
    </AlertDescription></Alert>}

    {canManage && pending && <div className="mt-3 space-y-2">
      <Textarea rows={2} maxLength={500} value={note} placeholder="Reden van intrekken (optioneel)"
        onChange={event => setNote(event.target.value)} aria-label="Reden van intrekken" />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={() => void act('approve')}>
          {busy ? 'Bezig…' : 'Goedkeuren en versturen'}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void act('withdraw')}>
          Intrekken
        </Button>
      </div>
    </div>}
    {canManage && !pending && (message.status === 'gereed' || message.status === 'goedgekeurd') &&
      <div className="mt-3">
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void act('withdraw')}>
          Intrekken
        </Button>
      </div>}
  </li>;
}

export function HoursOutboxPanel({ messages, canManage, onApprove, onWithdraw, onReload }: HoursOutboxPanelProps) {
  if (!messages.length) {
    return <p className="text-sm text-muted-foreground">
      Er staat nog niets klaar. Zonder ingesteld mailprofiel gaat er niets uit.
    </p>;
  }
  const waiting = messages.filter(isPendingApproval).length;
  return <div className="space-y-3">
    {waiting > 0 && <Alert><AlertDescription>
      {waiting === 1 ? 'Eén bericht wacht' : `${waiting} berichten wachten`} op goedkeuring.
      Zonder goedkeuring gaat er niets uit, ook niet op de ingestelde verzendtijd.
    </AlertDescription></Alert>}
    <ul className="space-y-2" aria-label="Uitgaande urenmail">
      {messages.map(message => <MessageRow key={message.id} message={message} canManage={canManage}
        onApprove={onApprove} onWithdraw={onWithdraw} onReload={onReload} />)}
    </ul>
  </div>;
}

export default HoursOutboxPanel;
