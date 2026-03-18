import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatEUR } from '@/lib/format';

interface Props { placementId: string; organizationId: string }

const FREQ_OPTIONS = [
  { value: 'per_uur', label: 'Per uur' },
  { value: 'per_dag', label: 'Per dag' },
  { value: 'per_week', label: 'Per week' },
  { value: 'per_maand', label: 'Per maand' },
  { value: 'eenmalig', label: 'Eenmalig' },
];

const freqLabel: Record<string, string> = Object.fromEntries(FREQ_OPTIONS.map(o => [o.value, o.label]));

const PlacementAllowancesTab = ({ placementId, organizationId }: Props) => {
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ code: '', description: '', amount: '', frequency: 'per_dag', is_taxable: true, sort_order: '0' });

  const { data: allowances = [] } = useQuery({
    queryKey: ['placement-allowances', placementId],
    queryFn: async () => {
      const { data, error } = await supabase.from('placement_allowances')
        .select('*').eq('placement_id', placementId).order('sort_order');
      if (error) throw error;
      return data;
    },
  });

  const openNew = () => { setEditing(null); setForm({ code: '', description: '', amount: '', frequency: 'per_dag', is_taxable: true, sort_order: String(allowances.length + 1) }); setSheetOpen(true); };
  const openEdit = (a: any) => { setEditing(a); setForm({ code: a.code, description: a.description, amount: String(a.amount), frequency: a.frequency, is_taxable: a.is_taxable ?? true, sort_order: String(a.sort_order ?? 0) }); setSheetOpen(true); };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        code: form.code, description: form.description, amount: parseFloat(form.amount),
        frequency: form.frequency, is_taxable: form.is_taxable, sort_order: parseInt(form.sort_order) || 0,
        placement_id: placementId, organization_id: organizationId,
      };
      if (editing) {
        const { error } = await supabase.from('placement_allowances').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('placement_allowances').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['placement-allowances', placementId] }); setSheetOpen(false); toast.success('Vergoeding opgeslagen'); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('placement_allowances').delete().eq('id', id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['placement-allowances', placementId] }); toast.success('Verwijderd'); },
  });

  return (
    <div className="space-y-4">
      <Button size="sm" onClick={openNew} className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Vergoeding</Button>

      {allowances.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">Nog geen vergoedingen geconfigureerd</p>
      ) : (
        <div className="bg-card rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Omschrijving</TableHead>
                <TableHead className="text-right">Bedrag</TableHead>
                <TableHead>Frequentie</TableHead>
                <TableHead>Belastbaar</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {allowances.map((a: any) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono font-medium">{a.code}</TableCell>
                  <TableCell>{a.description}</TableCell>
                  <TableCell className="text-right">{formatEUR(a.amount)}</TableCell>
                  <TableCell><Badge variant="secondary">{freqLabel[a.frequency] ?? a.frequency}</Badge></TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={a.is_taxable ? 'bg-orange-100 text-orange-600 border-0' : 'bg-stat-green/10 text-stat-green border-0'}>
                      {a.is_taxable ? 'Ja' : 'Nee'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(a)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="text-destructive" onClick={() => deleteMutation.mutate(a.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
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
          <SheetHeader><SheetTitle>{editing ? 'Vergoeding bewerken' : 'Vergoeding toevoegen'}</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6">
            <div><Label>Code *</Label><Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} /></div>
            <div><Label>Omschrijving *</Label><Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div><Label>Bedrag (€) *</Label><Input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
            <div>
              <Label>Frequentie</Label>
              <Select value={form.frequency} onValueChange={v => setForm(f => ({ ...f, frequency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FREQ_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_taxable} onCheckedChange={v => setForm(f => ({ ...f, is_taxable: v }))} />
              <Label>Belastbaar</Label>
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={() => setSheetOpen(false)}>Annuleren</Button>
              <Button onClick={() => saveMutation.mutate()} disabled={!form.code || !form.description || !form.amount || saveMutation.isPending}>
                {saveMutation.isPending ? 'Opslaan...' : 'Opslaan'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default PlacementAllowancesTab;
