import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Plus, Eye, Send, FileText, Link2, ShieldCheck } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';

const statusColors: Record<string, string> = {
  concept: 'bg-muted text-muted-foreground border-0',
  verzonden: 'bg-blue-100 text-blue-700 border-0',
  getekend: 'bg-stat-green/10 text-stat-green border-0',
  verlopen: 'bg-red-100 text-red-600 border-0',
};

const resolveEmployeeId = async (candidateId: string) => {
  const { data, error } = await supabase
    .from('employees')
    .select('id')
    .eq('candidate_id', candidateId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error('Geen medewerkerrecord gevonden voor deze kandidaat');
  return data.id;
};

const EmployeeContractsTab = ({ candidateId, candidate, employment }: { candidateId: string; candidate: any; employment?: any }) => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [contractContent, setContractContent] = useState('');
  const [contractTitle, setContractTitle] = useState('');
  const [viewContract, setViewContract] = useState<any>(null);

  const { data: contracts = [] } = useQuery({
    queryKey: ['contracts', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contracts')
        .select('*')
        .eq('candidate_id', candidateId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['contract-templates', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contract_templates')
        .select('*')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  // Get org info for merge fields
  const { data: org } = useQuery({
    queryKey: ['organization', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('organizations').select('name').eq('id', orgId).single();
      if (error) throw error;
      return data;
    },
  });

  // Get active placement for merge fields
  const { data: placement } = useQuery({
    queryKey: ['active-placement', candidateId],
    queryFn: async () => {
      const { data } = await supabase
        .from('placements')
        .select('*, companies(name)')
        .eq('candidate_id', candidateId)
        .eq('status', 'actief')
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const applyMergeFields = (template: string) => {
    const today = new Date().toISOString().split('T')[0];
    return template
      .replace(/\{\{employee_name\}\}/g, `${candidate?.first_name ?? ''} ${candidate?.last_name ?? ''}`.trim())
      .replace(/\{\{employee_number\}\}/g, candidate?.employee_number ?? '')
      .replace(/\{\{start_date\}\}/g, employment?.start_date ?? '')
      .replace(/\{\{end_date\}\}/g, employment?.end_date ?? '')
      .replace(/\{\{function_name\}\}/g, placement?.function_name ?? '')
      .replace(/\{\{hourly_rate\}\}/g, placement?.hourly_rate?.toString() ?? '')
      .replace(/\{\{contract_hours\}\}/g, employment?.contract_hours?.toString() ?? '')
      .replace(/\{\{contract_type\}\}/g, employment?.contract_type ?? '')
      .replace(/\{\{company_name\}\}/g, (placement?.companies as any)?.name ?? '')
      .replace(/\{\{organization_name\}\}/g, org?.name ?? '')
      .replace(/\{\{today\}\}/g, today);
  };

  const handleSelectTemplate = (templateId: string) => {
    setSelectedTemplate(templateId);
    const tpl = templates.find((t: any) => t.id === templateId);
    if (tpl) {
      setContractTitle(tpl.name);
      setContractContent(applyMergeFields(tpl.content));
    }
  };

  const createContract = useMutation({
    mutationFn: async () => {
      const token = crypto.randomUUID();
      const employeeId = await resolveEmployeeId(candidateId);
      const { error } = await supabase.from('contracts').insert({
        organization_id: orgId,
        employee_id: employeeId,
        candidate_id: candidateId,
        template_id: selectedTemplate || null,
        title: contractTitle,
        content: contractContent,
        sign_token: token,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contracts', candidateId] });
      logAudit({ action: 'create', tableName: 'contracts', recordId: candidateId, newValues: { title: contractTitle } });
      setCreating(false);
      setContractContent('');
      setContractTitle('');
      setSelectedTemplate('');
      toast.success('Contract aangemaakt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const copySignLink = (contract: any) => {
    const url = `${window.location.origin}/contract/sign/${contract.sign_token}`;
    navigator.clipboard.writeText(url);
    toast.success('Tekenlink gekopieerd naar klembord');
  };

  const markSent = useMutation({
    mutationFn: async (contractId: string) => {
      const { error } = await supabase.from('contracts')
        .update({ status: 'verzonden' as any, sent_at: new Date().toISOString() })
        .eq('id', contractId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contracts', candidateId] });
      toast.success('Contract als verzonden gemarkeerd');
    },
  });

  const markSigned = useMutation({
    mutationFn: async (contractId: string) => {
      const signedAt = new Date().toISOString();
      const { error } = await supabase.from('contracts')
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
        .eq('id', contractId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contracts', candidateId] });
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
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>Annuleren</Button>
            <Button size="sm" onClick={() => createContract.mutate()} disabled={!contractTitle || !contractContent || createContract.isPending}>
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
