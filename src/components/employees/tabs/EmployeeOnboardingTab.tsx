import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle2, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { formatDate } from '@/lib/format';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';

const FIELD_LABELS: Record<string, string> = {
  bsn: 'BSN', iban: 'IBAN', date_of_birth: 'Geboortedatum',
  nationality: 'Nationaliteit', address_street: 'Adres',
  phone: 'Telefoon', email: 'E-mail',
};

const DOC_LABELS: Record<string, string> = {
  id_bewijs: 'ID Bewijs', contract: 'Contract', reglement: 'Reglement',
  rijbewijs: 'Rijbewijs', vca: 'VCA', overig: 'Overig',
};

interface CheckItem {
  label: string;
  description: string;
  done: boolean;
}

const EmployeeOnboardingTab = ({ employee }: { employee: any }) => {
  const qc = useQueryClient();
  const c = employee.candidates;

  const { data: docs = [] } = useQuery({
    queryKey: ['documents', employee.candidate_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('documents').select('type, status').eq('candidate_id', employee.candidate_id);
      if (error) throw error;
      return data;
    },
  });

  const { data: rules = [] } = useQuery({
    queryKey: ['compliance-rules-onboarding'],
    queryFn: async () => {
      const { data, error } = await supabase.from('compliance_rules' as any).select('*').eq('is_active', true);
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  // Build dynamic checklist
  const checkItems: CheckItem[] = [];
  const docTypes = docs.map((d: any) => d.type);

  if (rules.length > 0) {
    // Collect all required docs and fields from applicable rules
    const requiredDocs = new Set<string>();
    const requiredFields = new Set<string>();

    // Use global rules + any matching sector/contract rules
    for (const rule of rules) {
      (rule.required_documents || []).forEach((d: string) => requiredDocs.add(d));
      (rule.required_fields || []).forEach((f: string) => requiredFields.add(f));
    }

    // Add field checks
    for (const field of requiredFields) {
      checkItems.push({
        label: `${FIELD_LABELS[field] || field} ingevuld`,
        description: `Verplicht veld: ${FIELD_LABELS[field] || field}`,
        done: !!(c as any)?.[field],
      });
    }

    // Add document checks
    for (const docType of requiredDocs) {
      if (docType === 'id_bewijs') {
        checkItems.push({
          label: 'ID bewijs geüpload',
          description: 'Geldig identiteitsbewijs',
          done: docs.some((d: any) => d.type === 'id_bewijs' && d.status !== 'verlopen'),
        });
      } else {
        checkItems.push({
          label: `${DOC_LABELS[docType] || docType} geüpload`,
          description: `Vereist document: ${DOC_LABELS[docType] || docType}`,
          done: docTypes.includes(docType),
        });
      }
    }
  } else {
    // Fallback to hardcoded
    checkItems.push(
      { label: 'Persoonsgegevens ingevuld', description: 'Voornaam, achternaam, geboortedatum, nationaliteit, BSN en IBAN', done: !!(c?.first_name && c?.last_name && c?.date_of_birth && c?.nationality && c?.bsn && c?.iban) },
      { label: 'ID bewijs geüpload', description: 'Geldig identiteitsbewijs', done: docs.some((d: any) => d.type === 'id_bewijs' && d.status !== 'verlopen') },
      { label: 'Contract getekend', description: 'Arbeidsovereenkomst ondertekend', done: docTypes.includes('contract') },
      { label: 'Reglement afgetekend', description: 'Bedrijfsreglement gelezen en akkoord', done: docTypes.includes('reglement') },
      { label: 'IBAN ingevuld', description: 'Bankrekeningnummer voor salarisuitbetaling', done: !!c?.iban },
    );

    // Conditionally add rijbewijs
    if (c?.has_drivers_license) {
      checkItems.splice(2, 0, {
        label: 'Rijbewijs geüpload', description: 'Geldig rijbewijs document',
        done: docs.some((d: any) => d.type === 'rijbewijs'),
      });
    }
  }

  const completedCount = checkItems.filter(item => item.done).length;
  const percentage = checkItems.length > 0 ? Math.round((completedCount / checkItems.length) * 100) : 0;
  const allComplete = completedCount === checkItems.length;

  const finishOnboarding = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('employees')
        .update({ onboarding_completed: true, onboarding_completed_at: new Date().toISOString(), status: 'actief' as const })
        .eq('id', employee.id);
      if (error) throw error;
      const { error: e2 } = await supabase.from('candidates')
        .update({ compliance_status: 'compleet' as const })
        .eq('id', employee.candidate_id);
      if (e2) throw e2;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee', employee.id] });
      qc.invalidateQueries({ queryKey: ['employees'] });
      logAudit({
        action: 'status_change',
        tableName: 'employees',
        recordId: employee.id,
        newValues: { onboarding_completed: true, status: 'actief' },
      });
      toast.success('Onboarding afgerond');
    },
  });

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-lg border p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium">Onboarding voortgang</h3>
          <span className="text-sm font-medium">{percentage}%</span>
        </div>
        <Progress value={percentage} className="h-2" />
        <p className="text-xs text-muted-foreground mt-2">{completedCount} van {checkItems.length} stappen voltooid</p>
      </div>

      <div className="space-y-3">
        {checkItems.map((item) => (
          <div key={item.label} className="bg-card rounded-lg border p-4 flex items-start gap-3">
            {item.done
              ? <CheckCircle2 className="h-5 w-5 text-stat-green shrink-0 mt-0.5" />
              : <Circle className="h-5 w-5 text-muted-foreground/40 shrink-0 mt-0.5" />}
            <div className="flex-1">
              <p className="text-sm font-medium">{item.label}</p>
              <p className="text-xs text-muted-foreground">{item.description}</p>
            </div>
            {!item.done && (
              <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full shrink-0">Actie vereist</span>
            )}
          </div>
        ))}
      </div>

      {employee.onboarding_completed ? (
        <div className="bg-stat-green/10 border border-stat-green/20 rounded-lg p-4">
          <p className="text-sm font-medium text-stat-green">
            ✓ Onboarding afgerond op {formatDate(employee.onboarding_completed_at)}
          </p>
        </div>
      ) : allComplete ? (
        <Button onClick={() => finishOnboarding.mutate()} disabled={finishOnboarding.isPending}>
          {finishOnboarding.isPending ? 'Afronden...' : 'Onboarding afronden'}
        </Button>
      ) : null}
    </div>
  );
};

export default EmployeeOnboardingTab;
