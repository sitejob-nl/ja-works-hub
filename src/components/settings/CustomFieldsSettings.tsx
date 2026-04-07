import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { toast } from 'sonner';

const ENTITY_TYPES = [
  { value: 'candidate', label: 'Kandidaten' },
  { value: 'company', label: 'Opdrachtgevers' },
  { value: 'placement', label: 'Plaatsingen' },
  { value: 'vacancy', label: 'Vacatures' },
];

const FIELD_TYPES = [
  { value: 'text', label: 'Tekst' },
  { value: 'number', label: 'Nummer' },
  { value: 'date', label: 'Datum' },
  { value: 'select', label: 'Keuzelijst' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'textarea', label: 'Tekstveld (groot)' },
];

interface NewFieldForm {
  field_label: string;
  field_type: string;
  is_required: boolean;
  options_text: string;
}

const emptyForm: NewFieldForm = { field_label: '', field_type: 'text', is_required: false, options_text: '' };

const CustomFieldsSettings = () => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [entityType, setEntityType] = useState('candidate');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<NewFieldForm>(emptyForm);

  const { data: fields = [] } = useQuery({
    queryKey: ['custom-fields-admin', orgId, entityType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('custom_fields')
        .select('*')
        .eq('organization_id', orgId)
        .eq('entity_type', entityType)
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
  });

  const addField = useMutation({
    mutationFn: async () => {
      const fieldName = form.field_label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
      const options = form.field_type === 'select'
        ? form.options_text.split(',').map(s => s.trim()).filter(Boolean)
        : [];
      const { error } = await supabase.from('custom_fields').insert({
        organization_id: orgId,
        entity_type: entityType,
        field_name: fieldName,
        field_label: form.field_label,
        field_type: form.field_type,
        options,
        is_required: form.is_required,
        sort_order: fields.length,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-fields-admin'] });
      qc.invalidateQueries({ queryKey: ['custom-fields'] });
      setAdding(false);
      setForm(emptyForm);
      toast.success('Veld toegevoegd');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleField = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from('custom_fields').update({ is_active: active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-fields-admin'] });
      qc.invalidateQueries({ queryKey: ['custom-fields'] });
    },
  });

  const deleteField = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('custom_fields').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-fields-admin'] });
      qc.invalidateQueries({ queryKey: ['custom-fields'] });
      toast.success('Veld verwijderd');
    },
  });

  const entityLabel = ENTITY_TYPES.find(e => e.value === entityType)?.label ?? entityType;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Extra velden</h3>
        <p className="text-sm text-muted-foreground">Voeg aangepaste velden toe aan profielen. Deze verschijnen automatisch op de detailpagina.</p>
      </div>

      <div className="flex items-center gap-3">
        <Label>Entiteit:</Label>
        <Select value={entityType} onValueChange={setEntityType}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ENTITY_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Verplicht</TableHead>
              <TableHead>Actief</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((f: any) => (
              <TableRow key={f.id}>
                <TableCell><GripVertical className="h-4 w-4 text-muted-foreground/40" /></TableCell>
                <TableCell className="font-medium">{f.field_label}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className="text-xs">
                    {FIELD_TYPES.find(t => t.value === f.field_type)?.label ?? f.field_type}
                  </Badge>
                </TableCell>
                <TableCell>{f.is_required ? 'Ja' : 'Nee'}</TableCell>
                <TableCell>
                  <Switch checked={f.is_active} onCheckedChange={(v) => toggleField.mutate({ id: f.id, active: v })} />
                </TableCell>
                <TableCell>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteField.mutate(f.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {fields.length === 0 && !adding && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  Geen extra velden voor {entityLabel.toLowerCase()}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {adding ? (
        <div className="bg-card rounded-lg border p-4 space-y-4 max-w-xl">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Label *</Label>
              <Input value={form.field_label} onChange={(e) => setForm(f => ({ ...f, field_label: e.target.value }))} placeholder="bijv. Schoenmaat" />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={form.field_type} onValueChange={(v) => setForm(f => ({ ...f, field_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {form.field_type === 'select' && (
            <div className="space-y-1.5">
              <Label>Opties (komma-gescheiden)</Label>
              <Input value={form.options_text} onChange={(e) => setForm(f => ({ ...f, options_text: e.target.value }))} placeholder="Optie 1, Optie 2, Optie 3" />
            </div>
          )}
          <div className="flex items-center gap-2">
            <Switch checked={form.is_required} onCheckedChange={(v) => setForm(f => ({ ...f, is_required: v }))} />
            <Label>Verplicht veld</Label>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => addField.mutate()} disabled={!form.field_label || addField.isPending}>Toevoegen</Button>
            <Button variant="ghost" onClick={() => { setAdding(false); setForm(emptyForm); }}>Annuleren</Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" onClick={() => setAdding(true)} className="gap-1">
          <Plus className="h-4 w-4" /> Veld toevoegen
        </Button>
      )}
    </div>
  );
};

export default CustomFieldsSettings;
