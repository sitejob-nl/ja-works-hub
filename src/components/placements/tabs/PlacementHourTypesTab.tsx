import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Plus, Copy, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props { placementId: string; organizationId: string }

const DEFAULT_HOUR_TYPES = [
  { code: '100', description: 'Normaal (100%)', multiplier: 1, surcharge_amount: 0, is_default: true, sort_order: 1 },
  { code: '130', description: 'Overwerk (130%)', multiplier: 1.3, surcharge_amount: 0, is_default: false, sort_order: 2 },
  { code: '150', description: 'Overwerk (150%)', multiplier: 1.5, surcharge_amount: 0, is_default: false, sort_order: 3 },
  { code: '200', description: 'Overwerk (200%)', multiplier: 2, surcharge_amount: 0, is_default: false, sort_order: 4 },
  { code: 'NACHT', description: 'Nacht', multiplier: 1.3, surcharge_amount: 0, is_default: false, sort_order: 5 },
  { code: 'WKND', description: 'Weekend', multiplier: 1.5, surcharge_amount: 0, is_default: false, sort_order: 6 },
  { code: 'FEEST', description: 'Feestdag', multiplier: 2, surcharge_amount: 0, is_default: false, sort_order: 7 },
];

const PlacementHourTypesTab = ({ placementId, organizationId }: Props) => {
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const { data: hourTypes = [] } = useQuery({
    queryKey: ['placement-hour-types', placementId],
    queryFn: async () => {
      const { data, error } = await supabase.from('placement_hour_types')
        .select('*').eq('placement_id', placementId).order('sort_order');
      if (error) throw error;
      return data;
    },
  });

  const [form, setForm] = useState({ code: '', description: '', multiplier: '1', surcharge_amount: '0', is_default: false, sort_order: '0' });

  const openNew = () => {
    setEditing(null);
    setForm({ code: '', description: '', multiplier: '1', surcharge_amount: '0', is_default: false, sort_order: String(hourTypes.length + 1) });
    setSheetOpen(true);
  };
  const openEdit = (ht: any) => {
    setEditing(ht);
    setForm({ code: ht.code, description: ht.description, multiplier: String(ht.multiplier), surcharge_amount: String(ht.surcharge_amount ?? 0), is_default: ht.is_default ?? false, sort_order: String(ht.sort_order ?? 0) });
    setSheetOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        code: form.code, description: form.description,
        multiplier: parseFloat(form.multiplier), surcharge_amount: parseFloat(form.surcharge_amount) || 0,
        is_default: form.is_default, sort_order: parseInt(form.sort_order) || 0,
        placement_id: placementId, organization_id: organizationId,
      };
      if (editing) {
        const { error } = await supabase.from('placement_hour_types').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('placement_hour_types').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['placement-hour-types', placementId] }); setSheetOpen(false); toast.success('Uurtype opgeslagen'); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('placement_hour_types').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['placement-hour-types', placementId] }); toast.success('Verwijderd'); },
  });

  const copyDefaults = useMutation({
    mutationFn: async () => {
      const rows = DEFAULT_HOUR_TYPES.map(d => ({ ...d, placement_id: placementId, organization_id: organizationId }));
      const { error } = await supabase.from('placement_hour_types').insert(rows);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['placement-hour-types', placementId] }); toast.success('Standaard uurtypes aangemaakt'); },
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" onClick={openNew} className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Uurtype</Button>
        {hourTypes.length === 0 && (
          <Button size="sm" variant="outline" onClick={() => copyDefaults.mutate()} disabled={copyDefaults.isPending} className="gap-1.5">
            <Copy className="h-3.5 w-3.5" /> Kopieer standaard uurtypes
          </Button>
        )}
      </div>

      {hourTypes.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">Nog geen uurtypes geconfigureerd</p>
      ) : (
        <div className="bg-card rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Omschrijving</TableHead>
                <TableHead className="text-right">Multiplier</TableHead>
                <TableHead className="text-right">Toeslag (€)</TableHead>
                <TableHead>Standaard</TableHead>
                <TableHead className="text-right">Volgorde</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {hourTypes.map((ht: any) => (
                <TableRow key={ht.id}>
                  <TableCell className="font-mono font-medium">{ht.code}</TableCell>
                  <TableCell>{ht.description}</TableCell>
                  <TableCell className="text-right">{ht.multiplier}×</TableCell>
                  <TableCell className="text-right">{ht.surcharge_amount ? `€${ht.surcharge_amount.toFixed(2)}` : '—'}</TableCell>
                  <TableCell>{ht.is_default && <Badge variant="secondary" className="bg-stat-green/10 text-stat-green border-0">Standaard</Badge>}</TableCell>
                  <TableCell className="text-right">{ht.sort_order}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(ht)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="text-destructive" onClick={() => deleteMutation.mutate(ht.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>{editing ? 'Uurtype bewerken' : 'Uurtype toevoegen'}</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6">
            <div><Label>Code *</Label><Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="bijv. 150" /></div>
            <div><Label>Omschrijving *</Label><Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div><Label>Multiplier</Label><Input type="number" step="0.1" value={form.multiplier} onChange={e => setForm(f => ({ ...f, multiplier: e.target.value }))} /></div>
            <div><Label>Toeslag bedrag (€)</Label><Input type="number" step="0.01" value={form.surcharge_amount} onChange={e => setForm(f => ({ ...f, surcharge_amount: e.target.value }))} /></div>
            <div><Label>Volgorde</Label><Input type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} /></div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_default} onCheckedChange={v => setForm(f => ({ ...f, is_default: v }))} />
              <Label>Standaard uurtype</Label>
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={() => setSheetOpen(false)}>Annuleren</Button>
              <Button onClick={() => saveMutation.mutate()} disabled={!form.code || !form.description || saveMutation.isPending}>
                {saveMutation.isPending ? 'Opslaan...' : 'Opslaan'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default PlacementHourTypesTab;
