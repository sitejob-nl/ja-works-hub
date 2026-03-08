import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

interface Props {
  match: any | null;
  vacancy: any;
  onClose: () => void;
}

const PlacementSheet = ({ match, vacancy, onClose }: Props) => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    function_name: '',
    start_date: '',
    end_date: '',
    hourly_rate: '',
    overtime_rate: '',
  });

  useEffect(() => {
    if (match && vacancy) {
      setForm({
        function_name: vacancy.title ?? '',
        start_date: vacancy.start_date ?? '',
        end_date: vacancy.end_date ?? '',
        hourly_rate: vacancy.hourly_rate?.toString() ?? '',
        overtime_rate: '',
      });
    }
  }, [match, vacancy]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const candidateId = match.candidate_id;
      const companyId = vacancy.company_id;

      // 1. Check if employee exists for this candidate
      const { data: existingEmployee } = await supabase
        .from('employees')
        .select('id')
        .eq('candidate_id', candidateId)
        .maybeSingle();

      let employeeId: string;

      if (existingEmployee) {
        employeeId = existingEmployee.id;
      } else {
        // Create employee
        const { data: newEmployee, error: empError } = await supabase
          .from('employees')
          .insert({
            organization_id: orgId,
            candidate_id: candidateId,
            start_date: form.start_date,
            status: 'actief' as any,
          })
          .select('id')
          .single();
        if (empError) throw empError;
        employeeId = newEmployee.id;

        // Update candidate status
        const { error: candError } = await supabase
          .from('candidates')
          .update({ status: 'geplaatst' as any })
          .eq('id', candidateId);
        if (candError) throw candError;
      }

      // 2. Create placement
      const { error: plError } = await supabase.from('placements').insert({
        organization_id: orgId,
        employee_id: employeeId,
        company_id: companyId,
        vacancy_id: vacancy.id,
        match_id: match.id,
        function_name: form.function_name,
        start_date: form.start_date,
        end_date: form.end_date || null,
        hourly_rate: parseFloat(form.hourly_rate),
        overtime_rate: form.overtime_rate ? parseFloat(form.overtime_rate) : null,
        status: 'actief' as any,
        created_by: user?.id ?? null,
      });
      if (plError) throw plError;

      // 3. Update match status
      const { error: matchError } = await supabase
        .from('matches')
        .update({ status: 'geplaatst' as any, status_changed_at: new Date().toISOString() })
        .eq('id', match.id);
      if (matchError) throw matchError;

      // 4. Increment filled_count
      const { error: vacError } = await supabase
        .from('vacancies')
        .update({
          filled_count: (vacancy.filled_count ?? 0) + 1,
          ...(((vacancy.filled_count ?? 0) + 1) >= vacancy.required_count ? { status: 'vervuld' as any } : {}),
        })
        .eq('id', vacancy.id);
      if (vacError) throw vacError;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vacancy-matches'] });
      qc.invalidateQueries({ queryKey: ['vacancy-placements'] });
      qc.invalidateQueries({ queryKey: ['vacancy', vacancy.id] });
      qc.invalidateQueries({ queryKey: ['vacancies'] });
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['candidates'] });
      toast.success('Plaatsing aangemaakt');
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const candidate = match?.candidates as any;

  return (
    <Sheet open={!!match} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Plaatsing aanmaken</SheetTitle>
        </SheetHeader>
        {match && (
          <div className="space-y-4 mt-6">
            <div className="p-3 bg-muted rounded-md text-sm">
              <div><span className="text-muted-foreground">Kandidaat:</span> <strong>{candidate?.first_name} {candidate?.last_name}</strong></div>
              <div><span className="text-muted-foreground">Opdrachtgever:</span> <strong>{(vacancy.companies as any)?.name}</strong></div>
            </div>
            <div><Label>Functienaam *</Label><Input value={form.function_name} onChange={(e) => set('function_name', e.target.value)} /></div>
            <div><Label>Startdatum *</Label><Input type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} /></div>
            <div><Label>Einddatum</Label><Input type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} /></div>
            <div><Label>Uurtarief (€) *</Label><Input type="number" step="0.01" value={form.hourly_rate} onChange={(e) => set('hourly_rate', e.target.value)} /></div>
            <div><Label>Overwerktarief (€)</Label><Input type="number" step="0.01" value={form.overtime_rate} onChange={(e) => set('overtime_rate', e.target.value)} /></div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={onClose}>Annuleren</Button>
              <Button onClick={() => mutation.mutate()} disabled={!form.function_name || !form.start_date || !form.hourly_rate || mutation.isPending}>
                {mutation.isPending ? 'Aanmaken...' : 'Plaatsing aanmaken'}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default PlacementSheet;
