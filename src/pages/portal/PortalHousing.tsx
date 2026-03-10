import { useState } from 'react';
import { usePortal } from '@/contexts/PortalContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Home, Star, Camera, Wrench, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { nl } from 'date-fns/locale';

const PortalHousing = () => {
  const { employee } = usePortal();
  const qc = useQueryClient();
  const employeeId = employee?.id;
  const orgId = employee?.organization_id;

  const [complaintOpen, setComplaintOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);

  // Fetch active housing assignment with unit + property
  const { data: assignment, isLoading } = useQuery({
    queryKey: ['portal-housing', employeeId],
    queryFn: async () => {
      const { data } = await supabase
        .from('housing_assignments')
        .select('*, units!inner(id, name, floor, property_id, properties!inner(id, name, address_street, address_postal, address_city))')
        .eq('employee_id', employeeId!)
        .eq('status', 'ingecheckt')
        .maybeSingle();
      return data;
    },
    enabled: !!employeeId,
  });

  // Fetch check-in inspection
  const { data: checkInInspection } = useQuery({
    queryKey: ['portal-checkin-inspection', assignment?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('housing_inspections')
        .select('*')
        .eq('housing_assignment_id', assignment!.id)
        .eq('inspection_type', 'check_in')
        .maybeSingle();
      return data;
    },
    enabled: !!assignment?.id,
  });

  const submitComplaint = useMutation({
    mutationFn: async () => {
      if (!assignment || !employeeId || !orgId) throw new Error('Geen huisvesting');
      if (!description.trim()) throw new Error('Vul een beschrijving in');

      const unit = assignment.units as any;
      const property = unit?.properties;

      // Upload photos
      const uploadedPaths: string[] = [];
      for (const photo of photos) {
        const ext = photo.name.split('.').pop();
        const path = `${orgId}/inspections/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from('documents').upload(path, photo);
        if (error) throw error;
        uploadedPaths.push(path);
      }

      const { error } = await supabase.from('housing_inspections').insert({
        organization_id: orgId,
        inspection_type: 'klacht' as any,
        unit_id: unit?.id,
        property_id: property?.id,
        housing_assignment_id: assignment.id,
        description: description.trim(),
        inspection_date: new Date().toISOString().split('T')[0],
        photos: uploadedPaths.length > 0 ? uploadedPaths : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Klacht ingediend');
      setComplaintOpen(false);
      setDescription('');
      setPhotos([]);
    },
    onError: (err: any) => toast.error(err.message || 'Indienen mislukt'),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Laden...</div>;

  if (!assignment) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Huisvesting</h1>
        <div className="bg-card rounded-xl border p-8 text-center text-muted-foreground">
          <Home className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p>Je hebt momenteel geen huisvesting toegewezen.</p>
        </div>
      </div>
    );
  }

  const unit = assignment.units as any;
  const property = unit?.properties;

  const photoFields = [
    { key: 'photo_room_overview', label: 'Kamer' },
    { key: 'photo_mattress', label: 'Matras' },
    { key: 'photo_kitchen', label: 'Keuken' },
    { key: 'photo_bathroom', label: 'Badkamer' },
    { key: 'photo_damage', label: 'Schade' },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Huisvesting</h1>

      {/* Housing info card */}
      <div className="bg-card rounded-xl border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Home className="h-4 w-4 text-primary" />
          <p className="font-semibold">{property?.name}</p>
        </div>
        <p className="text-sm text-muted-foreground">
          {property?.address_street}, {property?.address_postal} {property?.address_city}
        </p>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-muted-foreground">Kamer:</span>{' '}
            <span className="font-medium">{unit?.name}</span>
          </div>
          {unit?.floor != null && (
            <div>
              <span className="text-muted-foreground">Verdieping:</span>{' '}
              <span className="font-medium">{unit.floor}</span>
            </div>
          )}
          <div>
            <span className="text-muted-foreground">Check-in:</span>{' '}
            <span className="font-medium">
              {format(new Date(assignment.check_in_date), 'd MMM yyyy', { locale: nl })}
            </span>
          </div>
          {assignment.monthly_deduction != null && (
            <div>
              <span className="text-muted-foreground">Inhouding:</span>{' '}
              <span className="font-medium">€{assignment.monthly_deduction}/mnd</span>
            </div>
          )}
          <div>
            <span className="text-muted-foreground">Borg:</span>{' '}
            <Badge variant="secondary" className={`text-[10px] ${assignment.deposit_paid ? 'bg-stat-green/10 text-stat-green' : 'bg-orange-100 text-orange-600'} border-0`}>
              {assignment.deposit_paid ? 'Betaald' : 'Niet betaald'}
            </Badge>
          </div>
          {assignment.rent_paid_until && (
            <div>
              <span className="text-muted-foreground">Huur t/m:</span>{' '}
              <span className="font-medium">
                {format(new Date(assignment.rent_paid_until), 'd MMM yyyy', { locale: nl })}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Check-in photos */}
      {checkInInspection && (
        <div className="bg-card rounded-xl border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Camera className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-semibold">Check-in inspectie</p>
            </div>
            {checkInInspection.condition_rating && (
              <div className="flex items-center gap-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star
                    key={i}
                    className={`h-3.5 w-3.5 ${i < checkInInspection.condition_rating! ? 'text-yellow-500 fill-yellow-500' : 'text-muted'}`}
                  />
                ))}
              </div>
            )}
          </div>
          {checkInInspection.condition_notes && (
            <p className="text-sm text-muted-foreground">{checkInInspection.condition_notes}</p>
          )}
          <div className="grid grid-cols-3 gap-2">
            {photoFields.map(({ key, label }) => {
              const url = (checkInInspection as any)[key];
              if (!url) return null;
              return (
                <div key={key} className="space-y-1">
                  <p className="text-[10px] text-muted-foreground text-center">{label}</p>
                  <div className="aspect-square rounded-lg bg-muted overflow-hidden">
                    <img src={url} alt={label} className="w-full h-full object-cover" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Report maintenance */}
      <Sheet open={complaintOpen} onOpenChange={setComplaintOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" className="w-full gap-2">
            <Wrench className="h-4 w-4" /> Onderhoud melden
          </Button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Onderhoud melden</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div className="space-y-1.5">
              <Label>Beschrijving</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Beschrijf het probleem..."
                rows={4}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Foto's (max 3)</Label>
              <Input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  const files = Array.from(e.target.files || []).slice(0, 3);
                  setPhotos(files);
                }}
              />
              {photos.length > 0 && (
                <p className="text-xs text-muted-foreground">{photos.length} foto('s) geselecteerd</p>
              )}
            </div>
            <Button
              onClick={() => submitComplaint.mutate()}
              disabled={submitComplaint.isPending || !description.trim()}
              className="w-full"
            >
              {submitComplaint.isPending ? 'Indienen...' : 'Melding indienen'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default PortalHousing;
