import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { ChevronRight, Edit, UserSearch, Sparkles, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';
import VacancyDetailsTab from '@/components/vacancies/tabs/VacancyDetailsTab';
import VacancyMatchesTab from '@/components/vacancies/tabs/VacancyMatchesTab';
import VacancyPlacementsTab from '@/components/vacancies/tabs/VacancyPlacementsTab';
import VacancySignupLinkButton from '@/components/vacancies/VacancySignupLinkButton';
import VacancyReadinessStrip from '@/components/vacancies/VacancyReadinessStrip';
import { useTrackPageVisit } from '@/hooks/useTrackPageVisit';
import { useTabSearchParam } from '@/hooks/useTabSearchParam';
import NotesSection from '@/components/shared/NotesSection';
import TasksSection from '@/components/shared/TasksSection';

const statusBadge: Record<string, string> = {
  open: 'bg-stat-green/10 text-stat-green border-0',
  on_hold: 'bg-yellow-100 text-yellow-700 border-0',
  vervuld: 'bg-blue-100 text-blue-700 border-0',
  gesloten: 'bg-muted text-muted-foreground border-0',
};
const statusLabel: Record<string, string> = { open: 'Open', on_hold: 'On hold', vervuld: 'Vervuld', gesloten: 'Gesloten' };
const urgencyMeta: Record<number, { label: string; className: string }> = {
  1: { label: '1 — Laag', className: 'bg-stat-green/10 text-stat-green border-0' },
  2: { label: '2 — Normaal', className: 'bg-yellow-100 text-yellow-700 border-0' },
  3: { label: '3 — Hoog', className: 'bg-red-100 text-red-600 border-0' },
};

const VacancyDetail = () => {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [activeTab, setActiveTab] = useTabSearchParam('details');
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: vacancy, isLoading } = useQuery({
    queryKey: ['vacancy', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vacancies')
        .select(`*, companies!vacancies_company_id_fkey(id, name, phone, email)`)
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: matchCount = 0 } = useQuery({
    queryKey: ['vacancy-match-count', id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('matches')
        .select('id', { count: 'exact', head: true })
        .eq('vacancy_id', id!);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!id,
  });

  useTrackPageVisit({
    id,
    type: 'vacature',
    label: vacancy?.title,
    sublabel: (vacancy?.companies as any)?.name,
  });

  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      const { error } = await supabase.from('vacancies').update({ status } as any).eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vacancy', id] });
      qc.invalidateQueries({ queryKey: ['vacancies'] });
      toast.success('Status bijgewerkt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  // AI-skills aanvullen uit de vacaturetekst (Fase 1.5b). Overschrijft required_skills.
  const enrichMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('enrich-vacancies', { body: { vacancy_id: id } });
      if (error) throw error;
      if (data?.result?.status === 'failed') throw new Error(data.result.reason ?? 'AI-verrijking mislukt');
      return data?.result;
    },
    onSuccess: (result: any) => {
      qc.invalidateQueries({ queryKey: ['vacancy', id] });
      const skills = result?.required_skills ?? [];
      toast.success(skills.length ? `AI stelde ${skills.length} vaardigheid${skills.length === 1 ? '' : 'heden'} voor` : 'Geen extra vaardigheden gevonden');
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Definitief verwijderen (alleen admin; RLS dwingt dit ook af). Matches gaan mee (CASCADE);
  // een vacature met plaatsing blokkeert via een FK (23503) en wordt netjes afgevangen.
  const deleteVacancy = useMutation({
    mutationFn: async () => {
      // .select() zodat we zien of er écht een rij verdween: RLS blokkeert een delete zonder
      // fout (0 rijen) — dan is de gebruiker geen admin (of de policy mist nog).
      const { data, error } = await supabase.from('vacancies').delete().eq('id', id!).select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Verwijderen niet toegestaan — alleen een beheerder kan vacatures verwijderen.');
      logAudit({ action: 'delete', tableName: 'vacancies', recordId: id!, oldValues: vacancy, reason: 'permanent_deletion' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vacancies'] });
      toast.success('Vacature verwijderd');
      navigate('/vacatures');
    },
    onError: (e: any) => {
      setDeleteOpen(false);
      if (e?.code === '23503') {
        toast.error('Kan niet verwijderen: er zijn nog gekoppelde plaatsingen. Verwijder of ontkoppel die eerst.');
      } else {
        toast.error(e.message);
      }
    },
  });

  if (isLoading || !vacancy) return <div className="p-8 text-muted-foreground">Laden...</div>;

  const company = vacancy.companies as any;
  const pct = vacancy.required_count > 0 ? Math.round((vacancy.filled_count / vacancy.required_count) * 100) : 0;
  const hasRequirements = (vacancy.required_skills ?? []).length > 0 || (vacancy.required_certifications ?? []).length > 0;
  const openSpots = Math.max(0, Number(vacancy.required_count ?? 0) - Number(vacancy.filled_count ?? 0));
  const primaryActionLabel = !hasRequirements
    ? 'Maak matchbaar'
    : openSpots <= 0
      ? 'Bekijk plaatsingen'
      : matchCount > 0
        ? 'Volg shortlist'
        : 'Zoek kandidaten';
  const handlePrimaryAction = () => {
    if (!hasRequirements) enrichMutation.mutate();
    else if (openSpots <= 0) setActiveTab('plaatsingen');
    else setActiveTab('matches');
  };

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/vacatures" className="hover:text-foreground">Vacatures</Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground truncate">{vacancy.title}</span>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold truncate">{vacancy.title}</h1>
          {company && (
            <Link to={`/opdrachtgevers/${company.id}`} className="text-sm text-muted-foreground hover:text-stat-blue">
              {company.name}
            </Link>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Badge variant="secondary" className={statusBadge[vacancy.status] ?? ''}>{statusLabel[vacancy.status] ?? vacancy.status}</Badge>
            {vacancy.urgency && urgencyMeta[vacancy.urgency] && (
              <Badge variant="secondary" className={urgencyMeta[vacancy.urgency].className}>Urgentie: {urgencyMeta[vacancy.urgency].label}</Badge>
            )}
          </div>
          <div className="mt-3 max-w-64">
            <div className="text-xs text-muted-foreground mb-1">{vacancy.filled_count} van {vacancy.required_count} vervuld</div>
            <Progress value={pct} className="h-2" />
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" onClick={handlePrimaryAction} disabled={!hasRequirements && enrichMutation.isPending} className="gap-1">
            <UserSearch className="h-4 w-4" />
            <span>{!hasRequirements && enrichMutation.isPending ? 'AI bezig...' : primaryActionLabel}</span>
          </Button>
          <VacancySignupLinkButton vacancy={vacancy} />
          <Button
            size="sm"
            className="gap-1"
            onClick={() => {
              const parts = [vacancy.title];
              if (vacancy.required_skills?.length) parts.push(`met ${vacancy.required_skills.join(', ')} ervaring`);
              if (vacancy.location) parts.push(`in ${vacancy.location}`);
              if (vacancy.required_certifications?.length) parts.push(`met ${vacancy.required_certifications.join(', ')} certificering`);
              const q = parts.join(' ');
              navigate(`/kandidaten-zoeken?query=${encodeURIComponent(q)}`);
            }}
          >
            <UserSearch className="h-4 w-4" /> <span className="hidden sm:inline">Breed zoeken</span><span className="sm:hidden">Breed</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => enrichMutation.mutate()} disabled={enrichMutation.isPending} className="gap-1" title="Vaardigheden uit de vacaturetekst halen met AI">
            <Sparkles className="h-4 w-4" /> <span className="hidden sm:inline">{enrichMutation.isPending ? 'AI bezig…' : 'AI-skills'}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate(`/vacatures/${id}/bewerken`)} className="gap-1">
            <Edit className="h-4 w-4" /> <span className="hidden sm:inline">Bewerken</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">Status</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {Object.entries(statusLabel).map(([k, v]) => (
                <DropdownMenuItem key={k} onClick={() => statusMutation.mutate(k)}>{v}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {isAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="px-2" aria-label="Meer acties"><MoreHorizontal className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => setDeleteOpen(true)}>
                  Verwijderen
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Vacature definitief verwijderen?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium">{vacancy.title}</span> wordt permanent verwijderd, inclusief bijbehorende matches. Dit kan niet ongedaan worden gemaakt.
              Lukt het niet, dan zijn er nog gekoppelde plaatsingen — sluit de vacature dan in plaats daarvan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleteVacancy.mutate()} disabled={deleteVacancy.isPending}>
              Verwijderen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <VacancyReadinessStrip
        vacancy={vacancy}
        matchCount={matchCount}
        onDetails={() => setActiveTab('details')}
        onMatches={() => setActiveTab('matches')}
        onEnrich={() => enrichMutation.mutate()}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <TabsList className="w-max sm:w-auto">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="matches">Matches</TabsTrigger>
            <TabsTrigger value="plaatsingen">Plaatsingen</TabsTrigger>
            <TabsTrigger value="notities">Notities</TabsTrigger>
            <TabsTrigger value="taken">Taken</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="details"><VacancyDetailsTab vacancy={vacancy} /></TabsContent>
        <TabsContent value="matches"><VacancyMatchesTab vacancy={vacancy} /></TabsContent>
        <TabsContent value="plaatsingen"><VacancyPlacementsTab vacancyId={vacancy.id} /></TabsContent>
        <TabsContent value="notities"><NotesSection entityId={vacancy.id} entityType="vacature" /></TabsContent>
        <TabsContent value="taken"><TasksSection entityId={vacancy.id} entityType="vacature" /></TabsContent>
      </Tabs>
    </div>
  );
};

export default VacancyDetail;
