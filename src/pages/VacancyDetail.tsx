import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ChevronRight, Edit, UserSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import VacancySlideOver from '@/components/vacancies/VacancySlideOver';
import VacancyDetailsTab from '@/components/vacancies/tabs/VacancyDetailsTab';
import VacancyMatchesTab from '@/components/vacancies/tabs/VacancyMatchesTab';
import VacancyPlacementsTab from '@/components/vacancies/tabs/VacancyPlacementsTab';

const statusBadge: Record<string, string> = {
  open: 'bg-stat-green/10 text-stat-green border-0',
  on_hold: 'bg-yellow-100 text-yellow-700 border-0',
  vervuld: 'bg-blue-100 text-blue-700 border-0',
  gesloten: 'bg-muted text-muted-foreground border-0',
};
const statusLabel: Record<string, string> = { open: 'Open', on_hold: 'On hold', vervuld: 'Vervuld', gesloten: 'Gesloten' };
const urgencyBadge = (u: number | null) => {
  if (!u) return 'bg-muted text-muted-foreground border-0';
  if (u <= 2) return 'bg-stat-green/10 text-stat-green border-0';
  if (u === 3) return 'bg-yellow-100 text-yellow-700 border-0';
  return 'bg-red-100 text-red-600 border-0';
};

const VacancyDetail = () => {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);

  const { data: vacancy, isLoading } = useQuery({
    queryKey: ['vacancy', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vacancies')
        .select(`*, companies!vacancies_company_id_fkey(id, name, phone, email), company_contacts:company_contacts!company_contacts_company_id_fkey(full_name, phone, is_primary)`)
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
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

  if (isLoading || !vacancy) return <div className="p-8 text-muted-foreground">Laden...</div>;

  const company = vacancy.companies as any;
  const pct = vacancy.required_count > 0 ? Math.round((vacancy.filled_count / vacancy.required_count) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/vacatures" className="hover:text-foreground">Vacatures</Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground">{vacancy.title}</span>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{vacancy.title}</h1>
          {company && (
            <Link to={`/opdrachtgevers/${company.id}`} className="text-sm text-muted-foreground hover:text-primary">
              {company.name}
            </Link>
          )}
          <div className="flex items-center gap-2 mt-2">
            <Badge variant="secondary" className={statusBadge[vacancy.status] ?? ''}>{statusLabel[vacancy.status] ?? vacancy.status}</Badge>
            <Badge variant="secondary" className={urgencyBadge(vacancy.urgency)}>Urgentie {vacancy.urgency}</Badge>
          </div>
          <div className="mt-3 w-64">
            <div className="text-xs text-muted-foreground mb-1">{vacancy.filled_count} van {vacancy.required_count} vervuld</div>
            <Progress value={pct} className="h-2" />
          </div>
        </div>
        <div className="flex gap-2">
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
            <UserSearch className="h-4 w-4" /> Zoek kandidaten
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} className="gap-1">
            <Edit className="h-4 w-4" /> Bewerken
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">Status wijzigen</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {Object.entries(statusLabel).map(([k, v]) => (
                <DropdownMenuItem key={k} onClick={() => statusMutation.mutate(k)}>{v}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="matches">Matches</TabsTrigger>
          <TabsTrigger value="plaatsingen">Plaatsingen</TabsTrigger>
        </TabsList>
        <TabsContent value="details"><VacancyDetailsTab vacancy={vacancy} /></TabsContent>
        <TabsContent value="matches"><VacancyMatchesTab vacancy={vacancy} /></TabsContent>
        <TabsContent value="plaatsingen"><VacancyPlacementsTab vacancyId={vacancy.id} /></TabsContent>
      </Tabs>

      <VacancySlideOver open={editOpen} onOpenChange={setEditOpen} vacancy={vacancy} />
    </div>
  );
};

export default VacancyDetail;
