import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDate } from '@/lib/format';
import { priorityConfig, entityLinks, entityTypeLabels } from '@/lib/tasks';
import { cn } from '@/lib/utils';
import TaskEditorSheet from '@/components/shared/TaskEditorSheet';

const Tasks = () => {
  const { user } = useAuth();
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [viewMode, setViewMode] = useState<'mine' | 'created' | 'all'>('mine');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [deadlineFilter, setDeadlineFilter] = useState('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<any>(null);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['tasks-overview', orgId, viewMode, user?.id],
    queryFn: async () => {
      let q = supabase
        .from('recruiter_tasks' as any)
        .select('*, profiles:assigned_to(full_name)')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });
      if (viewMode === 'mine') q = q.eq('assigned_to', user!.id);
      else if (viewMode === 'created') q = q.eq('created_by', user!.id);
      const { data, error } = await q;
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });

  const updateTask = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, any> }) => {
      const { error } = await supabase.from('recruiter_tasks' as any).update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks-overview'] });
      qc.invalidateQueries({ queryKey: ['recruiter-tasks'] });
      qc.invalidateQueries({ queryKey: ['entity-tasks'] });
      qc.invalidateQueries({ queryKey: ['open-task-count'] });
    },
  });

  const openNew = () => { setEditingTask(null); setEditorOpen(true); };
  const openEdit = (task: any) => { setEditingTask(task); setEditorOpen(true); };

  const handleComplete = (id: string) => {
    updateTask.mutate({ id, updates: { status: 'done', completed_at: new Date().toISOString() } });
  };

  const handleReopen = (id: string) => {
    updateTask.mutate({ id, updates: { status: 'open', completed_at: null } });
  };

  const handleDismiss = (id: string) => {
    updateTask.mutate({ id, updates: { status: 'dismissed' } });
  };

  // Filter & sort
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const weekFromNow = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0];

  const activeTasks = tasks.filter((t: any) => t.status !== 'done' && t.status !== 'dismissed');
  const completedTasks = tasks.filter((t: any) => t.status === 'done');

  const applyFilters = (list: any[]) => {
    let filtered = list;
    if (priorityFilter !== 'all') {
      filtered = filtered.filter((t: any) => t.priority === priorityFilter);
    }
    if (deadlineFilter === 'today') {
      filtered = filtered.filter((t: any) => t.due_date && t.due_date <= todayStr);
    } else if (deadlineFilter === 'week') {
      filtered = filtered.filter((t: any) => t.due_date && t.due_date <= weekFromNow);
    } else if (deadlineFilter === 'overdue') {
      filtered = filtered.filter((t: any) => t.due_date && t.due_date < todayStr);
    }
    return filtered;
  };

  const filteredActive = applyFilters(activeTasks).sort((a: any, b: any) => {
    const pa = priorityConfig[a.priority]?.order ?? 99;
    const pb = priorityConfig[b.priority]?.order ?? 99;
    if (pa !== pb) return pa - pb;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const isOverdue = (date: string | null) => date && date < todayStr;

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Taken</h1>
          <p className="text-sm text-muted-foreground">
            {filteredActive.length} openstaand{completedTasks.length > 0 && `, ${completedTasks.length} afgerond`}
          </p>
        </div>
        <Button size="sm" onClick={openNew} className="gap-1.5">
          <Plus className="h-4 w-4" />Taak toevoegen
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="flex rounded-md border overflow-hidden">
          <button
            className={cn('px-3 py-1.5 text-sm transition-colors border-r', viewMode === 'mine' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted')}
            onClick={() => setViewMode('mine')}
          >Aan mij toegewezen</button>
          <button
            className={cn('px-3 py-1.5 text-sm transition-colors border-r', viewMode === 'created' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted')}
            onClick={() => setViewMode('created')}
          >Door mij gemaakt</button>
          <button
            className={cn('px-3 py-1.5 text-sm transition-colors', viewMode === 'all' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted')}
            onClick={() => setViewMode('all')}
          >Alle taken</button>
        </div>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[140px] h-8 text-sm"><SelectValue placeholder="Prioriteit" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle prioriteiten</SelectItem>
            {Object.entries(priorityConfig).map(([key, cfg]) => (
              <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={deadlineFilter} onValueChange={setDeadlineFilter}>
          <SelectTrigger className="w-[140px] h-8 text-sm"><SelectValue placeholder="Deadline" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle deadlines</SelectItem>
            <SelectItem value="overdue">Verlopen</SelectItem>
            <SelectItem value="today">Vandaag</SelectItem>
            <SelectItem value="week">Deze week</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Active tasks */}
      {isLoading ? (
        <p className="text-center text-muted-foreground py-8">Laden...</p>
      ) : (
        <div className="space-y-2">
          {filteredActive.map((task: any) => {
            const prio = priorityConfig[task.priority] ?? priorityConfig.medium;
            const linkFn = task.related_entity_id && task.related_entity_type ? entityLinks[task.related_entity_type] : null;
            return (
              <div key={task.id} className="flex items-start gap-3 bg-card rounded-lg border p-3">
                <Checkbox
                  checked={false}
                  onCheckedChange={() => handleComplete(task.id)}
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
                    {linkFn && task.related_entity_type && (
                      <Link
                        to={linkFn(task.related_entity_id)}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[10px] hover:underline"
                      >
                        {entityTypeLabels[task.related_entity_type] ?? task.related_entity_type}
                      </Link>
                    )}
                  </div>
                </button>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground shrink-0" onClick={() => handleDismiss(task.id)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
          {filteredActive.length === 0 && (
            <p className="text-center text-muted-foreground py-8">Geen openstaande taken</p>
          )}
        </div>
      )}

      {/* Completed */}
      {completedTasks.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Afgerond ({completedTasks.length})</p>
          {completedTasks.slice(0, 10).map((task: any) => (
            <div key={task.id} className="flex items-start gap-3 bg-card rounded-lg border p-3 opacity-60">
              <Checkbox
                checked={true}
                onCheckedChange={() => handleReopen(task.id)}
                className="mt-0.5"
              />
              <button type="button" onClick={() => openEdit(task)} className="flex-1 min-w-0 text-left">
                <span className="text-sm line-through text-muted-foreground">{task.title}</span>
              </button>
            </div>
          ))}
        </div>
      )}

      <TaskEditorSheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        task={editingTask ?? undefined}
      />
    </div>
  );
};

export default Tasks;
