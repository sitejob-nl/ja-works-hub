import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { formatDate } from '@/lib/format';
import { unwrapList } from '@/lib/db';
import {
  AlertTriangle, ArrowRight, ArrowUpCircle, CheckCircle2, ExternalLink, Plus, RefreshCw, Sparkles,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  byPriorityThenRecency, invalidateTaskQueries, isTaskOpen, isTaskOverdue, isToday, todayISO,
} from '@/lib/tasks';
import { useTaskActions } from '@/hooks/useTaskActions';
import TaskCard from '@/components/shared/TaskCard';
import TaskEditorSheet from '@/components/shared/TaskEditorSheet';

/** Hoeveel taken de cockpit toont voordat hij doorverwijst naar /taken. */
const FOCUS_LIMIT = 8;

/**
 * De Workbench is de dagstart-cockpit: signalen (urgente vacatures, AI-prioriteiten) plus
 * de kop van de takenlijst. Het volledige overzicht met alle filters staat op /taken —
 * beide lezen dezelfde `recruiter_tasks` en delen kaart, editor en cache-invalidatie.
 */
const RecruiterWorkbench = () => {
  const { user, profile } = useAuth();
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [scope, setScope] = useState<'mij' | 'team'>('mij');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<any>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['recruiter-tasks', orgId, user?.id, scope],
    queryFn: () => {
      let q = supabase
        .from('recruiter_tasks' as any)
        .select('*, profiles:assigned_to(full_name, email), task_attachments(count)')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });
      if (scope === 'mij' && user?.id) q = q.eq('assigned_to', user.id);
      return unwrapList<any>(q);
    },
    enabled: !!orgId && !!user,
  });

  const { data: urgentVacancies = [] } = useQuery({
    queryKey: ['workbench-urgent-vacancies', orgId],
    queryFn: async () => {
      const rows = await unwrapList<any>(
        supabase
          .from('vacancies')
          .select('id, title, required_count, filled_count, urgency, start_date, start_date_text, created_at, companies!vacancies_company_id_fkey(name)')
          .eq('organization_id', orgId)
          .eq('status', 'open' as any)
          .eq('urgency', 3)
          .order('start_date', { ascending: true, nullsFirst: false })
          .limit(20),
      );
      // Toon alleen vacatures met nog open plaatsen (vervulde urgentie-3 is geen werkbank-signaal).
      return rows.filter((v) => (v.required_count ?? 0) > (v.filled_count ?? 0)).slice(0, 6);
    },
    enabled: !!orgId,
  });

  const { toggle: handleToggle, dismiss: handleDismiss } = useTaskActions();

  const handleEdit = (task: any) => {
    setEditingTask(task);
    setEditorOpen(true);
  };

  const handleGeneratePriorities = async () => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('recruiter-priorities');
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      invalidateTaskQueries(qc);
      toast.success(`${data.count} AI-taken gegenereerd`);
    } catch (e: any) {
      toast.error(e.message || 'AI prioriteiten genereren mislukt');
    } finally {
      setIsGenerating(false);
    }
  };

  const today = todayISO();
  const activeTasks = tasks.filter(isTaskOpen);

  // "Vandaag oppakken" = wat niet kan wachten. De rest staat op /taken.
  const focusTasks = activeTasks
    .filter((t: any) =>
      t.priority === 'critical' ||
      t.priority === 'high' ||
      t.status === 'in_progress' ||
      (t.due_date && t.due_date <= today))
    .sort(byPriorityThenRecency);
  const shownTasks = focusTasks.slice(0, FOCUS_LIMIT);

  const criticalCount = activeTasks.filter((t: any) => t.priority === 'critical').length;
  const overdueCount = activeTasks.filter((t: any) => isTaskOverdue(t.due_date, today)).length;
  const inProgressCount = activeTasks.filter((t: any) => t.status === 'in_progress').length;
  const doneTodayTasks = tasks.filter((t: any) => t.status === 'done' && isToday(t.completed_at));

  /** Doorlink naar het volledige overzicht met dezelfde scope. */
  const listHref = (params: Record<string, string> = {}) => {
    const search = new URLSearchParams({ weergave: scope === 'mij' ? 'mine' : 'all', ...params });
    return `/taken?${search.toString()}`;
  };

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Workbench</h1>
          <p className="text-sm text-muted-foreground">
            Hallo {profile?.full_name?.split(' ')[0]}, hier zijn je prioriteiten voor vandaag
          </p>
        </div>
        <div className="flex gap-2">
          <div className="inline-flex rounded-md border p-0.5">
            <Button variant={scope === 'mij' ? 'secondary' : 'ghost'} size="sm" className="h-7 px-2.5" onClick={() => setScope('mij')}>Mij</Button>
            <Button variant={scope === 'team' ? 'secondary' : 'ghost'} size="sm" className="h-7 px-2.5" onClick={() => setScope('team')}>Team</Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setEditingTask(null); setEditorOpen(true); }}
            className="gap-1.5"
          >
            <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Taak toevoegen</span><span className="sm:hidden">Taak</span>
          </Button>
          <Button size="sm" onClick={handleGeneratePriorities} disabled={isGenerating} className="gap-1.5">
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline">{isGenerating ? 'Genereren...' : 'AI Prioriteiten'}</span>
            <span className="sm:hidden">{isGenerating ? '...' : 'AI'}</span>
          </Button>
        </div>
      </div>

      {/* KPI-kaarten — elke tegel is een ingang naar dezelfde lijst op /taken */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Link to={listHref({ prioriteit: 'critical' })} className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Card className="h-full transition-colors hover:bg-muted/40">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <span className="text-2xl font-bold">{criticalCount}</span>
              </div>
              <p className="text-xs text-muted-foreground">Kritiek</p>
            </CardContent>
          </Card>
        </Link>
        <Link to={listHref({ status: 'overdue' })} className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Card className="h-full transition-colors hover:bg-muted/40">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2">
                <ArrowUpCircle className="h-4 w-4 text-orange-500" />
                <span className="text-2xl font-bold">{overdueCount}</span>
              </div>
              <p className="text-xs text-muted-foreground">Achterstallig</p>
            </CardContent>
          </Card>
        </Link>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-stat-blue" />
              <span className="text-2xl font-bold">{inProgressCount}</span>
            </div>
            <p className="text-xs text-muted-foreground">In uitvoering</p>
          </CardContent>
        </Card>
        <Link to={listHref({ status: 'done' })} className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Card className="h-full transition-colors hover:bg-muted/40">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-stat-green" />
                <span className="text-2xl font-bold">{doneTodayTasks.length}</span>
              </div>
              <p className="text-xs text-muted-foreground">Vandaag afgerond</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {urgentVacancies.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  Urgente vacatures
                </CardTitle>
                <CardDescription>Open vacatures met urgentie 3 en nog te vullen plaatsen</CardDescription>
              </div>
              <Badge variant="secondary" className="bg-red-100 text-red-700 border-0">
                {urgentVacancies.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {urgentVacancies.map((vacancy: any) => {
              const openSlots = Math.max((vacancy.required_count ?? 0) - (vacancy.filled_count ?? 0), 0);
              const createdDays = vacancy.created_at
                ? Math.max(0, Math.floor((Date.now() - new Date(vacancy.created_at).getTime()) / 86400000))
                : null;

              return (
                <div key={vacancy.id} className="rounded-md border bg-background p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link to={`/vacatures/${vacancy.id}`} className="font-medium text-sm hover:text-stat-blue truncate">
                        {vacancy.title}
                      </Link>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {openSlots} open
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground flex-wrap">
                      <span>{(vacancy.companies as any)?.name ?? 'Opdrachtgever onbekend'}</span>
                      <span>Start: {vacancy.start_date_text || formatDate(vacancy.start_date)}</span>
                      {createdDays != null && <span>{createdDays} dagen open</span>}
                    </div>
                  </div>
                  <Button asChild size="sm" variant="outline" className="h-8 shrink-0">
                    <Link to={`/vacatures/${vacancy.id}`}>
                      <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open
                    </Link>
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Focuslijst — de kop van /taken, niet het volledige overzicht */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Vandaag oppakken</h2>
          <Link to={listHref()} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            Alle taken ({activeTasks.length}) <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Laden...</p>
        ) : shownTasks.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Sparkles className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground">
                {activeTasks.length === 0 ? 'Geen openstaande taken' : 'Niets urgents voor vandaag'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {activeTasks.length === 0 ? (
                  'Klik op "AI Prioriteiten" om taken te genereren op basis van actuele signalen'
                ) : (
                  <>De overige {activeTasks.length} taken staan op <Link to={listHref()} className="underline">Taken</Link>.</>
                )}
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {shownTasks.map((task: any) => (
              <TaskCard
                key={task.id}
                task={task}
                onToggle={handleToggle}
                onEdit={handleEdit}
                onDismiss={handleDismiss}
                showAssignee={scope === 'team'}
              />
            ))}
            {focusTasks.length > shownTasks.length && (
              <Link
                to={listHref()}
                className="block text-center text-xs text-muted-foreground hover:text-foreground py-2"
              >
                Nog {focusTasks.length - shownTasks.length} urgente taken op Taken →
              </Link>
            )}
          </>
        )}
      </div>

      {doneTodayTasks.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Vandaag afgerond ({doneTodayTasks.length})</h3>
          {doneTodayTasks.slice(0, 5).map((task: any) => (
            <TaskCard key={task.id} task={task} onToggle={handleToggle} onEdit={handleEdit} />
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

export default RecruiterWorkbench;
