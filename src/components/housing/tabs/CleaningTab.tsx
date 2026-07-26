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
import { fetchFacilityHousingSnapshot, fetchFacilityProfileDirectory, isFacilityRole } from '@/lib/facility';

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
  const { user, role } = useAuth();
  const isFacility = isFacilityRole(role);
  const units = property.units ?? [];
  const [openForm, setOpenForm] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    unit_id: NONE,
    assigned_to: NONE,
    due_date: '',
    priority: 'medium',
  });
  const [completionFiles, setCompletionFiles] = useState<Record<string, File[]>>({});

  const { data: tasks = [] } = useQuery({
    queryKey: ['housing-cleaning-tasks', property.id, isFacility ? 'facility' : 'internal'],
    queryFn: async () => {
      if (isFacility) {
        const [snapshot, profiles] = await Promise.all([
          fetchFacilityHousingSnapshot(property.id),
          fetchFacilityProfileDirectory(),
        ]);
        return (snapshot.cleaning_tasks ?? []).map((task: any) => ({
          ...task,
          units: task.units ?? { name: units.find((unit: any) => unit.id === task.unit_id)?.name },
          assignee: task.assignee ?? profiles.find((profile: any) => profile.id === task.assigned_to) ?? null,
        }));
      }
      const { data, error } = await supabase
        .from('housing_cleaning_tasks' as any)
        .select('*, units(name), assignee:profiles!housing_cleaning_tasks_assigned_to_fkey(full_name,email)')
        .eq('property_id', property.id)
        .order('status')
        .order('due_date', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: assignees = [] } = useQuery({
    queryKey: ['housing-cleaning-assignees', property.organization_id],
    queryFn: async () => {
      if (isFacility) return fetchFacilityProfileDirectory();
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, role')
        .eq('organization_id', property.organization_id)
        .in('role', ['admin', 'intercedent', 'backoffice', 'medewerker'])
        .order('full_name');
      if (error) throw error;
      return data as any[];
    },
    enabled: !!property.organization_id,
  });

  const createTask = useMutation({
    mutationFn: async () => {
      const payload = {
        organization_id: property.organization_id,
        property_id: property.id,
        unit_id: form.unit_id === NONE ? null : form.unit_id,
        assigned_to: form.assigned_to === NONE ? null : form.assigned_to,
        title: form.title.trim(),
        description: form.description || null,
        due_date: form.due_date || null,
        priority: form.priority,
        created_by: user?.id ?? null,
      };
      if (isFacility) {
        const id = crypto.randomUUID();
        const { error } = await supabase
          .from('housing_cleaning_tasks' as any)
          .insert({ id, ...payload });
        if (error) throw error;
        return {
          id,
          ...payload,
          status: 'open',
          units: { name: units.find((unit: any) => unit.id === payload.unit_id)?.name },
          assignee: assignees.find((profile: any) => profile.id === payload.assigned_to) ?? null,
        };
      }
      const { data, error } = await supabase
        .from('housing_cleaning_tasks' as any)
        .insert(payload)
        .select('*, units(name), assignee:profiles!housing_cleaning_tasks_assigned_to_fkey(full_name,email)')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      qc.setQueryData<any[]>(['housing-cleaning-tasks', property.id], (current = []) => {
        if (current.some((task) => task.id === data.id)) return current;
        return [...current, data];
      });
      qc.invalidateQueries({ queryKey: ['housing-cleaning-tasks', property.id] });
      qc.invalidateQueries({ queryKey: ['housing-cleaning-overview'] });
      if (isFacility) qc.invalidateQueries({ queryKey: ['facility-housing-snapshot'] });
      if (!isFacility) logAudit({ action: 'create', tableName: 'housing_cleaning_tasks', recordId: data.id });
      toast.success('Schoonmaaktaak aangemaakt');
      setForm({ title: '', description: '', unit_id: NONE, assigned_to: NONE, due_date: '', priority: 'medium' });
      setOpenForm(false);
    },
    onError: (e: any) => toast.error(e.message ?? 'Aanmaken mislukt'),
  });

  // documents-bucket is privé → korte signed-URLs i.p.v. (kapotte) getPublicUrl.
  const isStoredUrl = (path: string) => /^https?:\/\//i.test(path);
  const photoPaths = Array.from(
    new Set(tasks.flatMap((t: any) => ((t.completion_photos ?? []) as string[])).filter(Boolean)),
  );
  const { data: photoUrlMap = {} } = useQuery({
    queryKey: ['cleaning-photo-urls', property.id, photoPaths],
    queryFn: async () => {
      const entries = await Promise.all(photoPaths.map(async (path) => {
        if (isStoredUrl(path)) return [path, path] as const;
        const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 60 * 10);
        return [path, error ? null : data.signedUrl] as const;
      }));
      return Object.fromEntries(entries.filter(([, url]) => Boolean(url))) as Record<string, string>;
    },
    enabled: photoPaths.length > 0,
    staleTime: 5 * 60 * 1000,
  });
  const getPhotoUrl = (path: string) => photoUrlMap[path] ?? (isStoredUrl(path) ? path : '');

  const updateStatus = useMutation({
    mutationFn: async ({ task, status }: { task: any; status: string }) => {
      const update: any = { status };
      if (status === 'done') {
        const existingPhotos: string[] = (task.completion_photos ?? []) as string[];
        const files = completionFiles[task.id] ?? [];
        if (existingPhotos.length + files.length === 0) {
          throw new Error('Voeg minimaal één schoonmaakfoto toe');
        }

        const uploaded: string[] = [];
        for (const file of files) {
          const ext = file.name.split('.').pop() ?? 'jpg';
          const path = `${property.organization_id}/cleaning/${property.id}/${task.id}/${crypto.randomUUID()}.${ext}`;
          const { error } = await supabase.storage.from('documents').upload(path, file);
          if (error) throw error;
          uploaded.push(path);
        }
        update.completed_at = new Date().toISOString();
        update.completion_photos = [...existingPhotos, ...uploaded];
      }

      const { error } = await supabase.from('housing_cleaning_tasks' as any).update(update).eq('id', task.id);
      if (error) throw error;
      if (!isFacility) logAudit({ action: 'status_change', tableName: 'housing_cleaning_tasks', recordId: task.id, newValues: update });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['housing-cleaning-tasks', property.id] });
      qc.invalidateQueries({ queryKey: ['housing-cleaning-overview'] });
      if (isFacility) qc.invalidateQueries({ queryKey: ['facility-housing-snapshot'] });
      setCompletionFiles({});
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
              <Label>Uitvoerder</Label>
              <Select value={form.assigned_to} onValueChange={(v) => setForm((f) => ({ ...f, assigned_to: v }))}>
                <SelectTrigger><SelectValue placeholder="Niet toegewezen" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Niet toegewezen</SelectItem>
                  {assignees.map((profile: any) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.full_name || (!isFacility ? profile.email : null) || 'Gebruiker'}{profile.role ? ` (${profile.role})` : ''}
                    </SelectItem>
                  ))}
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
            <TableHead>Uitvoerder</TableHead>
            <TableHead>Deadline</TableHead>
            <TableHead>Prioriteit</TableHead>
            <TableHead>Foto's</TableHead>
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
              <TableCell>
                {task.assignee?.full_name || (!isFacility ? task.assignee?.email : null) || <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell>{task.due_date ? new Date(task.due_date).toLocaleDateString('nl-NL') : '—'}</TableCell>
              <TableCell><Badge variant="secondary" className={priorityClass[task.priority] ?? ''}>{task.priority}</Badge></TableCell>
              <TableCell>
                {task.completion_photos?.length > 0 ? (
                  <div className="flex items-center gap-1">
                    {task.completion_photos.slice(0, 2).map((path: string, index: number) => (
                      <a key={path} href={getPhotoUrl(path)} target="_blank" rel="noopener noreferrer" className="h-8 w-8 rounded border overflow-hidden block">
                        <img src={getPhotoUrl(path)} alt={`Schoonmaak ${index + 1}`} className="h-full w-full object-cover" />
                      </a>
                    ))}
                    {task.completion_photos.length > 2 && <span className="text-xs text-muted-foreground">+{task.completion_photos.length - 2}</span>}
                  </div>
                ) : task.status !== 'done' ? (
                  <div className="space-y-1">
                    <Input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => setCompletionFiles((current) => ({ ...current, [task.id]: Array.from(e.target.files ?? []).slice(0, 4) }))}
                    />
                    {(completionFiles[task.id]?.length ?? 0) === 0 && <p className="text-[11px] text-destructive">Verplicht bij afronden</p>}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>{statusLabel[task.status] ?? task.status}</TableCell>
              <TableCell className="text-right">
                {task.status !== 'done' && (
                  <div className="flex justify-end gap-1">
                    {task.status === 'open' && (
                      <Button variant="ghost" size="sm" onClick={() => updateStatus.mutate({ task, status: 'in_progress' })}>
                        Start
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => updateStatus.mutate({ task, status: 'done' })} className="gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Klaar
                    </Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
          {tasks.length === 0 && (
            <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Geen schoonmaaktaken</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
