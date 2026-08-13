import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { unwrapDeleted, unwrapList } from '@/lib/db';
import { qk } from '@/lib/query-keys';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Link } from 'react-router-dom';
import { Plus, MoreHorizontal, Pencil, Trash2, Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
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
import { toast } from 'sonner';
import { formatDate } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { toFriendlyError } from '@/lib/errorMessages';
import { cn } from '@/lib/utils';
import { resolveEmployeeId } from '@/lib/assignments';
import { sendRegulationsForAssignment } from '@/lib/regulation-dispatch';
import { useAuth } from '@/contexts/AuthContext';
import { fetchFacilityTransportSnapshot, fetchFacilityWorkerDirectory, isFacilityRole, saveFacilityOperationalEntity } from '@/lib/facility';

const assignmentPerson = (assignment: any) => assignment?.employees?.candidates ?? assignment?.worker ?? assignment;
const workerPerson = (worker: any) => worker?.candidates ?? worker;

// Bewust gespiegeld aan het statusfilter in housing/tabs/ResidentsTab.tsx: daar staat het
// lokaal (niet geëxporteerd) en dat bestand blijft in deze fix ongemoeid.
const EXCLUDED_CANDIDATE_STATUSES = ['inactief', 'afgewezen', 'uitgeschreven', 'niet_beschikbaar'];

const isAssignableCandidate = (candidate: any) => {
  if (candidate?.employee_status === 'uit_dienst') return false;
  return !EXCLUDED_CANDIDATE_STATUSES.includes(candidate?.status);
};

const personId = (person: any) => (person ? person.employee_id ?? person.id : null);
const personName = (person: any) => {
  const p = workerPerson(person);
  return `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim();
};

// De facility-directory levert geen rijbewijsvelden mee; dan tonen we bewust géén
// (misleidend) rijbewijs-signaal in plaats van "ontbreekt".
const licenseIssue = (person: any): 'ontbreekt' | 'verlopen' | null => {
  if (!person || !Object.prototype.hasOwnProperty.call(person, 'has_drivers_license')) return null;
  if (person.has_drivers_license !== true) return 'ontbreekt';
  const expiry = person.drivers_license_expiry;
  if (expiry && expiry < new Date().toISOString().slice(0, 10)) return 'verlopen';
  return null;
};

const VehicleAssignmentsTab = ({ vehicle }: { vehicle: any }) => {
  const orgId = useOrganizationId();
  const { role } = useAuth();
  const isFacility = isFacilityRole(role);
  const qc = useQueryClient();
  const [assignOpen, setAssignOpen] = useState(false);
  const [returnDialog, setReturnDialog] = useState<any>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [personSearch, setPersonSearch] = useState('');
  const [selectedPerson, setSelectedPerson] = useState<any>(null);
  const [assignedDate, setAssignedDate] = useState('');
  const [startMileage, setStartMileage] = useState(vehicle.current_mileage?.toString() ?? '');
  const [endMileage, setEndMileage] = useState('');

  const [editingAssignment, setEditingAssignment] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({
    assigned_date: '',
    returned_date: '',
    start_mileage: '',
    end_mileage: '',
  });
  const [assignmentToDelete, setAssignmentToDelete] = useState<any | null>(null);

  const { data: assignments } = useQuery({
    queryKey: ['vehicle-assignments', vehicle.id, orgId, isFacility ? 'facility' : 'internal'],
    queryFn: async () => {
      if (isFacility) {
        const snapshot = await fetchFacilityTransportSnapshot(vehicle.id);
        return (snapshot.assignments ?? [])
          .filter((assignment: any) => assignment.vehicle_id === vehicle.id)
          .sort((a: any, b: any) => String(b.assigned_date ?? '').localeCompare(String(a.assigned_date ?? '')));
      }
      return await unwrapList<any>(supabase.from('vehicle_assignments').select(`
        *,
        employees!vehicle_assignments_employee_id_fkey(id, candidates!employees_candidate_id_fkey(first_name, last_name))
      `).eq('organization_id', orgId).eq('vehicle_id', vehicle.id).order('assigned_date', { ascending: false }));
    },
  });

  // Facility-pad: eigen RPC-directory (die rol is géén is_internal_user en mag `candidates`
  // niet lezen). Zoeken gebeurt hier client-side op de al opgehaalde lijst.
  const { data: facilityWorkers = [] } = useQuery({
    queryKey: ['facility-worker-directory', 'vehicle-assign', orgId],
    queryFn: async () => {
      const workers = await fetchFacilityWorkerDirectory();
      return workers
        .filter((worker: any) => worker.status === 'actief')
        .sort((a: any, b: any) => `${a.last_name ?? ''} ${a.first_name ?? ''}`.localeCompare(`${b.last_name ?? ''} ${b.first_name ?? ''}`, 'nl'));
    },
    enabled: assignOpen && isFacility,
  });

  // Intern pad: rechtstreeks op `candidates`. De legacy `employees`-tabel bevat alleen
  // koppelrijen (7 stuks bij JA Werkt tegenover 2.122 kandidaten) en gaf daardoor een
  // vrijwel lege keuzelijst; die rij wordt bij toewijzen alsnog via resolveEmployeeId gemaakt.
  const { data: candidateResults = [], isLoading: candidatesLoading } = useQuery({
    queryKey: qk.candidates.list(orgId, { scope: 'vehicle-assign', search: personSearch }),
    queryFn: async () => {
      let query = supabase.from('candidates')
        .select('id, first_name, last_name, employee_number, employee_status, status, has_drivers_license, drivers_license_expiry')
        .eq('organization_id', orgId)
        .is('anonymized_at', null)
        .order('last_name')
        .order('first_name')
        .limit(50);

      const search = personSearch.trim();
      if (search) {
        const term = search.replace(/[%,]/g, ' ');
        query = query.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,employee_number.ilike.%${term}%`);
      }

      const data = await unwrapList<any>(query);
      return data.filter(isAssignableCandidate);
    },
    enabled: assignOpen && !isFacility && !!orgId,
  });

  const people = useMemo(() => {
    if (!isFacility) return candidateResults;
    const term = personSearch.trim().toLowerCase();
    if (!term) return facilityWorkers as any[];
    return (facilityWorkers as any[]).filter((worker) =>
      `${personName(worker)} ${worker.employee_number ?? ''}`.toLowerCase().includes(term));
  }, [isFacility, candidateResults, facilityWorkers, personSearch]);

  const resetPicker = () => { setSelectedPerson(null); setPersonSearch(''); setPickerOpen(false); };

  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPerson) throw new Error('Selecteer eerst een medewerker.');
      // De DB-trigger check_drivers_license weigert de insert zonder geldig rijbewijs.
      // Hier al stoppen, want resolveEmployeeId() hieronder maakt de employees-koppelrij
      // aan vóór die insert: bij elke geweigerde poging bleef er anders een dienstverband-
      // rij met status 'actief' achter, die ook nog de KPI 'actieve medewerkers' optelt.
      const issue = isFacility ? null : licenseIssue(selectedPerson);
      if (issue) {
        throw new Error(issue === 'verlopen'
          ? 'Het rijbewijs van deze medewerker is verlopen. Werk het bij op het kandidaatdossier en probeer het opnieuw.'
          : 'Er staat geen rijbewijs op deze medewerker. Vul het rijbewijs in op het kandidaatdossier en probeer het opnieuw.');
      }
      // Toewijzingen keyen op employee_id; intern maken we die koppelrij zo nodig aan.
      const employeeId = isFacility
        ? selectedPerson.employee_id
        : await resolveEmployeeId(selectedPerson, orgId, assignedDate);
      const candidateId = isFacility ? (selectedPerson.candidate_id ?? null) : selectedPerson.id;
      const { data: inserted, error } = await supabase.from('vehicle_assignments').insert({
        organization_id: orgId,
        vehicle_id: vehicle.id,
        employee_id: employeeId,
        candidate_id: candidateId,
        assigned_date: assignedDate,
        start_mileage: startMileage ? parseInt(startMileage) : null,
      }).select('id').single();
      if (error) throw error;
      if (isFacility) {
        await saveFacilityOperationalEntity('vehicle', { id: vehicle.id, status: 'toegewezen' });
      } else {
        const { error: vErr } = await supabase.from('vehicles').update({ status: 'toegewezen' as any }).eq('id', vehicle.id);
        if (vErr) throw vErr;
      }
      // Autoregels meesturen (instelbaar per reglement). Non-blocking: de toewijzing staat al.
      if (candidateId) {
        await sendRegulationsForAssignment({ candidateId, category: 'voertuig', contextId: inserted?.id });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicle-assignments', vehicle.id] });
      qc.invalidateQueries({ queryKey: ['vehicle', vehicle.id] });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      qc.invalidateQueries({ queryKey: ['facility-transport-snapshot'] });
      toast.success('Voertuig toegewezen');
      setAssignOpen(false);
      resetPicker(); setAssignedDate('');
    },
    onError: (e: any) => {
      const msg = e?.message || '';
      // De write-guard op `employees` hangt aan candidates.edit — finance heeft dat recht niet
      // en struikelt dus op het aanmaken van de koppelrij, niet op de toewijzing zelf.
      if (e?.code === '42501' && /employees/i.test(msg)) {
        toast.error('Je mag geen nieuwe medewerker-koppeling aanmaken. Vraag een beheerder om deze kandidaat eerst in dienst te nemen.');
        return;
      }
      // Vangnet-trigger check_drivers_license: blokkeert de insert zolang het rijbewijs
      // niet op de kandidaat staat.
      if (/rijbewijs|license/i.test(msg)) {
        toast.error('Toewijzing geblokkeerd: er staat geen geldig rijbewijs op deze medewerker. Vul het rijbewijs eerst in op het kandidaatdossier.');
        return;
      }
      // `vehicle_assignments` heeft geen unique constraint; een 23505 komt hier dus uit de
      // employees-koppelrij (uniek op candidate_id én op organisatie+personeelsnummer).
      if (e?.code === '23505') {
        toast.error('De medewerker-koppeling kon niet worden aangemaakt — er bestaat al een dienstverband of het personeelsnummer is al in gebruik.');
        return;
      }
      toast.error(toFriendlyError(e, 'Toewijzen is niet gelukt.'));
    },
  });

  const returnMutation = useMutation({
    mutationFn: async () => {
      const km = parseInt(endMileage);
      const { error } = await supabase.from('vehicle_assignments').update({
        returned_date: new Date().toISOString().split('T')[0],
        end_mileage: km,
      }).eq('id', returnDialog.id);
      if (error) throw error;
      if (isFacility) {
        await saveFacilityOperationalEntity('vehicle', { id: vehicle.id, current_mileage: km, status: 'beschikbaar' });
      } else {
        const { error: vErr } = await supabase.from('vehicles').update({ current_mileage: km, status: 'beschikbaar' as any }).eq('id', vehicle.id);
        if (vErr) throw vErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicle-assignments', vehicle.id] });
      qc.invalidateQueries({ queryKey: ['vehicle', vehicle.id] });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      qc.invalidateQueries({ queryKey: ['facility-transport-snapshot'] });
      toast.success('Voertuig ingeleverd');
      setReturnDialog(null); setEndMileage('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const editMutation = useMutation({
    mutationFn: async () => {
      if (!editingAssignment) throw new Error('Geen toewijzing geselecteerd');
      const update: any = {
        assigned_date: editForm.assigned_date,
        returned_date: editForm.returned_date || null,
        start_mileage: editForm.start_mileage ? parseInt(editForm.start_mileage) : null,
        end_mileage: editForm.end_mileage ? parseInt(editForm.end_mileage) : null,
      };
      const { error } = await supabase.from('vehicle_assignments').update(update).eq('id', editingAssignment.id);
      if (error) throw error;
      return update;
    },
    onSuccess: (update) => {
      qc.invalidateQueries({ queryKey: ['vehicle-assignments', vehicle.id] });
      qc.invalidateQueries({ queryKey: ['vehicle', vehicle.id] });
      qc.invalidateQueries({ queryKey: ['facility-transport-snapshot'] });
      if (!isFacility) logAudit({ action: 'update', tableName: 'vehicle_assignments', recordId: editingAssignment?.id ?? '', newValues: update });
      toast.success('Toewijzing bijgewerkt');
      setEditingAssignment(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (a: any) => {
      if (!a.returned_date) {
        throw new Error('Voertuig is nog niet ingeleverd — eerst inleveren voordat de toewijzing verwijderd kan worden.');
      }
      // Rowcount tellen: de DELETE-policy is admin-only, dus voor andere rollen raakt de
      // delete 0 rijen zónder error — dat gaf een groene toast terwijl de rij bleef staan.
      await unwrapDeleted(
        supabase.from('vehicle_assignments').delete().eq('id', a.id),
        'Verwijderen niet toegestaan — je hebt hiervoor beheerdersrechten nodig.',
      );
      return a;
    },
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ['vehicle-assignments', vehicle.id] });
      qc.invalidateQueries({ queryKey: ['vehicle', vehicle.id] });
      logAudit({ action: 'delete', tableName: 'vehicle_assignments', recordId: a.id });
      toast.success('Toewijzing verwijderd');
      setAssignmentToDelete(null);
    },
    onError: (e: any) => { toast.error(toFriendlyError(e, 'Verwijderen is niet gelukt.')); setAssignmentToDelete(null); },
  });

  const openEdit = (a: any) => {
    setEditingAssignment(a);
    setEditForm({
      assigned_date: a.assigned_date ?? '',
      returned_date: a.returned_date ?? '',
      start_mileage: a.start_mileage != null ? String(a.start_mileage) : '',
      end_mileage: a.end_mileage != null ? String(a.end_mileage) : '',
    });
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setAssignOpen(true)} className="gap-1"><Plus className="h-4 w-4" /> Voertuig toewijzen</Button>
      </div>

      <div className="bg-card rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Medewerker</TableHead>
              <TableHead>Startdatum</TableHead>
              <TableHead>Einddatum</TableHead>
              <TableHead className="text-right">Begin km</TableHead>
              <TableHead className="text-right">Eind km</TableHead>
              <TableHead className="text-right">Totaal km</TableHead>
              <TableHead>Acties</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(assignments ?? []).map((a: any) => {
              const c = assignmentPerson(a);
              const totalKm = a.start_mileage != null && a.end_mileage != null ? a.end_mileage - a.start_mileage : null;
              return (
                <TableRow key={a.id}>
                  <TableCell>
                    {isFacility ? (
                      <span className="font-medium">{c?.first_name} {c?.last_name}</span>
                    ) : (
                      <Link to={`/medewerkers/${a.employees?.id}`} className="font-medium hover:text-stat-blue">{c?.first_name} {c?.last_name}</Link>
                    )}
                  </TableCell>
                  <TableCell>{formatDate(a.assigned_date)}</TableCell>
                  <TableCell>{a.returned_date ? formatDate(a.returned_date) : <Badge variant="secondary" className="bg-stat-green/10 text-stat-green border-0">Huidig</Badge>}</TableCell>
                  <TableCell className="text-right">{a.start_mileage?.toLocaleString('nl-NL') ?? '—'}</TableCell>
                  <TableCell className="text-right">{a.end_mileage?.toLocaleString('nl-NL') ?? '—'}</TableCell>
                  <TableCell className="text-right">{totalKm != null ? totalKm.toLocaleString('nl-NL') : '—'}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 items-center">
                      {!a.returned_date && <Button size="sm" variant="outline" onClick={() => { setReturnDialog(a); setEndMileage(''); }}>Inleveren</Button>}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(a)}>
                            <Pencil className="h-3.5 w-3.5 mr-2" /> Bewerken
                          </DropdownMenuItem>
                          {!isFacility && <DropdownMenuSeparator />}
                          {!isFacility && (
                            <DropdownMenuItem onClick={() => setAssignmentToDelete(a)} className="text-destructive">
                              <Trash2 className="h-3.5 w-3.5 mr-2" /> Verwijderen
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {(assignments ?? []).length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nog geen toewijzingen</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Assign sheet */}
      <Sheet open={assignOpen} onOpenChange={(o) => { setAssignOpen(o); if (!o) resetPicker(); }}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader><SheetTitle>Voertuig toewijzen</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6">
            <div className="space-y-1.5">
              <Label>Medewerker *</Label>
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    className={cn('w-full justify-between font-normal', !selectedPerson && 'text-muted-foreground')}
                  >
                    <span className="truncate">{selectedPerson ? personName(selectedPerson) : 'Zoek medewerker...'}</span>
                    <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[280px]" align="start">
                  {/* shouldFilter uit: intern filtert de database (hele kandidatenpool), niet de lijst van 50. */}
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Zoek op naam of personeelsnummer..."
                      value={personSearch}
                      onValueChange={setPersonSearch}
                    />
                    <CommandList>
                      <CommandEmpty>{candidatesLoading ? 'Laden…' : 'Geen medewerker gevonden'}</CommandEmpty>
                      <CommandGroup>
                        {people.map((p: any) => {
                          const id = personId(p);
                          const issue = licenseIssue(p);
                          return (
                            <CommandItem
                              key={id}
                              value={id}
                              onSelect={() => { setSelectedPerson(p); setPickerOpen(false); }}
                            >
                              <Check className={cn('mr-2 h-4 w-4 shrink-0', personId(selectedPerson) === id ? 'opacity-100' : 'opacity-0')} />
                              <span className="truncate">{personName(p)}</span>
                              {p.employee_number && <span className="ml-1.5 text-xs text-muted-foreground shrink-0">{p.employee_number}</span>}
                              {issue && (
                                <Badge variant="outline" className="ml-auto shrink-0 text-[10px] font-normal">
                                  {issue === 'verlopen' ? 'rijbewijs verlopen' : 'geen rijbewijs geregistreerd'}
                                </Badge>
                              )}
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {/* Niet blokkeren: het rijbewijsveld is bij de meeste kandidaten nog leeg. De
                  database-trigger blijft het vangnet; hier wijzen we alleen de weg. */}
              {licenseIssue(selectedPerson) && (
                <p className="text-xs text-muted-foreground">
                  {licenseIssue(selectedPerson) === 'verlopen'
                    ? 'Het geregistreerde rijbewijs is verlopen.'
                    : 'Er staat geen rijbewijs op deze medewerker.'}{' '}
                  Toewijzen kan hierdoor geweigerd worden — vul het rijbewijs in op het{' '}
                  <Link to={`/kandidaten/${selectedPerson.id}`} className="underline" target="_blank" rel="noreferrer">
                    kandidaatdossier
                  </Link>.
                </p>
              )}
            </div>
            <div><Label>Startdatum *</Label><Input type="date" value={assignedDate} onChange={(e) => setAssignedDate(e.target.value)} /></div>
            <div><Label>Begin kilometerstand</Label><Input type="number" value={startMileage} onChange={(e) => setStartMileage(e.target.value)} /></div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={() => setAssignOpen(false)}>Annuleren</Button>
              <Button onClick={() => assignMutation.mutate()} disabled={!selectedPerson || !assignedDate || assignMutation.isPending}>
                {assignMutation.isPending ? 'Toewijzen...' : 'Toewijzen'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Edit assignment Sheet */}
      <Sheet open={!!editingAssignment} onOpenChange={(o) => { if (!o) setEditingAssignment(null); }}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader><SheetTitle>Toewijzing bewerken</SheetTitle></SheetHeader>
          {editingAssignment && (
            <div className="space-y-4 mt-6">
              <div className="p-3 rounded-lg bg-muted/50 border text-sm">
                {assignmentPerson(editingAssignment)?.first_name} {assignmentPerson(editingAssignment)?.last_name}
              </div>
              <div><Label>Startdatum *</Label><Input type="date" value={editForm.assigned_date} onChange={(e) => setEditForm(f => ({ ...f, assigned_date: e.target.value }))} /></div>
              <div><Label>Einddatum (leeg = nog actief)</Label><Input type="date" value={editForm.returned_date} onChange={(e) => setEditForm(f => ({ ...f, returned_date: e.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Begin km</Label><Input type="number" value={editForm.start_mileage} onChange={(e) => setEditForm(f => ({ ...f, start_mileage: e.target.value }))} /></div>
                <div><Label>Eind km</Label><Input type="number" value={editForm.end_mileage} onChange={(e) => setEditForm(f => ({ ...f, end_mileage: e.target.value }))} /></div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button variant="ghost" onClick={() => setEditingAssignment(null)}>Annuleren</Button>
                <Button onClick={() => editMutation.mutate()} disabled={!editForm.assigned_date || editMutation.isPending}>
                  {editMutation.isPending ? 'Opslaan...' : 'Opslaan'}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Delete assignment confirm */}
      <AlertDialog open={!isFacility && !!assignmentToDelete} onOpenChange={(o) => { if (!o) setAssignmentToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Toewijzing verwijderen?</AlertDialogTitle>
            <AlertDialogDescription>
              {assignmentToDelete && !assignmentToDelete.returned_date
                ? 'Voertuig is nog niet ingeleverd. Eerst inleveren voordat je de toewijzing kunt verwijderen.'
                : 'Verwijdert de historische toewijzing permanent. Deze actie kan niet ongedaan worden gemaakt.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (assignmentToDelete) deleteMutation.mutate(assignmentToDelete); }}
              disabled={deleteMutation.isPending || (assignmentToDelete && !assignmentToDelete.returned_date)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Verwijderen...' : 'Verwijderen'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Return dialog */}
      <Dialog open={!!returnDialog} onOpenChange={(o) => !o && setReturnDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Voertuig inleveren</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Eind kilometerstand *</Label><Input type="number" value={endMileage} onChange={(e) => setEndMileage(e.target.value)} placeholder="Huidige km-stand" /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReturnDialog(null)}>Annuleren</Button>
            <Button onClick={() => returnMutation.mutate()} disabled={!endMileage || returnMutation.isPending}>
              {returnMutation.isPending ? 'Inleveren...' : 'Inleveren'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default VehicleAssignmentsTab;
