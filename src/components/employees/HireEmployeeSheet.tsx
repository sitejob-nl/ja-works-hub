import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';

const complianceBadge: Record<string, string> = {
  compleet: 'bg-stat-green/10 text-stat-green border-0',
  incompleet: 'bg-yellow-100 text-yellow-700 border-0',
  verlopen: 'bg-red-100 text-red-600 border-0',
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const HireEmployeeSheet = ({ open, onOpenChange }: Props) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState<any>(null);
  const [form, setForm] = useState({
    employee_number: '',
    start_date: '',
    contract_type: '',
    contract_hours: '',
    notes: '',
  });

  const { data: candidates = [] } = useQuery({
    queryKey: ['hire-candidates', candidateSearch],
    queryFn: async () => {
      let query = supabase.from('candidates')
        .select('id, first_name, last_name, phone, compliance_status, status')
        .in('status', ['beschikbaar', 'nieuw'] as any)
        .order('first_name');
      if (candidateSearch) {
        query = query.or(`first_name.ilike.%${candidateSearch}%,last_name.ilike.%${candidateSearch}%`);
      }
      const { data, error } = await query.limit(20);
      if (error) throw error;
      return data;
    },
    enabled: open && step === 1,
  });

  const hire = useMutation({
    mutationFn: async () => {
      const { data: emp, error } = await supabase.from('employees').insert({
        organization_id: orgId,
        candidate_id: selectedCandidate.id,
        employee_number: form.employee_number || null,
        start_date: form.start_date,
        contract_type: form.contract_type || null,
        contract_hours: form.contract_hours ? Number(form.contract_hours) : null,
        notes: form.notes || null,
        status: 'onboarding' as const,
      }).select('id').single();
      if (error) throw error;

      const { error: updateErr } = await supabase.from('candidates')
        .update({ status: 'geplaatst' as const })
        .eq('id', selectedCandidate.id);
      if (updateErr) throw updateErr;

      // Generate onboarding token
      const { data: tokenData } = await supabase.from('onboarding_tokens').insert({
        employee_id: emp.id,
        organization_id: orgId,
      } as any).select('token').single();

      return { employeeId: emp.id, token: tokenData?.token };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['candidates'] });
      logAudit({
        action: 'create',
        tableName: 'employees',
        recordId: result?.employeeId ?? selectedCandidate.id,
        newValues: { ...form, candidate: `${selectedCandidate.first_name} ${selectedCandidate.last_name}` },
      });

      if (result?.token) {
        const link = `${window.location.origin}/onboarding/${result.token}`;
        navigator.clipboard.writeText(link).then(() => {
          toast.success('Medewerker aangemaakt! Onboarding link gekopieerd naar klembord.');
        }).catch(() => {
          toast.success(`Medewerker aangemaakt! Onboarding link: ${link}`);
        });
      } else {
        toast.success('Medewerker aangemaakt');
      }
      resetAndClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const resetAndClose = () => {
    setStep(1);
    setSelectedCandidate(null);
    setCandidateSearch('');
    setForm({ employee_number: '', start_date: '', contract_type: '', contract_hours: '', notes: '' });
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) resetAndClose(); else onOpenChange(v); }}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{step === 1 ? 'Selecteer kandidaat' : 'Dienstverband gegevens'}</SheetTitle>
        </SheetHeader>

        {step === 1 && (
          <div className="mt-6 space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Zoek kandidaat..." value={candidateSearch} onChange={(e) => setCandidateSearch(e.target.value)} className="pl-9" />
            </div>
            {candidates.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">Geen beschikbare kandidaten gevonden</p>
            )}
            <div className="space-y-2">
              {candidates.map((c: any) => (
                <button
                  key={c.id}
                  onClick={() => { setSelectedCandidate(c); setStep(2); }}
                  className="w-full text-left p-3 rounded-lg border hover:bg-muted/50 transition-colors flex items-center justify-between"
                >
                  <div>
                    <p className="text-sm font-medium">{c.first_name} {c.last_name}</p>
                    <p className="text-xs text-muted-foreground">{c.phone ?? '—'}</p>
                  </div>
                  <Badge variant="secondary" className={`text-xs ${complianceBadge[c.compliance_status] ?? ''}`}>{c.compliance_status}</Badge>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && selectedCandidate && (
          <div className="mt-6 space-y-4">
            <div className="p-3 rounded-lg bg-muted/50 border flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{selectedCandidate.first_name} {selectedCandidate.last_name}</p>
              </div>
              <Button variant="link" size="sm" onClick={() => setStep(1)} className="text-xs">Wijzig</Button>
            </div>

            <div><Label>Medewerkernummer</Label><Input value={form.employee_number} onChange={(e) => setForm(f => ({ ...f, employee_number: e.target.value }))} /></div>
            <div><Label>Startdatum *</Label><Input type="date" value={form.start_date} onChange={(e) => setForm(f => ({ ...f, start_date: e.target.value }))} /></div>
            <div>
              <Label>Contracttype</Label>
              <Select value={form.contract_type} onValueChange={(v) => setForm(f => ({ ...f, contract_type: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecteer..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bepaalde_tijd">Bepaalde tijd</SelectItem>
                  <SelectItem value="onbepaalde_tijd">Onbepaalde tijd</SelectItem>
                  <SelectItem value="oproep">Oproep</SelectItem>
                  <SelectItem value="payroll">Payroll</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Contracturen</Label><Input type="number" value={form.contract_hours} onChange={(e) => setForm(f => ({ ...f, contract_hours: e.target.value }))} /></div>
            <div><Label>Notities</Label><Textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} /></div>

            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={resetAndClose}>Annuleren</Button>
              <Button onClick={() => hire.mutate()} disabled={!form.start_date || hire.isPending}>
                {hire.isPending ? 'Opslaan...' : 'In dienst nemen'}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default HireEmployeeSheet;
