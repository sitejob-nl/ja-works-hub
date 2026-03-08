import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { checkCompliance } from '@/hooks/useComplianceCheck';
import ComplianceWarningDialog from '@/components/ComplianceWarningDialog';
import { logAudit } from '@/lib/audit';
import { generateTimesheetTemplates, getHousingSuggestions, sendPlacementWhatsApp, type HousingSuggestion } from '@/components/placement/PlacementTriggers';
import HousingSuggestionsCard from '@/components/placement/HousingSuggestionsCard';

interface Props {
  match: any | null;
  vacancy: any;
  onClose: () => void;
}

const PlacementSheet = ({ match, vacancy, onClose }: Props) => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    function_name: '',
    start_date: '',
    end_date: '',
    hourly_rate: '',
    overtime_rate: '',
  });

  const [complianceIssues, setComplianceIssues] = useState<string[]>([]);
  const [showComplianceWarning, setShowComplianceWarning] = useState(false);
  const [housingSuggestions, setHousingSuggestions] = useState<HousingSuggestion[]>([]);
  const [placementDone, setPlacementDone] = useState(false);
  const [lastPlacementData, setLastPlacementData] = useState<{ employeeId: string; placementId: string } | null>(null);

  useEffect(() => {
    if (match && vacancy) {
      setForm({
        function_name: vacancy.title ?? '',
        start_date: vacancy.start_date ?? '',
        end_date: vacancy.end_date ?? '',
        hourly_rate: vacancy.hourly_rate?.toString() ?? '',
        overtime_rate: '',
      });
    }
  }, [match, vacancy]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const executePlacement = async (isOverride: boolean) => {
    const candidateId = match.candidate_id;
    const companyId = vacancy.company_id;

    // Run compliance check
    const compliance = await checkCompliance(candidateId);

    if (!compliance.passed && !isOverride) {
      setComplianceIssues(compliance.issues);
      setShowComplianceWarning(true);
      return;
    }

    // 1. Check if employee exists
    const { data: existingEmployee } = await supabase
      .from('employees')
      .select('id')
      .eq('candidate_id', candidateId)
      .maybeSingle();

    let employeeId: string;

    if (existingEmployee) {
      employeeId = existingEmployee.id;
    } else {
      const { data: newEmployee, error: empError } = await supabase
        .from('employees')
        .insert({
          organization_id: orgId,
          candidate_id: candidateId,
          start_date: form.start_date,
          status: 'actief' as any,
        })
        .select('id')
        .single();
      if (empError) throw empError;
      employeeId = newEmployee.id;

      const { error: candError } = await supabase
        .from('candidates')
        .update({ status: 'geplaatst' as any })
        .eq('id', candidateId);
      if (candError) throw candError;
    }

    // 2. Create placement
    const { data: placement, error: plError } = await supabase.from('placements').insert({
      organization_id: orgId,
      employee_id: employeeId,
      company_id: companyId,
      vacancy_id: vacancy.id,
      match_id: match.id,
      function_name: form.function_name,
      start_date: form.start_date,
      end_date: form.end_date || null,
      hourly_rate: parseFloat(form.hourly_rate),
      overtime_rate: form.overtime_rate ? parseFloat(form.overtime_rate) : null,
      status: 'actief' as any,
      created_by: user?.id ?? null,
      compliance_check_passed: compliance.passed,
      compliance_check_at: new Date().toISOString(),
      compliance_override: isOverride,
      compliance_override_by: isOverride ? user?.id ?? null : null,
      compliance_override_reason: isOverride ? compliance.issues.join(', ') : null,
    }).select('id').single();
    if (plError) throw plError;

    // 3. Update match status
    const { error: matchError } = await supabase
      .from('matches')
      .update({ status: 'geplaatst' as any, status_changed_at: new Date().toISOString() })
      .eq('id', match.id);
    if (matchError) throw matchError;

    // 4. Increment filled_count
    const { error: vacError } = await supabase
      .from('vacancies')
      .update({
        filled_count: (vacancy.filled_count ?? 0) + 1,
        ...(((vacancy.filled_count ?? 0) + 1) >= vacancy.required_count ? { status: 'vervuld' as any } : {}),
      })
      .eq('id', vacancy.id);
    if (vacError) throw vacError;

    // Audit log
    logAudit({
      action: isOverride ? 'override' : 'create',
      tableName: 'placements',
      recordId: placement?.id ?? 'unknown',
      newValues: { ...form, compliance_passed: compliance.passed, override: isOverride },
      reason: isOverride ? `Compliance override: ${compliance.issues.join(', ')}` : undefined,
    });

    // === POST-PLACEMENT TRIGGERS ===
    const candidate = match?.candidates as any;

    // 1. Generate timesheet templates
    try {
      const count = await generateTimesheetTemplates({
        placementId: placement.id,
        employeeId,
        companyId,
        organizationId: orgId,
        startDate: form.start_date,
        functionName: form.function_name,
        hourlyRate: parseFloat(form.hourly_rate),
      });
      if (count > 0) toast.info(`${count} uren-templates aangemaakt`);
    } catch { /* non-blocking */ }

    // 2. Get housing suggestions
    try {
      const suggestions = await getHousingSuggestions(orgId, companyId);
      if (suggestions.length > 0) {
        setHousingSuggestions(suggestions);
        setLastPlacementData({ employeeId, placementId: placement.id });
        setPlacementDone(true);
        return; // Keep sheet open to show housing suggestions
      }
    } catch { /* non-blocking */ }

    // 3. Send WhatsApp confirmation
    try {
      await sendPlacementWhatsApp({
        placementId: placement.id,
        employeeId,
        companyId,
        organizationId: orgId,
        startDate: form.start_date,
        functionName: form.function_name,
        hourlyRate: parseFloat(form.hourly_rate),
        candidatePhone: candidate?.phone,
        candidateName: candidate?.first_name,
      });
    } catch { /* non-blocking */ }
  };

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['vacancy-matches'] });
    qc.invalidateQueries({ queryKey: ['vacancy-placements'] });
    qc.invalidateQueries({ queryKey: ['vacancy', vacancy.id] });
    qc.invalidateQueries({ queryKey: ['vacancies'] });
    qc.invalidateQueries({ queryKey: ['employees'] });
    qc.invalidateQueries({ queryKey: ['candidates'] });
    qc.invalidateQueries({ queryKey: ['timesheets'] });
  };

  const mutation = useMutation({
    mutationFn: () => executePlacement(false),
    onSuccess: () => {
      invalidateAll();
      if (!placementDone) {
        toast.success('Plaatsing aangemaakt');
        onClose();
      }
    },
    onError: (e: any) => {
      // Don't show error if compliance dialog is being shown
      if (!showComplianceWarning) {
        toast.error(e.message);
      }
    },
  });

  const overrideMutation = useMutation({
    mutationFn: () => executePlacement(true),
    onSuccess: () => {
      invalidateAll();
      if (!placementDone) {
        toast.success('Plaatsing aangemaakt (compliance override)');
        onClose();
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  const candidate = match?.candidates as any;

  return (
    <>
      <Sheet open={!!match} onOpenChange={(open) => !open && onClose()}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Plaatsing aanmaken</SheetTitle>
          </SheetHeader>
          {match && (
            <div className="space-y-4 mt-6">
              <div className="p-3 bg-muted rounded-md text-sm">
                <div><span className="text-muted-foreground">Kandidaat:</span> <strong>{candidate?.first_name} {candidate?.last_name}</strong></div>
                <div><span className="text-muted-foreground">Opdrachtgever:</span> <strong>{(vacancy.companies as any)?.name}</strong></div>
              </div>
              <div><Label>Functienaam *</Label><Input value={form.function_name} onChange={(e) => set('function_name', e.target.value)} /></div>
              <div><Label>Startdatum *</Label><Input type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} /></div>
              <div><Label>Einddatum</Label><Input type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} /></div>
              <div><Label>Uurtarief (€) *</Label><Input type="number" step="0.01" value={form.hourly_rate} onChange={(e) => set('hourly_rate', e.target.value)} /></div>
              <div><Label>Overwerktarief (€)</Label><Input type="number" step="0.01" value={form.overtime_rate} onChange={(e) => set('overtime_rate', e.target.value)} /></div>
              <div className="flex justify-end gap-3 pt-4">
                <Button variant="ghost" onClick={onClose}>Annuleren</Button>
                <Button onClick={() => mutation.mutate()} disabled={!form.function_name || !form.start_date || !form.hourly_rate || mutation.isPending}>
                  {mutation.isPending ? 'Aanmaken...' : 'Plaatsing aanmaken'}
                </Button>
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

export default PlacementSheet;
