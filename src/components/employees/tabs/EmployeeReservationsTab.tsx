import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Plus, Pencil } from 'lucide-react';
import { formatEUR } from '@/lib/format';
import { toast } from 'sonner';

const categoryOptions = [
  { value: 'vakantiegeld', label: 'Vakantiegeld' },
  { value: 'pensioen', label: 'Pensioen' },
  { value: 'sociale_premies', label: 'Sociale premies' },
  { value: 'wga', label: 'WGA' },
  { value: 'overig', label: 'Overig' },
];
const basisOptions = [
  { value: 'bruto_loon', label: 'Bruto loon' },
  { value: 'netto_loon', label: 'Netto loon' },
  { value: 'uurloon', label: 'Uurloon' },
  { value: 'vast_bedrag', label: 'Vast bedrag' },
];
const catBadge: Record<string, string> = { vakantiegeld: 'bg-green-100 text-green-700 border-0', pensioen: 'bg-blue-100 text-blue-700 border-0', sociale_premies: 'bg-purple-100 text-purple-700 border-0', wga: 'bg-orange-100 text-orange-700 border-0', overig: 'bg-muted text-muted-foreground border-0' };
const basisBadge: Record<string, string> = { bruto_loon: 'bg-teal-100 text-teal-700 border-0', netto_loon: 'bg-cyan-100 text-cyan-700 border-0', uurloon: 'bg-indigo-100 text-indigo-700 border-0', vast_bedrag: 'bg-muted text-muted-foreground border-0' };

const emptyForm = { description: '', percentage: '', fixed_amount: '', calculation_base: 'bruto_loon', category: 'overig', start_date: '', end_date: '', is_active: true };

const resolveEmployeeId = async (candidateId: string) => {
  const { data, error } = await supabase
    .from('employees')
    .select('id')
    .eq('candidate_id', candidateId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error('Geen medewerkerrecord gevonden voor deze kandidaat');
  return data.id;
};

const EmployeeReservationsTab = ({ candidateId }: { candidateId: string }) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm] = useState<any>(emptyForm);

  const { data: reservations = [] } = useQuery({
    queryKey: ['reservations', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase.from('employee_reservations').select('*').eq('candidate_id', candidateId).order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const openNew = () => { setEditItem(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (r: any) => {
    setEditItem(r);
    setForm({ description: r.description, percentage: r.percentage?.toString() ?? '', fixed_amount: r.fixed_amount?.toString() ?? '', calculation_base: r.calculation_base ?? 'bruto_loon', category: r.category, start_date: r.start_date, end_date: r.end_date ?? '', is_active: r.is_active });
    setOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        description: form.description,
        percentage: form.percentage ? parseFloat(form.percentage) : null,
        fixed_amount: form.fixed_amount ? parseFloat(form.fixed_amount) : null,
        calculation_base: form.calculation_base,
        category: form.category,
        start_date: form.start_date || new Date().toISOString().split('T')[0],
        end_date: form.end_date || null,
        is_active: form.is_active,
      };
      if (editItem) {
        const { error } = await supabase.from('employee_reservations').update(payload).eq('id', editItem.id);
        if (error) throw error;
      } else {
        const employeeId = await resolveEmployeeId(candidateId);
        const { error } = await supabase.from('employee_reservations').insert({ ...payload, employee_id: employeeId, candidate_id: candidateId, organization_id: orgId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reservations', candidateId] });
      setOpen(false);
      toast.success(editItem ? 'Reservering bijgewerkt' : 'Reservering toegevoegd');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Reserveringen</h3>
        <Button size="sm" variant="outline" onClick={openNew} className="gap-1"><Plus className="h-3.5 w-3.5" />Nieuwe reservering</Button>
      </div>

      {reservations.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">Geen reserveringen</p>
      ) : (
        <div className="bg-card rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Beschrijving</TableHead>
                <TableHead>Percentage</TableHead>
                <TableHead>Vast bedrag</TableHead>
                <TableHead>Basis</TableHead>
                <TableHead>Categorie</TableHead>
                <TableHead>Actief</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reservations.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.description}</TableCell>
                  <TableCell>{r.percentage != null ? `${r.percentage}%` : '—'}</TableCell>
                  <TableCell>{formatEUR(r.fixed_amount)}</TableCell>
                  <TableCell><Badge variant="secondary" className={basisBadge[r.calculation_base] ?? ''}>{basisOptions.find(o => o.value === r.calculation_base)?.label ?? r.calculation_base}</Badge></TableCell>
                  <TableCell><Badge variant="secondary" className={catBadge[r.category] ?? ''}>{categoryOptions.find(o => o.value === r.category)?.label ?? r.category}</Badge></TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={r.is_active ? 'bg-stat-green/10 text-stat-green border-0' : 'bg-muted text-muted-foreground border-0'}>
                      {r.is_active ? 'Actief' : 'Inactief'}
                    </Badge>
                  </TableCell>
                  <TableCell><Button size="icon" variant="ghost" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>{editItem ? 'Reservering bewerken' : 'Nieuwe reservering'}</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6">
            <div><Label>Beschrijving *</Label><Input value={form.description} onChange={e => set('description', e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Percentage (%)</Label><Input type="number" step="0.01" value={form.percentage} onChange={e => set('percentage', e.target.value)} /></div>
              <div><Label>Vast bedrag (€)</Label><Input type="number" step="0.01" value={form.fixed_amount} onChange={e => set('fixed_amount', e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Berekeningsbasis</Label>
                <Select value={form.calculation_base} onValueChange={v => set('calculation_base', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{basisOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Categorie</Label>
                <Select value={form.category} onValueChange={v => set('category', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{categoryOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Startdatum</Label><Input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} /></div>
              <div><Label>Einddatum</Label><Input type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} /></div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={v => set('is_active', v)} />
              <Label>Actief</Label>
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={() => setOpen(false)}>Annuleren</Button>
              <Button onClick={() => saveMutation.mutate()} disabled={!form.description || saveMutation.isPending}>
                {saveMutation.isPending ? 'Opslaan...' : 'Opslaan'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default EmployeeReservationsTab;
