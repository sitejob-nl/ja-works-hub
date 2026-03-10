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
import { ChevronRight, MoreHorizontal, Pencil, ClipboardList, Copy, Check, MessageCircle, Mail } from 'lucide-react';
import { toast } from 'sonner';
import type { Database } from '@/integrations/supabase/types';

import EmployeeProfileTab from '@/components/employees/tabs/EmployeeProfileTab';
import EmployeeOnboardingTab from '@/components/employees/tabs/EmployeeOnboardingTab';
import CandidateDocumentsTab from '@/components/candidates/tabs/CandidateDocumentsTab';
import EmployeeHousingTab from '@/components/employees/tabs/EmployeeHousingTab';
import EmployeePlacementsTab from '@/components/employees/tabs/EmployeePlacementsTab';
import EmployeeTimesheetsTab from '@/components/employees/tabs/EmployeeTimesheetsTab';
import EmployeeTransportTab from '@/components/employees/tabs/EmployeeTransportTab';
import EmployeeSickTab from '@/components/employees/tabs/EmployeeSickTab';
import EmployeeRegulationsTab from '@/components/employees/tabs/EmployeeRegulationsTab';
import EmployeeContractsTab from '@/components/employees/tabs/EmployeeContractsTab';

type EmployeeStatus = Database['public']['Enums']['employee_status'];

const statusBadge: Record<string, string> = {
  onboarding: 'bg-yellow-100 text-yellow-700 border-0',
  actief: 'bg-stat-green/10 text-stat-green border-0',
  ziek: 'bg-orange-100 text-orange-600 border-0',
  uit_dienst: 'bg-muted text-muted-foreground border-0',
};
const statusLabel: Record<string, string> = {
  onboarding: 'Onboarding', actief: 'Actief', ziek: 'Ziek', uit_dienst: 'Uit dienst',
};
const complianceBadge: Record<string, string> = {
  compleet: 'bg-stat-green/10 text-stat-green border-0',
  incompleet: 'bg-yellow-100 text-yellow-700 border-0',
  verlopen: 'bg-red-100 text-red-600 border-0',
};
const allStatuses: EmployeeStatus[] = ['onboarding', 'actief', 'ziek', 'uit_dienst'];

const EmployeeDetail = () => {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [onboardingDialogOpen, setOnboardingDialogOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: employee, isLoading } = useQuery({
    queryKey: ['employee', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('*, candidates!employees_candidate_id_fkey(*)')
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Fetch onboarding token
  const { data: onboardingToken, refetch: refetchOnboardingToken } = useQuery({
    queryKey: ['onboarding-token', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('onboarding_tokens')
        .select('*')
        .eq('employee_id', id!)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const changeStatus = useMutation({
    mutationFn: async (status: EmployeeStatus) => {
      const { error } = await supabase.from('employees').update({ status }).eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee', id] });
      qc.invalidateQueries({ queryKey: ['employees'] });
      toast.success('Status bijgewerkt');
    },
  });

  const handleGenerateOnboardingLink = async () => {
    if (!employee) return;
    try {
      const { data, error } = await supabase
        .from('onboarding_tokens')
        .insert({ employee_id: employee.id, organization_id: employee.organization_id })
        .select('token')
        .single();
      if (error) throw error;
      await refetchOnboardingToken();
      setOnboardingDialogOpen(true);
      toast.success('Onboardinglink aangemaakt');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const onboardingUrl = onboardingToken?.token ? `${window.location.origin}/onboarding/${onboardingToken.token}` : '';
  const isOnboardingTokenActive = onboardingToken && !onboardingToken.used_at && new Date(onboardingToken.expires_at) > new Date();

  const handleCopy = () => {
    navigator.clipboard.writeText(onboardingUrl);
    setCopied(true);
    toast.success('Link gekopieerd');
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) return <div className="p-8 text-muted-foreground">Laden...</div>;
  if (!employee) return <div className="p-8 text-muted-foreground">Niet gevonden</div>;

  const c = employee.candidates as any;

  const handleWhatsApp = () => {
    const phone = c?.phone?.replace(/[^0-9+]/g, '') ?? '';
    const text = `Hoi ${c?.first_name}, vul je onboarding aan via deze link: ${onboardingUrl}`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
  };

  const handleEmail = () => {
    const subject = encodeURIComponent('Onboarding invullen');
    const body = encodeURIComponent(`Hoi ${c?.first_name},\n\nVul je onboarding aan via deze link:\n${onboardingUrl}\n\nMet vriendelijke groet`);
    window.open(`mailto:${c?.email ?? ''}?subject=${subject}&body=${body}`);
  };

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0">
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/medewerkers" className="hover:text-foreground transition-colors">Medewerkers</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground truncate">{c?.first_name} {c?.last_name}</span>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-semibold truncate">{c?.first_name} {c?.last_name}</h1>
            <Badge variant="secondary" className={statusBadge[employee.status] ?? ''}>{statusLabel[employee.status] ?? employee.status}</Badge>
            <Badge variant="secondary" className={complianceBadge[c?.compliance_status] ?? ''}>{c?.compliance_status}</Badge>
          </div>
          {employee.employee_number && <p className="text-sm text-muted-foreground mt-1">#{employee.employee_number}</p>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => isOnboardingTokenActive ? setOnboardingDialogOpen(true) : handleGenerateOnboardingLink()}
            className="gap-1.5"
          >
            <ClipboardList className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{isOnboardingTokenActive ? 'Onboarding versturen' : 'Onboardinglink'}</span>
            <span className="sm:hidden">Onboarding</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate(`/kandidaten/${employee.candidate_id}/bewerken`)} className="gap-1.5">
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
                    <DropdownMenuItem key={s} onClick={() => changeStatus.mutate(s)} disabled={s === employee.status}>
                      {statusLabel[s]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Onboarding Link Dialog */}
      <Dialog open={onboardingDialogOpen} onOpenChange={setOnboardingDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Onboardinglink versturen</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Verstuur deze link naar {c?.first_name} zodat de medewerker zelf BSN, IBAN en andere gegevens kan invullen.
            </p>
            <div className="flex gap-2">
              <Input value={onboardingUrl} readOnly className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4 text-stat-green" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <div className="flex gap-3">
              {c?.phone && (
                <Button onClick={handleWhatsApp} className="gap-2 bg-[#25D366] hover:bg-[#1da851] text-white">
                  <MessageCircle className="h-4 w-4" /> WhatsApp
                </Button>
              )}
              {c?.email && (
                <Button variant="outline" onClick={handleEmail} className="gap-2">
                  <Mail className="h-4 w-4" /> E-mail
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Tabs defaultValue="profiel">
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <TabsList className="w-max sm:w-auto">
            <TabsTrigger value="profiel">Profiel</TabsTrigger>
            <TabsTrigger value="onboarding">Onboarding</TabsTrigger>
            <TabsTrigger value="documenten">Docs</TabsTrigger>
            <TabsTrigger value="huisvesting">Woning</TabsTrigger>
            <TabsTrigger value="plaatsingen">Plaatsing</TabsTrigger>
            <TabsTrigger value="uren">Uren</TabsTrigger>
            <TabsTrigger value="transport">Transport</TabsTrigger>
            <TabsTrigger value="ziekte">Ziekte</TabsTrigger>
            <TabsTrigger value="reglementen">Regl.</TabsTrigger>
            <TabsTrigger value="contracten">Contract</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="profiel"><EmployeeProfileTab employee={employee} /></TabsContent>
        <TabsContent value="onboarding"><EmployeeOnboardingTab employee={employee} /></TabsContent>
        <TabsContent value="documenten"><CandidateDocumentsTab candidateId={employee.candidate_id} /></TabsContent>
        <TabsContent value="huisvesting"><EmployeeHousingTab employeeId={id!} /></TabsContent>
        <TabsContent value="plaatsingen"><EmployeePlacementsTab employeeId={id!} /></TabsContent>
        <TabsContent value="uren"><EmployeeTimesheetsTab employeeId={id!} /></TabsContent>
        <TabsContent value="transport"><EmployeeTransportTab employeeId={id!} /></TabsContent>
        <TabsContent value="ziekte"><EmployeeSickTab employeeId={id!} employee={employee} /></TabsContent>
        <TabsContent value="reglementen"><EmployeeRegulationsTab employeeId={id!} /></TabsContent>
        <TabsContent value="contracten"><EmployeeContractsTab employeeId={id!} employee={employee} /></TabsContent>
      </Tabs>
    </div>
  );
};

export default EmployeeDetail;
