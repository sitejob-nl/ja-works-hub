import { Fragment, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { unwrap } from '@/lib/db';
import { qk } from '@/lib/query-keys';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
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
import { Plus, ChevronDown, ChevronUp, Trash2, Pencil, Layers, X, LayoutGrid, List } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EntityLink } from '@/components/ui/entity-link';
import { formatDate, formatEUR } from '@/lib/format';
import { toast } from 'sonner';
import type { Database } from '@/integrations/supabase/types';

type UnitStatus = Database['public']['Enums']['unit_status'];

const statusBadge: Record<string, string> = {
  beschikbaar: 'bg-stat-green/10 text-stat-green border-0',
  gereserveerd: 'bg-blue-100 text-blue-600 border-0',
  bezet: 'bg-red-100 text-red-600 border-0',
  onderhoud: 'bg-orange-100 text-orange-600 border-0',
  geblokkeerd: 'bg-muted text-muted-foreground border-0',
};

const emptyForm = {
  name: '', capacity: '1', floor: '', weekly_cost: '', status: 'beschikbaar' as UnitStatus, notes: '',
};

interface BulkRow {
  name: string;
  capacity: string;
  floor: string;
  weekly_cost: string;
}

const emptyBulkRow = (): BulkRow => ({ name: '', capacity: '1', floor: '', weekly_cost: '' });

const UnitsTab = ({ property }: { property: any }) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedUnit, setExpandedUnit] = useState<string | null>(null);
  const [unitToDelete, setUnitToDelete] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState<BulkRow[]>(() => [emptyBulkRow(), emptyBulkRow(), emptyBulkRow()]);
  const [view, setView] = useState<'cards' | 'list'>('list');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setSheetOpen(true);
  };

  const openEdit = (u: any) => {
    setEditingId(u.id);
    setForm({
      name: u.name ?? '',
      capacity: String(u.capacity ?? 1),
      floor: u.floor != null ? String(u.floor) : '',
      weekly_cost: u.weekly_cost != null ? String(u.weekly_cost) : '',
      status: (u.status ?? 'beschikbaar') as UnitStatus,
      notes: u.notes ?? '',
    });
    setSheetOpen(true);
  };

  const saveUnit = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        capacity: Number(form.capacity) || 1,
        floor: form.floor ? Number(form.floor) : null,
        weekly_cost: form.weekly_cost ? Number(form.weekly_cost) : null,
        status: form.status,
        notes: form.notes || null,
      };
      if (editingId) {
        await unwrap(supabase.from('units').update(payload).eq('id', editingId));
      } else {
        await unwrap(supabase.from('units').insert({
          ...payload,
          organization_id: orgId,
          property_id: property.id,
        }));
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.housing.property(property.id) });
      qc.invalidateQueries({ queryKey: ['properties'] });
      const wasEdit = editingId !== null;
      setSheetOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      toast.success(wasEdit ? 'Kamer bijgewerkt' : 'Kamer aangemaakt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteUnit = useMutation({
    mutationFn: async (unitId: string) => {
      // Pre-check: weiger als er bewoner-records (actief of historisch) hangen
      // eslint-disable-next-line no-restricted-syntax -- count-query (head:true) levert `count`, niet `data` → unwrap past niet
      const { count, error: countErr } = await supabase
        .from('housing_assignments')
        .select('id', { count: 'exact', head: true })
        .eq('unit_id', unitId);
      if (countErr) throw countErr;
      if ((count ?? 0) > 0) {
        throw new Error(`Kamer heeft nog ${count} bewoner-record(s). Deze blokkeren de verwijdering.`);
      }
      // Cascades naar housing_inspections + key_registrations via FK
      await unwrap(supabase.from('units').delete().eq('id', unitId));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.housing.property(property.id) });
      qc.invalidateQueries({ queryKey: ['properties'] });
      toast.success('Kamer verwijderd');
      setUnitToDelete(null);
    },
    onError: (e: any) => {
      toast.error(e.message);
      setUnitToDelete(null);
    },
  });

  const bulkAdd = useMutation({
    mutationFn: async () => {
      const valid = bulkRows
        .map((r) => ({ ...r, name: r.name.trim() }))
        .filter((r) => r.name.length > 0);
      if (valid.length === 0) throw new Error('Geef minstens één kamernaam op.');

      const names = valid.map((r) => r.name);
      if (new Set(names).size !== names.length) {
        throw new Error('Dubbele kamernamen — elke kamer moet uniek zijn binnen dit pand.');
      }

      const existing = (property.units ?? []).map((u: any) => u.name);
      const conflict = names.filter((n) => existing.includes(n));
      if (conflict.length > 0) {
        throw new Error(`Kamer(s) bestaan al in dit pand: ${conflict.join(', ')}`);
      }

      const payload = valid.map((r) => ({
        organization_id: orgId,
        property_id: property.id,
        name: r.name,
        capacity: Number(r.capacity) || 1,
        floor: r.floor ? Number(r.floor) : null,
        weekly_cost: r.weekly_cost ? Number(r.weekly_cost) : null,
        status: 'beschikbaar' as UnitStatus,
      }));
      await unwrap(supabase.from('units').insert(payload));
      return valid.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: qk.housing.property(property.id) });
      qc.invalidateQueries({ queryKey: ['properties'] });
      setBulkOpen(false);
      setBulkRows([emptyBulkRow(), emptyBulkRow(), emptyBulkRow()]);
      toast.success(`${count} kamer${count === 1 ? '' : 's'} aangemaakt`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateBulkRow = (i: number, patch: Partial<BulkRow>) => {
    setBulkRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const addBulkRow = () => setBulkRows((rows) => [...rows, emptyBulkRow()]);
  const removeBulkRow = (i: number) => setBulkRows((rows) => rows.length === 1 ? [emptyBulkRow()] : rows.filter((_, idx) => idx !== i));

  const units = [...(property.units ?? [])].sort((a: any, b: any) =>
    String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { numeric: true, sensitivity: 'base' })
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-2 flex-wrap">
        <h3 className="font-medium">Kamers ({units.length})</h3>
        <div className="flex gap-2 items-center">
          <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as 'cards' | 'list')}>
            <ToggleGroupItem value="cards" aria-label="Kaarten"><LayoutGrid className="h-4 w-4" /></ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="Lijst"><List className="h-4 w-4" /></ToggleGroupItem>
          </ToggleGroup>
          <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)} className="gap-1">
            <Layers className="h-3.5 w-3.5" /> Meerdere kamers
          </Button>
          <Button size="sm" variant="outline" onClick={openAdd} className="gap-1">
            <Plus className="h-3.5 w-3.5" /> Nieuwe kamer
          </Button>
        </div>
      </div>

      <Sheet open={bulkOpen} onOpenChange={(o) => { if (!o) setBulkRows([emptyBulkRow(), emptyBulkRow(), emptyBulkRow()]); setBulkOpen(o); }}>
        <SheetContent className="sm:max-w-2xl overflow-y-auto">
          <SheetHeader><SheetTitle>Meerdere kamers toevoegen</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6">
            <p className="text-sm text-muted-foreground">
              Voeg meerdere kamers tegelijk toe. Alleen rijen met een ingevulde naam worden opgeslagen.
              Status wordt 'beschikbaar' — pas aan via de kamerkaart na opslaan.
            </p>
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_80px_80px_120px_32px] gap-2 text-xs text-muted-foreground font-medium px-1">
                <span>Naam *</span>
                <span>Capaciteit</span>
                <span>Verdieping</span>
                <span>Weekprijs (€)</span>
                <span></span>
              </div>
              {bulkRows.map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr_80px_80px_120px_32px] gap-2 items-center">
                  <Input
                    value={r.name}
                    onChange={(e) => updateBulkRow(i, { name: e.target.value })}
                    placeholder="Bijv. 1.1"
                  />
                  <Input
                    type="number"
                    value={r.capacity}
                    onChange={(e) => updateBulkRow(i, { capacity: e.target.value })}
                    min="1"
                  />
                  <Input
                    type="number"
                    value={r.floor}
                    onChange={(e) => updateBulkRow(i, { floor: e.target.value })}
                    placeholder="0=BG"
                  />
                  <Input
                    type="number"
                    value={r.weekly_cost}
                    onChange={(e) => updateBulkRow(i, { weekly_cost: e.target.value })}
                    placeholder="optioneel"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeBulkRow(i)}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    title="Rij verwijderen"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <Button size="sm" variant="ghost" onClick={addBulkRow} className="gap-1">
              <Plus className="h-3.5 w-3.5" /> Rij toevoegen
            </Button>
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="ghost" onClick={() => { setBulkOpen(false); setBulkRows([emptyBulkRow(), emptyBulkRow(), emptyBulkRow()]); }}>
                Annuleren
              </Button>
              <Button onClick={() => bulkAdd.mutate()} disabled={bulkAdd.isPending}>
                {bulkAdd.isPending ? 'Opslaan...' : `Opslaan (${bulkRows.filter((r) => r.name.trim()).length})`}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={sheetOpen} onOpenChange={(o) => { if (!o) { setEditingId(null); setForm(emptyForm); } setSheetOpen(o); }}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>{editingId ? 'Kamer bewerken' : 'Nieuwe kamer'}</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6">
            <div><Label>Kamernaam *</Label><Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Capaciteit</Label><Input type="number" value={form.capacity} onChange={(e) => setForm(f => ({ ...f, capacity: e.target.value }))} /></div>
              <div><Label>Verdieping</Label><Input type="number" value={form.floor} onChange={(e) => setForm(f => ({ ...f, floor: e.target.value }))} /></div>
            </div>
            <div><Label>Weekprijs (€)</Label><Input type="number" value={form.weekly_cost} onChange={(e) => setForm(f => ({ ...f, weekly_cost: e.target.value }))} className="max-w-xs" /></div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm(f => ({ ...f, status: v as UnitStatus }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="beschikbaar">Beschikbaar</SelectItem>
                  <SelectItem value="gereserveerd">Gereserveerd</SelectItem>
                  <SelectItem value="bezet">Bezet</SelectItem>
                  <SelectItem value="onderhoud">Onderhoud</SelectItem>
                  <SelectItem value="geblokkeerd">Geblokkeerd</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Notities</Label><Textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={() => { setSheetOpen(false); setEditingId(null); setForm(emptyForm); }}>Annuleren</Button>
              <Button onClick={() => saveUnit.mutate()} disabled={!form.name || saveUnit.isPending}>
                {saveUnit.isPending ? 'Opslaan...' : 'Opslaan'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {view === 'cards' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {units.map((u: any) => {
            const assignments = u.housing_assignments ?? [];
            const occupants = assignments.filter((a: any) => a.status === 'ingecheckt');
            const occupied = occupants.length;
            const isExpanded = expandedUnit === u.id;

            return (
              <div key={u.id} className="bg-card rounded-lg border">
                <button
                  onClick={() => setExpandedUnit(isExpanded ? null : u.id)}
                  className="w-full text-left p-4 flex items-start justify-between"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-sm">{u.name}</p>
                      <Badge variant="secondary" className={`text-xs ${statusBadge[u.status] ?? ''}`}>{u.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{occupied}/{u.capacity} bezet</p>
                    {u.weekly_cost && <p className="text-xs text-muted-foreground">{formatEUR(u.weekly_cost)}/week</p>}
                    {u.floor != null && <p className="text-xs text-muted-foreground">Verdieping {u.floor}</p>}
                    {occupants.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {occupants.map((a: any) => (
                          <p key={a.id} className="text-xs">
                            <EntityLink type="candidate" id={a.candidates?.id} className="font-medium text-foreground hover:text-stat-blue">{a.candidates?.first_name} {a.candidates?.last_name}</EntityLink>
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                  {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                </button>

                {isExpanded && (
                  <div className="border-t px-4 py-3 space-y-3">
                    <p className="text-xs font-medium text-muted-foreground uppercase">Toewijzingshistorie</p>
                    {assignments.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Geen toewijzingen</p>
                    ) : (
                      assignments.map((a: any) => (
                        <div key={a.id} className="text-xs flex items-center justify-between">
                          <span><EntityLink type="candidate" id={a.candidates?.id} className="font-medium text-foreground hover:text-stat-blue">{a.candidates?.first_name} {a.candidates?.last_name}</EntityLink></span>
                          <span className="text-muted-foreground">
                            {formatDate(a.check_in_date)} — {a.check_out_date ? formatDate(a.check_out_date) : 'heden'}
                            {' '}
                            <Badge variant="secondary" className={`text-[10px] ${a.status === 'ingecheckt' ? 'bg-stat-green/10 text-stat-green border-0' : a.status === 'gereserveerd' ? 'bg-blue-100 text-blue-700 border-0' : 'bg-muted text-muted-foreground border-0'}`}>
                              {a.status}
                            </Badge>
                          </span>
                        </div>
                      ))
                    )}
                    <div className="flex justify-end gap-2 pt-2 border-t">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEdit(u)}
                        className="h-7 gap-1.5 text-xs"
                      >
                        <Pencil className="h-3 w-3" /> Bewerken
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setUnitToDelete({ id: u.id, name: u.name })}
                        disabled={assignments.length > 0}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 gap-1.5 text-xs"
                        title={assignments.length > 0 ? 'Kan niet verwijderen — kamer heeft toewijzingshistorie' : 'Kamer verwijderen'}
                      >
                        <Trash2 className="h-3 w-3" /> Verwijderen
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {view === 'list' && units.length > 0 && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kamer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Bezet</TableHead>
                <TableHead className="text-right">Verdieping</TableHead>
                <TableHead className="text-right">Per week</TableHead>
                <TableHead>Bewoners</TableHead>
                <TableHead className="text-right">Acties</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {units.map((u: any) => {
                const assignments = u.housing_assignments ?? [];
                const occupants = assignments.filter((a: any) => a.status === 'ingecheckt');
                const occupied = occupants.length;
                const isExpanded = expandedRow === u.id;

                return (
                  <Fragment key={u.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpandedRow(isExpanded ? null : u.id)}
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1.5">
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                          {u.name}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={`text-xs ${statusBadge[u.status] ?? ''}`}>{u.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm">{occupied}/{u.capacity}</TableCell>
                      <TableCell className="text-right text-sm">{u.floor != null ? u.floor : '—'}</TableCell>
                      <TableCell className="text-right text-sm">{u.weekly_cost ? formatEUR(u.weekly_cost) : '—'}</TableCell>
                      <TableCell className="text-sm">
                        {occupants.length === 0
                          ? <span className="text-muted-foreground">—</span>
                          : occupants.map((a: any, i: number) => (
                              <Fragment key={a.id}>
                                {i > 0 && ', '}
                                <EntityLink type="candidate" id={a.candidates?.id} className="font-medium text-foreground hover:text-stat-blue">{`${a.candidates?.first_name ?? ''} ${a.candidates?.last_name ?? ''}`.trim()}</EntityLink>
                              </Fragment>
                            ))}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEdit(u)}
                            className="h-7 gap-1.5 text-xs"
                          >
                            <Pencil className="h-3 w-3" /> Bewerken
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setUnitToDelete({ id: u.id, name: u.name })}
                            disabled={assignments.length > 0}
                            className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 gap-1.5 text-xs"
                            title={assignments.length > 0 ? 'Kan niet verwijderen — kamer heeft toewijzingshistorie' : 'Kamer verwijderen'}
                          >
                            <Trash2 className="h-3 w-3" /> Verwijderen
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={7} className="py-3">
                          <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Toewijzingshistorie</p>
                          {assignments.length === 0 ? (
                            <p className="text-xs text-muted-foreground">Geen toewijzingen</p>
                          ) : (
                            <div className="space-y-1">
                              {assignments.map((a: any) => (
                                <div key={a.id} className="text-xs flex items-center justify-between">
                                  <span><EntityLink type="candidate" id={a.candidates?.id} className="font-medium text-foreground hover:text-stat-blue">{a.candidates?.first_name} {a.candidates?.last_name}</EntityLink></span>
                                  <span className="text-muted-foreground">
                                    {formatDate(a.check_in_date)} — {a.check_out_date ? formatDate(a.check_out_date) : 'heden'}
                                    {' '}
                                    <Badge variant="secondary" className={`text-[10px] ${a.status === 'ingecheckt' ? 'bg-stat-green/10 text-stat-green border-0' : a.status === 'gereserveerd' ? 'bg-blue-100 text-blue-700 border-0' : 'bg-muted text-muted-foreground border-0'}`}>
                                      {a.status}
                                    </Badge>
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {units.length === 0 && <p className="text-center text-muted-foreground py-8">Nog geen kamers. Voeg een kamer toe.</p>}

      <AlertDialog open={!!unitToDelete} onOpenChange={(o) => !o && setUnitToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kamer "{unitToDelete?.name}" verwijderen?</AlertDialogTitle>
            <AlertDialogDescription>
              Dit verwijdert de kamer inclusief eventuele inspecties en sleutelregistraties.
              Bewoner-records blokkeren de verwijdering. Deze actie kan niet ongedaan worden gemaakt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (unitToDelete) deleteUnit.mutate(unitToDelete.id); }}
              disabled={deleteUnit.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteUnit.isPending ? 'Verwijderen...' : 'Verwijderen'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default UnitsTab;
