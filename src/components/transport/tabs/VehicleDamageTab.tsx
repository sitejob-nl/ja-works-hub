import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { formatDate, formatEUR } from '@/lib/format';
import { Plus, ShieldAlert, CheckCircle2, Bell } from 'lucide-react';

const DAMAGE_TYPES = [
  { value: 'lekke_band', label: 'Lekke band' },
  { value: 'motorstoring', label: 'Motorstoring' },
  { value: 'carrosserie', label: 'Carrosserie' },
  { value: 'ruitschade', label: 'Ruitschade' },
  { value: 'overig', label: 'Overig' },
];

const typeBadgeClass: Record<string, string> = {
  lekke_band: 'bg-orange-100 text-orange-700 border-0',
  motorstoring: 'bg-destructive/10 text-destructive border-0',
  carrosserie: 'bg-orange-100 text-orange-700 border-0',
  ruitschade: 'bg-orange-100 text-orange-700 border-0',
  overig: 'bg-muted text-muted-foreground border-0',
};

const VehicleDamageTab = ({ vehicle }: { vehicle: any }) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const { data: reports = [] } = useQuery({
    queryKey: ['vehicle-damage', vehicle.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicle_damage_reports')
        .select('*, employees(id, candidates(first_name, last_name))')
        .eq('vehicle_id', vehicle.id)
        .order('reported_at', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('vehicle_damage_reports')
        .update({ resolved: true, resolved_at: new Date().toISOString() } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vehicle-damage', vehicle.id] }); toast.success('Markeerd als opgelost'); },
  });

  const notifyGarageMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('vehicle_damage_reports')
        .update({ garage_notified: true, garage_notified_at: new Date().toISOString() } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vehicle-damage', vehicle.id] }); toast.success('Garage genotificeerd'); },
  });

  const getPhotoUrl = (path: string) => {
    const { data } = supabase.storage.from('documents').getPublicUrl(path);
    return data.publicUrl;
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-end">
        <Button onClick={() => setSheetOpen(true)} size="sm"><Plus className="h-4 w-4 mr-1" /> Nieuwe melding</Button>
      </div>

      {reports.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <ShieldAlert className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm font-medium">Geen schademeldingen</p>
        </div>
      ) : (
        reports.map(r => {
          const emp = r.employees?.candidates;
          const empName = emp ? `${emp.first_name} ${emp.last_name}` : '—';
          const typeLabel = DAMAGE_TYPES.find(d => d.value === r.damage_type)?.label ?? r.damage_type;

          return (
            <Card key={r.id}>
              <CardContent className="pt-5 pb-4 space-y-3">
                {/* Header */}
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{formatDate(r.reported_at)}</span>
                  <span className="text-muted-foreground">·</span>
                  <span>{empName}</span>
                  <Badge variant="secondary" className={typeBadgeClass[r.damage_type] ?? typeBadgeClass.overig}>{typeLabel}</Badge>
                  <Badge variant="secondary" className={r.resolved ? 'bg-primary/10 text-primary border-0' : 'bg-destructive/10 text-destructive border-0'}>
                    {r.resolved ? 'Opgelost' : 'Open'}
                  </Badge>
                </div>

                {/* Description */}
                <p className="text-sm">{r.description}</p>

                {/* Photos */}
                {r.photos && r.photos.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {r.photos.map((p: string, i: number) => (
                      <button key={i} onClick={() => setLightbox(getPhotoUrl(p))} className="h-16 w-16 rounded-md overflow-hidden border hover:ring-2 hover:ring-ring">
                        <img src={getPhotoUrl(p)} alt={`Schade ${i + 1}`} className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}

                {/* Cost */}
                {r.cost_estimate != null && (
                  <p className="text-sm text-muted-foreground">Geschatte kosten: <span className="font-medium text-foreground">{formatEUR(r.cost_estimate)}</span></p>
                )}

                {/* Garage */}
                {r.garage_notified ? (
                  <p className="text-xs text-primary">✓ Garage genotificeerd op {formatDate(r.garage_notified_at)}</p>
                ) : (
                  !r.resolved && (
                    <Button size="sm" variant="outline" onClick={() => notifyGarageMutation.mutate(r.id)}>
                      <Bell className="h-3.5 w-3.5 mr-1" /> Garage notificeren
                    </Button>
                  )
                )}

                {/* Resolution notes */}
                {r.resolution_notes && <p className="text-xs text-muted-foreground bg-muted rounded p-2">{r.resolution_notes}</p>}

                {/* Actions */}
                {!r.resolved && (
                  <Button size="sm" variant="outline" onClick={() => resolveMutation.mutate(r.id)}>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Markeer als opgelost
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })
      )}

      {/* Lightbox */}
      <Dialog open={!!lightbox} onOpenChange={() => setLightbox(null)}>
        <DialogContent className="max-w-2xl p-2">
          {lightbox && <img src={lightbox} alt="Schade foto" className="w-full rounded" />}
        </DialogContent>
      </Dialog>

      {/* New report sheet */}
      <NewDamageSheet open={sheetOpen} onOpenChange={setSheetOpen} vehicleId={vehicle.id} orgId={orgId} onDone={() => qc.invalidateQueries({ queryKey: ['vehicle-damage', vehicle.id] })} />
    </div>
  );
};

/* ─── New Damage Sheet ──────────────────────────────────── */

const NewDamageSheet = ({ open, onOpenChange, vehicleId, orgId, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; vehicleId: string; orgId: string | null; onDone: () => void;
}) => {
  const [form, setForm] = useState({ employee_id: '', damage_type: 'overig', description: '', garage_email: '', cost_estimate: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const { data: employees = [] } = useQuery({
    queryKey: ['active-employees', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees')
        .select('id, candidates(first_name, last_name)')
        .eq('organization_id', orgId!)
        .eq('status', 'actief');
      if (error) throw error;
      return data as any[];
    },
    enabled: !!orgId && open,
  });

  const handleSave = async (notifyGarage: boolean) => {
    if (!orgId || !form.employee_id || !form.description) return;
    setSaving(true);

    try {
      // Upload photos
      const photoPaths: string[] = [];
      for (const file of files) {
        const ext = file.name.split('.').pop() ?? 'jpg';
        const path = `${orgId}/damage/${vehicleId}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from('documents').upload(path, file);
        if (error) throw error;
        photoPaths.push(path);
      }

      const payload: any = {
        organization_id: orgId,
        vehicle_id: vehicleId,
        employee_id: form.employee_id,
        damage_type: form.damage_type,
        description: form.description,
        photos: photoPaths,
        garage_email: form.garage_email || null,
        cost_estimate: form.cost_estimate ? parseFloat(form.cost_estimate) : null,
        garage_notified: notifyGarage,
        garage_notified_at: notifyGarage ? new Date().toISOString() : null,
      };

      const { error } = await supabase.from('vehicle_damage_reports').insert(payload);
      if (error) throw error;

      toast.success('Schademelding opgeslagen');
      onDone();
      onOpenChange(false);
      setForm({ employee_id: '', damage_type: 'overig', description: '', garage_email: '', cost_estimate: '' });
      setFiles([]);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader><SheetTitle>Nieuwe schademelding</SheetTitle></SheetHeader>
        <div className="space-y-4 mt-6">
          <div>
            <Label>Medewerker *</Label>
            <Select value={form.employee_id} onValueChange={v => set('employee_id', v)}>
              <SelectTrigger><SelectValue placeholder="Selecteer medewerker" /></SelectTrigger>
              <SelectContent>
                {employees.map((e: any) => (
                  <SelectItem key={e.id} value={e.id}>{e.candidates?.first_name} {e.candidates?.last_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Type schade *</Label>
            <Select value={form.damage_type} onValueChange={v => set('damage_type', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DAMAGE_TYPES.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Beschrijving *</Label>
            <Textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} />
          </div>

          <div>
            <Label>Foto's (max 4)</Label>
            <Input type="file" accept="image/*" multiple onChange={e => {
              const selected = Array.from(e.target.files ?? []).slice(0, 4);
              setFiles(selected);
            }} />
            {files.length > 0 && <p className="text-xs text-muted-foreground mt-1">{files.length} bestand(en) geselecteerd</p>}
          </div>

          <div>
            <Label>E-mail garage (optioneel)</Label>
            <Input type="email" value={form.garage_email} onChange={e => set('garage_email', e.target.value)} placeholder="garage@voorbeeld.nl" />
          </div>

          <div>
            <Label>Geschatte kosten (€)</Label>
            <Input type="number" value={form.cost_estimate} onChange={e => set('cost_estimate', e.target.value)} placeholder="0.00" />
          </div>

          <div className="flex flex-col gap-2 pt-4">
            <Button onClick={() => handleSave(false)} disabled={!form.employee_id || !form.description || saving}>
              {saving ? 'Opslaan...' : 'Opslaan'}
            </Button>
            {form.garage_email && (
              <Button variant="outline" onClick={() => handleSave(true)} disabled={!form.employee_id || !form.description || saving}>
                <Bell className="h-4 w-4 mr-1" /> Opslaan & garage notificeren
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default VehicleDamageTab;
