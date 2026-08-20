import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { AlertTriangle, CheckCircle2, FileText, Plus, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { GuardedDialog, useDirtyForm } from '@/components/shared/UnsavedCloseGuard';
import { formatDate } from '@/lib/format';
import {
  CONTRACT_TEMPLATE_SAMPLE_VALUES,
  CONTRACT_TEMPLATE_VARIABLES,
  contractTemplateVariableLabel,
  contractTemplateVariableToken,
  renderContractTemplate,
  validateContractTemplateDefinition,
} from '@/lib/contract-templates';

const TEMPLATE_TYPES = [
  { value: 'employment_contract', label: 'Arbeidsovereenkomst' },
  { value: 'placement_confirmation', label: 'Plaatsingsbevestiging' },
  { value: 'placement_confirmation_client', label: 'Plaatsingsbevestiging opdrachtgever' },
  { value: 'placement_confirmation_employee', label: 'Plaatsingsbevestiging medewerker' },
  { value: 'general_terms', label: 'Algemene voorwaarden' },
  { value: 'housing_inhuur', label: 'Inhuurcontract woning' },
  { value: 'housing_onderhuur', label: 'Onderhuurcontract woning' },
  { value: 'house_rules', label: 'Huisregels' },
  { value: 'vehicle_agreement', label: 'Voertuigovereenkomst' },
];

const REQUIRED_OPERATIONAL_TEMPLATE_TYPES = [
  'placement_confirmation_client',
  'placement_confirmation_employee',
  'general_terms',
  'housing_inhuur',
  'housing_onderhuur',
  'house_rules',
  'vehicle_agreement',
] as const;

const templateTypeLabel = (value: string | null | undefined) =>
  TEMPLATE_TYPES.find((type) => type.value === value)?.label ?? 'Arbeidsovereenkomst';

const ContractTemplatesSettings = () => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm, formDirty] = useDirtyForm({ name: '', template_type: 'employment_contract', template_status: 'concept', is_placeholder: false, content: '' });
  const formValidation = validateContractTemplateDefinition(form.content);
  const preview = renderContractTemplate(form.content, CONTRACT_TEMPLATE_SAMPLE_VALUES);
  const activeTemplateBlocked = form.template_status === 'actief' && (
    form.is_placeholder ||
    !formValidation.canActivate
  );

  const { data: templates = [] } = useQuery<any[]>({
    queryKey: ['contract-templates', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contract_templates' as any)
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!orgId,
  });

  const activeTemplateTypes = new Set(
    templates
      .filter((template: any) => template.is_active !== false)
      .filter((template: any) => (template.template_status ?? 'actief') === 'actief')
      .filter((template: any) => template.is_placeholder !== true)
      .map((template: any) => template.template_type ?? 'employment_contract'),
  );
  const missingOperationalTemplates = REQUIRED_OPERATIONAL_TEMPLATE_TYPES.filter((type) => !activeTemplateTypes.has(type));

  const save = useMutation({
    mutationFn: async () => {
      if (form.template_status === 'actief' && activeTemplateBlocked) {
        throw new Error('Template kan pas actief worden zonder placeholders en onbekende variabelen');
      }
      if (editing) {
        const { error } = await supabase.from('contract_templates' as any)
          .update({
            name: form.name,
            template_type: form.template_type,
            template_status: form.template_status,
            is_placeholder: form.is_placeholder,
            content: form.content,
            is_active: form.template_status === 'actief' && !form.is_placeholder,
            approved_at: form.template_status === 'actief' ? new Date().toISOString() : null,
            approved_by: form.template_status === 'actief' ? user?.id ?? null : null,
          } as any)
          .eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('contract_templates' as any).insert({
          organization_id: orgId,
          name: form.name,
          template_type: form.template_type,
          template_status: form.template_status,
          is_placeholder: form.is_placeholder,
          is_active: form.template_status === 'actief' && !form.is_placeholder,
          content: form.content,
          created_by: user?.id ?? null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contract-templates'] });
      setOpen(false);
      setEditing(null);
      setForm({ name: '', template_type: 'employment_contract', template_status: 'concept', is_placeholder: false, content: '' });
      toast.success(editing ? 'Template bijgewerkt' : 'Template aangemaakt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const template = templates.find((t: any) => t.id === id);
      if (is_active && template?.is_placeholder) throw new Error('Placeholder-template kan niet actief worden');
      if (is_active) {
        const validation = validateContractTemplateDefinition(template?.content ?? '');
        if (!validation.canActivate) {
          throw new Error('Template bevat nog placeholders of onbekende variabelen');
        }
      }
      const { error } = await supabase.from('contract_templates' as any).update({
        is_active,
        template_status: is_active ? 'actief' : 'concept',
        approved_at: is_active ? new Date().toISOString() : null,
        approved_by: is_active ? user?.id ?? null : null,
      } as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contract-templates'] });
      toast.success('Status bijgewerkt');
    },
  });

  const openEdit = (t: any) => {
    setEditing(t);
    setForm({
      name: t.name,
      template_type: t.template_type ?? 'employment_contract',
      template_status: t.template_status ?? (t.is_active ? 'actief' : 'concept'),
      is_placeholder: t.is_placeholder ?? false,
      content: t.content,
    });
    setOpen(true);
  };

  const openNew = () => {
    setEditing(null);
    setForm({ name: '', template_type: 'employment_contract', template_status: 'concept', is_placeholder: false, content: '' });
    setOpen(true);
  };

  const insertField = (field: string) => {
    setForm(f => ({ ...f, content: f.content + field }));
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" /> Contracttemplates
            </CardTitle>
            <CardDescription>Maak templates met merge fields voor contractgeneratie</CardDescription>
          </div>
          <Button size="sm" onClick={openNew} className="gap-1">
            <Plus className="h-3.5 w-3.5" /> Nieuw template
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className={`mb-4 rounded-md border px-4 py-3 ${missingOperationalTemplates.length > 0 ? 'border-amber-200 bg-amber-50/50' : 'border-green-200 bg-green-50/50'}`}>
          <div className="flex items-start gap-3">
            {missingOperationalTemplates.length > 0 ? (
              <AlertTriangle className="h-5 w-5 text-amber-700 mt-0.5" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-green-700 mt-0.5" />
            )}
            <div className="space-y-2">
              <div>
                <p className="text-sm font-semibold">Operationele documentenset</p>
                <p className="text-xs text-muted-foreground">
                  {missingOperationalTemplates.length > 0
                    ? `${missingOperationalTemplates.length} vereiste template${missingOperationalTemplates.length === 1 ? '' : 's'} ontbreekt nog.`
                    : 'Alle vereiste templates zijn actief.'}
                </p>
              </div>
              {missingOperationalTemplates.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {missingOperationalTemplates.map((type) => (
                    <Badge key={type} variant="outline" className="bg-background">{templateTypeLabel(type)}</Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {templates.length === 0 ? (
          <p className="text-center text-muted-foreground py-6">Nog geen templates aangemaakt</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Naam</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actief</TableHead>
                <TableHead>Aangemaakt</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t: any) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell><Badge variant="secondary">{templateTypeLabel(t.template_type)}</Badge></TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={t.template_status === 'actief' ? 'default' : 'outline'}>{t.template_status ?? (t.is_active ? 'actief' : 'concept')}</Badge>
                      {validateContractTemplateDefinition(t.content).unknownVariables.length > 0 && (
                        <Badge variant="outline" className="border-amber-300 text-amber-700">Variabelen</Badge>
                      )}
                      {validateContractTemplateDefinition(t.content).hasPlaceholderContent && (
                        <Badge variant="outline" className="border-amber-300 text-amber-700">Placeholder</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Switch checked={t.is_active && t.template_status === 'actief' && !t.is_placeholder} onCheckedChange={(v) => toggleActive.mutate({ id: t.id, is_active: v })} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(t.created_at)}</TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" onClick={() => openEdit(t)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <GuardedDialog open={open} dirty={formDirty} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Template bewerken' : 'Nieuw contracttemplate'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Naam</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Standaard uitzendovereenkomst" />
            </div>
            <div>
              <Label>Template type</Label>
              <Select value={form.template_type} onValueChange={(value) => setForm((f) => ({ ...f, template_type: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TEMPLATE_TYPES.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Status</Label>
                <Select value={form.template_status} onValueChange={(value) => setForm((f) => ({ ...f, template_status: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="concept">Concept</SelectItem>
                    <SelectItem value="klaar_voor_review">Klaar voor review</SelectItem>
                    <SelectItem value="actief">Actief</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <div>
                  <Label>Placeholder</Label>
                  <p className="text-xs text-muted-foreground">Blokkeert productiegebruik.</p>
                </div>
                <Switch checked={form.is_placeholder} onCheckedChange={(value) => setForm((f) => ({ ...f, is_placeholder: value, template_status: value && f.template_status === 'actief' ? 'concept' : f.template_status }))} />
              </div>
            </div>
            <div>
              <Label>Merge fields</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {CONTRACT_TEMPLATE_VARIABLES.map(variable => (
                  <Button
                    key={variable.key}
                    size="sm"
                    variant="outline"
                    className="text-xs h-7"
                    title={variable.label}
                    onClick={() => insertField(contractTemplateVariableToken(variable.key))}
                  >
                    {contractTemplateVariableToken(variable.key)}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <Label>Inhoud</Label>
              <Textarea
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                rows={16}
                className="font-mono text-xs"
                placeholder="UITZENDOVEREENKOMST&#10;&#10;Ondergetekenden:&#10;{{organization_name}}, hierna te noemen 'werkgever'&#10;en&#10;{{employee_name}}, hierna te noemen 'werknemer'&#10;&#10;zijn het volgende overeengekomen:&#10;..."
              />
              {(formValidation.unknownVariables.length > 0 || formValidation.hasPlaceholderContent) && (
                <div className="mt-2 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
                  {formValidation.unknownVariables.length > 0 && (
                    <p>
                      Onbekende variabelen: {formValidation.unknownVariables.map(contractTemplateVariableLabel).join(', ')}.
                    </p>
                  )}
                  {formValidation.hasPlaceholderContent && (
                    <p>De inhoud bevat nog placeholdertekst zoals TODO, TBD, lorem ipsum of [invullen].</p>
                  )}
                </div>
              )}
            </div>
            <div>
              <Label>Voorbeeld</Label>
              <div className="mt-1 max-h-48 overflow-y-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap">
                {preview.content || 'Nog geen inhoud'}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Annuleren</Button>
              <Button onClick={() => save.mutate()} disabled={!form.name || !form.content || activeTemplateBlocked || save.isPending}>
                {save.isPending ? 'Opslaan...' : 'Opslaan'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </GuardedDialog>
    </Card>
  );
};

export default ContractTemplatesSettings;
