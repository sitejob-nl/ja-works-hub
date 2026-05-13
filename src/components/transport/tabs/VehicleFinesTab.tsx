import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Plus, MoreHorizontal, Pencil, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
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
import { toast } from 'sonner';
import { formatDate, formatEUR } from '@/lib/format';
import { logAudit } from '@/lib/audit';

const emptyFine = {
  fine_date: '',
  amount: '',
  description: '',
  reference_number: '',
  employee_id: '',
  notes: '',
};

const VehicleFinesTab = ({ vehicle }: { vehicle: any }) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingFine, setEditingFine] = useState<any | null>(null);
  const [form, setForm] = useState(emptyFine);
  const [files, setFiles] = useState<File[]>([]);
  const [fineToDelete, setFineToDelete] = useState<any | null>(null);

  // Backwards-compatible aliases for inline form-binding (less code churn)
  const fineDate = form.fine_date; const setFineDate = (v: string) => setForm(f => ({ ...f, fine_date: v }));
  const amount = form.amount; const setAmount = (v: string) => setForm(f => ({ ...f, amount: v }));
  const description = form.description; const setDescription = (v: string) => setForm(f => ({ ...f, description: v }));
  const referenceNumber = form.reference_number; const setReferenceNumber = (v: string) => setForm(f => ({ ...f, reference_number: v }));
  const employeeId = form.employee_id; const setEmployeeId = (v: string) => setForm(f => ({ ...f, employee_id: v }));
  const notes = form.notes; const setNotes = (v: string) => setForm(f => ({ ...f, notes: v }));

  const { data: fines } = useQuery({
    queryKey: ['vehicle-fines', vehicle.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicle_fines').select(`
        *,
        employees!vehicle_fines_employee_id_fkey(id, candidates!employees_candidate_id_fkey(first_name, last_name))
      `).eq('vehicle_id', vehicle.id).order('fine_date', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: assignedEmployees } = useQuery({
    queryKey: ['vehicle-assigned-employees-fines', vehicle.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicle_assignments').select('employees!vehicle_assignments_employee_id_fkey(id, candidates!employees_candidate_id_fkey(first_name, last_name))').eq('vehicle_id', vehicle.id);
      if (error) throw error;
      const unique = new Map<string, any>();
      (data ?? []).forEach((a: any) => { if (a.employees) unique.set(a.employees.id, a.employees); });
      return Array.from(unique.values());
    },
    enabled: sheetOpen,
  });

  const closeSheet = () => {
    setSheetOpen(false);
    setEditingId(null);
    setEditingFine(null);
    setForm(emptyFine);
    setFiles([]);
  };

  const openAdd = () => {
    setEditingId(null);
    setEditingFine(null);
    setForm(emptyFine);
    setFiles([]);
    setSheetOpen(true);
  };

  const openEdit = (f: any) => {
    setEditingId(f.id);
    setEditingFine(f);
    setForm({
      fine_date: f.fine_date ?? '',
      amount: f.amount != null ? String(f.amount) : '',
      description: f.description ?? '',
      reference_number: f.reference_number ?? '',
      employee_id: f.employee_id ?? '',
      notes: f.notes ?? '',
    });
    setFiles([]);
    setSheetOpen(true);
  };

  const getPhotoUrl = (path: string) => supabase.storage.from('documents').getPublicUrl(path).data.publicUrl;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const existingPhotos: string[] = (editingFine?.photos ?? []) as string[];
      if (existingPhotos.length + files.length === 0) {
        throw new Error('Voeg minimaal één foto van de boete toe');
      }

      const newPhotoPaths: string[] = [];
      for (const file of files) {
        const ext = file.name.split('.').pop() ?? 'jpg';
        const path = `${orgId}/vehicle-fines/${vehicle.id}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from('documents').upload(path, file);
        if (error) throw error;
        newPhotoPaths.push(path);
      }

      const payload: any = {
        fine_date: fineDate,
        amount: parseFloat(amount),
        description: description || null,
        reference_number: referenceNumber || null,
        employee_id: employeeId || null,
        notes: notes || null,
        photos: [...existingPhotos, ...newPhotoPaths],
      };
      if (editingId) {
        const { error } = await supabase.from('vehicle_fines').update(payload).eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('vehicle_fines').insert({
          ...payload, organization_id: orgId, vehicle_id: vehicle.id,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicle-fines', vehicle.id] });
      logAudit({ action: editingId ? 'update' : 'create', tableName: 'vehicle_fines', recordId: editingId ?? 'new' });
      toast.success(editingId ? 'Boete bijgewerkt' : 'Boete geregistreerd');
      closeSheet();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (fine: any) => {
      if (fine.photos?.length > 0) {
        await supabase.storage.from('documents').remove(fine.photos);
      }
      const { error } = await supabase.from('vehicle_fines').delete().eq('id', fine.id);
      if (error) throw error;
      return fine;
    },
    onSuccess: (fine) => {
      qc.invalidateQueries({ queryKey: ['vehicle-fines', vehicle.id] });
      logAudit({ action: 'delete', tableName: 'vehicle_fines', recordId: fine.id });
      toast.success('Boete verwijderd');
      setFineToDelete(null);
    },
    onError: (e: any) => { toast.error(e.message); setFineToDelete(null); },
  });

  const paidMutation = useMutation({
    mutationFn: async ({ id, paid }: { id: string; paid: boolean }) => {
      const { error } = await supabase.from('vehicle_fines').update({
        paid,
        paid_at: paid ? new Date().toISOString() : null,
      }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicle-fines', vehicle.id] });
      toast.success('Betaalstatus bijgewerkt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={openAdd} className="gap-1"><Plus className="h-4 w-4" /> Nieuwe boete</Button>
      </div>

      <div className="bg-card rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Datum</TableHead>
              <TableHead>Bedrag</TableHead>
              <TableHead>Beschrijving</TableHead>
              <TableHead>Referentie</TableHead>
              <TableHead>Foto</TableHead>
              <TableHead>Medewerker</TableHead>
              <TableHead>Betaald</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(fines ?? []).map((f: any) => {
              const c = f.employees?.candidates as any;
              return (
                <TableRow key={f.id}>
                  <TableCell>{formatDate(f.fine_date)}</TableCell>
                  <TableCell>{formatEUR(f.amount)}</TableCell>
                  <TableCell>{f.description ?? '—'}</TableCell>
                  <TableCell>{f.reference_number ?? '—'}</TableCell>
                  <TableCell>
                    {f.photos?.length > 0 ? (
                      <div className="flex items-center gap-1">
                        {f.photos.slice(0, 2).map((path: string, index: number) => (
                          <a key={path} href={getPhotoUrl(path)} target="_blank" rel="noopener noreferrer" className="h-8 w-8 overflow-hidden rounded border block">
                            <img src={getPhotoUrl(path)} alt={`Boete ${index + 1}`} className="h-full w-full object-cover" />
                          </a>
                        ))}
                        {f.photos.length > 2 && <span className="text-xs text-muted-foreground">+{f.photos.length - 2}</span>}
                      </div>
                    ) : (
                      <span className="text-xs text-destructive">Ontbreekt</span>
                    )}
                  </TableCell>
                  <TableCell>{c ? `${c.first_name} ${c.last_name}` : '—'}</TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={`cursor-pointer ${f.paid ? 'bg-stat-green/10 text-stat-green border-0' : 'bg-red-100 text-red-600 border-0'}`}
                      onClick={() => paidMutation.mutate({ id: f.id, paid: !f.paid })}
                    >
                      {f.paid ? 'Betaald' : 'Niet betaald'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(f)}>
                          <Pencil className="h-3.5 w-3.5 mr-2" /> Bewerken
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setFineToDelete(f)} className="text-destructive">
                          <Trash2 className="h-3.5 w-3.5 mr-2" /> Verwijderen
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
            {(fines ?? []).length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Geen boetes geregistreerd</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet open={sheetOpen} onOpenChange={(o) => { if (!o) closeSheet(); else setSheetOpen(o); }}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader><SheetTitle>{editingId ? 'Boete bewerken' : 'Nieuwe boete'}</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6">
            <div><Label>Datum *</Label><Input type="date" value={fineDate} onChange={(e) => setFineDate(e.target.value)} /></div>
            <div><Label>Bedrag (€) *</Label><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div><Label>Beschrijving</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
            <div><Label>Referentienummer</Label><Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} /></div>
            <div>
              <Label>{editingId ? "Extra foto's toevoegen" : "Foto boete *"}</Label>
              <Input type="file" accept="image/*" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 4))} />
              {files.length > 0 && <p className="text-xs text-muted-foreground mt-1">{files.length} bestand(en) geselecteerd</p>}
              {editingFine?.photos?.length > 0 && <p className="text-xs text-muted-foreground mt-1">{editingFine.photos.length} bestaande foto('s) blijven bewaard.</p>}
              {files.length === 0 && !editingFine?.photos?.length && <p className="text-xs text-destructive mt-1">Minimaal één foto of scan is verplicht.</p>}
            </div>
            <div>
              <Label>Medewerker (optioneel)</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger><SelectValue placeholder="Selecteer medewerker" /></SelectTrigger>
                <SelectContent>
                  {(assignedEmployees ?? []).map((e: any) => {
                    const c = e.candidates as any;
                    return <SelectItem key={e.id} value={e.id}>{c?.first_name} {c?.last_name}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Notities</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={closeSheet}>Annuleren</Button>
              <Button onClick={() => saveMutation.mutate()} disabled={!fineDate || !amount || (files.length === 0 && !editingFine?.photos?.length) || saveMutation.isPending}>
                <Upload className="h-3.5 w-3.5 mr-1" />
                {saveMutation.isPending ? 'Opslaan...' : 'Opslaan'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!fineToDelete} onOpenChange={(o) => { if (!o) setFineToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Boete verwijderen?</AlertDialogTitle>
            <AlertDialogDescription>
              Verwijdert de boete van {fineToDelete && formatDate(fineToDelete.fine_date)} ({fineToDelete && formatEUR(fineToDelete.amount)}). Deze actie kan niet ongedaan worden gemaakt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (fineToDelete) deleteMutation.mutate(fineToDelete); }}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Verwijderen...' : 'Verwijderen'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default VehicleFinesTab;
