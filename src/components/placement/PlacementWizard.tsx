import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { unwrap, unwrapList } from '@/lib/db';
import { qk } from '@/lib/query-keys';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  AlertTriangle, Car, Check, CheckCircle2, ChevronLeft, ChevronRight,
  Home, Loader2, Mail, MapPin, Navigation, User, Users,
} from 'lucide-react';
import { checkCompliance, type ComplianceResult } from '@/hooks/useComplianceCheck';
import ComplianceWarningDialog from '@/components/ComplianceWarningDialog';
import ComplianceFixList from './ComplianceFixList';
import { logAudit } from '@/lib/audit';
import { vehicleFreeOn } from '@/lib/vehicle-availability';
import { useActivePayrollers } from '@/hooks/usePayrollers';
import {
  activatePortalOnPlacement, assignVehicleOnPlacement, generateTimesheetTemplates,
  getHousingSuggestions, notifyPlacementStakeholders,
  sendPlacementConfirmation, type HousingSuggestion, type PlacementConfirmationResult,
  type PlacementMailEdits,
} from './PlacementTriggers';
import { sendRegulationsForAssignment } from '@/lib/regulation-dispatch';
import PlacementMailEditor from './PlacementMailEditor';
import type { Database } from '@/integrations/supabase/types';

type HousingAssignmentStatus = Database['public']['Enums']['housing_assignment_status'];

// Gespiegeld aan de kandidaatkeuze bij voertuig- en huisvestingstoewijzing: iemand die
// uit dienst of afgeschreven is hoort niet in de keuzelijst voor een nieuwe plaatsing.
const EXCLUDED_CANDIDATE_STATUSES = ['inactief', 'afgewezen', 'uitgeschreven', 'niet_beschikbaar'];

const isPlaceableCandidate = (candidate: any) => {
  if (candidate?.employee_status === 'uit_dienst') return false;
  return !EXCLUDED_CANDIDATE_STATUSES.includes(candidate?.status);
};

const EMPLOYEE_STATUS_LABELS: Record<string, string> = {
  actief: 'Actief', onboarding: 'Onboarding', ziek: 'Ziek',
};

const DAYS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
const STEPS = ['Basis', 'Vervoer', 'Huisvesting', 'Controle'] as const;
const NONE = '__none__';

interface PlacementWizardProps {
  open: boolean;
  onClose: () => void;
  /** Match-modus: kandidaat/opdrachtgever/vacature staan vast, match wordt op 'geplaatst' gezet. */
  match?: any | null;
  vacancy?: any | null;
  /** Standalone-modus: voorgeselecteerde opdrachtgever (bijv. vanaf de opdrachtgever-pagina). */
  defaultCompanyId?: string;
  lockedCompanyName?: string;
}

interface SuccessSummary {
  placementId: string;
  timesheets: number;
  housing: string | null;
  vehicle: string | null;
  portal: string | null;
  mails: PlacementConfirmationResult | null;
  mailError: string | null;
}

const PlacementWizard = ({ open, onClose, match, vacancy, defaultCompanyId, lockedCompanyName }: PlacementWizardProps) => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const matchMode = Boolean(match && vacancy);

  const [step, setStep] = useState(0);
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [empSearch, setEmpSearch] = useState('');
  const [form, setForm] = useState({
    company_id: defaultCompanyId ?? '',
    function_name: '',
    start_date: '',
    end_date: '',
    expected_end_date: '',
    hourly_rate: '',
    client_hourly_rate: '',
    overtime_rate: '',
    payroller: '',
    cao_hours: '',
    work_location: '',
    work_days: [] as string[],
  });
  const [payrollerInitialized, setPayrollerInitialized] = useState(false);

  // Vervoer
  const [vehicleId, setVehicleId] = useState('');
  const [vehicleFrom, setVehicleFrom] = useState('');
  const [startMileage, setStartMileage] = useState('');

  // Huisvesting
  const [noHousingNeeded, setNoHousingNeeded] = useState(false);
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [checkInDate, setCheckInDate] = useState('');

  // Mail
  const [sendToClient, setSendToClient] = useState(true);
  const [sendToEmployee, setSendToEmployee] = useState(true);
  const [mailEdits, setMailEdits] = useState<PlacementMailEdits>({});

  // Compliance + afronding
  const [complianceIssues, setComplianceIssues] = useState<string[]>([]);
  const [showComplianceWarning, setShowComplianceWarning] = useState(false);
  const [success, setSuccess] = useState<SuccessSummary | null>(null);

  const candidateId: string | null = matchMode ? match.candidate_id : selectedEmployee?.id ?? null;
  const candidate = matchMode ? (match?.candidates as any) : (selectedEmployee as any);
  const candidateName = `${candidate?.first_name ?? ''} ${candidate?.last_name ?? ''}`.trim();
  const companyId: string = matchMode ? vacancy.company_id : form.company_id;

  // Reset + prefill bij openen
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setSuccess(null);
    setMailEdits({});
    setSelectedEmployee(null);
    setEmpSearch('');
    setVehicleId('');
    setVehicleFrom('');
    setStartMileage('');
    setNoHousingNeeded(false);
    setSelectedUnitId('');
    setCheckInDate('');
    setSendToClient(true);
    setSendToEmployee(true);
    setPayrollerInitialized(false);
    setForm({
      company_id: matchMode ? vacancy.company_id : defaultCompanyId ?? '',
      function_name: matchMode ? vacancy.title ?? '' : '',
      start_date: matchMode ? vacancy.start_date ?? '' : '',
      end_date: matchMode ? vacancy.end_date ?? '' : '',
      expected_end_date: '',
      hourly_rate: matchMode ? vacancy.hourly_rate?.toString() ?? '' : '',
      client_hourly_rate: '',
      overtime_rate: '',
      payroller: '',
      cao_hours: '',
      work_location: matchMode ? vacancy.work_location ?? '' : '',
      work_days: [],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const toggleDay = (day: string) => setForm((f) => ({
    ...f,
    work_days: f.work_days.includes(day) ? f.work_days.filter((d) => d !== day) : [...f.work_days, day],
  }));

  // ── Data ──
  const { data: payrollers } = useActivePayrollers();

  // Default payroller éénmalig voorvullen zodra de instellingen binnen zijn.
  useEffect(() => {
    if (!open || payrollerInitialized || payrollers.length === 0) return;
    const fallback = payrollers.find((p) => p.is_default);
    if (fallback) setForm((f) => (f.payroller ? f : { ...f, payroller: fallback.id }));
    setPayrollerInitialized(true);
  }, [open, payrollers, payrollerInitialized]);

  // Rechtstreeks op `candidates` met zoeken op de server. Dit las eerst de legacy
  // `employees`-tabel: die bevat alleen koppelrijen (19 stuks bij JA Werkt tegenover
  // 2.123 kandidaten), waardoor de lijst vrijwel leeg was en zoeken niets opleverde.
  // Zelfde fix als bij de voertuigtoewijzing (VehicleAssignmentsTab).
  const { data: candidateResults = [], isFetching: candidatesLoading } = useQuery({
    queryKey: qk.candidates.list(orgId, { scope: 'placement-wizard', search: empSearch }),
    queryFn: () => {
      let query = supabase
        .from('candidates')
        .select('id, first_name, last_name, phone, email, employee_number, employee_status, status')
        .eq('organization_id', orgId)
        .is('anonymized_at', null)
        .order('last_name')
        .order('first_name')
        .limit(50);

      const search = empSearch.trim();
      if (search) {
        const term = search.replace(/[%,]/g, ' ');
        query = query.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,employee_number.ilike.%${term}%`);
      }
      return unwrapList<any>(query);
    },
    enabled: open && !matchMode && !!orgId,
  });

  const selectableCandidates = useMemo(
    () => (candidateResults as any[]).filter(isPlaceableCandidate),
    [candidateResults],
  );

  const { data: companies = [] } = useQuery({
    queryKey: ['companies-list'],
    queryFn: () => unwrapList(supabase.from('companies').select('id, name').eq('is_active', true).order('name')),
    enabled: open && !matchMode,
  });

  const companyName = matchMode
    ? (vacancy.companies as any)?.name ?? ''
    : lockedCompanyName ?? (companies as any[]).find((c) => c.id === form.company_id)?.name ?? '';


  // Compliance zodra de kandidaat bekend is — als strip op stap 1 én eindcheck bij plaatsen.
  const { data: compliance, isFetching: complianceLoading } = useQuery<ComplianceResult>({
    queryKey: ['placement-compliance', candidateId],
    queryFn: () => checkCompliance(candidateId!),
    enabled: open && !!candidateId,
    staleTime: 30_000,
  });

  // Rijbewijs-info voor de vervoer-stap
  const { data: licenseInfo } = useQuery({
    queryKey: ['candidate-license', candidateId],
    queryFn: async () => (await unwrap(
      supabase
        .from('candidates')
        .select('has_drivers_license, drivers_license_expiry, drivers_license_categories')
        .eq('id', candidateId!)
        .single(),
    )) as any,
    enabled: open && !!candidateId,
  });
  const licenseExpired = licenseInfo?.drivers_license_expiry
    ? new Date(licenseInfo.drivers_license_expiry) < new Date()
    : false;

  const effectiveVehicleDate = vehicleFrom || form.start_date;
  const { data: availableVehicles = [] } = useQuery({
    queryKey: ['available-vehicles', orgId, effectiveVehicleDate],
    queryFn: async () => {
      const vehicles = await unwrapList(
        supabase
          .from('vehicles')
          .select('id, license_plate, brand, model, current_mileage, status, vehicle_assignments(assigned_date, returned_date)')
          .eq('organization_id', orgId)
          .eq('status', 'beschikbaar' as any),
      );
      return vehicles.filter((v: any) => !effectiveVehicleDate || vehicleFreeOn(v, effectiveVehicleDate));
    },
    enabled: !!orgId && open,
  });

  const { data: housingSuggestions = [], isFetching: housingLoading } = useQuery<HousingSuggestion[]>({
    queryKey: ['housing-suggestions', orgId, companyId],
    queryFn: async () => {
      const { data: company } = await supabase
        .from('companies')
        .select('address_lat, address_lng')
        .eq('id', companyId)
        .single();
      return getHousingSuggestions(orgId, companyId, company?.address_lat, company?.address_lng);
    },
    enabled: open && !!companyId && step >= 2,
    staleTime: 60_000,
  });
  const selectedSuggestion = housingSuggestions.find((s) => s.unitId === selectedUnitId);

  // Gegevens voor de mail-preview, vóórdat de plaatsing bestaat.
  const placementData = useMemo(() => ({
    candidate_id: candidateId,
    company_id: companyId,
    vacancy_id: matchMode ? vacancy.id : null,
    function_name: form.function_name,
    start_date: form.start_date,
    end_date: form.end_date || null,
    expected_end_date: form.expected_end_date || null,
    hourly_rate: form.hourly_rate ? parseFloat(form.hourly_rate) : null,
    client_hourly_rate: form.client_hourly_rate ? parseFloat(form.client_hourly_rate) : null,
    overtime_rate: form.overtime_rate ? parseFloat(form.overtime_rate) : null,
    cao_hours: form.cao_hours ? parseFloat(form.cao_hours) : null,
    work_location: form.work_location || null,
    work_days: form.work_days.length > 0 ? form.work_days : null,
  }), [candidateId, companyId, matchMode, vacancy, form]);

  // ── Plaatsen ──
  const executePlacement = async (isOverride: boolean) => {
    const result = await checkCompliance(candidateId!);
    if (!result.passed && !isOverride) {
      setComplianceIssues(result.issues);
      setShowComplianceWarning(true);
      return;
    }

    const { data: placementResult, error: placementError } = await (supabase as any)
      .rpc('create_placement_transaction', {
        p_org_id: orgId,
        p_candidate_id: candidateId,
        p_company_id: companyId,
        p_vacancy_id: matchMode ? vacancy.id : null,
        p_match_id: matchMode ? match.id : null,
        p_function_name: form.function_name,
        p_start_date: form.start_date,
        p_end_date: form.end_date || null,
        p_hourly_rate: form.hourly_rate ? parseFloat(form.hourly_rate) : null,
        p_client_hourly_rate: form.client_hourly_rate ? parseFloat(form.client_hourly_rate) : null,
        p_overtime_rate: form.overtime_rate ? parseFloat(form.overtime_rate) : null,
        p_created_by: user?.id ?? null,
        p_compliance_check_passed: result.passed,
        p_compliance_override: isOverride,
        p_compliance_override_reason: isOverride ? result.issues.join(', ') : null,
      })
      .single();
    if (placementError) throw placementError;
    if (!placementResult?.placement_id || !placementResult?.employee_id) {
      throw new Error('Plaatsing kon niet atomair worden aangemaakt');
    }
    const placementId: string = placementResult.placement_id;
    const employeeId: string = placementResult.employee_id;

    // Velden die de RPC (bewust smal gehouden) niet kent
    const extra: Record<string, unknown> = {};
    if (form.payroller) extra.payroller_id = form.payroller;
    if (form.cao_hours) extra.cao_hours = parseFloat(form.cao_hours);
    if (form.work_location) extra.work_location = form.work_location;
    if (form.work_days.length > 0) extra.work_days = form.work_days;
    if (form.expected_end_date) extra.expected_end_date = form.expected_end_date;
    if (Object.keys(extra).length > 0) {
      try {
        await unwrap(supabase.from('placements').update(extra as any).eq('id', placementId));
      } catch (e: any) {
        console.warn('Extra plaatsingsvelden opslaan mislukt:', e.message);
      }
    }

    logAudit({
      action: isOverride ? 'override' : 'create',
      tableName: 'placements',
      recordId: placementId,
      newValues: { ...form, compliance_passed: result.passed, override: isOverride },
      reason: isOverride ? `Compliance override: ${result.issues.join(', ')}` : undefined,
    });

    const summary: SuccessSummary = {
      placementId, timesheets: 0, housing: null, vehicle: null, portal: null, mails: null, mailError: null,
    };

    // 1. Uren-templates
    try {
      summary.timesheets = await generateTimesheetTemplates({
        placementId, candidateId: candidateId!, employeeId, companyId,
        organizationId: orgId, startDate: form.start_date,
        functionName: form.function_name,
        hourlyRate: form.hourly_rate ? parseFloat(form.hourly_rate) : null,
      });
    } catch { /* non-blocking */ }

    // 2. Huisvesting
    if (!noHousingNeeded && selectedSuggestion) {
      try {
        const assignment = await unwrap(supabase.from('housing_assignments').insert({
          organization_id: orgId,
          unit_id: selectedSuggestion.unitId,
          employee_id: employeeId,
          candidate_id: candidateId,
          check_in_date: checkInDate || form.start_date,
          status: 'ingecheckt' satisfies HousingAssignmentStatus,
          deduction_amount: selectedSuggestion.weeklyCost ?? selectedSuggestion.monthlyCost,
          payment_frequency: selectedSuggestion.weeklyCost ? 'wekelijks' : 'maandelijks',
          monthly_deduction: selectedSuggestion.monthlyCost,
          created_by: user?.id ?? null,
        } as any).select('id').single());
        await supabase.from('placements').update({ housing_assignment_id: assignment.id }).eq('id', placementId);
        logAudit({
          action: 'create', tableName: 'housing_assignments', recordId: assignment.id,
          newValues: { unit_id: selectedSuggestion.unitId, unit_name: selectedSuggestion.unitName, candidate_id: candidateId },
        });
        summary.housing = `${selectedSuggestion.unitName} — ${selectedSuggestion.propertyName}`;
        await sendRegulationsForAssignment({ candidateId: candidateId!, category: 'huisvesting', contextId: assignment.id });
      } catch (e: any) {
        toast.warning(`Huisvesting toewijzen mislukt: ${e.message}`);
      }
    }

    // 3. Voertuig
    if (vehicleId) {
      try {
        await assignVehicleOnPlacement({
          organizationId: orgId, vehicleId, employeeId, candidateId: candidateId!,
          startDate: vehicleFrom || form.start_date,
          startMileage: startMileage ? parseInt(startMileage, 10) : null,
          createdBy: user?.id ?? null,
        });
        const v = (availableVehicles as any[]).find((x) => x.id === vehicleId);
        summary.vehicle = v ? `${v.license_plate}${v.brand ? ` — ${v.brand} ${v.model ?? ''}` : ''}` : 'Toegewezen';
        await sendRegulationsForAssignment({ candidateId: candidateId!, category: 'voertuig' });
      } catch (e: any) {
        toast.warning(`Voertuig niet toegewezen: ${e.message}`);
      }
    }

    // 4. Portal activeren
    try {
      const portal = await activatePortalOnPlacement({ organizationId: orgId, candidateId: candidateId!, employeeId });
      if (portal.activated) {
        summary.portal = portal.emailSent
          ? `Welkomstmail verstuurd naar ${portal.email}`
          : portal.note ?? 'Geactiveerd — welkomstmail niet verstuurd (geen Outlook-koppeling)';
      } else if (portal.note) {
        summary.portal = portal.note;
      }
    } catch { /* non-blocking */ }

    // 5. Interne opvolg-taken
    try {
      await notifyPlacementStakeholders({
        organizationId: orgId, placementId,
        candidateName, companyName,
        functionName: form.function_name, startDate: form.start_date,
        accountManagerId: matchMode ? vacancy.created_by ?? null : null,
      });
    } catch { /* non-blocking */ }

    // 6. Bevestigingsmails (incl. WhatsApp volgens automation-instellingen)
    const wantClient = sendToClient;
    const wantEmployee = sendToEmployee && Boolean(candidate?.email);
    if (wantClient || wantEmployee) {
      try {
        summary.mails = await sendPlacementConfirmation(placementId, wantClient, wantEmployee, mailEdits);
        summary.mails?.warnings?.forEach((w) => toast.warning(w));
      } catch (e: any) {
        summary.mailError = e.message;
      }
    }

    setSuccess(summary);
  };

  const invalidateAll = () => {
    ['vacancy-matches', 'vacancy-placements', 'vacancies', 'employees', 'candidates', 'timesheets',
      'placements', 'placements-list', 'planning-placements', 'company-placements', 'housing'].forEach((key) =>
      qc.invalidateQueries({ queryKey: [key] }));
    if (matchMode) qc.invalidateQueries({ queryKey: ['vacancy', vacancy.id] });
  };

  const mutation = useMutation({
    mutationFn: () => executePlacement(false),
    onSuccess: () => invalidateAll(),
    onError: (e: any) => { if (!showComplianceWarning) toast.error(e.message); },
  });
  const overrideMutation = useMutation({
    mutationFn: () => executePlacement(true),
    onSuccess: () => invalidateAll(),
    onError: (e: any) => toast.error(e.message),
  });
  const busy = mutation.isPending || overrideMutation.isPending;

  // Uurtarief zit hier bewust niet in: tarieven mogen buiten dit systeem worden bijgehouden
  // (meeting 17-07), dus een plaatsing zonder tarief moet gewoon door kunnen.
  const step0Valid = Boolean(candidateId && companyId && form.function_name && form.start_date);
  const missingEmail = !candidate?.email;
  const missingPhone = !candidate?.phone;

  const handleClose = () => {
    if (busy) return;
    onClose();
  };

  // ── Render ──
  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && handleClose()}>
        <SheetContent className="sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{success ? 'Plaatsing afgerond' : 'Plaatsing aanmaken'}</SheetTitle>
          </SheetHeader>

          {/* Stappenindicator */}
          {!success && (
            <div className="flex items-center gap-1 mt-4">
              {STEPS.map((label, i) => (
                <button
                  key={label}
                  type="button"
                  disabled={i > 0 && !step0Valid}
                  onClick={() => setStep(i)}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    i === step ? 'bg-primary text-primary-foreground'
                      : i < step ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground'
                  } ${i > 0 && !step0Valid ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  {i < step ? <Check className="h-3 w-3" /> : <span>{i + 1}</span>}
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* ── Succes-overzicht ── */}
          {success && (
            <div className="mt-6 space-y-4">
              <div className="rounded-md border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 p-4">
                <div className="flex items-center gap-2 font-medium text-green-800 dark:text-green-300">
                  <CheckCircle2 className="h-5 w-5" /> {candidateName} is geplaatst bij {companyName}
                </div>
              </div>
              <div className="space-y-2 text-sm">
                {success.timesheets > 0 && (
                  <div className="flex items-start gap-2"><Check className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />{success.timesheets} uren-templates aangemaakt</div>
                )}
                {success.housing && (
                  <div className="flex items-start gap-2"><Home className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />Huisvesting: {success.housing}</div>
                )}
                {success.vehicle && (
                  <div className="flex items-start gap-2"><Car className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />Voertuig: {success.vehicle}</div>
                )}
                {success.portal && (
                  <div className="flex items-start gap-2"><User className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />Portaal: {success.portal}</div>
                )}
                {success.mails?.client_email && (
                  <div className="flex items-start gap-2"><Mail className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    Mail opdrachtgever → {success.mails.client_email.to}{success.mails.client_email.sent_via === 'outlook' ? '' : ' (als concept opgeslagen)'}
                  </div>
                )}
                {success.mails?.employee_email && (
                  <div className="flex items-start gap-2"><Mail className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    Mail medewerker → {success.mails.employee_email.to}{success.mails.employee_email.sent_via === 'outlook' ? '' : ' (als concept opgeslagen)'}
                  </div>
                )}
                {success.mailError && (
                  <div className="flex items-start gap-2 text-destructive"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />Bevestigingsmail mislukt: {success.mailError}</div>
                )}
                <div className="flex items-start gap-2"><Check className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />Interne opvolg-taken aangemaakt (contract, administratie)</div>
              </div>
              <div className="flex justify-end pt-2">
                <Button onClick={handleClose}>Sluiten</Button>
              </div>
            </div>
          )}

          {/* ── Stap 1: Basis ── */}
          {!success && step === 0 && (
            <div className="mt-6 space-y-4">
              {/* Kandidaat */}
              {matchMode || selectedEmployee ? (
                <div className="p-3 bg-muted rounded-md text-sm flex items-center justify-between">
                  <div>
                    <div><span className="text-muted-foreground">Kandidaat:</span> <strong>{candidateName}</strong></div>
                    <div><span className="text-muted-foreground">Opdrachtgever:</span> <strong>{companyName || '—'}</strong></div>
                  </div>
                  {!matchMode && (
                    <button className="text-stat-blue text-xs hover:underline" onClick={() => setSelectedEmployee(null)}>Wijzig</button>
                  )}
                </div>
              ) : (
                <>
                  <div>
                    <Label>Zoek medewerker</Label>
                    <Input placeholder="Zoek op naam of personeelsnummer..." value={empSearch} onChange={(e) => setEmpSearch(e.target.value)} className="mt-1" />
                  </div>
                  <div className="border rounded-md max-h-[320px] overflow-y-auto divide-y">
                    {selectableCandidates.length === 0 ? (
                      <p className="p-4 text-sm text-muted-foreground text-center">
                        {candidatesLoading
                          ? 'Zoeken...'
                          : empSearch.trim()
                            ? 'Geen kandidaat gevonden. Probeer een deel van de achternaam.'
                            : 'Typ een naam om te zoeken.'}
                      </p>
                    ) : (
                      selectableCandidates.map((c) => (
                        <button key={c.id} className="w-full p-3 text-left hover:bg-muted transition-colors flex items-center justify-between gap-3" onClick={() => setSelectedEmployee(c)}>
                          <span className="font-medium text-sm">{c.first_name} {c.last_name}</span>
                          <span className="flex items-center gap-2 shrink-0">
                            {c.employee_number && <span className="text-xs text-muted-foreground">{c.employee_number}</span>}
                            <Badge variant="outline" className="text-xs">{EMPLOYEE_STATUS_LABELS[c.employee_status] ?? 'Kandidaat'}</Badge>
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                  {selectableCandidates.length === 50 && (
                    <p className="text-xs text-muted-foreground">Eerste 50 resultaten. Verfijn de zoekterm voor de rest.</p>
                  )}
                </>
              )}

              {(matchMode || selectedEmployee) && (
                <>
                  {/* Compliance-strip: laat direct zien wát er ontbreekt én laat het hier aanvullen */}
                  {compliance && !compliance.passed && candidateId && (
                    <ComplianceFixList candidateId={candidateId} compliance={compliance} />
                  )}
                  {compliance?.passed && (
                    <div className="rounded-md border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 p-2.5 text-sm flex items-center gap-2 text-green-800 dark:text-green-300">
                      <CheckCircle2 className="h-4 w-4" /> Dossier compleet
                    </div>
                  )}
                  {complianceLoading && !compliance && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Dossier controleren...</div>
                  )}

                  <div className="rounded-lg border p-3">
                    <h3 className="text-sm font-medium">Werkorder</h3>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {!matchMode && !lockedCompanyName && (
                        <div>
                          <Label>Opdrachtgever *</Label>
                          <Select value={form.company_id} onValueChange={(v) => set('company_id', v)}>
                            <SelectTrigger className="mt-1"><SelectValue placeholder="Selecteer bedrijf" /></SelectTrigger>
                            <SelectContent>
                              {(companies as any[]).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      <div><Label>Functienaam *</Label><Input className="mt-1" value={form.function_name} onChange={(e) => set('function_name', e.target.value)} /></div>
                      <div><Label>Startdatum *</Label><Input className="mt-1" type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} /></div>
                      <div><Label>Einddatum</Label><Input className="mt-1" type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} /></div>
                      <div><Label>Verwachte einddatum</Label><Input className="mt-1" type="date" value={form.expected_end_date} onChange={(e) => set('expected_end_date', e.target.value)} /></div>
                      <div>
                        <Label>Payroller</Label>
                        <Select value={form.payroller || NONE} onValueChange={(v) => set('payroller', v === NONE ? '' : v)}>
                          <SelectTrigger className="mt-1"><SelectValue placeholder="Selecteer payroller" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>Nog niet vastleggen</SelectItem>
                            {payrollers.map((p) => (
                              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border p-3">
                    <h3 className="text-sm font-medium">Tarieven</h3>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <div><Label>Uurtarief medewerker (€)</Label><Input className="mt-1" type="number" step="0.01" value={form.hourly_rate} onChange={(e) => set('hourly_rate', e.target.value)} placeholder="Optioneel" /></div>
                      <div><Label>Factuurtarief klant (€)</Label><Input className="mt-1" type="number" step="0.01" value={form.client_hourly_rate} onChange={(e) => set('client_hourly_rate', e.target.value)} placeholder="Verkooptarief" /></div>
                      <div><Label>Overwerktarief (€)</Label><Input className="mt-1" type="number" step="0.01" value={form.overtime_rate} onChange={(e) => set('overtime_rate', e.target.value)} /></div>
                    </div>
                  </div>

                  <div className="rounded-lg border p-3">
                    <h3 className="text-sm font-medium">Planning</h3>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div><Label>CAO-uren per week</Label><Input className="mt-1" type="number" step="0.5" value={form.cao_hours} onChange={(e) => set('cao_hours', e.target.value)} /></div>
                      <div><Label>Werklocatie</Label><Input className="mt-1" value={form.work_location} onChange={(e) => set('work_location', e.target.value)} placeholder="Adres of locatie" /></div>
                    </div>
                    <div className="mt-3">
                      <Label className="mb-2 block">Werkdagen</Label>
                      <div className="flex flex-wrap gap-1.5">
                        {DAYS.map((day) => (
                          <Button key={day} type="button" size="sm" variant={form.work_days.includes(day) ? 'default' : 'outline'} className="min-w-[40px]" onClick={() => toggleDay(day)}>
                            {day}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Stap 2: Vervoer ── */}
          {!success && step === 1 && (
            <div className="mt-6 space-y-4">
              <div className="rounded-md border p-3 text-sm">
                <div className="flex items-center gap-2 font-medium"><Car className="h-4 w-4" /> Rijbewijs</div>
                {licenseInfo?.has_drivers_license ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {(licenseInfo.drivers_license_categories ?? []).length > 0
                      ? `Categorieën: ${(licenseInfo.drivers_license_categories ?? []).join(', ')}`
                      : 'Rijbewijs aanwezig'}
                    {licenseInfo.drivers_license_expiry ? ` · geldig tot ${licenseInfo.drivers_license_expiry}` : ''}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-orange-600">Geen rijbewijs bekend — voertuigtoewijzing wordt door het systeem geblokkeerd.</p>
                )}
                {licenseExpired && (
                  <p className="mt-1 text-xs text-destructive flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Rijbewijs is verlopen.</p>
                )}
              </div>

              <div>
                <Label>Voertuig (optioneel)</Label>
                <Select value={vehicleId || NONE} onValueChange={(v) => setVehicleId(v === NONE ? '' : v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Geen voertuig" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Geen voertuig</SelectItem>
                    {(availableVehicles as any[]).map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.license_plate}{v.brand ? ` — ${v.brand} ${v.model ?? ''}` : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(availableVehicles as any[]).length === 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">Geen beschikbare voertuigen op {effectiveVehicleDate || 'de startdatum'}.</p>
                )}
              </div>

              {vehicleId && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Toewijzen vanaf</Label>
                    <Input className="mt-1" type="date" value={vehicleFrom || form.start_date} onChange={(e) => setVehicleFrom(e.target.value)} />
                    <p className="mt-1 text-xs text-muted-foreground">Standaard de startdatum van de plaatsing</p>
                  </div>
                  <div>
                    <Label>Begin kilometerstand</Label>
                    <Input className="mt-1" type="number" value={startMileage} onChange={(e) => setStartMileage(e.target.value)} placeholder="Laat leeg indien onbekend" />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Stap 3: Huisvesting ── */}
          {!success && step === 2 && (
            <div className="mt-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium flex items-center gap-1.5"><Home className="h-4 w-4" /> Huisvesting</h3>
                <div className="flex items-center gap-2">
                  <Checkbox id="no-housing" checked={noHousingNeeded} onCheckedChange={(v) => setNoHousingNeeded(v === true)} />
                  <label htmlFor="no-housing" className="text-xs text-muted-foreground cursor-pointer">Geen huisvesting nodig</label>
                </div>
              </div>

              {housingLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2"><Loader2 className="h-4 w-4 animate-spin" /> Suggesties laden...</div>
              )}

              {!housingLoading && !noHousingNeeded && housingSuggestions.length === 0 && (
                <p className="text-sm text-muted-foreground">Geen beschikbare kamers gevonden.</p>
              )}

              {!noHousingNeeded && housingSuggestions.length > 0 && (
                <div className="space-y-2 max-h-[360px] overflow-y-auto">
                  {housingSuggestions.map((s) => {
                    const selected = s.unitId === selectedUnitId;
                    return (
                      <button
                        key={s.unitId}
                        type="button"
                        onClick={() => setSelectedUnitId(selected ? '' : s.unitId)}
                        className={`w-full text-left p-2.5 rounded-md border text-sm transition-colors ${
                          selected ? 'border-primary bg-primary/5' : 'bg-muted/50 border-transparent hover:border-border'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-medium">{s.unitName} — {s.propertyName}</div>
                          {selected && <Check className="h-4 w-4 text-primary shrink-0" />}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5 flex-wrap">
                          {s.distanceKm != null && (
                            <span className="flex items-center gap-0.5 text-stat-blue font-medium">
                              <Navigation className="h-3 w-3" /> {s.distanceKm} km{s.durationMin != null && ` · ${s.durationMin} min`}
                            </span>
                          )}
                          <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" /> {s.propertyCity}</span>
                          <span>{s.currentOccupancy}/{s.capacity} bezet</span>
                          {s.colleagueCount > 0 && (
                            <Badge variant="secondary" className="text-[10px] h-4 px-1 gap-0.5">
                              <Users className="h-2.5 w-2.5" /> {s.colleagueCount} collega{s.colleagueCount > 1 ? "'s" : ''}
                            </Badge>
                          )}
                          {s.weeklyCost != null ? <span>€{s.weeklyCost}/week</span> : s.monthlyCost != null ? <span>€{s.monthlyCost}/mnd</span> : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {!noHousingNeeded && selectedSuggestion && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Check-in datum</Label>
                    <Input className="mt-1" type="date" value={checkInDate || form.start_date} onChange={(e) => setCheckInDate(e.target.value)} />
                  </div>
                  <div>
                    <Label>Inhouding</Label>
                    <div className="mt-1 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                      {selectedSuggestion.weeklyCost != null
                        ? `€${selectedSuggestion.weeklyCost} per week`
                        : selectedSuggestion.monthlyCost != null
                          ? `€${selectedSuggestion.monthlyCost} per maand`
                          : 'Onbekend'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Stap 4: Controle & versturen ── */}
          {!success && step === 3 && (
            <div className="mt-6 space-y-4">
              <div className="rounded-md border bg-muted/50 p-3 text-sm space-y-1">
                <div><span className="text-muted-foreground">Kandidaat:</span> <strong>{candidateName}</strong></div>
                <div><span className="text-muted-foreground">Opdrachtgever:</span> <strong>{companyName}</strong></div>
                <div><span className="text-muted-foreground">Functie:</span> <strong>{form.function_name}</strong> per <strong>{form.start_date}</strong>{form.end_date ? ` t/m ${form.end_date}` : ''}</div>
                <div><span className="text-muted-foreground">Tarief:</span> <strong>{form.hourly_rate ? `€${form.hourly_rate}` : 'Niet ingevuld'}</strong>{form.client_hourly_rate ? ` · klant €${form.client_hourly_rate}` : ''}</div>
                {form.payroller && <div><span className="text-muted-foreground">Payroller:</span> <strong>{payrollers.find((p) => p.id === form.payroller)?.name ?? '—'}</strong></div>}
                <div><span className="text-muted-foreground">Voertuig:</span> {vehicleId
                  ? <strong>{(availableVehicles as any[]).find((v) => v.id === vehicleId)?.license_plate ?? 'Geselecteerd'} vanaf {vehicleFrom || form.start_date}</strong>
                  : 'Geen'}</div>
                <div><span className="text-muted-foreground">Huisvesting:</span> {noHousingNeeded
                  ? 'Niet nodig'
                  : selectedSuggestion
                    ? <strong>{selectedSuggestion.unitName} — {selectedSuggestion.propertyName} (check-in {checkInDate || form.start_date})</strong>
                    : 'Geen'}</div>
              </div>

              {compliance && !compliance.passed && (
                <div className="rounded-md border border-orange-200 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-900 p-2.5 text-xs text-orange-800 dark:text-orange-300 flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Dossier niet compleet ({compliance.issues.length} punt{compliance.issues.length > 1 ? 'en' : ''}) — plaatsen vraagt een override.
                </div>
              )}

              <PlacementMailEditor
                active={step === 3}
                placementData={placementData}
                candidateName={candidateName}
                companyName={companyName}
                missingEmail={missingEmail}
                missingPhone={missingPhone}
                sendToClient={sendToClient}
                sendToEmployee={sendToEmployee}
                onSendToClientChange={setSendToClient}
                onSendToEmployeeChange={setSendToEmployee}
                edits={mailEdits}
                onEditsChange={setMailEdits}
              />
            </div>
          )}

          {/* Navigatie */}
          {!success && (
            <div className="flex justify-between gap-3 pt-6">
              <Button variant="ghost" onClick={handleClose} disabled={busy}>Annuleren</Button>
              <div className="flex gap-2">
                {step > 0 && (
                  <Button variant="outline" onClick={() => setStep(step - 1)} disabled={busy}>
                    <ChevronLeft className="h-4 w-4 mr-1" /> Terug
                  </Button>
                )}
                {step < 3 && (
                  <Button onClick={() => setStep(step + 1)} disabled={!step0Valid}>
                    Volgende <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                )}
                {step === 3 && (
                  <Button onClick={() => mutation.mutate()} disabled={!step0Valid || busy}>
                    {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {busy ? 'Plaatsen...' : (sendToClient || (sendToEmployee && !missingEmail)) ? 'Plaatsen & versturen' : 'Plaatsen zonder e-mail'}
                  </Button>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <ComplianceWarningDialog
        open={showComplianceWarning}
        onOpenChange={setShowComplianceWarning}
        issues={complianceIssues}
        onOverride={() => overrideMutation.mutate()}
      />
    </>
  );
};

export default PlacementWizard;
