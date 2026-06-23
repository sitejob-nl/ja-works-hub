import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Paperclip } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { priorityConfig, type TaskEntityType } from '@/lib/tasks';
import { cn } from '@/lib/utils';
import TaskEditorSheet from '@/components/shared/TaskEditorSheet';

interface TasksSectionProps {
  entityId: string;
  entityType: TaskEntityType;
}

const TasksSection = ({ entityId, entityType }: TasksSectionProps) => {
  const qc = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<any>(null);

  const { data: tasks = [] } = useQuery({
    queryKey: ['entity-tasks', entityType, entityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recruiter_tasks' as any)
        .select('*, profiles:assigned_to(full_name), task_attachments(count)')
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

  const openNew = () => { setEditingTask(null); setEditorOpen(true); };
  const openEdit = (task: any) => { setEditingTask(task); setEditorOpen(true); };

  const activeTasks = tasks.filter((t: any) => t.status !== 'done' && t.status !== 'dismissed');
  const completedTasks = tasks.filter((t: any) => t.status === 'done');
  const isOverdue = (date: string | null) => date && new Date(date) < new Date();
  const attachmentCount = (t: any) => t.task_attachments?.[0]?.count ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Taken</h3>
        <Button size="sm" variant="outline" onClick={openNew} className="gap-1">
          <Plus className="h-3.5 w-3.5" />Nieuwe taak
        </Button>
      </div>

      <div className="space-y-2">
        {activeTasks.map((task: any) => {
          const prio = priorityConfig[task.priority] ?? priorityConfig.medium;
          const files = attachmentCount(task);
          return (
            <div key={task.id} className="flex items-start gap-3 bg-card rounded-lg border p-3">
              <Checkbox
                checked={false}
                onCheckedChange={() => toggleTask.mutate(task)}
                className="mt-0.5"
              />
              <button type="button" onClick={() => openEdit(task)} className="flex-1 min-w-0 text-left">
                <span className="text-sm">{task.title}</span>
                {task.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{task.description}</p>}
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <Badge variant="secondary" className={cn('text-[10px]', prio.color)}>{prio.label}</Badge>
                  {task.due_date && (
                    <span className={cn('text-[10px]', isOverdue(task.due_date) ? 'text-destructive font-medium' : 'text-muted-foreground')}>
                      Deadline: {formatDate(task.due_date)}
                    </span>
                  )}
                  {task.profiles?.full_name && (
                    <span className="text-[10px] text-muted-foreground">→ {task.profiles.full_name}</span>
                  )}
                  {files > 0 && (
                    <span className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5">
                      <Paperclip className="h-3 w-3" />{files}
                    </span>
                  )}
                </div>
              </button>
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
              <button type="button" onClick={() => openEdit(task)} className="flex-1 min-w-0 text-left">
                <span className="text-sm line-through text-muted-foreground">{task.title}</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {tasks.length === 0 && (
        <p className="text-center text-muted-foreground py-8">Nog geen taken</p>
      )}

      <TaskEditorSheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        task={editingTask ?? undefined}
        lockedEntity={{ type: entityType, id: entityId }}
      />
    </div>
  );
};

export default TasksSection;
