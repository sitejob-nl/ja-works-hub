import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ChevronRight, MoreHorizontal, Pencil } from 'lucide-react';
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

  if (isLoading) return <div className="p-8 text-muted-foreground">Laden...</div>;
  if (!employee) return <div className="p-8 text-muted-foreground">Niet gevonden</div>;

  const c = employee.candidates as any;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/medewerkers" className="hover:text-foreground transition-colors">Medewerkers</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">{c?.first_name} {c?.last_name}</span>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{c?.first_name} {c?.last_name}</h1>
            <Badge variant="secondary" className={statusBadge[employee.status] ?? ''}>{statusLabel[employee.status] ?? employee.status}</Badge>
            <Badge variant="secondary" className={complianceBadge[c?.compliance_status] ?? ''}>{c?.compliance_status}</Badge>
          </div>
          {employee.employee_number && <p className="text-sm text-muted-foreground mt-1">#{employee.employee_number}</p>}
        </div>
        <div className="flex items-center gap-2">
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

      <Tabs defaultValue="profiel">
        <TabsList className="flex-wrap">
          <TabsTrigger value="profiel">Profiel</TabsTrigger>
          <TabsTrigger value="onboarding">Onboarding</TabsTrigger>
          <TabsTrigger value="documenten">Documenten</TabsTrigger>
          <TabsTrigger value="huisvesting">Huisvesting</TabsTrigger>
          <TabsTrigger value="plaatsingen">Plaatsingen</TabsTrigger>
          <TabsTrigger value="uren">Uren</TabsTrigger>
          <TabsTrigger value="transport">Transport</TabsTrigger>
          <TabsTrigger value="ziekte">Ziekte</TabsTrigger>
          <TabsTrigger value="reglementen">Reglementen</TabsTrigger>
          <TabsTrigger value="contracten">Contracten</TabsTrigger>
        </TabsList>
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
