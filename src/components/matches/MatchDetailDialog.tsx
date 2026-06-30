import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, CalendarCheck, CheckCircle2, Clock3, History, Mail, MessageSquare, Phone, Plus, Star, UserCheck, UserRound } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import MatchInspectorDialog from '@/components/matches/MatchInspectorDialog';
import TaskEditorSheet from '@/components/shared/TaskEditorSheet';
import { logAudit } from '@/lib/audit';
import { formatDate } from '@/lib/format';
import { getMatchStatusMeta } from '@/lib/match-status';
import { priorityConfig } from '@/lib/tasks';
import type { MatchBreakdown } from '@/lib/matching';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type MatchDetailDialogProps = {
  open: boolean;
  match: any | null;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
  canConfirmInterview?: boolean;
};

const toLocalInputValue = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
};

const formatDateTime = (value?: string | null) => value ? new Date(value).toLocaleString('nl-NL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
}) : '—';

const fullName = (candidate: any) =>
  [candidate?.first_name, candidate?.last_name].filter(Boolean).join(' ') || 'Kandidaat onbekend';

const UNASSIGNED = 'unassigned';

const profileName = (profile?: { full_name?: string | null; email?: string | null } | null) =>
  profile?.full_name || profile?.email || 'Onbekend';

const summarizeAudit = (entry: any) => {
  const oldValues = entry?.old_values ?? {};
  const newValues = entry?.new_values ?? {};
  if ('assigned_to' in newValues) return 'Match-eigenaar gewijzigd';
  if ('status' in newValues) {
    return `${getMatchStatusMeta(oldValues.status).label} -> ${getMatchStatusMeta(newValues.status).label}`;
  }
  if ('interview_confirmed_at' in newValues || 'interview_location' in newValues) return 'Afspraakgegevens bijgewerkt';
  return entry?.reason || 'Match bijgewerkt';
};

const MatchDetailDialog = ({ open, match, onOpenChange, onChanged, canConfirmInterview = true }: MatchDetailDialogProps) => {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [whyOpen, setWhyOpen] = useState(false);
  const [confirmedAt, setConfirmedAt] = useState('');
  const [location, setLocation] = useState('');
  const [interviewType, setInterviewType] = useState('op_kantoor');
  const [note, setNote] = useState('');
  const [assignedTo, setAssignedTo] = useState(UNASSIGNED);
  const [newNote, setNewNote] = useState('');
  const [taskEditorOpen, setTaskEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<any | null>(null);
  const [notifyCandidate, setNotifyCandidate] = useState(true);
  const [notifyCompany, setNotifyCompany] = useState(true);

  useEffect(() => {
    if (!open || !match) return;
    setConfirmedAt(toLocalInputValue(match.interview_confirmed_at ?? match.interview_proposed_at ?? match.interview_date));
    setLocation(match.interview_location ?? '');
    setInterviewType(match.interview_type ?? 'op_kantoor');
    setNote(match.interview_proposed_note ?? '');
    setAssignedTo(match.assigned_to ?? UNASSIGNED);
    setNewNote('');
    setTaskEditorOpen(false);
    setEditingTask(null);
    setNotifyCandidate(true);
    setNotifyCompany(true);
  }, [match, open]);

  const { data: events = [] } = useQuery({
    queryKey: ['match-feedback-events', match?.id],
    enabled: open && !!match?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('match_feedback_events')
        .select('id, from_status, to_status, notes, created_at, match_feedback_reasons(reason), profiles:created_by(full_name,email)')
        .eq('match_id', match.id)
        .order('created_at', { ascending: false })
        .limit(12);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: communications = [] } = useQuery({
    queryKey: ['match-communications', match?.id],
    enabled: open && !!match?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('communications')
        .select('id, channel, direction, message_type, subject, email_to, sent_at, created_at')
        .eq('match_id', match.id)
        .order('sent_at', { ascending: false })
        .limit(12);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: auditLogs = [] } = useQuery({
    queryKey: ['match-audit-log', match?.id],
    enabled: open && !!match?.id && !!match?.organization_id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('audit_log')
        .select('id, action, table_name, record_id, old_values, new_values, reason, created_at, profiles:user_id(full_name,email)')
        .eq('organization_id', match.organization_id)
        .eq('table_name', 'matches')
        .eq('record_id', match.id)
        .order('created_at', { ascending: false })
        .limit(12);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ['match-tasks', match?.id],
    enabled: open && !!match?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('recruiter_tasks')
        .select('id, title, status, priority, due_date, created_at, assigned_to, created_by, profiles:assigned_to(full_name,email), creator:profiles!recruiter_tasks_created_by_fkey(full_name,email)')
        .eq('related_entity_type', 'match')
        .eq('related_entity_id', match.id)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: notes = [] } = useQuery({
    queryKey: ['match-notes', match?.id],
    enabled: open && !!match?.id,
    queryFn: async () => {
      const { data: rawNotes, error } = await (supabase as any)
        .from('notes')
        .select('id, body, is_internal, created_at, created_by')
        .eq('related_entity_type', 'match')
        .eq('related_entity_id', match.id)
        .order('created_at', { ascending: false })
        .limit(12);
      if (error) throw error;

      const profileIds = Array.from(new Set((rawNotes ?? []).map((n: any) => n.created_by).filter(Boolean)));
      if (profileIds.length === 0) return rawNotes ?? [];

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', profileIds as string[]);
      const byId = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]));
      return (rawNotes ?? []).map((n: any) => ({ ...n, profiles: byId[n.created_by] ?? null }));
    },
  });

  const { data: assignees = [] } = useQuery({
    queryKey: ['match-assignees', match?.organization_id],
    enabled: open && !!match?.organization_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('organization_id', match.organization_id)
        .eq('is_active', true)
        .order('full_name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!canConfirmInterview) throw new Error('Je rol mag afspraken niet definitief maken');
      if (!match?.id) throw new Error('Geen match geselecteerd');
      if (!confirmedAt) throw new Error('Kies een definitieve datum en tijd');
      if (!location.trim()) throw new Error('Vul locatie/type in');
      const { data, error } = await supabase.functions.invoke('confirm-match-interview', {
        body: {
          match_id: match.id,
          interview_confirmed_at: new Date(confirmedAt).toISOString(),
          interview_location: location.trim(),
          interview_type: interviewType,
          note: note || undefined,
          notify_candidate: notifyCandidate,
          notify_company: notifyCompany,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: () => {
      toast.success('Afspraak definitief gemaakt');
      qc.invalidateQueries({ queryKey: ['match-communications', match?.id] });
      qc.invalidateQueries({ queryKey: ['match-feedback-events', match?.id] });
      onChanged?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const assignMutation = useMutation({
    mutationFn: async (value: string) => {
      if (!match?.id) throw new Error('Geen match geselecteerd');
      const nextAssignee = value === UNASSIGNED ? null : value;
      const { error } = await (supabase as any)
        .from('matches')
        .update({ assigned_to: nextAssignee })
        .eq('id', match.id)
        .eq('organization_id', match.organization_id);
      if (error) throw error;
      return nextAssignee;
    },
    onSuccess: async (nextAssignee) => {
      await logAudit({
        action: 'update',
        tableName: 'matches',
        recordId: match.id,
        oldValues: { assigned_to: match.assigned_to ?? null },
        newValues: { assigned_to: nextAssignee },
        reason: 'Match-eigenaar gewijzigd vanuit matchdetail',
      });
      setAssignedTo(nextAssignee ?? UNASSIGNED);
      qc.invalidateQueries({ queryKey: ['match-pipeline'] });
      qc.invalidateQueries({ queryKey: ['match-notes', match?.id] });
      qc.invalidateQueries({ queryKey: ['match-audit-log', match?.id] });
      onChanged?.();
      toast.success('Matchtoewijzing bijgewerkt');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const addNoteMutation = useMutation({
    mutationFn: async () => {
      if (!match?.id) throw new Error('Geen match geselecteerd');
      if (!user?.id) throw new Error('Je sessie is verlopen');
      if (!newNote.trim()) throw new Error('Schrijf eerst een notitie');
      const { error } = await (supabase as any).from('notes').insert({
        body: newNote.trim(),
        is_internal: true,
        related_entity_id: match.id,
        related_entity_type: 'match',
        created_by: user?.id,
        organization_id: match.organization_id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewNote('');
      qc.invalidateQueries({ queryKey: ['match-notes', match?.id] });
      toast.success('Notitie toegevoegd');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const openNewTask = () => {
    setEditingTask(null);
    setTaskEditorOpen(true);
  };

  const openEditTask = (task: any) => {
    setEditingTask(task);
    setTaskEditorOpen(true);
  };

  const candidate = match?.candidates;
  const vacancy = match?.vacancies;
  const company = vacancy?.companies;
  const statusMeta = getMatchStatusMeta(match?.status);
  const score = (match?.match_breakdown as MatchBreakdown | null)?.matchPercent ?? match?.match_score;
  const assignee = assignees.find((profile: any) => profile.id === assignedTo) ?? match?.assignee ?? null;
  const contactLines = useMemo(() => [
    candidate?.phone_nl || candidate?.phone ? { icon: Phone, value: candidate.phone_nl || candidate.phone } : null,
    candidate?.email ? { icon: Mail, value: candidate.email } : null,
  ].filter(Boolean) as Array<{ icon: typeof Phone; value: string }>, [candidate]);

  const timeline = useMemo(() => {
    const rows = [
      ...events.map((event: any) => ({
        id: `event-${event.id}`,
        at: event.created_at,
        icon: History,
        title: `${getMatchStatusMeta(event.from_status).label} -> ${getMatchStatusMeta(event.to_status).label}`,
        meta: profileName(event.profiles),
        body: [event.match_feedback_reasons?.reason, event.notes].filter(Boolean).join('\n'),
      })),
      ...communications.map((item: any) => ({
        id: `comm-${item.id}`,
        at: item.sent_at ?? item.created_at,
        icon: Mail,
        title: item.subject || '(zonder onderwerp)',
        meta: `${item.channel} · ${item.message_type || item.direction}`,
        body: Array.isArray(item.email_to) ? item.email_to.join(', ') : item.email_to,
      })),
      ...tasks.map((task: any) => ({
        id: `task-${task.id}`,
        at: task.created_at,
        icon: CheckCircle2,
        title: task.title,
        meta: `Taak · ${task.status} · toegewezen aan ${profileName(task.profiles)}`,
        body: task.due_date ? `Deadline: ${formatDate(task.due_date)}` : '',
      })),
      ...notes.map((note: any) => ({
        id: `note-${note.id}`,
        at: note.created_at,
        icon: MessageSquare,
        title: 'Notitie',
        meta: profileName(note.profiles),
        body: note.body,
      })),
      ...auditLogs.map((entry: any) => ({
        id: `audit-${entry.id}`,
        at: entry.created_at,
        icon: History,
        title: summarizeAudit(entry),
        meta: `Audit · ${profileName(entry.profiles)}`,
        body: entry.reason ?? '',
      })),
    ];
    return rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 20);
  }, [auditLogs, communications, events, notes, tasks]);

  if (!match) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] max-w-[min(1400px,96vw)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              Matchdetail
              <Badge className={statusMeta.badgeClass}>{statusMeta.label}</Badge>
              {typeof score === 'number' && <Badge variant="outline" className="gap-1"><Star className="h-3 w-3" /> {Math.round(score)}%</Badge>}
            </DialogTitle>
            <DialogDescription>
              {fullName(candidate)} voor {vacancy?.title ?? 'vacature'}{company?.name ? ` bij ${company.name}` : ''}.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <section className="rounded-md border p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium"><UserRound className="h-4 w-4" /> Kandidaat</div>
              <div className="space-y-1 text-sm">
                <div className="font-medium">{fullName(candidate)}</div>
                <div className="text-muted-foreground">{candidate?.address_city || 'Regio onbekend'}</div>
                {contactLines.map(({ icon: Icon, value }) => (
                  <div key={value} className="flex items-center gap-2 text-muted-foreground"><Icon className="h-3.5 w-3.5" /> {value}</div>
                ))}
              </div>
            </section>
            <section className="rounded-md border p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Briefcase className="h-4 w-4" /> Vacature</div>
              <div className="space-y-1 text-sm">
                <div className="font-medium">{vacancy?.title ?? 'Vacature onbekend'}</div>
                <div className="text-muted-foreground">{company?.name ?? 'Opdrachtgever onbekend'}</div>
                {company?.email && <div className="flex items-center gap-2 text-muted-foreground"><Mail className="h-3.5 w-3.5" /> {company.email}</div>}
              </div>
            </section>
            <section className="rounded-md border p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium"><UserCheck className="h-4 w-4" /> Match-eigenaar</div>
              <div className="space-y-1 text-sm">
                <div className="font-medium">{assignee ? profileName(assignee) : 'Nog niet toegewezen'}</div>
                <div className="text-muted-foreground">
                  Status sinds {formatDateTime(match.status_changed_at ?? match.created_at)}
                </div>
              </div>
            </section>
            <section className="rounded-md border p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Clock3 className="h-4 w-4" /> Opvolging</div>
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                <div className="rounded bg-muted/40 px-2 py-2">
                  <div className="font-semibold">{tasks.filter((task: any) => task.status !== 'done' && task.status !== 'dismissed').length}</div>
                  <div className="text-[11px] text-muted-foreground">open taken</div>
                </div>
                <div className="rounded bg-muted/40 px-2 py-2">
                  <div className="font-semibold">{notes.length}</div>
                  <div className="text-[11px] text-muted-foreground">notities</div>
                </div>
                <div className="rounded bg-muted/40 px-2 py-2">
                  <div className="font-semibold">{communications.length}</div>
                  <div className="text-[11px] text-muted-foreground">berichten</div>
                </div>
              </div>
            </section>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_390px]">
            <div className="space-y-4">
              <section className="rounded-md border p-4">
                <div className="mb-3 flex items-center gap-2 font-medium"><History className="h-4 w-4" /> Tijdlijn</div>
                <div className="space-y-3">
                  {timeline.length > 0 ? timeline.map((item: any) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.id} className="flex gap-3 rounded-md bg-muted/35 p-3 text-sm">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-background">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-medium">{item.title}</span>
                            <span className="text-xs text-muted-foreground">{formatDateTime(item.at)}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">{item.meta}</div>
                          {item.body && <p className="mt-1 whitespace-pre-line text-xs">{item.body}</p>}
                        </div>
                      </div>
                    );
                  }) : <p className="text-sm text-muted-foreground">Nog geen tijdlijn voor deze match.</p>}
                </div>
              </section>

              <section className="rounded-md border p-4">
                <div className="mb-3 flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4" /> Statuslog</div>
                <div className="space-y-2">
                  {events.length > 0 ? events.map((event: any) => (
                    <div key={event.id} className="rounded-md bg-muted/35 p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{getMatchStatusMeta(event.from_status).label}</Badge>
                        <span className="text-xs text-muted-foreground">naar</span>
                        <Badge className={getMatchStatusMeta(event.to_status).badgeClass}>{getMatchStatusMeta(event.to_status).label}</Badge>
                        <span className="text-xs text-muted-foreground">{formatDateTime(event.created_at)}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Door {profileName(event.profiles)}
                        {event.match_feedback_reasons?.reason ? ` · ${event.match_feedback_reasons.reason}` : ''}
                      </div>
                      {event.notes && <p className="mt-1 whitespace-pre-line text-xs">{event.notes}</p>}
                    </div>
                  )) : <p className="text-sm text-muted-foreground">Nog geen statuswijzigingen met feedback.</p>}
                </div>
              </section>

              <section className="rounded-md border p-4">
                <div className="mb-3 flex items-center gap-2 font-medium"><Mail className="h-4 w-4" /> Voorstelmail & communicatie</div>
                <div className="space-y-2">
                  {communications.length > 0 ? communications.map((item: any) => (
                    <div key={item.id} className="rounded-md bg-muted/40 p-2 text-sm">
                      <div className="font-medium">{item.subject || '(zonder onderwerp)'}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.channel} · {item.message_type || item.direction} · {formatDateTime(item.sent_at ?? item.created_at)}
                      </div>
                      {item.email_to && <div className="mt-1 text-xs text-muted-foreground">Aan: {Array.isArray(item.email_to) ? item.email_to.join(', ') : item.email_to}</div>}
                    </div>
                  )) : <p className="text-sm text-muted-foreground">Nog geen matchcommunicatie.</p>}
                </div>
              </section>
            </div>

            <div className="space-y-4">
              <section className="rounded-md border p-4">
                <div className="mb-3 flex items-center gap-2 font-medium"><UserCheck className="h-4 w-4" /> Toewijzing</div>
                <div className="space-y-2">
                  <Label>Match-eigenaar</Label>
                  <Select
                    value={assignedTo}
                    onValueChange={(value) => {
                      setAssignedTo(value);
                      assignMutation.mutate(value);
                    }}
                    disabled={assignMutation.isPending}
                  >
                    <SelectTrigger><SelectValue placeholder="Niet toegewezen" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED}>Niet toegewezen</SelectItem>
                      {assignees.map((profile: any) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profileName(profile)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {assignee && <p className="text-xs text-muted-foreground">Deze persoon is operationeel verantwoordelijk voor opvolging.</p>}
                </div>
              </section>

              <section className="rounded-md border p-4">
                <div className="mb-3 flex items-center gap-2 font-medium"><CalendarCheck className="h-4 w-4" /> Afspraak</div>
                {!canConfirmInterview && (
                  <Alert className="mb-3">
                    <CalendarCheck className="h-4 w-4" />
                    <AlertTitle>Alleen lezen</AlertTitle>
                    <AlertDescription>Je rol mag afspraakgegevens bekijken, maar niet definitief maken of afspraakmails sturen.</AlertDescription>
                  </Alert>
                )}
                {match.interview_proposed_at && (
                  <p className="mb-3 rounded-md bg-amber-50 p-2 text-sm text-amber-800">
                    Voorgesteld: {formatDateTime(match.interview_proposed_at)}
                    {match.interview_proposed_note ? ` - ${match.interview_proposed_note}` : ''}
                  </p>
                )}
                {match.interview_confirmed_at && (
                  <p className="mb-3 rounded-md bg-emerald-50 p-2 text-sm text-emerald-800">
                    Definitief: {formatDateTime(match.interview_confirmed_at)}
                  </p>
                )}
                <div className="space-y-3">
                  <div>
                    <Label>Definitieve datum & tijd</Label>
                    <Input type="datetime-local" step={900} value={confirmedAt} onChange={(event) => setConfirmedAt(event.target.value)} disabled={!canConfirmInterview} />
                  </div>
                  <div>
                    <Label>Locatie/type</Label>
                    <Input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Kantoor Tilburg / Teams / telefoon" disabled={!canConfirmInterview} />
                  </div>
                  <div>
                    <Label>Afspraaktype</Label>
                    <Select value={interviewType} onValueChange={setInterviewType} disabled={!canConfirmInterview}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="op_kantoor">Op kantoor</SelectItem>
                        <SelectItem value="facetime">FaceTime/video</SelectItem>
                        <SelectItem value="telefonisch">Telefonisch</SelectItem>
                        <SelectItem value="anders">Anders</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Notitie</Label>
                    <Textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} disabled={!canConfirmInterview} />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={notifyCandidate} onCheckedChange={(value) => setNotifyCandidate(value === true)} disabled={!canConfirmInterview} />
                    Mail kandidaat met ICS
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={notifyCompany} onCheckedChange={(value) => setNotifyCompany(value === true)} disabled={!canConfirmInterview} />
                    Mail opdrachtgever met ICS
                  </label>
                  <Button className="w-full" onClick={() => confirmMutation.mutate()} disabled={!canConfirmInterview || confirmMutation.isPending}>
                    {confirmMutation.isPending ? 'Bevestigen...' : 'Afspraak definitief maken'}
                  </Button>
                </div>
              </section>

              <section className="rounded-md border p-4">
                <div className="mb-3 flex items-center gap-2 font-medium"><MessageSquare className="h-4 w-4" /> Notitie toevoegen</div>
                <div className="space-y-3">
                  {notes.length > 0 && (
                    <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                      {notes.slice(0, 6).map((item: any) => (
                        <div key={item.id} className="rounded-md bg-muted/35 p-2 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium">{profileName(item.profiles)}</span>
                            <span className="text-[11px] text-muted-foreground">{formatDateTime(item.created_at)}</span>
                          </div>
                          <p className="mt-1 whitespace-pre-line text-xs">{item.body}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <Textarea
                    rows={3}
                    value={newNote}
                    onChange={(event) => setNewNote(event.target.value)}
                    placeholder="Interne matchnotitie..."
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="w-full gap-1.5"
                    onClick={() => addNoteMutation.mutate()}
                    disabled={!newNote.trim() || addNoteMutation.isPending}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {addNoteMutation.isPending ? 'Opslaan...' : 'Notitie opslaan'}
                  </Button>
                </div>
              </section>

              <section className="rounded-md border p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-medium"><Clock3 className="h-4 w-4" /> Taken</div>
                  <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={openNewTask}>
                    <Plus className="h-3.5 w-3.5" /> Taak
                  </Button>
                </div>
                <div className="space-y-2">
                  {tasks.length > 0 ? tasks.map((task: any) => {
                    const prio = priorityConfig[task.priority] ?? priorityConfig.medium;
                    return (
                      <button
                        key={task.id}
                        type="button"
                        className="w-full rounded-md bg-muted/40 p-2 text-left text-sm transition-colors hover:bg-muted"
                        onClick={() => openEditTask(task)}
                      >
                        <div className="font-medium">{task.title}</div>
                        {task.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{task.description}</p>}
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <Badge variant="secondary" className={cn('text-[10px]', prio.color)}>{prio.label}</Badge>
                          <span>{task.status}</span>
                          {task.due_date && <span>Deadline: {formatDate(task.due_date)}</span>}
                          <span>{profileName(task.profiles)}</span>
                        </div>
                      </button>
                    );
                  }) : <p className="text-sm text-muted-foreground">Geen open taken gevonden.</p>}
                </div>
              </section>

              <section className="rounded-md border p-4">
                <div className="mb-3 flex items-center gap-2 font-medium"><History className="h-4 w-4" /> Laatste audit</div>
                <div className="space-y-2">
                  {auditLogs.length > 0 ? auditLogs.slice(0, 5).map((entry: any) => (
                    <div key={entry.id} className="rounded-md bg-muted/35 p-2 text-xs">
                      <div className="font-medium">{summarizeAudit(entry)}</div>
                      <div className="text-muted-foreground">{formatDateTime(entry.created_at)} · {profileName(entry.profiles)}</div>
                      </div>
                  )) : <p className="text-sm text-muted-foreground">Nog geen auditregels voor deze match.</p>}
                </div>
              </section>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setWhyOpen(true)}>Score-uitleg</Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Sluiten</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TaskEditorSheet
        open={taskEditorOpen}
        onOpenChange={setTaskEditorOpen}
        task={editingTask ?? undefined}
        lockedEntity={{ type: 'match', id: match.id }}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ['match-tasks', match?.id] });
          qc.invalidateQueries({ queryKey: ['match-audit-log', match?.id] });
        }}
      />

      <MatchInspectorDialog
        open={whyOpen}
        onOpenChange={setWhyOpen}
        title="Score-uitleg"
        description={`${fullName(candidate)} - ${vacancy?.title ?? 'vacature'}`}
        breakdown={match.match_breakdown ?? null}
        candidateQuality={match.match_breakdown?.candidateQuality ?? null}
        candidate={candidate}
        vacancyContext={[
          { label: 'Vacature', value: vacancy?.title },
          { label: 'Opdrachtgever', value: company?.name },
          { label: 'Status', value: statusMeta.label },
        ]}
      />
    </>
  );
};

export default MatchDetailDialog;
