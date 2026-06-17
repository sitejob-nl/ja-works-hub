import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import CompanyInfoTab from '@/components/companies/tabs/CompanyInfoTab';
import ContactsTab from '@/components/companies/tabs/ContactsTab';
import CompanyFunctionsTab from '@/components/companies/tabs/CompanyFunctionsTab';
import RateAgreementsTab from '@/components/companies/tabs/RateAgreementsTab';
import CommunicationTab from '@/components/companies/tabs/CommunicationTab';
import NotesSection from '@/components/shared/NotesSection';
import TasksSection from '@/components/shared/TasksSection';
import CompanyVacanciesTab from '@/components/companies/tabs/CompanyVacanciesTab';
import PlacementsTab from '@/components/companies/tabs/PlacementsTab';
import { useTrackPageVisit } from '@/hooks/useTrackPageVisit';
import { useTabSearchParam } from '@/hooks/useTabSearchParam';

const CompanyDetail = () => {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useTabSearchParam('gegevens');

  const { data: company, isLoading } = useQuery({
    queryKey: ['company', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('companies').select('*').eq('id', id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  useTrackPageVisit({
    id,
    type: 'opdrachtgever',
    label: company?.name,
  });

  const toggleActive = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('companies').update({ is_active: !company?.is_active }).eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company', id] });
      qc.invalidateQueries({ queryKey: ['companies'] });
      toast.success(company?.is_active ? 'Opdrachtgever gedeactiveerd' : 'Opdrachtgever geactiveerd');
    },
  });

  if (isLoading) return <div className="p-8 text-muted-foreground">Laden...</div>;
  if (!company) return <div className="p-8 text-muted-foreground">Niet gevonden</div>;

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0">
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/opdrachtgevers" className="hover:text-foreground transition-colors">Opdrachtgevers</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground truncate">{company.name}</span>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold truncate">{company.name}</h1>
          <Badge variant={company.is_active ? 'default' : 'secondary'} className={company.is_active ? 'bg-stat-green/10 text-stat-green border-0' : ''}>
            {company.is_active ? 'Actief' : 'Inactief'}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => toggleActive.mutate()}>
                {company.is_active ? 'Deactiveren' : 'Activeren'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <TabsList className="w-max sm:w-auto">
            <TabsTrigger value="gegevens">Gegevens</TabsTrigger>
            <TabsTrigger value="contacten">Contacten</TabsTrigger>
            <TabsTrigger value="functies">Functies</TabsTrigger>
            <TabsTrigger value="tarieven">Tarieven</TabsTrigger>
            <TabsTrigger value="communicatie">Comm.</TabsTrigger>
            <TabsTrigger value="vacatures">Vacatures</TabsTrigger>
            <TabsTrigger value="plaatsingen">Plaatsingen</TabsTrigger>
            <TabsTrigger value="notities">Notities</TabsTrigger>
            <TabsTrigger value="taken">Taken</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="gegevens"><CompanyInfoTab company={company} /></TabsContent>
        <TabsContent value="contacten"><ContactsTab companyId={id!} /></TabsContent>
        <TabsContent value="functies"><CompanyFunctionsTab companyId={id!} /></TabsContent>
        <TabsContent value="tarieven"><RateAgreementsTab companyId={id!} /></TabsContent>
        <TabsContent value="communicatie"><CommunicationTab companyId={id!} /></TabsContent>
        <TabsContent value="vacatures"><CompanyVacanciesTab companyId={id!} /></TabsContent>
        <TabsContent value="plaatsingen"><PlacementsTab companyId={id!} companyName={company.name} /></TabsContent>
        <TabsContent value="notities"><NotesSection entityId={id!} entityType="opdrachtgever" /></TabsContent>
        <TabsContent value="taken"><TasksSection entityId={id!} entityType="opdrachtgever" /></TabsContent>
      </Tabs>
    </div>
  );
};

export default CompanyDetail;
