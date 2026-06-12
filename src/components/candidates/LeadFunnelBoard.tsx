import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd';
import { AlertCircle, CheckCircle2, FileText, Mail, Phone, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/format';

const FUNNEL_COLUMNS = [
  {
    key: 'lead',
    label: 'Nieuwe instroom',
    description: 'Nieuw via de website — nog niet opgepakt',
    statuses: ['lead'],
    color: 'bg-sky-500',
  },
  {
    key: 'in_behandeling',
    label: 'In behandeling',
    description: 'Recruiter volgt op',
    statuses: ['in_behandeling'],
    color: 'bg-amber-500',
  },
  {
    key: 'in_screening',
    label: 'Screening',
    description: 'Check op profiel en documenten',
    statuses: ['in_screening'],
    color: 'bg-cyan-500',
  },
  {
    key: 'werkzoekend',
    label: 'Toelaten als kandidaat',
    description: 'Besluit met notitie',
    statuses: [],
    color: 'bg-emerald-500',
    requiresNote: true,
    emptyText: 'Sleep hierheen om door te zetten naar kandidaat.',
  },
  {
    key: 'afgewezen',
    label: 'Geen kandidaat',
    description: 'Afgewezen met reden',
    statuses: ['afgewezen'],
    color: 'bg-red-500',
    requiresNote: true,
  },
] as const;

// Instroomfunnel = nieuwe website-instroom (candidate-signup zet status 'lead').
// Carerix-imports staan op 'nieuw' en horen NIET in instroom maar in de kandidatenlijst.
const VISIBLE_STATUSES = ['lead', 'in_behandeling', 'in_screening', 'afgewezen'] as const;

const statusLabel: Record<string, string> = {
  lead: 'Lead',
  nieuw: 'Nieuw',
  in_behandeling: 'In behandeling',
  in_screening: 'In screening',
  afgewezen: 'Geen kandidaat',
};

const sourceLabel: Record<string, string> = {
  public_signup: 'Website intake',
  website_sollicitatie: 'Website sollicitatie',
  sollicitatie: 'Sollicitatie',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  carerix: 'Carerix',
};

const decisionTitle: Record<string, string> = {
  werkzoekend: 'Toelaten als kandidaat',
  afgewezen: 'Geen kandidaat',
};

type PendingDecision = {
  candidateId: string;
  candidateName: string;
  toStatus: string;
};

const candidateDisplayName = (candidate: any) =>
  `${candidate.first_name ?? ''} ${candidate.last_name ?? ''}`.trim() || 'Onbekende kandidaat';

const LeadFunnelBoard = () => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [pendingDecision, setPendingDecision] = useState<PendingDecision | null>(null);
  const [decisionNote, setDecisionNote] = useState('');

  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ['lead-funnel', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidates')
        .select('id, first_name, last_name, email, phone, status, source, created_at, updated_at, skills, cv_file_url, cv_raw_text, ai_reliability_score, ai_status, ai_summary')
        .eq('organization_id', orgId)
        .in('status', VISIBLE_STATUSES as any)
        .order('updated_at', { ascending: false })
        .limit(250);
      if (error) throw error;
      return data ?? [];
    },
  });

  const grouped = useMemo(() => {
    const byColumn: Record<string, any[]> = {};
    for (const column of FUNNEL_COLUMNS) byColumn[column.key] = [];
    for (const candidate of candidates as any[]) {
      const column = FUNNEL_COLUMNS.find((item) => item.statuses.includes(candidate.status as never));
      if (column) byColumn[column.key].push(candidate);
    }
    return byColumn;
  }, [candidates]);

  const statusMutation = useMutation({
    mutationFn: async ({ candidateId, toStatus, note }: { candidateId: string; toStatus: string; note?: string }) => {
      if (!user?.id) throw new Error('Geen gebruiker gevonden');
      const now = new Date().toISOString();
      const { data: currentCandidate, error: currentError } = await supabase
        .from('candidates')
        .select('id, status')
        .eq('id', candidateId)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (currentError) throw currentError;
      if (!currentCandidate) throw new Error('Lead niet gevonden');

      const { error: candidateError } = await supabase
        .from('candidates')
        .update({ status: toStatus as any, updated_at: now } as any)
        .eq('id', candidateId)
        .eq('organization_id', orgId);
      if (candidateError) throw candidateError;

      if (note?.trim()) {
        const title = decisionTitle[toStatus] ?? 'Instroomstatus bijgewerkt';
        const { error: noteError } = await supabase.from('notes').insert({
          body: [
            `${title}: ${note.trim()}`,
            '',
            `Instroombesluit: ${currentCandidate.status ?? 'onbekend'} -> ${toStatus}.`,
            'Geen nieuw kandidaatrecord aangemaakt; de bestaande lead is bijgewerkt.',
          ].join('\n'),
          is_internal: true,
          related_entity_id: candidateId,
          related_entity_type: 'kandidaat',
          created_by: user.id,
          organization_id: orgId,
        });
        if (noteError) throw noteError;
      }

      if (toStatus === 'werkzoekend' || toStatus === 'afgewezen') {
        const { error: taskError } = await supabase
          .from('recruiter_tasks' as any)
          .update({ status: 'done', completed_at: now, updated_at: now })
          .eq('organization_id', orgId)
          .eq('related_entity_type', 'kandidaat')
          .eq('related_entity_id', candidateId)
          .eq('status', 'open')
          .in('category', ['lead intake', 'vacature sollicitatie', 'cv intake']);
        if (taskError) throw taskError;

        const { error: notificationError } = await supabase
          .from('employee_notifications')
          .update({ is_read: true, is_dismissed: true, read_at: now, read_by: user.id })
          .eq('organization_id', orgId)
          .eq('candidate_id', candidateId)
          .in('reference_table', ['candidates', 'matches']);
        if (notificationError) throw notificationError;
      }
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['lead-funnel', orgId] });
      qc.invalidateQueries({ queryKey: ['candidates'] });
      qc.invalidateQueries({ queryKey: ['notes'] });
      qc.invalidateQueries({ queryKey: ['recruiter-tasks'] });
      qc.invalidateQueries({ queryKey: ['tasks-overview'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      toast.success(vars.toStatus === 'werkzoekend' ? 'Lead toegelaten als kandidaat' : 'Instroomstatus bijgewerkt');
      setPendingDecision(null);
      setDecisionNote('');
    },
    onError: (error: any) => toast.error(error.message ?? 'Status kon niet worden bijgewerkt'),
  });

  const onDragEnd = (result: DropResult) => {
    const { destination, draggableId, source } = result;
    if (!destination || destination.droppableId === source.droppableId) return;
    const destinationColumn = FUNNEL_COLUMNS.find((column) => column.key === destination.droppableId);
    const candidate = (candidates as any[]).find((item) => item.id === draggableId);
    if (!destinationColumn || !candidate) return;

    if ('requiresNote' in destinationColumn && destinationColumn.requiresNote) {
      setPendingDecision({
        candidateId: candidate.id,
        candidateName: candidateDisplayName(candidate),
        toStatus: destinationColumn.key,
      });
      setDecisionNote('');
      return;
    }

    statusMutation.mutate({ candidateId: candidate.id, toStatus: destinationColumn.key });
  };

  const submitDecision = () => {
    if (!pendingDecision) return;
    if (!decisionNote.trim()) {
      toast.error('Leg kort vast waarom je dit besluit neemt');
      return;
    }
    statusMutation.mutate({
      candidateId: pendingDecision.candidateId,
      toStatus: pendingDecision.toStatus,
      note: decisionNote,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Instroomfunnel</h2>
          <p className="text-sm text-muted-foreground">Beoordeel nieuwe leads en zet alleen geschikte profielen door naar kandidaat.</p>
        </div>
        <Badge variant="secondary" className="w-fit">{candidates.length} actieve instroomkaarten</Badge>
      </div>

      {isLoading ? (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">Instroom laden...</div>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-4">
            {FUNNEL_COLUMNS.map((column) => {
              const columnCandidates = grouped[column.key] ?? [];
              return (
                <Droppable key={column.key} droppableId={column.key}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={cn(
                        'flex-shrink-0 w-72 rounded-lg bg-muted/40 p-2 transition-colors',
                        snapshot.isDraggingOver && 'bg-accent/60'
                      )}
                    >
                      <div className="mb-3 flex items-start gap-2 px-1">
                        <div className={cn('mt-1 h-2 w-2 rounded-full', column.color)} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{column.label}</div>
                          <div className="text-[11px] text-muted-foreground">{column.description}</div>
                        </div>
                        {column.statuses.length > 0 && (
                          <Badge variant="outline" className="ml-auto text-xs">{columnCandidates.length}</Badge>
                        )}
                      </div>
                      <div className="min-h-[180px] space-y-2">
                        {columnCandidates.map((candidate: any, index: number) => (
                          <Draggable key={candidate.id} draggableId={candidate.id} index={index}>
                            {(dragProvided, dragSnapshot) => (
                              <div
                                ref={dragProvided.innerRef}
                                {...dragProvided.draggableProps}
                                {...dragProvided.dragHandleProps}
                                className={cn(dragSnapshot.isDragging && 'opacity-90')}
                              >
                                <CandidateCard candidate={candidate} />
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {columnCandidates.length === 0 && (
                          <div className="rounded-md border border-dashed bg-background/70 px-3 py-6 text-center text-xs text-muted-foreground">
                            {'emptyText' in column ? column.emptyText : 'Geen kaarten'}
                          </div>
                        )}
                        {provided.placeholder}
                      </div>
                    </div>
                  )}
                </Droppable>
              );
            })}
          </div>
        </DragDropContext>
      )}

      <Dialog open={!!pendingDecision} onOpenChange={(open) => { if (!open) setPendingDecision(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pendingDecision ? decisionTitle[pendingDecision.toStatus] : 'Besluit vastleggen'}</DialogTitle>
            <DialogDescription>
              Leg kort vast waarom {pendingDecision?.candidateName} deze stap krijgt. De bestaande lead wordt bijgewerkt; er wordt geen nieuw kandidaatrecord aangemaakt.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="lead-decision-note">Notitie *</Label>
            <Textarea
              id="lead-decision-note"
              value={decisionNote}
              onChange={(event) => setDecisionNote(event.target.value)}
              rows={4}
              placeholder="Bijv. CV passend, telefonisch akkoord, of reden waarom dit profiel niet verder gaat."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDecision(null)}>Annuleren</Button>
            <Button onClick={submitDecision} disabled={statusMutation.isPending}>
              {statusMutation.isPending ? 'Opslaan...' : 'Status bijwerken'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

function CandidateCard({ candidate }: { candidate: any }) {
  const hasCv = Boolean(candidate.cv_file_url || candidate.cv_raw_text);
  const source = candidate.source ? sourceLabel[candidate.source] ?? candidate.source.replace(/[_-]/g, ' ') : null;
  const score = typeof candidate.ai_reliability_score === 'number' ? Math.round(candidate.ai_reliability_score) : null;
  const skills = Array.isArray(candidate.skills) ? candidate.skills : [];

  return (
    <Card className="cursor-grab transition-shadow hover:shadow-md active:cursor-grabbing">
      <CardContent className="space-y-3 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link to={`/kandidaten/${candidate.id}`} className="block truncate text-sm font-medium hover:text-primary">
              {candidateDisplayName(candidate)}
            </Link>
            <div className="mt-1 flex flex-wrap gap-1">
              <Badge variant="secondary" className="text-[10px]">{statusLabel[candidate.status] ?? candidate.status}</Badge>
              {source && <Badge variant="outline" className="text-[10px]">{source}</Badge>}
            </div>
          </div>
          {candidate.status === 'afgewezen' ? (
            <AlertCircle className="h-4 w-4 flex-shrink-0 text-red-500" />
          ) : (
            <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-muted-foreground/50" />
          )}
        </div>

        <div className="space-y-1 text-xs text-muted-foreground">
          {candidate.email && (
            <div className="flex items-center gap-1.5 truncate">
              <Mail className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{candidate.email}</span>
            </div>
          )}
          {candidate.phone && (
            <div className="flex items-center gap-1.5 truncate">
              <Phone className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{candidate.phone}</span>
            </div>
          )}
        </div>

        {skills.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {skills.slice(0, 3).map((skill: string) => (
              <Badge key={skill} variant="outline" className="text-[10px]">{skill}</Badge>
            ))}
            {skills.length > 3 && <Badge variant="outline" className="text-[10px]">+{skills.length - 3}</Badge>}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>{formatRelativeTime(candidate.updated_at ?? candidate.created_at)}</span>
          <span className="flex items-center gap-1">
            {hasCv && <FileText className="h-3 w-3" />}
            {score !== null && (
              <>
                <Sparkles className="h-3 w-3" />
                {score}%
              </>
            )}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default LeadFunnelBoard;
