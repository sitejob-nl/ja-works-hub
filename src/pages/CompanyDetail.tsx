import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ChevronRight, MoreHorizontal, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import CompanyInfoTab from '@/components/companies/tabs/CompanyInfoTab';
import CompanyInfoTab from '@/components/companies/tabs/CompanyInfoTab';
import ContactsTab from '@/components/companies/tabs/ContactsTab';
import RateAgreementsTab from '@/components/companies/tabs/RateAgreementsTab';
import SlaTab from '@/components/companies/tabs/SlaTab';
import CommunicationTab from '@/components/companies/tabs/CommunicationTab';
import PlacementsTab from '@/components/companies/tabs/PlacementsTab';

const CompanyDetail = () => {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: company, isLoading } = useQuery({
    queryKey: ['company', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('companies').select('*').eq('id', id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
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
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/opdrachtgevers" className="hover:text-foreground transition-colors">Opdrachtgevers</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">{company.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{company.name}</h1>
          <Badge variant={company.is_active ? 'default' : 'secondary'} className={company.is_active ? 'bg-stat-green/10 text-stat-green border-0' : ''}>
            {company.is_active ? 'Actief' : 'Inactief'}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate(`/opdrachtgevers/${id}/bewerken`)} className="gap-2">
            <Pencil className="h-3.5 w-3.5" /> Bewerken
          </Button>
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

      {/* Tabs */}
      <Tabs defaultValue="gegevens">
        <TabsList>
          <TabsTrigger value="gegevens">Gegevens</TabsTrigger>
          <TabsTrigger value="contacten">Contactpersonen</TabsTrigger>
          <TabsTrigger value="tarieven">Tariefafspraken</TabsTrigger>
          <TabsTrigger value="sla">SLA</TabsTrigger>
          <TabsTrigger value="communicatie">Communicatie</TabsTrigger>
          <TabsTrigger value="plaatsingen">Plaatsingen</TabsTrigger>
        </TabsList>
        <TabsContent value="gegevens"><CompanyInfoTab company={company} /></TabsContent>
        <TabsContent value="contacten"><ContactsTab companyId={id!} /></TabsContent>
        <TabsContent value="tarieven"><RateAgreementsTab companyId={id!} /></TabsContent>
        <TabsContent value="sla"><SlaTab companyId={id!} /></TabsContent>
        <TabsContent value="communicatie"><CommunicationTab companyId={id!} /></TabsContent>
        <TabsContent value="plaatsingen"><PlacementsTab companyId={id!} /></TabsContent>
      </Tabs>
    </div>
  );
};

export default CompanyDetail;
