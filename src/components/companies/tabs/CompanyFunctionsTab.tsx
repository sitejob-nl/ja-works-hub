import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import TagInput from '@/components/ui/tag-input';
import { Plus, Pencil } from 'lucide-react';
import { formatEUR } from '@/lib/format';
import { toast } from 'sonner';

const emptyForm = {
  name: '',
  description: '',
  default_hourly_rate: '',
  salary_min: '',
  salary_max: '',
  required_skills: [] as string[],
  is_active: true,
};

const formatSalaryRange = (min: number | null, max: number | null, fallback: number | null): string => {
  if (min != null && max != null) return `${formatEUR(min)} – ${formatEUR(max)}`;
  if (min != null) return `vanaf ${formatEUR(min)}`;
  if (max != null) return `tot ${formatEUR(max)}`;
  if (fallback != null) return formatEUR(fallback);
  return '—';
};

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
    setForm({
      name: f.name,
      description: f.description ?? '',
      default_hourly_rate: f.default_hourly_rate?.toString() ?? '',
      salary_min: f.salary_min?.toString() ?? '',
      salary_max: f.salary_max?.toString() ?? '',
      required_skills: Array.isArray(f.required_skills) ? f.required_skills : [],
      is_active: f.is_active ?? true,
    });
    setOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        description: form.description || null,
        default_hourly_rate: form.default_hourly_rate ? parseFloat(form.default_hourly_rate) : null,
        salary_min: form.salary_min ? parseFloat(form.salary_min) : null,
        salary_max: form.salary_max ? parseFloat(form.salary_max) : null,
        required_skills: form.required_skills.length ? form.required_skills : [],
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
                <TableHead>Salaris</TableHead>
                <TableHead>Vaardigheden</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {functions.map((f: any) => {
                const skills: string[] = Array.isArray(f.required_skills) ? f.required_skills : [];
                return (
                  <TableRow key={f.id}>
                    <TableCell>
                      <div className="font-medium">{f.name}</div>
                      {f.description && <div className="text-xs text-muted-foreground line-clamp-1">{f.description}</div>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatSalaryRange(f.salary_min, f.salary_max, f.default_hourly_rate)}</TableCell>
                    <TableCell>
                      {skills.length === 0 ? (
                        <span className="text-muted-foreground text-xs">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {skills.slice(0, 3).map((s) => (
                            <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                          ))}
                          {skills.length > 3 && <Badge variant="secondary" className="text-xs">+{skills.length - 3}</Badge>}
                        </div>
                      )}
                    </TableCell>
                    <TableCell><Button size="icon" variant="ghost" onClick={() => openEdit(f)}><Pencil className="h-3.5 w-3.5" /></Button></TableCell>
                  </TableRow>
                );
              })}
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Salaris min (€/u)</Label>
                <Input type="number" step="0.01" value={form.salary_min} onChange={e => set('salary_min', e.target.value)} placeholder="bv. 22.50" />
              </div>
              <div>
                <Label>Salaris max (€/u)</Label>
                <Input type="number" step="0.01" value={form.salary_max} onChange={e => set('salary_max', e.target.value)} placeholder="bv. 28.00" />
              </div>
            </div>
            <div>
              <Label>Standaard uurtarief (€)</Label>
              <Input type="number" step="0.01" value={form.default_hourly_rate} onChange={e => set('default_hourly_rate', e.target.value)} placeholder="optioneel; alleen als geen range" />
              <p className="text-xs text-muted-foreground mt-1">Range hierboven heeft voorrang. Dit veld is voor backwards compatibility.</p>
            </div>
            <div>
              <Label>Standaard-vaardigheden</Label>
              <TagInput value={form.required_skills} onChange={(v) => set('required_skills', v)} placeholder="Typ vaardigheid + Enter" />
              <p className="text-xs text-muted-foreground mt-1">Worden overgenomen bij vacature en gebruikt voor talentpool-matching.</p>
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
