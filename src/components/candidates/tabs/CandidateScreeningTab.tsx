import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDecryptedCandidate } from '@/hooks/useDecryptedCandidate';
import { logAudit } from '@/lib/audit';
import { unwrap } from '@/lib/db';
import {
  applyCandidateScreeningAiSuggestion,
  aiCertLabels,
  aiHardSkillLabels,
  aiLanguageLabels,
  aiWorkFunctions,
  askedCount,
  buildSnapshot,
  createCandidateScreeningFollowupTask,
  deriveCandidateScreeningCallQuestions,
  displayList,
  durationRailClass,
  durationToneClass,
  formatWorkDuration,
  getAiProfileDiffs,
  getCandidateScreeningOpenItems,
  getInitialData,
  getMissingProfileFields,
  getProfileDraft,
  goToCandidateScreeningStep,
  importantMissingFields,
  normalizeGeneratedCallQuestionsResponse,
  patchCandidateScreeningAnswer,
  patchCandidateScreeningPersonal,
  patchCandidateScreeningProfessional,
  PROFESSIONAL_RATINGS,
  QUESTION_BANK,
  RESULT_OPTIONS,
  RISK_LEVELS,
  saveCandidateScreening,
  saveCandidateScreeningSensitiveField,
  SCREENING_STEPS,
  startCandidateScreeningCall,
  startCandidateScreeningReanalysis,
  STATUS_META,
  validateCandidateScreeningCompletion,
  workDurationMonths,
  type CandidateScreeningCompletionNote,
  type CandidateScreeningFollowupTask,
  type ProfileDraft,
  type ProfileSuggestion,
  type ScreeningAnswer,
  type ScreeningData,
  type SensitiveCandidateField,
} from '@/lib/candidateScreening';
import { extractFunctionErrorMessage } from '@/lib/functionError';
import { InlineSensitiveField } from '@/components/shared/InlineFields';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import TagInput from '@/components/ui/tag-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import NationalitySelect from '@/components/shared/NationalitySelect';
import SkillMultiSelect from '@/components/shared/SkillMultiSelect';
import LanguageMultiSelect from '@/components/shared/LanguageMultiSelect';
import WorkHistoryTimeline from '@/components/candidates/WorkHistoryTimeline';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  ArrowDownToLine,
  Briefcase,
  CalendarClock,
  Car,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileText,
  HeartHandshake,
  Info,
  MapPin,
  PhoneCall,
  Save,
  ShieldQuestion,
  Sparkles,
  Target,
  TrendingUp,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { useModuleEnabled } from '@/hooks/useModuleEnabled';

const SCREENING_STEP_ICONS = {
  voorbereiding: ShieldQuestion,
  contact_identiteit: PhoneCall,
  mobiliteit: Car,
  werkprofiel: Briefcase,
  voorwaarden: CalendarClock,
  persoonlijk: HeartHandshake,
  besluit: ClipboardCheck,
};

const getScreeningStepIcon = (stepId: string) =>
  SCREENING_STEP_ICONS[stepId as keyof typeof SCREENING_STEP_ICONS] ?? ShieldQuestion;

const CandidateScreeningTab = ({
  candidate,
  vacancyId,
  onUpdate,
  onDirtyChange,
}: {
  candidate: any;
  vacancyId?: string | null;
  onUpdate: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: sensitive, isLoading: sensitiveLoading } = useDecryptedCandidate(candidate.id);
  const [data, setData] = useState<ScreeningData>(() => getInitialData(candidate));
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(() => getProfileDraft(candidate));
  const [saving, setSaving] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>((candidate.screening_data as any)?.updated_at ?? candidate.screened_at ?? null);
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState(() => buildSnapshot(getInitialData(candidate), getProfileDraft(candidate)));
  const saveSeq = useRef(0);
  const aiEnabled = useModuleEnabled('ai-analyse');

  // Vakinhoudelijke belvragen (hybride): geopend vanuit een match → ?vacancy=<id>.
  // Deterministische laag = gratis, uit match_breakdown.missing; AI-laag = Gemini (kost credits).
  const [aiCallQuestions, setAiCallQuestions] = useState<string[]>([]);
  const [aiCallLoading, setAiCallLoading] = useState(false);
  const [aiCallMeta, setAiCallMeta] = useState<{ cost: number; balance: number } | null>(null);

  const { data: screeningVacancy } = useQuery({
    queryKey: ['screening-vacancy', vacancyId],
    enabled: !!vacancyId,
    queryFn: async () => {
      return await unwrap(supabase.from('vacancies').select('id, title').eq('id', vacancyId!).single());
    },
  });

  const { data: screeningMatch } = useQuery({
    queryKey: ['screening-match', candidate.id, vacancyId],
    enabled: !!vacancyId,
    queryFn: async () => {
      const { data } = await supabase
        .from('matches')
        .select('match_breakdown')
        .eq('candidate_id', candidate.id)
        .eq('vacancy_id', vacancyId!)
        .maybeSingle();
      return data ?? null;
    },
  });

  const deterministicCallQuestions = useMemo(
    () => deriveCandidateScreeningCallQuestions((screeningMatch?.match_breakdown as any) ?? null),
    [screeningMatch],
  );

  const generateAiCallQuestions = async () => {
    if (!vacancyId) return;
    setAiCallLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-call-questions', {
        body: { candidate_id: candidate.id, vacancy_id: vacancyId },
      });
      if (error) throw error;
      const result = normalizeGeneratedCallQuestionsResponse(data);
      setAiCallQuestions(result.questions);
      if (typeof result.costCents === 'number') setAiCallMeta({ cost: result.costCents, balance: result.balanceCents ?? 0 });
      toast.success(`AI-vragen gegenereerd${typeof result.costCents === 'number' ? ` (${(result.costCents / 100).toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' })})` : ''}`);
    } catch (e) {
      toast.error(await extractFunctionErrorMessage(e, 'AI-vragen genereren mislukt'));
    } finally {
      setAiCallLoading(false);
    }
  };

  const currentStepIndex = Math.max(0, SCREENING_STEPS.findIndex((step) => step.id === data.current_step));
  const currentStep = SCREENING_STEPS[currentStepIndex] ?? SCREENING_STEPS[0];
  const questions = QUESTION_BANK[currentStep.id] ?? [];
  const CurrentStepIcon = getScreeningStepIcon(currentStep.id);
  const missingProfileFields = useMemo(() => getMissingProfileFields(candidate), [candidate]);
  const analysis = candidate.ai_analysis as any;
  const aiProfileDiffs = useMemo(() => getAiProfileDiffs(candidate, profileDraft), [candidate, profileDraft]);
  const aiFacts = Array.isArray(analysis?.datakwaliteit?.feiten) ? analysis.datakwaliteit.feiten : [];
  const aiUnknowns = Array.isArray(analysis?.datakwaliteit?.onbekend) ? analysis.datakwaliteit.onbekend : [];
  const aiAssumptions = Array.isArray(analysis?.datakwaliteit?.aannames) ? analysis.datakwaliteit.aannames : [];
  const aiFunctions = aiWorkFunctions(analysis);
  const aiHardSkills = aiHardSkillLabels(analysis);
  const aiLanguages = aiLanguageLabels(analysis);
  const aiCerts = aiCertLabels(analysis);
  const workEmployers = Array.isArray(analysis?.werkhistorie?.werkgevers) ? analysis.werkhistorie.werkgevers : [];
  const workGaps = Array.isArray(analysis?.werkhistorie?.gaten) ? analysis.werkhistorie.gaten : [];
  const workTotalYears = typeof analysis?.werkhistorie?.totale_werkervaring_jaren === 'number'
    ? analysis.werkhistorie.totale_werkervaring_jaren
    : undefined;
  const dirty = buildSnapshot(data, profileDraft) !== lastSavedSnapshot;
  const statusMeta = STATUS_META[data.status] ?? STATUS_META.niet_gestart;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const screeningSavePorts = useMemo(() => ({
    updateCandidate: async (candidateId: string, updates: Record<string, unknown>) => {
      await unwrap(supabase
        .from('candidates')
        .update(updates as any)
        .eq('id', candidateId));
    },
    insertCompletionNote: async (note: CandidateScreeningCompletionNote) => {
      await unwrap(supabase.from('notes').insert(note as any));
      await qc.invalidateQueries({ queryKey: ['notes', 'kandidaat', note.related_entity_id] });
    },
  }), [qc]);

  const followupTaskPorts = useMemo(() => ({
    insertFollowupTask: async (task: CandidateScreeningFollowupTask) => {
      await unwrap(supabase.from('recruiter_tasks' as any).insert(task as any));
    },
  }), []);

  const sensitivePorts = useMemo(() => ({
    updateSensitiveField: async (candidateId: string, field: SensitiveCandidateField, value: string | null) => {
      await unwrap(supabase.from('candidates').update({ [field]: value } as any).eq('id', candidateId));
    },
  }), []);

  const reanalysisPorts = useMemo(() => ({
    getCandidateAiStatus: async (candidateId: string) => {
      const current = await unwrap(supabase
        .from('candidates')
        .select('ai_status')
        .eq('id', candidateId)
        .single());
      return current?.ai_status;
    },
    startCandidateAnalysis: async (candidateId: string) => {
      const { error } = await supabase.functions.invoke('analyze-cv', { body: { candidate_id: candidateId } });
      if (error) throw new Error(await extractFunctionErrorMessage(error, 'Heranalyse kon niet starten'));
    },
    sleep: (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms)),
  }), []);

  const persistDraft = useCallback(async ({
    nextData,
    nextProfile,
    complete = false,
    manual = false,
  }: {
    nextData?: ScreeningData;
    nextProfile?: ProfileDraft;
    complete?: boolean;
    manual?: boolean;
  } = {}): Promise<boolean> => {
    const dataToSave = nextData ?? data;
    const profileToSave = nextProfile ?? profileDraft;
    const seq = ++saveSeq.current;

    if (manual) setManualSaving(true);
    setSaving(true);
    try {
      const result = await saveCandidateScreening({
        ports: screeningSavePorts,
        candidate,
        data: dataToSave,
        profileDraft: profileToSave,
        complete,
        userId: user?.id ?? null,
      });

      if (seq === saveSeq.current) {
        setData(result.screeningData);
        setLastSavedAt(result.savedAt);
        setLastSavedSnapshot(buildSnapshot(result.screeningData, profileToSave));
      }

      if (result.completionNoteError) {
        console.warn('Screeningnotitie aanmaken mislukt (non-kritisch):', result.completionNoteError);
      }

      if (manual) toast.success(complete ? 'Screening afgerond' : 'Concept opgeslagen');
      onUpdate();
      return true;
    } catch (e: any) {
      if (manual) toast.error(e.message || 'Fout bij opslaan');
      return false;
    } finally {
      setSaving(false);
      if (manual) setManualSaving(false);
    }
  }, [candidate, data, onUpdate, profileDraft, screeningSavePorts, user?.id]);

  useEffect(() => {
    if (!dirty || data.status === 'niet_gestart') return;
    const timeout = window.setTimeout(() => {
      persistDraft().catch(() => {});
    }, 1200);
    return () => window.clearTimeout(timeout);
  }, [data, dirty, persistDraft, profileDraft]);

  const setAnswer = (key: string, patch: Partial<ScreeningAnswer>) => {
    setData((current) => patchCandidateScreeningAnswer(current, key, patch));
  };

  const saveSensitive = useCallback(async (field: SensitiveCandidateField, value: string | null) => {
    const result = await saveCandidateScreeningSensitiveField({
      ports: sensitivePorts,
      candidateId: candidate.id,
      field,
      value,
    });
    qc.invalidateQueries({ queryKey: ['candidate-decrypted', candidate.id] });
    qc.invalidateQueries({ queryKey: ['candidate', candidate.id] });
    logAudit({ action: 'update', tableName: 'candidates', recordId: candidate.id, newValues: result.auditValues });
    onUpdate();
  }, [candidate.id, qc, onUpdate, sensitivePorts]);

  const setProfessional = (patch: Partial<ScreeningData['professional']>) =>
    setData((current) => patchCandidateScreeningProfessional(current, patch));

  const setPersonal = (patch: Partial<ScreeningData['personal']>) =>
    setData((current) => patchCandidateScreeningPersonal(current, patch));

  const startCall = () => {
    setData((current) => startCandidateScreeningCall(current));
  };

  const goToStep = (stepId: string) => {
    setData((current) => goToCandidateScreeningStep(current, stepId));
  };

  const openItems = useMemo(
    () => getCandidateScreeningOpenItems(data, missingProfileFields),
    [data, missingProfileFields],
  );

  const handleCreateFollowupTask = async () => {
    setCreatingTask(true);
    try {
      await createCandidateScreeningFollowupTask({
        ports: followupTaskPorts,
        candidate,
        userId: user?.id ?? null,
        openItems,
      });
      toast.success('Opvolgtaak aangemaakt');
    } catch (e: any) {
      toast.error(e.message || 'Kon opvolgtaak niet maken');
    } finally {
      setCreatingTask(false);
    }
  };

  const validateBeforeComplete = (): boolean => {
    const validation = validateCandidateScreeningCompletion(data, profileDraft);
    if (validation.ok) return true;
    toast.error(validation.message);
    if (validation.focusStep) {
      setData((current) => ({ ...current, current_step: validation.focusStep }));
    }
    return false;
  };

  const handleComplete = async () => {
    if (!validateBeforeComplete()) return;
    await persistDraft({ complete: true, manual: true });
  };

  const takeAiSuggestion = (suggestion: ProfileSuggestion) => {
    setProfileDraft((current) => applyCandidateScreeningAiSuggestion(current, suggestion));
    toast.success('AI-suggestie overgenomen in het concept');
  };

  const handleCompleteAndReanalyze = async () => {
    if (!validateBeforeComplete()) return;
    setReanalyzing(true);
    try {
      const saved = await persistDraft({ complete: true, manual: true });
      if (!saved) return;
      await startCandidateScreeningReanalysis({ ports: reanalysisPorts, candidateId: candidate.id });
      await qc.invalidateQueries({ queryKey: ['candidate', candidate.id] });
      await qc.invalidateQueries({ queryKey: ['candidates'] });
      onUpdate();
      toast.success('Screening opgeslagen — AI heranalyseert met de screening (1-3 min)');
    } catch (e: any) {
      toast.error(e?.message || 'Heranalyse kon niet starten');
    } finally {
      setReanalyzing(false);
    }
  };

  const renderProfileFields = () => {
    if (currentStep.id === 'contact_identiteit') {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Telefoon EU/buitenland</Label><Input value={profileDraft.phone} onChange={(e) => setProfileDraft((p) => ({ ...p, phone: e.target.value }))} /></div>
          <div><Label>Telefoon NL</Label><Input value={profileDraft.phone_nl} onChange={(e) => setProfileDraft((p) => ({ ...p, phone_nl: e.target.value }))} /></div>
          <div><Label>E-mail</Label><Input value={profileDraft.email} onChange={(e) => setProfileDraft((p) => ({ ...p, email: e.target.value }))} /></div>
          <div><Label>Geboortedatum</Label><Input type="date" value={profileDraft.date_of_birth} onChange={(e) => setProfileDraft((p) => ({ ...p, date_of_birth: e.target.value }))} /></div>
          <div><Label>Nationaliteit</Label><NationalitySelect value={profileDraft.nationality} onChange={(nationality) => setProfileDraft((p) => ({ ...p, nationality }))} /></div>
          <div><Label>Woonplaats</Label><Input value={profileDraft.address_city} onChange={(e) => setProfileDraft((p) => ({ ...p, address_city: e.target.value }))} /></div>
          <div><Label>Straat</Label><Input value={profileDraft.address_street} onChange={(e) => setProfileDraft((p) => ({ ...p, address_street: e.target.value }))} /></div>
          <div><Label>Postcode</Label><Input value={profileDraft.address_postal} onChange={(e) => setProfileDraft((p) => ({ ...p, address_postal: e.target.value }))} /></div>
          <InlineSensitiveField
            id="screening_bsn"
            label="BSN"
            value={sensitive?.decrypted_bsn}
            loading={sensitiveLoading}
            placeholder="123456789"
            inputMode="numeric"
            onSave={(value) => saveSensitive('bsn', value)}
            onDirtyChange={() => {}}
          />
          <InlineSensitiveField
            id="screening_iban"
            label="IBAN"
            value={sensitive?.decrypted_iban}
            loading={sensitiveLoading}
            placeholder="NL00 BANK 0000 0000 00"
            onSave={(value) => saveSensitive('iban', value)}
            onDirtyChange={() => {}}
          />
        </div>
      );
    }

    if (currentStep.id === 'mobiliteit') {
      return (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={profileDraft.has_drivers_license} onCheckedChange={(checked) => setProfileDraft((p) => ({ ...p, has_drivers_license: checked === true }))} />
            Rijbewijs geregistreerd
          </label>
          {profileDraft.has_drivers_license && (
            <div className="max-w-xs space-y-1.5">
              <Label>Verloopdatum rijbewijs</Label>
              <Input type="date" value={profileDraft.drivers_license_expiry} onChange={(e) => setProfileDraft((p) => ({ ...p, drivers_license_expiry: e.target.value }))} />
            </div>
          )}
        </div>
      );
    }

    if (currentStep.id === 'werkprofiel') {
      return (
        <div className="grid gap-3">
          <div><Label>Vaardigheden</Label><SkillMultiSelect value={profileDraft.skills} onChange={(skills) => setProfileDraft((p) => ({ ...p, skills }))} /></div>
          <div><Label>Certificaten</Label><TagInput value={profileDraft.certifications} onChange={(certifications) => setProfileDraft((p) => ({ ...p, certifications }))} placeholder="Typ certificaat + Enter" /></div>
          <div><Label>Talen</Label><LanguageMultiSelect value={profileDraft.languages} onChange={(languages) => setProfileDraft((p) => ({ ...p, languages }))} /></div>
        </div>
      );
    }

    if (currentStep.id === 'voorwaarden') {
      return (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label>Beschikbaar vanaf</Label>
              <Input
                type="date"
                value={data.availability.available_from}
                onChange={(e) => setData((current) => ({
                  ...current,
                  availability: { ...current.availability, available_from: e.target.value },
                }))}
              />
            </div>
            <div>
              <Label>Beschikbaar tot</Label>
              <Input
                type="date"
                value={data.availability.available_until}
                onChange={(e) => setData((current) => ({
                  ...current,
                  availability: { ...current.availability, available_until: e.target.value },
                }))}
              />
            </div>
            <div>
              <Label>Aankomst/check-in</Label>
              <Input
                type="date"
                value={data.availability.arrival_date}
                onChange={(e) => setData((current) => ({
                  ...current,
                  availability: { ...current.availability, arrival_date: e.target.value },
                }))}
              />
            </div>
          </div>
          <div>
            <Label>Beschikbaarheidsnotities</Label>
            <Textarea
              value={profileDraft.availability_notes}
              onChange={(e) => setProfileDraft((p) => ({ ...p, availability_notes: e.target.value }))}
              placeholder="Opzegtermijn, onzekerheden, ploegendiensten, gewenste uren..."
              rows={3}
            />
          </div>
        </div>
      );
    }

    return null;
  };

  const chipList = (values: string[], empty = 'Nog niet bekend') => (
    <div className="flex flex-wrap gap-1.5">
      {values.length > 0
        ? values.map((value) => <Badge key={value} variant="outline" className="max-w-full truncate text-[11px]">{value}</Badge>)
        : <span className="text-xs text-muted-foreground">{empty}</span>}
    </div>
  );

  const renderKeywordSidebar = () => {
    const address = [profileDraft.address_street, profileDraft.address_postal, profileDraft.address_city].filter(Boolean).join(', ');
    const phone = profileDraft.phone_nl || profileDraft.phone || 'Geen telefoon';
    const availability = [
      data.availability.available_from ? `Vanaf ${data.availability.available_from}` : null,
      data.availability.available_until ? `tot ${data.availability.available_until}` : null,
      data.availability.arrival_date ? `aankomst ${data.availability.arrival_date}` : null,
    ].filter(Boolean).join(' · ');
    const missing = importantMissingFields(profileDraft, data.availability);

    return (
      <Card className="h-fit p-4 xl:sticky xl:top-4" data-testid="screening-key-profile">
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Info className="h-4 w-4 text-muted-foreground" />
            Kernprofiel
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <UserRound className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-0">
                <h3 className="truncate font-semibold">{candidate.first_name} {candidate.last_name}</h3>
                <p className="truncate text-xs text-muted-foreground">{profileDraft.nationality || 'Nationaliteit onbekend'}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge className={statusMeta.className}>{statusMeta.label}</Badge>
              {analysis?.samenvatting?.plaatsbaarheid_score != null && (
                <Badge variant="outline">Plaatsbaarheid {analysis.samenvatting.plaatsbaarheid_score}/10</Badge>
              )}
              {candidate.ai_classification && <Badge variant="secondary">{candidate.ai_classification}</Badge>}
            </div>
            {data.status === 'concept_opgeslagen' && (
              <p className="rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                Concept: belnotities zijn opgeslagen, maar de screening is nog niet afgerond.
              </p>
            )}
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex items-start gap-2 text-muted-foreground">
              <PhoneCall className="mt-0.5 h-3.5 w-3.5" />
              <span className="break-all">{phone}</span>
            </div>
            <div className="flex items-start gap-2 text-muted-foreground">
              <MapPin className="mt-0.5 h-3.5 w-3.5" />
              <span>{address || 'Adres/verblijfplaats onbekend'}</span>
            </div>
            <div className="flex items-start gap-2 text-muted-foreground">
              <CalendarClock className="mt-0.5 h-3.5 w-3.5" />
              <span>{availability || 'Beschikbaarheid nog controleren'}</span>
            </div>
          </div>

          <div className="border-t pt-3 space-y-3">
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase text-muted-foreground">Functies / ervaring</p>
              {chipList(aiFunctions, 'Nog geen AI-functies')}
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase text-muted-foreground">Competenties</p>
              {chipList(profileDraft.skills.length ? profileDraft.skills.slice(0, 10) : aiHardSkills.slice(0, 10))}
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase text-muted-foreground">Talen</p>
              {chipList(profileDraft.languages.length ? profileDraft.languages.slice(0, 8) : aiLanguages)}
            </div>
            {aiCerts.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase text-muted-foreground">Certificaten</p>
                {chipList(aiCerts)}
              </div>
            )}
          </div>

          <div className="border-t pt-3">
            <p className="mb-1.5 text-xs font-medium uppercase text-muted-foreground">Nog navragen</p>
            <div className="space-y-1.5">
              {missing.slice(0, 5).map((item) => (
                <div key={item} className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{item}</div>
              ))}
              {aiUnknowns.slice(0, 3).map((item: any, index: number) => (
                <div key={`${item?.veld ?? 'onbekend'}-${index}`} className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">
                  {item?.veld ?? 'Onbekend'}{item?.vervolgvraag ? `: ${item.vervolgvraag}` : ''}
                </div>
              ))}
              {missing.length === 0 && aiUnknowns.length === 0 && (
                <p className="text-xs text-muted-foreground">Geen kritieke open punten.</p>
              )}
            </div>
          </div>
        </div>
      </Card>
    );
  };

  const renderAiReviewPanel = () => (
    <Card className="p-4 space-y-4 border-l-4 border-l-amber-500">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-600" />
          <div>
            <h3 className="font-semibold text-sm">AI-feiten controleren</h3>
            <p className="text-xs text-muted-foreground">AI past profieldata niet direct aan; overnemen blijft recruiterkeuze.</p>
          </div>
        </div>
        <Badge variant="outline">{aiProfileDiffs.length} verschil{aiProfileDiffs.length === 1 ? '' : 'len'}</Badge>
      </div>

      {aiProfileDiffs.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {aiProfileDiffs.map((field) => (
            <div key={`${field.key}-${field.label}`} className="rounded-md border bg-background p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label>{field.label}</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5"
                  onClick={() => takeAiSuggestion(field)}
                >
                  <ArrowDownToLine className="h-3.5 w-3.5" /> Overnemen
                </Button>
              </div>
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Profiel</p>
                  <p className="break-words">{field.kind === 'list' ? displayList(field.current) : field.current || 'Nog leeg'}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">AI / screening</p>
                  <p className="break-words">{field.kind === 'list' ? displayList(field.suggested) : field.suggested}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Geen concrete profielverschillen gevonden in de AI-analyse.</p>
      )}

      {(aiFacts.length > 0 || aiAssumptions.length > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md bg-stat-green/5 p-3">
            <p className="mb-2 text-xs font-medium text-stat-green">Harde feiten</p>
            <div className="space-y-1.5">
              {aiFacts.slice(0, 5).map((item: any, index: number) => (
                <p key={`${item?.veld ?? 'feit'}-${index}`} className="text-xs">
                  <span className="font-medium">{item?.veld}</span>{item?.waarde ? `: ${item.waarde}` : ''}
                </p>
              ))}
              {aiFacts.length === 0 && <p className="text-xs text-muted-foreground">Geen harde feiten gemarkeerd.</p>}
            </div>
          </div>
          <div className="rounded-md bg-orange-50 p-3">
            <p className="mb-2 text-xs font-medium text-orange-700">Aannames</p>
            <div className="space-y-1.5">
              {aiAssumptions.slice(0, 5).map((item: any, index: number) => (
                <p key={`${item?.veld ?? 'aanname'}-${index}`} className="text-xs">
                  <span className="font-medium">{item?.veld}</span>{item?.aanname ? `: ${item.aanname}` : ''}
                </p>
              ))}
              {aiAssumptions.length === 0 && <p className="text-xs text-muted-foreground">Geen aannames gemarkeerd.</p>}
            </div>
          </div>
        </div>
      )}
    </Card>
  );

  const renderWorkExperiencePanel = () => {
    if (workEmployers.length === 0 && workGaps.length === 0) return null;
    const longTenures = workEmployers.filter((job: any) => (workDurationMonths(job) ?? 0) >= 24).length;
    const shortTenures = workEmployers.filter((job: any) => {
      const months = workDurationMonths(job);
      return months != null && months < 6;
    }).length;

    return (
      <Card className="p-4 space-y-4 border-l-4 border-l-teal-500" data-testid="screening-work-history-panel">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-teal-600" />
            <div>
              <h3 className="font-semibold text-sm">Werkervaring in beeld</h3>
              <p className="text-xs text-muted-foreground">Duur per werkgever, gaten en stabiliteit uit CV/AI-analyse.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {typeof workTotalYears === 'number' && <Badge variant="secondary">{workTotalYears} jaar totaal</Badge>}
            {longTenures > 0 && <Badge className="bg-stat-green/10 text-stat-green border-0">{longTenures} langere periodes</Badge>}
            {shortTenures > 0 && <Badge className="bg-red-100 text-red-700 border-0">{shortTenures} kort</Badge>}
            {workGaps.length > 0 && <Badge className="bg-orange-100 text-orange-700 border-0">{workGaps.length} gat{workGaps.length === 1 ? '' : 'en'}</Badge>}
          </div>
        </div>

        {workEmployers.length > 0 && (
          <WorkHistoryTimeline
            werkgevers={workEmployers}
            gaten={workGaps}
            totaleJaren={workTotalYears}
            className="rounded-md bg-muted/25 p-3"
          />
        )}

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {workEmployers.slice(0, 6).map((job: any, index: number) => {
            const months = workDurationMonths(job);
            return (
              <div key={`${job?.bedrijf ?? 'werk'}-${index}`} className="relative overflow-hidden rounded-md border bg-background p-3 text-sm">
                <span className={cn('absolute inset-y-0 left-0 w-1', durationRailClass(months))} />
                <div className="pl-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="line-clamp-2 font-medium leading-5">{job?.functie || 'Functie onbekend'}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{job?.bedrijf || 'Werkgever onbekend'}</p>
                    </div>
                    <Badge className={cn('shrink-0 text-[11px]', durationToneClass(months))}>{formatWorkDuration(months)}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{job?.periode || 'Periode onbekend'}</p>
                </div>
              </div>
            );
          })}
        </div>

        {workGaps.length > 0 && (
          <div className="grid gap-2 md:grid-cols-2">
            {workGaps.slice(0, 4).map((gap: any, index: number) => (
              <div key={`${gap?.periode ?? 'gat'}-${index}`} className="rounded-md bg-orange-50 px-3 py-2 text-xs text-orange-700">
                <span className="font-medium">Gat: {gap?.periode || 'periode onbekend'}</span>
                {gap?.duur_maanden ? ` · ${gap.duur_maanden} mnd` : ''}
                {gap?.mogelijke_verklaring ? ` · ${gap.mogelijke_verklaring}` : ''}
              </div>
            ))}
          </div>
        )}
      </Card>
    );
  };

  const renderAiNarrativePanel = () => {
    if (!analysis) return null;

    return (
      <Card className="p-4 space-y-4 border-l-4 border-l-blue-500">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-blue-600" />
          <div>
            <h3 className="font-semibold text-sm">AI-beredenering</h3>
            <p className="text-xs text-muted-foreground">Langere analyse blijft beschikbaar, los van het belmenu.</p>
          </div>
        </div>

        {analysis?.samenvatting?.profiel && (
          <div className="rounded-md bg-muted/40 p-3">
            <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Profielschets</p>
            <p className="text-sm leading-relaxed">{analysis.samenvatting.profiel}</p>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          {analysis?.samenvatting?.topkwaliteit && (
            <div className="rounded-md bg-stat-green/5 p-3">
              <p className="mb-1 text-xs font-medium text-stat-green">Sterkste signaal</p>
              <p className="text-sm">{analysis.samenvatting.topkwaliteit}</p>
            </div>
          )}
          {analysis?.samenvatting?.aandachtspunt && (
            <div className="rounded-md bg-orange-50 p-3">
              <p className="mb-1 text-xs font-medium text-orange-700">Aandachtspunt</p>
              <p className="text-sm">{analysis.samenvatting.aandachtspunt}</p>
            </div>
          )}
        </div>

        {analysis?.plaatsingsadvies?.onderbouwing && (
          <div className="rounded-md border p-3">
            <div className="mb-1.5 flex items-center gap-2 text-sm font-medium"><Target className="h-3.5 w-3.5" /> Plaatsingsadvies</div>
            <p className="text-sm text-muted-foreground">{analysis.plaatsingsadvies.onderbouwing}</p>
          </div>
        )}

        {analysis?.eigenschappen?.toelichting && (
          <div className="rounded-md border p-3">
            <div className="mb-1.5 flex items-center gap-2 text-sm font-medium"><TrendingUp className="h-3.5 w-3.5" /> Stabiliteit en profieltype</div>
            <p className="text-sm text-muted-foreground">{analysis.eigenschappen.toelichting}</p>
          </div>
        )}

        {(workEmployers.length > 0 || workGaps.length > 0) && (
          <div className="rounded-md border p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium"><Briefcase className="h-3.5 w-3.5" /> Werkervaring</div>
              {typeof workTotalYears === 'number' && (
                <Badge variant="secondary" className="text-xs">{workTotalYears} jaar totaal</Badge>
              )}
            </div>

            {workEmployers.length > 0 && (
              <WorkHistoryTimeline
                werkgevers={workEmployers}
                gaten={workGaps}
                totaleJaren={workTotalYears}
                className="mb-3 rounded-md bg-muted/25 p-3"
              />
            )}

            <div className="grid gap-2 md:grid-cols-2">
              {workEmployers.slice(0, 6).map((job: any, index: number) => {
                const months = workDurationMonths(job);
                const activities = Array.isArray(job?.kernactiviteiten) ? job.kernactiviteiten.slice(0, 3) : [];
                return (
                  <div key={`${job?.bedrijf ?? 'werk'}-${index}`} className="relative overflow-hidden rounded-md border bg-background p-3 text-sm">
                    <span className={cn('absolute inset-y-0 left-0 w-1', durationRailClass(months))} />
                    <div className="flex items-start justify-between gap-2 pl-2">
                      <div className="min-w-0">
                        <p className="line-clamp-2 font-medium leading-5">{job?.functie || 'Functie onbekend'}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{[job?.bedrijf, job?.periode].filter(Boolean).join(' · ') || 'Werkgever/periode onbekend'}</p>
                      </div>
                      <Badge className={cn('shrink-0 text-[11px]', durationToneClass(months))}>
                        {formatWorkDuration(months)}
                      </Badge>
                    </div>
                    {activities.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1 pl-2">
                        {activities.map((activity: string) => (
                          <span key={`${job?.bedrijf ?? 'werk'}-${activity}`} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                            {activity}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {workEmployers.length > 6 && (
                <div className="rounded-md border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
                  +{workEmployers.length - 6} eerdere werkgever{workEmployers.length - 6 === 1 ? '' : 's'} in de AI-analyse.
                </div>
              )}
            </div>

            <div className="mt-2 space-y-1.5">
              {workGaps.slice(0, 3).map((gap: any, index: number) => (
                <div key={`${gap?.periode ?? 'gat'}-${index}`} className="rounded bg-orange-50 px-2 py-1 text-xs text-orange-700">
                  Gat: {gap?.periode}{gap?.duur_maanden ? ` (${gap.duur_maanden} mnd)` : ''}{gap?.mogelijke_verklaring ? ` · ${gap.mogelijke_verklaring}` : ''}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    );
  };

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={statusMeta.className}>{statusMeta.label}</Badge>
              <Badge variant="outline">{askedCount(data)}/{Object.values(QUESTION_BANK).flat().length} punten vastgelegd</Badge>
              {saving && <Badge variant="outline" className="gap-1"><Clock3 className="h-3 w-3 animate-pulse" /> Autosave</Badge>}
              {dirty && !saving && <Badge variant="outline" className="border-amber-200 text-amber-700">Onopgeslagen wijzigingen</Badge>}
            </div>
            <div>
              <h3 className="font-semibold">Screening-cockpit</h3>
              <p className="text-sm text-muted-foreground">
                Harde kerngegevens, AI-beredenering en belmenu gescheiden op één werkvlak.
              </p>
            </div>
            {lastSavedAt && (
              <p className="text-xs text-muted-foreground">
                Laatst opgeslagen: {new Date(lastSavedAt).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {data.status === 'niet_gestart' && (
              <Button onClick={startCall} className="gap-2" data-testid="screening-start-call">
                <PhoneCall className="h-4 w-4" /> Start gesprek
              </Button>
            )}
            <Button variant="outline" onClick={() => persistDraft({ manual: true })} disabled={manualSaving || data.status === 'niet_gestart'} className="gap-2" data-testid="screening-save-draft">
              <Save className="h-4 w-4" /> {manualSaving ? 'Opslaan...' : 'Concept opslaan'}
            </Button>
            <Button variant="outline" onClick={handleCreateFollowupTask} disabled={creatingTask} className="gap-2">
              <AlertTriangle className="h-4 w-4" /> {creatingTask ? 'Aanmaken...' : 'Maak taak'}
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        {renderKeywordSidebar()}

        <div className="min-w-0 space-y-4">
          {aiEnabled && renderAiReviewPanel()}
          {renderWorkExperiencePanel()}
          {renderAiNarrativePanel()}

          {vacancyId && (
            <Card className="p-4 space-y-3 border-l-4 border-l-green-500">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-green-600" />
                  <h3 className="font-semibold text-sm">
                    Matchvragen{screeningVacancy?.title ? ` — ${screeningVacancy.title}` : ''}
                  </h3>
                </div>
                {aiEnabled && (
                  <Button size="sm" variant="outline" onClick={generateAiCallQuestions} disabled={aiCallLoading}>
                    <Sparkles className="mr-1 h-3.5 w-3.5" /> {aiCallLoading ? 'AI bezig...' : 'AI-vragen genereren'}
                  </Button>
                )}
              </div>
              {deterministicCallQuestions.length > 0 ? (
                <div className="grid gap-2 md:grid-cols-2">
                  {deterministicCallQuestions.map((q, i) => (
                    <div key={`det-${i}`} className="rounded-md border bg-background px-3 py-2 text-sm">{q}</div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Geen openstaande gaten uit de match.</p>
              )}
              {aiCallQuestions.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase text-muted-foreground">AI-gegenereerd</Label>
                  <div className="grid gap-2 md:grid-cols-2">
                    {aiCallQuestions.map((q, i) => (
                      <div key={`ai-${i}`} className="rounded-md border bg-background px-3 py-2 text-sm">{q}</div>
                    ))}
                  </div>
                  {aiCallMeta && (
                    <p className="text-[11px] text-muted-foreground">
                      Kosten: {(aiCallMeta.cost / 100).toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' })} · resterend budget: {(aiCallMeta.balance / 100).toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' })}
                    </p>
                  )}
                </div>
              )}
            </Card>
          )}

          <Card className="overflow-hidden border-l-4 border-l-primary">
            <div className="border-b bg-muted/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <PhoneCall className="h-4 w-4 text-primary" />
                  <div>
                    <h3 className="font-semibold text-sm">Belmenu / callflow</h3>
                    <p className="text-xs text-muted-foreground">Vinkje = recruiter heeft dit besproken of bewust gecontroleerd.</p>
                  </div>
                </div>
                <Badge variant="outline">{currentStepIndex + 1}/{SCREENING_STEPS.length}</Badge>
              </div>
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {SCREENING_STEPS.map((step, index) => {
                  const Icon = getScreeningStepIcon(step.id);
                  const active = step.id === currentStep.id;
                  const stepQuestions = QUESTION_BANK[step.id] ?? [];
                  const done = stepQuestions.length > 0 && stepQuestions.every((q) => data.answers[q.key]?.asked || data.answers[q.key]?.notes?.trim());
                  return (
                    <button
                      key={step.id}
                      type="button"
                      onClick={() => goToStep(step.id)}
                      className={cn(
                        'flex h-10 shrink-0 items-center gap-2 rounded-md border bg-background px-3 text-sm transition-colors',
                        active && 'border-primary bg-primary text-primary-foreground',
                      )}
                    >
                      <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-[11px]', active ? 'bg-primary-foreground/20' : 'bg-muted')}>
                        {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
                      </span>
                      <Icon className="h-3.5 w-3.5" />
                      <span>{step.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-5 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <CurrentStepIcon className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-semibold">{currentStep.label}</h3>
                </div>
                {data.status === 'concept_opgeslagen' && (
                  <Badge className="bg-amber-100 text-amber-800 border-0 gap-1">
                    <Info className="h-3 w-3" /> Concept belnotities
                  </Badge>
                )}
              </div>

              {renderProfileFields()}

              {questions.length > 0 && (
                <div className="grid gap-3">
                  {questions.map((question) => {
                    const answer = data.answers[question.key] ?? { asked: false, notes: '' };
                    return (
                      <div key={question.key} className="rounded-md border bg-background p-3 space-y-2">
                        <label className="flex cursor-pointer items-start gap-2">
                          <Checkbox checked={answer.asked} onCheckedChange={(checked) => setAnswer(question.key, { asked: checked === true })} className="mt-0.5" />
                          <span className="font-medium text-sm">{question.label}</span>
                        </label>
                        <Textarea
                          value={answer.notes}
                          onChange={(e) => setAnswer(question.key, { notes: e.target.value })}
                          placeholder={question.placeholder ?? 'Antwoord of checkpunt...'}
                          className="min-h-[72px]"
                          data-testid={`screening-answer-${question.key}`}
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              {currentStep.id === 'werkprofiel' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Professionele beoordeling</Label>
                    <Select value={data.professional.rating} onValueChange={(value) => setProfessional({ rating: value })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{PROFESSIONAL_RATINGS.map((rating) => <SelectItem key={rating.value} value={rating.value}>{rating.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Notities vakinhoudelijk</Label>
                    <Textarea value={data.professional.notes} onChange={(e) => setProfessional({ notes: e.target.value })} rows={3} />
                  </div>
                </div>
              )}

              {currentStep.id === 'persoonlijk' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Risiconiveau</Label>
                    <Select value={data.personal.risk_level} onValueChange={(value) => setPersonal({ risk_level: value })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{RISK_LEVELS.map((risk) => <SelectItem key={risk.value} value={risk.value}>{risk.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Notities persoonlijk</Label>
                    <Textarea value={data.personal.notes} onChange={(e) => setPersonal({ notes: e.target.value })} rows={3} />
                  </div>
                </div>
              )}

              {currentStep.id === 'besluit' && (
                <div className="space-y-4 border-t pt-4">
                  <div className="space-y-1.5">
                    <Label>Eindresultaat</Label>
                    <Select value={data.result} onValueChange={(value) => setData((current) => ({ ...current, result: value }))}>
                      <SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger>
                      <SelectContent>{RESULT_OPTIONS.map((result) => <SelectItem key={result.value} value={result.value}>{result.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Samenvatting</Label>
                    <Textarea
                      value={data.summary}
                      onChange={(e) => setData((current) => ({ ...current, summary: e.target.value }))}
                      placeholder="Korte recruiter-samenvatting en besluit..."
                      className="min-h-[110px]"
                      data-testid="screening-summary"
                    />
                  </div>
                  {importantMissingFields(profileDraft, data.availability).length > 0 && (
                    <p className="text-xs text-amber-700">
                      Kritieke velden ontbreken nog: {importantMissingFields(profileDraft, data.availability).join(', ')}. Leg bij “Kritieke onbekenden” vast waarom dit akkoord is.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={handleComplete} disabled={manualSaving || reanalyzing} className="gap-2" data-testid="screening-complete">
                      <ClipboardCheck className="h-4 w-4" /> {manualSaving ? 'Afronden...' : 'Screening afronden'}
                    </Button>
                    <Button variant="secondary" onClick={handleCompleteAndReanalyze} disabled={manualSaving || reanalyzing} className="gap-2" data-testid="screening-complete-reanalyze">
                      <Sparkles className="h-4 w-4" /> {reanalyzing ? 'Bezig...' : 'Afronden + opnieuw analyseren'}
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 border-t pt-4">
                <Button
                  variant="outline"
                  onClick={() => goToStep(SCREENING_STEPS[Math.max(0, currentStepIndex - 1)].id)}
                  disabled={currentStepIndex === 0}
                  className="gap-2"
                >
                  <ChevronLeft className="h-4 w-4" /> Vorige
                </Button>
                <Button
                  variant="outline"
                  onClick={() => goToStep(SCREENING_STEPS[Math.min(SCREENING_STEPS.length - 1, currentStepIndex + 1)].id)}
                  disabled={currentStepIndex === SCREENING_STEPS.length - 1}
                  className="gap-2"
                >
                  Volgende <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default CandidateScreeningTab;
