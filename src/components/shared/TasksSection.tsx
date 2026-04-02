import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { priorityConfig } from '@/lib/tasks';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type EntityType = 'kandidaat' | 'opdrachtgever' | 'vacature' | 'plaatsing';

interface TasksSectionProps {
  entityId: string;
  entityType: EntityType;
}

const emptyForm = { title: '', description: '', priority: 'medium', due_date: '' };

const TasksSection = ({ entityId, entityType }: TasksSectionProps) => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const { data: tasks = [] } = useQuery({
    queryKey: ['entity-tasks', entityType, entityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recruiter_tasks' as any)
        .select('*, profiles:assigned_to(full_name)')
        .eq('related_entity_id', entityId)
        .eq('related_entity_type', entityType)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });

  const toggleTask = useMutation({
    mutationFn: async (task: any) => {
      const isDone = task.status === 'done';
      const { error } = await supabase
        .from('recruiter_tasks' as any)
        .update(isDone ? { status: 'open', completed_at: null } : { status: 'done', completed_at: new Date().toISOString() })
        .eq('id', task.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['entity-tasks', entityType, entityId] });
      qc.invalidateQueries({ queryKey: ['recruiter-tasks'] });
      qc.invalidateQueries({ queryKey: ['open-task-count'] });
    },
  });

  const createTask = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('recruiter_tasks' as any).insert({
        organization_id: orgId,
        title: form.title,
        description: form.description || null,
        priority: form.priority,
        due_date: form.due_date || null,
        related_entity_id: entityId,
        related_entity_type: entityType,
        assigned_to: user?.id,
        status: 'open',
        ai_generated: false,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['entity-tasks', entityType, entityId] });
      qc.invalidateQueries({ queryKey: ['recruiter-tasks'] });
      qc.invalidateQueries({ queryKey: ['open-task-count'] });
      setAdding(false);
      setForm(emptyForm);
      toast.success('Taak aangemaakt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const activeTasks = tasks.filter((t: any) => t.status !== 'done' && t.status !== 'dismissed');
  const completedTasks = tasks.filter((t: any) => t.status === 'done');
  const isOverdue = (date: string | null) => date && new Date(date) < new Date();

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Taken</h3>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="gap-1">
          <Plus className="h-3.5 w-3.5" />Nieuwe taak
        </Button>
      </div>

      {adding && (
        <div className="bg-card rounded-lg border p-4 space-y-3">
          <div><Label>Titel</Label><Input value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Wat moet er gebeuren?" /></div>
          <div><Label>Beschrijving</Label><Textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} rows={2} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Prioriteit</Label>
              <Select value={form.priority} onValueChange={(v) => setForm(f => ({ ...f, priority: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(priorityConfig).map(([key, cfg]) => (
                    <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Deadline</Label>
              <Input type="date" value={form.due_date} onChange={(e) => setForm(f => ({ ...f, due_date: e.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setAdding(false); setForm(emptyForm); }}>Annuleren</Button>
            <Button size="sm" onClick={() => createTask.mutate()} disabled={!form.title.trim() || createTask.isPending}>Opslaan</Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {activeTasks.map((task: any) => {
          const prio = priorityConfig[task.priority] ?? priorityConfig.medium;
          return (
            <div key={task.id} className="flex items-start gap-3 bg-card rounded-lg border p-3">
              <Checkbox
                checked={false}
                onCheckedChange={() => toggleTask.mutate(task)}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <span className="text-sm">{task.title}</span>
                {task.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{task.description}</p>}
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="secondary" className={cn('text-[10px]', prio.color)}>{prio.label}</Badge>
                  {task.due_date && (
                    <span className={cn('text-[10px]', isOverdue(task.due_date) ? 'text-destructive font-medium' : 'text-muted-foreground')}>
                      Deadline: {formatDate(task.due_date)}
                    </span>
                  )}
                  {task.profiles?.full_name && (
                    <span className="text-[10px] text-muted-foreground">→ {task.profiles.full_name}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {completedTasks.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Afgerond ({completedTasks.length})</p>
          {completedTasks.map((task: any) => (
            <div key={task.id} className="flex items-start gap-3 bg-card rounded-lg border p-3 opacity-60">
              <Checkbox
                checked={true}
                onCheckedChange={() => toggleTask.mutate(task)}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <span className="text-sm line-through text-muted-foreground">{task.title}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {tasks.length === 0 && !adding && (
        <p className="text-center text-muted-foreground py-8">Nog geen taken</p>
      )}
    </div>
  );
};

export default TasksSection;
