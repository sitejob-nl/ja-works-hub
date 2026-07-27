import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { isTaskOpen, type TaskEntityType } from '@/lib/tasks';
import { useTaskActions } from '@/hooks/useTaskActions';
import TaskCard from '@/components/shared/TaskCard';
import TaskEditorSheet from '@/components/shared/TaskEditorSheet';

interface TasksSectionProps {
  entityId: string;
  entityType: TaskEntityType;
}

const TasksSection = ({ entityId, entityType }: TasksSectionProps) => {
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

  const { toggle: toggleTask } = useTaskActions();

  const openNew = () => { setEditingTask(null); setEditorOpen(true); };
  const openEdit = (task: any) => { setEditingTask(task); setEditorOpen(true); };

  const activeTasks = tasks.filter(isTaskOpen);
  const completedTasks = tasks.filter((t: any) => t.status === 'done');

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Taken</h3>
        <Button size="sm" variant="outline" onClick={openNew} className="gap-1">
          <Plus className="h-3.5 w-3.5" />Nieuwe taak
        </Button>
      </div>

      <div className="space-y-2">
        {activeTasks.map((task: any) => (
          <TaskCard
            key={task.id}
            task={task}
            onToggle={toggleTask}
            onEdit={openEdit}
            showAssignee
            // De taak hangt al aan deze entiteit — een link terug naar hier is ruis.
            showEntityLink={false}
          />
        ))}
      </div>

      {completedTasks.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Afgerond ({completedTasks.length})</p>
          {completedTasks.map((task: any) => (
            <TaskCard
              key={task.id}
              task={task}
              onToggle={toggleTask}
              onEdit={openEdit}
              showEntityLink={false}
            />
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
