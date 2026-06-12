import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { formatDate } from '@/lib/format';
import {
  Sparkles, Plus, CheckCircle2, Clock, AlertTriangle, ArrowUpCircle,
  CircleDot, Shield, Users, Briefcase, UserCheck, Heart, RefreshCw,
  ExternalLink, X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { priorityConfig, entityLinks } from '@/lib/tasks';

const categoryConfig: Record<string, { label: string; icon: typeof Shield }> = {
  compliance: { label: 'Compliance', icon: Shield },
  opvolging: { label: 'Opvolging', icon: Clock },
  matching: { label: 'Matching', icon: Briefcase },
  onboarding: { label: 'Onboarding', icon: UserCheck },
  ziekte: { label: 'Ziekte', icon: Heart },
  overig: { label: 'Overig', icon: CircleDot },
};

interface TaskForm {
  title: string;
  description: string;
  priority: string;
  category: string;
  due_date: string;
}

const emptyForm: TaskForm = { title: '', description: '', priority: 'medium', category: 'overig', due_date: '' };

const RecruiterWorkbench = () => {
  const { user, profile } = useAuth();
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>('all');
  const [scope, setScope] = useState<'mij' | 'team'>('mij');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [form, setForm] = useState<TaskForm>(emptyForm);
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['recruiter-tasks', user?.id, scope],
    queryFn: async () => {
      let q = supabase
        .from('recruiter_tasks' as any)
        .select('*')
        .order('created_at', { ascending: false });
      // 'mij' = persoonlijke funnel (alleen aan mij toegewezen); 'team' = hele org.
      if (scope === 'mij' && user?.id) q = q.eq('assigned_to', user.id);
      const { data, error } = await q;
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  const { data: urgentVacancies = [] } = useQuery({
    queryKey: ['workbench-urgent-vacancies', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vacancies')
        .select('id, title, required_count, filled_count, urgency, start_date, start_date_text, created_at, companies!vacancies_company_id_fkey(name)')
        .eq('organization_id', orgId)
        .eq('status', 'open' as any)
        .eq('urgency', 3)
        .order('start_date', { ascending: true, nullsFirst: false })
        .limit(20);
      if (error) throw error;
      // Toon alleen vacatures met nog open plaatsen (vervulde urgentie-3 is geen werkbank-signaal).
      return (data ?? [])
        .filter((v: any) => (v.required_count ?? 0) > (v.filled_count ?? 0))
        .slice(0, 6);
    },
    enabled: !!orgId,
  });

  const updateTask = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, any> }) => {
      const { error } = await supabase.from('recruiter_tasks' as any).update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recruiter-tasks'] }),
  });

  const createTask = useMutation({
    mutationFn: async (f: TaskForm) => {
      const { error } = await supabase.from('recruiter_tasks' as any).insert({
        organization_id: orgId,
        assigned_to: user?.id,
        title: f.title,
        description: f.description || null,
        priority: f.priority,
        category: f.category,
        due_date: f.due_date || null,
        ai_generated: false,
        status: 'open',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recruiter-tasks'] });
      setSheetOpen(false);
      setForm(emptyForm);
      toast.success('Taak aangemaakt');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleGeneratePriorities = async () => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('recruiter-priorities');
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      qc.invalidateQueries({ queryKey: ['recruiter-tasks'] });
      toast.success(`${data.count} AI-taken gegenereerd`);
    } catch (e: any) {
      toast.error(e.message || 'AI prioriteiten genereren mislukt');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleComplete = (id: string) => {
    updateTask.mutate({ id, updates: { status: 'done', completed_at: new Date().toISOString() } });
  };

  const handleDismiss = (id: string) => {
    updateTask.mutate({ id, updates: { status: 'dismissed' } });
  };

  const handleStartWork = (id: string) => {
    updateTask.mutate({ id, updates: { status: 'in_progress' } });
  };

  // Filter & sort
  const activeTasks = tasks.filter((t: any) => t.status !== 'done' && t.status !== 'dismissed');
  const completedTasks = tasks.filter((t: any) => t.status === 'done');

  const filteredTasks = filter === 'all'
    ? activeTasks
    : activeTasks.filter((t: any) => t.category === filter);

  const sortedTasks = [...filteredTasks].sort((a: any, b: any) => {
    const pa = priorityConfig[a.priority]?.order ?? 99;
    const pb = priorityConfig[b.priority]?.order ?? 99;
    if (pa !== pb) return pa - pb;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  // Stats
  const criticalCount = activeTasks.filter((t: any) => t.priority === 'critical').length;
  const highCount = activeTasks.filter((t: any) => t.priority === 'high').length;
  const inProgressCount = activeTasks.filter((t: any) => t.status === 'in_progress').length;
  const doneToday = completedTasks.filter((t: any) => {
    if (!t.completed_at) return false;
    return new Date(t.completed_at).toDateString() === new Date().toDateString();
  }).length;

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
          <Button variant="outline" size="sm" onClick={() => { setForm(emptyForm); setSheetOpen(true); }} className="gap-1.5">
            <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Taak toevoegen</span><span className="sm:hidden">Taak</span>
          </Button>
          <Button size="sm" onClick={handleGeneratePriorities} disabled={isGenerating} className="gap-1.5">
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline">{isGenerating ? 'Genereren...' : 'AI Prioriteiten'}</span>
            <span className="sm:hidden">{isGenerating ? '...' : 'AI'}</span>
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="text-2xl font-bold">{criticalCount}</span>
            </div>
            <p className="text-xs text-muted-foreground">Kritiek</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2">
              <ArrowUpCircle className="h-4 w-4 text-orange-500" />
              <span className="text-2xl font-bold">{highCount}</span>
            </div>
            <p className="text-xs text-muted-foreground">Hoge prioriteit</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-stat-blue" />
              <span className="text-2xl font-bold">{inProgressCount}</span>
            </div>
            <p className="text-xs text-muted-foreground">In uitvoering</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-stat-green" />
              <span className="text-2xl font-bold">{doneToday}</span>
            </div>
            <p className="text-xs text-muted-foreground">Vandaag afgerond</p>
          </CardContent>
        </Card>
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

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground">Filter:</span>
        <button
          onClick={() => setFilter('all')}
          className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${filter === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted border-border hover:bg-muted/80'}`}
        >
          Alles ({activeTasks.length})
        </button>
        {Object.entries(categoryConfig).map(([key, cfg]) => {
          const count = activeTasks.filter((t: any) => t.category === key).length;
          if (count === 0) return null;
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5 ${filter === key ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted border-border hover:bg-muted/80'}`}
            >
              <cfg.icon className="h-3 w-3" />
              {cfg.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Task list */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Laden...</p>
      ) : sortedTasks.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Sparkles className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">Geen openstaande taken</p>
            <p className="text-xs text-muted-foreground mt-1">Klik op "AI Prioriteiten" om taken te genereren op basis van actuele signalen</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {sortedTasks.map((task: any) => {
            const prio = priorityConfig[task.priority] || priorityConfig.medium;
            const cat = categoryConfig[task.category] || categoryConfig.overig;
            const PrioIcon = prio.icon;
            const CatIcon = cat.icon;
            const link = task.related_entity_type && task.related_entity_id
              ? entityLinks[task.related_entity_type]?.(task.related_entity_id)
              : null;

            return (
              <div
                key={task.id}
                className={`bg-card rounded-lg border p-4 flex items-start gap-3 transition-colors ${
                  task.status === 'in_progress' ? 'border-primary/40 bg-primary/[0.05]' : ''
                }`}
              >
                {/* Priority icon */}
                <button onClick={() => handleComplete(task.id)} className="mt-0.5 shrink-0" title="Afronden">
                  <PrioIcon className={`h-5 w-5 ${task.priority === 'critical' ? 'text-destructive' : task.priority === 'high' ? 'text-orange-500' : 'text-muted-foreground'}`} />
                </button>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{task.title}</span>
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${prio.color}`}>{prio.label}</Badge>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
                      <CatIcon className="h-2.5 w-2.5" />{cat.label}
                    </Badge>
                    {task.ai_generated && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 border-primary/30 text-stat-blue">
                        <Sparkles className="h-2.5 w-2.5" />AI
                      </Badge>
                    )}
                    {task.status === 'in_progress' && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary text-stat-blue">Bezig</Badge>
                    )}
                  </div>
                  {task.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.description}</p>
                  )}
                  {task.ai_reasoning && (
                    <p className="text-[11px] text-muted-foreground/70 mt-1 italic">💡 {task.ai_reasoning}</p>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    {task.due_date && (
                      <span className="text-[10px] text-muted-foreground">Deadline: {formatDate(task.due_date)}</span>
                    )}
                    {link && (
                      <Link to={link} className="text-[10px] hover:underline flex items-center gap-0.5">
                        <ExternalLink className="h-2.5 w-2.5" /> Bekijken
                      </Link>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {task.status === 'open' && (
                    <Button variant="ghost" size="sm" onClick={() => handleStartWork(task.id)} className="text-xs h-7 px-2">
                      Start
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => handleComplete(task.id)} className="text-xs h-7 px-2 text-stat-green">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDismiss(task.id)} className="text-xs h-7 px-2 text-muted-foreground">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Completed today */}
      {doneToday > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Vandaag afgerond ({doneToday})</h3>
          <div className="space-y-1">
            {completedTasks
              .filter((t: any) => t.completed_at && new Date(t.completed_at).toDateString() === new Date().toDateString())
              .map((task: any) => (
                <div key={task.id} className="flex items-center gap-2 px-4 py-2 bg-muted/30 rounded-md">
                  <CheckCircle2 className="h-4 w-4 text-stat-green shrink-0" />
                  <span className="text-sm text-muted-foreground line-through">{task.title}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Create task sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader><SheetTitle>Nieuwe taak</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6">
            <div><Label>Titel *</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
            <div><Label>Beschrijving</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} /></div>
            <div>
              <Label>Prioriteit</Label>
              <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">Kritiek</SelectItem>
                  <SelectItem value="high">Hoog</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Laag</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Categorie</Label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(categoryConfig).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Deadline</Label><Input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} /></div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={() => setSheetOpen(false)}>Annuleren</Button>
              <Button onClick={() => createTask.mutate(form)} disabled={!form.title || createTask.isPending}>
                {createTask.isPending ? 'Aanmaken...' : 'Taak aanmaken'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default RecruiterWorkbench;
