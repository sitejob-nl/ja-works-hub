import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';
import { checkCompliance } from '@/hooks/useComplianceCheck';
import ComplianceWarningDialog from '@/components/ComplianceWarningDialog';
import { generateTimesheetTemplates } from '@/components/placement/PlacementTriggers';
import type { Database } from '@/integrations/supabase/types';

type PayrollerType = Database['public']['Enums']['payroller_type'];

const DAYS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

type NewPlacementSheetProps = {
  open: boolean;
  onClose: () => void;
  orgId: string;
  userId?: string;
  /** Voorgeselecteerde opdrachtgever (bijv. vanaf de opdrachtgever-pagina). */
  defaultCompanyId?: string;
  /** Wanneer gezet, staat de opdrachtgever vast en wordt de keuzelijst vervangen door deze naam. */
  lockedCompanyName?: string;
};

const NewPlacementSheet = ({ open, onClose, orgId, userId, defaultCompanyId, lockedCompanyName }: NewPlacementSheetProps) => {
  const qc = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
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
  const [complianceIssues, setComplianceIssues] = useState<string[]>([]);
  const [showComplianceWarning, setShowComplianceWarning] = useState(false);

  const { data: employees } = useQuery({
    queryKey: ['employees-active-planning'],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees').select('id, candidate_id, status, candidates!employees_candidate_id_fkey(first_name, last_name, phone, email)').eq('status', 'actief' as any).order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
  });

  const { data: companies } = useQuery({
    queryKey: ['companies-list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('companies').select('id, name').eq('is_active', true).order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: open && !lockedCompanyName,
  });

  const filteredEmps = useMemo(() => {
    if (!employees) return [];
    if (!empSearch) return employees;
    const s = empSearch.toLowerCase();
    return employees.filter((e: any) => {
      const n = `${e.candidates?.first_name ?? ''} ${e.candidates?.last_name ?? ''}`.toLowerCase();
      return n.includes(s);
    });
  }, [employees, empSearch]);

  const executePlacement = async (isOverride: boolean) => {
    const candidateId = selectedEmployee.candidate_id;
    const compliance = await checkCompliance(candidateId);

    if (!compliance.passed && !isOverride) {
      setComplianceIssues(compliance.issues);
      setShowComplianceWarning(true);
      return;
    }

    const { data: placement, error } = await supabase.from('placements').insert({
      organization_id: orgId,
      employee_id: selectedEmployee.id,
      candidate_id: candidateId,
      company_id: form.company_id,
      function_name: form.function_name,
      start_date: form.start_date,
      end_date: form.end_date || null,
      expected_end_date: form.expected_end_date || form.end_date || null,
      hourly_rate: parseFloat(form.hourly_rate),
      client_hourly_rate: form.client_hourly_rate ? parseFloat(form.client_hourly_rate) : null,
      overtime_rate: form.overtime_rate ? parseFloat(form.overtime_rate) : null,
      payroller: form.payroller ? form.payroller as PayrollerType : null,
      cao_hours: form.cao_hours ? parseFloat(form.cao_hours) : null,
      work_location: form.work_location || null,
      work_days: form.work_days.length > 0 ? form.work_days : null,
      status: 'actief' as any,
      created_by: userId ?? null,
      compliance_check_passed: compliance.passed,
      compliance_check_at: new Date().toISOString(),
      compliance_override: isOverride,
      compliance_override_by: isOverride ? userId ?? null : null,
      compliance_override_reason: isOverride ? compliance.issues.join(', ') : null,
    }).select('id').single();
    if (error) throw error;

    let generatedTimesheets = 0;
    try {
      generatedTimesheets = await generateTimesheetTemplates({
        placementId: placement.id,
        candidateId,
        employeeId: selectedEmployee.id,
        companyId: form.company_id,
        organizationId: orgId,
        startDate: form.start_date,
        functionName: form.function_name,
        hourlyRate: parseFloat(form.hourly_rate),
      });
    } catch (e) {
      console.warn('Uren-templates aanmaken mislukt:', e);
    }

    logAudit({
      action: isOverride ? 'override' : 'create',
      tableName: 'placements',
      recordId: placement?.id ?? 'unknown',
      newValues: { ...form, compliance_passed: compliance.passed, override: isOverride },
      reason: isOverride ? `Compliance override: ${compliance.issues.join(', ')}` : undefined,
    });

    return { placementId: placement.id, generatedTimesheets };
  };

  const invalidatePlacements = () => {
    qc.invalidateQueries({ queryKey: ['planning-placements'] });
    qc.invalidateQueries({ queryKey: ['placements'] });
    qc.invalidateQueries({ queryKey: ['placements-list'] });
    qc.invalidateQueries({ queryKey: ['timesheets'] });
    qc.invalidateQueries({ queryKey: ['company-placements'] });
  };

  const mutation = useMutation({
    mutationFn: () => executePlacement(false),
    onSuccess: (result) => {
      invalidatePlacements();
      toast.success(result?.generatedTimesheets ? `Plaatsing aangemaakt · ${result.generatedTimesheets} uren-templates` : 'Plaatsing aangemaakt');
      resetAndClose();
    },
    onError: (e: any) => {
      if (!showComplianceWarning) toast.error(e.message);
    },
  });

  const overrideMutation = useMutation({
    mutationFn: () => executePlacement(true),
    onSuccess: (result) => {
      invalidatePlacements();
      toast.success(result?.generatedTimesheets ? `Plaatsing aangemaakt met override · ${result.generatedTimesheets} uren-templates` : 'Plaatsing aangemaakt (compliance override)');
      resetAndClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const resetAndClose = () => {
    setStep(1);
    setSelectedEmployee(null);
    setEmpSearch('');
    setForm({
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
      work_days: [],
    });
    onClose();
  };

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const toggleDay = (day: string) => {
    setForm((f) => ({
      ...f,
      work_days: f.work_days.includes(day) ? f.work_days.filter((d) => d !== day) : [...f.work_days, day],
    }));
  };

  return (
    <>
    <Sheet open={open} onOpenChange={(o) => !o && resetAndClose()}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Nieuwe plaatsing</SheetTitle>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          {step === 1 && (
            <>
              <div>
                <Label>Zoek medewerker</Label>
                <Input placeholder="Zoek op naam..." value={empSearch} onChange={(e) => setEmpSearch(e.target.value)} className="mt-1" />
              </div>
              <div className="border rounded-md max-h-[400px] overflow-y-auto divide-y">
                {filteredEmps.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground text-center">Geen actieve medewerkers gevonden</p>
                ) : (
                  filteredEmps.map((e: any) => (
                    <button key={e.id} className="w-full p-3 text-left hover:bg-muted transition-colors flex items-center justify-between" onClick={() => { setSelectedEmployee(e); setStep(2); }}>
                      <span className="font-medium text-sm">{e.candidates?.first_name} {e.candidates?.last_name}</span>
                      <Badge variant="outline" className="text-xs">Actief</Badge>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
          {step === 2 && selectedEmployee && (
            <>
              <div className="p-3 bg-muted rounded-md text-sm flex items-center justify-between">
                <span><strong>{selectedEmployee.candidates?.first_name} {selectedEmployee.candidates?.last_name}</strong></span>
                <button className="text-stat-blue text-xs hover:underline" onClick={() => setStep(1)}>Wijzig</button>
              </div>

              <div className="space-y-4">
                <div className="rounded-lg border p-3">
                  <h3 className="text-sm font-medium">Werkorder</h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Opdrachtgever *</Label>
                      {lockedCompanyName ? (
                        <div className="mt-1 rounded-md border bg-muted/40 px-3 py-2 text-sm">{lockedCompanyName}</div>
                      ) : (
                        <Select value={form.company_id} onValueChange={(v) => set('company_id', v)}>
                          <SelectTrigger className="mt-1"><SelectValue placeholder="Selecteer bedrijf" /></SelectTrigger>
                          <SelectContent>
                            {companies?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    <div><Label>Functienaam *</Label><Input className="mt-1" value={form.function_name} onChange={(e) => set('function_name', e.target.value)} /></div>
                    <div><Label>Startdatum *</Label><Input className="mt-1" type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} /></div>
                    <div><Label>Einddatum</Label><Input className="mt-1" type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} /></div>
                    <div><Label>Verwachte einddatum</Label><Input className="mt-1" type="date" value={form.expected_end_date} onChange={(e) => set('expected_end_date', e.target.value)} /></div>
                    <div>
                      <Label>Payroller</Label>
                      <Select value={form.payroller || 'none'} onValueChange={(v) => set('payroller', v === 'none' ? '' : v)}>
                        <SelectTrigger className="mt-1"><SelectValue placeholder="Selecteer payroller" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Nog niet vastleggen</SelectItem>
                          <SelectItem value="flexpedia">Flexpedia</SelectItem>
                          <SelectItem value="brioworks">BrioWorks</SelectItem>
                          <SelectItem value="bromida">Bromida</SelectItem>
                          <SelectItem value="retiva">Retiva / A1</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border p-3">
                  <h3 className="text-sm font-medium">Tarieven</h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <div><Label>Uurtarief medewerker (€) *</Label><Input className="mt-1" type="number" step="0.01" value={form.hourly_rate} onChange={(e) => set('hourly_rate', e.target.value)} /></div>
                    <div><Label>Factuurtarief klant (€)</Label><Input className="mt-1" type="number" step="0.01" value={form.client_hourly_rate} onChange={(e) => set('client_hourly_rate', e.target.value)} /></div>
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
                        <Button
                          key={day}
                          type="button"
                          size="sm"
                          variant={form.work_days.includes(day) ? 'default' : 'outline'}
                          className="min-w-[40px]"
                          onClick={() => toggleDay(day)}
                        >
                          {day}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button variant="ghost" onClick={resetAndClose}>Annuleren</Button>
                <Button
                  onClick={() => mutation.mutate()}
                  disabled={!form.company_id || !form.function_name || !form.start_date || !form.hourly_rate || mutation.isPending}
                >
                  {mutation.isPending ? 'Aanmaken...' : 'Plaatsing aanmaken'}
                </Button>
              </div>
            </>
          )}
        </div>
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

export default NewPlacementSheet;
