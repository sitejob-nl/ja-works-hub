import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { FileText, Pencil, Search, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { formatDate, formatEUR } from '@/lib/format';
import { logAudit } from '@/lib/audit';

const NO_EMPLOYEE_VALUE = '__none__';

const emptyEditForm = {
  vehicle_id: '',
  employee_id: NO_EMPLOYEE_VALUE,
  fine_date: '',
  due_date: '',
  amount: '',
  reference_number: '',
  description: '',
  notes: '',
};

const isImagePath = (path: string) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(path);

const isFineOverdue = (fine: any) => {
  if (fine.paid || !fine.due_date) return false;
  try {
    return differenceInCalendarDays(parseISO(fine.due_date), new Date()) < 0;
  } catch {
    return false;
  }
};

const dueBadge = (fine: any) => {
  if (fine.paid || !fine.due_date) return null;
  try {
    const days = differenceInCalendarDays(parseISO(fine.due_date), new Date());
    if (days < 0) return { label: `${Math.abs(days)}d te laat`, className: 'bg-red-100 text-red-600 border-0' };
    if (days <= 7) return { label: `${days}d`, className: 'bg-orange-100 text-orange-600 border-0' };
  } catch {
    return null;
  }
  return null;
};

const getPerson = (fine: any) => fine.candidates ?? fine.employees?.candidates ?? null;

const TransportFinesTab = () => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('open');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingFine, setEditingFine] = useState<any | null>(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [editFiles, setEditFiles] = useState<File[]>([]);

  const setEdit = (key: keyof typeof emptyEditForm, value: string) => {
    setEditForm((form) => ({ ...form, [key]: value }));
  };

  const { data: fines = [], isLoading } = useQuery({
    queryKey: ['transport-fines'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicle_fines').select(`
        *,
        vehicles!vehicle_fines_vehicle_id_fkey(id, license_plate, brand, model),
        candidates!vehicle_fines_candidate_id_fkey(id, first_name, last_name),
        employees!vehicle_fines_employee_id_fkey(id, candidates!employees_candidate_id_fkey(id, first_name, last_name))
      `)
        .order('paid', { ascending: true })
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('fine_date', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const finePhotoPaths = Array.from(
    new Set(fines.flatMap((fine: any) => (fine.photos ?? []) as string[]))
  );

  const { data: finePhotoUrls = {} } = useQuery({
    queryKey: ['transport-fine-photo-urls', finePhotoPaths],
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

  const { data: vehicles = [] } = useQuery({
    queryKey: ['transport-fine-edit-vehicles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, license_plate, brand, model')
        .order('license_plate');
      if (error) throw error;
      return data ?? [];
    },
    enabled: sheetOpen,
  });

  const { data: employees = [] } = useQuery({
    queryKey: ['transport-fine-edit-employees'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('id, candidate_id, candidates!employees_candidate_id_fkey(id, first_name, last_name, employee_number)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return ((data ?? []) as any[]).sort((a, b) => {
        const aName = `${a.candidates?.last_name ?? ''} ${a.candidates?.first_name ?? ''}`.trim();
        const bName = `${b.candidates?.last_name ?? ''} ${b.candidates?.first_name ?? ''}`.trim();
        return aName.localeCompare(bName, 'nl');
      });
    },
    enabled: sheetOpen,
  });

  const closeSheet = () => {
    setSheetOpen(false);
    setEditingFine(null);
    setEditForm(emptyEditForm);
    setEditFiles([]);
  };

  const openEdit = (fine: any) => {
    setEditingFine(fine);
    setEditForm({
      vehicle_id: fine.vehicle_id ?? fine.vehicles?.id ?? '',
      employee_id: fine.employee_id ?? NO_EMPLOYEE_VALUE,
      fine_date: fine.fine_date ?? '',
      due_date: fine.due_date ?? '',
      amount: fine.amount != null ? String(fine.amount) : '',
      reference_number: fine.reference_number ?? '',
      description: fine.description ?? '',
      notes: fine.notes ?? '',
    });
    setEditFiles([]);
    setSheetOpen(true);
  };

  const paidMutation = useMutation({
    mutationFn: async ({ id, paid }: { id: string; paid: boolean }) => {
      const { error } = await supabase.from('vehicle_fines').update({
        paid,
        paid_at: paid ? new Date().toISOString() : null,
      }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport-fines'] });
      qc.invalidateQueries({ queryKey: ['vehicle-fines'] });
      toast.success('Betaalstatus bijgewerkt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editingFine) return;
      const employeeId = editForm.employee_id === NO_EMPLOYEE_VALUE ? null : editForm.employee_id;
      const selectedEmployee = employeeId ? (employees as any[]).find((employee) => employee.id === employeeId) : null;
      const existingPhotos = (editingFine.photos ?? []) as string[];
      const newPhotoPaths: string[] = [];

      for (const file of editFiles) {
        const ext = file.name.split('.').pop() ?? 'jpg';
        const path = `${orgId}/vehicle-fines/${editForm.vehicle_id}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from('documents').upload(path, file);
        if (error) throw error;
        newPhotoPaths.push(path);
      }

      const { error } = await supabase.from('vehicle_fines').update({
        vehicle_id: editForm.vehicle_id,
        employee_id: employeeId,
        candidate_id: employeeId
          ? selectedEmployee?.candidate_id ?? editingFine.candidate_id ?? getPerson(editingFine)?.id ?? null
          : null,
        fine_date: editForm.fine_date,
        due_date: editForm.due_date || null,
        amount: parseFloat(editForm.amount),
        reference_number: editForm.reference_number || null,
        description: editForm.description || null,
        notes: editForm.notes || null,
        photos: [...existingPhotos, ...newPhotoPaths],
      }).eq('id', editingFine.id);
      if (error) throw error;
      return editingFine.id;
    },
    onSuccess: (recordId) => {
      qc.invalidateQueries({ queryKey: ['transport-fines'] });
      qc.invalidateQueries({ queryKey: ['vehicle-fines'] });
      logAudit({ action: 'update', tableName: 'vehicle_fines', recordId });
      toast.success('Boete bijgewerkt');
      closeSheet();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const filteredFines = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return fines.filter((fine: any) => {
      const vehicle = fine.vehicles;
      const person = getPerson(fine);
      const haystack = [
        vehicle?.license_plate,
        vehicle?.brand,
        vehicle?.model,
        person?.first_name,
        person?.last_name,
        fine.description,
        fine.reference_number,
      ].filter(Boolean).join(' ').toLowerCase();

      const matchesSearch = !needle || haystack.includes(needle);
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'open' && !fine.paid) ||
        (statusFilter === 'overdue' && isFineOverdue(fine)) ||
        (statusFilter === 'paid' && fine.paid);

      return matchesSearch && matchesStatus;
    });
  }, [fines, search, statusFilter]);

  const stats = useMemo(() => {
    const open = fines.filter((fine: any) => !fine.paid);
    const overdue = fines.filter(isFineOverdue);
    return {
      total: fines.length,
      open: open.length,
      overdue: overdue.length,
      openAmount: open.reduce((sum: number, fine: any) => sum + Number(fine.amount ?? 0), 0),
    };
  }, [fines]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border rounded-lg p-3">
          <div className="text-xs text-muted-foreground">Totaal boetes</div>
          <div className="text-lg font-semibold">{stats.total}</div>
        </div>
        <div className="bg-card border rounded-lg p-3">
          <div className="text-xs text-muted-foreground">Openstaand</div>
          <div className="text-lg font-semibold">{stats.open}</div>
        </div>
        <div className={`bg-card border rounded-lg p-3 ${stats.overdue > 0 ? 'border-destructive bg-destructive/5' : ''}`}>
          <div className="text-xs text-muted-foreground">Over deadline</div>
          <div className={`text-lg font-semibold ${stats.overdue > 0 ? 'text-destructive' : ''}`}>{stats.overdue}</div>
        </div>
        <div className="bg-card border rounded-lg p-3">
          <div className="text-xs text-muted-foreground">Open bedrag</div>
          <div className="text-lg font-semibold">{formatEUR(stats.openAmount)}</div>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Zoek op kenteken, persoon, referentie..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Openstaand</SelectItem>
            <SelectItem value="overdue">Over deadline</SelectItem>
            <SelectItem value="paid">Betaald</SelectItem>
            <SelectItem value="all">Alle boetes</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{filteredFines.length} boete(s)</span>
      </div>

      <div className="bg-card rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Boetedatum</TableHead>
              <TableHead>Uiterste betaaldatum</TableHead>
              <TableHead>Auto</TableHead>
              <TableHead>Persoon</TableHead>
              <TableHead>Referentie</TableHead>
              <TableHead>Beschrijving</TableHead>
              <TableHead>Bijlage</TableHead>
              <TableHead className="text-right">Bedrag</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredFines.map((fine: any) => {
              const vehicle = fine.vehicles;
              const person = getPerson(fine);
              const badge = dueBadge(fine);
              const firstPhoto = fine.photos?.[0] as string | undefined;
              const photoUrl = firstPhoto ? finePhotoUrls[firstPhoto] : null;

              return (
                <TableRow key={fine.id}>
                  <TableCell>{formatDate(fine.fine_date)}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      <span>{formatDate(fine.due_date)}</span>
                      {badge && <Badge variant="secondary" className={`text-[10px] ${badge.className}`}>{badge.label}</Badge>}
                    </span>
                  </TableCell>
                  <TableCell>
                    {vehicle ? (
                      <Link to={`/transport/${vehicle.id}`} className="font-medium text-primary hover:underline">
                        {vehicle.license_plate}
                        <span className="block text-xs text-muted-foreground font-normal">{[vehicle.brand, vehicle.model].filter(Boolean).join(' ')}</span>
                      </Link>
                    ) : '—'}
                  </TableCell>
                  <TableCell>
                    {person ? (
                      <Link to={`/medewerkers/${person.id}`} className="text-primary hover:underline">
                        {person.first_name} {person.last_name}
                      </Link>
                    ) : <span className="text-muted-foreground">Niet gekoppeld</span>}
                  </TableCell>
                  <TableCell>{fine.reference_number ?? '—'}</TableCell>
                  <TableCell className="max-w-[220px]">
                    <span className="truncate block" title={fine.description ?? ''}>{fine.description ?? '—'}</span>
                  </TableCell>
                  <TableCell>
                    {firstPhoto ? (
                      <a
                        href={photoUrl ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-8 w-8 overflow-hidden rounded border bg-muted text-muted-foreground flex items-center justify-center"
                        onClick={(event) => {
                          if (!photoUrl) {
                            event.preventDefault();
                            toast.error('Bestand wordt nog geladen of is niet beschikbaar');
                          }
                        }}
                        title="Boete openen"
                      >
                        {isImagePath(firstPhoto) && photoUrl ? (
                          <img src={photoUrl} alt="Boete" className="h-full w-full object-cover" />
                        ) : (
                          <FileText className="h-4 w-4" />
                        )}
                      </a>
                    ) : (
                      <span className="text-xs text-destructive">Ontbreekt</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">{formatEUR(fine.amount)}</TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={`cursor-pointer ${fine.paid ? 'bg-stat-green/10 text-stat-green border-0' : 'bg-red-100 text-red-600 border-0'}`}
                      onClick={() => paidMutation.mutate({ id: fine.id, paid: !fine.paid })}
                    >
                      {fine.paid ? 'Betaald' : 'Niet betaald'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={() => openEdit(fine)}>
                      <Pencil className="h-3.5 w-3.5" />
                      Bewerken
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {!isLoading && filteredFines.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                  Geen boetes gevonden
                </TableCell>
              </TableRow>
            )}
            {isLoading && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                  Boetes laden...
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet open={sheetOpen} onOpenChange={(open) => { if (!open) closeSheet(); else setSheetOpen(open); }}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Boete bewerken</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Boetedatum *</Label>
                <Input type="date" value={editForm.fine_date} onChange={(e) => setEdit('fine_date', e.target.value)} />
              </div>
              <div>
                <Label>Uiterste betaaldatum</Label>
                <Input type="date" value={editForm.due_date} onChange={(e) => setEdit('due_date', e.target.value)} />
              </div>
            </div>

            <div>
              <Label>Auto *</Label>
              <Select value={editForm.vehicle_id} onValueChange={(value) => setEdit('vehicle_id', value)}>
                <SelectTrigger><SelectValue placeholder="Selecteer auto" /></SelectTrigger>
                <SelectContent>
                  {vehicles.map((vehicle: any) => (
                    <SelectItem key={vehicle.id} value={vehicle.id}>
                      {vehicle.license_plate} {[vehicle.brand, vehicle.model].filter(Boolean).join(' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Persoon</Label>
              <Select value={editForm.employee_id} onValueChange={(value) => setEdit('employee_id', value)}>
                <SelectTrigger><SelectValue placeholder="Selecteer persoon" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_EMPLOYEE_VALUE}>Niet gekoppeld</SelectItem>
                  {employees.map((employee: any) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.candidates?.first_name} {employee.candidates?.last_name}
                      {employee.candidates?.employee_number ? ` #${employee.candidates.employee_number}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Bedrag (€) *</Label>
              <Input type="number" step="0.01" value={editForm.amount} onChange={(e) => setEdit('amount', e.target.value)} />
            </div>

            <div>
              <Label>Referentie</Label>
              <Input value={editForm.reference_number} onChange={(e) => setEdit('reference_number', e.target.value)} />
            </div>

            <div>
              <Label>Beschrijving</Label>
              <Input value={editForm.description} onChange={(e) => setEdit('description', e.target.value)} />
            </div>

            <div>
              <Label>Extra bijlagen toevoegen</Label>
              <Input type="file" accept="image/*,application/pdf" multiple onChange={(e) => setEditFiles(Array.from(e.target.files ?? []).slice(0, 4))} />
              {editingFine?.photos?.length > 0 && <p className="text-xs text-muted-foreground mt-1">{editingFine.photos.length} bestaande bijlage(n) blijven bewaard.</p>}
              {editFiles.length > 0 && <p className="text-xs text-muted-foreground mt-1">{editFiles.length} nieuw bestand(en) geselecteerd.</p>}
            </div>

            <div>
              <Label>Notities</Label>
              <Textarea value={editForm.notes} onChange={(e) => setEdit('notes', e.target.value)} rows={3} />
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="ghost" onClick={closeSheet}>Annuleren</Button>
              <Button
                onClick={() => updateMutation.mutate()}
                disabled={!editForm.vehicle_id || !editForm.fine_date || !editForm.amount || updateMutation.isPending}
              >
                <Upload className="h-3.5 w-3.5 mr-1" />
                {updateMutation.isPending ? 'Opslaan...' : 'Opslaan'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default TransportFinesTab;
