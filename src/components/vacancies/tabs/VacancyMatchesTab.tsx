import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Link } from 'react-router-dom';
import { Search, UserPlus, Sparkles, Mail, Star, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import PlacementSheet from '@/components/vacancies/PlacementSheet';
import { type MatchBreakdown } from '@/lib/matching';

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
  eigen_match: 'Eigen match',
  facebook: 'Facebook',
  jobmarket: 'Jobmarket',
  linkedin: 'LinkedIn',
  overig: 'Overig',
};

const scoreBadgeClass: Record<MatchBreakdown['label'], string> = {
  groen: 'bg-stat-green/10 text-stat-green border-0',
  oranje: 'bg-yellow-100 text-yellow-700 border-0',
  rood: 'bg-red-100 text-red-600 border-0',
};

const VacancyMatchesTab = ({ vacancy }: { vacancy: any }) => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [candidateSearch, setCandidateSearch] = useState('');
  const [placementMatch, setPlacementMatch] = useState<any>(null);
  const [previewMatchId, setPreviewMatchId] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<{ to: string; contact_name: string; subject: string; html: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showWeakMatches, setShowWeakMatches] = useState(false);
  const [feedbackRequest, setFeedbackRequest] = useState<{ matchId: string; fromStatus: string; toStatus: string } | null>(null);
  const [feedbackReasonId, setFeedbackReasonId] = useState('');
  const [feedbackNotes, setFeedbackNotes] = useState('');

  const { data: matches } = useQuery({
    queryKey: ['vacancy-matches', vacancy.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matches')
        .select(`*, candidates!matches_candidate_id_fkey(id, first_name, last_name, email, phone, compliance_status)`)
        .eq('vacancy_id', vacancy.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: vacancyCanonicalSkills = [] } = useQuery({
    queryKey: ['vacancy-canonical-skills', vacancy.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('vacancy_required_skills')
        .select('skills!inner(name)')
        .eq('vacancy_id', vacancy.id);
      if (error) throw error;
      return (data ?? []).map((row: any) => row.skills?.name).filter(Boolean);
    },
  });

  const { data: feedbackReasons = [] } = useQuery({
    queryKey: ['match-feedback-reasons', orgId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('match_feedback_reasons')
        .select('*')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('applies_to')
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orgId,
  });

  // Shortlist via de server-side rank-candidates edge function: rangschikt de VOLLEDIGE pool
  // (geen limit-150-op-voornaam meer) met de gedeelde matching-core, inclusief afstand.
  const { data: availableCandidates, isError: rankError } = useQuery({
    queryKey: ['available-candidates-for-vacancy', vacancy.id, candidateSearch, showWeakMatches, (matches ?? []).length],
    queryFn: async () => {
      const matchedIds = (matches ?? []).map((m: any) => m.candidate_id);
      const { data, error } = await supabase.functions.invoke('rank-candidates', {
        body: {
          vacancy_id: vacancy.id,
          include_weak: showWeakMatches || !!candidateSearch,
          search: candidateSearch || undefined,
          exclude_candidate_ids: matchedIds,
          limit: 25,
        },
      });
      if (error) throw error;
      return ((data?.results ?? []) as any[]).map((r) => ({
        ...r.candidate,
        _showForVacancy: true,
        _vacancyScore: r.breakdown,
        _candidateQuality: r.candidate_quality,
      }));
    },
    enabled: !!matches,
  });

  const proposeMutation = useMutation({
    mutationFn: async (candidate: any) => {
      const score = candidate._vacancyScore;
      const { data: match, error } = await (supabase as any).from('matches').insert({
        organization_id: orgId,
        vacancy_id: vacancy.id,
        candidate_id: candidate.id,
        proposed_by: user?.id ?? null,
        status: 'nieuwe_match' as any,
        source: 'eigen_match',
        match_score: score?.matchPercent ?? null,
        match_reasoning: score?.reasoning ?? null,
        match_breakdown: (score ?? null) as any,
        distance_km: score?.distance?.km ?? null,
        // duration_min wordt door calculate-match (Mapbox) gezet; shortlist heeft 'm niet.
      }).select('id').single();
      if (error) throw error;

      // Trigger AI match scoring
      try {
        await supabase.functions.invoke('calculate-match', {
          body: { match_id: match.id, candidate_id: candidate.id, vacancy_id: vacancy.id },
        });
      } catch { /* non-blocking */ }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vacancy-matches', vacancy.id] });
      qc.invalidateQueries({ queryKey: ['available-candidates-for-vacancy'] });
      toast.success('Nieuwe match aangemaakt (AI score wordt berekend)');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const rescoreMutation = useMutation({
    mutationFn: async () => {
      const allMatches = matches ?? [];
      for (const m of allMatches) {
        await supabase.functions.invoke('calculate-match', {
          body: { match_id: (m as any).id, candidate_id: (m as any).candidate_id, vacancy_id: vacancy.id },
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vacancy-matches', vacancy.id] });
      toast.success('Alle match scores herberekend');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ matchId, status, reasonId, notes }: { matchId: string; status: string; reasonId?: string | null; notes?: string | null }) => {
      const current = (matches ?? []).find((m: any) => m.id === matchId) as any;
      if (status === 'afgewezen' && !reasonId) throw new Error('Kies een feedbackreden voor afwijzen');

      const { error } = await supabase.from('matches').update({ status, status_changed_at: new Date().toISOString() } as any).eq('id', matchId);
      if (error) throw error;

      if (reasonId || notes || ['afgewezen', 'geaccepteerd', 'geplaatst'].includes(status)) {
        const { error: feedbackError } = await (supabase as any).from('match_feedback_events').insert({
          organization_id: orgId,
          match_id: matchId,
          from_status: current?.status ?? null,
          to_status: status,
          reason_id: reasonId ?? null,
          notes: notes?.trim() || null,
          created_by: user?.id ?? null,
          match_score_snapshot: current?.match_score ?? null,
          match_breakdown_snapshot: current?.match_breakdown ?? null,
        });
        if (feedbackError) throw feedbackError;
      }
    },
    onMutate: async ({ matchId, status }) => {
      await qc.cancelQueries({ queryKey: ['vacancy-matches', vacancy.id] });
      const previous = qc.getQueryData<any[]>(['vacancy-matches', vacancy.id]);
      qc.setQueryData<any[]>(['vacancy-matches', vacancy.id], (old) =>
        (old ?? []).map((m: any) => (m.id === matchId ? { ...m, status } : m))
      );
      return { previous };
    },
    onError: (e: any, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(['vacancy-matches', vacancy.id], ctx.previous);
      toast.error(e.message);
    },
    onSuccess: () => toast.success('Match status bijgewerkt'),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['vacancy-matches', vacancy.id] });
      qc.invalidateQueries({ queryKey: ['match-pipeline'] });
    },
  });

  const openPreview = async (matchId: string) => {
    setPreviewMatchId(matchId);
    setPreviewLoading(true);
    setPreviewData(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-match-proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ match_id: matchId, preview: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Kon preview niet laden');
      setPreviewData({ to: json.to, contact_name: json.contact_name, subject: json.subject, html: json.html });
    } catch (e: any) {
      toast.error(e.message);
      setPreviewMatchId(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const sendProposalMutation = useMutation({
    mutationFn: async (matchId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-match-proposal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ match_id: matchId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Fout bij versturen');
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vacancy-matches', vacancy.id] });
      toast.success('Voorstel verstuurd naar opdrachtgever');
      setPreviewMatchId(null);
      setPreviewData(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const grouped: Record<string, any[]> = {};
  for (const col of COLUMNS) grouped[col.key] = [];
  for (const m of (matches ?? [])) {
    if (grouped[m.status]) grouped[m.status].push(m);
  }

  const onDragEnd = (result: DropResult) => {
    const { draggableId, destination, source } = result;
    if (!destination || destination.droppableId === source.droppableId) return;
    if (['afgewezen', 'geaccepteerd', 'geplaatst'].includes(destination.droppableId)) {
      setFeedbackRequest({ matchId: draggableId, fromStatus: source.droppableId, toStatus: destination.droppableId });
      setFeedbackReasonId('');
      setFeedbackNotes('');
      return;
    }
    statusMutation.mutate({ matchId: draggableId, status: destination.droppableId });
  };

  const requestStatusChange = (matchId: string, fromStatus: string, toStatus: string) => {
    if (['afgewezen', 'geaccepteerd', 'geplaatst'].includes(toStatus)) {
      setFeedbackRequest({ matchId, fromStatus, toStatus });
      setFeedbackReasonId('');
      setFeedbackNotes('');
      return;
    }
    statusMutation.mutate({ matchId, status: toStatus });
  };

  const submitFeedbackStatusChange = () => {
    if (!feedbackRequest) return;
    statusMutation.mutate({
      matchId: feedbackRequest.matchId,
      status: feedbackRequest.toStatus,
      reasonId: feedbackReasonId || null,
      notes: feedbackNotes,
    }, {
      onSuccess: () => {
        setFeedbackRequest(null);
        setFeedbackReasonId('');
        setFeedbackNotes('');
      },
    });
  };

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-semibold">Match pipeline — sleep kaarten tussen kolommen om status te wijzigen</h3>
        <Button variant="outline" size="sm" onClick={() => rescoreMutation.mutate()} disabled={rescoreMutation.isPending || !(matches?.length)}>
          <Sparkles className="h-3 w-3 mr-1" /> {rescoreMutation.isPending ? 'Berekenen...' : 'Herbereken scores'}
        </Button>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {COLUMNS.map((col) => (
            <Droppable key={col.key} droppableId={col.key}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={cn(
                    'flex-shrink-0 w-64 rounded-lg p-2 transition-colors bg-muted/40',
                    snapshot.isDraggingOver && 'bg-accent/60'
                  )}
                >
                  <div className="flex items-center gap-2 mb-3 px-1">
                    <div className={cn('w-2 h-2 rounded-full', col.color)} />
                    <span className="text-sm font-medium">{col.label}</span>
                    <Badge variant="outline" className="text-xs ml-auto">{grouped[col.key].length}</Badge>
                  </div>
                  <div className="space-y-2 min-h-[120px]">
                    {grouped[col.key].map((m: any, index: number) => {
                      const c = m.candidates as any;
                      return (
                        <Draggable key={m.id} draggableId={m.id} index={index}>
                          {(dragProvided, dragSnapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              {...dragProvided.dragHandleProps}
                              className={cn(dragSnapshot.isDragging && 'opacity-90')}
                            >
                              <Card className="hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing">
                                <CardContent className="p-3 space-y-2">
                                  <div className="flex items-start justify-between gap-1">
                                    <Link
                                      to={`/kandidaten/${c.id}`}
                                      className="text-sm font-medium hover:text-primary truncate"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {c.first_name} {c.last_name}
                                    </Link>
                                    {m.match_score != null && (
                                      <div className="flex items-center gap-0.5 text-xs text-amber-600 flex-shrink-0">
                                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                                        {Math.round(m.match_score)}%
                                      </div>
                                    )}
                                  </div>
                                  {m.source && (
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                      {sourceLabel[m.source] ?? m.source}
                                    </Badge>
                                  )}
                                  {m.match_reasoning && (
                                    <p className="text-[11px] text-muted-foreground line-clamp-2">{m.match_reasoning}</p>
                                  )}
                                  {(m.duration_min || m.distance_km) && (
                                    <p className="text-[11px] text-muted-foreground">
                                      Reistijd: {m.duration_min ? `${Math.round(m.duration_min)} min` : 'onbekend'}{m.distance_km ? `, ${Math.round(m.distance_km)} km` : ''}
                                    </p>
                                  )}
                                  {m.match_breakdown?.positives?.length > 0 && (
                                    <p className="text-[11px] text-emerald-700 line-clamp-1">{m.match_breakdown.positives[0]}</p>
                                  )}
                                  {m.match_breakdown?.missing?.length > 0 && (
                                    <p className="text-[11px] text-amber-700 line-clamp-1">{m.match_breakdown.missing[0]}</p>
                                  )}
                                  <div className="flex gap-1 pt-1">
                                    {col.key === 'voorgesteld' && (
                                      <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={() => openPreview(m.id)} disabled={previewLoading && previewMatchId === m.id}>
                                        <Mail className="h-3 w-3 mr-1" /> {previewLoading && previewMatchId === m.id ? '...' : 'Mail versturen'}
                                      </Button>
                                    )}
                                    {col.key === 'geaccepteerd' && (
                                      <Button size="sm" className="h-7 text-xs flex-1" onClick={() => setPlacementMatch(m)}>
                                        Plaatsen
                                      </Button>
                                    )}
                                    {col.key !== 'afgewezen' && col.key !== 'geaccepteerd' && (
                                      <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600" onClick={() => requestStatusChange(m.id, col.key, 'afgewezen')}>
                                        <X className="h-3 w-3" />
                                      </Button>
                                    )}
                                  </div>
                                </CardContent>
                              </Card>
                            </div>
                          )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}
                  </div>
                </div>
              )}
            </Droppable>
          ))}
        </div>
      </DragDropContext>

      <div className="border-t pt-6 space-y-4">
        <div>
          <h3 className="font-semibold text-base">Beste kandidaten uit eigen database</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Gefilterd op vacature-eisen voordat je handmatig een match toevoegt</p>
          <div className="flex gap-1 mt-2 flex-wrap">
            {(vacancy.required_skills ?? []).map((s: string) => <Badge key={`skill-${s}`} variant="secondary" className="text-xs">{s}</Badge>)}
            {vacancyCanonicalSkills.filter((s: string) => !(vacancy.required_skills ?? []).includes(s)).map((s: string) => <Badge key={`canonical-skill-${s}`} variant="secondary" className="text-xs">{s}</Badge>)}
            {(vacancy.required_certifications ?? []).map((c: string) => <Badge key={`cert-${c}`} variant="outline" className="text-xs">{c}</Badge>)}
            {vacancy.requires_drivers_license && <Badge variant="outline" className="text-xs">Rijbewijs</Badge>}
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Zoek kandidaat..." value={candidateSearch} onChange={(e) => setCandidateSearch(e.target.value)} className="pl-9" />
          </div>
          <Button
            type="button"
            variant={showWeakMatches ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setShowWeakMatches((value) => !value)}
          >
            {showWeakMatches ? 'Alle kandidaten zichtbaar' : 'Toon ook zwakkere matches'}
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {(availableCandidates ?? []).map((c: any) => (
            <Card key={c.id} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <Link to={`/kandidaten/${c.id}`} className="font-medium text-sm hover:text-primary truncate block">{c.first_name} {c.last_name}</Link>
                    <Badge className={cn('text-[10px] px-1.5 py-0 flex-shrink-0', scoreBadgeClass[c._vacancyScore.label as MatchBreakdown['label']])}>
                        {c._vacancyScore.matchPercent}% match
                    </Badge>
                    {typeof c._candidateQuality === 'number' && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0" title="Algemene AI-kwaliteitsscore (los van deze vacature)">
                        ★ {c._candidateQuality}
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {c._vacancyScore.skillMatches.slice(0, 3).map((s: string) => <Badge key={`skill-${s}`} variant="outline" className="text-xs">{s}</Badge>)}
                    {c._vacancyScore.certificationMatches.slice(0, 2).map((s: string) => <Badge key={`cert-${s}`} variant="outline" className="text-xs">{s}</Badge>)}
                    {vacancy.requires_drivers_license && c.has_drivers_license && <Badge variant="outline" className="text-xs">Rijbewijs</Badge>}
                    {c._vacancyScore.skillMatches.length === 0 && c._vacancyScore.certificationMatches.length === 0 && (c.skills ?? []).slice(0, 3).map((s: string) => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{c._vacancyScore.reasoning}</p>
                  {c._vacancyScore.missing.length > 0 && (
                    <p className="text-[11px] text-amber-700 mt-1 line-clamp-2">{c._vacancyScore.missing[0]}</p>
                  )}
                </div>
                <Button size="sm" variant="outline" onClick={() => proposeMutation.mutate(c)} disabled={proposeMutation.isPending} className="flex-shrink-0">
                  <UserPlus className="h-3 w-3 mr-1" /> Nieuwe match
                </Button>
              </div>
            </Card>
          ))}
          {rankError && <p className="text-sm text-red-600">Kandidaten konden niet worden geladen. Probeer het opnieuw.</p>}
          {!rankError && (availableCandidates ?? []).length === 0 && <p className="text-sm text-muted-foreground">Geen beschikbare kandidaten met deze vacature-eisen gevonden</p>}
        </div>
      </div>

      <PlacementSheet match={placementMatch} vacancy={vacancy} onClose={() => setPlacementMatch(null)} />

      <Dialog open={!!previewMatchId} onOpenChange={(open) => { if (!open) { setPreviewMatchId(null); setPreviewData(null); } }}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Voorstel-mail preview</DialogTitle>
            <DialogDescription>Controleer de inhoud voordat je verstuurt.</DialogDescription>
          </DialogHeader>
          {previewData ? (
            <>
              <div className="space-y-1 text-sm border-b pb-3">
                <div><span className="text-muted-foreground">Naar:</span> <span className="font-medium">{previewData.contact_name}</span> &lt;{previewData.to}&gt;</div>
                <div><span className="text-muted-foreground">Onderwerp:</span> <span className="font-medium">{previewData.subject}</span></div>
              </div>
              <div className="flex-1 overflow-auto border rounded">
                <iframe
                  title="email-preview"
                  srcDoc={previewData.html}
                  sandbox=""
                  className="w-full"
                  style={{ height: '500px' }}
                />
              </div>
            </>
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">Preview laden...</div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPreviewMatchId(null); setPreviewData(null); }}>Annuleren</Button>
            <Button
              onClick={() => previewMatchId && sendProposalMutation.mutate(previewMatchId)}
              disabled={!previewData || sendProposalMutation.isPending}
            >
              {sendProposalMutation.isPending ? 'Versturen...' : 'Versturen naar opdrachtgever'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!feedbackRequest} onOpenChange={(open) => { if (!open) setFeedbackRequest(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Feedback vastleggen</DialogTitle>
            <DialogDescription>
              Leg vast waarom deze match naar {feedbackRequest?.toStatus?.replaceAll('_', ' ')} gaat.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Reden{feedbackRequest?.toStatus === 'afgewezen' ? ' *' : ''}</Label>
              <Select value={feedbackReasonId} onValueChange={setFeedbackReasonId}>
                <SelectTrigger>
                  <SelectValue placeholder="Kies een reden" />
                </SelectTrigger>
                <SelectContent>
                  {feedbackReasons
                    .filter((reason: any) => reason.applies_to === feedbackRequest?.toStatus)
                    .map((reason: any) => (
                      <SelectItem key={reason.id} value={reason.id}>{reason.reason}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Notitie</Label>
              <Textarea value={feedbackNotes} onChange={(event) => setFeedbackNotes(event.target.value)} placeholder="Optionele toelichting" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFeedbackRequest(null)}>Annuleren</Button>
            <Button
              onClick={submitFeedbackStatusChange}
              disabled={statusMutation.isPending || (feedbackRequest?.toStatus === 'afgewezen' && !feedbackReasonId)}
            >
              Status bijwerken
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default VacancyMatchesTab;
