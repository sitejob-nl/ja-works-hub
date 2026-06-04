import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import TagInput from '@/components/ui/tag-input';
import SkillMultiSelect from '@/components/shared/SkillMultiSelect';
import { ChevronRight, Plus } from 'lucide-react';
import { toast } from 'sonner';

const FUNCTION_FREE_TEXT = '__free_text__';

const formatCompanyLocation = (company?: {
  address_street?: string | null;
  address_city?: string | null;
} | null) => [company?.address_street, company?.address_city].filter(Boolean).join(', ');

const VacancyNew = () => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    company_id: '',
    function_id: '' as string | typeof FUNCTION_FREE_TEXT,
    title: '',
    description: '',
    location: '',
    required_count: 1,
    urgency: 2,
    start_date: '',
    start_date_text: '',
    start_date_kind: 'date' as 'date' | 'asap',
    end_date: '',
    hourly_rate: '',
    salary_min: '',
    salary_max: '',
    required_skills: [] as string[],
    required_certifications: [] as string[],
    requires_drivers_license: false,
    notes: '',
    add_function_to_company: false,
  });

  const { data: companies } = useQuery({
    queryKey: ['companies-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('id, name, address_street, address_city')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: companyFunctions = [] } = useQuery({
    queryKey: ['company-functions', form.company_id],
    queryFn: async () => {
      if (!form.company_id) return [];
      const { data, error } = await supabase
        .from('company_functions')
        .select('id, name, description, default_hourly_rate, salary_min, salary_max, required_skills')
        .eq('company_id', form.company_id)
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!form.company_id,
  });

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const handleCompanyChange = (companyId: string) => {
    setForm((f) => {
      const previousLocation = formatCompanyLocation(companies?.find((c) => c.id === f.company_id));
      const nextLocation = formatCompanyLocation(companies?.find((c) => c.id === companyId));
      const shouldUseCompanyLocation = !f.location || f.location === previousLocation;
      return {
        ...f,
        company_id: companyId,
        function_id: '',
        title: '',
        location: shouldUseCompanyLocation ? nextLocation : f.location,
      };
    });
  };

  const handleFunctionChange = (value: string) => {
    if (value === FUNCTION_FREE_TEXT) {
      setForm((f) => ({ ...f, function_id: FUNCTION_FREE_TEXT, title: '' }));
      return;
    }
    const fn = companyFunctions.find((f) => f.id === value) as any;
    setForm((f) => ({
      ...f,
      function_id: value,
      title: fn?.name ?? '',
      description: f.description || fn?.description || '',
      hourly_rate: f.hourly_rate || (fn?.default_hourly_rate ? String(fn.default_hourly_rate) : ''),
      salary_min: f.salary_min || (fn?.salary_min != null ? String(fn.salary_min) : ''),
      salary_max: f.salary_max || (fn?.salary_max != null ? String(fn.salary_max) : ''),
      required_skills: f.required_skills.length ? f.required_skills : (Array.isArray(fn?.required_skills) ? fn.required_skills : []),
    }));
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.hourly_rate) {
        throw new Error('Uurtarief is verplicht voor een vacature.');
      }

      let finalFunctionId: string | null = null;

      if (form.function_id && form.function_id !== FUNCTION_FREE_TEXT) {
        finalFunctionId = form.function_id;
      } else if (form.function_id === FUNCTION_FREE_TEXT && form.add_function_to_company && form.title.trim()) {
        const { data: newFn, error: fnErr } = await supabase
          .from('company_functions')
          .insert({
            organization_id: orgId,
            company_id: form.company_id,
            name: form.title.trim(),
            description: form.description || null,
            default_hourly_rate: form.hourly_rate ? parseFloat(form.hourly_rate) : null,
            salary_min: form.salary_min ? parseFloat(form.salary_min) : null,
            salary_max: form.salary_max ? parseFloat(form.salary_max) : null,
            required_skills: form.required_skills,
            is_active: true,
          })
          .select('id')
          .single();
        if (fnErr) throw fnErr;
        finalFunctionId = newFn.id;
      }

      const isAsap = form.start_date_kind === 'asap';
      const payload: any = {
        organization_id: orgId,
        created_by: user?.id ?? null,
        company_id: form.company_id,
        function_id: finalFunctionId,
        title: form.title,
        description: form.description || null,
        location: form.location || null,
        required_count: form.required_count,
        urgency: form.urgency,
        start_date: isAsap ? null : (form.start_date || null),
        start_date_text: isAsap ? (form.start_date_text || 'Direct') : null,
        end_date: form.end_date || null,
        hourly_rate: form.hourly_rate ? parseFloat(form.hourly_rate) : null,
        salary_min: form.salary_min ? parseFloat(form.salary_min) : null,
        salary_max: form.salary_max ? parseFloat(form.salary_max) : null,
        required_skills: form.required_skills.length ? form.required_skills : null,
        required_certifications: form.required_certifications.length ? form.required_certifications : null,
        requires_drivers_license: form.requires_drivers_license,
        notes: form.notes || null,
      };
      const { data, error } = await supabase.from('vacancies').insert(payload).select('id').single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['vacancies'] });
      qc.invalidateQueries({ queryKey: ['company-functions'] });
      toast.success('Vacature aangemaakt');
      // Magere vacature zonder handmatige skills → AI vult required_skills aan uit de
      // titel/omschrijving (Fase 1.5b). Non-blocking; detailpagina ververst zodra klaar.
      if (form.required_skills.length === 0) {
        toast.info('AI vult de vaardigheden aan op basis van de vacaturetekst…');
        supabase.functions.invoke('enrich-vacancies', { body: { vacancy_id: data.id } })
          .then(() => qc.invalidateQueries({ queryKey: ['vacancy', data.id] }))
          .catch(() => { /* niet-blokkerend */ });
      }
      navigate(`/vacatures/${data.id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const usingFreeText = form.function_id === FUNCTION_FREE_TEXT || (!form.function_id && form.company_id);
  const canSubmit =
    !!form.company_id &&
    !!form.title.trim() &&
    !!form.hourly_rate &&
    (form.start_date_kind === 'asap' || !!form.start_date) &&
    !mutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/vacatures" className="hover:text-foreground transition-colors">Vacatures</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">Nieuwe vacature</span>
      </div>

      <h1 className="text-2xl font-semibold">Nieuwe vacature</h1>

      <div className="bg-card rounded-lg border p-6 max-w-3xl">
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label>Opdrachtgever *</Label>
            <Select value={form.company_id} onValueChange={handleCompanyChange}>
              <SelectTrigger><SelectValue placeholder="Selecteer opdrachtgever" /></SelectTrigger>
              <SelectContent>
                {(companies ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {form.company_id && (
            <div className="space-y-1.5">
              <Label>Functie *</Label>
              <Select value={form.function_id || undefined} onValueChange={handleFunctionChange}>
                <SelectTrigger>
                  <SelectValue placeholder={companyFunctions.length ? 'Kies functie van dit bedrijf' : 'Geen standaard-functies — kies vrije tekst'} />
                </SelectTrigger>
                <SelectContent>
                  {companyFunctions.map((fn) => (
                    <SelectItem key={fn.id} value={fn.id}>{fn.name}</SelectItem>
                  ))}
                  <SelectItem value={FUNCTION_FREE_TEXT}>+ Andere functie (vrije tekst)</SelectItem>
                </SelectContent>
              </Select>
              {usingFreeText && (
                <div className="flex items-center gap-2 pt-2">
                  <Checkbox
                    id="add-fn-company"
                    checked={form.add_function_to_company}
                    onCheckedChange={(v) => set('add_function_to_company', !!v)}
                  />
                  <Label htmlFor="add-fn-company" className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1">
                    <Plus className="h-3 w-3" /> Voeg toe als standaard-functie van dit bedrijf
                  </Label>
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Titel *</Label>
            <Input
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder={usingFreeText ? 'Bijv. MIG-MAG lasser nachtdienst' : 'Verfijning van functienaam (optioneel)'}
            />
          </div>
          <div className="space-y-1.5"><Label>Beschrijving</Label><Textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Locatie</Label><Input value={form.location} onChange={(e) => set('location', e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Aantal nodig</Label><Input type="number" min={1} value={form.required_count} onChange={(e) => set('required_count', parseInt(e.target.value) || 1)} /></div>
          </div>
          <div className="space-y-1.5">
            <Label>Urgentie *</Label>
            <Select value={form.urgency.toString()} onValueChange={(v) => set('urgency', parseInt(v))}>
              <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 — Laag</SelectItem>
                <SelectItem value="2">2 — Normaal</SelectItem>
                <SelectItem value="3">3 — Hoog</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Startdatum *</Label>
            <ToggleGroup
              type="single"
              value={form.start_date_kind}
              onValueChange={(v) => v && set('start_date_kind', v as 'date' | 'asap')}
              className="justify-start"
            >
              <ToggleGroupItem value="date" className="text-xs">Op datum</ToggleGroupItem>
              <ToggleGroupItem value="asap" className="text-xs">Direct / ZSM</ToggleGroupItem>
            </ToggleGroup>
            <div className="grid grid-cols-2 gap-4">
              {form.start_date_kind === 'date' ? (
                <Input type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
              ) : (
                <Input
                  value={form.start_date_text}
                  onChange={(e) => set('start_date_text', e.target.value)}
                  placeholder="Direct (default als leeg)"
                />
              )}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Einddatum (optioneel)</Label>
                <Input type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Salaris min (€/u)</Label>
              <Input type="number" step="0.01" value={form.salary_min} onChange={(e) => set('salary_min', e.target.value)} placeholder="bv. 22.50" />
            </div>
            <div className="space-y-1.5">
              <Label>Salaris max (€/u)</Label>
              <Input type="number" step="0.01" value={form.salary_max} onChange={(e) => set('salary_max', e.target.value)} placeholder="bv. 28.00" />
            </div>
            <div className="space-y-1.5">
              <Label>Uurtarief (€) *</Label>
              <Input type="number" step="0.01" value={form.hourly_rate} onChange={(e) => set('hourly_rate', e.target.value)} placeholder="bv. 42.50" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Vereiste vaardigheden</Label>
            <SkillMultiSelect value={form.required_skills} onChange={(v) => set('required_skills', v)} />
          </div>
          <div className="space-y-1.5"><Label>Vereiste certificaten</Label><TagInput value={form.required_certifications} onChange={(v) => set('required_certifications', v)} placeholder="Typ certificaat + Enter" /></div>
          <div className="flex items-center gap-2">
            <Checkbox checked={form.requires_drivers_license} onCheckedChange={(v) => set('requires_drivers_license', !!v)} id="dl" />
            <Label htmlFor="dl">Rijbewijs vereist</Label>
          </div>
          <div className="space-y-1.5"><Label>Notities</Label><Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} /></div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="ghost" onClick={() => navigate('/vacatures')}>Annuleren</Button>
            <Button onClick={() => mutation.mutate()} disabled={!canSubmit}>
              {mutation.isPending ? 'Opslaan...' : 'Vacature aanmaken'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VacancyNew;
