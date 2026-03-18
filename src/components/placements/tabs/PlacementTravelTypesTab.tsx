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
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props { placementId: string; organizationId: string }

const PlacementTravelTypesTab = ({ placementId, organizationId }: Props) => {
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ code: '', description: '', rate_per_km: '', fixed_amount: '', max_km_per_day: '', is_taxable: true, sort_order: '0' });

  const { data: types = [] } = useQuery({
    queryKey: ['placement-travel-types', placementId],
    queryFn: async () => {
      const { data, error } = await supabase.from('placement_travel_types')
        .select('*').eq('placement_id', placementId).order('sort_order');
      if (error) throw error;
      return data;
    },
  });

  const openNew = () => { setEditing(null); setForm({ code: '', description: '', rate_per_km: '', fixed_amount: '', max_km_per_day: '', is_taxable: true, sort_order: String(types.length + 1) }); setSheetOpen(true); };
  const openEdit = (t: any) => { setEditing(t); setForm({ code: t.code, description: t.description, rate_per_km: t.rate_per_km?.toString() ?? '', fixed_amount: t.fixed_amount?.toString() ?? '', max_km_per_day: t.max_km_per_day?.toString() ?? '', is_taxable: t.is_taxable ?? true, sort_order: String(t.sort_order ?? 0) }); setSheetOpen(true); };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        code: form.code, description: form.description,
        rate_per_km: form.rate_per_km ? parseFloat(form.rate_per_km) : null,
        fixed_amount: form.fixed_amount ? parseFloat(form.fixed_amount) : null,
        max_km_per_day: form.max_km_per_day ? parseInt(form.max_km_per_day) : null,
        is_taxable: form.is_taxable, sort_order: parseInt(form.sort_order) || 0,
        placement_id: placementId, organization_id: organizationId,
      };
      if (editing) {
        const { error } = await supabase.from('placement_travel_types').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('placement_travel_types').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['placement-travel-types', placementId] }); setSheetOpen(false); toast.success('Reistype opgeslagen'); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('placement_travel_types').delete().eq('id', id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['placement-travel-types', placementId] }); toast.success('Verwijderd'); },
  });

  return (
    <div className="space-y-4">
      <Button size="sm" onClick={openNew} className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Reistype</Button>

      {types.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">Nog geen reistypes geconfigureerd</p>
      ) : (
        <div className="bg-card rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Omschrijving</TableHead>
                <TableHead className="text-right">€/km</TableHead>
                <TableHead className="text-right">Vast (€)</TableHead>
                <TableHead className="text-right">Max km/dag</TableHead>
                <TableHead>Belastbaar</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.map((t: any) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono font-medium">{t.code}</TableCell>
                  <TableCell>{t.description}</TableCell>
                  <TableCell className="text-right">{t.rate_per_km != null ? `€${t.rate_per_km.toFixed(2)}` : '—'}</TableCell>
                  <TableCell className="text-right">{t.fixed_amount != null ? `€${t.fixed_amount.toFixed(2)}` : '—'}</TableCell>
                  <TableCell className="text-right">{t.max_km_per_day ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={t.is_taxable ? 'bg-orange-100 text-orange-600 border-0' : 'bg-stat-green/10 text-stat-green border-0'}>
                      {t.is_taxable ? 'Ja' : 'Nee'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(t)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="text-destructive" onClick={() => deleteMutation.mutate(t.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
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
          <SheetHeader><SheetTitle>{editing ? 'Reistype bewerken' : 'Reistype toevoegen'}</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6">
            <div><Label>Code *</Label><Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} /></div>
            <div><Label>Omschrijving *</Label><Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div><Label>Tarief per km (€)</Label><Input type="number" step="0.01" value={form.rate_per_km} onChange={e => setForm(f => ({ ...f, rate_per_km: e.target.value }))} /></div>
            <div><Label>Vast bedrag (€)</Label><Input type="number" step="0.01" value={form.fixed_amount} onChange={e => setForm(f => ({ ...f, fixed_amount: e.target.value }))} /></div>
            <div><Label>Max km per dag</Label><Input type="number" value={form.max_km_per_day} onChange={e => setForm(f => ({ ...f, max_km_per_day: e.target.value }))} /></div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_taxable} onCheckedChange={v => setForm(f => ({ ...f, is_taxable: v }))} />
              <Label>Belastbaar</Label>
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

export default PlacementTravelTypesTab;
