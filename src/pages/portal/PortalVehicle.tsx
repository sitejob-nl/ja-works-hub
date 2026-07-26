import { useState } from 'react';
import { usePortal } from '@/contexts/PortalContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Car, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { nl } from 'date-fns/locale';
import { DAMAGE_TYPES, damageTypeIsUrgent, damageTypeLabel } from '@/lib/damage';

const resolveEmployeeRecordId = async (candidateId: string) => {
  const { data, error } = await supabase
    .from('employees')
    .select('id')
    .eq('candidate_id', candidateId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error('Geen medewerkerrecord gevonden voor deze kandidaat');
  return data.id;
};

const PortalVehicle = () => {
  const { employee } = usePortal();
  const qc = useQueryClient();
  const employeeId = employee?.id;
  const orgId = employee?.organization_id;

  const [damageOpen, setDamageOpen] = useState(false);
  const [damageType, setDamageType] = useState('overig');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [submitted, setSubmitted] = useState(false);

  // Fetch active vehicle assignment
  const { data: assignment, isLoading } = useQuery({
    queryKey: ['portal-vehicle', employeeId],
    queryFn: async () => {
      const { data } = await supabase
        .from('vehicle_assignments')
        .select('*, vehicles!inner(id, license_plate, brand, model, fuel_type, current_mileage)')
        .eq('candidate_id', employeeId!)
        .is('returned_date', null)
        .maybeSingle();
      return data;
    },
    enabled: !!employeeId,
  });

  // Fetch own damage reports
  const { data: damageReports } = useQuery({
    queryKey: ['portal-damage-reports', employeeId],
    queryFn: async () => {
      const { data } = await supabase
        .from('vehicle_damage_reports')
        .select('*')
        .eq('candidate_id', employeeId!)
        .order('reported_at', { ascending: false });
      return data ?? [];
    },
    enabled: !!employeeId,
  });

  const submitDamage = useMutation({
    mutationFn: async () => {
      if (!assignment || !employeeId || !orgId) throw new Error('Geen voertuig');
      if (!description.trim()) throw new Error('Vul een beschrijving in');
      if (photos.length === 0) throw new Error('Voeg minimaal één foto toe');

      const vehicle = assignment.vehicles as any;
      const employeeRecordId = assignment.employee_id ?? await resolveEmployeeRecordId(employeeId);

      // Upload photos
      const uploadedPaths: string[] = [];
      for (const photo of photos) {
        const ext = photo.name.split('.').pop();
        // Include the candidate id so Storage RLS can bind an upload to the
        // authenticated resident instead of trusting only the organization folder.
        const path = `${orgId}/vehicle-damage/${employeeId}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from('documents').upload(path, photo);
        if (error) throw error;
        uploadedPaths.push(path);
      }

      const { error } = await supabase.from('vehicle_damage_reports').insert({
        vehicle_id: vehicle.id,
        candidate_id: employeeId,
        employee_id: employeeRecordId,
        organization_id: orgId,
        damage_type: damageType,
        description: description.trim(),
        photos: uploadedPaths.length > 0 ? uploadedPaths : null,
        contact_route: 'internal_fleet',
        route_status: 'pending_internal',
        urgency: damageTypeIsUrgent(damageType) ? 'urgent' : 'normal',
        contact_phone_shared: false,
        reported_at: new Date().toISOString(),
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-damage-reports'] });
      setSubmitted(true);
      setDescription('');
      setPhotos([]);
      setDamageType('overig');
    },
    onError: (err: any) => toast.error(err.message || 'Indienen mislukt'),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Laden...</div>;

  if (!assignment) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Voertuig</h1>
        <div className="bg-card rounded-xl border p-8 text-center text-muted-foreground">
          <Car className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p>Je hebt momenteel geen voertuig toegewezen.</p>
        </div>
      </div>
    );
  }

  const vehicle = assignment.vehicles as any;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Voertuig</h1>

      {/* Vehicle info */}
      <div className="bg-card rounded-xl border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Car className="h-4 w-4 text-stat-blue" />
          <p className="font-semibold" data-no-translate="true">{vehicle.license_plate}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {vehicle.brand && (
            <div>
              <span className="text-muted-foreground">Merk:</span>{' '}
              <span className="font-medium" data-no-translate="true">{vehicle.brand}</span>
            </div>
          )}
          {vehicle.model && (
            <div>
              <span className="text-muted-foreground">Model:</span>{' '}
              <span className="font-medium" data-no-translate="true">{vehicle.model}</span>
            </div>
          )}
          {vehicle.fuel_type && (
            <div>
              <span className="text-muted-foreground">Brandstof:</span>{' '}
              <span className="font-medium">{vehicle.fuel_type}</span>
            </div>
          )}
          {vehicle.current_mileage != null && (
            <div>
              <span className="text-muted-foreground">Km-stand:</span>{' '}
              <span className="font-medium">{vehicle.current_mileage.toLocaleString()} km</span>
            </div>
          )}
          <div>
            <span className="text-muted-foreground">Toegewezen:</span>{' '}
            <span className="font-medium">
              {format(new Date(assignment.assigned_date), 'd MMM yyyy', { locale: nl })}
            </span>
          </div>
          {assignment.start_mileage != null && (
            <div>
              <span className="text-muted-foreground">Start km:</span>{' '}
              <span className="font-medium">{assignment.start_mileage.toLocaleString()} km</span>
            </div>
          )}
        </div>
      </div>

      {/* Damage report */}
      <Sheet open={damageOpen} onOpenChange={(o) => { setDamageOpen(o); if (!o) setSubmitted(false); }}>
        <SheetTrigger asChild>
          <Button variant="outline" className="w-full gap-2">
            <AlertTriangle className="h-4 w-4" /> Schade melden
          </Button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Schade melden</SheetTitle>
          </SheetHeader>
          {submitted ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
              <CheckCircle2 className="h-10 w-10 text-stat-green" />
              <p className="font-semibold text-center">Schademelding ingediend</p>
              <p className="text-sm text-muted-foreground text-center">De interne fleet/admin wordt geïnformeerd.</p>
              <Button variant="outline" onClick={() => { setSubmitted(false); setDamageOpen(false); }}>
                Sluiten
              </Button>
            </div>
          ) : (
            <div className="space-y-4 mt-6">
              <div className="space-y-1.5">
                <Label>Type schade</Label>
                <Select value={damageType} onValueChange={setDamageType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DAMAGE_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Beschrijving</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Beschrijf de schade..."
                  rows={4}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Foto's * (max 4)</Label>
                <Input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []).slice(0, 4);
                    setPhotos(files);
                  }}
                />
                {photos.length > 0 && (
                  <p className="text-xs text-muted-foreground">{photos.length} foto('s) geselecteerd</p>
                )}
                {photos.length === 0 && (
                  <p className="text-xs text-destructive">Minimaal één foto is verplicht.</p>
                )}
              </div>
              <Button
                onClick={() => submitDamage.mutate()}
                disabled={submitDamage.isPending || !description.trim() || photos.length === 0}
                className="w-full"
              >
                {submitDamage.isPending ? 'Indienen...' : 'Schademelding indienen'}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Previous damage reports */}
      {damageReports && damageReports.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Mijn schademeldingen</p>
          <div className="bg-card rounded-xl border divide-y">
            {damageReports.map((r) => (
              <div key={r.id} className="px-4 py-3 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{damageTypeLabel(r.damage_type)}</p>
                  {r.resolved ? (
                    <Badge variant="secondary" className="text-[10px] bg-stat-green/10 text-stat-green border-0">
                      Opgelost
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px] bg-orange-100 text-orange-600 border-0">
                      Open
                    </Badge>
                  )}
                </div>
                {r.description && (
                  <p className="text-sm text-muted-foreground truncate">{r.description}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {format(new Date(r.reported_at), 'd MMM yyyy', { locale: nl })}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PortalVehicle;
