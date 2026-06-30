import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Bell, Columns3, GitCompareArrows, GripVertical, List, Mail, Search, ShieldAlert } from 'lucide-react';
import MatchRow from '@/components/matches/MatchRow';
import MatchFeedbackDialog from '@/components/matches/MatchFeedbackDialog';
import MatchDetailDialog from '@/components/matches/MatchDetailDialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { unwrap } from '@/lib/db';
import { MATCH_STATUS_STEPS, isTerminalMatchStatus, matchStatusNeedsFeedbackDialog } from '@/lib/match-status';
import { normalizeMatchPipelineFollowupDays } from '@/lib/match-followup';
import { roleHasPermission } from '@/lib/permissions';

const COLUMNS = MATCH_STATUS_STEPS;

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
type PipelineViewMode = 'kanban' | 'list';

const PIPELINE_SCOPES: { key: PipelineScope; label: string }[] = [
  { key: 'active', label: 'Actueel' },
  { key: 'archive', label: 'Gesloten/vervuld' },
  { key: 'all', label: 'Alles' },
];

const MATCH_PIPELINE_PAGE_SIZE = 1000;
const MATCH_PIPELINE_SELECT =
  '*, assignee:profiles!matches_assigned_to_fkey(id, full_name, email), candidates!matches_candidate_id_fkey(id, first_name, last_name, phone, phone_nl, email, compliance_status, portal_enabled, available_from, available_until, arrival_date, availability_notes, ai_analysis, ai_summary, ai_classification, ai_reliability_score, screening_data, screened_at, skills, certifications, languages, has_drivers_license, has_dutch_address, address_city), vacancies!inner(id, title, status, created_by, companies!vacancies_company_id_fkey(id, name, email))';

async function readFunctionError(error: any, fallback: string) {
  const response = error?.context;
  if (!response || typeof response.clone !== 'function') return error?.message || fallback;

  try {
    const data = await response.clone().json();
    return data?.error || data?.message || fallback;
  } catch {
    return error?.message || fallback;
  }
}

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
  const { user, role, loading: authLoading } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [vacancyFilter, setVacancyFilter] = useState('all');
  const [pipelineScope, setPipelineScope] = useState<PipelineScope>('active');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<PipelineViewMode>('kanban');
  const [selectedMatchIds, setSelectedMatchIds] = useState<Set<string>>(new Set());
  const [feedbackRequest, setFeedbackRequest] = useState<{ matchIds: string[]; toStatus: string } | null>(null);
  const [feedbackReasonId, setFeedbackReasonId] = useState('');
  const [feedbackNotes, setFeedbackNotes] = useState('');
  const [detailMatch, setDetailMatch] = useState<any | null>(null);

  const { data: matches = [], isLoading } = useQuery({
    queryKey: ['match-pipeline', orgId, pipelineScope],
    queryFn: () => fetchAllMatchPipelineRows(orgId, pipelineScope),
    enabled: !!orgId,
  });

  const { data: pipelineSettings, isLoading: settingsLoading } = useQuery({
    queryKey: ['match-pipeline-settings', orgId],
    queryFn: async () => {
      const data = await unwrap(supabase.from('organizations').select('settings').eq('id', orgId!).single());
      return data?.settings as Record<string, unknown> | null;
    },
    enabled: !!orgId,
  });
  const followupDays = normalizeMatchPipelineFollowupDays((pipelineSettings as any)?.match_pipeline_followup_days);
  const rolePermissionSettings = (pipelineSettings as any)?.role_permissions;
  const canViewPipeline = roleHasPermission(role, 'matching.pipeline.view', rolePermissionSettings);
  const canUpdateStatus = roleHasPermission(role, 'matching.status.update', rolePermissionSettings);
  const canBulkUpdateStatus = roleHasPermission(role, 'matching.status.bulk_update', rolePermissionSettings);
  const canDragDrop = canUpdateStatus && roleHasPermission(role, 'matching.drag_drop', rolePermissionSettings);
  const canWriteFeedback = roleHasPermission(role, 'matching.feedback.write', rolePermissionSettings);
  const canNotifyCandidates = roleHasPermission(role, 'matching.notify_candidates', rolePermissionSettings);
  const canConfirmInterview = roleHasPermission(role, 'matching.interview.confirm', rolePermissionSettings);
  const canUseBulkActions = canBulkUpdateStatus || canNotifyCandidates;

  const { data: feedbackReasons = [] } = useQuery({
    queryKey: ['match-feedback-reasons', orgId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('match_feedback_reasons')
        .select('*')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orgId,
  });

  const persistMatchStatus = async ({
    matchId,
    status,
    reasonId,
    notes,
  }: {
    matchId: string;
    status: string;
    reasonId?: string | null;
    notes?: string | null;
  }) => {
    if (!canUpdateStatus) throw new Error('Je rol mag matchstatussen niet wijzigen');
    if ((reasonId || notes || matchStatusNeedsFeedbackDialog(status) || isTerminalMatchStatus(status)) && !canWriteFeedback) {
      throw new Error('Je rol mag geen matchfeedback vastleggen');
    }
    if (status === 'afgewezen' && !reasonId) throw new Error('Kies een feedbackreden voor afwijzen');
    const current = (matches as any[]).find((match) => match.id === matchId);
    await unwrap(supabase
      .from('matches')
      .update({ status: status as any, status_changed_at: new Date().toISOString() })
      .eq('organization_id', orgId)
      .eq('id', matchId));

    if (reasonId || notes || isTerminalMatchStatus(status)) {
      await unwrap((supabase as any).from('match_feedback_events').insert({
        organization_id: orgId,
        match_id: matchId,
        from_status: current?.status ?? null,
        to_status: status,
        reason_id: reasonId ?? null,
        notes: notes?.trim() || null,
        created_by: user?.id ?? null,
        match_score_snapshot: current?.match_score ?? null,
        match_breakdown_snapshot: current?.match_breakdown ?? null,
      }));
    }
  };

  const statusMutation = useMutation({
    mutationFn: persistMatchStatus,
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
      if (!canNotifyCandidates) throw new Error('Je rol mag geen bulknotificaties aanmaken');
      if (matchIds.length === 0) throw new Error('Selecteer eerst matches');
      const { data, error } = await supabase.functions.invoke('match-bulk-notify', {
        body: { match_ids: matchIds },
      });
      if (error) throw new Error(await readFunctionError(error, 'Bulknotificaties mislukt'));
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as {
        app_notifications: number;
        email_records: number;
        whatsapp_records: number;
        skipped?: Record<string, number>;
      };
    },
    onSuccess: (result) => {
      setSelectedMatchIds(new Set());
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['communications'] });
      const skipped = Object.values(result.skipped ?? {}).reduce((sum, value) => sum + Number(value ?? 0), 0);
      toast.success(`${result.app_notifications} appmeldingen, ${result.email_records} e-mailrecords en ${result.whatsapp_records} WhatsApp-concepten aangemaakt`);
      if (skipped > 0) toast.info(`${skipped} kanaalacties overgeslagen door voorkeuren, ontbrekende gegevens of duplicaten`);
    },
    onError: (error: any) => toast.error(error.message ?? 'Bulknotificaties mislukt'),
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async ({
      matchIds,
      status,
      reasonId,
      notes,
    }: {
      matchIds: string[];
      status: string;
      reasonId?: string | null;
      notes?: string | null;
    }) => {
      if (!canBulkUpdateStatus) throw new Error('Je rol mag geen bulkstatussen wijzigen');
      if (matchIds.length === 0) throw new Error('Selecteer eerst matches');
      for (const matchId of matchIds) {
        await persistMatchStatus({ matchId, status, reasonId, notes });
      }
      return { count: matchIds.length, status };
    },
    onSuccess: ({ count, status }) => {
      setSelectedMatchIds(new Set());
      qc.invalidateQueries({ queryKey: ['match-pipeline', orgId] });
      qc.invalidateQueries({ queryKey: ['vacancy-matches'] });
      toast.success(`${count} match${count === 1 ? '' : 'es'} verplaatst naar ${COLUMNS.find((c) => c.key === status)?.label ?? status}`);
    },
    onError: (error: any) => toast.error(error.message ?? 'Status wijzigen mislukt'),
  });

  const setScope = (scope: PipelineScope) => {
    setPipelineScope(scope);
    setVacancyFilter('all');
    setStatusFilter('all');
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

  // Statusfilter-chips bepalen wat zichtbaar is (i.p.v. kanban-kolommen).
  const visible = statusFilter === 'all' ? filtered : filtered.filter((m: any) => m.status === statusFilter);

  const selectedVisibleMatches = visible.filter((match) => selectedMatchIds.has(match.id));
  const selectedCount = selectedVisibleMatches.length;
  const canToggleVisible = visible.length > 0;
  const allVisibleSelected = canToggleVisible && visible.every((match) => selectedMatchIds.has(match.id));

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
        visible.forEach((match) => next.delete(match.id));
      } else {
        visible.forEach((match) => next.add(match.id));
      }
      return next;
    });
  };

  const changeStatus = (matchIds: string[], status: string) => {
    if (matchIds.length === 0) return;
    if (matchIds.length > 1 && !canBulkUpdateStatus) {
      toast.error('Je rol mag geen bulkstatussen wijzigen');
      return;
    }
    if (matchIds.length === 1 && !canUpdateStatus) {
      toast.error('Je rol mag matchstatussen niet wijzigen');
      return;
    }
    if (matchStatusNeedsFeedbackDialog(status) && !canWriteFeedback) {
      toast.error('Je rol mag geen matchfeedback vastleggen');
      return;
    }
    if (matchStatusNeedsFeedbackDialog(status)) {
      setFeedbackRequest({ matchIds, toStatus: status });
      setFeedbackReasonId('');
      setFeedbackNotes('');
      return;
    }
    if (matchIds.length === 1) {
      statusMutation.mutate({ matchId: matchIds[0], status });
    } else {
      bulkStatusMutation.mutate({ matchIds, status });
    }
  };

  const onDragEnd = (result: DropResult) => {
    const { destination, draggableId, source } = result;
    if (!destination || destination.droppableId === source.droppableId) return;
    if (!canDragDrop) {
      toast.error('Je rol mag matches niet via Kanban verplaatsen');
      return;
    }
    changeStatus([draggableId], destination.droppableId);
  };

  const submitFeedbackStatusChange = () => {
    if (!feedbackRequest) return;
    bulkStatusMutation.mutate({
      matchIds: feedbackRequest.matchIds,
      status: feedbackRequest.toStatus,
      reasonId: feedbackReasonId || null,
      notes: feedbackNotes || null,
    }, {
      onSuccess: () => {
        setFeedbackRequest(null);
        setFeedbackReasonId('');
        setFeedbackNotes('');
      },
    });
  };

  // Group by status
  const grouped: Record<string, any[]> = {};
  for (const col of COLUMNS) grouped[col.key] = [];
  for (const m of filtered) {
    if (grouped[m.status]) grouped[m.status].push(m);
  }

  const renderMatchRow = (m: any, compact = false) => (
    <MatchRow
      key={m.id}
      id={m.id}
      status={m.status}
      candidate={m.candidates}
      vacancy={{
        id: m.vacancies?.id,
        title: m.vacancies?.title,
        company_id: (m.vacancies?.companies as any)?.id,
        company_name: (m.vacancies?.companies as any)?.name,
      }}
      assignee={m.assignee}
      sourceLabel={sourceLabel[m.source] ?? m.source}
      score={m.match_score}
      breakdown={m.match_breakdown}
      candidateQuality={m.match_breakdown?.candidateQuality ?? null}
      distanceKm={m.distance_km}
      durationMin={m.duration_min}
      statusChangedAt={m.status_changed_at}
      createdAt={m.created_at}
      interviewProposedAt={m.interview_proposed_at}
      interviewConfirmedAt={m.interview_confirmed_at ?? m.interview_date}
      followupDays={followupDays}
      selected={selectedMatchIds.has(m.id)}
      onSelectChange={canUseBulkActions ? () => toggleMatch(m.id) : undefined}
      onStatusChange={canUpdateStatus ? (status) => changeStatus([m.id], status) : undefined}
      statusDisabled={!canUpdateStatus || statusMutation.isPending || bulkStatusMutation.isPending}
      onInspect={() => setDetailMatch(m)}
      compact={compact}
      className={compact ? 'shadow-none' : undefined}
    />
  );

  if (authLoading || settingsLoading) {
    return <div className="text-muted-foreground text-center py-12">Laden...</div>;
  }

  if (!canViewPipeline) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center">
        <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Geen toegang tot de matchpipeline</h1>
        <p className="mt-1 text-sm text-muted-foreground">Vraag een admin om het recht “Pipeline bekijken” aan je rol toe te kennen.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="h-6 w-6 text-stat-blue" />
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
        <div className="inline-flex w-fit rounded-md border bg-card p-1">
          <Button
            type="button"
            variant={viewMode === 'kanban' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 rounded-sm px-3"
            aria-pressed={viewMode === 'kanban'}
            onClick={() => setViewMode('kanban')}
          >
            <Columns3 className="mr-2 h-4 w-4" /> Kanban
          </Button>
          <Button
            type="button"
            variant={viewMode === 'list' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 rounded-sm px-3"
            aria-pressed={viewMode === 'list'}
            onClick={() => setViewMode('list')}
          >
            <List className="mr-2 h-4 w-4" /> Lijst
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={allVisibleSelected}
            onCheckedChange={toggleVisibleMatches}
            disabled={!canToggleVisible || !canUseBulkActions}
            aria-label={allVisibleSelected ? 'Deselecteer zichtbare matches' : 'Selecteer zichtbare matches'}
          />
          <span>{allVisibleSelected ? 'Zichtbare matches geselecteerd' : 'Selecteer zichtbare matches'}</span>
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="text-sm text-muted-foreground">{selectedCount} geselecteerd</span>
          <Select
            onValueChange={(status) => changeStatus(selectedVisibleMatches.map((match) => match.id), status)}
            disabled={selectedCount === 0 || !canBulkUpdateStatus || bulkStatusMutation.isPending}
          >
            <SelectTrigger className="h-9 w-full sm:w-44"><SelectValue placeholder={canBulkUpdateStatus ? 'Verplaats naar...' : 'Geen bulkrecht'} /></SelectTrigger>
            <SelectContent>
              {COLUMNS.map((column) => (
                <SelectItem key={column.key} value={column.key}>{column.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            onClick={() => bulkNotifyMutation.mutate(selectedVisibleMatches.map((match) => match.id))}
            disabled={selectedCount === 0 || !canNotifyCandidates || bulkNotifyMutation.isPending}
          >
            {bulkNotifyMutation.isPending ? (
              <>
                <Bell className="mr-2 h-4 w-4 animate-pulse" />
                Aanmaken...
              </>
            ) : (
              <>
                <Mail className="mr-2 h-4 w-4" />
                {canNotifyCandidates ? 'Notificeer kandidaten' : 'Geen notificatierecht'}
              </>
            )}
          </Button>
        </div>
      </div>

      {!canDragDrop && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          Kanban slepen is uitgeschakeld voor je rol. Je kunt matches wel openen en bekijken.
        </div>
      )}

      {isLoading ? (
        <div className="text-muted-foreground text-center py-12">Laden...</div>
      ) : (
        <>
          {viewMode === 'kanban' ? (
            <>
              <DragDropContext onDragEnd={onDragEnd}>
                <div className="flex gap-3 overflow-x-auto pb-4" data-testid="match-kanban-board">
                  {COLUMNS.map((col) => {
                    const columnMatches = grouped[col.key] ?? [];
                    return (
                      <Droppable key={col.key} droppableId={col.key} isDropDisabled={!canDragDrop || statusMutation.isPending || bulkStatusMutation.isPending}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className={cn(
                              'flex min-h-[360px] w-[340px] flex-shrink-0 flex-col rounded-lg border bg-muted/25 p-2 transition-colors',
                              snapshot.isDraggingOver && 'border-primary bg-primary/5'
                            )}
                          >
                            <div className="mb-2 flex items-center gap-2 px-1 py-1">
                              <span className={cn('h-2.5 w-2.5 rounded-full', col.color)} />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium">{col.label}</div>
                                <div className="text-[11px] text-muted-foreground">{columnMatches.length} match{columnMatches.length === 1 ? '' : 'es'}</div>
                              </div>
                              <Badge variant="outline" className="text-xs">{columnMatches.length}</Badge>
                            </div>
                            <div className="space-y-2">
                              {columnMatches.map((m: any, index: number) => (
                                <Draggable key={m.id} draggableId={m.id} index={index} isDragDisabled={!canDragDrop || statusMutation.isPending || bulkStatusMutation.isPending}>
                                  {(dragProvided, dragSnapshot) => (
                                    <div
                                      ref={dragProvided.innerRef}
                                      {...dragProvided.draggableProps}
                                      className={cn('flex items-stretch gap-1', dragSnapshot.isDragging && 'opacity-95')}
                                    >
                                      <div
                                        {...dragProvided.dragHandleProps}
                                        className={cn(
                                          'flex w-6 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground',
                                          canDragDrop ? 'cursor-grab active:cursor-grabbing' : 'cursor-not-allowed opacity-60'
                                        )}
                                        aria-label={`Sleep match ${m.candidates?.first_name ?? ''} ${m.candidates?.last_name ?? ''}`.trim() || 'Sleep match'}
                                      >
                                        <GripVertical className="h-4 w-4" />
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        {renderMatchRow(m, true)}
                                      </div>
                                    </div>
                                  )}
                                </Draggable>
                              ))}
                              {columnMatches.length === 0 && (
                                <div className="rounded-md border border-dashed bg-background/80 px-3 py-8 text-center text-xs text-muted-foreground">
                                  Geen matches
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
              {filtered.length === 0 && (
                <div className="rounded-lg border bg-card py-10 text-center text-sm text-muted-foreground">
                  Geen matches in deze weergave.
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className={cn('rounded-full border px-3 py-1 text-sm transition-colors',
                    statusFilter === 'all' ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-muted')}
                >
                  Alle ({filtered.length})
                </button>
                {COLUMNS.map((col) => (
                  <button
                    key={col.key}
                    type="button"
                    onClick={() => setStatusFilter(col.key)}
                    className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors',
                      statusFilter === col.key ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-muted')}
                  >
                    <span className={cn('h-2 w-2 rounded-full', col.color)} />
                    {col.label} ({grouped[col.key].length})
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                {visible.map((m: any) => renderMatchRow(m))}
                {visible.length === 0 && (
                  <div className="rounded-lg border bg-card py-10 text-center text-sm text-muted-foreground">
                    {statusFilter === 'all' ? 'Geen matches in deze weergave.' : `Geen matches in "${COLUMNS.find(c => c.key === statusFilter)?.label ?? statusFilter}".`}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      <MatchDetailDialog
        open={!!detailMatch}
        match={detailMatch}
        onOpenChange={(open) => { if (!open) setDetailMatch(null); }}
        canConfirmInterview={canConfirmInterview}
        onChanged={() => {
          qc.invalidateQueries({ queryKey: ['match-pipeline', orgId] });
          qc.invalidateQueries({ queryKey: ['communications'] });
        }}
      />

      <MatchFeedbackDialog
        open={!!feedbackRequest}
        toStatus={feedbackRequest?.toStatus}
        count={feedbackRequest?.matchIds.length ?? 1}
        reasons={feedbackReasons as any[]}
        reasonId={feedbackReasonId}
        notes={feedbackNotes}
        pending={bulkStatusMutation.isPending}
        onReasonChange={setFeedbackReasonId}
        onNotesChange={setFeedbackNotes}
        onCancel={() => setFeedbackRequest(null)}
        onSubmit={submitFeedbackStatusChange}
      />
    </div>
  );
};

export default MatchPipeline;
