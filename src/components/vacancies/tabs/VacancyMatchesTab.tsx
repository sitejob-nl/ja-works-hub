import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useOutboundPause } from '@/hooks/useOutboundPause';
import { useAuth } from '@/contexts/AuthContext';
import { Link } from 'react-router-dom';
import { Search, UserPlus, Sparkles, Mail, Star, X, MessageSquare, Trash2, PhoneCall, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { extractFunctionErrorMessage } from '@/lib/functionError';
import { getErrorMessage } from '@/lib/error-message';
import { cn } from '@/lib/utils';
import { unwrap, unwrapList } from '@/lib/db';
import {
  buildInterestTemplatePayload,
  isInterestTemplate,
  previewInterestTemplate,
  sanitizeTemplateParam,
  type WhatsAppTemplateRow,
} from '@/lib/whatsapp-template';
import PlacementWizard from '@/components/placement/PlacementWizard';
import MatchFeedbackDialog from '@/components/matches/MatchFeedbackDialog';
import MatchInspectorDialog from '@/components/matches/MatchInspectorDialog';
import MatchOutboundDialog from '@/components/matches/MatchOutboundDialog';
import MatchProposalEmailDialog from '@/components/matches/MatchProposalEmailDialog';
import CandidateProposalEmailDialog from '@/components/matches/CandidateProposalEmailDialog';
import MatchRow from '@/components/matches/MatchRow';
import MatchAssigneeSelect from '@/components/matches/MatchAssigneeSelect';
import { useMatchAssignees } from '@/hooks/useMatchAssignees';
import { resolveDefaultMatchAssignee } from '@/lib/match-assignee';
import { type MatchBreakdown } from '@/lib/matching';
import { MATCH_STATUS_STEPS, getMatchStatusMeta, getNextMatchStatus, isTerminalMatchStatus, matchStatusNeedsFeedbackDialog } from '@/lib/match-status';
import { scoreBadgeClass, verdictBadgeClass } from '@/lib/match-presenters';
import { advanceMatchStatus, createMatch } from '@/lib/match-lifecycle';

const COLUMNS = MATCH_STATUS_STEPS;

// Keuzes voor "Toon max." op de shortlist. 100 is de harde bovengrens van de edge function
// rank-candidates — hoger aanvragen levert daar stil 100 op, dus bieden we dat ook niet aan.
const SHORTLIST_LIMIT_OPTIONS = [25, 50, 100] as const;
const SHORTLIST_LIMIT_DEFAULT = 25;
// rerank-matches kapt de meegestuurde lijst zelf af op MAX_CANDIDATES = 30
// (supabase/functions/rerank-matches/index.ts). We sturen daarom nooit meer dan dat én zeggen het
// in de hint: anders belooft de knop bij "Toon max. 100" een beoordeling van 100 kandidaten
// terwijl de server er stil 70 weggooit.
const RERANK_MAX_CANDIDATES = 30;

// Status-label/-kleur komen uit de gedeelde match-status-bron (getMatchStatusMeta),
// niet meer uit lokaal her-gedefinieerde maps.
const statusLabel = (status: string) => getMatchStatusMeta(status).label;

// Gedeelde skill/cert-badge-rendering voor de twee match-lijsten in deze tab
// (pipeline + shortlist), zodat de badge-opmaak op één plek staat.
const MatchSkillBadges = ({
  skillMatches = [],
  certMatches = [],
  fallbackSkills = [],
  extras,
}: {
  skillMatches?: string[];
  certMatches?: string[];
  fallbackSkills?: string[];
  extras?: ReactNode;
}) => {
  const showFallback = skillMatches.length === 0 && certMatches.length === 0 && fallbackSkills.length > 0;
  return (
    <div className="flex gap-1 mt-1 flex-wrap">
      {skillMatches.slice(0, 4).map((s) => <Badge key={`skill-${s}`} variant="outline" className="text-xs">{s}</Badge>)}
      {certMatches.slice(0, 2).map((s) => <Badge key={`cert-${s}`} variant="outline" className="text-xs">{s}</Badge>)}
      {extras}
      {showFallback && fallbackSkills.slice(0, 3).map((s) => <Badge key={`fallback-${s}`} variant="outline" className="text-xs">{s}</Badge>)}
    </div>
  );
};

const sourceLabel: Record<string, string> = {
  sollicitatie: 'Sollicitatie',
  website_sollicitatie: 'Website sollicitatie',
  public_signup: 'Website intake',
  eigen_match: 'Eigen match',
  facebook: 'Facebook',
  jobmarket: 'Jobmarket',
  linkedin: 'LinkedIn',
  carerix: 'Carerix',
  handmatig: 'Handmatig',
  eigen_database: 'Eigen database',
  overig: 'Overig',
};

const CANDIDATE_MATCH_CONTEXT_FIELDS = 'id, ai_analysis, ai_summary, ai_classification, ai_reliability_score, screening_data, screened_at, available_from, available_until, arrival_date, availability_notes, skills, certifications, languages, has_drivers_license, has_dutch_address, address_city';

const VacancyMatchesTab = ({ vacancy }: { vacancy: any }) => {
  const orgId = useOrganizationId();
  const { user, role } = useAuth();
  const qc = useQueryClient();
  const { data: matchAssignees = [] } = useMatchAssignees(orgId);
  const defaultAssignee = resolveDefaultMatchAssignee({
    currentUserId: user?.id,
    currentUserRole: role,
    vacancyCreatedBy: vacancy?.created_by,
  });
  const [candidateSearch, setCandidateSearch] = useState('');
  const [placementMatch, setPlacementMatch] = useState<any>(null);
  const [previewMatchId, setPreviewMatchId] = useState<string | null>(null);
  // Baanvoorstel-mail naar de MEDEWERKER (A2) — apart van de opdrachtgever-voorstelmail.
  const [candidateProposalMatchId, setCandidateProposalMatchId] = useState<string | null>(null);
  const [deleteMatchId, setDeleteMatchId] = useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [scoreFilter, setScoreFilter] = useState<'strong' | '60' | '70' | '80' | 'all'>('strong');
  // Hoeveel kandidaten de shortlist maximaal toont. De server rangschikt altijd de VOLLEDIGE pool
  // en kapt pas daarna af, dus dit bepaalt puur hoeveel van de ranglijst je te zien krijgt.
  // Default 25 (langere lijsten maken elke vacaturepagina zwaarder); 100 is tevens de bovengrens
  // die rank-candidates afdwingt. De kosten van de AI-herbeoordeling lopen hier NIET mee op —
  // die zit vast op RERANK_MAX_CANDIDATES.
  const [shortlistLimit, setShortlistLimit] = useState<number>(SHORTLIST_LIMIT_DEFAULT);
  const [selectedShortlist, setSelectedShortlist] = useState<Set<string>>(new Set());
  // Stage-2 AI-herbeoordeling (rerank-matches): fit-score + onderbouwing per kandidaat-id.
  const [rerankById, setRerankById] = useState<Record<string, any>>({});
  // Detail-dialoog: werkt zowel voor een shortlist-kandidaat (met candidate → "Match maken")
  // als voor een bestaande match (alleen lezen, breakdown uit match_breakdown).
  const [detail, setDetail] = useState<{ name: string; breakdown: any; quality?: number | null; candidate?: any; rerank?: any } | null>(null);
  const showWeakMatches = scoreFilter === 'all';
  const minScore = scoreFilter === '60' ? 60 : scoreFilter === '70' ? 70 : scoreFilter === '80' ? 80 : 0;
  // Bij een zoekterm zetten we include_weak aan: wie op naam zoekt wil die persoon vinden, ook als
  // hij zwak scoort. Gevolg is wel dat de server dán GEEN drempel toepast (matching-core →
  // passesShortlist: `if (includeWeak) return true`), dus ook zijn totalen slaan op de ongefilterde
  // pool. Eén variabele voor zowel de request als de teksten eronder, zodat die niet uit elkaar lopen.
  const shortlistIncludeWeak = showWeakMatches || !!candidateSearch;
  // Feedback bij statuswijziging — matchIds zodat we het ook voor bulk kunnen gebruiken.
  const [feedbackRequest, setFeedbackRequest] = useState<{ matchIds: string[]; toStatus: string } | null>(null);
  const [feedbackReasonId, setFeedbackReasonId] = useState('');
  const [feedbackNotes, setFeedbackNotes] = useState('');
  // Match-pipeline lijst: statusfilter + selectie + bulk-bericht.
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedMatches, setSelectedMatches] = useState<Set<string>>(new Set());
  const [bulkMessageOpen, setBulkMessageOpen] = useState(false);
  const [bulkMessageText, setBulkMessageText] = useState('');
  const [bulkSending, setBulkSending] = useState(false);
  // Template voor kandidaten buiten het 24u-servicevenster (Meta bezorgt daar alleen templates).
  const [bulkTemplateId, setBulkTemplateId] = useState<string>('');
  const { data: outboundPaused } = useOutboundPause(orgId);
  // AI-gegenereerde kandidaat-pitch (indien aanwezig) om het interesse-bericht mee te vullen.
  const { data: vacancySeo } = useQuery({
    queryKey: ['vacancy-seo', vacancy.id],
    queryFn: () => unwrap(
      supabase.from('vacancy_seo_content').select('preview_text, social_text').eq('vacancy_id', vacancy.id).maybeSingle(),
    ),
  });

  // Goedgekeurde WhatsApp-templates (zelfde key/vorm als TemplatePicker → gedeelde cache).
  const { data: waTemplates = [] } = useQuery({
    queryKey: ['whatsapp-templates', orgId],
    queryFn: () => unwrapList(
      (supabase as any).from('whatsapp_templates').select('*').eq('organization_id', orgId).eq('status', 'APPROVED').order('template_name'),
    ) as Promise<WhatsAppTemplateRow[]>,
    enabled: !!orgId && bulkMessageOpen,
  });
  // Alleen templates met minimaal 2 quick-reply-knoppen kunnen als interesse-bericht dienen.
  const interestTemplates = waTemplates.filter(isInterestTemplate);

  // Standaard de eerste geschikte template voorselecteren zodra de dialog open is.
  useEffect(() => {
    if (!bulkMessageOpen) return;
    if (!bulkTemplateId && interestTemplates.length > 0) setBulkTemplateId(interestTemplates[0].id);
  }, [bulkMessageOpen, bulkTemplateId, interestTemplates]);

  const { data: matches } = useQuery({
    queryKey: ['vacancy-matches', vacancy.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('matches')
        .select(`*, assignee:profiles!matches_assigned_to_fkey(id, full_name, email), candidates!matches_candidate_id_fkey(id, first_name, last_name, email, phone, compliance_status, available_from, available_until, arrival_date, availability_notes, ai_analysis, ai_summary, ai_classification, ai_reliability_score, screening_data, screened_at, skills, certifications, languages, has_drivers_license, has_dutch_address, address_city)`)
        .eq('vacancy_id', vacancy.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Meta 24u-regel: buiten het servicevenster (laatste inkomende bericht < 24u) bezorgt Meta
  // alleen goedgekeurde templates. Bepaal per geselecteerde kandidaat of het venster open is.
  const selectedCandidateIds = ((matches ?? []) as any[])
    .filter((m: any) => selectedMatches.has(m.id))
    .map((m: any) => m.candidates?.id)
    .filter(Boolean) as string[];
  const { data: inWindowIds = [] } = useQuery({
    queryKey: ['wa-service-window', vacancy.id, [...selectedCandidateIds].sort().join(',')],
    queryFn: async () => {
      const rows = await unwrapList(
        (supabase as any)
          .from('communications')
          .select('candidate_id')
          .eq('channel', 'whatsapp')
          .eq('direction', 'inbound')
          .in('candidate_id', selectedCandidateIds)
          .gte('created_at', new Date(Date.now() - 24 * 3600_000).toISOString()),
      );
      return [...new Set((rows as any[]).map((r) => r.candidate_id))] as string[];
    },
    enabled: bulkMessageOpen && selectedCandidateIds.length > 0,
  });
  const inWindowSet = new Set(inWindowIds);
  const selectedTemplate = interestTemplates.find((t) => t.id === bulkTemplateId) ?? null;

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
  // De drempelfilters (minScore / requireSkillSignal) gaan mee naar de server en lopen dus over
  // de hele pool; pas daarna kapt de server af op `limit`. We houden de totalen vast zodat de
  // gebruiker ziet dát er is afgekapt — een lijst van 25 zag er eerder compleet uit terwijl dat niet zo was.
  const { data: rankResult, isError: rankError, isFetching: rankFetching } = useQuery({
    queryKey: ['available-candidates-for-vacancy', vacancy.id, candidateSearch, scoreFilter, showWeakMatches, shortlistLimit, (matches ?? []).length],
    queryFn: async () => {
      const matchedIds = (matches ?? []).map((m: any) => m.candidate_id);
      const { data, error } = await supabase.functions.invoke('rank-candidates', {
        body: {
          vacancy_id: vacancy.id,
          include_weak: shortlistIncludeWeak,
          search: candidateSearch || undefined,
          exclude_candidate_ids: matchedIds,
          criteria_options: {
            minScore: minScore || undefined,
            requireSkillSignal: scoreFilter === 'strong',
          },
          limit: shortlistLimit,
        },
      });
      if (error) throw error;
      return {
        results: ((data?.results ?? []) as any[]).map((r) => ({
          ...r.candidate,
          _showForVacancy: true,
          _vacancyScore: r.breakdown,
          _candidateQuality: r.candidate_quality,
        })),
        // pool_size = alle kandidaten met een actieve status die de server heeft opgehaald en
        // gescoord; shortlisted = hoeveel daarvan dit filter haalden (vóór het afkappen op limit).
        poolSize: Number(data?.pool_size) || 0,
        shortlisted: Number(data?.shortlisted) || 0,
      };
    },
    enabled: !!matches,
  });
  const availableCandidates = rankResult?.results;
  const rankPoolSize = rankResult?.poolSize ?? 0;
  const rankShortlisted = rankResult?.shortlisted ?? 0;

  const shortlistCandidateIds = (availableCandidates ?? []).map((candidate: any) => candidate.id).filter(Boolean).join(',');
  const { data: shortlistCandidateContext = [] } = useQuery({
    queryKey: ['shortlist-candidate-context', orgId, shortlistCandidateIds],
    queryFn: async () => {
      const ids = shortlistCandidateIds.split(',').filter(Boolean);
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from('candidates')
        .select(CANDIDATE_MATCH_CONTEXT_FIELDS)
        .eq('organization_id', orgId)
        .in('id', ids);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orgId && shortlistCandidateIds.length > 0,
  });

  const shortlistContextById = new Map((shortlistCandidateContext as any[]).map((row) => [row.id, row]));

  const insertMatch = async (candidate: any) => {
    const score = candidate._vacancyScore;
    const match = await createMatch(supabase as any, {
      orgId,
      vacancyId: vacancy.id,
      candidateId: candidate.id,
      proposedBy: user?.id ?? null,
      assignedTo: defaultAssignee,
      source: 'eigen_match',
      score: score ?? null,
    });
    try {
      await supabase.functions.invoke('calculate-match', {
        body: { match_id: match.id, candidate_id: candidate.id, vacancy_id: vacancy.id },
      });
    } catch { /* non-blocking */ }
  };

  const proposeMutation = useMutation({
    mutationFn: insertMatch,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vacancy-matches', vacancy.id] });
      qc.invalidateQueries({ queryKey: ['available-candidates-for-vacancy'] });
      toast.success('Match gemaakt (AI score wordt berekend)');
    },
    onError: (e: any) => {
      if (e?.code === '23505') toast.info('Deze match bestaat al');
      else toast.error(e.message);
    },
  });

  // Bulk: maak voor meerdere geselecteerde kandidaten in één keer een match. Bestaande
  // matches (unieke kandidaat-vacature, fout 23505) worden overgeslagen i.p.v. de batch te stoppen.
  const bulkProposeMutation = useMutation({
    mutationFn: async (candidates: any[]) => {
      let created = 0; let skipped = 0;
      for (const candidate of candidates) {
        try { await insertMatch(candidate); created++; }
        catch (e: any) { if (e?.code === '23505') skipped++; else throw e; }
      }
      return { created, skipped };
    },
    onSuccess: ({ created, skipped }) => {
      qc.invalidateQueries({ queryKey: ['vacancy-matches', vacancy.id] });
      qc.invalidateQueries({ queryKey: ['available-candidates-for-vacancy'] });
      setSelectedShortlist(new Set());
      toast.success(`${created} match${created === 1 ? '' : 'es'} gemaakt${skipped ? ` (${skipped} bestond al)` : ''}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Stage-2: weegt de VOLLEDIGE vacaturetekst tegen elk shortlist-profiel met Gemini (flash-lite).
  // Server cachet per (vacature × kandidaat) → herhaald draaien is gratis zolang de tekst niet wijzigt.
  const rerankMutation = useMutation({
    mutationFn: async (candidateIds: string[]) => {
      if (candidateIds.length === 0) throw new Error('Geen kandidaten om te beoordelen');
      const { data, error } = await supabase.functions.invoke('rerank-matches', {
        body: { vacancy_id: vacancy.id, candidate_ids: candidateIds },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data: any) => {
      const next: Record<string, any> = {};
      for (const r of data?.results ?? []) {
        if (r?.candidate_id && r.fit_score != null) next[r.candidate_id] = r;
      }
      setRerankById((prev) => ({ ...prev, ...next }));
      const parts: string[] = [`${data?.scored ?? 0} beoordeeld`];
      if (data?.cached) parts.push(`${data.cached} uit cache`);
      if (data?.gemini_calls) parts.push(`${data.gemini_calls} nieuwe`);
      if (typeof data?.cost_cents === 'number' && data.cost_cents > 0) parts.push(`€${(data.cost_cents / 100).toFixed(2)}`);
      if (data?.failed) parts.push(`${data.failed} mislukt`);
      toast.success(`AI-herbeoordeling klaar — ${parts.join(', ')}`);
      if (data?.stopped) toast.warning('Niet alle kandidaten beoordeeld (saldo of tijd op). Draai nogmaals voor de rest.');
    },
    onError: (e: any) => toast.error(e.message ?? 'AI-herbeoordeling mislukt'),
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
      await advanceMatchStatus(supabase as any, {
        orgId,
        matchId,
        toStatus: status,
        currentMatch: current,
        reasonId: reasonId ?? null,
        notes: notes ?? null,
        actorId: user?.id ?? null,
      });
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
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['vacancy-matches', vacancy.id] });
      qc.invalidateQueries({ queryKey: ['match-pipeline'] });
    },
  });

  const openProposalEditor = (matchId: string) => setPreviewMatchId(matchId);

  // Accountmanager per match. Deze persoon krijgt de opvolgtaken uit de publieke
  // klantreactie (akkoord, gespreksvoorstel én afwijzing).
  const assignMutation = useMutation({
    mutationFn: async ({ matchId, assigneeId }: { matchId: string; assigneeId: string | null }) => {
      const { error } = await (supabase as any)
        .from('matches')
        .update({ assigned_to: assigneeId })
        .eq('id', matchId)
        .eq('organization_id', orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vacancy-matches', vacancy.id] });
      qc.invalidateQueries({ queryKey: ['match-pipeline'] });
      toast.success('Accountmanager bijgewerkt');
    },
    onError: (e: any) => toast.error(getErrorMessage(e, 'Kon accountmanager niet bijwerken')),
  });

  const deleteMatchMutation = useMutation({
    mutationFn: async (matchId: string) => {
      const { error } = await supabase.from('matches').delete().eq('id', matchId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vacancy-matches', vacancy.id] });
      qc.invalidateQueries({ queryKey: ['available-candidates-for-vacancy'] });
      toast.success('Match verwijderd');
      setDeleteMatchId(null);
    },
    onError: (e: any) => { toast.error(e.message); setDeleteMatchId(null); },
  });

  // Bulk verwijderen — voor het snel opschonen van (test)matches. Bewust géén verplichte
  // reden (afwijzen mét reden is een aparte, behouden flow); geplaatste matches blijven staan.
  const bulkDeleteMutation = useMutation({
    mutationFn: async (matchIds: string[]) => {
      const { error } = await supabase.from('matches').delete().in('id', matchIds);
      if (error) throw error;
      return matchIds.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ['vacancy-matches', vacancy.id] });
      qc.invalidateQueries({ queryKey: ['available-candidates-for-vacancy'] });
      setSelectedMatches(new Set());
      setBulkDeleteOpen(false);
      toast.success(`${n} match${n === 1 ? '' : 'es'} verwijderd`);
    },
    onError: (e: any) => { toast.error(e.message); setBulkDeleteOpen(false); },
  });

  // Counts per status (voor de filterchips).
  const counts: Record<string, number> = { all: (matches ?? []).length };
  for (const col of COLUMNS) counts[col.key] = 0;
  for (const m of (matches ?? [])) counts[(m as any).status] = (counts[(m as any).status] ?? 0) + 1;

  const visibleMatches = (matches ?? []).filter((m: any) => statusFilter === 'all' || m.status === statusFilter);
  const selectedMatchRows = visibleMatches.filter((m: any) => selectedMatches.has(m.id));
  // Geplaatste matches verwijderen we nooit (hangt aan een plaatsing) — net als de per-rij-knop.
  const deletableSelected = selectedMatchRows.filter((m: any) => m.status !== 'geplaatst');
  const allMatchesSelected = visibleMatches.length > 0 && visibleMatches.every((m: any) => selectedMatches.has(m.id));
  const toggleMatch = (id: string) => setSelectedMatches((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAllMatches = () => setSelectedMatches(allMatchesSelected ? new Set() : new Set(visibleMatches.map((m: any) => m.id)));

  // Na acceptatie meteen de plaatsing-popup openen (één match tegelijk).
  // Een al geplaatste match slaan we over: de wizard opnieuw openen suggereert dat
  // er nog geplaatst moet worden en nodigt uit tot een tweede plaatsing.
  const openPlacementForAccepted = (matchIds: string[], toStatus: string) => {
    if (toStatus !== 'geaccepteerd' || matchIds.length !== 1) return;
    const row = (matches ?? []).find((m: any) => m.id === matchIds[0]);
    if (row && row.status !== 'geplaatst') setPlacementMatch(row);
  };

  // Statuswijziging (1 of meer matches). Terminale statussen vragen eerst een feedbackreden.
  const changeStatus = (matchIds: string[], toStatus: string) => {
    if (!matchIds.length) return;
    if (matchStatusNeedsFeedbackDialog(toStatus)) {
      setFeedbackRequest({ matchIds, toStatus });
      setFeedbackReasonId('');
      setFeedbackNotes('');
      return;
    }
    Promise.all(matchIds.map((id) => statusMutation.mutateAsync({ matchId: id, status: toStatus })))
      .then(() => { if (matchIds.length > 1) toast.success(`${matchIds.length} matches → ${statusLabel(toStatus)}`); else toast.success('Status bijgewerkt'); setSelectedMatches(new Set()); openPlacementForAccepted(matchIds, toStatus); })
      .catch(() => { /* per-mutation toast */ });
  };

  const submitFeedbackStatusChange = () => {
    if (!feedbackRequest) return;
    const { matchIds, toStatus } = feedbackRequest;
    Promise.all(matchIds.map((id) => statusMutation.mutateAsync({ matchId: id, status: toStatus, reasonId: feedbackReasonId || null, notes: feedbackNotes })))
      .then(() => {
        toast.success(matchIds.length > 1 ? `${matchIds.length} matches → ${statusLabel(toStatus)}` : 'Status bijgewerkt');
        setFeedbackRequest(null); setFeedbackReasonId(''); setFeedbackNotes(''); setSelectedMatches(new Set());
        openPlacementForAccepted(matchIds, toStatus);
      })
      .catch(() => { /* per-mutation toast */ });
  };

  // Bulk interesse-bericht: stuur per geselecteerde kandidaat een WhatsApp met ja/nee-knoppen.
  // De button-reply-id codeert de match (match_ja:<id> / match_nee:<id>) zodat de webhook later
  // automatisch de fase kan bijwerken. Sturen kan alleen als WhatsApp is gekoppeld.
  const openBulkMessage = () => {
    // Vul standaard met de AI-gegenereerde korte pitch (preview → social), anders de titel-default.
    // Blijft bewerkbaar; {voornaam} en de ja/nee-vraag blijven behouden.
    const pitch = (vacancySeo?.preview_text || vacancySeo?.social_text || '').trim();
    setBulkMessageText(
      pitch
        ? `Hoi {voornaam}, ${pitch}\n\nHeb je interesse?`
        : `Hoi {voornaam}, we hebben een passende functie voor je: ${vacancy.title}. Heb je interesse?`,
    );
    setBulkMessageOpen(true);
  };

  const sendBulkMessage = async () => {
    const rows = selectedMatchRows.filter((m: any) => m.candidates?.phone);
    const noPhone = selectedMatchRows.length - rows.length;
    if (!rows.length) { toast.error('Geen geselecteerde kandidaten met een telefoonnummer'); return; }
    setBulkSending(true);
    let sentDirect = 0; let sentTemplate = 0; let skippedWindow = 0; let pausedCount = 0; const failed: string[] = [];
    for (const m of rows) {
      const c = m.candidates;
      const inWindow = inWindowSet.has(c.id);
      // Meta 24u-regel: buiten het servicevenster komt een vrij bericht niet aan — daar is
      // een goedgekeurde template verplicht. Zonder geschikte template slaan we expliciet over.
      if (!inWindow && !selectedTemplate) { skippedWindow++; continue; }
      try {
        if (inWindow) {
          const text = bulkMessageText.replaceAll('{voornaam}', c.first_name ?? '').replaceAll('{vacature}', vacancy.title ?? '');
          const { data, error } = await supabase.functions.invoke('whatsapp-send', {
            body: {
              to: c.phone,
              type: 'interactive',
              candidate_id: c.id,
              interactive: {
                type: 'button',
                body: { text },
                action: {
                  buttons: [
                    { type: 'reply', reply: { id: `match_ja:${m.id}`, title: 'Ja, interesse' } },
                    { type: 'reply', reply: { id: `match_nee:${m.id}`, title: 'Nee, bedankt' } },
                  ],
                },
              },
            },
          });
          if (error) throw new Error(await extractFunctionErrorMessage(error, 'Versturen mislukt'));
          if (data?.paused) pausedCount++; else sentDirect++;
        } else {
          const { data, error } = await supabase.functions.invoke('whatsapp-send', {
            body: {
              to: c.phone,
              type: 'template',
              candidate_id: c.id,
              template: buildInterestTemplatePayload(selectedTemplate!, {
                firstName: c.first_name ?? '',
                vacancyTitle: vacancy.title ?? '',
                pitch: sanitizeTemplateParam((vacancySeo?.preview_text || vacancySeo?.social_text || '')),
                matchId: m.id,
              }),
            },
          });
          if (error) throw new Error(await extractFunctionErrorMessage(error, 'Versturen mislukt'));
          if (data?.paused) pausedCount++; else sentTemplate++;
        }
      } catch (e: any) {
        failed.push(`${c.first_name}: ${getErrorMessage(e)}`);
      }
    }
    setBulkSending(false);
    setBulkMessageOpen(false);
    setSelectedMatches(new Set());
    const sent = sentDirect + sentTemplate;
    if (sent) {
      const parts = [
        sentDirect ? `${sentDirect} direct` : '',
        sentTemplate ? `${sentTemplate} via template` : '',
      ].filter(Boolean).join(', ');
      const skipped = [
        skippedWindow ? `${skippedWindow} buiten 24u-venster zonder template` : '',
        pausedCount ? `${pausedCount} op pauze (als concept opgeslagen)` : '',
        noPhone ? `${noPhone} zonder telefoon` : '',
      ].filter(Boolean).join(', ');
      toast.success(`Interesse-bericht verstuurd: ${parts}${skipped ? ` (overgeslagen: ${skipped})` : ''}`);
    } else if (pausedCount) {
      toast.warning(`WhatsApp staat op pauze — ${pausedCount} bericht(en) als concept opgeslagen, niets verzonden.`);
    } else if (skippedWindow || noPhone) {
      toast.error(`Niets verstuurd — ${skippedWindow ? `${skippedWindow} buiten het 24u-venster (kies of maak een template)` : ''}${skippedWindow && noPhone ? ', ' : ''}${noPhone ? `${noPhone} zonder telefoon` : ''}`);
    }
    if (failed.length) toast.error(`${failed.length} mislukt: ${failed[0]}`);
  };

  // NIET WEGHALEN als "redundant": zodra `shortlistIncludeWeak` aan staat (elke zoekopdracht, en
  // het filter "Alles") slaat de server zijn eigen drempel over, en is dit de ENIGE plek waar
  // minScore nog wordt afgedwongen. Zonder deze filter verschijnen bij elke zoekopdracht
  // kandidaten onder de gekozen drempel in de shortlist.
  const filteredShortlist = (availableCandidates ?? []).filter(
    (c: any) => (c._vacancyScore?.matchPercent ?? 0) >= minScore,
  );
  // `shortlisted` van de server telt alleen dát wat de gebruiker ook te zien zou krijgen bij een
  // oneindige limiet, zolang de client-side drempel hierboven niets meer wegfiltert. Dat is het
  // geval als de server de drempel zelf toepaste, of als er helemaal geen drempel is (minScore 0).
  // Bij "zoekterm + ≥80%" telt `shortlisted` de hele gezochte pool — dan zwijgen we over totalen
  // in plaats van een verkeerd getal en een zinloos advies te tonen.
  const shortlistTotalExact = !shortlistIncludeWeak || minScore === 0;
  // Meer kandidaten voldoen aan het filter dan er passen binnen "Toon max." — dat moet zichtbaar
  // zijn, anders leest een afgekapte lijst als de volledige uitslag.
  const shortlistTruncated = shortlistTotalExact && rankShortlisted > filteredShortlist.length;
  // Wat we naar rerank-matches sturen: nooit meer dan de servercap, anders wordt de rest stil
  // genegeerd terwijl de knop wél een volledige beoordeling suggereert.
  const rerankTargets = filteredShortlist.slice(0, RERANK_MAX_CANDIDATES);
  const rerankSkipped = filteredShortlist.length - rerankTargets.length;
  // Zodra de AI-herbeoordeling gedraaid heeft, herrangschikken we de shortlist op de AI-fit-score
  // (val terug op de regelscore voor nog-niet-beoordeelde kandidaten). Alleen het blok dat de AI
  // ook echt kán hebben gezien wordt herrangschikt; AI-fitscore en regelscore zijn twee
  // verschillende schalen, dus door elkaar sorteren zou een niet-beoordeelde kandidaat op regelscore
  // boven een door de AI afgeserveerde kandidaat kunnen zetten. Selectie is id-gebaseerd en dus
  // volgorde-onafhankelijk — alleen de weergave verandert.
  const rerankActive = Object.keys(rerankById).length > 0;
  const displayShortlist = rerankActive
    ? [
        ...[...rerankTargets].sort((a: any, b: any) => {
          const fa = rerankById[a.id]?.fit_score ?? a._vacancyScore?.matchPercent ?? 0;
          const fb = rerankById[b.id]?.fit_score ?? b._vacancyScore?.matchPercent ?? 0;
          return fb - fa;
        }),
        ...filteredShortlist.slice(RERANK_MAX_CANDIDATES),
      ]
    : filteredShortlist;
  const selectedCandidates = filteredShortlist.filter((c: any) => selectedShortlist.has(c.id));
  const allShortlistSelected = filteredShortlist.length > 0 && filteredShortlist.every((c: any) => selectedShortlist.has(c.id));
  const toggleShortlist = (id: string) => setSelectedShortlist((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAllShortlist = () => setSelectedShortlist(
    allShortlistSelected ? new Set() : new Set(filteredShortlist.map((c: any) => c.id)),
  );

  // Volgende logische fase (voor de snelle "→"-knop per rij).
  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-semibold">Match-pipeline</h3>
        <Button variant="outline" size="sm" onClick={() => rescoreMutation.mutate()} disabled={rescoreMutation.isPending || !(matches?.length)}>
          <Sparkles className="h-3 w-3 mr-1" /> {rescoreMutation.isPending ? 'Berekenen...' : 'Herbereken scores'}
        </Button>
      </div>

      {/* Statusfilter-chips met telling */}
      <div className="flex gap-1.5 flex-wrap">
        <button
          onClick={() => { setStatusFilter('all'); setSelectedMatches(new Set()); }}
          className={cn('text-xs rounded-full border px-2.5 py-1 transition-colors', statusFilter === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted')}
        >
          Alle <span className="tabular-nums">({counts.all})</span>
        </button>
        {COLUMNS.map((col) => (
          <button
            key={col.key}
            onClick={() => { setStatusFilter(col.key); setSelectedMatches(new Set()); }}
            className={cn('text-xs rounded-full border px-2.5 py-1 transition-colors flex items-center gap-1.5', statusFilter === col.key ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted')}
          >
            <span className={cn('w-1.5 h-1.5 rounded-full', col.color)} /> {col.label} <span className="tabular-nums">({counts[col.key] ?? 0})</span>
          </button>
        ))}
      </div>

      {/* Bulk-actiebalk */}
      {visibleMatches.length > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap rounded-md border bg-muted/30 px-3 py-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={allMatchesSelected} onCheckedChange={toggleAllMatches} />
            {selectedMatches.size > 0 ? `${selectedMatches.size} geselecteerd` : `Alles selecteren (${visibleMatches.length})`}
          </label>
          {selectedMatches.size > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="ghost" onClick={() => setSelectedMatches(new Set())}>Selectie wissen</Button>
              <Select value="" onValueChange={(v) => changeStatus([...selectedMatches], v)}>
                <SelectTrigger className="h-8 w-auto gap-1 text-xs"><SelectValue placeholder="Status wijzigen…" /></SelectTrigger>
                <SelectContent>
                  {COLUMNS.map((col) => <SelectItem key={col.key} value={col.key}>{col.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={openBulkMessage} className="gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" /> Interesse-bericht ({selectedMatches.size})
              </Button>
              {deletableSelected.length > 0 && (
                <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-red-600" onClick={() => setBulkDeleteOpen(true)}>
                  <Trash2 className="h-3.5 w-3.5" /> Verwijderen ({deletableSelected.length})
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Matchlijst (rijen onder elkaar i.p.v. kaarten) */}
      <div className="space-y-2">
        {visibleMatches.map((m: any) => {
          const c = m.candidates ?? {};
          const checked = selectedMatches.has(m.id);
          const bd = m.match_breakdown;
          // De per-rij render is geünificeerd op de gedeelde MatchRow (zelfde component
          // als MatchPipeline + CandidateMatchesTab). Alle orchestratie blijft hier:
          // changeStatus/openPlacementForAccepted/feedbackDialog/mail-editor/PlacementSheet
          // ongewijzigd; MatchRow krijgt alleen de bestaande handlers via zijn seams.
          // hideVacancy: dit is de matchtab van één vacature, dus geen vacatureregel.
          return (
            <MatchRow
              key={m.id}
              id={m.id}
              status={m.status}
              candidate={c}
              hideVacancy
              sourceLabel={m.source ? (sourceLabel[m.source] ?? m.source) : null}
              score={m.match_score}
              breakdown={bd}
              candidateQuality={bd?.candidateQuality ?? null}
              distanceKm={m.distance_km}
              durationMin={m.duration_min}
              statusChangedAt={m.status_changed_at}
              createdAt={m.created_at}
              selected={checked}
              onSelectChange={() => toggleMatch(m.id)}
              assignee={m.assignee}
              assigneeControl={
                <MatchAssigneeSelect
                  inline
                  value={m.assigned_to}
                  current={m.assignee}
                  options={matchAssignees}
                  disabled={assignMutation.isPending}
                  ariaLabel={`Accountmanager koppelen voor ${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()}
                  onChange={(assigneeId) => assignMutation.mutate({ matchId: m.id, assigneeId })}
                />
              }
              onInspect={() => setDetail({ name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim(), breakdown: bd, quality: bd?.candidateQuality ?? null, candidate: c })}
              primaryAction={
                m.status === 'voorgesteld' ? (
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => openProposalEditor(m.id)}>
                    <Mail className="h-3 w-3 mr-1" /> Mail
                  </Button>
                ) : m.status === 'geaccepteerd' ? (
                  <Button size="sm" className="h-8 text-xs" onClick={() => setPlacementMatch(m)}>Plaatsen</Button>
                ) : undefined
              }
              secondaryActions={
                <>
                  {m.status !== 'geplaatst' && (
                    <Link to={`/kandidaten/${c.id}?tab=screening&vacancy=${vacancy.id}`} onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="ghost" className="h-8 text-xs" title="Bellen / screenen voor deze vacature" aria-label="Bellen / screenen voor deze vacature">
                        <PhoneCall className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  )}
                  {!isTerminalMatchStatus(m.status) && c.email && (
                    <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setCandidateProposalMatchId(m.id)} title="Baanvoorstel mailen naar medewerker" aria-label={`Baanvoorstel mailen naar ${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()}>
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {getNextMatchStatus(m.status) && (
                    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => changeStatus([m.id], getNextMatchStatus(m.status)!)} title={`Naar ${statusLabel(getNextMatchStatus(m.status)!)}`}>
                      → {statusLabel(getNextMatchStatus(m.status)!)}
                    </Button>
                  )}
                  {!isTerminalMatchStatus(m.status) && (
                    <Button size="sm" variant="ghost" className="h-8 text-xs text-red-600" onClick={() => changeStatus([m.id], 'afgewezen')} aria-label={`Match afwijzen voor ${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()}>
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                  {m.status !== 'geplaatst' && (
                    <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground hover:text-red-600" onClick={() => setDeleteMatchId(m.id)} aria-label={`Match verwijderen voor ${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()} title="Match verwijderen">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </>
              }
            />
          );
        })}
        {visibleMatches.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {statusFilter === 'all' ? 'Nog geen matches. Stel hieronder kandidaten voor uit de database.' : `Geen matches in "${statusLabel(statusFilter)}".`}
          </p>
        )}
      </div>

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
          <Select value={scoreFilter} onValueChange={(v) => { setScoreFilter(v as any); setSelectedShortlist(new Set()); }}>
            <SelectTrigger className="w-full sm:w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="strong">Sterke matches</SelectItem>
              <SelectItem value="60">Match ≥ 60%</SelectItem>
              <SelectItem value="70">Match ≥ 70%</SelectItem>
              <SelectItem value="80">Match ≥ 80%</SelectItem>
              <SelectItem value="all">Alles (incl. zwak)</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={String(shortlistLimit)}
            onValueChange={(v) => { setShortlistLimit(Number(v)); setSelectedShortlist(new Set()); }}
          >
            <SelectTrigger className="w-full sm:w-40" title="Hoeveel kandidaten uit de ranglijst je maximaal te zien krijgt">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SHORTLIST_LIMIT_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>Toon max. {n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 whitespace-nowrap sm:ml-auto"
            disabled={rerankMutation.isPending || rerankTargets.length === 0}
            title={`Weegt de volledige vacaturetekst tegen elk profiel met Gemini en herrangschikt de shortlist (maximaal ${RERANK_MAX_CANDIDATES} kandidaten per keer)`}
            onClick={() => rerankMutation.mutate(rerankTargets.map((c: any) => c.id))}
          >
            <Sparkles className={cn('h-3.5 w-3.5', rerankMutation.isPending && 'animate-pulse')} />
            {rerankMutation.isPending ? 'AI beoordeelt…' : rerankActive ? 'AI opnieuw' : 'AI-herbeoordeling'}
          </Button>
        </div>

        {/* Alleen tonen als de server de totalen daadwerkelijk meestuurt — een oudere deploy van
            rank-candidates zonder pool_size/shortlisted mag hier geen "0 beoordeeld" van maken. */}
        {!rankError && rankShortlisted > 0 && filteredShortlist.length > 0 && (
          <div className="-mt-1 space-y-1">
            <p className="text-xs text-muted-foreground">
              {!shortlistTotalExact ? (
                // Zoekterm mét drempel: de server telde ongefilterd, dus over het totaal kunnen we
                // niets waars zeggen. Alleen melden wat er in beeld staat.
                <><span className="font-medium text-foreground">{filteredShortlist.length}</span> kandidaten in beeld.</>
              ) : shortlistTruncated ? (
                <>Top <span className="font-medium text-foreground">{filteredShortlist.length}</span> van <span className="font-medium text-foreground">{rankShortlisted}</span> {shortlistIncludeWeak ? 'kandidaten' : 'passende kandidaten'}.</>
              ) : (
                <><span className="font-medium text-foreground">{rankShortlisted}</span> {shortlistIncludeWeak ? 'kandidaten' : 'passende kandidaten'} — dit is de volledige lijst.</>
              )}
            </p>
            {rankPoolSize > 0 && (
              <p className="text-xs text-muted-foreground">
                Gezocht in een pool van {rankPoolSize} kandidaten.
              </p>
            )}
            {shortlistTruncated && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {rankShortlisted - filteredShortlist.length} kandidaten vallen buiten deze weergave. Zet &ldquo;Toon max.&rdquo; hoger om ze te zien.
              </p>
            )}
          </div>
        )}

        {filteredShortlist.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            AI-herbeoordeling weegt de vólledige vacaturetekst tegen elk profiel (Gemini, ± 1 cent per kandidaat, resultaat wordt gecached) en herrangschikt op de AI-fitscore.
            {rerankSkipped > 0
              ? ` Per keer worden alleen de bovenste ${RERANK_MAX_CANDIDATES} kandidaten beoordeeld; de overige ${rerankSkipped} blijven eronder op hun regelscore staan.`
              : ` Nu ${rerankTargets.length} kandidaten.`}
          </p>
        )}

        {rankFetching && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 animate-pulse" /> Kandidaten rangschikken uit de volledige database…
          </p>
        )}

        {filteredShortlist.length > 0 && (
          <div className="flex items-center justify-between gap-3 flex-wrap rounded-md border bg-muted/30 px-3 py-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={allShortlistSelected} onCheckedChange={toggleAllShortlist} />
              {selectedShortlist.size > 0 ? `${selectedShortlist.size} geselecteerd` : `Alles selecteren (${filteredShortlist.length})`}
            </label>
            {selectedShortlist.size > 0 && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => setSelectedShortlist(new Set())}>Selectie wissen</Button>
                <Button size="sm" onClick={() => bulkProposeMutation.mutate(selectedCandidates)} disabled={bulkProposeMutation.isPending} className="gap-1.5">
                  <UserPlus className="h-3.5 w-3.5" /> {bulkProposeMutation.isPending ? 'Match maken…' : `Match maken (${selectedShortlist.size})`}
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="space-y-2">
          {rankFetching && !availableCandidates &&
            Array.from({ length: 6 }).map((_, i) => (
              <Card key={`rank-skeleton-${i}`} className="p-3 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-full" />
              </Card>
            ))}
          {displayShortlist.map((c: any) => {
            const checked = selectedShortlist.has(c.id);
            const candidateWithContext = { ...c, ...(shortlistContextById.get(c.id) ?? {}) };
            const rr = rerankById[c.id];
            return (
              <Card key={c.id} className={cn('p-3', checked && 'ring-1 ring-primary')}>
                <div className="flex items-start gap-3">
                  <Checkbox className="mt-1 flex-shrink-0" checked={checked} onCheckedChange={() => toggleShortlist(c.id)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <Link to={`/kandidaten/${c.id}`} className="font-medium text-sm hover:text-stat-blue truncate">{c.first_name} {c.last_name}</Link>
                      <Badge className={cn('text-[10px] px-1.5 py-0 flex-shrink-0', scoreBadgeClass[c._vacancyScore.label as MatchBreakdown['label']])}>
                        {c._vacancyScore.matchPercent}% match
                      </Badge>
                      {typeof c._candidateQuality === 'number' && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0" title="Algemene AI-kwaliteitsscore (los van deze vacature)">★ {c._candidateQuality}</Badge>
                      )}
                      {rr && (
                        <Badge className={cn('text-[10px] px-1.5 py-0 flex-shrink-0 gap-0.5', verdictBadgeClass[rr.verdict] ?? 'bg-muted text-muted-foreground border-0')} title={`AI-oordeel op de volledige vacaturetekst — ${rr.verdict}${rr.cached ? ' (uit cache)' : ''}`}>
                          <Sparkles className="h-2.5 w-2.5" /> AI {rr.fit_score}
                        </Badge>
                      )}
                    </div>
                    <MatchSkillBadges
                      skillMatches={c._vacancyScore.skillMatches}
                      certMatches={c._vacancyScore.certificationMatches}
                      fallbackSkills={c.skills ?? []}
                      extras={vacancy.requires_drivers_license && c.has_drivers_license ? <Badge variant="outline" className="text-xs">Rijbewijs</Badge> : null}
                    />
                    {c._vacancyScore.missing.length > 0 && (
                      <p className="text-[11px] text-amber-700 mt-1 line-clamp-1">{c._vacancyScore.missing[0]}</p>
                    )}
                    {rr?.reasoning && (
                      <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
                        <span className="font-medium text-foreground/70">AI-oordeel:</span> {rr.reasoning}
                      </p>
                    )}
                    {Array.isArray(rr?.concerns) && rr.concerns.length > 0 && (
                      <p className="text-[11px] text-amber-700 mt-0.5 line-clamp-1" title={rr.concerns.join(' · ')}>
                        Aandacht: {rr.concerns[0]}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <Button size="sm" variant="outline" onClick={() => proposeMutation.mutate(c)} disabled={proposeMutation.isPending}>
                      <UserPlus className="h-3 w-3 mr-1" /> Match maken
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => setDetail({ name: `${c.first_name} ${c.last_name}`, breakdown: c._vacancyScore, quality: c._candidateQuality, candidate: candidateWithContext, rerank: rr })}>
                      Waarom?
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
          {rankError && <p className="text-sm text-red-600">Kandidaten konden niet worden geladen. Probeer het opnieuw.</p>}
          {!rankError && !rankFetching && filteredShortlist.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {minScore > 0 ? `Geen kandidaten met match ≥ ${minScore}%` : 'Geen beschikbare kandidaten met deze vacature-eisen gevonden'}
              {rankPoolSize > 0 ? ` — gezocht in een pool van ${rankPoolSize} kandidaten.` : '.'}
            </p>
          )}
        </div>
      </div>

      <MatchInspectorDialog
        open={!!detail}
        onOpenChange={(open) => { if (!open) setDetail(null); }}
        title="Waarom deze match?"
        description={detail ? `${detail.name} — opbouw van de matchscore.` : undefined}
        breakdown={detail?.breakdown ?? null}
        candidateQuality={detail?.quality ?? detail?.breakdown?.candidateQuality ?? null}
        candidate={detail?.candidate ?? null}
        rerank={detail?.rerank ?? null}
        vacancyContext={[
          { label: 'Vacature', value: vacancy.title },
          { label: 'Locatie', value: vacancy.location },
          { label: 'Start', value: vacancy.start_date_text ?? vacancy.start_date },
          { label: 'Bezetting', value: `${vacancy.filled_count ?? 0}/${vacancy.required_count ?? 0}` },
          { label: 'Urgentie', value: vacancy.urgency },
        ]}
        action={detail?.candidate ? (
          <Button onClick={() => { proposeMutation.mutate(detail.candidate); setDetail(null); }} disabled={proposeMutation.isPending}>
            <UserPlus className="h-3 w-3 mr-1" /> Match maken
          </Button>
        ) : null}
      />

      <PlacementWizard open={!!placementMatch} match={placementMatch} vacancy={vacancy} onClose={() => setPlacementMatch(null)} />

      <MatchProposalEmailDialog
        open={!!previewMatchId}
        matchId={previewMatchId}
        onOpenChange={(open) => { if (!open) setPreviewMatchId(null); }}
        onSent={() => {
          qc.invalidateQueries({ queryKey: ['vacancy-matches', vacancy.id] });
          qc.invalidateQueries({ queryKey: ['match-pipeline'] });
        }}
      />

      <CandidateProposalEmailDialog
        open={!!candidateProposalMatchId}
        matchId={candidateProposalMatchId}
        onOpenChange={(open) => { if (!open) setCandidateProposalMatchId(null); }}
        onSent={() => {
          qc.invalidateQueries({ queryKey: ['vacancy-matches', vacancy.id] });
        }}
      />

      <AlertDialog open={!!deleteMatchId} onOpenChange={(open) => { if (!open) setDeleteMatchId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Match verwijderen?</AlertDialogTitle>
            <AlertDialogDescription>
              De match wordt definitief verwijderd. De kandidaat verschijnt weer in de shortlist. Dit kan niet ongedaan worden gemaakt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleteMatchId && deleteMatchMutation.mutate(deleteMatchId)} disabled={deleteMatchMutation.isPending}>
              Verwijderen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={(open) => { if (!open) setBulkDeleteOpen(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deletableSelected.length} match{deletableSelected.length === 1 ? '' : 'es'} verwijderen?</AlertDialogTitle>
            <AlertDialogDescription>
              De geselecteerde matches worden definitief verwijderd; de kandidaten verschijnen weer in de shortlist. Geplaatste matches blijven staan. Dit kan niet ongedaan worden gemaakt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => bulkDeleteMutation.mutate(deletableSelected.map((m: any) => m.id))} disabled={bulkDeleteMutation.isPending}>
              Verwijderen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MatchOutboundDialog
        open={bulkMessageOpen}
        title="Interesse-bericht sturen"
        description={`Stuurt geselecteerde kandidaten een WhatsApp met ja/nee-knoppen. {voornaam} en {vacature} worden ingevuld.`}
        channelLabel="WhatsApp"
        selectedCount={selectedMatchRows.length}
        missingContactCount={selectedMatchRows.filter((m: any) => !m.candidates?.phone).length}
        paused={outboundPaused?.whatsapp === true}
        pausedLabel="Uitgaande WhatsApp staat op pauze voor deze organisatie."
        message={bulkMessageText}
        pending={bulkSending}
        onMessageChange={setBulkMessageText}
        onCancel={() => setBulkMessageOpen(false)}
        onConfirm={sendBulkMessage}
        extra={(() => {
          // Meta 24u-regel: split tussen kandidaten mét open servicevenster (vrij bericht)
          // en daarbuiten (template verplicht).
          const withPhone = selectedMatchRows.filter((m: any) => m.candidates?.phone);
          const outWindow = withPhone.filter((m: any) => !inWindowSet.has(m.candidates.id));
          if (outWindow.length === 0) return null;
          return (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <p className="text-sm font-medium">
                {outWindow.length} van {withPhone.length} kandidaten buiten het 24-uursvenster
              </p>
              <p className="text-xs text-muted-foreground">
                WhatsApp bezorgt buiten het servicevenster (24 uur na het laatste bericht van de kandidaat)
                alleen goedgekeurde templates. Deze kandidaten krijgen de template hieronder; de rest krijgt
                het vrije bericht.
              </p>
              {interestTemplates.length > 0 ? (
                <>
                  <Select value={bulkTemplateId} onValueChange={setBulkTemplateId}>
                    <SelectTrigger><SelectValue placeholder="Kies template" /></SelectTrigger>
                    <SelectContent>
                      {interestTemplates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.template_name} ({t.language})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedTemplate && (
                    <p className="rounded bg-background p-2 text-xs text-muted-foreground">
                      {previewInterestTemplate(selectedTemplate, {
                        firstName: 'voornaam',
                        vacancyTitle: vacancy.title ?? '',
                        pitch: sanitizeTemplateParam(vacancySeo?.preview_text || vacancySeo?.social_text || ''),
                      })}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs font-medium text-orange-600">
                  Geen goedgekeurde template met ja/nee-knoppen gevonden — deze kandidaten worden
                  overgeslagen. Maak er één aan via Instellingen → WhatsApp (twee quick-reply-knoppen).
                </p>
              )}
            </div>
          );
        })()}
      />

      <MatchFeedbackDialog
        open={!!feedbackRequest}
        toStatus={feedbackRequest?.toStatus}
        count={feedbackRequest?.matchIds.length ?? 1}
        reasons={feedbackReasons as any[]}
        reasonId={feedbackReasonId}
        notes={feedbackNotes}
        pending={statusMutation.isPending}
        onReasonChange={setFeedbackReasonId}
        onNotesChange={setFeedbackNotes}
        onCancel={() => setFeedbackRequest(null)}
        onSubmit={submitFeedbackStatusChange}
      />
    </div>
  );
};

export default VacancyMatchesTab;
