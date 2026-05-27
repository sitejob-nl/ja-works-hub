import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import TagInput from '@/components/ui/tag-input';
import SkillMultiSelect from '@/components/shared/SkillMultiSelect';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vacancy?: any;
}

const emptyForm = {
  company_id: '',
  title: '',
  description: '',
  location: '',
  required_count: 1,
  urgency: 3,
  start_date: '',
  end_date: '',
  hourly_rate: '',
  required_skills: [] as string[],
  required_certifications: [] as string[],
  requires_drivers_license: false,
  notes: '',
};

const VacancySlideOver = ({ open, onOpenChange, vacancy }: Props) => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const isEdit = !!vacancy;
  const [form, setForm] = useState(emptyForm);

  const { data: companies } = useQuery({
    queryKey: ['companies-active'],
    queryFn: async () => {
      const { data, error } = await supabase.from('companies').select('id, name').eq('is_active', true).order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
  });

  useEffect(() => {
    if (vacancy) {
      setForm({
        company_id: vacancy.company_id ?? '',
        title: vacancy.title ?? '',
        description: vacancy.description ?? '',
        location: vacancy.location ?? '',
        required_count: vacancy.required_count ?? 1,
        urgency: vacancy.urgency ?? 3,
        start_date: vacancy.start_date ?? '',
        end_date: vacancy.end_date ?? '',
        hourly_rate: vacancy.hourly_rate?.toString() ?? '',
        required_skills: vacancy.required_skills ?? [],
        required_certifications: vacancy.required_certifications ?? [],
        requires_drivers_license: vacancy.requires_drivers_license ?? false,
        notes: vacancy.notes ?? '',
      });
    } else {
      setForm(emptyForm);
    }
  }, [vacancy, open]);

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        company_id: form.company_id,
        title: form.title,
        description: form.description || null,
        location: form.location || null,
        required_count: form.required_count,
        urgency: form.urgency,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        hourly_rate: form.hourly_rate ? parseFloat(form.hourly_rate) : null,
        required_skills: form.required_skills.length ? form.required_skills : null,
        required_certifications: form.required_certifications.length ? form.required_certifications : null,
        requires_drivers_license: form.requires_drivers_license,
        notes: form.notes || null,
      };
      if (isEdit) {
        const { error } = await supabase.from('vacancies').update(payload).eq('id', vacancy.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('vacancies').insert({ ...payload, organization_id: orgId, created_by: user?.id ?? null });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vacancies'] });
      if (isEdit) qc.invalidateQueries({ queryKey: ['vacancy', vacancy.id] });
      toast.success(isEdit ? 'Vacature bijgewerkt' : 'Vacature aangemaakt');
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Vacature bewerken' : 'Nieuwe vacature'}</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 mt-6">
          <div>
            <Label>Opdrachtgever *</Label>
            <Select value={form.company_id} onValueChange={(v) => set('company_id', v)}>
              <SelectTrigger><SelectValue placeholder="Selecteer opdrachtgever" /></SelectTrigger>
              <SelectContent>
                {(companies ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Titel *</Label><Input value={form.title} onChange={(e) => set('title', e.target.value)} /></div>
          <div><Label>Beschrijving</Label><Textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Locatie</Label><Input value={form.location} onChange={(e) => set('location', e.target.value)} /></div>
            <div><Label>Aantal nodig</Label><Input type="number" min={1} value={form.required_count} onChange={(e) => set('required_count', parseInt(e.target.value) || 1)} /></div>
          </div>
          <div>
            <Label>Urgentie</Label>
            <Select value={form.urgency.toString()} onValueChange={(v) => set('urgency', parseInt(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 — Laag</SelectItem>
                <SelectItem value="2">2</SelectItem>
                <SelectItem value="3">3 — Normaal</SelectItem>
                <SelectItem value="4">4</SelectItem>
                <SelectItem value="5">5 — Kritiek</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Startdatum</Label><Input type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} /></div>
            <div><Label>Einddatum</Label><Input type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} /></div>
          </div>
          <div><Label>Uurtarief (€)</Label><Input type="number" step="0.01" value={form.hourly_rate} onChange={(e) => set('hourly_rate', e.target.value)} /></div>
          <div>
            <Label>Vereiste vaardigheden</Label>
            <SkillMultiSelect value={form.required_skills} onChange={(v) => set('required_skills', v)} />
          </div>
          <div><Label>Vereiste certificaten</Label><TagInput value={form.required_certifications} onChange={(v) => set('required_certifications', v)} placeholder="Typ certificaat + Enter" /></div>
          <div className="flex items-center gap-2">
            <Checkbox checked={form.requires_drivers_license} onCheckedChange={(v) => set('requires_drivers_license', !!v)} id="dl" />
            <Label htmlFor="dl">Rijbewijs vereist</Label>
          </div>
          <div><Label>Notities</Label><Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} /></div>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuleren</Button>
            <Button onClick={() => mutation.mutate()} disabled={!form.company_id || !form.title || mutation.isPending}>
              {mutation.isPending ? 'Opslaan...' : 'Opslaan'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default VacancySlideOver;
