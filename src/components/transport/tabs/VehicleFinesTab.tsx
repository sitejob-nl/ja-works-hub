import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { unwrap, unwrapList } from '@/lib/db';
import { qk } from '@/lib/query-keys';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { FileText, MoreHorizontal, Pencil, Plus, Trash2, Upload } from 'lucide-react';
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
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { EntityLink } from '@/components/ui/entity-link';

const emptyFine = {
  fine_date: '',
  due_date: '',
  amount: '',
  description: '',
  reference_number: '',
  employee_id: '',
  notes: '',
};

const isImagePath = (path: string) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(path);

const getDueDateBadge = (dueDate: string | null | undefined, paid: boolean) => {
  if (paid) return null;
  if (!dueDate) return null;
  try {
    const days = differenceInCalendarDays(parseISO(dueDate), new Date());
    if (days < 0) return { label: `${Math.abs(days)}d te laat`, className: 'bg-red-100 text-red-600 border-0' };
    if (days <= 7) return { label: `${days}d`, className: 'bg-orange-100 text-orange-600 border-0' };
  } catch {
    return null;
  }
  return null;
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
  const dueDate = form.due_date; const setDueDate = (v: string) => setForm(f => ({ ...f, due_date: v }));
  const amount = form.amount; const setAmount = (v: string) => setForm(f => ({ ...f, amount: v }));
  const description = form.description; const setDescription = (v: string) => setForm(f => ({ ...f, description: v }));
  const referenceNumber = form.reference_number; const setReferenceNumber = (v: string) => setForm(f => ({ ...f, reference_number: v }));
  const employeeId = form.employee_id; const setEmployeeId = (v: string) => setForm(f => ({ ...f, employee_id: v }));
  const notes = form.notes; const setNotes = (v: string) => setForm(f => ({ ...f, notes: v }));

  const { data: fines } = useQuery({
    queryKey: qk.transport.fines(vehicle.id),
    queryFn: () => unwrapList<any>(
      supabase.from('vehicle_fines').select(`
        *,
        candidates!vehicle_fines_candidate_id_fkey(id, first_name, last_name),
        employees!vehicle_fines_employee_id_fkey(id, candidates!employees_candidate_id_fkey(first_name, last_name))
      `).eq('vehicle_id', vehicle.id).order('fine_date', { ascending: false }),
    ),
  });

  const finePhotoPaths = Array.from(
    new Set((fines ?? []).flatMap((fine: any) => (fine.photos ?? []) as string[]))
  );

  const { data: finePhotoUrls = {} } = useQuery({
    queryKey: qk.transport.finePhotoUrls(vehicle.id, finePhotoPaths),
    // Storage signed-URL fan-out blijft rauw (geen unwrap — geen supabase.from-tabel).
    queryFn: async () => {
      const entries = await Promise.all(
        finePhotoPaths.map(async (path) => {
          const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 60 * 10);
          if (error) return [path, null] as const;
          return [path, data.signedUrl] as const;
        })
      );
      return Object.fromEntries(entries.filter(([, url]) => Boolean(url))) as Record<string, string>;
    },
    enabled: finePhotoPaths.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const { data: assignedEmployees } = useQuery({
    queryKey: qk.transport.fineAssignedEmployees(vehicle.id),
    queryFn: async () => {
      const rows = await unwrapList<any>(
        supabase.from('vehicle_assignments').select(`
        candidate_id,
        employees!vehicle_assignments_employee_id_fkey(
          id,
          candidates!employees_candidate_id_fkey(id, first_name, last_name)
        )
      `).eq('vehicle_id', vehicle.id),
      );
      const unique = new Map<string, any>();
      rows.forEach((a: any) => {
        if (a.employees) unique.set(a.employees.id, { ...a.employees, candidate_id: a.candidate_id ?? a.employees.candidates?.id ?? null });
      });
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
      due_date: f.due_date ?? '',
      amount: f.amount != null ? String(f.amount) : '',
      description: f.description ?? '',
      reference_number: f.reference_number ?? '',
      employee_id: f.employee_id ?? '',
      notes: f.notes ?? '',
    });
    setFiles([]);
    setSheetOpen(true);
  };

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

      const selectedEmployee = (assignedEmployees ?? []).find((employee: any) => employee.id === employeeId);
      const payload: any = {
        fine_date: fineDate,
        due_date: dueDate || null,
        amount: parseFloat(amount),
        description: description || null,
        reference_number: referenceNumber || null,
        employee_id: employeeId || null,
        candidate_id: selectedEmployee?.candidate_id ?? editingFine?.candidate_id ?? null,
        notes: notes || null,
        photos: [...existingPhotos, ...newPhotoPaths],
      };
      if (editingId) {
        await unwrap(supabase.from('vehicle_fines').update(payload).eq('id', editingId));
        return editingId;
      } else {
        const data = await unwrap<{ id: string }>(
          supabase.from('vehicle_fines').insert({
            ...payload, organization_id: orgId, vehicle_id: vehicle.id,
          }).select('id').single(),
        );
        return data.id;
      }
    },
    onSuccess: (recordId) => {
      qc.invalidateQueries({ queryKey: qk.transport.fines(vehicle.id) });
      qc.invalidateQueries({ queryKey: qk.transport.allFines() });
      logAudit({ action: editingId ? 'update' : 'create', tableName: 'vehicle_fines', recordId });
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
      await unwrap(supabase.from('vehicle_fines').delete().eq('id', fine.id));
      return fine;
    },
    onSuccess: (fine) => {
      qc.invalidateQueries({ queryKey: qk.transport.fines(vehicle.id) });
      qc.invalidateQueries({ queryKey: qk.transport.allFines() });
      logAudit({ action: 'delete', tableName: 'vehicle_fines', recordId: fine.id });
      toast.success('Boete verwijderd');
      setFineToDelete(null);
    },
    onError: (e: any) => { toast.error(e.message); setFineToDelete(null); },
  });

  const paidMutation = useMutation({
    mutationFn: async ({ id, paid }: { id: string; paid: boolean }) => {
      await unwrap(supabase.from('vehicle_fines').update({
        paid,
        paid_at: paid ? new Date().toISOString() : null,
      }).eq('id', id));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.transport.fines(vehicle.id) });
      qc.invalidateQueries({ queryKey: qk.transport.allFines() });
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
              <TableHead>Uiterste betaaldatum</TableHead>
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
              const c = (f.candidates ?? f.employees?.candidates) as any;
              const dueBadge = getDueDateBadge(f.due_date, f.paid);
              return (
                <TableRow key={f.id}>
                  <TableCell>{formatDate(f.fine_date)}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      <span>{formatDate(f.due_date)}</span>
                      {dueBadge && <Badge variant="secondary" className={`text-[10px] ${dueBadge.className}`}>{dueBadge.label}</Badge>}
                    </span>
                  </TableCell>
                  <TableCell>{formatEUR(f.amount)}</TableCell>
                  <TableCell>{f.description ?? '—'}</TableCell>
                  <TableCell>{f.reference_number ?? '—'}</TableCell>
                  <TableCell>
                    {f.photos?.length > 0 ? (
                      <div className="flex items-center gap-1">
                        {f.photos.slice(0, 2).map((path: string, index: number) => (
                          <a
                            key={path}
                            href={finePhotoUrls[path] ?? undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="h-8 w-8 overflow-hidden rounded border bg-muted text-muted-foreground flex items-center justify-center"
                            onClick={(event) => {
                              if (!finePhotoUrls[path]) {
                                event.preventDefault();
                                toast.error('Bestand wordt nog geladen of is niet beschikbaar');
                              }
                            }}
                            title={`Boete ${index + 1} openen`}
                          >
                            {isImagePath(path) && finePhotoUrls[path] ? (
                              <img src={finePhotoUrls[path]} alt={`Boete ${index + 1}`} className="h-full w-full object-cover" />
                            ) : (
                              <FileText className="h-4 w-4" />
                            )}
                          </a>
                        ))}
                        {f.photos.length > 2 && <span className="text-xs text-muted-foreground">+{f.photos.length - 2}</span>}
                      </div>
                    ) : (
                      <span className="text-xs text-destructive">Ontbreekt</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <EntityLink type="employee" id={f.employees?.id}>
                      {c ? `${c.first_name} ${c.last_name}` : '—'}
                    </EntityLink>
                  </TableCell>
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
              <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Geen boetes geregistreerd</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet open={sheetOpen} onOpenChange={(o) => { if (!o) closeSheet(); else setSheetOpen(o); }}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader><SheetTitle>{editingId ? 'Boete bewerken' : 'Nieuwe boete'}</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6">
            <div><Label>Datum *</Label><Input type="date" value={fineDate} onChange={(e) => setFineDate(e.target.value)} /></div>
            <div><Label>Uiterste betaaldatum</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
            <div><Label>Bedrag (€) *</Label><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div><Label>Beschrijving</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
            <div><Label>Referentienummer</Label><Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} /></div>
            <div>
              <Label>{editingId ? "Extra foto's toevoegen" : "Foto boete *"}</Label>
              <Input type="file" accept="image/*,application/pdf" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 4))} />
              {files.length > 0 && <p className="text-xs text-muted-foreground mt-1">{files.length} bestand(en) geselecteerd</p>}
              {editingFine?.photos?.length > 0 && <p className="text-xs text-muted-foreground mt-1">{editingFine.photos.length} bestaande foto('s) blijven bewaard.</p>}
              {files.length === 0 && !editingFine?.photos?.length && <p className="text-xs text-destructive mt-1">Minimaal één foto of scan is verplicht.</p>}
            </div>
            <div>
              <Label>Medewerker / persoon (optioneel)</Label>
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
