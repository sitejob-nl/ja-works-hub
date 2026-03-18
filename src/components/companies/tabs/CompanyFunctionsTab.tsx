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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Plus, Pencil } from 'lucide-react';
import { formatEUR } from '@/lib/format';
import { toast } from 'sonner';

const emptyForm = { name: '', description: '', default_hourly_rate: '', is_active: true };

const CompanyFunctionsTab = ({ companyId }: { companyId: string }) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm] = useState<any>(emptyForm);

  const { data: functions = [] } = useQuery({
    queryKey: ['company-functions', companyId],
    queryFn: async () => {
      const { data, error } = await supabase.from('company_functions').select('*').eq('company_id', companyId).order('name');
      if (error) throw error;
      return data;
    },
  });

  const openNew = () => { setEditItem(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (f: any) => {
    setEditItem(f);
    setForm({ name: f.name, description: f.description ?? '', default_hourly_rate: f.default_hourly_rate?.toString() ?? '', is_active: f.is_active ?? true });
    setOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name, description: form.description || null,
        default_hourly_rate: form.default_hourly_rate ? parseFloat(form.default_hourly_rate) : null,
        is_active: form.is_active,
      };
      if (editItem) {
        const { error } = await supabase.from('company_functions').update(payload).eq('id', editItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('company_functions').insert({ ...payload, company_id: companyId, organization_id: orgId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company-functions', companyId] });
      setOpen(false);
      toast.success(editItem ? 'Functie bijgewerkt' : 'Functie toegevoegd');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Functies</h3>
        <Button size="sm" variant="outline" onClick={openNew} className="gap-1"><Plus className="h-3.5 w-3.5" />Nieuwe functie</Button>
      </div>

      {functions.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">Nog geen functies</p>
      ) : (
        <div className="bg-card rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Naam</TableHead>
                <TableHead>Beschrijving</TableHead>
                <TableHead>Standaard uurtarief</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {functions.map((f: any) => (
                <TableRow key={f.id}>
                  <TableCell className="font-medium">{f.name}</TableCell>
                  <TableCell className="text-muted-foreground">{f.description ?? '—'}</TableCell>
                  <TableCell>{formatEUR(f.default_hourly_rate)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={f.is_active ? 'bg-stat-green/10 text-stat-green border-0' : 'bg-muted text-muted-foreground border-0'}>
                      {f.is_active ? 'Actief' : 'Inactief'}
                    </Badge>
                  </TableCell>
                  <TableCell><Button size="icon" variant="ghost" onClick={() => openEdit(f)}><Pencil className="h-3.5 w-3.5" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>{editItem ? 'Functie bewerken' : 'Nieuwe functie'}</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6">
            <div><Label>Naam *</Label><Input value={form.name} onChange={e => set('name', e.target.value)} /></div>
            <div><Label>Beschrijving</Label><Textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} /></div>
            <div><Label>Standaard uurtarief (€)</Label><Input type="number" step="0.01" value={form.default_hourly_rate} onChange={e => set('default_hourly_rate', e.target.value)} /></div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={v => set('is_active', v)} />
              <Label>Actief</Label>
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={() => setOpen(false)}>Annuleren</Button>
              <Button onClick={() => saveMutation.mutate()} disabled={!form.name || saveMutation.isPending}>
                {saveMutation.isPending ? 'Opslaan...' : 'Opslaan'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default CompanyFunctionsTab;
