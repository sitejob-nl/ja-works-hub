import { useState, useRef, useMemo } from 'react';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Plus, Star } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { toast } from 'sonner';

type InspectionType = 'check_in' | 'check_out' | 'periodiek' | 'onderhoud' | 'klacht';

const TYPE_LABELS: Record<InspectionType, string> = {
  check_in: 'Check-in',
  check_out: 'Check-out',
  periodiek: 'Periodiek',
  onderhoud: 'Onderhoud',
  klacht: 'Klacht',
};

const TYPE_COLORS: Record<InspectionType, string> = {
  check_in: 'bg-green-100 text-green-700 border-0',
  check_out: 'bg-blue-100 text-blue-700 border-0',
  periodiek: 'bg-gray-100 text-gray-600 border-0',
  onderhoud: 'bg-orange-100 text-orange-700 border-0',
  klacht: 'bg-red-100 text-red-600 border-0',
};

const PHOTO_FIELDS = [
  { key: 'photo_mattress', label: 'Foto matras' },
  { key: 'photo_room_overview', label: 'Foto kamer overzicht' },
  { key: 'photo_bathroom', label: 'Foto badkamer' },
  { key: 'photo_kitchen', label: 'Foto keuken' },
  { key: 'photo_damage', label: 'Foto schade (optioneel)' },
] as const;

const StarRating = ({ value, onChange }: { value: number; onChange: (v: number) => void }) => (
  <div className="flex gap-1">
    {[1, 2, 3, 4, 5].map((n) => (
      <button key={n} type="button" onClick={() => onChange(n)} className="p-0.5">
        <Star className={`h-5 w-5 ${n <= value ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/30'}`} />
      </button>
    ))}
  </div>
);

const InspectionsTab = ({ propertyId }: { propertyId: string }) => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>('alle');
  const [files, setFiles] = useState<File[]>([]);
  const [photoFiles, setPhotoFiles] = useState<Record<string, File | null>>({
    photo_mattress: null, photo_room_overview: null, photo_bathroom: null, photo_kitchen: null, photo_damage: null,
  });

  const defaultForm = {
    inspection_date: new Date().toISOString().split('T')[0],
    unit_id: '',
    description: '',
    notes: '',
    inspection_type: 'periodiek' as InspectionType,
    housing_assignment_id: '',
    condition_rating: 0,
    condition_notes: '',
  };
  const [form, setForm] = useState(defaultForm);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const isCheckInOut = form.inspection_type === 'check_in' || form.inspection_type === 'check_out';

  // Queries
  const { data: inspections = [] } = useQuery({
    queryKey: ['inspections', propertyId],
    queryFn: async () => {
      const { data, error } = await supabase.from('housing_inspections')
        .select(`*, units!housing_inspections_unit_id_fkey(name),
          housing_assignments!housing_inspections_housing_assignment_id_fkey(
            id, employees!housing_assignments_employee_id_fkey(
              id, candidates!employees_candidate_id_fkey(first_name, last_name)
            )
          )`)
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

  const { data: assignments = [] } = useQuery({
    queryKey: ['property-assignments-inspections', propertyId],
    queryFn: async () => {
      const { data, error } = await supabase.from('housing_assignments')
        .select(`id, status, unit_id, employees!housing_assignments_employee_id_fkey(
          id, candidates!employees_candidate_id_fkey(first_name, last_name)
        ), units!housing_assignments_unit_id_fkey(name)`)
        .eq('organization_id', orgId!)
        .in('status', ['ingecheckt', 'gereserveerd']);
      if (error) throw error;
      // Filter to this property's units
      const unitIds = units.map((u: any) => u.id);
      return (data ?? []).filter((a: any) => unitIds.includes(a.unit_id));
    },
    enabled: adding && isCheckInOut && units.length > 0,
  });

  // Filtered inspections
  const filtered = useMemo(() => {
    if (typeFilter === 'alle') return inspections;
    return inspections.filter((i: any) => i.inspection_type === typeFilter);
  }, [inspections, typeFilter]);

  // Photo URL helper
  const getPhotoUrl = (path: string | null) => {
    if (!path) return null;
    const { data } = supabase.storage.from('documents').getPublicUrl(path);
    return data?.publicUrl ?? null;
  };

  // Upload helper
  const uploadPhoto = async (file: File, type: string): Promise<string> => {
    const ext = file.name.split('.').pop();
    const path = `${orgId}/inspections/${propertyId}/${type}_${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('documents').upload(path, file);
    if (error) throw error;
    return path;
  };

  const addInspection = useMutation({
    mutationFn: async () => {
      let photoPaths: string[] = [];
      const photoColumns: Record<string, string | null> = {
        photo_mattress: null, photo_room_overview: null, photo_bathroom: null, photo_kitchen: null, photo_damage: null,
      };

      if (isCheckInOut) {
        // Upload specific photos
        for (const field of PHOTO_FIELDS) {
          const file = photoFiles[field.key];
          if (file) {
            const path = await uploadPhoto(file, field.key);
            photoColumns[field.key] = path;
            photoPaths.push(path);
          }
        }
      } else {
        // Generic upload
        for (const file of files) {
          const path = await uploadPhoto(file, 'generic');
          photoPaths.push(path);
        }
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
        inspection_type: form.inspection_type,
        housing_assignment_id: isCheckInOut && form.housing_assignment_id ? form.housing_assignment_id : null,
        condition_rating: isCheckInOut && form.condition_rating > 0 ? form.condition_rating : null,
        condition_notes: isCheckInOut && form.condition_notes ? form.condition_notes : null,
        ...photoColumns,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inspections', propertyId] });
      setAdding(false);
      setForm(defaultForm);
      setFiles([]);
      setPhotoFiles({ photo_mattress: null, photo_room_overview: null, photo_bathroom: null, photo_kitchen: null, photo_damage: null });
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

  const getResidentName = (insp: any) => {
    const c = insp.housing_assignments?.employees?.candidates;
    if (!c) return null;
    return `${c.first_name} ${c.last_name}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Inspecties</h3>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> Nieuwe inspectie
        </Button>
      </div>

      {/* Filter tabs */}
      <Tabs value={typeFilter} onValueChange={setTypeFilter}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="alle">Alle</TabsTrigger>
          <TabsTrigger value="check_in">Check-in</TabsTrigger>
          <TabsTrigger value="check_out">Check-out</TabsTrigger>
          <TabsTrigger value="onderhoud">Onderhoud</TabsTrigger>
          <TabsTrigger value="klacht">Klachten</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* New inspection sheet */}
      <Sheet open={adding} onOpenChange={setAdding}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader><SheetTitle>Nieuwe inspectie</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6">
            <div>
              <Label>Type inspectie</Label>
              <Select value={form.inspection_type} onValueChange={(v) => set('inspection_type', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABELS).map(([k, l]) => (
                    <SelectItem key={k} value={k}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div><Label>Datum</Label><Input type="date" value={form.inspection_date} onChange={(e) => set('inspection_date', e.target.value)} /></div>

            <div>
              <Label>Kamer (optioneel)</Label>
              <Select value={form.unit_id} onValueChange={(v) => set('unit_id', v)}>
                <SelectTrigger><SelectValue placeholder="Heel pand" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Heel pand</SelectItem>
                  {units.map((u: any) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {isCheckInOut && (
              <>
                <Separator />
                <div>
                  <Label>Bewoner</Label>
                  <Select value={form.housing_assignment_id} onValueChange={(v) => set('housing_assignment_id', v)}>
                    <SelectTrigger><SelectValue placeholder="Selecteer bewoner..." /></SelectTrigger>
                    <SelectContent>
                      {assignments.map((a: any) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.employees?.candidates?.first_name} {a.employees?.candidates?.last_name} — {a.units?.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="mb-2 block">Conditie beoordeling</Label>
                  <StarRating value={form.condition_rating} onChange={(v) => set('condition_rating', v)} />
                </div>

                <div><Label>Conditie notities</Label><Textarea value={form.condition_notes} onChange={(e) => set('condition_notes', e.target.value)} rows={2} /></div>

                <Separator />
                <p className="text-sm font-medium text-foreground">Foto's</p>
                {PHOTO_FIELDS.map((field) => (
                  <div key={field.key}>
                    <Label>{field.label}</Label>
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={(e) => setPhotoFiles((prev) => ({ ...prev, [field.key]: e.target.files?.[0] ?? null }))}
                    />
                    {photoFiles[field.key] && (
                      <p className="text-xs text-muted-foreground mt-1">{photoFiles[field.key]!.name}</p>
                    )}
                  </div>
                ))}
              </>
            )}

            {!isCheckInOut && (
              <div>
                <Label>Foto's</Label>
                <Input ref={fileRef} type="file" multiple accept="image/*" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
              </div>
            )}

            <div><Label>Beschrijving *</Label><Textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} /></div>
            <div><Label>Notities</Label><Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} /></div>

            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={() => setAdding(false)}>Annuleren</Button>
              <Button onClick={() => addInspection.mutate()} disabled={!form.description || addInspection.isPending}>
                {addInspection.isPending ? 'Opslaan...' : 'Opslaan'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Inspection cards */}
      {filtered.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">Geen inspecties</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((insp: any) => {
            const inspType = (insp.inspection_type ?? 'periodiek') as InspectionType;
            const residentName = getResidentName(insp);
            const specificPhotos = PHOTO_FIELDS.filter((f) => insp[f.key]);

            return (
              <div key={insp.id} className="bg-card rounded-lg border p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium">{formatDate(insp.inspection_date)}</p>
                      <Badge variant="secondary" className={`text-xs ${TYPE_COLORS[inspType]}`}>
                        {TYPE_LABELS[inspType]}
                      </Badge>
                      <Badge variant="secondary" className={`text-xs ${insp.resolved ? 'bg-stat-green/10 text-stat-green border-0' : 'bg-red-100 text-red-600 border-0'}`}>
                        {insp.resolved ? 'Opgelost' : 'Open'}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{insp.units?.name ?? 'Heel pand'}</span>
                    </div>

                    {residentName && (
                      <p className="text-xs text-muted-foreground">Bewoner: <span className="font-medium text-foreground">{residentName}</span></p>
                    )}

                    <p className="text-sm">{insp.description}</p>
                    {insp.notes && <p className="text-xs text-muted-foreground">{insp.notes}</p>}

                    {insp.condition_rating && (
                      <div className="flex gap-0.5">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <Star key={n} className={`h-4 w-4 ${n <= insp.condition_rating ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/20'}`} />
                        ))}
                      </div>
                    )}
                    {insp.condition_notes && (
                      <p className="text-xs text-muted-foreground italic">{insp.condition_notes}</p>
                    )}

                    {/* Specific photo thumbnails */}
                    {specificPhotos.length > 0 && (
                      <div className="flex gap-2 flex-wrap mt-1">
                        {specificPhotos.map((f) => {
                          const url = getPhotoUrl(insp[f.key]);
                          return (
                            <a key={f.key} href={url ?? '#'} target="_blank" rel="noopener noreferrer" className="block">
                              <div className="relative h-16 w-16 rounded border overflow-hidden bg-muted">
                                {url ? (
                                  <img src={url} alt={f.label} className="h-full w-full object-cover" loading="lazy" />
                                ) : (
                                  <div className="flex items-center justify-center h-full text-xs text-muted-foreground">📷</div>
                                )}
                              </div>
                              <p className="text-[10px] text-muted-foreground mt-0.5 text-center truncate w-16">{f.label.replace('Foto ', '')}</p>
                            </a>
                          );
                        })}
                      </div>
                    )}

                    {/* Generic photos fallback */}
                    {specificPhotos.length === 0 && insp.photos && insp.photos.length > 0 && (
                      <div className="flex gap-2 mt-1">
                        {insp.photos.map((path: string, i: number) => {
                          const url = getPhotoUrl(path);
                          return (
                            <a key={i} href={url ?? '#'} target="_blank" rel="noopener noreferrer">
                              <div className="h-12 w-12 bg-muted rounded border overflow-hidden">
                                {url ? (
                                  <img src={url} alt={`Foto ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
                                ) : (
                                  <div className="flex items-center justify-center h-full text-xs text-muted-foreground">📷</div>
                                )}
                              </div>
                            </a>
                          );
                        })}
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
            );
          })}
        </div>
      )}
    </div>
  );
};

export default InspectionsTab;
