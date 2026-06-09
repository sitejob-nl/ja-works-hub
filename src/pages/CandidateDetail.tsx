import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ChevronRight, MoreHorizontal, Pencil, FileText, Link2, Copy, Check, MessageCircle, Mail, ClipboardCheck } from 'lucide-react';
import { toast } from 'sonner';
import CandidateProfileTab from '@/components/candidates/tabs/CandidateProfileTab';
import CandidateDocumentsTab from '@/components/candidates/tabs/CandidateDocumentsTab';
import CandidateCommunicationTab from '@/components/candidates/tabs/CandidateCommunicationTab';
import CandidateMatchesTab from '@/components/candidates/tabs/CandidateMatchesTab';
import CandidateVacancyMatchesTab from '@/components/candidates/tabs/CandidateVacancyMatchesTab';
import CandidatePlacementsTab from '@/components/candidates/tabs/CandidatePlacementsTab';
import CandidateScreeningTab from '@/components/candidates/tabs/CandidateScreeningTab';
import CandidateTalentpoolsTab from '@/components/candidates/tabs/CandidateTalentpoolsTab';
import NotesSection from '@/components/shared/NotesSection';
import TasksSection from '@/components/shared/TasksSection';
import EmployeeEmploymentTab from '@/components/employees/tabs/EmployeeEmploymentTab';
import EmployeeOnboardingTab from '@/components/employees/tabs/EmployeeOnboardingTab';
import EmployeeDeductionsTab from '@/components/employees/tabs/EmployeeDeductionsTab';
import EmployeeReservationsTab from '@/components/employees/tabs/EmployeeReservationsTab';
import EmployeeSubsidiesTab from '@/components/employees/tabs/EmployeeSubsidiesTab';
import EmployeeContractsTab from '@/components/employees/tabs/EmployeeContractsTab';
import EmployeeHousingTab from '@/components/employees/tabs/EmployeeHousingTab';
import EmployeeTimesheetsTab from '@/components/employees/tabs/EmployeeTimesheetsTab';
import EmployeeTransportTab from '@/components/employees/tabs/EmployeeTransportTab';
import EmployeeSickTab from '@/components/employees/tabs/EmployeeSickTab';
import EmployeeRegulationsTab from '@/components/employees/tabs/EmployeeRegulationsTab';
import EmployeePortalTab from '@/components/employees/tabs/EmployeePortalTab';
import UnsavedChangesGuard from '@/components/shared/UnsavedChangesGuard';
import { useTrackPageVisit } from '@/hooks/useTrackPageVisit';
import { useTabSearchParam } from '@/hooks/useTabSearchParam';
import { usePublicUrl } from '@/hooks/usePublicUrl';
import { useOutlookAccounts, useOutlookInvoke } from '@/hooks/useOutlookAccounts';
import type { Database } from '@/integrations/supabase/types';

type CandidateStatus = Database['public']['Enums']['candidate_status'];

const statusBadge: Record<string, string> = {
  lead: 'bg-purple-100 text-purple-700 border-0',
  nieuw: 'bg-muted text-muted-foreground border-0',
  werkzoekend: 'bg-stat-green/10 text-stat-green border-0',
  in_screening: 'bg-yellow-100 text-yellow-700 border-0',
  afgewezen: 'bg-red-100 text-red-700 border-0',
  geplaatst: 'bg-blue-100 text-blue-700 border-0',
  niet_beschikbaar: 'bg-orange-100 text-orange-600 border-0',
  uitgeschreven: 'bg-red-100 text-red-600 border-0',
};

const complianceBadge: Record<string, string> = {
  compleet: 'bg-stat-green/10 text-stat-green border-0',
  incompleet: 'bg-yellow-100 text-yellow-700 border-0',
  verlopen: 'bg-red-100 text-red-600 border-0',
};

const statusLabel: Record<string, string> = {
  lead: 'Lead', nieuw: 'Nieuw', werkzoekend: 'Werkzoekend', in_screening: 'In screening',
  afgewezen: 'Afgewezen', geplaatst: 'Geplaatst', niet_beschikbaar: 'Niet beschikbaar', uitgeschreven: 'Uitgeschreven',
};

const allStatuses: CandidateStatus[] = ['lead', 'nieuw', 'werkzoekend', 'in_screening', 'afgewezen', 'geplaatst', 'niet_beschikbaar', 'uitgeschreven'];

const CandidateDetail = () => {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useTabSearchParam('profiel');
  const [screeningDirty, setScreeningDirty] = useState(false);
  const { buildUrl } = usePublicUrl();
  const callOutlook = useOutlookInvoke();
  const { hasUsableAccounts } = useOutlookAccounts('mail_send');

  const { data: candidate, isLoading } = useQuery({
    queryKey: ['candidate', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('candidates').select('*, candidate_employment(*)').eq('id', id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  useTrackPageVisit({
    id,
    type: 'kandidaat',
    label: candidate ? `${candidate.first_name} ${candidate.last_name}` : undefined,
    sublabel: candidate?.status,
  });

  // Fetch or create profile token
  const { data: activeToken, refetch: refetchToken } = useQuery({
    queryKey: ['candidate-profile-token-header', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidate_profile_tokens')
        .select('*')
        .eq('candidate_id', id!)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
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

  const handleGenerateLink = async () => {
    if (!candidate) return;
    try {
      const { data, error } = await supabase
        .from('candidate_profile_tokens')
        .insert({ organization_id: candidate.organization_id, candidate_id: candidate.id })
        .select('token')
        .single();
      if (error) throw error;
      await refetchToken();
      qc.invalidateQueries({ queryKey: ['candidate-profile-token', id] });
      setLinkDialogOpen(true);
      toast.success('Profiellink aangemaakt');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const profileUrl = activeToken?.token ? buildUrl(`/profiel/${activeToken.token}`) : '';
  const isTokenActive = activeToken && !activeToken.used_at && new Date(activeToken.expires_at) > new Date();

  const handleCopy = () => {
    navigator.clipboard.writeText(profileUrl);
    setCopied(true);
    toast.success('Link gekopieerd');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleWhatsApp = () => {
    const phone = candidate?.phone?.replace(/[^0-9+]/g, '') ?? '';
    const text = `Hoi ${candidate?.first_name}, vul je profiel aan via deze link: ${profileUrl}`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
  };

  const handleEmail = () => {
    if (!candidate?.email) return;
    if (!hasUsableAccounts) {
      toast.error('Geen verbonden e-mailaccount gevonden. Koppel eerst Outlook via Instellingen.');
      return;
    }
    sendProfileLinkMutation.mutate();
  };

  const sendProfileLinkMutation = useMutation({
    mutationFn: async () => {
      if (!candidate?.email) throw new Error('Geen e-mailadres bekend');
      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;color:#334155;">
          <p>Hoi ${candidate.first_name},</p>
          <p>Vul je profiel aan via onderstaande link:</p>
          <p>
            <a href="${profileUrl}" style="display:inline-block;background:#1e293b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">
              Profiel aanvullen
            </a>
          </p>
          <p style="color:#64748b;font-size:13px;">Lukt de knop niet? Gebruik dan deze link:<br>${profileUrl}</p>
        </div>
      `;
      return callOutlook('outlook-send-mail', {
        to: [candidate.email],
        subject: 'Vul je profiel aan',
        html,
        candidate_id: candidate.id,
      });
    },
    onSuccess: () => toast.success('Uitnodiging verstuurd via het verbonden e-mailaccount'),
    onError: (error: Error) => toast.error(`E-mail versturen mislukt: ${error.message}`),
  });

  const isEmployee = candidate?.employee_status != null;
  const employments = ((candidate as any)?.candidate_employment ?? [])
    .sort((a: any, b: any) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime());
  const currentEmployment = employments.find((e: any) => e.is_current) ?? employments[0];

  if (isLoading) return <div className="p-8 text-muted-foreground">Laden...</div>;
  if (!candidate) return <div className="p-8 text-muted-foreground">Niet gevonden</div>;

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0">
      <UnsavedChangesGuard when={screeningDirty} />
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/kandidaten" className="hover:text-foreground transition-colors">Kandidaten</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground truncate">{candidate.first_name} {candidate.last_name}</span>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold truncate">{candidate.first_name} {candidate.last_name}</h1>
          <Badge variant="secondary" className={statusBadge[candidate.status] ?? ''}>{statusLabel[candidate.status] ?? candidate.status}</Badge>
          <Badge variant="secondary" className={complianceBadge[candidate.compliance_status] ?? ''}>{candidate.compliance_status}</Badge>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => isTokenActive ? setLinkDialogOpen(true) : handleGenerateLink()}
            className="gap-1.5"
          >
            <Link2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{isTokenActive ? 'Profiellink versturen' : 'Profiellink genereren'}</span>
            <span className="sm:hidden">Link</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate(`/cv-tool/${id}`)} className="gap-1.5">
            <FileText className="h-3.5 w-3.5" /> <span className="hidden sm:inline">CV Genereren</span><span className="sm:hidden">CV</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate(`/kandidaten/${id}/bewerken`)} className="gap-1.5">
            <Pencil className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Bewerken</span>
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

      {/* Profile Link Dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Profiellink versturen</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input value={profileUrl} readOnly className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4 text-stat-green" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <div className="flex gap-3">
              {candidate.phone && (
                <Button onClick={handleWhatsApp} className="gap-2 bg-[#25D366] hover:bg-[#1da851] text-white">
                  <MessageCircle className="h-4 w-4" /> WhatsApp
                </Button>
              )}
              {candidate.email && (
                <Button variant="outline" onClick={handleEmail} disabled={sendProfileLinkMutation.isPending} className="gap-2">
                  <Mail className="h-4 w-4" /> {sendProfileLinkMutation.isPending ? 'Versturen...' : 'E-mail'}
                </Button>
              )}
            </div>
            {activeToken?.used_at && (
              <p className="text-sm text-muted-foreground">Deze link is al gebruikt. Genereer een nieuwe link via het Profiel-tabblad.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <TabsList className="w-max sm:w-auto">
            <TabsTrigger value="profiel">Profiel</TabsTrigger>
            <TabsTrigger value="notities">Notities</TabsTrigger>
            <TabsTrigger value="screening" className="gap-1.5"><ClipboardCheck className="h-3.5 w-3.5" />Screening</TabsTrigger>
            <TabsTrigger value="huisvesting">Huisvesting</TabsTrigger>
            <TabsTrigger value="transport">Vervoer</TabsTrigger>
            <TabsTrigger value="documenten">Documenten</TabsTrigger>
            <TabsTrigger value="communicatie">Communicatie</TabsTrigger>
            <TabsTrigger value="matches">Matches</TabsTrigger>
            <TabsTrigger value="vacatures">Vacatures</TabsTrigger>
            <TabsTrigger value="plaatsingen">Plaatsingen</TabsTrigger>
            <TabsTrigger value="taken">Taken</TabsTrigger>
            <TabsTrigger value="talentpools">Pools</TabsTrigger>
            {isEmployee && (
              <>
                <TabsTrigger value="dienstverband">Dienst</TabsTrigger>
                <TabsTrigger value="onboarding">Onboarding</TabsTrigger>
                <TabsTrigger value="inhoudingen">Inhoud.</TabsTrigger>
                <TabsTrigger value="reserveringen">Reserv.</TabsTrigger>
                <TabsTrigger value="subsidies">Subsidies</TabsTrigger>
                <TabsTrigger value="contracten">Contract</TabsTrigger>
                <TabsTrigger value="uren">Uren</TabsTrigger>
                <TabsTrigger value="ziekte">Ziekte</TabsTrigger>
                <TabsTrigger value="reglementen">Regl.</TabsTrigger>
                <TabsTrigger value="portaal">Portaal</TabsTrigger>
              </>
            )}
          </TabsList>
        </div>
        <TabsContent value="profiel"><CandidateProfileTab candidate={candidate} /></TabsContent>
        <TabsContent value="documenten"><CandidateDocumentsTab candidateId={id!} /></TabsContent>
        <TabsContent value="communicatie"><CandidateCommunicationTab candidateId={id!} /></TabsContent>
        <TabsContent value="matches"><CandidateMatchesTab candidateId={id!} /></TabsContent>
        <TabsContent value="vacatures"><CandidateVacancyMatchesTab candidateId={id!} /></TabsContent>
        <TabsContent value="plaatsingen"><CandidatePlacementsTab candidateId={id!} /></TabsContent>
        <TabsContent value="screening" forceMount>
          <CandidateScreeningTab
            candidate={candidate}
            onUpdate={() => qc.invalidateQueries({ queryKey: ['candidate', id] })}
            onDirtyChange={setScreeningDirty}
          />
        </TabsContent>
        <TabsContent value="notities"><NotesSection entityId={id!} entityType="kandidaat" /></TabsContent>
        <TabsContent value="huisvesting"><EmployeeHousingTab candidateId={id!} /></TabsContent>
        <TabsContent value="transport"><EmployeeTransportTab candidateId={id!} /></TabsContent>
        <TabsContent value="taken"><TasksSection entityId={id!} entityType="kandidaat" /></TabsContent>
        <TabsContent value="talentpools"><CandidateTalentpoolsTab candidateId={id!} /></TabsContent>
        {isEmployee && (
          <>
            <TabsContent value="dienstverband"><EmployeeEmploymentTab candidateId={id!} candidate={candidate} employment={currentEmployment} /></TabsContent>
            <TabsContent value="onboarding"><EmployeeOnboardingTab candidateId={id!} candidate={candidate} /></TabsContent>
            <TabsContent value="inhoudingen"><EmployeeDeductionsTab candidateId={id!} /></TabsContent>
            <TabsContent value="reserveringen"><EmployeeReservationsTab candidateId={id!} /></TabsContent>
            <TabsContent value="subsidies"><EmployeeSubsidiesTab candidateId={id!} /></TabsContent>
            <TabsContent value="contracten"><EmployeeContractsTab candidateId={id!} candidate={candidate} employment={currentEmployment} /></TabsContent>
            <TabsContent value="uren"><EmployeeTimesheetsTab candidateId={id!} /></TabsContent>
            <TabsContent value="ziekte"><EmployeeSickTab candidateId={id!} candidate={candidate} /></TabsContent>
            <TabsContent value="reglementen"><EmployeeRegulationsTab candidateId={id!} /></TabsContent>
            <TabsContent value="portaal"><EmployeePortalTab candidateId={id!} candidate={candidate} /></TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
};

export default CandidateDetail;
