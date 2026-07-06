import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { unwrap, unwrapList } from '@/lib/db';
import { qk } from '@/lib/query-keys';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { usePublicUrl } from '@/hooks/usePublicUrl';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Plus, Eye, Send, FileText, Link2, ShieldCheck } from 'lucide-react';
import { formatDate, formatEUR } from '@/lib/format';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';
import {
  contractTemplateVariableLabel,
  extractContractTemplateVariables,
  renderContractTemplate,
  type ContractTemplateRenderValues,
} from '@/lib/contract-templates';

const statusColors: Record<string, string> = {
  concept: 'bg-muted text-muted-foreground border-0',
  verzonden: 'bg-blue-100 text-blue-700 border-0',
  getekend: 'bg-stat-green/10 text-stat-green border-0',
  verlopen: 'bg-red-100 text-red-600 border-0',
};

const resolveEmployeeId = async (candidateId: string) => {
  const data = await unwrap(
    supabase
      .from('employees')
      .select('id')
      .eq('candidate_id', candidateId)
      .maybeSingle()
  );
  if (!data?.id) throw new Error('Geen medewerkerrecord gevonden voor deze kandidaat');
  return data.id;
};

const EmployeeContractsTab = ({ candidateId, candidate, employment }: { candidateId: string; candidate: any; employment?: any }) => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const { buildUrl } = usePublicUrl();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [contractContent, setContractContent] = useState('');
  const [contractTitle, setContractTitle] = useState('');
  const [viewContract, setViewContract] = useState<any>(null);
  const [templateIssues, setTemplateIssues] = useState<{ missingVariables: string[]; unknownVariables: string[] }>({ missingVariables: [], unknownVariables: [] });

  const { data: contracts = [] } = useQuery({
    queryKey: qk.employees.contracts(candidateId),
    queryFn: () =>
      unwrapList<any>(
        supabase
          .from('contracts')
          .select('*')
          .eq('candidate_id', candidateId)
          .order('created_at', { ascending: false })
      ),
  });

  const { data: templates = [] } = useQuery<any[]>({
    queryKey: qk.employees.contractTemplates(orgId),
    queryFn: () =>
      unwrapList<any>(
        supabase
          .from('contract_templates' as any)
          .select('*')
          .eq('organization_id', orgId)
          .eq('is_active', true)
          .eq('template_status', 'actief')
          .eq('is_placeholder', false)
          .order('name')
      ),
  });

  // Get org info for merge fields
  const { data: org } = useQuery({
    queryKey: qk.employees.organization(orgId),
    queryFn: () => unwrap(supabase.from('organizations').select('name').eq('id', orgId).single()),
  });

  // Get active placement for merge fields
  const { data: placement } = useQuery({
    queryKey: qk.employees.activePlacement(candidateId),
    queryFn: async () => {
      const { data } = await supabase
        .from('placements')
        .select('*, companies(name, phone, email, address_city)')
        .eq('candidate_id', candidateId)
        .eq('status', 'actief')
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const buildTemplateValues = (): ContractTemplateRenderValues => {
    const company = placement?.companies as any;
    const workDays = Array.isArray(placement?.work_days) ? placement.work_days.join(', ') : '';
    const dateValue = (value: string | null | undefined) => value ? formatDate(value) : '';
    return {
      first_name: candidate?.first_name ?? '',
      last_name: candidate?.last_name ?? '',
      employee_name: `${candidate?.first_name ?? ''} ${candidate?.last_name ?? ''}`.trim(),
      employee_number: candidate?.employee_number ?? '',
      candidate_phone: candidate?.phone ?? '',
      candidate_email: candidate?.email ?? '',
      start_date: dateValue(employment?.start_date ?? placement?.start_date),
      end_date: dateValue(employment?.end_date ?? placement?.end_date),
      expected_end_date: dateValue(placement?.expected_end_date),
      function_name: placement?.function_name ?? '',
      hourly_rate: placement?.hourly_rate != null ? formatEUR(placement.hourly_rate) : '',
      client_hourly_rate: placement?.client_hourly_rate != null ? formatEUR(placement.client_hourly_rate) : '',
      overtime_rate: placement?.overtime_rate != null ? formatEUR(placement.overtime_rate) : '',
      contract_hours: employment?.contract_hours?.toString() ?? placement?.cao_hours?.toString() ?? '',
      contract_type: employment?.contract_type ?? '',
      company_name: company?.name ?? '',
      company_phone: company?.phone ?? '',
      company_email: company?.email ?? '',
      work_location: placement?.work_location ?? company?.address_city ?? '',
      work_days: workDays,
      organization_name: org?.name ?? '',
      today: formatDate(new Date().toISOString()),
    };
  };

  const handleSelectTemplate = (templateId: string) => {
    setSelectedTemplate(templateId);
    const tpl = templates.find((t: any) => t.id === templateId);
    if (tpl) {
      setContractTitle(tpl.name);
      const rendered = renderContractTemplate(tpl.content, buildTemplateValues());
      setTemplateIssues({
        missingVariables: rendered.missingVariables,
        unknownVariables: rendered.unknownVariables,
      });
      setContractContent(rendered.content);
    }
  };

  const remainingMergeFields = extractContractTemplateVariables(contractContent);
  const hasMissingMarkers = contractContent.includes('[ontbreekt:');

  const createContract = useMutation({
    mutationFn: async () => {
      if (remainingMergeFields.length > 0 || hasMissingMarkers) {
        throw new Error('Contract bevat nog oningevulde templatevelden');
      }
      const token = crypto.randomUUID();
      const employeeId = await resolveEmployeeId(candidateId);
      await unwrap(supabase.from('contracts').insert({
        organization_id: orgId,
        employee_id: employeeId,
        candidate_id: candidateId,
        template_id: selectedTemplate || null,
        title: contractTitle,
        content: contractContent,
        sign_token: token,
        created_by: user?.id ?? null,
        template_version_id: selectedTemplate || null,
        template_version_name: templates.find((t: any) => t.id === selectedTemplate)?.name ?? null,
        template_version_status: templates.find((t: any) => t.id === selectedTemplate)?.template_status ?? null,
        legal_document_type: templates.find((t: any) => t.id === selectedTemplate)?.template_type ?? null,
      } as any));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.employees.contracts(candidateId) });
      logAudit({ action: 'create', tableName: 'contracts', recordId: candidateId, newValues: { title: contractTitle } });
      setCreating(false);
      setContractContent('');
      setContractTitle('');
      setSelectedTemplate('');
      setTemplateIssues({ missingVariables: [], unknownVariables: [] });
      toast.success('Contract aangemaakt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const copySignLink = (contract: any) => {
    const url = buildUrl(`/contract/sign/${contract.sign_token}`);
    navigator.clipboard.writeText(url);
    toast.success('Tekenlink gekopieerd naar klembord');
  };

  const markSent = useMutation({
    mutationFn: async (contractId: string) => {
      await unwrap(supabase.from('contracts')
        .update({ status: 'verzonden' as any, sent_at: new Date().toISOString() })
        .eq('id', contractId));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.employees.contracts(candidateId) });
      toast.success('Contract als verzonden gemarkeerd');
    },
  });

  const markSigned = useMutation({
    mutationFn: async (contractId: string) => {
      const signedAt = new Date().toISOString();
      await unwrap(supabase.from('contracts')
        .update({
          status: 'getekend' as any,
          signed_at: signedAt,
          signed_by_name: 'Handmatig gemarkeerd',
          signature_evidence: {
            method: 'manual_admin_override',
            marked_by: user?.id ?? null,
            marked_at: signedAt,
            note: 'Niet digitaal ondertekend via publieke tekenlink',
          },
        } as any)
        .eq('id', contractId));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.employees.contracts(candidateId) });
      toast.success('Contract als getekend gemarkeerd');
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Contracten</h3>
        <Button size="sm" variant="outline" onClick={() => setCreating(!creating)} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> Nieuw contract
        </Button>
      </div>

      {creating && (
        <div className="bg-card rounded-lg border p-4 space-y-3">
          <div>
            <Label>Template</Label>
            <Select value={selectedTemplate} onValueChange={handleSelectTemplate}>
              <SelectTrigger>
                <SelectValue placeholder="Selecteer een template..." />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Titel</Label>
            <Input value={contractTitle} onChange={e => setContractTitle(e.target.value)} />
          </div>
          <div>
            <Label>Inhoud (na merge)</Label>
            <Textarea
              value={contractContent}
              onChange={e => setContractContent(e.target.value)}
              rows={12}
              className="font-mono text-xs"
            />
            {(remainingMergeFields.length > 0 || hasMissingMarkers) && (
              <div className="mt-2 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
                {hasMissingMarkers && templateIssues.missingVariables.length > 0 && (
                  <p>Ontbrekende waarden: {templateIssues.missingVariables.map(contractTemplateVariableLabel).join(', ')}.</p>
                )}
                {remainingMergeFields.length > 0 && (
                  <p>Resterende merge-velden: {remainingMergeFields.map(contractTemplateVariableLabel).join(', ')}.</p>
                )}
                <p>Vul de gemarkeerde waarden in en verwijder alle resterende merge-velden voordat het contract wordt aangemaakt.</p>
              </div>
            )}
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>Annuleren</Button>
            <Button size="sm" onClick={() => createContract.mutate()} disabled={!contractTitle || !contractContent || remainingMergeFields.length > 0 || hasMissingMarkers || createContract.isPending}>
              {createContract.isPending ? 'Aanmaken...' : 'Contract aanmaken'}
            </Button>
          </div>
        </div>
      )}

      {contracts.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">Geen contracten</p>
      ) : (
        <div className="bg-card rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Titel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Aangemaakt</TableHead>
                <TableHead>Verzonden</TableHead>
                <TableHead>Getekend</TableHead>
                <TableHead>Bewijs</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contracts.map((c: any) => {
                const evidenceMethod = c.signature_evidence?.method;
                const hasDigitalEvidence = Boolean(c.signature_request_id && evidenceMethod === 'token_link');
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.title}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={statusColors[c.status] ?? ''}>
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(c.created_at)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(c.sent_at)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(c.signed_at)}</TableCell>
                    <TableCell>
                      {hasDigitalEvidence ? (
                        <Badge className="gap-1"><ShieldCheck className="h-3 w-3" /> Digitaal</Badge>
                      ) : c.status === 'getekend' ? (
                        <Badge variant="outline">Handmatig</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => setViewContract(c)} title="Bekijken">
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {c.sign_token && c.status !== 'getekend' && (
                          <Button size="sm" variant="outline" onClick={() => copySignLink(c)} className="gap-1">
                            <Link2 className="h-3.5 w-3.5" /> Tekenlink
                          </Button>
                        )}
                        {c.status === 'concept' && (
                          <Button size="sm" variant="outline" onClick={() => markSent.mutate(c.id)}>
                            <Send className="h-3.5 w-3.5 mr-1" /> Verzonden
                          </Button>
                        )}
                        {c.status === 'verzonden' && (
                          <Button size="sm" variant="outline" onClick={() => markSigned.mutate(c.id)}>
                            <FileText className="h-3.5 w-3.5 mr-1" /> Handmatig getekend
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* View dialog */}
      <Dialog open={!!viewContract} onOpenChange={() => setViewContract(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewContract?.title}</DialogTitle>
          </DialogHeader>
          {viewContract?.signature_request_id && (
            <div className="rounded-md border bg-muted/40 p-3 text-xs">
              <div className="font-medium">Ondertekenbewijs</div>
              <div className="mt-1 font-mono break-all">Request: {viewContract.signature_request_id}</div>
              {viewContract.signed_by_name && <div>Naam: {viewContract.signed_by_name}</div>}
              {viewContract.signed_ip && <div>IP: {viewContract.signed_ip}</div>}
            </div>
          )}
          <div className="whitespace-pre-wrap text-sm">{viewContract?.content}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EmployeeContractsTab;
