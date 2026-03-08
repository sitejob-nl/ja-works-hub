import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatEUR, formatDate } from '@/lib/format';
import { toast } from 'sonner';

const RateAgreementsTab = ({ companyId }: { companyId: string }) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ function_name: '', hourly_rate: '', overtime_rate: '', valid_from: '', valid_until: '' });

  const { data: rates = [] } = useQuery({
    queryKey: ['rates', companyId],
    queryFn: async () => {
      const { data, error } = await supabase.from('rate_agreements').select('*').eq('company_id', companyId).order('valid_from', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('rate_agreements').insert({
        company_id: companyId,
        organization_id: orgId,
        function_name: form.function_name,
        hourly_rate: parseFloat(form.hourly_rate),
        overtime_rate: form.overtime_rate ? parseFloat(form.overtime_rate) : null,
        valid_from: form.valid_from,
        valid_until: form.valid_until || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rates', companyId] });
      setOpen(false);
      setForm({ function_name: '', hourly_rate: '', overtime_rate: '', valid_from: '', valid_until: '' });
      toast.success('Tarief toegevoegd');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const isExpired = (d: string | null) => d && new Date(d) < new Date();

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Tariefafspraken</h3>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="gap-1"><Plus className="h-3.5 w-3.5" />Nieuw tarief</Button>
      </div>
      <div className="bg-card rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Functie</TableHead>
              <TableHead>Uurtarief</TableHead>
              <TableHead>Overwerktarief</TableHead>
              <TableHead>Geldig van</TableHead>
              <TableHead>Geldig tot</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rates.map((r: any) => {
              const expired = isExpired(r.valid_until);
              return (
                <TableRow key={r.id} className={expired ? 'text-muted-foreground' : 'font-medium'}>
                  <TableCell>{r.function_name}</TableCell>
                  <TableCell>{formatEUR(r.hourly_rate)}</TableCell>
                  <TableCell>{formatEUR(r.overtime_rate)}</TableCell>
                  <TableCell>{formatDate(r.valid_from)}</TableCell>
                  <TableCell>{formatDate(r.valid_until)}</TableCell>
                  <TableCell>{expired ? <Badge variant="secondary">Verlopen</Badge> : <Badge className="bg-stat-green/10 text-stat-green border-0">Actief</Badge>}</TableCell>
                </TableRow>
              );
            })}
            {rates.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nog geen tariefafspraken</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader><SheetTitle>Nieuw tarief</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6">
            <div><Label>Functienaam *</Label><Input value={form.function_name} onChange={(e) => setForm(f => ({ ...f, function_name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Uurtarief (€) *</Label><Input type="number" step="0.01" value={form.hourly_rate} onChange={(e) => setForm(f => ({ ...f, hourly_rate: e.target.value }))} /></div>
              <div><Label>Overwerktarief (€)</Label><Input type="number" step="0.01" value={form.overtime_rate} onChange={(e) => setForm(f => ({ ...f, overtime_rate: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Geldig van *</Label><Input type="date" value={form.valid_from} onChange={(e) => setForm(f => ({ ...f, valid_from: e.target.value }))} /></div>
              <div><Label>Geldig tot</Label><Input type="date" value={form.valid_until} onChange={(e) => setForm(f => ({ ...f, valid_until: e.target.value }))} /></div>
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={() => setOpen(false)}>Annuleren</Button>
              <Button onClick={() => add.mutate()} disabled={!form.function_name || !form.hourly_rate || !form.valid_from}>Opslaan</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default RateAgreementsTab;
