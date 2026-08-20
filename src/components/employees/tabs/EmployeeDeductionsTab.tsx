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
import { SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Progress } from '@/components/ui/progress';
import { Plus, Pencil } from 'lucide-react';
import { formatDate, formatEUR } from '@/lib/format';
import { toast } from 'sonner';
import { GuardedSheet, useDirtyForm } from '@/components/shared/UnsavedCloseGuard';

const frequencyOptions = [
  { value: 'eenmalig', label: 'Eenmalig' },
  { value: 'wekelijks', label: 'Wekelijks' },
  { value: 'maandelijks', label: 'Maandelijks' },
  { value: 'per_periode', label: 'Per periode' },
];
const categoryOptions = [
  { value: 'huisvesting', label: 'Huisvesting' },
  { value: 'boete', label: 'Boete' },
  { value: 'voorschot', label: 'Voorschot' },
  { value: 'zorgverzekering', label: 'Zorgverzekering' },
  { value: 'transport', label: 'Transport' },
  { value: 'overig', label: 'Overig' },
];

const freqBadge: Record<string, string> = { eenmalig: 'bg-muted text-muted-foreground border-0', wekelijks: 'bg-blue-100 text-blue-700 border-0', maandelijks: 'bg-purple-100 text-purple-700 border-0', per_periode: 'bg-orange-100 text-orange-700 border-0' };
const catBadge: Record<string, string> = { huisvesting: 'bg-teal-100 text-teal-700 border-0', boete: 'bg-red-100 text-red-600 border-0', voorschot: 'bg-yellow-100 text-yellow-700 border-0', zorgverzekering: 'bg-green-100 text-green-700 border-0', transport: 'bg-blue-100 text-blue-700 border-0', overig: 'bg-muted text-muted-foreground border-0' };

const emptyForm = { description: '', amount: '', frequency: 'maandelijks', category: 'overig', start_date: '', end_date: '', total_amount: '', is_active: true };

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

const EmployeeDeductionsTab = ({ candidateId }: { candidateId: string }) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm, formDirty] = useDirtyForm<any>(emptyForm);

  const { data: deductions = [] } = useQuery({
    queryKey: ['deductions', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase.from('employee_deductions').select('*').eq('candidate_id', candidateId).order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const openNew = () => { setEditItem(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (d: any) => {
    setEditItem(d);
    setForm({ description: d.description, amount: d.amount.toString(), frequency: d.frequency, category: d.category, start_date: d.start_date, end_date: d.end_date ?? '', total_amount: d.total_amount?.toString() ?? '', is_active: d.is_active });
    setOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        description: form.description, amount: parseFloat(form.amount), frequency: form.frequency,
        category: form.category, start_date: form.start_date || new Date().toISOString().split('T')[0],
        end_date: form.end_date || null, total_amount: form.total_amount ? parseFloat(form.total_amount) : null,
        is_active: form.is_active,
      };
      if (editItem) {
        const { error } = await supabase.from('employee_deductions').update(payload).eq('id', editItem.id);
        if (error) throw error;
      } else {
        const employeeId = await resolveEmployeeId(candidateId);
        const { error } = await supabase.from('employee_deductions').insert({ ...payload, employee_id: employeeId, candidate_id: candidateId, organization_id: orgId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deductions', candidateId] });
      setOpen(false);
      toast.success(editItem ? 'Inhouding bijgewerkt' : 'Inhouding toegevoegd');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Inhoudingen</h3>
        <Button size="sm" variant="outline" onClick={openNew} className="gap-1"><Plus className="h-3.5 w-3.5" />Nieuwe inhouding</Button>
      </div>

      {deductions.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">Geen inhoudingen</p>
      ) : (
        <div className="bg-card rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Beschrijving</TableHead>
                <TableHead>Bedrag</TableHead>
                <TableHead>Frequentie</TableHead>
                <TableHead>Categorie</TableHead>
                <TableHead>Periode</TableHead>
                <TableHead>Voortgang</TableHead>
                <TableHead>Actief</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deductions.map((d: any) => {
                const progress = d.total_amount && d.total_amount > 0 ? Math.min(100, ((d.deducted_amount ?? 0) / d.total_amount) * 100) : null;
                return (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.description}</TableCell>
                    <TableCell>{formatEUR(d.amount)}</TableCell>
                    <TableCell><Badge variant="secondary" className={freqBadge[d.frequency] ?? ''}>{frequencyOptions.find(o => o.value === d.frequency)?.label ?? d.frequency}</Badge></TableCell>
                    <TableCell><Badge variant="secondary" className={catBadge[d.category] ?? ''}>{categoryOptions.find(o => o.value === d.category)?.label ?? d.category}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(d.start_date)} — {formatDate(d.end_date)}</TableCell>
                    <TableCell>
                      {progress !== null ? (
                        <div className="w-24 space-y-1">
                          <Progress value={progress} className="h-1.5" />
                          <p className="text-xs text-muted-foreground">{formatEUR(d.deducted_amount)} / {formatEUR(d.total_amount)}</p>
                        </div>
                      ) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={d.is_active ? 'bg-stat-green/10 text-stat-green border-0' : 'bg-muted text-muted-foreground border-0'}>
                        {d.is_active ? 'Actief' : 'Inactief'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" onClick={() => openEdit(d)}><Pencil className="h-3.5 w-3.5" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <GuardedSheet open={open} onOpenChange={setOpen} dirty={formDirty}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>{editItem ? 'Inhouding bewerken' : 'Nieuwe inhouding'}</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6">
            <div><Label>Beschrijving *</Label><Input value={form.description} onChange={e => set('description', e.target.value)} /></div>
            <div><Label>Bedrag (€) *</Label><Input type="number" step="0.01" value={form.amount} onChange={e => set('amount', e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Frequentie</Label>
                <Select value={form.frequency} onValueChange={v => set('frequency', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{frequencyOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
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
            <div><Label>Totaalbedrag (voor voortgang)</Label><Input type="number" step="0.01" value={form.total_amount} onChange={e => set('total_amount', e.target.value)} /></div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={v => set('is_active', v)} />
              <Label>Actief</Label>
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={() => setOpen(false)}>Annuleren</Button>
              <Button onClick={() => saveMutation.mutate()} disabled={!form.description || !form.amount || saveMutation.isPending}>
                {saveMutation.isPending ? 'Opslaan...' : 'Opslaan'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </GuardedSheet>
    </div>
  );
};

export default EmployeeDeductionsTab;
