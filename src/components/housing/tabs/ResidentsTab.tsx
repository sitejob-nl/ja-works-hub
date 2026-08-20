import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { unwrap, unwrapDeleted, unwrapList } from '@/lib/db';
import { toFriendlyError } from '@/lib/errorMessages';
import { qk } from '@/lib/query-keys';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Link } from 'react-router-dom';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Check, X, Search, MoreHorizontal, Pencil, Trash2, ArrowRightLeft } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDate, formatEUR } from '@/lib/format';
import { toast } from 'sonner';
import { GuardedSheet, useDirtyForm } from '@/components/shared/UnsavedCloseGuard';
import { logAudit } from '@/lib/audit';
import { resolveEmployeeId } from '@/lib/assignments';
import { sendRegulationsForAssignment } from '@/lib/regulation-dispatch';
import { useAuth } from '@/contexts/AuthContext';
import {
  fetchFacilityHousingSnapshot,
  fetchFacilityWorkerDirectory,
  isFacilityRole,
  saveFacilityOperationalEntity,
} from '@/lib/facility';

const WEEKS_PER_MONTH = 4.33;

const ACTIVE_HOUSING_STATUSES = ['ingecheckt', 'gereserveerd'] as const;
const EXCLUDED_CANDIDATE_STATUSES = ['inactief', 'afgewezen', 'uitgeschreven', 'niet_beschikbaar'] as const;

const isAssignableHousingCandidate = (candidate: any) => {
  if (candidate.employee_status === 'uit_dienst') return false;
  return !EXCLUDED_CANDIDATE_STATUSES.includes(candidate.status);
};

const InternalResidentsTab = ({ property }: { property: any }) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [assigning, setAssigning] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [empSearch, setEmpSearch] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [selectedUnit, setSelectedUnit] = useState<any>(null);
  const [form, setForm, formDirty] = useDirtyForm({ check_in_date: '', deduction_amount: '', payment_frequency: 'wekelijks' as 'wekelijks' | 'maandelijks' });

  // Edit assignment state
  const [editingAssignment, setEditingAssignment] = useState<any | null>(null);
  const [editForm, setEditForm, editFormDirty] = useDirtyForm({
    check_in_date: '',
    deduction_amount: '',
    payment_frequency: 'wekelijks' as 'wekelijks' | 'maandelijks',
    // Zonder invoerveld: "borgbedrag" gaat over het pand en staat op de Contracten-tab.
    // Blijft wel meelopen zodat een eerder ingevuld bedrag bij het bewerken van een
    // toewijzing niet stilletjes op null wordt gezet.
    deposit_amount: '',
  });

  // Move assignment state
  const [movingAssignment, setMovingAssignment] = useState<any | null>(null);
  const [moveStep, setMoveStep] = useState<1 | 2>(1);
  const [moveTargetProperty, setMoveTargetProperty] = useState<string>('');
  const [moveTargetUnit, setMoveTargetUnit] = useState<string>('');

  // Delete state
  const [assignmentToDelete, setAssignmentToDelete] = useState<any | null>(null);

  // Get all assignments for all units in this property
  const units = property.units ?? [];
  const allAssignments = units.flatMap((u: any) =>
    (u.housing_assignments ?? []).map((a: any) => ({ ...a, unitName: u.name }))
  );
  const activeAssignments = allAssignments.filter((a: any) => a.status === 'ingecheckt' || a.status === 'gereserveerd');

  // Query workers from candidates (merged employee model) without active housing.
  const { data: availableEmployees = [] } = useQuery({
    queryKey: qk.housing.availableEmployees(orgId, empSearch),
    queryFn: async () => {
      const activeAssigns = await unwrapList<any>(supabase.from('housing_assignments')
        .select('candidate_id')
        .eq('organization_id', orgId!)
        .in('status', ACTIVE_HOUSING_STATUSES as any));
      const occupiedIds = activeAssigns.map((a: any) => a.candidate_id).filter(Boolean);

      let query = supabase.from('candidates')
        .select('id, first_name, last_name, employee_number, employee_status, status, email, phone')
        .eq('organization_id', orgId!)
        .order('first_name')
        .order('last_name')
        .limit(50);

      const search = empSearch.trim();
      if (search) {
        const term = search.replace(/[%,]/g, ' ');
        query = query.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,employee_number.ilike.%${term}%`);
      }

      const data = await unwrapList<any>(query);
      return data.filter((e: any) => !occupiedIds.includes(e.id) && isAssignableHousingCandidate(e));
    },
    enabled: assigning && step === 1 && !!orgId,
  });

  // Available units
  const availableUnits = units.filter((u: any) => {
    const occ = (u.housing_assignments ?? []).filter((a: any) => ACTIVE_HOUSING_STATUSES.includes(a.status)).length;
    return occ < (u.capacity ?? 0) && u.status === 'beschikbaar';
  });

  const assign = useMutation({
    mutationFn: async () => {
      const deductionNum = form.deduction_amount ? Number(form.deduction_amount) : null;
      const employeeId = await resolveEmployeeId(selectedEmployee, orgId!, form.check_in_date);
      const assignment = await unwrap(supabase.from('housing_assignments').insert({
        organization_id: orgId,
        unit_id: selectedUnit.id,
        employee_id: employeeId,
        candidate_id: selectedEmployee.id,
        status: 'gereserveerd' as const,
        check_in_date: form.check_in_date,
        deduction_amount: deductionNum,
        payment_frequency: form.payment_frequency,
        monthly_deduction: form.payment_frequency === 'maandelijks' ? deductionNum : (deductionNum ? Math.round(deductionNum * 4.33 * 100) / 100 : null),
        created_by: user?.id ?? null,
      }).select('id').single());
      // Huisregels meesturen (instelbaar per reglement). Non-blocking.
      await sendRegulationsForAssignment({
        candidateId: selectedEmployee.id,
        category: 'huisvesting',
        contextId: (assignment as any)?.id,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.housing.property(property.id) });
      logAudit({
        action: 'create',
        tableName: 'housing_assignments',
        recordId: selectedEmployee?.id ?? 'new',
        newValues: { unit: selectedUnit?.name, employee: `${selectedEmployee?.first_name} ${selectedEmployee?.last_name}`, ...form },
      });
      toast.success('Bewoner toegewezen');
      resetAssign();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ assignmentId, status, checkOut }: { assignmentId: string; status: string; checkOut?: boolean }) => {
      const update: any = { status };
      if (checkOut) update.check_out_date = new Date().toISOString().split('T')[0];
      await unwrap(supabase.from('housing_assignments').update(update).eq('id', assignmentId));
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: qk.housing.property(property.id) });
      logAudit({
        action: 'status_change',
        tableName: 'housing_assignments',
        recordId: vars.assignmentId,
        newValues: { status: vars.status },
      });
      toast.success('Status bijgewerkt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const editAssignment = useMutation({
    mutationFn: async () => {
      if (!editingAssignment) throw new Error('Geen toewijzing geselecteerd');
      const deductionNum = editForm.deduction_amount ? Number(editForm.deduction_amount) : null;
      const monthly = editForm.payment_frequency === 'maandelijks'
        ? deductionNum
        : (deductionNum != null ? Math.round(deductionNum * WEEKS_PER_MONTH * 100) / 100 : null);
      const update = {
        check_in_date: editForm.check_in_date,
        deduction_amount: deductionNum,
        payment_frequency: editForm.payment_frequency,
        monthly_deduction: monthly,
        deposit_amount: editForm.deposit_amount.trim() === '' ? null : Number(editForm.deposit_amount),
      };
      await unwrap(supabase.from('housing_assignments').update(update).eq('id', editingAssignment.id));
      return update;
    },
    onSuccess: (update) => {
      qc.invalidateQueries({ queryKey: qk.housing.property(property.id) });
      logAudit({
        action: 'update',
        tableName: 'housing_assignments',
        recordId: editingAssignment?.id ?? '',
        newValues: update as any,
      });
      toast.success('Toewijzing bijgewerkt');
      setEditingAssignment(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteAssignment = useMutation({
    mutationFn: async (assignment: any) => {
      if (assignment.status === 'ingecheckt') {
        throw new Error('Bewoner is ingecheckt — eerst uitchecken voordat de toewijzing verwijderd kan worden.');
      }
      // Rowcount-check: een door RLS geweigerde delete geeft geen error, alleen 0 rijen.
      await unwrapDeleted(
        supabase.from('housing_assignments').delete().eq('id', assignment.id),
        'Deze bewonerstoewijzing kon niet worden verwijderd — je hebt hiervoor mogelijk beheerdersrechten nodig.',
      );
      return assignment;
    },
    onSuccess: (assignment) => {
      qc.invalidateQueries({ queryKey: qk.housing.property(property.id) });
      logAudit({
        action: 'delete',
        tableName: 'housing_assignments',
        recordId: assignment.id,
        oldValues: { status: assignment.status, candidate_id: assignment.candidate_id, unit_id: assignment.unit_id },
      });
      toast.success('Toewijzing verwijderd');
      setAssignmentToDelete(null);
    },
    onError: (e: any) => {
      toast.error(toFriendlyError(e, 'Verwijderen mislukt'));
      setAssignmentToDelete(null);
    },
  });

  const moveAssignment = useMutation({
    mutationFn: async () => {
      if (!movingAssignment || !moveTargetUnit) throw new Error('Geen kamer geselecteerd');
      // Pre-check: target unit must have remaining capacity
      const targetUnit = await unwrap<any>(supabase
        .from('units')
        .select('id, name, capacity, status, property_id, housing_assignments!housing_assignments_unit_id_fkey(id, status)')
        .eq('id', moveTargetUnit)
        .single());
      if (targetUnit.status !== 'beschikbaar') {
        throw new Error(`Kamer "${targetUnit.name}" is niet beschikbaar (status: ${targetUnit.status}).`);
      }
      const occupied = (targetUnit.housing_assignments ?? []).filter((a: any) => ACTIVE_HOUSING_STATUSES.includes(a.status) && a.id !== movingAssignment.id).length;
      if (occupied >= (targetUnit.capacity ?? 0)) {
        throw new Error(`Kamer "${targetUnit.name}" is vol (${occupied}/${targetUnit.capacity}).`);
      }
      const oldUnitId = movingAssignment.unit_id;
      await unwrap(supabase
        .from('housing_assignments')
        .update({ unit_id: moveTargetUnit })
        .eq('id', movingAssignment.id));
      return { newUnitName: targetUnit.name, oldUnitId };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: qk.housing.property(property.id) });
      qc.invalidateQueries({ queryKey: ['properties'] });
      logAudit({
        action: 'update',
        tableName: 'housing_assignments',
        recordId: movingAssignment?.id ?? '',
        oldValues: { unit_id: res.oldUnitId },
        newValues: { unit_id: moveTargetUnit },
        reason: 'Bewoner verplaatst',
      });
      toast.success(`Bewoner verplaatst naar kamer ${res.newUnitName}`);
      setMovingAssignment(null);
      setMoveStep(1);
      setMoveTargetProperty('');
      setMoveTargetUnit('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Properties for move target (all org's panden + their units)
  const { data: moveTargets = [] } = useQuery({
    queryKey: qk.housing.moveTargets(orgId),
    queryFn: async () => {
      return unwrapList<any>(supabase
        .from('properties')
        .select(`
          id, name, address_street, address_city,
          units!units_property_id_fkey(
            id, name, capacity, status,
            housing_assignments!housing_assignments_unit_id_fkey(id, status)
          )
        `)
        .eq('organization_id', orgId!)
        .eq('is_active', true)
        .order('address_city'));
    },
    enabled: !!movingAssignment && !!orgId,
  });

  const resetAssign = () => {
    setAssigning(false);
    setStep(1);
    setSelectedEmployee(null);
    setSelectedUnit(null);
    setEmpSearch('');
    setForm({ check_in_date: '', deduction_amount: '', payment_frequency: 'wekelijks' });
  };

  const openEdit = (a: any) => {
    setEditingAssignment(a);
    setEditForm({
      check_in_date: a.check_in_date ?? '',
      deduction_amount: a.deduction_amount != null ? String(a.deduction_amount) : '',
      payment_frequency: (a.payment_frequency ?? 'wekelijks') as 'wekelijks' | 'maandelijks',
      deposit_amount: a.deposit_amount != null ? String(a.deposit_amount) : '',
    });
  };

  const openMove = (a: any) => {
    setMovingAssignment(a);
    setMoveStep(1);
    setMoveTargetProperty(property.id);
    setMoveTargetUnit('');
  };

  const closeMove = () => {
    setMovingAssignment(null);
    setMoveStep(1);
    setMoveTargetProperty('');
    setMoveTargetUnit('');
  };

  // Available units for the chosen target property (excl. current unit unless same property)
  const moveTargetUnits = (() => {
    if (!moveTargetProperty || !movingAssignment) return [];
    const targetProp = moveTargets.find((p: any) => p.id === moveTargetProperty);
    if (!targetProp) return [];
    return (targetProp.units ?? []).filter((u: any) => {
      if (u.id === movingAssignment.unit_id) return false;
      if (u.status !== 'beschikbaar') return false;
      const occupied = (u.housing_assignments ?? []).filter((a: any) => ACTIVE_HOUSING_STATUSES.includes(a.status)).length;
      return occupied < (u.capacity ?? 0);
    });
  })();

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Bewoners</h3>
        <Button size="sm" variant="outline" onClick={() => setAssigning(true)} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> Bewoner toewijzen
        </Button>
      </div>

      <GuardedSheet open={assigning} dirty={formDirty} onOpenChange={(v) => { if (!v) resetAssign(); else setAssigning(v); }}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {step === 1 ? 'Selecteer kandidaat/medewerker' : step === 2 ? 'Selecteer kamer' : 'Details invullen'}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            {step === 1 && (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Zoek kandidaat of medewerker..." value={empSearch} onChange={(e) => setEmpSearch(e.target.value)} className="pl-9" />
                </div>
                {availableEmployees.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">Geen beschikbare kandidaten/medewerkers</p>}
                <div className="space-y-2">
                  {availableEmployees.map((e: any) => (
                    <button key={e.id} onClick={() => { setSelectedEmployee(e); setStep(2); }}
                      className="w-full text-left p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                      <p className="text-sm font-medium">{e.first_name} {e.last_name}</p>
                      {e.employee_number && <p className="text-xs text-muted-foreground">#{e.employee_number}</p>}
                    </button>
                  ))}
                </div>
              </>
            )}
            {step === 2 && (
              <>
                <div className="p-3 rounded-lg bg-muted/50 border flex justify-between items-center">
                  <p className="text-sm font-medium">{selectedEmployee?.first_name} {selectedEmployee?.last_name}</p>
                  <Button variant="link" size="sm" onClick={() => setStep(1)} className="text-xs">Wijzig</Button>
                </div>
                {availableUnits.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">Geen kamers met beschikbare capaciteit</p>}
                <div className="space-y-2">
                  {availableUnits.map((u: any) => {
                    const occ = (u.housing_assignments ?? []).filter((a: any) => ACTIVE_HOUSING_STATUSES.includes(a.status)).length;
                    return (
                      <button key={u.id} onClick={() => {
                          setSelectedUnit(u);
                          setForm(f => ({ ...f, deduction_amount: u.weekly_cost ? String(u.weekly_cost) : '', payment_frequency: 'wekelijks' }));
                          setStep(3);
                        }}
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
                  <p className="text-sm"><span className="text-muted-foreground">Kandidaat/medewerker:</span> {selectedEmployee?.first_name} {selectedEmployee?.last_name}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Kamer:</span> {selectedUnit?.name}</p>
                </div>
                <div><Label>Check-in datum *</Label><Input type="date" value={form.check_in_date} onChange={(e) => setForm(f => ({ ...f, check_in_date: e.target.value }))} /></div>
                <div>
                  <Label>Betalingsfrequentie</Label>
                  <Select value={form.payment_frequency} onValueChange={(v: 'wekelijks' | 'maandelijks') => {
                    setForm(f => ({
                      ...f,
                      payment_frequency: v,
                      deduction_amount: v === 'wekelijks' && selectedUnit?.weekly_cost
                        ? String(selectedUnit.weekly_cost)
                        : v === 'maandelijks' && selectedUnit?.weekly_cost
                          ? String(Math.round(selectedUnit.weekly_cost * 4.33))
                          : f.deduction_amount,
                    }));
                  }}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="wekelijks">Wekelijks</SelectItem>
                      <SelectItem value="maandelijks">Maandelijks</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{form.payment_frequency === 'wekelijks' ? 'Wekelijkse' : 'Maandelijkse'} inhouding (€)</Label>
                  <Input type="number" value={form.deduction_amount} onChange={(e) => setForm(f => ({ ...f, deduction_amount: e.target.value }))} />
                </div>
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
      </GuardedSheet>

      {/* Edit assignment Sheet */}
      <GuardedSheet open={!!editingAssignment} dirty={editFormDirty} onOpenChange={(o) => { if (!o) setEditingAssignment(null); }}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>Toewijzing bewerken</SheetTitle></SheetHeader>
          {editingAssignment && (
            <div className="mt-6 space-y-4">
              <div className="p-3 rounded-lg bg-muted/50 border space-y-1">
                <p className="text-sm"><span className="text-muted-foreground">Kandidaat/medewerker:</span> {editingAssignment.candidates?.first_name} {editingAssignment.candidates?.last_name}</p>
                <p className="text-sm"><span className="text-muted-foreground">Kamer:</span> {editingAssignment.unitName}</p>
                <p className="text-xs text-muted-foreground">Voor wijzigen van kamer of pand: gebruik 'Verplaatsen'.</p>
              </div>
              <div>
                <Label>Check-in datum *</Label>
                <Input type="date" value={editForm.check_in_date} onChange={(e) => setEditForm(f => ({ ...f, check_in_date: e.target.value }))} />
              </div>
              <div>
                <Label>Betalingsfrequentie</Label>
                <Select
                  value={editForm.payment_frequency}
                  onValueChange={(v: 'wekelijks' | 'maandelijks') => setEditForm(f => ({ ...f, payment_frequency: v }))}
                >
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="wekelijks">Wekelijks</SelectItem>
                    <SelectItem value="maandelijks">Maandelijks</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{editForm.payment_frequency === 'wekelijks' ? 'Wekelijkse' : 'Maandelijkse'} inhouding (€)</Label>
                <Input type="number" value={editForm.deduction_amount} onChange={(e) => setEditForm(f => ({ ...f, deduction_amount: e.target.value }))} />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button variant="ghost" onClick={() => setEditingAssignment(null)}>Annuleren</Button>
                <Button onClick={() => editAssignment.mutate()} disabled={!editForm.check_in_date || editAssignment.isPending}>
                  {editAssignment.isPending ? 'Opslaan...' : 'Opslaan'}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </GuardedSheet>

      {/* Move assignment Sheet */}
      <Sheet open={!!movingAssignment} onOpenChange={(o) => { if (!o) closeMove(); }}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{moveStep === 1 ? 'Selecteer doelpand' : 'Selecteer kamer'}</SheetTitle>
          </SheetHeader>
          {movingAssignment && (
            <div className="mt-6 space-y-4">
              <div className="p-3 rounded-lg bg-muted/50 border space-y-1">
                <p className="text-sm"><span className="text-muted-foreground">Bewoner:</span> {movingAssignment.candidates?.first_name} {movingAssignment.candidates?.last_name}</p>
                <p className="text-sm"><span className="text-muted-foreground">Huidige kamer:</span> {movingAssignment.unitName}</p>
              </div>

              {moveStep === 1 && (
                <>
                  <p className="text-xs text-muted-foreground">Borg-status, inhouding en check-in datum blijven behouden.</p>
                  {moveTargets.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">Geen panden gevonden</p>
                  ) : (
                    <div className="space-y-2">
                      {moveTargets.map((p: any) => {
                        const totalCap = (p.units ?? []).reduce((s: number, u: any) => s + (u.capacity ?? 0), 0);
                        const occ = (p.units ?? []).reduce((s: number, u: any) =>
                          s + (u.housing_assignments ?? []).filter((a: any) => ACTIVE_HOUSING_STATUSES.includes(a.status)).length, 0);
                        const free = totalCap - occ;
                        const isCurrent = p.id === property.id;
                        return (
                          <button
                            key={p.id}
                            onClick={() => { setMoveTargetProperty(p.id); setMoveStep(2); }}
                            className="w-full text-left p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                          >
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="text-sm font-medium">{p.name || `${p.address_street}, ${p.address_city}`}</p>
                                <p className="text-xs text-muted-foreground">{p.address_street}, {p.address_city}</p>
                              </div>
                              <div className="text-right text-xs">
                                <p className={free > 0 ? 'text-stat-green font-medium' : 'text-muted-foreground'}>{free} vrij</p>
                                {isCurrent && <p className="text-muted-foreground italic">Huidig pand</p>}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {moveStep === 2 && (
                <>
                  <Button variant="link" size="sm" onClick={() => setMoveStep(1)} className="text-xs px-0 h-auto">← Ander pand</Button>
                  {moveTargetUnits.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">Geen kamers met beschikbare capaciteit in dit pand</p>
                  ) : (
                    <div className="space-y-2">
                      {moveTargetUnits.map((u: any) => {
                        const occ = (u.housing_assignments ?? []).filter((a: any) => ACTIVE_HOUSING_STATUSES.includes(a.status)).length;
                        return (
                          <button
                            key={u.id}
                            onClick={() => setMoveTargetUnit(u.id)}
                            className={`w-full text-left p-3 rounded-lg border transition-colors ${moveTargetUnit === u.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
                          >
                            <p className="text-sm font-medium">{u.name}</p>
                            <p className="text-xs text-muted-foreground">{occ}/{u.capacity} bezet</p>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex justify-end gap-3 pt-4">
                    <Button variant="ghost" onClick={closeMove}>Annuleren</Button>
                    <Button onClick={() => moveAssignment.mutate()} disabled={!moveTargetUnit || moveAssignment.isPending}>
                      {moveAssignment.isPending ? 'Verplaatsen...' : 'Verplaatsen'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Delete assignment confirm */}
      <AlertDialog open={!!assignmentToDelete} onOpenChange={(o) => { if (!o) setAssignmentToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Toewijzing verwijderen?</AlertDialogTitle>
            <AlertDialogDescription>
              {assignmentToDelete?.status === 'ingecheckt'
                ? <>Bewoner is <strong>ingecheckt</strong>. Eerst uitchecken, dan kun je de toewijzing verwijderen of laten staan als historie.</>
                : <>Dit verwijdert de toewijzing van {assignmentToDelete?.candidates?.first_name} {assignmentToDelete?.candidates?.last_name} aan kamer {assignmentToDelete?.unitName}. Deze actie kan niet ongedaan worden gemaakt.</>
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (assignmentToDelete) deleteAssignment.mutate(assignmentToDelete); }}
              disabled={deleteAssignment.isPending || assignmentToDelete?.status === 'ingecheckt'}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteAssignment.isPending ? 'Verwijderen...' : 'Verwijderen'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                      <Link to={`/medewerkers/${a.candidates?.id}`} className="font-medium text-foreground hover:text-stat-blue transition-colors">
                        {a.candidates?.first_name} {a.candidates?.last_name}
                      </Link>
                    </TableCell>
                    <TableCell>{a.unitName}</TableCell>
                    <TableCell>{formatDate(a.check_in_date)}</TableCell>
                    <TableCell>
                      {a.deduction_amount != null ? (
                        <span>{formatEUR(a.deduction_amount)}/{a.payment_frequency === 'wekelijks' ? 'week' : 'mnd'}</span>
                      ) : a.monthly_deduction != null ? (
                        <span>{formatEUR(a.monthly_deduction)}/mnd</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>{a.deposit_paid ? <Check className="h-4 w-4 text-stat-green" /> : <X className="h-4 w-4 text-red-500" />}</TableCell>
                    <TableCell className={rentOverdue ? 'text-red-600 font-medium' : ''}>{formatDate(a.rent_paid_until)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={`text-xs ${a.status === 'ingecheckt' ? 'bg-stat-green/10 text-stat-green border-0' : 'bg-blue-100 text-blue-700 border-0'}`}>
                        {a.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 items-center">
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
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(a)}>
                              <Pencil className="h-3.5 w-3.5 mr-2" /> Bewerken
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openMove(a)}>
                              <ArrowRightLeft className="h-3.5 w-3.5 mr-2" /> Verplaatsen
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => setAssignmentToDelete(a)}
                              className="text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" /> Verwijderen
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
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

const FacilityResidentsTab = ({ property }: { property: any }) => {
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [candidateId, setCandidateId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [checkInDate, setCheckInDate] = useState('');
  const [moving, setMoving] = useState<any | null>(null);
  const [targetUnitId, setTargetUnitId] = useState('');

  const { data: directory = [] } = useQuery({
    queryKey: ['facility-worker-directory'],
    queryFn: fetchFacilityWorkerDirectory,
  });
  const { data: snapshot, isLoading: snapshotLoading } = useQuery({
    queryKey: ['facility-housing-snapshot'],
    queryFn: () => fetchFacilityHousingSnapshot(),
  });

  const properties = snapshot?.properties ?? [property];
  const units = property.units ?? [];
  const allAssignments = units.flatMap((unit: any) =>
    (unit.housing_assignments ?? []).map((assignment: any) => ({ ...assignment, unitName: unit.name })),
  );
  const activeAssignments = allAssignments.filter((assignment: any) =>
    ACTIVE_HOUSING_STATUSES.includes(assignment.status),
  );
  const occupiedCandidateIds = new Set(
    properties.flatMap((item: any) => (item.units ?? []).flatMap((unit: any) =>
      (unit.housing_assignments ?? [])
        .filter((assignment: any) => ACTIVE_HOUSING_STATUSES.includes(assignment.status))
        .map((assignment: any) => assignment.candidate_id),
    )),
  );
  const availableWorkers = snapshot ? directory.filter((worker: any) =>
    worker.candidate_id
    && worker.employee_id
    && worker.employee_status !== 'uit_dienst'
    && worker.status !== 'uit_dienst'
    && !occupiedCandidateIds.has(worker.candidate_id),
  ) : [];
  const availableUnits = units.filter((unit: any) => {
    const occupied = (unit.housing_assignments ?? []).filter((assignment: any) =>
      ACTIVE_HOUSING_STATUSES.includes(assignment.status),
    ).length;
    return unit.status === 'beschikbaar' && occupied < (unit.capacity ?? 0);
  });
  const moveUnits = properties.flatMap((item: any) => (item.units ?? [])
    .filter((unit: any) => {
      if (unit.id === moving?.unit_id || unit.status !== 'beschikbaar') return false;
      const occupied = (unit.housing_assignments ?? []).filter((assignment: any) =>
        ACTIVE_HOUSING_STATUSES.includes(assignment.status) && assignment.id !== moving?.id,
      ).length;
      return occupied < (unit.capacity ?? 0);
    })
    .map((unit: any) => ({ ...unit, propertyLabel: item.name || item.address_street || 'Pand' })));

  const directoryByCandidate = new Map(directory.map((worker: any) => [worker.candidate_id, worker]));
  const directoryByEmployee = new Map(directory.map((worker: any) => [worker.employee_id, worker]));
  const workerFor = (assignment: any) =>
    directoryByCandidate.get(assignment.candidate_id) ?? directoryByEmployee.get(assignment.employee_id);
  const workerLabel = (worker: any) =>
    [worker?.first_name, worker?.last_name].filter(Boolean).join(' ') || 'Medewerker';

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['facility-housing-snapshot'] });
    qc.invalidateQueries({ queryKey: ['property', property.id, 'facility'] });
  };

  const assign = useMutation({
    mutationFn: async () => {
      const worker = directory.find((item: any) => item.candidate_id === candidateId);
      if (!worker || !unitId || !checkInDate) throw new Error('Selecteer een medewerker, kamer en datum.');
      return saveFacilityOperationalEntity('housing_assignment', {
        organization_id: property.organization_id,
        unit_id: unitId,
        candidate_id: worker.candidate_id,
        employee_id: worker.employee_id,
        status: 'gereserveerd',
        check_in_date: checkInDate,
      });
    },
    onSuccess: (assignmentId) => {
      invalidate();
      setFormOpen(false);
      setCandidateId('');
      setUnitId('');
      setCheckInDate('');
      toast.success('Bewoner toegewezen');
    },
    onError: (error: any) => toast.error(error.message ?? 'Toewijzen mislukt'),
  });

  const update = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Record<string, unknown> }) => {
      await saveFacilityOperationalEntity('housing_assignment', { id, ...values });
    },
    onSuccess: (_, variables) => {
      invalidate();
      toast.success('Toewijzing bijgewerkt');
    },
    onError: (error: any) => toast.error(error.message ?? 'Bijwerken mislukt'),
  });

  const move = useMutation({
    mutationFn: async () => {
      if (!moving || !targetUnitId) throw new Error('Selecteer een kamer.');
      return saveFacilityOperationalEntity('housing_assignment', { id: moving.id, unit_id: targetUnitId });
    },
    onSuccess: () => {
      invalidate();
      setMoving(null);
      setTargetUnitId('');
      toast.success('Bewoner verplaatst');
    },
    onError: (error: any) => toast.error(error.message ?? 'Verplaatsen mislukt'),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Bewoners</h3>
        <Button size="sm" variant="outline" onClick={() => setFormOpen(true)} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> Bewoner toewijzen
        </Button>
      </div>

      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>Bewoner toewijzen</SheetTitle></SheetHeader>
          <div className="mt-6 space-y-4">
            <div>
              <Label>Medewerker</Label>
              <Select value={candidateId} onValueChange={setCandidateId}>
                <SelectTrigger><SelectValue placeholder="Selecteer medewerker" /></SelectTrigger>
                <SelectContent>
                  {availableWorkers.map((worker: any) => (
                    <SelectItem key={worker.candidate_id} value={worker.candidate_id}>
                      {workerLabel(worker)}{worker.employee_number ? ` · #${worker.employee_number}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Kamer</Label>
              <Select value={unitId} onValueChange={setUnitId}>
                <SelectTrigger><SelectValue placeholder="Selecteer kamer" /></SelectTrigger>
                <SelectContent>
                  {availableUnits.map((unit: any) => (
                    <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Check-in datum</Label>
              <Input type="date" value={checkInDate} onChange={(event) => setCheckInDate(event.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">
              Financiële afspraken worden uitsluitend door backoffice of finance beheerd.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setFormOpen(false)}>Annuleren</Button>
              <Button onClick={() => assign.mutate()} disabled={snapshotLoading || !candidateId || !unitId || !checkInDate || assign.isPending}>
                {assign.isPending ? 'Toewijzen...' : 'Toewijzen'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={!!moving} onOpenChange={(open) => { if (!open) { setMoving(null); setTargetUnitId(''); } }}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>Bewoner verplaatsen</SheetTitle></SheetHeader>
          <div className="mt-6 space-y-4">
            <p className="text-sm text-muted-foreground">Kies een beschikbare kamer.</p>
            <Select value={targetUnitId} onValueChange={setTargetUnitId}>
              <SelectTrigger><SelectValue placeholder="Selecteer kamer" /></SelectTrigger>
              <SelectContent>
                {moveUnits.map((unit: any) => (
                  <SelectItem key={unit.id} value={unit.id}>{unit.propertyLabel} · {unit.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setMoving(null)}>Annuleren</Button>
              <Button onClick={() => move.mutate()} disabled={!targetUnitId || move.isPending}>
                {move.isPending ? 'Verplaatsen...' : 'Verplaatsen'}
              </Button>
            </div>
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
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actie</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeAssignments.map((assignment: any) => (
                <TableRow key={assignment.id}>
                  <TableCell className="font-medium">{workerLabel(workerFor(assignment))}</TableCell>
                  <TableCell>{assignment.unitName}</TableCell>
                  <TableCell>{formatDate(assignment.check_in_date)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={`text-xs ${assignment.status === 'ingecheckt' ? 'bg-stat-green/10 text-stat-green border-0' : 'bg-blue-100 text-blue-700 border-0'}`}>
                      {assignment.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {assignment.status === 'gereserveerd' && (
                        <Button size="sm" variant="outline" onClick={() => update.mutate({ id: assignment.id, values: { status: 'ingecheckt' } })}>
                          Inchecken
                        </Button>
                      )}
                      {assignment.status === 'ingecheckt' && (
                        <Button size="sm" variant="outline" onClick={() => update.mutate({ id: assignment.id, values: { status: 'uitgecheckt', check_out_date: new Date().toISOString().slice(0, 10) } })}>
                          Uitchecken
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => { setMoving(assignment); setTargetUnitId(''); }}>
                        Verplaatsen
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

const ResidentsTab = ({ property }: { property: any }) => {
  const { role } = useAuth();
  return isFacilityRole(role)
    ? <FacilityResidentsTab property={property} />
    : <InternalResidentsTab property={property} />;
};

export default ResidentsTab;
