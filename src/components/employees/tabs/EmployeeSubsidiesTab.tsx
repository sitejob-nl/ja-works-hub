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
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Plus, Pencil } from 'lucide-react';
import { formatDate, formatEUR } from '@/lib/format';
import { toast } from 'sonner';

const typeOptions = [
  { value: 'liv', label: 'LIV' },
  { value: 'lkv', label: 'LKV' },
  { value: 'lkv_oudere_werknemer', label: 'LKV Oudere werknemer' },
  { value: 'lkv_arbeidsgehandicapte', label: 'LKV Arbeidsgehandicapte' },
  { value: 'overig', label: 'Overig' },
];
const typeBadge: Record<string, string> = { liv: 'bg-green-100 text-green-700 border-0', lkv: 'bg-blue-100 text-blue-700 border-0', lkv_oudere_werknemer: 'bg-purple-100 text-purple-700 border-0', lkv_arbeidsgehandicapte: 'bg-teal-100 text-teal-700 border-0', overig: 'bg-muted text-muted-foreground border-0' };

const emptyForm = { type: 'overig', description: '', amount_per_hour: '', max_annual_amount: '', start_date: '', end_date: '', is_active: true, notes: '' };

const EmployeeSubsidiesTab = ({ candidateId }: { candidateId: string }) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm] = useState<any>(emptyForm);

  const { data: subsidies = [] } = useQuery({
    queryKey: ['subsidies', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase.from('employee_subsidies').select('*').eq('candidate_id', candidateId).order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const openNew = () => { setEditItem(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (s: any) => {
    setEditItem(s);
    setForm({ type: s.type, description: s.description ?? '', amount_per_hour: s.amount_per_hour?.toString() ?? '', max_annual_amount: s.max_annual_amount?.toString() ?? '', start_date: s.start_date, end_date: s.end_date ?? '', is_active: s.is_active, notes: s.notes ?? '' });
    setOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        type: form.type, description: form.description || null,
        amount_per_hour: form.amount_per_hour ? parseFloat(form.amount_per_hour) : null,
        max_annual_amount: form.max_annual_amount ? parseFloat(form.max_annual_amount) : null,
        start_date: form.start_date, end_date: form.end_date || null,
        is_active: form.is_active, notes: form.notes || null,
      };
      if (editItem) {
        const { error } = await supabase.from('employee_subsidies').update(payload).eq('id', editItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('employee_subsidies').insert({ ...payload, candidate_id: candidateId, organization_id: orgId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subsidies', candidateId] });
      setOpen(false);
      toast.success(editItem ? 'Subsidie bijgewerkt' : 'Subsidie toegevoegd');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Subsidies</h3>
        <Button size="sm" variant="outline" onClick={openNew} className="gap-1"><Plus className="h-3.5 w-3.5" />Nieuwe subsidie</Button>
      </div>

      {subsidies.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">Geen subsidies</p>
      ) : (
        <div className="bg-card rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Beschrijving</TableHead>
                <TableHead>Per uur</TableHead>
                <TableHead>Max/jaar</TableHead>
                <TableHead>Periode</TableHead>
                <TableHead>Actief</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subsidies.map((s: any) => (
                <TableRow key={s.id}>
                  <TableCell><Badge variant="secondary" className={typeBadge[s.type] ?? ''}>{typeOptions.find(o => o.value === s.type)?.label ?? s.type}</Badge></TableCell>
                  <TableCell className="font-medium">{s.description ?? '—'}</TableCell>
                  <TableCell>{formatEUR(s.amount_per_hour)}</TableCell>
                  <TableCell>{formatEUR(s.max_annual_amount)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(s.start_date)} — {formatDate(s.end_date)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={s.is_active ? 'bg-stat-green/10 text-stat-green border-0' : 'bg-muted text-muted-foreground border-0'}>
                      {s.is_active ? 'Actief' : 'Inactief'}
                    </Badge>
                  </TableCell>
                  <TableCell><Button size="icon" variant="ghost" onClick={() => openEdit(s)}><Pencil className="h-3.5 w-3.5" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>{editItem ? 'Subsidie bewerken' : 'Nieuwe subsidie'}</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6">
            <div><Label>Type *</Label>
              <Select value={form.type} onValueChange={v => set('type', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{typeOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Beschrijving</Label><Input value={form.description} onChange={e => set('description', e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Bedrag per uur (€)</Label><Input type="number" step="0.01" value={form.amount_per_hour} onChange={e => set('amount_per_hour', e.target.value)} /></div>
              <div><Label>Max jaarbedrag (€)</Label><Input type="number" step="0.01" value={form.max_annual_amount} onChange={e => set('max_annual_amount', e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Startdatum *</Label><Input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} /></div>
              <div><Label>Einddatum</Label><Input type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} /></div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={v => set('is_active', v)} />
              <Label>Actief</Label>
            </div>
            <div><Label>Notities</Label><Textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} /></div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={() => setOpen(false)}>Annuleren</Button>
              <Button onClick={() => saveMutation.mutate()} disabled={!form.type || !form.start_date || saveMutation.isPending}>
                {saveMutation.isPending ? 'Opslaan...' : 'Opslaan'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default EmployeeSubsidiesTab;
