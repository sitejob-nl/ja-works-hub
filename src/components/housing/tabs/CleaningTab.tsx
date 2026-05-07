import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';

const NONE = '__none__';

const statusLabel: Record<string, string> = {
  open: 'Open',
  in_progress: 'Bezig',
  done: 'Klaar',
  cancelled: 'Vervallen',
};

const priorityClass: Record<string, string> = {
  low: 'bg-muted text-muted-foreground border-0',
  medium: 'bg-yellow-100 text-yellow-700 border-0',
  high: 'bg-red-100 text-red-700 border-0',
};

export default function CleaningTab({ property }: { property: any }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const units = property.units ?? [];
  const [openForm, setOpenForm] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    unit_id: NONE,
    due_date: '',
    priority: 'medium',
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ['housing-cleaning-tasks', property.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('housing_cleaning_tasks' as any)
        .select('*, units(name)')
        .eq('property_id', property.id)
        .order('status')
        .order('due_date', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const createTask = useMutation({
    mutationFn: async () => {
      const payload = {
        organization_id: property.organization_id,
        property_id: property.id,
        unit_id: form.unit_id === NONE ? null : form.unit_id,
        title: form.title.trim(),
        description: form.description || null,
        due_date: form.due_date || null,
        priority: form.priority,
        created_by: user?.id ?? null,
      };
      const { data, error } = await supabase.from('housing_cleaning_tasks' as any).insert(payload).select('id').single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['housing-cleaning-tasks', property.id] });
      qc.invalidateQueries({ queryKey: ['housing-cleaning-overview'] });
      logAudit({ action: 'create', tableName: 'housing_cleaning_tasks', recordId: data.id });
      toast.success('Schoonmaaktaak aangemaakt');
      setForm({ title: '', description: '', unit_id: NONE, due_date: '', priority: 'medium' });
      setOpenForm(false);
    },
    onError: (e: any) => toast.error(e.message ?? 'Aanmaken mislukt'),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const update: any = { status };
      if (status === 'done') update.completed_at = new Date().toISOString();
      const { error } = await supabase.from('housing_cleaning_tasks' as any).update(update).eq('id', id);
      if (error) throw error;
      logAudit({ action: 'status_change', tableName: 'housing_cleaning_tasks', recordId: id, newValues: update });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['housing-cleaning-tasks', property.id] });
      qc.invalidateQueries({ queryKey: ['housing-cleaning-overview'] });
      toast.success('Status bijgewerkt');
    },
    onError: (e: any) => toast.error(e.message ?? 'Opslaan mislukt'),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setOpenForm((v) => !v)} className="gap-2"><Plus className="h-4 w-4" /> Nieuwe taak</Button>
      </div>

      {openForm && (
        <Card>
          <CardHeader><CardTitle className="text-base">Schoonmaaktaak</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5 md:col-span-2">
              <Label>Titel *</Label>
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Kamer</Label>
              <Select value={form.unit_id} onValueChange={(v) => setForm((f) => ({ ...f, unit_id: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Hele pand</SelectItem>
                  {units.map((u: any) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Deadline</Label>
              <Input type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Prioriteit</Label>
              <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Laag</SelectItem>
                  <SelectItem value="medium">Normaal</SelectItem>
                  <SelectItem value="high">Hoog</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Notities</Label>
              <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} />
            </div>
            <div className="md:col-span-2 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpenForm(false)}>Annuleren</Button>
              <Button onClick={() => createTask.mutate()} disabled={!form.title.trim() || createTask.isPending}>Opslaan</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Taak</TableHead>
            <TableHead>Kamer</TableHead>
            <TableHead>Deadline</TableHead>
            <TableHead>Prioriteit</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actie</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task: any) => (
            <TableRow key={task.id}>
              <TableCell>
                <div className="font-medium">{task.title}</div>
                {task.description && <div className="text-xs text-muted-foreground">{task.description}</div>}
              </TableCell>
              <TableCell>{task.units?.name ?? 'Hele pand'}</TableCell>
              <TableCell>{task.due_date ? new Date(task.due_date).toLocaleDateString('nl-NL') : '—'}</TableCell>
              <TableCell><Badge variant="secondary" className={priorityClass[task.priority] ?? ''}>{task.priority}</Badge></TableCell>
              <TableCell>{statusLabel[task.status] ?? task.status}</TableCell>
              <TableCell className="text-right">
                {task.status !== 'done' && (
                  <Button variant="ghost" size="sm" onClick={() => updateStatus.mutate({ id: task.id, status: 'done' })} className="gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Klaar
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {tasks.length === 0 && (
            <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Geen schoonmaaktaken</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
