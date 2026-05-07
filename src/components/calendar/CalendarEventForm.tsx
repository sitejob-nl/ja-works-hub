import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useOutlookInvoke } from '@/hooks/useOutlookAccounts';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Save, Loader2, Trash2 } from 'lucide-react';

interface CalendarEvent {
  id?: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location?: { displayName: string };
  body?: { content: string; contentType: string };
  attendees?: { emailAddress: { address: string; name: string }; type: string }[];
  isAllDay?: boolean;
  showAs?: string;
  importance?: string;
}

interface CalendarEventFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event?: CalendarEvent | null;
  defaultDate?: string; // YYYY-MM-DD
  selectedAccount?: string;
}

function toLocalDatetime(isoStr: string) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function toDateOnly(isoStr: string) {
  if (!isoStr) return '';
  return isoStr.slice(0, 10);
}

const CalendarEventForm = ({ open, onOpenChange, event, defaultDate, selectedAccount }: CalendarEventFormProps) => {
  const callOutlook = useOutlookInvoke();
  const queryClient = useQueryClient();
  const isEditing = !!event?.id;

  const now = new Date();
  const defaultStart = defaultDate
    ? `${defaultDate}T09:00`
    : `${now.toISOString().slice(0, 10)}T${String(now.getHours() + 1).padStart(2, '0')}:00`;
  const defaultEnd = defaultDate
    ? `${defaultDate}T10:00`
    : `${now.toISOString().slice(0, 10)}T${String(now.getHours() + 2).padStart(2, '0')}:00`;

  const [subject, setSubject] = useState('');
  const [startDt, setStartDt] = useState(defaultStart);
  const [endDt, setEndDt] = useState(defaultEnd);
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [attendees, setAttendees] = useState('');
  const [isAllDay, setIsAllDay] = useState(false);

  useEffect(() => {
    if (event) {
      setSubject(event.subject || '');
      setStartDt(isAllDay ? toDateOnly(event.start?.dateTime) : toLocalDatetime(event.start?.dateTime));
      setEndDt(isAllDay ? toDateOnly(event.end?.dateTime) : toLocalDatetime(event.end?.dateTime));
      setLocation(event.location?.displayName || '');
      setDescription(event.body?.content || '');
      setAttendees(event.attendees?.map(a => a.emailAddress.address).join(', ') || '');
      setIsAllDay(event.isAllDay || false);
    } else {
      setSubject('');
      setStartDt(defaultStart);
      setEndDt(defaultEnd);
      setLocation('');
      setDescription('');
      setAttendees('');
      setIsAllDay(false);
    }
  }, [event, open]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!subject.trim()) throw new Error('Vul een onderwerp in');

      const attendeeList = attendees.split(/[,;]/).map(e => e.trim()).filter(Boolean).map(email => ({
        emailAddress: { address: email, name: email },
        type: 'required',
      }));

      const payload: any = {
        subject,
        start: {
          dateTime: isAllDay ? startDt : new Date(startDt).toISOString(),
          timeZone: 'Europe/Amsterdam',
        },
        end: {
          dateTime: isAllDay ? endDt : new Date(endDt).toISOString(),
          timeZone: 'Europe/Amsterdam',
        },
        isAllDay,
        ...(location ? { location: { displayName: location } } : {}),
        ...(description ? { body: { content: description, contentType: 'Text' } } : {}),
        ...(attendeeList.length > 0 ? { attendees: attendeeList } : {}),
      };

      if (isEditing) {
        return callOutlook('outlook-calendar', { action: 'update', account_id: selectedAccount, event_id: event!.id, payload });
      }
      return callOutlook('outlook-calendar', { action: 'create', account_id: selectedAccount, payload });
    },
    onSuccess: () => {
      toast.success(isEditing ? 'Afspraak bijgewerkt' : 'Afspraak aangemaakt');
      queryClient.invalidateQueries({ queryKey: ['outlook-calendar'] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      if (err.message !== 'REAUTH_REQUIRED') {
        toast.error('Opslaan mislukt: ' + err.message);
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => callOutlook('outlook-calendar', { action: 'delete', account_id: selectedAccount, event_id: event!.id }),
    onSuccess: () => {
      toast.success('Afspraak verwijderd');
      queryClient.invalidateQueries({ queryKey: ['outlook-calendar'] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      if (err.message !== 'REAUTH_REQUIRED') {
        toast.error('Verwijderen mislukt: ' + err.message);
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Afspraak bewerken' : 'Nieuwe afspraak'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Onderwerp *</Label>
            <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Sollicitatiegesprek, vergadering..." />
          </div>

          <div className="flex items-center gap-3">
            <Switch checked={isAllDay} onCheckedChange={setIsAllDay} id="allday" />
            <Label htmlFor="allday">Hele dag</Label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Start</Label>
              <Input
                type={isAllDay ? 'date' : 'datetime-local'}
                value={startDt}
                onChange={e => setStartDt(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Einde</Label>
              <Input
                type={isAllDay ? 'date' : 'datetime-local'}
                value={endDt}
                onChange={e => setEndDt(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Locatie</Label>
            <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="Kantoor, Teams, adres..." />
          </div>

          <div className="space-y-1">
            <Label>Deelnemers</Label>
            <Input
              value={attendees}
              onChange={e => setAttendees(e.target.value)}
              placeholder="email@voorbeeld.nl, ..."
            />
            <p className="text-xs text-muted-foreground">Scheid meerdere e-mailadressen met komma's. Er wordt een uitnodiging verstuurd.</p>
          </div>

          <div className="space-y-1">
            <Label>Beschrijving</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Eventuele notities..." />
          </div>
        </div>

        <div className="flex justify-between items-center pt-3 border-t">
          <div>
            {isEditing && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive gap-1"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Verwijderen
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Annuleren</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="gap-2">
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isEditing ? 'Opslaan' : 'Aanmaken'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CalendarEventForm;
