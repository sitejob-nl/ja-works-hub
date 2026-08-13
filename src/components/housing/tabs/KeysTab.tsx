import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { unwrapDeleted } from '@/lib/db';
import { toFriendlyError } from '@/lib/errorMessages';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EntityLink } from '@/components/ui/entity-link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { Plus, MoreHorizontal, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';
import { useAuth } from '@/contexts/AuthContext';
import { fetchFacilityHousingSnapshot, fetchFacilityWorkerDirectory, isFacilityRole } from '@/lib/facility';

const emptyForm = { key_number: '', unit_id: '', employee_id: '', issued_at: '' };

const InternalKeysTab = ({ propertyId }: { propertyId: string }) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [keyToDelete, setKeyToDelete] = useState<any | null>(null);
  const [keyToLose, setKeyToLose] = useState<any | null>(null);

  const { data: keys = [] } = useQuery({
    queryKey: ['property-keys', propertyId],
    queryFn: async () => {
      const { data: units } = await supabase.from('units').select('id').eq('property_id', propertyId);
      const unitIds = (units ?? []).map((u: any) => u.id);
      if (unitIds.length === 0) return [];
      const { data, error } = await supabase.from('key_registrations')
        .select('*, units!key_registrations_unit_id_fkey(name), employees!key_registrations_employee_id_fkey(candidates!employees_candidate_id_fkey(first_name, last_name))')
        .in('unit_id', unitIds)
        .order('issued_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: unitsData = [] } = useQuery({
    queryKey: ['property-units-select', propertyId],
    queryFn: async () => {
      const { data, error } = await supabase.from('units').select('id, name').eq('property_id', propertyId);
      if (error) throw error;
      return data;
    },
    enabled: formOpen,
  });

  const { data: residents = [] } = useQuery({
    queryKey: ['property-residents-select', propertyId],
    queryFn: async () => {
      const unitIds = unitsData.map((u: any) => u.id);
      if (unitIds.length === 0) return [];
      const { data, error } = await supabase.from('housing_assignments')
        .select('employee_id, employees!housing_assignments_employee_id_fkey(id, candidates!employees_candidate_id_fkey(first_name, last_name))')
        .in('unit_id', unitIds)
        .eq('status', 'ingecheckt');
      if (error) throw error;
      return data;
    },
    enabled: formOpen && unitsData.length > 0,
  });

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
  };

  const openEdit = (k: any) => {
    setEditingId(k.id);
    setForm({
      key_number: k.key_number ?? '',
      unit_id: k.unit_id ?? '',
      employee_id: k.employee_id ?? '',
      issued_at: k.issued_at ? k.issued_at.split('T')[0] : '',
    });
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const saveKey = useMutation({
    mutationFn: async () => {
      const recordId = editingId ?? crypto.randomUUID();
      const payload = {
        key_number: form.key_number,
        unit_id: form.unit_id,
        employee_id: form.employee_id,
        issued_at: form.issued_at || new Date().toISOString(),
      };
      if (editingId) {
        const { error } = await supabase.from('key_registrations').update(payload).eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('key_registrations').insert({ ...payload, organization_id: orgId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['property-keys', propertyId] });
      logAudit({
        action: editingId ? 'update' : 'create',
        tableName: 'key_registrations',
        recordId: editingId ?? 'new',
        newValues: form,
      });
      toast.success(editingId ? 'Sleutel bijgewerkt' : 'Sleutel geregistreerd');
      closeForm();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const returnKey = useMutation({
    mutationFn: async (keyId: string) => {
      const { error } = await supabase.from('key_registrations').update({ returned_at: new Date().toISOString() }).eq('id', keyId);
      if (error) throw error;
    },
    onSuccess: (_, keyId) => {
      qc.invalidateQueries({ queryKey: ['property-keys', propertyId] });
      logAudit({ action: 'status_change', tableName: 'key_registrations', recordId: keyId, newValues: { returned_at: new Date().toISOString() } });
      toast.success('Sleutel ingeleverd');
    },
  });

  const markLost = useMutation({
    mutationFn: async (keyId: string) => {
      const { error } = await supabase.from('key_registrations').update({ lost_at: new Date().toISOString() }).eq('id', keyId);
      if (error) throw error;
    },
    onSuccess: (_, keyId) => {
      qc.invalidateQueries({ queryKey: ['property-keys', propertyId] });
      logAudit({ action: 'status_change', tableName: 'key_registrations', recordId: keyId, newValues: { lost_at: new Date().toISOString() } });
      toast.success('Sleutel als verloren gemarkeerd');
      setKeyToLose(null);
    },
    onError: (e: any) => { toast.error(e.message); setKeyToLose(null); },
  });

  const deleteKey = useMutation({
    mutationFn: async (keyId: string) => {
      // Rowcount-check: een door RLS geweigerde delete geeft geen error, alleen 0 rijen.
      await unwrapDeleted(
        supabase.from('key_registrations').delete().eq('id', keyId),
        'Deze sleutelregistratie kon niet worden verwijderd — je hebt hiervoor mogelijk beheerdersrechten nodig.',
      );
    },
    onSuccess: (_, keyId) => {
      qc.invalidateQueries({ queryKey: ['property-keys', propertyId] });
      logAudit({ action: 'delete', tableName: 'key_registrations', recordId: keyId });
      toast.success('Sleutelregistratie verwijderd');
      setKeyToDelete(null);
    },
    onError: (e: any) => { toast.error(toFriendlyError(e, 'Verwijderen mislukt')); setKeyToDelete(null); },
  });

  const getStatus = (k: any): { label: string; cls: string } => {
    if (k.lost_at) return { label: 'Verloren', cls: 'bg-red-100 text-red-700 border-0' };
    if (k.returned_at) return { label: 'Ingeleverd', cls: 'bg-stat-green/10 text-stat-green border-0' };
    return { label: 'Uitstaand', cls: 'bg-orange-100 text-orange-600 border-0' };
  };

  const isOpen = (k: any) => !k.returned_at && !k.lost_at;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Sleutelregistratie</h3>
        <Button size="sm" variant="outline" onClick={openAdd} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> Nieuwe sleutel
        </Button>
      </div>

      {formOpen && (
        <div className="bg-card rounded-lg border p-4 space-y-3">
          <p className="text-sm font-medium">{editingId ? 'Sleutel bewerken' : 'Nieuwe sleutel'}</p>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Sleutelnummer *</Label><Input value={form.key_number} onChange={(e) => setForm(f => ({ ...f, key_number: e.target.value }))} /></div>
            <div><Label>Uitgiftedatum</Label><Input type="date" value={form.issued_at} onChange={(e) => setForm(f => ({ ...f, issued_at: e.target.value }))} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Kamer *</Label>
              <Select value={form.unit_id} onValueChange={(v) => setForm(f => ({ ...f, unit_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecteer kamer" /></SelectTrigger>
                <SelectContent>
                  {unitsData.map((u: any) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Medewerker *</Label>
              <Select value={form.employee_id} onValueChange={(v) => setForm(f => ({ ...f, employee_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecteer bewoner" /></SelectTrigger>
                <SelectContent>
                  {residents.map((r: any) => (
                    <SelectItem key={r.employee_id} value={r.employee_id}>
                      {r.employees?.candidates?.first_name} {r.employees?.candidates?.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={closeForm}>Annuleren</Button>
            <Button size="sm" onClick={() => saveKey.mutate()} disabled={!form.key_number || !form.unit_id || !form.employee_id || saveKey.isPending}>
              {saveKey.isPending ? 'Opslaan...' : editingId ? 'Opslaan' : 'Registreren'}
            </Button>
          </div>
        </div>
      )}

      {keys.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">Geen sleutels geregistreerd</p>
      ) : (
        <div className="bg-card rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sleutelnr.</TableHead>
                <TableHead>Kamer</TableHead>
                <TableHead>Medewerker</TableHead>
                <TableHead>Uitgifte</TableHead>
                <TableHead>Inlever / Verloren</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k: any) => {
                const st = getStatus(k);
                const open = isOpen(k);
                const endDate = k.lost_at ?? k.returned_at;
                return (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.key_number}</TableCell>
                    <TableCell>{k.units?.name ?? '—'}</TableCell>
                    <TableCell><EntityLink type="employee" id={k.employee_id}>{k.employees?.candidates?.first_name} {k.employees?.candidates?.last_name}</EntityLink></TableCell>
                    <TableCell>{formatDate(k.issued_at)}</TableCell>
                    <TableCell>{endDate ? formatDate(endDate) : '—'}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={`text-xs ${st.cls}`}>{st.label}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 items-center justify-end">
                        {open && (
                          <Button size="sm" variant="outline" onClick={() => returnKey.mutate(k.id)} disabled={returnKey.isPending}>
                            Inleveren
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(k)}>
                              <Pencil className="h-3.5 w-3.5 mr-2" /> Bewerken
                            </DropdownMenuItem>
                            {open && (
                              <DropdownMenuItem onClick={() => setKeyToLose(k)} className="text-orange-600">
                                <AlertTriangle className="h-3.5 w-3.5 mr-2" /> Verloren melden
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setKeyToDelete(k)} className="text-destructive">
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

      <AlertDialog open={!!keyToLose} onOpenChange={(o) => { if (!o) setKeyToLose(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sleutel "{keyToLose?.key_number}" als verloren melden?</AlertDialogTitle>
            <AlertDialogDescription>
              Markeert de sleutel als verloren met datum vandaag. Status wordt definitief — een verloren sleutel kan niet alsnog worden ingeleverd.
              Maak eventueel een nieuwe sleutelregistratie aan voor de vervangende sleutel.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (keyToLose) markLost.mutate(keyToLose.id); }}
              disabled={markLost.isPending}
              className="bg-orange-600 text-white hover:bg-orange-700"
            >
              {markLost.isPending ? 'Markeren...' : 'Verloren melden'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!keyToDelete} onOpenChange={(o) => { if (!o) setKeyToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sleutelregistratie verwijderen?</AlertDialogTitle>
            <AlertDialogDescription>
              Verwijdert de registratie van sleutel "{keyToDelete?.key_number}" volledig. Deze actie kan niet ongedaan worden gemaakt.
              Voor administratieve historie liever 'Inleveren' of 'Verloren melden'.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (keyToDelete) deleteKey.mutate(keyToDelete.id); }}
              disabled={deleteKey.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteKey.isPending ? 'Verwijderen...' : 'Verwijderen'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

const FacilityKeysTab = ({ property }: { property: any }) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const units = property.units ?? [];

  const { data: snapshot } = useQuery({
    queryKey: ['facility-housing-snapshot', property.id],
    queryFn: () => fetchFacilityHousingSnapshot(property.id),
  });
  const { data: directory = [] } = useQuery({
    queryKey: ['facility-worker-directory'],
    queryFn: fetchFacilityWorkerDirectory,
  });
  const keys = snapshot?.key_registrations ?? [];
  const activeResidents = units.flatMap((unit: any) =>
    (unit.housing_assignments ?? [])
      .filter((assignment: any) => assignment.status === 'ingecheckt')
      .map((assignment: any) => ({ ...assignment, unit_id: unit.id })),
  );
  const workerByEmployee = new Map(directory.map((worker: any) => [worker.employee_id, worker]));
  const workerLabel = (employeeId: string) => {
    const worker: any = workerByEmployee.get(employeeId);
    return [worker?.first_name, worker?.last_name].filter(Boolean).join(' ') || 'Medewerker';
  };
  const unitLabel = (unitId: string) => units.find((unit: any) => unit.id === unitId)?.name ?? '—';

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  };
  const save = useMutation({
    mutationFn: async () => {
      const recordId = editingId ?? crypto.randomUUID();
      const payload = {
        key_number: form.key_number,
        unit_id: form.unit_id,
        employee_id: form.employee_id,
        issued_at: form.issued_at || new Date().toISOString(),
      };
      const query = editingId
        ? supabase.from('key_registrations').update(payload).eq('id', editingId)
        : supabase.from('key_registrations').insert({ id: recordId, ...payload, organization_id: orgId });
      const { error } = await query;
      if (error) throw error;
      return recordId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['facility-housing-snapshot'] });
      qc.invalidateQueries({ queryKey: ['property', property.id, 'facility'] });
      toast.success(editingId ? 'Sleutel bijgewerkt' : 'Sleutel geregistreerd');
      closeForm();
    },
    onError: (error: any) => toast.error(error.message ?? 'Opslaan mislukt'),
  });
  const updateStatus = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Record<string, string> }) => {
      const { error } = await supabase.from('key_registrations').update(values).eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['facility-housing-snapshot'] });
      toast.success('Sleutelstatus bijgewerkt');
    },
    onError: (error: any) => toast.error(error.message ?? 'Bijwerken mislukt'),
  });
  const openEdit = (key: any) => {
    setEditingId(key.id);
    setForm({
      key_number: key.key_number ?? '',
      unit_id: key.unit_id ?? '',
      employee_id: key.employee_id ?? '',
      issued_at: key.issued_at ? key.issued_at.split('T')[0] : '',
    });
    setFormOpen(true);
  };
  const getStatus = (key: any) => {
    if (key.lost_at) return { label: 'Verloren', cls: 'bg-red-100 text-red-700 border-0' };
    if (key.returned_at) return { label: 'Ingeleverd', cls: 'bg-stat-green/10 text-stat-green border-0' };
    return { label: 'Uitstaand', cls: 'bg-orange-100 text-orange-600 border-0' };
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Sleutelregistratie</h3>
        <Button size="sm" variant="outline" onClick={() => { setEditingId(null); setForm(emptyForm); setFormOpen(true); }} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> Nieuwe sleutel
        </Button>
      </div>

      {formOpen && (
        <div className="bg-card rounded-lg border p-4 space-y-3">
          <p className="text-sm font-medium">{editingId ? 'Sleutel bewerken' : 'Nieuwe sleutel'}</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><Label>Sleutelnummer *</Label><Input value={form.key_number} onChange={(event) => setForm((value) => ({ ...value, key_number: event.target.value }))} /></div>
            <div><Label>Uitgiftedatum</Label><Input type="date" value={form.issued_at} onChange={(event) => setForm((value) => ({ ...value, issued_at: event.target.value }))} /></div>
            <div>
              <Label>Kamer *</Label>
              <Select value={form.unit_id} onValueChange={(value) => setForm((current) => ({ ...current, unit_id: value }))}>
                <SelectTrigger><SelectValue placeholder="Selecteer kamer" /></SelectTrigger>
                <SelectContent>{units.map((unit: any) => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Medewerker *</Label>
              <Select value={form.employee_id} onValueChange={(value) => setForm((current) => ({ ...current, employee_id: value }))}>
                <SelectTrigger><SelectValue placeholder="Selecteer bewoner" /></SelectTrigger>
                <SelectContent>
                  {activeResidents.map((assignment: any) => (
                    <SelectItem key={`${assignment.id}-${assignment.employee_id}`} value={assignment.employee_id}>
                      {workerLabel(assignment.employee_id)} · {unitLabel(assignment.unit_id)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={closeForm}>Annuleren</Button>
            <Button size="sm" onClick={() => save.mutate()} disabled={!form.key_number || !form.unit_id || !form.employee_id || save.isPending}>Opslaan</Button>
          </div>
        </div>
      )}

      {keys.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">Geen sleutels geregistreerd</p>
      ) : (
        <div className="bg-card rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>Sleutelnr.</TableHead><TableHead>Kamer</TableHead><TableHead>Medewerker</TableHead><TableHead>Uitgifte</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actie</TableHead></TableRow></TableHeader>
            <TableBody>
              {keys.map((key: any) => {
                const status = getStatus(key);
                const isOpen = !key.returned_at && !key.lost_at;
                return (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium">{key.key_number}</TableCell>
                    <TableCell>{unitLabel(key.unit_id)}</TableCell>
                    <TableCell>{workerLabel(key.employee_id)}</TableCell>
                    <TableCell>{formatDate(key.issued_at)}</TableCell>
                    <TableCell><Badge variant="secondary" className={`text-xs ${status.cls}`}>{status.label}</Badge></TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {isOpen && <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: key.id, values: { returned_at: new Date().toISOString() } })}>Ingeleverd</Button>}
                        {isOpen && <Button size="sm" variant="ghost" onClick={() => updateStatus.mutate({ id: key.id, values: { lost_at: new Date().toISOString() } })}>Verloren</Button>}
                        <Button size="sm" variant="ghost" onClick={() => openEdit(key)}>Bewerken</Button>
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

const KeysTab = ({ property }: { property: any }) => {
  const { role } = useAuth();
  return isFacilityRole(role)
    ? <FacilityKeysTab property={property} />
    : <InternalKeysTab propertyId={property.id} />;
};

export default KeysTab;
