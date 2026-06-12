import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { ClipboardList, Plus, GripVertical, Trash2, Copy, Pencil, ChevronUp, ChevronDown } from 'lucide-react';

const FIELD_TYPES = [
  { value: 'text', label: 'Tekst' },
  { value: 'email', label: 'E-mail' },
  { value: 'tel', label: 'Telefoon' },
  { value: 'date', label: 'Datum' },
  { value: 'number', label: 'Nummer' },
  { value: 'select', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'textarea', label: 'Tekstvak' },
  { value: 'file', label: 'Bestandsupload' },
  { value: 'heading', label: 'Koptekst (geen invoer)' },
];

const MAPS_TO_OPTIONS = [
  { table: 'candidates', column: 'bsn', label: 'BSN' },
  { table: 'candidates', column: 'iban', label: 'IBAN' },
  { table: 'candidates', column: 'date_of_birth', label: 'Geboortedatum' },
  { table: 'candidates', column: 'nationality', label: 'Nationaliteit' },
  { table: 'candidates', column: 'phone', label: 'Telefoon' },
  { table: 'candidates', column: 'email', label: 'E-mail' },
  { table: 'candidates', column: 'address_street', label: 'Straat' },
  { table: 'candidates', column: 'address_postal', label: 'Postcode' },
  { table: 'candidates', column: 'address_city', label: 'Stad' },
  { table: 'candidates', column: 'address_country', label: 'Land' },
  { table: 'documents', column: 'file', label: 'Document upload' },
  { table: '', column: '', label: '— Geen mapping —' },
];

type FormRow = {
  id: string;
  name: string;
  is_active: boolean | null;
  is_default: boolean | null;
  description: string | null;
};

type StepRow = {
  id: string;
  form_id: string;
  title: string;
  description: string | null;
  sort_order: number;
  is_active: boolean | null;
};

type FieldRow = {
  id: string;
  step_id: string;
  label: string;
  field_type: string;
  is_required: boolean | null;
  is_active: boolean | null;
  placeholder: string | null;
  help_text: string | null;
  maps_to_table: string | null;
  maps_to_column: string | null;
  document_type: string | null;
  options: any;
  sort_order: number;
  width: string | null;
  validation_regex: string | null;
  validation_message: string | null;
};

const OnboardingFormSettings = () => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();

  const [editFormOpen, setEditFormOpen] = useState(false);
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formIsDefault, setFormIsDefault] = useState(false);

  const [editFieldOpen, setEditFieldOpen] = useState(false);
  const [editingField, setEditingField] = useState<Partial<FieldRow> & { step_id: string }>({
    step_id: '', label: '', field_type: 'text', is_required: false, placeholder: '', help_text: '',
    maps_to_table: '', maps_to_column: '', document_type: '', options: null, width: 'full',
    validation_regex: '', validation_message: '',
  });

  // Fetch forms
  const { data: forms = [] } = useQuery({
    queryKey: ['onboarding-forms', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('onboarding_forms')
        .select('*')
        .eq('organization_id', orgId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data as FormRow[];
    },
  });

  // Fetch steps for all forms
  const { data: steps = [] } = useQuery({
    queryKey: ['onboarding-steps', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('onboarding_form_steps')
        .select('*')
        .eq('organization_id', orgId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data as StepRow[];
    },
  });

  // Fetch fields
  const { data: fields = [] } = useQuery({
    queryKey: ['onboarding-fields', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('onboarding_form_fields')
        .select('*')
        .eq('organization_id', orgId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data as FieldRow[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['onboarding-forms'] });
    qc.invalidateQueries({ queryKey: ['onboarding-steps'] });
    qc.invalidateQueries({ queryKey: ['onboarding-fields'] });
  };

  // ── Form CRUD ──
  const saveForm = useMutation({
    mutationFn: async () => {
      if (selectedFormId) {
        const { error } = await supabase.from('onboarding_forms').update({
          name: formName, description: formDesc || null, is_default: formIsDefault,
        }).eq('id', selectedFormId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('onboarding_forms').insert({
          organization_id: orgId, name: formName, description: formDesc || null, is_default: formIsDefault,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => { invalidate(); setEditFormOpen(false); toast.success('Formulier opgeslagen'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteForm = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('onboarding_forms').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Formulier verwijderd'); },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Step CRUD ──
  const addStep = useMutation({
    mutationFn: async (formId: string) => {
      const formSteps = steps.filter(s => s.form_id === formId);
      const { error } = await supabase.from('onboarding_form_steps').insert({
        organization_id: orgId, form_id: formId, title: 'Nieuwe stap',
        sort_order: formSteps.length + 1,
      });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Stap toegevoegd'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateStep = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<StepRow>) => {
      const { error } = await supabase.from('onboarding_form_steps').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
  });

  const deleteStep = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('onboarding_form_steps').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Stap verwijderd'); },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Field CRUD ──
  const saveField = useMutation({
    mutationFn: async () => {
      const payload = {
        organization_id: orgId,
        step_id: editingField.step_id,
        label: editingField.label || 'Nieuw veld',
        field_type: editingField.field_type || 'text',
        is_required: editingField.is_required ?? false,
        is_active: true,
        placeholder: editingField.placeholder || null,
        help_text: editingField.help_text || null,
        maps_to_table: editingField.maps_to_table || null,
        maps_to_column: editingField.maps_to_column || null,
        document_type: editingField.document_type || null,
        options: editingField.options,
        width: editingField.width || 'full',
        validation_regex: editingField.validation_regex || null,
        validation_message: editingField.validation_message || null,
        sort_order: editingField.sort_order ?? 0,
      };

      if (editingField.id) {
        const { error } = await supabase.from('onboarding_form_fields').update(payload).eq('id', editingField.id);
        if (error) throw error;
      } else {
        const stepFields = fields.filter(f => f.step_id === editingField.step_id);
        payload.sort_order = stepFields.length + 1;
        const { error } = await supabase.from('onboarding_form_fields').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { invalidate(); setEditFieldOpen(false); toast.success('Veld opgeslagen'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteField = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('onboarding_form_fields').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Veld verwijderd'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const openNewForm = () => {
    setSelectedFormId(null);
    setFormName('');
    setFormDesc('');
    setFormIsDefault(false);
    setEditFormOpen(true);
  };

  const openEditForm = (f: FormRow) => {
    setSelectedFormId(f.id);
    setFormName(f.name);
    setFormDesc(f.description ?? '');
    setFormIsDefault(f.is_default ?? false);
    setEditFormOpen(true);
  };

  const openNewField = (stepId: string) => {
    setEditingField({
      step_id: stepId, label: '', field_type: 'text', is_required: false,
      placeholder: '', help_text: '', maps_to_table: '', maps_to_column: '',
      document_type: '', options: null, width: 'full',
      validation_regex: '', validation_message: '',
    });
    setEditFieldOpen(true);
  };

  const openEditField = (f: FieldRow) => {
    setEditingField({ ...f });
    setEditFieldOpen(true);
  };

  const handleMappingChange = (value: string) => {
    if (!value || value === 'none') {
      setEditingField(f => ({ ...f, maps_to_table: '', maps_to_column: '' }));
    } else {
      const [table, column] = value.split('.');
      setEditingField(f => ({ ...f, maps_to_table: table, maps_to_column: column }));
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4 w-4" /> Onboarding formulieren
            </CardTitle>
            <CardDescription>Configureer welke velden medewerkers moeten invullen bij onboarding</CardDescription>
          </div>
          <Button size="sm" onClick={openNewForm}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Nieuw formulier
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {forms.length === 0 && (
          <p className="text-sm text-muted-foreground">Nog geen formulieren aangemaakt. Maak een formulier aan om te beginnen.</p>
        )}

        <Accordion type="single" collapsible className="space-y-2">
          {forms.map(form => {
            const formSteps = steps.filter(s => s.form_id === form.id).sort((a, b) => a.sort_order - b.sort_order);
            return (
              <AccordionItem key={form.id} value={form.id} className="border rounded-lg px-4">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2 text-left">
                    <span className="font-medium">{form.name}</span>
                    {form.is_default && <Badge variant="secondary" className="text-[10px]">Standaard</Badge>}
                    {!form.is_active && <Badge variant="outline" className="text-[10px] text-muted-foreground">Inactief</Badge>}
                    <span className="text-xs text-muted-foreground ml-2">
                      {formSteps.length} stap(pen), {fields.filter(f => formSteps.some(s => s.id === f.step_id)).length} veld(en)
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pb-4">
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEditForm(form)}>
                      <Pencil className="h-3 w-3 mr-1" /> Bewerken
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => addStep.mutate(form.id)}>
                      <Plus className="h-3 w-3 mr-1" /> Stap toevoegen
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive ml-auto"
                      onClick={() => { if (confirm('Formulier verwijderen?')) deleteForm.mutate(form.id); }}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>

                  {formSteps.map((step, si) => {
                    const stepFields = fields.filter(f => f.step_id === step.id).sort((a, b) => a.sort_order - b.sort_order);
                    return (
                      <div key={step.id} className="border rounded-md p-3 bg-secondary/30">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-semibold text-muted-foreground">STAP {si + 1}</span>
                          <Input
                            value={step.title}
                            onChange={e => updateStep.mutate({ id: step.id, title: e.target.value })}
                            className="h-7 text-sm font-medium flex-1"
                          />
                          <Button size="icon" variant="ghost" className="h-6 w-6"
                            onClick={() => { if (confirm('Stap verwijderen?')) deleteStep.mutate(step.id); }}>
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        </div>

                        <div className="space-y-1">
                          {stepFields.map(field => (
                            <div key={field.id}
                              className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-secondary/60 cursor-pointer group"
                              onClick={() => openEditField(field)}
                            >
                              <GripVertical className="h-3 w-3 text-muted-foreground" />
                              <span className="text-sm flex-1">{field.label}</span>
                              <Badge variant="outline" className="text-[10px]">{field.field_type}</Badge>
                              {field.is_required && <Badge className="text-[10px] bg-primary/10 text-stat-blue border-0">Verplicht</Badge>}
                              {field.maps_to_column && (
                                <Badge variant="secondary" className="text-[10px]">→ {field.maps_to_column}</Badge>
                              )}
                              <Button size="icon" variant="ghost" className="h-5 w-5 opacity-0 group-hover:opacity-100"
                                onClick={e => { e.stopPropagation(); if (confirm('Veld verwijderen?')) deleteField.mutate(field.id); }}>
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            </div>
                          ))}
                        </div>

                        <Button size="sm" variant="ghost" className="mt-2 text-xs" onClick={() => openNewField(step.id)}>
                          <Plus className="h-3 w-3 mr-1" /> Veld toevoegen
                        </Button>
                      </div>
                    );
                  })}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </CardContent>

      {/* Form edit sheet */}
      <Sheet open={editFormOpen} onOpenChange={setEditFormOpen}>
        <SheetContent>
          <SheetHeader><SheetTitle>{selectedFormId ? 'Formulier bewerken' : 'Nieuw formulier'}</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-4">
            <div><Label>Naam *</Label><Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Standaard onboarding" /></div>
            <div><Label>Beschrijving</Label><Textarea value={formDesc} onChange={e => setFormDesc(e.target.value)} rows={2} /></div>
            <div className="flex items-center gap-2">
              <Switch checked={formIsDefault} onCheckedChange={setFormIsDefault} id="is-default" />
              <Label htmlFor="is-default">Standaard formulier</Label>
            </div>
            <Button onClick={() => saveForm.mutate()} disabled={!formName.trim() || saveForm.isPending} className="w-full">
              Opslaan
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Field edit sheet */}
      <Sheet open={editFieldOpen} onOpenChange={setEditFieldOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader><SheetTitle>{editingField.id ? 'Veld bewerken' : 'Nieuw veld'}</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-4">
            <div><Label>Label *</Label><Input value={editingField.label ?? ''} onChange={e => setEditingField(f => ({ ...f, label: e.target.value }))} /></div>

            <div>
              <Label>Veldtype</Label>
              <Select value={editingField.field_type} onValueChange={v => setEditingField(f => ({ ...f, field_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div><Label>Placeholder</Label><Input value={editingField.placeholder ?? ''} onChange={e => setEditingField(f => ({ ...f, placeholder: e.target.value }))} /></div>
            <div><Label>Helptekst</Label><Input value={editingField.help_text ?? ''} onChange={e => setEditingField(f => ({ ...f, help_text: e.target.value }))} /></div>

            {editingField.field_type === 'select' && (
              <div>
                <Label>Opties (één per regel)</Label>
                <Textarea
                  value={Array.isArray(editingField.options) ? editingField.options.join('\n') : ''}
                  onChange={e => setEditingField(f => ({ ...f, options: e.target.value.split('\n').filter(Boolean) }))}
                  rows={4}
                  placeholder="Optie 1&#10;Optie 2&#10;Optie 3"
                />
              </div>
            )}

            {editingField.field_type === 'file' && (
              <div>
                <Label>Documenttype</Label>
                <Select value={editingField.document_type ?? ''} onValueChange={v => setEditingField(f => ({ ...f, document_type: v }))}>
                  <SelectTrigger><SelectValue placeholder="Kies type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cv">CV</SelectItem>
                    <SelectItem value="pasfoto">Pasfoto</SelectItem>
                    <SelectItem value="onboarding_formulier">Onboarding-formulier</SelectItem>
                    <SelectItem value="id_bewijs">ID Bewijs</SelectItem>
                    <SelectItem value="rijbewijs">Rijbewijs</SelectItem>
                    <SelectItem value="certificaat">Certificaat</SelectItem>
                    <SelectItem value="diploma">Diploma</SelectItem>
                    <SelectItem value="werkfoto">Werkfoto</SelectItem>
                    <SelectItem value="overig">Overig</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label>Koppeling aan database</Label>
              <Select
                value={editingField.maps_to_table && editingField.maps_to_column ? `${editingField.maps_to_table}.${editingField.maps_to_column}` : 'none'}
                onValueChange={handleMappingChange}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MAPS_TO_OPTIONS.map(m => (
                    <SelectItem key={m.table + m.column || 'none'} value={m.table && m.column ? `${m.table}.${m.column}` : 'none'}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Breedte</Label>
              <Select value={editingField.width ?? 'full'} onValueChange={v => setEditingField(f => ({ ...f, width: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Volledige breedte</SelectItem>
                  <SelectItem value="half">Halve breedte</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={editingField.is_required ?? false}
                onCheckedChange={v => setEditingField(f => ({ ...f, is_required: v }))}
                id="field-required"
              />
              <Label htmlFor="field-required">Verplicht veld</Label>
            </div>

            <div><Label>Validatie regex</Label><Input value={editingField.validation_regex ?? ''} onChange={e => setEditingField(f => ({ ...f, validation_regex: e.target.value }))} placeholder="^[0-9]{9}$" /></div>
            <div><Label>Validatie foutmelding</Label><Input value={editingField.validation_message ?? ''} onChange={e => setEditingField(f => ({ ...f, validation_message: e.target.value }))} placeholder="Voer een geldig BSN in (9 cijfers)" /></div>

            <Button onClick={() => saveField.mutate()} disabled={!editingField.label?.trim() || saveField.isPending} className="w-full">
              Opslaan
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </Card>
  );
};

export default OnboardingFormSettings;
