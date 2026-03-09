import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ChevronRight, MoreHorizontal, Pencil, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import CandidateSlideOver from '@/components/candidates/CandidateSlideOver';
import CandidateProfileTab from '@/components/candidates/tabs/CandidateProfileTab';
import CandidateDocumentsTab from '@/components/candidates/tabs/CandidateDocumentsTab';
import CandidateCommunicationTab from '@/components/candidates/tabs/CandidateCommunicationTab';
import CandidateMatchesTab from '@/components/candidates/tabs/CandidateMatchesTab';
import CandidatePlacementsTab from '@/components/candidates/tabs/CandidatePlacementsTab';
import { CandidatePreferencesTab } from '@/components/candidates/tabs/CandidatePreferencesTab';
import type { Database } from '@/integrations/supabase/types';

type CandidateStatus = Database['public']['Enums']['candidate_status'];

const statusBadge: Record<string, string> = {
  nieuw: 'bg-muted text-muted-foreground border-0',
  in_behandeling: 'bg-yellow-100 text-yellow-700 border-0',
  beschikbaar: 'bg-stat-green/10 text-stat-green border-0',
  geplaatst: 'bg-blue-100 text-blue-700 border-0',
  inactief: 'bg-orange-100 text-orange-600 border-0',
  afgewezen: 'bg-red-100 text-red-600 border-0',
};

const complianceBadge: Record<string, string> = {
  compleet: 'bg-stat-green/10 text-stat-green border-0',
  incompleet: 'bg-yellow-100 text-yellow-700 border-0',
  verlopen: 'bg-red-100 text-red-600 border-0',
};

const statusLabel: Record<string, string> = {
  nieuw: 'Nieuw', in_behandeling: 'In behandeling', beschikbaar: 'Beschikbaar',
  geplaatst: 'Geplaatst', inactief: 'Inactief', afgewezen: 'Afgewezen',
};

const allStatuses: CandidateStatus[] = ['nieuw', 'in_behandeling', 'beschikbaar', 'geplaatst', 'inactief', 'afgewezen'];

const CandidateDetail = () => {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);

  const { data: candidate, isLoading } = useQuery({
    queryKey: ['candidate', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('candidates').select('*').eq('id', id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const changeStatus = useMutation({
    mutationFn: async (status: CandidateStatus) => {
      const { error } = await supabase.from('candidates').update({ status }).eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidate', id] });
      qc.invalidateQueries({ queryKey: ['candidates'] });
      toast.success('Status bijgewerkt');
    },
  });

  if (isLoading) return <div className="p-8 text-muted-foreground">Laden...</div>;
  if (!candidate) return <div className="p-8 text-muted-foreground">Niet gevonden</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/kandidaten" className="hover:text-foreground transition-colors">Kandidaten</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">{candidate.first_name} {candidate.last_name}</span>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{candidate.first_name} {candidate.last_name}</h1>
          <Badge variant="secondary" className={statusBadge[candidate.status] ?? ''}>{statusLabel[candidate.status] ?? candidate.status}</Badge>
          <Badge variant="secondary" className={complianceBadge[candidate.compliance_status] ?? ''}>{candidate.compliance_status}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate(`/cv-tool/${id}`)} className="gap-2">
            <FileText className="h-3.5 w-3.5" /> CV Genereren
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} className="gap-2">
            <Pencil className="h-3.5 w-3.5" /> Bewerken
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Status wijzigen</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {allStatuses.map((s) => (
                    <DropdownMenuItem key={s} onClick={() => changeStatus.mutate(s)} disabled={s === candidate.status}>
                      {statusLabel[s]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Tabs defaultValue="profiel">
        <TabsList>
          <TabsTrigger value="profiel">Profiel</TabsTrigger>
          <TabsTrigger value="documenten">Documenten</TabsTrigger>
          <TabsTrigger value="communicatie">Communicatie</TabsTrigger>
          <TabsTrigger value="matches">Matches</TabsTrigger>
          <TabsTrigger value="plaatsingen">Plaatsingen</TabsTrigger>
        </TabsList>
        <TabsContent value="profiel"><CandidateProfileTab candidate={candidate} /></TabsContent>
        <TabsContent value="documenten"><CandidateDocumentsTab candidateId={id!} /></TabsContent>
        <TabsContent value="communicatie"><CandidateCommunicationTab candidateId={id!} /></TabsContent>
        <TabsContent value="matches"><CandidateMatchesTab candidateId={id!} /></TabsContent>
        <TabsContent value="plaatsingen"><CandidatePlacementsTab candidateId={id!} /></TabsContent>
      </Tabs>

      <CandidateSlideOver open={editOpen} onOpenChange={setEditOpen} candidate={candidate} />
    </div>
  );
};

export default CandidateDetail;
