import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Bell, GitCompareArrows, Mail, Search, User, Building2, Briefcase, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';

const COLUMNS = [
  { key: 'nieuwe_match', label: 'Nieuwe match', color: 'bg-amber-500' },
  { key: 'gescreend', label: 'Gescreend', color: 'bg-cyan-500' },
  { key: 'voorgesteld', label: 'Voorgesteld', color: 'bg-slate-400' },
  { key: 'voorgesteld_bij_klant', label: 'Bij klant', color: 'bg-indigo-500' },
  { key: 'in_gesprek', label: 'In gesprek', color: 'bg-blue-500' },
  { key: 'geaccepteerd', label: 'Geaccepteerd', color: 'bg-emerald-500' },
  { key: 'afgewezen', label: 'Afgewezen', color: 'bg-red-500' },
] as const;

const sourceLabel: Record<string, string> = {
  sollicitatie: 'Sollicitatie',
  website_sollicitatie: 'Website sollicitatie',
  public_signup: 'Website intake',
  intern_gematcht: 'Intern',
  eigen_match: 'Eigen match',
  jobmarket: 'Jobmarket',
  extern: 'Extern',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  carerix: 'Carerix',
};

type PipelineScope = 'active' | 'archive' | 'all';

const PIPELINE_SCOPES: { key: PipelineScope; label: string }[] = [
  { key: 'active', label: 'Actueel' },
  { key: 'archive', label: 'Gesloten/vervuld' },
  { key: 'all', label: 'Alles' },
];

const MATCH_PIPELINE_PAGE_SIZE = 1000;
const MATCH_PIPELINE_SELECT =
  '*, candidates!matches_candidate_id_fkey(id, first_name, last_name, phone, email, compliance_status, portal_enabled), vacancies!inner(id, title, status, companies!vacancies_company_id_fkey(id, name))';

async function fetchMatchPipelinePage(orgId: string | null | undefined, pipelineScope: PipelineScope, from: number, to: number) {
  let query = supabase
    .from('matches')
    .select(MATCH_PIPELINE_SELECT)
    .eq('organization_id', orgId)
    .neq('status', 'geplaatst')
    .order('created_at', { ascending: false })
    .range(from, to);

  if (pipelineScope === 'active') {
    query = query.eq('vacancies.status', 'open' as any);
  } else if (pipelineScope === 'archive') {
    query = query.in('vacancies.status', ['gesloten', 'vervuld'] as any);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

async function fetchAllMatchPipelineRows(orgId: string | null | undefined, pipelineScope: PipelineScope) {
  const rows: any[] = [];

  for (let page = 0; ; page += 1) {
    const from = page * MATCH_PIPELINE_PAGE_SIZE;
    const to = from + MATCH_PIPELINE_PAGE_SIZE - 1;
    const pageRows = await fetchMatchPipelinePage(orgId, pipelineScope, from, to);
    rows.push(...pageRows);

    if (pageRows.length < MATCH_PIPELINE_PAGE_SIZE) break;
  }

  return rows;
}

const MatchPipeline = () => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [vacancyFilter, setVacancyFilter] = useState('all');
  const [pipelineScope, setPipelineScope] = useState<PipelineScope>('active');
  const [selectedMatchIds, setSelectedMatchIds] = useState<Set<string>>(new Set());

  const { data: matches = [], isLoading } = useQuery({
    queryKey: ['match-pipeline', orgId, pipelineScope],
    queryFn: () => fetchAllMatchPipelineRows(orgId, pipelineScope),
    enabled: !!orgId,
  });

  const statusMutation = useMutation({
    mutationFn: async ({ matchId, status }: { matchId: string; status: string }) => {
      const { error } = await supabase
        .from('matches')
        .update({ status: status as any, status_changed_at: new Date().toISOString() })
        .eq('id', matchId);
      if (error) throw error;
    },
    onMutate: async ({ matchId, status }) => {
      await qc.cancelQueries({ queryKey: ['match-pipeline', orgId, pipelineScope] });
      const previous = qc.getQueryData<any[]>(['match-pipeline', orgId, pipelineScope]);
      qc.setQueryData<any[]>(['match-pipeline', orgId, pipelineScope], (old) =>
        (old ?? []).map((m: any) => (m.id === matchId ? { ...m, status } : m))
      );
      return { previous };
    },
    onError: (e: any, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(['match-pipeline', orgId, pipelineScope], ctx.previous);
      toast.error(e.message);
    },
    onSuccess: (_data, vars) => {
      toast.success(`Status gewijzigd naar ${COLUMNS.find(c => c.key === vars.status)?.label ?? vars.status}`);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['match-pipeline', orgId] });
      qc.invalidateQueries({ queryKey: ['vacancy-matches'] });
    },
  });

  const bulkNotifyMutation = useMutation({
    mutationFn: async (matchIds: string[]) => {
      const selectedMatches = (matches as any[]).filter((match) => matchIds.includes(match.id));
      if (selectedMatches.length === 0) throw new Error('Selecteer eerst matches');

      const now = new Date().toISOString();
      const notificationRows = selectedMatches.map((match) => {
        const candidate = match.candidates;
        const vacancy = match.vacancies;
        const company = vacancy?.companies as any;
        return {
          organization_id: orgId,
          candidate_id: candidate?.id ?? null,
          type: 'overig',
          severity: 'info',
          title: `Nieuwe vacature: ${vacancy?.title ?? 'vacature'}`,
          message: `${company?.name ? `${company.name} zoekt versterking. ` : ''}Je recruiter heeft je gematcht op deze vacature en neemt contact met je op.`,
          reference_table: 'matches',
          reference_id: match.id,
          created_at: now,
        };
      });

      const emailRows = selectedMatches
        .filter((match) => Boolean(match.candidates?.email))
        .map((match) => {
          const candidate = match.candidates;
          const vacancy = match.vacancies;
          const company = vacancy?.companies as any;
          const subject = `Nieuwe vacature: ${vacancy?.title ?? 'mogelijk passende functie'}`;
          const body = [
            `Hoi ${candidate?.first_name ?? ''},`,
            '',
            `We hebben een mogelijke match voor je gevonden: ${vacancy?.title ?? 'een passende vacature'}${company?.name ? ` bij ${company.name}` : ''}.`,
            'Je recruiter neemt contact met je op om de details en je interesse te bespreken.',
            '',
            'Met vriendelijke groet,',
            'JA Werkt',
          ].join('\n');

          return {
            organization_id: orgId,
            candidate_id: candidate.id,
            channel: 'email',
            direction: 'outbound',
            subject,
            body,
            email_to: [candidate.email],
            sent_at: now,
            sent_by: user?.id ?? null,
            message_type: 'bulk_match_notification',
          };
        });

      const { error: notificationError } = await supabase
        .from('employee_notifications')
        .insert(notificationRows as any[]);
      if (notificationError) throw notificationError;

      if (emailRows.length > 0) {
        const { error: communicationError } = await supabase
          .from('communications')
          .insert(emailRows as any[]);
        if (communicationError) throw communicationError;
      }

      return {
        notifications: notificationRows.length,
        emails: emailRows.length,
      };
    },
    onSuccess: (result) => {
      setSelectedMatchIds(new Set());
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['communications'] });
      toast.success(`${result.notifications} appmeldingen en ${result.emails} e-mailrecords aangemaakt`);
    },
    onError: (error: any) => toast.error(error.message ?? 'Bulknotificaties mislukt'),
  });

  const onDragEnd = (result: DropResult) => {
    const { draggableId, destination, source } = result;
    if (!destination || destination.droppableId === source.droppableId) return;
    statusMutation.mutate({ matchId: draggableId, status: destination.droppableId });
  };

  const setScope = (scope: PipelineScope) => {
    setPipelineScope(scope);
    setVacancyFilter('all');
    setSelectedMatchIds(new Set());
  };

  // Get unique vacancies for filter
  const vacancyEntries = (matches as any[])
    .map((m: any): [string, any] | null => (m.vacancies?.id ? [m.vacancies.id, m.vacancies] : null))
    .filter((entry): entry is [string, any] => entry !== null);
  const vacancies = Array.from(
    new Map<string, any>(vacancyEntries).values()
  );

  // Filter matches
  const filtered = (matches as any[]).filter((m: any) => {
    if (vacancyFilter !== 'all' && m.vacancy_id !== vacancyFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      const name = `${m.candidates?.first_name ?? ''} ${m.candidates?.last_name ?? ''}`.toLowerCase();
      const vacancy = m.vacancies?.title?.toLowerCase() ?? '';
      const company = (m.vacancies?.companies as any)?.name?.toLowerCase() ?? '';
      if (!name.includes(s) && !vacancy.includes(s) && !company.includes(s)) return false;
    }
    return true;
  });

  const selectedVisibleMatches = filtered.filter((match) => selectedMatchIds.has(match.id));
  const selectedCount = selectedVisibleMatches.length;
  const canToggleVisible = filtered.length > 0;
  const allVisibleSelected = canToggleVisible && filtered.every((match) => selectedMatchIds.has(match.id));

  const toggleMatch = (matchId: string) => {
    setSelectedMatchIds((current) => {
      const next = new Set(current);
      if (next.has(matchId)) next.delete(matchId);
      else next.add(matchId);
      return next;
    });
  };

  const toggleVisibleMatches = () => {
    setSelectedMatchIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        filtered.forEach((match) => next.delete(match.id));
      } else {
        filtered.forEach((match) => next.add(match.id));
      }
      return next;
    });
  };

  // Group by status
  const grouped: Record<string, any[]> = {};
  for (const col of COLUMNS) grouped[col.key] = [];
  for (const m of filtered) {
    if (grouped[m.status]) grouped[m.status].push(m);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Match Pipeline</h1>
          <Badge variant="secondary" className="ml-2">{filtered.length} matches</Badge>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="inline-flex w-fit rounded-md border bg-card p-1">
          {PIPELINE_SCOPES.map((scope) => (
            <Button
              key={scope.key}
              type="button"
              variant={pipelineScope === scope.key ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8 rounded-sm px-3"
              aria-pressed={pipelineScope === scope.key}
              onClick={() => setScope(scope.key)}
            >
              {scope.label}
            </Button>
          ))}
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Zoek op kandidaat, functietitel of opdrachtgever..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={vacancyFilter} onValueChange={setVacancyFilter}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Vacature" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle vacatures</SelectItem>
            {vacancies.map((v: any) => (
              <SelectItem key={v.id} value={v.id}>
                {v.title} - {(v.companies as any)?.name ?? 'Opdrachtgever onbekend'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={allVisibleSelected}
            onCheckedChange={toggleVisibleMatches}
            disabled={!canToggleVisible}
          />
          <span>{allVisibleSelected ? 'Zichtbare matches geselecteerd' : 'Selecteer zichtbare matches'}</span>
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="text-sm text-muted-foreground">{selectedCount} geselecteerd</span>
          <Button
            type="button"
            size="sm"
            onClick={() => bulkNotifyMutation.mutate(selectedVisibleMatches.map((match) => match.id))}
            disabled={selectedCount === 0 || bulkNotifyMutation.isPending}
          >
            {bulkNotifyMutation.isPending ? (
              <>
                <Bell className="mr-2 h-4 w-4 animate-pulse" />
                Aanmaken...
              </>
            ) : (
              <>
                <Mail className="mr-2 h-4 w-4" />
                Notificeer kandidaten
              </>
            )}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-center py-12">Laden...</div>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-4">
            {COLUMNS.map(col => (
              <Droppable key={col.key} droppableId={col.key}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={cn(
                      'flex-shrink-0 w-64 rounded-lg p-2 transition-colors',
                      snapshot.isDraggingOver && 'bg-accent/50'
                    )}
                  >
                    <div className="flex items-center gap-2 mb-3 px-1">
                      <div className={cn('w-2 h-2 rounded-full', col.color)} />
                      <span className="text-sm font-medium">{col.label}</span>
                      <Badge variant="outline" className="text-xs ml-auto">{grouped[col.key].length}</Badge>
                    </div>
                    <div className="space-y-2 min-h-[200px]">
                      {grouped[col.key].map((m: any, index: number) => (
                        <Draggable key={m.id} draggableId={m.id} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className={cn(snapshot.isDragging && 'opacity-90')}
                            >
                              <MatchCard
                                match={m}
                                selected={selectedMatchIds.has(m.id)}
                                onToggle={() => toggleMatch(m.id)}
                              />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  </div>
                )}
              </Droppable>
            ))}
          </div>
        </DragDropContext>
      )}
    </div>
  );
};

function MatchCard({ match, selected, onToggle }: { match: any; selected: boolean; onToggle: () => void }) {
  const candidate = match.candidates;
  const vacancy = match.vacancies;
  const company = vacancy?.companies as any;

  return (
    <Card className="hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing">
      <CardContent className="p-3 space-y-2">
        <Link to={`/vacatures/${vacancy?.id}`} className="block" onClick={e => e.stopPropagation()}>
          <div className="flex items-start justify-between gap-1">
            <div className="flex items-center gap-1.5 text-sm font-medium truncate">
              <span onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                <Checkbox
                  checked={selected}
                  onCheckedChange={onToggle}
                  aria-label={`Selecteer match ${candidate?.first_name ?? ''} ${candidate?.last_name ?? ''}`}
                  className="mr-0.5"
                />
              </span>
              <User className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span className="truncate">{candidate?.first_name} {candidate?.last_name}</span>
            </div>
            {match.match_score != null && (
              <div className="flex items-center gap-0.5 text-xs text-amber-600 flex-shrink-0">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                {Math.round(match.match_score)}%
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
            <Briefcase className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{vacancy?.title ?? '—'}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Building2 className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{company?.name ?? '—'}</span>
          </div>
        </Link>
        {match.source && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {sourceLabel[match.source] ?? match.source}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

export default MatchPipeline;
