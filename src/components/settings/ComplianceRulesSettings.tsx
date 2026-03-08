import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Plus, ShieldCheck, Trash2, Pencil } from 'lucide-react';

const DOCUMENT_TYPES = [
  { value: 'id_bewijs', label: 'ID Bewijs' },
  { value: 'contract', label: 'Contract' },
  { value: 'reglement', label: 'Reglement' },
  { value: 'rijbewijs', label: 'Rijbewijs' },
  { value: 'vca', label: 'VCA' },
  { value: 'overig', label: 'Overig' },
];

const FIELD_OPTIONS = [
  { value: 'bsn', label: 'BSN' },
  { value: 'iban', label: 'IBAN' },
  { value: 'date_of_birth', label: 'Geboortedatum' },
  { value: 'nationality', label: 'Nationaliteit' },
  { value: 'address_street', label: 'Adres' },
  { value: 'phone', label: 'Telefoon' },
  { value: 'email', label: 'E-mail' },
];

const SECTOR_OPTIONS = ['bouw', 'logistiek', 'agri', 'industrie', 'horeca', 'overig'];
const CONTRACT_OPTIONS = ['uitzend', 'detachering', 'payroll', 'zzp'];

const PRESETS: Record<string, { name: string; sector: string; required_documents: string[]; required_fields: string[]; description: string }> = {
  standaard: {
    name: 'Standaard', sector: '', required_documents: ['id_bewijs', 'contract', 'reglement'],
    required_fields: ['bsn', 'iban', 'date_of_birth'], description: 'Standaard compliance vereisten voor alle medewerkers',
  },
  bouw: {
    name: 'Bouw', sector: 'bouw', required_documents: ['id_bewijs', 'contract', 'reglement', 'vca'],
    required_fields: ['bsn', 'iban', 'date_of_birth', 'nationality'], description: 'Bouwsector met VCA vereiste',
  },
  logistiek: {
    name: 'Logistiek', sector: 'logistiek', required_documents: ['id_bewijs', 'contract', 'reglement', 'rijbewijs'],
    required_fields: ['bsn', 'iban', 'date_of_birth'], description: 'Logistiek sector met rijbewijs vereiste',
  },
};

interface RuleForm {
  id?: string;
  name: string;
  sector: string;
  contract_type: string;
  required_documents: string[];
  required_fields: string[];
  description: string;
  is_active: boolean;
}

const emptyForm: RuleForm = { name: '', sector: '', contract_type: '', required_documents: [], required_fields: [], description: '', is_active: true };

const ComplianceRulesSettings = () => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [form, setForm] = useState<RuleForm>(emptyForm);

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['compliance-rules', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('compliance_rules' as any).select('*').order('created_at');
      if (error) throw error;
      return data as any[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (f: RuleForm) => {
      const payload = {
        organization_id: orgId,
        name: f.name,
        sector: f.sector || null,
        contract_type: f.contract_type || null,
        required_documents: f.required_documents,
        required_fields: f.required_fields,
        description: f.description || null,
        is_active: f.is_active,
      };
      if (f.id) {
        const { error } = await supabase.from('compliance_rules' as any).update(payload).eq('id', f.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('compliance_rules' as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['compliance-rules'] });
      setSheetOpen(false);
      toast.success('Regel opgeslagen');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('compliance_rules' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['compliance-rules'] });
      toast.success('Regel verwijderd');
    },
  });

  const openNew = (preset?: string) => {
    if (preset && PRESETS[preset]) {
      setForm({ ...emptyForm, ...PRESETS[preset] });
    } else {
      setForm(emptyForm);
    }
    setSheetOpen(true);
  };

  const openEdit = (rule: any) => {
    setForm({
      id: rule.id,
      name: rule.name,
      sector: rule.sector || '',
      contract_type: rule.contract_type || '',
      required_documents: rule.required_documents || [],
      required_fields: rule.required_fields || [],
      description: rule.description || '',
      is_active: rule.is_active,
    });
    setSheetOpen(true);
  };

  const toggleArrayItem = (key: 'required_documents' | 'required_fields', value: string) => {
    setForm(prev => ({
      ...prev,
      [key]: prev[key].includes(value) ? prev[key].filter(v => v !== value) : [...prev[key], value],
    }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" /> Compliance regels
        </CardTitle>
        <CardDescription>Configureer documentvereisten per sector en contracttype</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Presets */}
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-muted-foreground self-center mr-1">Preset toevoegen:</span>
          {Object.entries(PRESETS).map(([key, p]) => (
            <Button key={key} variant="outline" size="sm" onClick={() => openNew(key)}>{p.name}</Button>
          ))}
          <Button size="sm" onClick={() => openNew()} className="gap-1"><Plus className="h-3.5 w-3.5" /> Aangepast</Button>
        </div>

        {/* Rules list */}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Laden...</p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nog geen compliance regels. Standaard controles worden gebruikt.</p>
        ) : (
          <div className="space-y-2">
            {rules.map((rule: any) => (
              <div key={rule.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{rule.name}</span>
                    {!rule.is_active && <Badge variant="secondary" className="text-xs">Inactief</Badge>}
                    {rule.sector && <Badge variant="outline" className="text-xs">{rule.sector}</Badge>}
                    {rule.contract_type && <Badge variant="outline" className="text-xs">{rule.contract_type}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {rule.required_documents?.length || 0} documenten, {rule.required_fields?.length || 0} velden vereist
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(rule)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(rule.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>{form.id ? 'Regel bewerken' : 'Nieuwe compliance regel'}</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6">
            <div><Label>Naam *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div>
              <Label>Sector</Label>
              <Select value={form.sector} onValueChange={v => setForm(f => ({ ...f, sector: v }))}>
                <SelectTrigger><SelectValue placeholder="Alle sectoren" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Alle sectoren</SelectItem>
                  {SECTOR_OPTIONS.map(s => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Contracttype</Label>
              <Select value={form.contract_type} onValueChange={v => setForm(f => ({ ...f, contract_type: v }))}>
                <SelectTrigger><SelectValue placeholder="Alle contracttypes" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Alle types</SelectItem>
                  {CONTRACT_OPTIONS.map(c => <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="mb-2 block">Vereiste documenten</Label>
              <div className="flex flex-wrap gap-2">
                {DOCUMENT_TYPES.map(d => (
                  <button
                    key={d.value}
                    onClick={() => toggleArrayItem('required_documents', d.value)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      form.required_documents.includes(d.value) ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted border-border hover:bg-muted/80'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="mb-2 block">Vereiste velden</Label>
              <div className="flex flex-wrap gap-2">
                {FIELD_OPTIONS.map(f => (
                  <button
                    key={f.value}
                    onClick={() => toggleArrayItem('required_fields', f.value)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      form.required_fields.includes(f.value) ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted border-border hover:bg-muted/80'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div><Label>Beschrijving</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} /></div>

            <div className="flex items-center justify-between">
              <Label>Actief</Label>
              <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={() => setSheetOpen(false)}>Annuleren</Button>
              <Button onClick={() => saveMutation.mutate(form)} disabled={!form.name || saveMutation.isPending}>
                {saveMutation.isPending ? 'Opslaan...' : 'Opslaan'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </Card>
  );
};

export default ComplianceRulesSettings;
