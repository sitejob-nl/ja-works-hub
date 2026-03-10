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
import TagInput from '@/components/ui/tag-input';
import { ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

const VacancyNew = () => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    company_id: '', title: '', description: '', location: '',
    required_count: 1, urgency: 3, start_date: '', end_date: '',
    hourly_rate: '', required_skills: [] as string[],
    required_certifications: [] as string[],
    requires_drivers_license: false, notes: '',
  });

  const { data: companies } = useQuery({
    queryKey: ['companies-active'],
    queryFn: async () => {
      const { data, error } = await supabase.from('companies').select('id, name').eq('is_active', true).order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        organization_id: orgId,
        created_by: user?.id ?? null,
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
      const { data, error } = await supabase.from('vacancies').insert(payload).select('id').single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['vacancies'] });
      toast.success('Vacature aangemaakt');
      navigate(`/vacatures/${data.id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

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
            <Select value={form.company_id} onValueChange={(v) => set('company_id', v)}>
              <SelectTrigger><SelectValue placeholder="Selecteer opdrachtgever" /></SelectTrigger>
              <SelectContent>
                {(companies ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Titel *</Label><Input value={form.title} onChange={(e) => set('title', e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Beschrijving</Label><Textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Locatie</Label><Input value={form.location} onChange={(e) => set('location', e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Aantal nodig</Label><Input type="number" min={1} value={form.required_count} onChange={(e) => set('required_count', parseInt(e.target.value) || 1)} /></div>
          </div>
          <div className="space-y-1.5">
            <Label>Urgentie</Label>
            <Select value={form.urgency.toString()} onValueChange={(v) => set('urgency', parseInt(v))}>
              <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 — Laag</SelectItem>
                <SelectItem value="2">2</SelectItem>
                <SelectItem value="3">3 — Normaal</SelectItem>
                <SelectItem value="4">4</SelectItem>
                <SelectItem value="5">5 — Kritiek</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Startdatum</Label><Input type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Einddatum</Label><Input type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label>Uurtarief (€)</Label><Input type="number" step="0.01" value={form.hourly_rate} onChange={(e) => set('hourly_rate', e.target.value)} className="max-w-xs" /></div>
          <div className="space-y-1.5"><Label>Vereiste vaardigheden</Label><TagInput value={form.required_skills} onChange={(v) => set('required_skills', v)} placeholder="Typ vaardigheid + Enter" /></div>
          <div className="space-y-1.5"><Label>Vereiste certificaten</Label><TagInput value={form.required_certifications} onChange={(v) => set('required_certifications', v)} placeholder="Typ certificaat + Enter" /></div>
          <div className="flex items-center gap-2">
            <Checkbox checked={form.requires_drivers_license} onCheckedChange={(v) => set('requires_drivers_license', !!v)} id="dl" />
            <Label htmlFor="dl">Rijbewijs vereist</Label>
          </div>
          <div className="space-y-1.5"><Label>Notities</Label><Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} /></div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="ghost" onClick={() => navigate('/vacatures')}>Annuleren</Button>
            <Button onClick={() => mutation.mutate()} disabled={!form.company_id || !form.title || mutation.isPending}>
              {mutation.isPending ? 'Opslaan...' : 'Vacature aanmaken'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VacancyNew;
