import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Link } from 'react-router-dom';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Plus, Check, X, Search } from 'lucide-react';
import { formatDate, formatEUR } from '@/lib/format';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';

const ResidentsTab = ({ property }: { property: any }) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [assigning, setAssigning] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [empSearch, setEmpSearch] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [selectedUnit, setSelectedUnit] = useState<any>(null);
  const [form, setForm] = useState({ check_in_date: '', monthly_deduction: '', deposit_amount: '' });

  // Get all assignments for all units in this property
  const units = property.units ?? [];
  const allAssignments = units.flatMap((u: any) =>
    (u.housing_assignments ?? []).map((a: any) => ({ ...a, unitName: u.name }))
  );
  const activeAssignments = allAssignments.filter((a: any) => a.status === 'ingecheckt' || a.status === 'gereserveerd');

  // Query employees without active housing
  const { data: availableEmployees = [] } = useQuery({
    queryKey: ['available-employees-housing', empSearch],
    queryFn: async () => {
      const { data: activeAssigns } = await supabase.from('housing_assignments')
        .select('employee_id')
        .eq('status', 'ingecheckt');
      const occupiedIds = (activeAssigns ?? []).map((a: any) => a.employee_id);

      let query = supabase.from('employees')
        .select('id, employee_number, candidates!employees_candidate_id_fkey(first_name, last_name)')
        .in('status', ['actief', 'onboarding'] as any)
        .limit(20);

      const { data, error } = await query;
      if (error) throw error;
      let results = (data ?? []).filter((e: any) => !occupiedIds.includes(e.id));
      if (empSearch) {
        const s = empSearch.toLowerCase();
        results = results.filter((e: any) => {
          const c = e.candidates;
          return `${c?.first_name} ${c?.last_name}`.toLowerCase().includes(s);
        });
      }
      return results;
    },
    enabled: assigning && step === 1,
  });

  // Available units
  const availableUnits = units.filter((u: any) => {
    const occ = (u.housing_assignments ?? []).filter((a: any) => a.status === 'ingecheckt').length;
    return occ < (u.capacity ?? 0) && u.status === 'beschikbaar';
  });

  const assign = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('housing_assignments').insert({
        organization_id: orgId,
        unit_id: selectedUnit.id,
        employee_id: selectedEmployee.id,
        status: 'gereserveerd' as const,
        check_in_date: form.check_in_date,
        monthly_deduction: form.monthly_deduction ? Number(form.monthly_deduction) : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['property', property.id] });
      toast.success('Bewoner toegewezen');
      resetAssign();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ assignmentId, status, checkOut }: { assignmentId: string; status: string; checkOut?: boolean }) => {
      const update: any = { status };
      if (checkOut) update.check_out_date = new Date().toISOString().split('T')[0];
      const { error } = await supabase.from('housing_assignments').update(update).eq('id', assignmentId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['property', property.id] });
      toast.success('Status bijgewerkt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const resetAssign = () => {
    setAssigning(false);
    setStep(1);
    setSelectedEmployee(null);
    setSelectedUnit(null);
    setEmpSearch('');
    setForm({ check_in_date: '', monthly_deduction: '', deposit_amount: '' });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Bewoners</h3>
        <Button size="sm" variant="outline" onClick={() => setAssigning(true)} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> Bewoner toewijzen
        </Button>
      </div>

      <Sheet open={assigning} onOpenChange={(v) => { if (!v) resetAssign(); else setAssigning(v); }}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {step === 1 ? 'Selecteer medewerker' : step === 2 ? 'Selecteer kamer' : 'Details invullen'}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            {step === 1 && (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Zoek medewerker..." value={empSearch} onChange={(e) => setEmpSearch(e.target.value)} className="pl-9" />
                </div>
                {availableEmployees.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">Geen beschikbare medewerkers</p>}
                <div className="space-y-2">
                  {availableEmployees.map((e: any) => (
                    <button key={e.id} onClick={() => { setSelectedEmployee(e); setStep(2); }}
                      className="w-full text-left p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                      <p className="text-sm font-medium">{e.candidates?.first_name} {e.candidates?.last_name}</p>
                      {e.employee_number && <p className="text-xs text-muted-foreground">#{e.employee_number}</p>}
                    </button>
                  ))}
                </div>
              </>
            )}
            {step === 2 && (
              <>
                <div className="p-3 rounded-lg bg-muted/50 border flex justify-between items-center">
                  <p className="text-sm font-medium">{selectedEmployee?.candidates?.first_name} {selectedEmployee?.candidates?.last_name}</p>
                  <Button variant="link" size="sm" onClick={() => setStep(1)} className="text-xs">Wijzig</Button>
                </div>
                {availableUnits.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">Geen kamers met beschikbare capaciteit</p>}
                <div className="space-y-2">
                  {availableUnits.map((u: any) => {
                    const occ = (u.housing_assignments ?? []).filter((a: any) => a.status === 'ingecheckt').length;
                    return (
                      <button key={u.id} onClick={() => { setSelectedUnit(u); setStep(3); }}
                        className="w-full text-left p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                        <p className="text-sm font-medium">{u.name}</p>
                        <p className="text-xs text-muted-foreground">{occ}/{u.capacity} bezet</p>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {step === 3 && (
              <>
                <div className="p-3 rounded-lg bg-muted/50 border space-y-1">
                  <p className="text-sm"><span className="text-muted-foreground">Medewerker:</span> {selectedEmployee?.candidates?.first_name} {selectedEmployee?.candidates?.last_name}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Kamer:</span> {selectedUnit?.name}</p>
                </div>
                <div><Label>Check-in datum *</Label><Input type="date" value={form.check_in_date} onChange={(e) => setForm(f => ({ ...f, check_in_date: e.target.value }))} /></div>
                <div><Label>Maandelijkse inhouding (€)</Label><Input type="number" value={form.monthly_deduction} onChange={(e) => setForm(f => ({ ...f, monthly_deduction: e.target.value }))} /></div>
                <div className="flex justify-end gap-3 pt-4">
                  <Button variant="ghost" onClick={resetAssign}>Annuleren</Button>
                  <Button onClick={() => assign.mutate()} disabled={!form.check_in_date || assign.isPending}>
                    {assign.isPending ? 'Toewijzen...' : 'Toewijzen'}
                  </Button>
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {activeAssignments.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">Geen bewoners</p>
      ) : (
        <div className="bg-card rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Naam</TableHead>
                <TableHead>Kamer</TableHead>
                <TableHead>Check-in</TableHead>
                <TableHead>Inhouding</TableHead>
                <TableHead>Borg</TableHead>
                <TableHead>Huur tot</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeAssignments.map((a: any) => {
                const rentOverdue = a.rent_paid_until && new Date(a.rent_paid_until) < new Date();
                return (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Link to={`/medewerkers/${a.employees?.id}`} className="font-medium text-foreground hover:text-primary transition-colors">
                        {a.employees?.candidates?.first_name} {a.employees?.candidates?.last_name}
                      </Link>
                    </TableCell>
                    <TableCell>{a.unitName}</TableCell>
                    <TableCell>{formatDate(a.check_in_date)}</TableCell>
                    <TableCell>{formatEUR(a.monthly_deduction)}</TableCell>
                    <TableCell>{a.deposit_paid ? <Check className="h-4 w-4 text-stat-green" /> : <X className="h-4 w-4 text-red-500" />}</TableCell>
                    <TableCell className={rentOverdue ? 'text-red-600 font-medium' : ''}>{formatDate(a.rent_paid_until)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={`text-xs ${a.status === 'ingecheckt' ? 'bg-stat-green/10 text-stat-green border-0' : 'bg-blue-100 text-blue-700 border-0'}`}>
                        {a.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {a.status === 'gereserveerd' && (
                          <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ assignmentId: a.id, status: 'ingecheckt' })}>
                            Inchecken
                          </Button>
                        )}
                        {a.status === 'ingecheckt' && (
                          <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ assignmentId: a.id, status: 'uitgecheckt', checkOut: true })}>
                            Uitchecken
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default ResidentsTab;
