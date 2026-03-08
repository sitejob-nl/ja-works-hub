import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle2, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { formatDate } from '@/lib/format';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';

interface CheckItem {
  label: string;
  description: string;
  check: (c: any, docs: any[]) => boolean;
  skip?: (c: any) => boolean;
}

const checkItems: CheckItem[] = [
  {
    label: 'Persoonsgegevens ingevuld',
    description: 'Voornaam, achternaam, geboortedatum, nationaliteit, BSN en IBAN',
    check: (c) => !!(c.first_name && c.last_name && c.date_of_birth && c.nationality && c.bsn && c.iban),
  },
  {
    label: 'ID bewijs geüpload',
    description: 'Geldig identiteitsbewijs',
    check: (_, docs) => docs.some(d => d.type === 'id_bewijs' && d.status !== 'verlopen'),
  },
  {
    label: 'Rijbewijs geüpload',
    description: 'Geldig rijbewijs document',
    check: (_, docs) => docs.some(d => d.type === 'rijbewijs'),
    skip: (c) => !c.has_drivers_license,
  },
  {
    label: 'Contract getekend',
    description: 'Arbeidsovereenkomst ondertekend',
    check: (_, docs) => docs.some(d => d.type === 'contract'),
  },
  {
    label: 'Reglement afgetekend',
    description: 'Bedrijfsreglement gelezen en akkoord',
    check: (_, docs) => docs.some(d => d.type === 'reglement'),
  },
  {
    label: 'IBAN ingevuld',
    description: 'Bankrekeningnummer voor salarisuitbetaling',
    check: (c) => !!c.iban,
  },
];

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

  const applicableItems = checkItems.filter(item => !item.skip?.(c));
  const completedCount = applicableItems.filter(item => item.check(c, docs)).length;
  const percentage = applicableItems.length > 0 ? Math.round((completedCount / applicableItems.length) * 100) : 0;
  const allComplete = completedCount === applicableItems.length;

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
        <p className="text-xs text-muted-foreground mt-2">{completedCount} van {applicableItems.length} stappen voltooid</p>
      </div>

      <div className="space-y-3">
        {applicableItems.map((item) => {
          const done = item.check(c, docs);
          return (
            <div key={item.label} className="bg-card rounded-lg border p-4 flex items-start gap-3">
              {done
                ? <CheckCircle2 className="h-5 w-5 text-stat-green shrink-0 mt-0.5" />
                : <Circle className="h-5 w-5 text-muted-foreground/40 shrink-0 mt-0.5" />}
              <div className="flex-1">
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.description}</p>
              </div>
              {!done && (
                <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full shrink-0">Actie vereist</span>
              )}
            </div>
          );
        })}
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
