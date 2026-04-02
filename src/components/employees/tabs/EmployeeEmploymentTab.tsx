import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Pencil, X, Check } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { toast } from 'sonner';

const Field = ({ label, value, children }: { label: string; value?: string | null; children?: React.ReactNode }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    {children ?? <p className="text-sm mt-0.5">{value || '—'}</p>}
  </div>
);

const statusBadge: Record<string, string> = {
  onboarding: 'bg-blue-100 text-blue-700 border-0',
  actief: 'bg-stat-green/10 text-stat-green border-0',
  ziek: 'bg-orange-100 text-orange-600 border-0',
  uit_dienst: 'bg-red-100 text-red-600 border-0',
};
const statusLabel: Record<string, string> = { onboarding: 'Onboarding', actief: 'Actief', ziek: 'Ziek', uit_dienst: 'Uit dienst' };
const contractLabels: Record<string, string> = { bepaalde_tijd: 'Bepaalde tijd', onbepaalde_tijd: 'Onbepaalde tijd', oproep: 'Oproep', payroll: 'Payroll' };
const payFreqLabels: Record<string, string> = { wekelijks: 'Wekelijks', vierwekelijks: 'Vierwekelijks', maandelijks: 'Maandelijks' };
const endReasonOptions = [
  { value: 'eigen_verzoek', label: 'Eigen verzoek' },
  { value: 'einde_contract', label: 'Einde contract' },
  { value: 'ontslag', label: 'Ontslag' },
  { value: 'wederzijds_goedvinden', label: 'Wederzijds goedvinden' },
  { value: 'pensioen', label: 'Pensioen' },
  { value: 'overlijden', label: 'Overlijden' },
  { value: 'overig', label: 'Overig' },
];

const EmployeeEmploymentTab = ({ candidateId, candidate, employment }: { candidateId: string; candidate: any; employment?: any }) => {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});

  const startEdit = () => {
    setForm({
      employee_number: candidate?.employee_number ?? '',
      start_date: employment?.start_date ?? '',
      end_date: employment?.end_date ?? '',
      end_reason: employment?.end_reason ?? '',
      contract_type: employment?.contract_type ?? '',
      contract_hours: employment?.contract_hours?.toString() ?? '',
      pay_frequency: employment?.pay_frequency ?? '',
      pension_scheme: employment?.pension_scheme ?? '',
      pension_start_date: employment?.pension_start_date ?? '',
      vacation_days_total: employment?.vacation_days_total?.toString() ?? '',
      vacation_days_used: employment?.vacation_days_used?.toString() ?? '',
      vacation_money_percentage: employment?.vacation_money_percentage?.toString() ?? '',
      senior_days: employment?.senior_days?.toString() ?? '',
      insurance_type: employment?.insurance_type ?? '',
      insurance_notes: employment?.insurance_notes ?? '',
    });
    setEditing(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      // Update employee_number on the candidate
      const { error: e1 } = await supabase.from('candidates').update({
        employee_number: form.employee_number || null,
      }).eq('id', candidateId);
      if (e1) throw e1;

      // Update employment details on candidate_employment
      if (employment?.id) {
        const { error } = await supabase.from('candidate_employment').update({
          start_date: form.start_date,
          end_date: form.end_date || null,
          end_reason: form.end_reason || null,
          contract_type: form.contract_type || null,
          contract_hours: form.contract_hours ? parseFloat(form.contract_hours) : null,
          pay_frequency: form.pay_frequency || null,
          pension_scheme: form.pension_scheme || null,
          pension_start_date: form.pension_start_date || null,
          vacation_days_total: form.vacation_days_total ? parseInt(form.vacation_days_total) : null,
          vacation_days_used: form.vacation_days_used ? parseInt(form.vacation_days_used) : null,
          vacation_money_percentage: form.vacation_money_percentage ? parseFloat(form.vacation_money_percentage) : null,
          senior_days: form.senior_days ? parseInt(form.senior_days) : null,
          insurance_type: form.insurance_type || null,
          insurance_notes: form.insurance_notes || null,
        }).eq('id', employment.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidate', candidateId] });
      setEditing(false);
      toast.success('Dienstverband bijgewerkt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const set = (k: string, v: string) => setForm((f: any) => ({ ...f, [k]: v }));

  const vacationBalance = (employment?.vacation_days_total ?? 0) - (employment?.vacation_days_used ?? 0);

  if (editing) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h3 className="font-medium">Dienstverband bewerken</h3>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}><X className="h-4 w-4" /></Button>
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}><Check className="h-4 w-4 mr-1" />Opslaan</Button>
          </div>
        </div>
        <div className="bg-card rounded-lg border p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div><Label>Medewerkernummer</Label><Input value={form.employee_number} onChange={e => set('employee_number', e.target.value)} /></div>
            <div><Label>Startdatum *</Label><Input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} /></div>
            <div><Label>Einddatum</Label><Input type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} /></div>
            <div><Label>Reden uitdiensttreding</Label>
              <Select value={form.end_reason} onValueChange={v => set('end_reason', v)}>
                <SelectTrigger><SelectValue placeholder="Selecteer..." /></SelectTrigger>
                <SelectContent>{endReasonOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Contracttype</Label>
              <Select value={form.contract_type} onValueChange={v => set('contract_type', v)}>
                <SelectTrigger><SelectValue placeholder="Selecteer..." /></SelectTrigger>
                <SelectContent>
                  {Object.entries(contractLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Contracturen/week</Label><Input type="number" value={form.contract_hours} onChange={e => set('contract_hours', e.target.value)} /></div>
            <div><Label>Verloning</Label>
              <Select value={form.pay_frequency} onValueChange={v => set('pay_frequency', v)}>
                <SelectTrigger><SelectValue placeholder="Selecteer..." /></SelectTrigger>
                <SelectContent>
                  {Object.entries(payFreqLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Pensioenregeling</Label><Input value={form.pension_scheme} onChange={e => set('pension_scheme', e.target.value)} /></div>
            <div><Label>Pensioen startdatum</Label><Input type="date" value={form.pension_start_date} onChange={e => set('pension_start_date', e.target.value)} /></div>
            <div><Label>Vakantiedagen totaal</Label><Input type="number" value={form.vacation_days_total} onChange={e => set('vacation_days_total', e.target.value)} /></div>
            <div><Label>Vakantiedagen opgenomen</Label><Input type="number" value={form.vacation_days_used} onChange={e => set('vacation_days_used', e.target.value)} /></div>
            <div><Label>Vakantiegeld %</Label><Input type="number" step="0.01" value={form.vacation_money_percentage} onChange={e => set('vacation_money_percentage', e.target.value)} /></div>
            <div><Label>Seniorendagen</Label><Input type="number" value={form.senior_days} onChange={e => set('senior_days', e.target.value)} /></div>
            <div><Label>Verzekeringsvorm</Label><Input value={form.insurance_type} onChange={e => set('insurance_type', e.target.value)} /></div>
            <div className="sm:col-span-2"><Label>Verzekering notities</Label><Input value={form.insurance_notes} onChange={e => set('insurance_notes', e.target.value)} /></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Dienstverband</h3>
        <Button size="sm" variant="ghost" onClick={startEdit}><Pencil className="h-3.5 w-3.5" /></Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-card rounded-lg border p-6 space-y-4">
          <h4 className="text-sm font-medium text-muted-foreground">Dienstverband</h4>
          <Field label="Medewerkernummer" value={candidate?.employee_number} />
          <Field label="Status">
            <Badge variant="secondary" className={`mt-0.5 ${statusBadge[candidate?.employee_status] ?? ''}`}>
              {statusLabel[candidate?.employee_status] ?? candidate?.employee_status}
            </Badge>
          </Field>
          <Field label="Startdatum" value={formatDate(employment?.start_date)} />
          <Field label="Einddatum" value={formatDate(employment?.end_date)} />
          {employment?.end_reason && <Field label="Reden uitdiensttreding" value={endReasonOptions.find(o => o.value === employment.end_reason)?.label ?? employment.end_reason} />}
          <Field label="Contracttype" value={contractLabels[employment?.contract_type] ?? employment?.contract_type} />
          <Field label="Contracturen" value={employment?.contract_hours != null ? `${employment.contract_hours} uur/week` : null} />
          <Field label="Verloning" value={payFreqLabels[employment?.pay_frequency] ?? employment?.pay_frequency} />
        </div>

        <div className="bg-card rounded-lg border p-6 space-y-4">
          <h4 className="text-sm font-medium text-muted-foreground">Pensioen & verlof</h4>
          <Field label="Pensioenregeling" value={employment?.pension_scheme} />
          <Field label="Pensioen startdatum" value={formatDate(employment?.pension_start_date)} />
          <div className="grid grid-cols-3 gap-4">
            <Field label="Vakantiedagen totaal" value={employment?.vacation_days_total?.toString()} />
            <Field label="Opgenomen" value={employment?.vacation_days_used?.toString()} />
            <Field label="Saldo">
              <p className={`text-sm font-medium mt-0.5 ${vacationBalance < 0 ? 'text-destructive' : 'text-stat-green'}`}>{vacationBalance} dagen</p>
            </Field>
          </div>
          <Field label="Vakantiegeld" value={employment?.vacation_money_percentage != null ? `${employment.vacation_money_percentage}%` : null} />
          <Field label="Seniorendagen" value={employment?.senior_days?.toString()} />
          <Field label="Verzekeringsvorm" value={employment?.insurance_type} />
          {employment?.insurance_notes && <Field label="Verzekering notities" value={employment.insurance_notes} />}
        </div>
      </div>
    </div>
  );
};

export default EmployeeEmploymentTab;
