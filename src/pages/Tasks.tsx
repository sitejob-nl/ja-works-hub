import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import {
  byPriorityThenRecency, categoryIcon, categoryLabel, isTaskOpen, priorityConfig, todayISO,
} from '@/lib/tasks';
import { cn } from '@/lib/utils';
import { unwrapList } from '@/lib/db';
import { useTaskActions } from '@/hooks/useTaskActions';
import TaskCard from '@/components/shared/TaskCard';
import TaskEditorSheet from '@/components/shared/TaskEditorSheet';
import { isFacilityRole, setFacilityTaskStatus } from '@/lib/facility';

const VIEW_MODES = ['mine', 'created', 'all'] as const;
const STATUS_FILTERS = ['open', 'overdue', 'done', 'dismissed', 'all'];

/** Alleen bekende waarden overnemen — een onzinnige URL mag geen lege lijst opleveren. */
const seedFromUrl = <T extends string>(value: string | null, allowed: readonly string[], fallback: T): T =>
  value && allowed.includes(value) ? (value as T) : fallback;

const Tasks = () => {
  const { user, role } = useAuth();
  const orgId = useOrganizationId();
  // De Workbench linkt hierheen met een voorgevulde selectie (bv. ?status=overdue).
  const [searchParams] = useSearchParams();
  const [viewMode, setViewMode] = useState<'mine' | 'created' | 'all'>(
    () => seedFromUrl(searchParams.get('weergave'), VIEW_MODES, 'mine'));
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<string>(
    () => seedFromUrl(searchParams.get('status'), STATUS_FILTERS, 'open'));
  const [priorityFilter, setPriorityFilter] = useState<string>(
    () => seedFromUrl(searchParams.get('prioriteit'), Object.keys(priorityConfig), 'all'));
  const [deadlineFilter, setDeadlineFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<any>(null);
  const facility = isFacilityRole(role);
  const canFilterAssignee = role === 'admin' || role === 'intercedent' || role === 'backoffice';

  const { data: assignees = [] } = useQuery({
    queryKey: ['task-assignees-filter', orgId],
    queryFn: () => unwrapList<{ id: string; full_name: string | null; email: string | null }>(
      supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('full_name'),
    ),
    enabled: !!orgId && canFilterAssignee,
  });

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['tasks-overview', orgId, viewMode, user?.id, assigneeFilter],
    queryFn: async () => {
      let q = supabase
        .from('recruiter_tasks' as any)
        .select(facility ? '*' : '*, profiles:assigned_to(full_name, email)')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });
      if (viewMode === 'mine') q = q.eq('assigned_to', user!.id);
      else if (viewMode === 'created') q = q.eq('created_by', user!.id);
      else if (canFilterAssignee && assigneeFilter === 'unassigned') q = q.is('assigned_to', null);
      else if (canFilterAssignee && assigneeFilter !== 'all') q = q.eq('assigned_to', assigneeFilter);
      return unwrapList<any>(q);
    },
    enabled: !!orgId && !!user,
  });

  const { toggle: handleToggle, dismiss: handleDismiss } = useTaskActions(
    facility ? { writeStatus: setFacilityTaskStatus } : {});

  const openNew = () => { setEditingTask(null); setEditorOpen(true); };
  const openEdit = (task: any) => { setEditingTask(task); setEditorOpen(true); };

  const changeViewMode = (mode: 'mine' | 'created' | 'all') => {
    setViewMode(mode);
    if (mode !== 'all') setAssigneeFilter('all');
  };

  const activeAssigneeLabel = (() => {
    if (assigneeFilter === 'all') return null;
    if (assigneeFilter === 'unassigned') return 'Nog niet toegewezen';
    const assignee = assignees.find((profile) => profile.id === assigneeFilter);
    return assignee?.full_name || assignee?.email || null;
  })();

  // Filter & sort
  const now = new Date();
  const todayStr = todayISO();
  const weekFromNow = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0];

  const activeTasks = tasks.filter(isTaskOpen);

  const applyFilters = (list: any[]) => {
    let filtered = list;
    if (statusFilter === 'open') {
      filtered = filtered.filter(isTaskOpen);
    } else if (statusFilter === 'done') {
      filtered = filtered.filter((t: any) => t.status === 'done');
    } else if (statusFilter === 'dismissed') {
      filtered = filtered.filter((t: any) => t.status === 'dismissed');
    } else if (statusFilter === 'overdue') {
      filtered = filtered.filter((t: any) => isTaskOpen(t) && t.due_date && t.due_date < todayStr);
    }
    if (priorityFilter !== 'all') {
      filtered = filtered.filter((t: any) => t.priority === priorityFilter);
    }
    if (categoryFilter !== 'all') {
      filtered = filtered.filter((t: any) => (t.category || 'overig') === categoryFilter);
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

  const filteredTasks = applyFilters(tasks);
  const filteredActive = filteredTasks.filter(isTaskOpen).sort(byPriorityThenRecency);
  const filteredClosed = filteredTasks
    .filter((t: any) => !isTaskOpen(t))
    .sort((a: any, b: any) => new Date(b.completed_at ?? b.created_at).getTime() - new Date(a.completed_at ?? a.created_at).getTime());

  // Categorie-chips volgen de data: taken uit e-mailtriage e.d. gebruiken vrije tekst,
  // een vaste lijst zou die onbereikbaar maken.
  const categoryCounts = activeTasks.reduce<Record<string, number>>((acc, task: any) => {
    const key = task.category || 'overig';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const categoryKeys = Object.keys(categoryCounts).sort((a, b) => categoryCounts[b] - categoryCounts[a]);

  const workload = assignees.map((assignee) => ({
    assignee,
    count: activeTasks.filter((task: any) => task.assigned_to === assignee.id).length,
    overdue: activeTasks.filter((task: any) => task.assigned_to === assignee.id && task.due_date && task.due_date < todayStr).length,
  })).filter((item) => item.count > 0 || item.overdue > 0);
  const unassignedCount = activeTasks.filter((task: any) => !task.assigned_to).length;
  const unassignedOverdue = activeTasks.filter((task: any) => !task.assigned_to && task.due_date && task.due_date < todayStr).length;

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Taken</h1>
          <p className="text-sm text-muted-foreground">
            {filteredActive.length} openstaand{filteredClosed.length > 0 && `, ${filteredClosed.length} gesloten in filter`}
          </p>
        </div>
        {!facility && (
          <Button size="sm" onClick={openNew} className="gap-1.5">
            <Plus className="h-4 w-4" />Taak toevoegen
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {!facility && <div className="flex rounded-md border overflow-hidden">
          <button
            className={cn('px-3 py-1.5 text-sm transition-colors border-r', viewMode === 'mine' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted')}
            onClick={() => changeViewMode('mine')}
          >Aan mij toegewezen</button>
          <button
            className={cn('px-3 py-1.5 text-sm transition-colors border-r', viewMode === 'created' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted')}
            onClick={() => changeViewMode('created')}
          >Door mij gemaakt</button>
          <button
            className={cn('px-3 py-1.5 text-sm transition-colors', viewMode === 'all' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted')}
            onClick={() => changeViewMode('all')}
          >Alle taken</button>
        </div>}
        {canFilterAssignee && viewMode === 'all' && (
          <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
            <SelectTrigger aria-label="Filter op toegewezene" className="w-[190px] h-8 text-sm">
              <SelectValue placeholder="Toegewezen aan" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle toegewezenen</SelectItem>
              <SelectItem value="unassigned">Nog niet toegewezen</SelectItem>
              {assignees.map((assignee) => (
                <SelectItem key={assignee.id} value={assignee.id}>
                  {assignee.full_name || assignee.email || 'Onbekende gebruiker'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger aria-label="Filter op status" className="w-[150px] h-8 text-sm"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Openstaand</SelectItem>
            <SelectItem value="overdue">Achterstallig</SelectItem>
            <SelectItem value="done">Afgerond</SelectItem>
            <SelectItem value="dismissed">Genegeerd</SelectItem>
            <SelectItem value="all">Alle statussen</SelectItem>
          </SelectContent>
        </Select>
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
        {viewMode === 'all' && activeAssigneeLabel && (
          <Badge variant="secondary" className="h-8 px-2.5">
            Toegewezen aan: {activeAssigneeLabel}
          </Badge>
        )}
      </div>

      {categoryKeys.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground">Categorie:</span>
          <button
            onClick={() => setCategoryFilter('all')}
            className={cn(
              'text-xs px-3 py-1.5 rounded-full border transition-colors',
              categoryFilter === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted border-border hover:bg-muted/80',
            )}
          >
            Alles ({activeTasks.length})
          </button>
          {categoryKeys.map((key) => {
            const Icon = categoryIcon(key);
            return (
              <button
                key={key}
                onClick={() => setCategoryFilter(key)}
                className={cn(
                  'text-xs px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5',
                  categoryFilter === key ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted border-border hover:bg-muted/80',
                )}
              >
                <Icon className="h-3 w-3" />
                {categoryLabel(key)} ({categoryCounts[key]})
              </button>
            );
          })}
        </div>
      )}

      {canFilterAssignee && viewMode === 'all' && assigneeFilter === 'all' && (
        <div className="rounded-lg border bg-card p-3">
          <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">Werkvoorraad per medewerker</div>
          <div className="flex flex-wrap gap-2">
            {workload.map(({ assignee, count, overdue }) => (
              <button
                key={assignee.id}
                type="button"
                onClick={() => setAssigneeFilter(assignee.id)}
                className="rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted"
              >
                <span className="font-medium">{assignee.full_name || assignee.email || 'Onbekend'}</span>
                <span className="ml-2 text-muted-foreground">{count} open</span>
                {overdue > 0 && <span className="ml-2 font-medium text-destructive">{overdue} achterstallig</span>}
              </button>
            ))}
            {(unassignedCount > 0 || unassignedOverdue > 0) && (
              <button
                type="button"
                onClick={() => setAssigneeFilter('unassigned')}
                className="rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted"
              >
                <span className="font-medium">Niet toegewezen</span>
                <span className="ml-2 text-muted-foreground">{unassignedCount} open</span>
                {unassignedOverdue > 0 && <span className="ml-2 font-medium text-destructive">{unassignedOverdue} achterstallig</span>}
              </button>
            )}
            {workload.length === 0 && unassignedCount === 0 && (
              <span className="text-sm text-muted-foreground">Geen open taken in deze selectie.</span>
            )}
          </div>
        </div>
      )}

      {/* Active tasks */}
      {isLoading ? (
        <p className="text-center text-muted-foreground py-8">Laden...</p>
      ) : (
        <div className="space-y-2">
          {filteredActive.map((task: any) => (
            <TaskCard
              key={task.id}
              task={task}
              onToggle={handleToggle}
              onEdit={facility ? undefined : openEdit}
              onDismiss={facility ? undefined : handleDismiss}
              showAssignee={viewMode === 'all'}
            />
          ))}
          {filteredActive.length === 0 && (
            <p className="text-center text-muted-foreground py-8">Geen openstaande taken</p>
          )}
        </div>
      )}

      {/* Completed */}
      {filteredClosed.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Gesloten ({filteredClosed.length})</p>
          {filteredClosed.slice(0, 10).map((task: any) => (
            <TaskCard
              key={task.id}
              task={task}
              onToggle={handleToggle}
              onEdit={facility ? undefined : openEdit}
            />
          ))}
        </div>
      )}

      {!facility && (
        <TaskEditorSheet
          open={editorOpen}
          onOpenChange={setEditorOpen}
          task={editingTask ?? undefined}
        />
      )}
    </div>
  );
};

export default Tasks;
