import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useOutboundPause } from '@/hooks/useOutboundPause';
import { useAuth } from '@/contexts/AuthContext';
import { Link } from 'react-router-dom';
import { AlertTriangle, Search, UserPlus, Sparkles, Mail, Star, X, MessageSquare, Trash2, FileText, PhoneCall } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useOutlookAccounts } from '@/hooks/useOutlookAccounts';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import PlacementSheet from '@/components/vacancies/PlacementSheet';
import MatchFeedbackDialog from '@/components/matches/MatchFeedbackDialog';
import MatchInspectorDialog from '@/components/matches/MatchInspectorDialog';
import MatchOutboundDialog from '@/components/matches/MatchOutboundDialog';
import MatchRow from '@/components/matches/MatchRow';
import { type MatchBreakdown } from '@/lib/matching';
import { MATCH_STATUS_STEPS, getMatchStatusMeta, getNextMatchStatus, isTerminalMatchStatus, matchStatusNeedsFeedbackDialog } from '@/lib/match-status';
import { scoreBadgeClass } from '@/lib/match-presenters';

const COLUMNS = MATCH_STATUS_STEPS;

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
  const { user } = useAuth();
  const qc = useQueryClient();
  const [candidateSearch, setCandidateSearch] = useState('');
  const [placementMatch, setPlacementMatch] = useState<any>(null);
  const [previewMatchId, setPreviewMatchId] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // V1 voorstel-editor (afzender/ontvanger/CC/BCC/toggles/CV + bewerkbare body)
  const { usableAccounts, defaultAccountId } = useOutlookAccounts('mail_send');
  const personalAccounts = usableAccounts.filter((a) => a.scope === 'personal');
  const orgAccounts = usableAccounts.filter((a) => a.scope === 'organization');
  const [mailAccountId, setMailAccountId] = useState<string | undefined>(undefined);
  const [mailTo, setMailTo] = useState('');
  const [mailCc, setMailCc] = useState('');
  const [mailBcc, setMailBcc] = useState('');
  const [mailSubject, setMailSubject] = useState('');
  const [mailBody, setMailBody] = useState('');
  const [mailRecipients, setMailRecipients] = useState<{ email: string; name: string; is_primary: boolean }[]>([]);
  const [mailHasCv, setMailHasCv] = useState(false);
  const [mailIncludeCv, setMailIncludeCv] = useState(false);
  const [mailHideReport, setMailHideReport] = useState(false);
  const [mailHideReliability, setMailHideReliability] = useState(true);
  const [deleteMatchId, setDeleteMatchId] = useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [scoreFilter, setScoreFilter] = useState<'strong' | '60' | '70' | '80' | 'all'>('strong');
  const [selectedShortlist, setSelectedShortlist] = useState<Set<string>>(new Set());
  // Detail-dialoog: werkt zowel voor een shortlist-kandidaat (met candidate → "Voorstellen")
  // als voor een bestaande match (alleen lezen, breakdown uit match_breakdown).
  const [detail, setDetail] = useState<{ name: string; breakdown: any; quality?: number | null; candidate?: any } | null>(null);
  const showWeakMatches = scoreFilter === 'all';
  const minScore = scoreFilter === '60' ? 60 : scoreFilter === '70' ? 70 : scoreFilter === '80' ? 80 : 0;
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
  const { data: outboundPaused } = useOutboundPause(orgId);

  const { data: matches } = useQuery({
    queryKey: ['vacancy-matches', vacancy.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('matches')
        .select(`*, candidates!matches_candidate_id_fkey(id, first_name, last_name, email, phone, compliance_status, available_from, available_until, arrival_date, availability_notes, ai_analysis, ai_summary, ai_classification, ai_reliability_score, screening_data, screened_at, skills, certifications, languages, has_drivers_license, has_dutch_address, address_city)`)
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
  const { data: availableCandidates, isError: rankError, isFetching: rankFetching } = useQuery({
    queryKey: ['available-candidates-for-vacancy', vacancy.id, candidateSearch, scoreFilter, showWeakMatches, (matches ?? []).length],
    queryFn: async () => {
      const matchedIds = (matches ?? []).map((m: any) => m.candidate_id);
      const { data, error } = await supabase.functions.invoke('rank-candidates', {
        body: {
          vacancy_id: vacancy.id,
          include_weak: showWeakMatches || !!candidateSearch,
          search: candidateSearch || undefined,
          exclude_candidate_ids: matchedIds,
          criteria_options: {
            minScore: minScore || undefined,
            requireSkillSignal: scoreFilter === 'strong',
          },
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
    }).select('id').single();
    if (error) throw error;
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

      if (reasonId || notes || isTerminalMatchStatus(status)) {
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
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['vacancy-matches', vacancy.id] });
      qc.invalidateQueries({ queryKey: ['match-pipeline'] });
    },
  });

  // Haalt (of ververst) de server-side preview op met de huidige toggles.
  const openPreview = async (matchId: string, opts: { hideReport: boolean; hideReliability: boolean; resetTo?: boolean }) => {
    setPreviewMatchId(matchId);
    setPreviewLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-match-proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ match_id: matchId, preview: true, hide_ai_report: opts.hideReport, hide_reliability: opts.hideReliability }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Kon preview niet laden');
      setMailSubject(json.subject ?? '');
      setMailBody(json.html ?? '');
      setMailRecipients(json.recipients ?? []);
      setMailHasCv(!!json.has_cv);
      if (opts.resetTo) setMailTo(json.to ?? '');
    } catch (e: any) {
      toast.error(e.message);
      setPreviewMatchId(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Opent de editor met standaardwaarden (score verborgen, rapport zichtbaar).
  const openProposalEditor = (matchId: string) => {
    setMailHideReport(false);
    setMailHideReliability(true);
    setMailCc(''); setMailBcc(''); setMailIncludeCv(false);
    setMailAccountId(defaultAccountId);
    openPreview(matchId, { hideReport: false, hideReliability: true, resetTo: true });
  };

  const splitEmails = (value: string) => value.split(/[;,]/).map((s) => s.trim()).filter(Boolean);

  const sendProposalMutation = useMutation({
    mutationFn: async (matchId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-match-proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          match_id: matchId,
          account_id: mailAccountId ?? null,
          recipient_email: mailTo || undefined,
          cc: mailCc ? splitEmails(mailCc) : undefined,
          bcc: mailBcc ? splitEmails(mailBcc) : undefined,
          subject: mailSubject || undefined,
          html: mailBody || undefined,
          include_cv: mailIncludeCv,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.success === false) throw new Error(json.error ?? json.outlook_error ?? 'Fout bij versturen');
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vacancy-matches', vacancy.id] });
      toast.success('Voorstel verstuurd naar opdrachtgever');
      setPreviewMatchId(null);
    },
    onError: (e: any) => toast.error(e.message),
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
  const openPlacementForAccepted = (matchIds: string[], toStatus: string) => {
    if (toStatus !== 'geaccepteerd' || matchIds.length !== 1) return;
    const row = (matches ?? []).find((m: any) => m.id === matchIds[0]);
    if (row) setPlacementMatch(row);
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
    setBulkMessageText(`Hoi {voornaam}, we hebben een passende functie voor je: ${vacancy.title}. Heb je interesse?`);
    setBulkMessageOpen(true);
  };

  const sendBulkMessage = async () => {
    const rows = selectedMatchRows.filter((m: any) => m.candidates?.phone);
    const noPhone = selectedMatchRows.length - rows.length;
    if (!rows.length) { toast.error('Geen geselecteerde kandidaten met een telefoonnummer'); return; }
    setBulkSending(true);
    let sent = 0; const failed: string[] = [];
    for (const m of rows) {
      const c = m.candidates;
      const text = bulkMessageText.replaceAll('{voornaam}', c.first_name ?? '').replaceAll('{vacature}', vacancy.title ?? '');
      try {
        const { error } = await supabase.functions.invoke('whatsapp-send', {
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
        if (error) throw new Error(error.message);
        sent++;
      } catch (e: any) {
        failed.push(`${c.first_name}: ${String(e.message).slice(0, 80)}`);
      }
    }
    setBulkSending(false);
    setBulkMessageOpen(false);
    setSelectedMatches(new Set());
    if (sent) toast.success(`${sent} interesse-bericht${sent === 1 ? '' : 'en'} verstuurd${noPhone ? ` (${noPhone} zonder telefoon overgeslagen)` : ''}`);
    if (failed.length) toast.error(`${failed.length} mislukt: ${failed[0]}`);
  };

  // Shortlist na client-side drempelfilter (server levert de top-25 op score).
  const filteredShortlist = (availableCandidates ?? []).filter(
    (c: any) => (c._vacancyScore?.matchPercent ?? 0) >= minScore,
  );
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
              onInspect={() => setDetail({ name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim(), breakdown: bd, quality: bd?.candidateQuality ?? null, candidate: c })}
              primaryAction={
                m.status === 'voorgesteld' ? (
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => openProposalEditor(m.id)} disabled={previewLoading && previewMatchId === m.id}>
                    <Mail className="h-3 w-3 mr-1" /> {previewLoading && previewMatchId === m.id ? '...' : 'Mail'}
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
        </div>

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
          {filteredShortlist.map((c: any) => {
            const checked = selectedShortlist.has(c.id);
            const candidateWithContext = { ...c, ...(shortlistContextById.get(c.id) ?? {}) };
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
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <Button size="sm" variant="outline" onClick={() => proposeMutation.mutate(c)} disabled={proposeMutation.isPending}>
                      <UserPlus className="h-3 w-3 mr-1" /> Nieuwe match
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => setDetail({ name: `${c.first_name} ${c.last_name}`, breakdown: c._vacancyScore, quality: c._candidateQuality, candidate: candidateWithContext })}>
                      Waarom?
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
          {rankError && <p className="text-sm text-red-600">Kandidaten konden niet worden geladen. Probeer het opnieuw.</p>}
          {!rankError && !rankFetching && filteredShortlist.length === 0 && (
            <p className="text-sm text-muted-foreground">{minScore > 0 ? `Geen kandidaten met match ≥ ${minScore}%.` : 'Geen beschikbare kandidaten met deze vacature-eisen gevonden'}</p>
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

      <PlacementSheet match={placementMatch} vacancy={vacancy} onClose={() => setPlacementMatch(null)} />

      <Dialog open={!!previewMatchId} onOpenChange={(open) => { if (!open) setPreviewMatchId(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Voorstel versturen</DialogTitle>
            <DialogDescription>Pas de mail aan en kies afzender, ontvanger en bijlagen.</DialogDescription>
          </DialogHeader>
          {outboundPaused?.email === true && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>E-mail staat op pauze</AlertTitle>
              <AlertDescription>Je kunt de voorbereiding controleren, maar versturen is geblokkeerd door de outbound kill-switch.</AlertDescription>
            </Alert>
          )}

          <div className="space-y-3">
            {usableAccounts.length > 1 && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Afzender</Label>
                <Select value={mailAccountId} onValueChange={setMailAccountId}>
                  <SelectTrigger><SelectValue placeholder="Kies afzender-mailbox" /></SelectTrigger>
                  <SelectContent>
                    {personalAccounts.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Persoonlijk</SelectLabel>
                        {personalAccounts.map((a) => <SelectItem key={a.account_id} value={a.account_id}>{a.label || a.email || 'Persoonlijke mailbox'}</SelectItem>)}
                      </SelectGroup>
                    )}
                    {orgAccounts.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Bedrijf</SelectLabel>
                        {orgAccounts.map((a) => <SelectItem key={a.account_id} value={a.account_id}>{a.label || a.email || 'Bedrijfsmailbox'}</SelectItem>)}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Aan</Label>
              {mailRecipients.length > 0 ? (
                <Select value={mailTo} onValueChange={setMailTo}>
                  <SelectTrigger><SelectValue placeholder="Kies ontvanger" /></SelectTrigger>
                  <SelectContent>
                    {mailRecipients.map((r) => (
                      <SelectItem key={r.email} value={r.email}>
                        {r.is_primary ? '★ ' : ''}{r.name} &lt;{r.email}&gt;
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={mailTo} onChange={(e) => setMailTo(e.target.value)} placeholder="ontvanger@bedrijf.nl" />
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">CC</Label>
                <Input value={mailCc} onChange={(e) => setMailCc(e.target.value)} placeholder="optioneel, komma-gescheiden" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">BCC</Label>
                <Input value={mailBcc} onChange={(e) => setMailBcc(e.target.value)} placeholder="optioneel, komma-gescheiden" />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Onderwerp</Label>
              <Input value={mailSubject} onChange={(e) => setMailSubject(e.target.value)} />
            </div>

            <div className="flex flex-wrap gap-4 pt-1">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={mailHideReport} onCheckedChange={(v) => { setMailHideReport(!!v); openPreview(previewMatchId!, { hideReport: !!v, hideReliability: mailHideReliability }); }} />
                Rapport verbergen
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={mailHideReliability} onCheckedChange={(v) => { setMailHideReliability(!!v); openPreview(previewMatchId!, { hideReport: mailHideReport, hideReliability: !!v }); }} />
                Betrouwbaarheidsscore verbergen
              </label>
              {mailHasCv && (
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={mailIncludeCv} onCheckedChange={(v) => setMailIncludeCv(!!v)} />
                  <FileText className="h-3.5 w-3.5" /> CV meesturen
                </label>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Bericht (HTML)</Label>
              <Textarea value={mailBody} onChange={(e) => setMailBody(e.target.value)} className="font-mono text-xs h-28" />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Voorbeeld</Label>
              <div className="border rounded mt-1">
                {previewLoading
                  ? <div className="py-10 text-center text-sm text-muted-foreground">Voorbeeld laden…</div>
                  : <iframe title="email-preview" srcDoc={mailBody} sandbox="" className="w-full" style={{ height: '360px' }} />}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewMatchId(null)}>Annuleren</Button>
            <Button onClick={() => previewMatchId && sendProposalMutation.mutate(previewMatchId)} disabled={!mailBody || !mailTo || sendProposalMutation.isPending || outboundPaused?.email === true}>
              {outboundPaused?.email === true ? 'E-mail gepauzeerd' : sendProposalMutation.isPending ? 'Versturen...' : 'Versturen naar opdrachtgever'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
