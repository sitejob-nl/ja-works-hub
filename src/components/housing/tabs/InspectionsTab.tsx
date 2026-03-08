import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Plus } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { toast } from 'sonner';

const InspectionsTab = ({ propertyId }: { propertyId: string }) => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [form, setForm] = useState({
    inspection_date: new Date().toISOString().split('T')[0],
    unit_id: '',
    description: '',
    notes: '',
  });

  const { data: inspections = [] } = useQuery({
    queryKey: ['inspections', propertyId],
    queryFn: async () => {
      const { data, error } = await supabase.from('housing_inspections')
        .select('*, units!housing_inspections_unit_id_fkey(name)')
        .eq('property_id', propertyId)
        .order('inspection_date', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: units = [] } = useQuery({
    queryKey: ['property-units-inspections', propertyId],
    queryFn: async () => {
      const { data, error } = await supabase.from('units').select('id, name').eq('property_id', propertyId);
      if (error) throw error;
      return data;
    },
    enabled: adding,
  });

  const addInspection = useMutation({
    mutationFn: async () => {
      let photoPaths: string[] = [];
      for (const file of files) {
        const ext = file.name.split('.').pop();
        const path = `${orgId}/inspections/${propertyId}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadErr } = await supabase.storage.from('documents').upload(path, file);
        if (uploadErr) throw uploadErr;
        photoPaths.push(path);
      }
      const { error } = await supabase.from('housing_inspections').insert({
        organization_id: orgId,
        property_id: propertyId,
        unit_id: form.unit_id || null,
        inspection_date: form.inspection_date,
        description: form.description,
        notes: form.notes || null,
        inspected_by: user?.id ?? null,
        photos: photoPaths.length > 0 ? photoPaths : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inspections', propertyId] });
      setAdding(false);
      setForm({ inspection_date: new Date().toISOString().split('T')[0], unit_id: '', description: '', notes: '' });
      setFiles([]);
      toast.success('Inspectie aangemaakt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const resolve = useMutation({
    mutationFn: async (inspectionId: string) => {
      const { error } = await supabase.from('housing_inspections')
        .update({ resolved: true, resolved_at: new Date().toISOString() })
        .eq('id', inspectionId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inspections', propertyId] });
      toast.success('Inspectie opgelost');
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Inspecties</h3>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> Nieuwe inspectie
        </Button>
      </div>

      <Sheet open={adding} onOpenChange={setAdding}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>Nieuwe inspectie</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6">
            <div><Label>Datum</Label><Input type="date" value={form.inspection_date} onChange={(e) => setForm(f => ({ ...f, inspection_date: e.target.value }))} /></div>
            <div>
              <Label>Kamer (optioneel)</Label>
              <Select value={form.unit_id} onValueChange={(v) => setForm(f => ({ ...f, unit_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Heel pand" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Heel pand</SelectItem>
                  {units.map((u: any) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Beschrijving *</Label><Textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} rows={3} /></div>
            <div>
              <Label>Foto's</Label>
              <Input ref={fileRef} type="file" multiple accept="image/*" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
            </div>
            <div><Label>Notities</Label><Textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={() => setAdding(false)}>Annuleren</Button>
              <Button onClick={() => addInspection.mutate()} disabled={!form.description || addInspection.isPending}>
                {addInspection.isPending ? 'Opslaan...' : 'Opslaan'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {inspections.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">Geen inspecties</p>
      ) : (
        <div className="space-y-3">
          {inspections.map((insp: any) => (
            <div key={insp.id} className="bg-card rounded-lg border p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-medium">{formatDate(insp.inspection_date)}</p>
                    <Badge variant="secondary" className={`text-xs ${insp.resolved ? 'bg-stat-green/10 text-stat-green border-0' : 'bg-red-100 text-red-600 border-0'}`}>
                      {insp.resolved ? 'Opgelost' : 'Open'}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{insp.units?.name ?? 'Heel pand'}</span>
                  </div>
                  <p className="text-sm">{insp.description}</p>
                  {insp.notes && <p className="text-xs text-muted-foreground mt-1">{insp.notes}</p>}
                  {insp.photos && insp.photos.length > 0 && (
                    <div className="flex gap-2 mt-2">
                      {insp.photos.map((path: string, i: number) => (
                        <div key={i} className="h-12 w-12 bg-muted rounded border flex items-center justify-center text-xs text-muted-foreground">
                          📷
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {!insp.resolved && (
                  <Button size="sm" variant="outline" onClick={() => resolve.mutate(insp.id)} disabled={resolve.isPending}>
                    Opgelost
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default InspectionsTab;
