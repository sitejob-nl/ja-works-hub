import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDate } from '@/lib/format';
import { describeMailReason, type HoursMailAttention, type HoursMailFollowed } from '@/lib/hours-mail';

/**
 * What the office sees of a mailbox nobody has to open.
 *
 * Two things this screen has to say out loud, because both are easy to assume
 * wrongly. The mailbox is only ever *read* — nothing is marked, moved, deleted
 * or sent — and a message in the control bin is not a half-finished delivery: it
 * produced no source, no proposal and certainly no hours.
 */

export interface MailboxOption { id: string; label: string; email: string | null }
export interface MailboxFolderOption { id: string; display_name: string }
export interface WeekOption { id: string; label: string }

export interface HoursMailIntakePanelProps {
  canManage: boolean;
  folders: HoursMailFollowed[];
  attention: HoursMailAttention[];
  onDismiss: (messageId: string, note: string | null) => void;
  onRun: () => void;
  running: boolean;
  /** Which mailboxes this person may read; following one is not a role right. */
  mailboxes?: MailboxOption[];
  mailboxFolders?: MailboxFolderOption[];
  selectedMailbox?: string;
  onSelectMailbox?: (accountId: string) => void;
  onFollow?: (accountId: string, folderId: string, folderLabel: string) => void;
  folderBusy?: boolean;
  /** The weeks a message can be hung on by hand when the reference fell short. */
  weeks?: WeekOption[];
  onAssign?: (messageId: string, weekId: string, note: string | null) => void;
}

const selectClass = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm '
  + 'shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

/**
 * Choosing which folder the intake follows.
 *
 * Without this the whole feature is unreachable: the unattended run only ever
 * looks at folders somebody deliberately pointed it at.
 */
function FollowFolder({ mailboxes, folders, selected, onSelect, onFollow, busy }: {
  mailboxes: MailboxOption[]; folders: MailboxFolderOption[]; selected: string;
  onSelect: (accountId: string) => void;
  onFollow: (accountId: string, folderId: string, folderLabel: string) => void;
  busy: boolean;
}) {
  const [folderId, setFolderId] = useState('');
  const chosen = folders.find(folder => folder.id === folderId);
  return <form className="mt-3 grid gap-3 rounded-md bg-muted/40 p-3 sm:grid-cols-[1fr_1fr_auto]"
    onSubmit={event => {
      event.preventDefault();
      if (selected && chosen) onFollow(selected, chosen.id, chosen.display_name);
    }}>
    <div className="space-y-1">
      <Label htmlFor="mail-intake-account">Postbus</Label>
      <select id="mail-intake-account" className={selectClass} value={selected} disabled={busy}
        onChange={event => { onSelect(event.target.value); setFolderId(''); }}>
        <option value="">Kies een postbus</option>
        {mailboxes.map(mailbox => <option key={mailbox.id} value={mailbox.id}>
          {mailbox.email ?? mailbox.label}</option>)}
      </select>
    </div>
    <div className="space-y-1">
      <Label htmlFor="mail-intake-folder">Map</Label>
      <select id="mail-intake-folder" className={selectClass} value={folderId}
        disabled={busy || !selected || folders.length === 0}
        onChange={event => setFolderId(event.target.value)}>
        <option value="">Kies een map</option>
        {folders.map(folder => <option key={folder.id} value={folder.id}>{folder.display_name}</option>)}
      </select>
    </div>
    <div className="flex items-end">
      <Button type="submit" size="sm" variant="outline" disabled={busy || !selected || !chosen}>
        Map volgen
      </Button>
    </div>
    {/* Naming this is the point: the intake records onderwerp and afzender of
        every message it sees, not only the ones it can place. Following Postvak
        IN therefore records more about people than the module needs. */}
    <p className="text-xs text-muted-foreground sm:col-span-3">
      Van elk bericht in die map worden het onderwerp en de afzender vastgelegd, ook van mail die
      niets met uren te maken heeft. Volg daarom een <strong>aparte map</strong> waar een regel in de
      postbus de urenmail naartoe verplaatst, en niet Postvak IN zelf.
    </p>
  </form>;
}

const moment = (value: string | null): string =>
  value ? `${formatDate(value)} om ${new Date(value).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}` : '';

function FolderRow({ folder }: { folder: HoursMailFollowed }) {
  return <li className="rounded-md border p-3 text-sm">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="font-medium text-foreground">{folder.folder_label}</span>
      <span className="text-muted-foreground">{folder.mailbox_email ?? folder.mailbox_name ?? 'onbekende postbus'}</span>
    </div>
    <p className="mt-1 text-muted-foreground">
      {folder.filed} verwerkt{folder.pending > 0 ? ` · ${folder.pending} in de wachtrij` : ''}
      {folder.enabled ? '' : ' · staat uit'}
    </p>
    <p className="mt-1 text-muted-foreground">
      {folder.last_run_at && folder.has_cursor
        ? `Laatst opgehaald ${moment(folder.last_run_at)}.`
        : 'Deze map is nog niet opgehaald; de eerstvolgende doorloop leest hem in zijn geheel.'}
      {folder.resync_count > 0 && ` De cursor is ${folder.resync_count}× opnieuw opgebouwd.`}
    </p>
    {/* A folder that is switched off keeps whatever is already in its queue, and
        nothing works it off. Without saying so, a message somebody assigned by
        hand would simply never be seen again. */}
    {!folder.enabled && folder.pending > 0 && <p role="alert" className="mt-1 text-destructive">
      Deze map staat uit, dus deze wachtrij wordt niet verwerkt. Zet de map weer aan om
      {' '}{folder.pending === 1 ? 'dit bericht' : 'deze berichten'} alsnog op te halen.
    </p>}
    {folder.last_error && <p role="alert" className="mt-1 text-destructive">
      De laatste doorloop stopte met “{folder.last_error}”. De cursor is blijven staan, dus er is niets overgeslagen.
    </p>}
  </li>;
}

function AttentionRow({ message, canManage, onDismiss, weeks, onAssign }: {
  message: HoursMailAttention; canManage: boolean;
  onDismiss: (messageId: string, note: string | null) => void;
  weeks: WeekOption[];
  onAssign?: (messageId: string, weekId: string, note: string | null) => void;
}) {
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [weekId, setWeekId] = useState('');
  return <li className="rounded-md border p-3 text-sm">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="font-medium text-foreground">{message.subject || '(geen onderwerp)'}</span>
      <span className="text-muted-foreground">{moment(message.received_at || message.first_seen_at)}</span>
    </div>
    <p className="mt-1 text-foreground">{describeMailReason(message.reason_code)}</p>
    <p className="mt-1 text-muted-foreground">
      Van {message.from_address ?? 'een onbekend adres'}
      {message.from_name ? ` (${message.from_name})` : ''} · map {message.folder_label}
      {message.has_attachments ? ' · met bijlagen' : ''}
      {message.attempt_count > 1 ? ` · ${message.attempt_count} pogingen` : ''}
    </p>
    {message.reason_note && <p className="mt-1 text-muted-foreground">{message.reason_note}</p>}
    {canManage && open && <form className="mt-3 space-y-2" onSubmit={event => {
      event.preventDefault();
      onDismiss(message.id, note.trim() || null);
    }}>
      <Label htmlFor={`mail-note-${message.id}`}>Toelichting (optioneel)</Label>
      <Input id={`mail-note-${message.id}`} value={note} maxLength={2000}
        onChange={event => setNote(event.target.value)} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="outline">Van de lijst halen</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Annuleren</Button>
      </div>
    </form>}
    {canManage && assigning && onAssign && <form className="mt-3 space-y-2" onSubmit={event => {
      event.preventDefault();
      if (weekId) onAssign(message.id, weekId, note.trim() || null);
    }}>
      <div className="space-y-1">
        <Label htmlFor={`mail-week-${message.id}`}>Klantweek</Label>
        <select id={`mail-week-${message.id}`} className={selectClass} value={weekId}
          onChange={event => setWeekId(event.target.value)}>
          <option value="">Kies een klantweek</option>
          {weeks.map(week => <option key={week.id} value={week.id}>{week.label}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`mail-assign-note-${message.id}`}>Toelichting (optioneel)</Label>
        <Input id={`mail-assign-note-${message.id}`} value={note} maxLength={2000}
          onChange={event => setNote(event.target.value)} />
      </div>
      <p className="text-xs text-muted-foreground">
        De eerstvolgende doorloop legt dit bericht bij die week vast. De afzenderscontrole wordt dan
        overgeslagen: u bent dan zelf de koppeling, in plaats van de referentie.
      </p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!weekId}>Toewijzen</Button>
        <Button type="button" size="sm" variant="ghost"
          onClick={() => setAssigning(false)}>Annuleren</Button>
      </div>
    </form>}
    {canManage && !open && !assigning && <div className="mt-3 flex flex-wrap gap-2">
      {/* The note belongs to the action being taken, not to the row: carrying
          text over from one form to the other puts words in somebody's mouth. */}
      <Button type="button" size="sm" variant="outline"
        onClick={() => { setNote(''); setOpen(true); }}>Afhandelen</Button>
      {onAssign && <Button type="button" size="sm" variant="ghost"
        onClick={() => { setNote(''); setAssigning(true); }}>Aan een week hangen</Button>}
    </div>}
  </li>;
}

export function HoursMailIntakePanel({
  canManage, folders, attention, onDismiss, onRun, running,
  mailboxes = [], mailboxFolders = [], selectedMailbox = '', onSelectMailbox,
  onFollow, folderBusy = false, weeks = [], onAssign,
}: HoursMailIntakePanelProps) {
  return <div className="space-y-4">
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Gevolgde mappen</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            De postbus wordt alleen gelezen. Er wordt niets als gelezen gemarkeerd, niets verplaatst,
            niets verwijderd en niets verstuurd.
          </p>
        </div>
        {canManage && <Button type="button" variant="outline" size="sm" disabled={running}
          onClick={onRun}>{running ? 'Bezig…' : 'Nu ophalen'}</Button>}
      </CardHeader>
      <CardContent>
        {folders.length === 0
          ? <p className="text-sm text-muted-foreground">
              Er wordt nog geen map gevolgd. Kies een map in de gekoppelde Outlook-postbus om
              antwoorden op de urenuitvraag vanzelf binnen te halen.
            </p>
          : <ul className="space-y-2">{folders.map(folder =>
              <FolderRow key={folder.id} folder={folder} />)}</ul>}
        {canManage && onFollow && onSelectMailbox && <FollowFolder mailboxes={mailboxes}
          folders={mailboxFolders} selected={selectedMailbox} onSelect={onSelectMailbox}
          onFollow={onFollow} busy={folderBusy} />}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle className="text-base">Controlebak</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Berichten die binnenkwamen maar niet met zekerheid aan een klantweek konden worden
          gekoppeld. Er staat hier geen bron en geen voorstel tegenover: de inname raadt niet.
        </p>
      </CardHeader>
      <CardContent>
        {attention.length === 0
          ? <p className="text-sm text-muted-foreground">Alles wat binnenkwam is geplaatst.</p>
          : <ul className="space-y-2">{attention.map(message =>
              <AttentionRow key={message.id} message={message} canManage={canManage}
                onDismiss={onDismiss} weeks={weeks} onAssign={onAssign} />)}</ul>}
      </CardContent>
    </Card>
  </div>;
}
