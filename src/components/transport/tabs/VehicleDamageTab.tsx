import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { formatDate, formatEUR } from '@/lib/format';
import { Plus, ShieldAlert, CheckCircle2, Bell, MoreHorizontal, Pencil, Trash2, RotateCcw } from 'lucide-react';
import { logAudit } from '@/lib/audit';
import { EntityLink } from '@/components/ui/entity-link';
import { PhoneLink } from '@/components/ui/contact-links';
import { MailButton } from '@/components/ui/mail-button';
import { DAMAGE_ROUTE_STATUS_LABELS, DAMAGE_TYPES, damageTypeIsUrgent, damageTypeLabel } from '@/lib/damage';
import { normalizeDamageContactSettings } from '@/lib/engagement';

const typeBadgeClass: Record<string, string> = {
  lekke_band: 'bg-orange-100 text-orange-700 border-0',
  motorstoring: 'bg-yellow-100 text-yellow-700 border-0',
  dashboardlampje: 'bg-yellow-100 text-yellow-700 border-0',
  pech_stilstand: 'bg-destructive/10 text-destructive border-0',
  ongeval: 'bg-destructive/10 text-destructive border-0',
  carrosserie: 'bg-orange-100 text-orange-700 border-0',
  schade_exterieur: 'bg-orange-100 text-orange-700 border-0',
  schade_interieur: 'bg-orange-100 text-orange-700 border-0',
  ruitschade: 'bg-orange-100 text-orange-700 border-0',
  onderhoud: 'bg-blue-100 text-blue-700 border-0',
  overig: 'bg-muted text-muted-foreground border-0',
};

const assignableEmployeeStatuses = new Set(['onboarding', 'actief', 'ziek']);
const isStoredUrl = (path: string) => /^https?:\/\//i.test(path);

const VehicleDamageTab = ({ vehicle }: { vehicle: any }) => {
  const orgId = useOrganizationId();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingReport, setEditingReport] = useState<any | null>(null);
  const [reportToDelete, setReportToDelete] = useState<any | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const { data: reports = [] } = useQuery({
    queryKey: ['vehicle-damage', vehicle.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicle_damage_reports')
        .select('*, employees(id, candidates(first_name, last_name, phone, email))')
        .eq('vehicle_id', vehicle.id)
        .order('reported_at', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const damagePhotoPaths = useMemo(
    () => Array.from(new Set(reports.flatMap((report: any) => ((report.photos ?? []) as string[]).filter(Boolean)))),
    [reports]
  );

  const { data: damagePhotoUrls = {} } = useQuery({
    queryKey: ['vehicle-damage-photo-urls', vehicle.id, damagePhotoPaths],
    queryFn: async () => {
      const entries = await Promise.all(
        damagePhotoPaths.map(async (path) => {
          if (isStoredUrl(path)) return [path, path] as const;
          const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 60 * 10);
          if (error) return [path, null] as const;
          return [path, data.signedUrl] as const;
        })
      );
      return Object.fromEntries(entries.filter(([, url]) => Boolean(url))) as Record<string, string>;
    },
    enabled: damagePhotoPaths.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const { data: org } = useQuery({
    queryKey: ['damage-contact-settings', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('organizations').select('settings').eq('id', orgId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
  });

  const damageSettings = normalizeDamageContactSettings((org?.settings as any)?.damage_contact_settings);
  const canSeeDriverContact = damageSettings.show_driver_contact_to_roles.includes(profile?.role ?? '');

  const resolveMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('vehicle_damage_reports')
        .update({ resolved: true, resolved_at: new Date().toISOString() } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vehicle-damage', vehicle.id] }); toast.success('Markeerd als opgelost'); },
  });

  const reopenMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('vehicle_damage_reports')
        .update({ resolved: false, resolved_at: null } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['vehicle-damage', vehicle.id] });
      logAudit({ action: 'status_change', tableName: 'vehicle_damage_reports', recordId: id, newValues: { resolved: false } });
      toast.success('Schademelding heropend');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (r: any) => {
      // Best-effort photo cleanup
      if (r.photos && r.photos.length > 0) {
        await supabase.storage.from('documents').remove(r.photos);
      }
      const { error } = await supabase.from('vehicle_damage_reports').delete().eq('id', r.id);
      if (error) throw error;
      return r;
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['vehicle-damage', vehicle.id] });
      logAudit({ action: 'delete', tableName: 'vehicle_damage_reports', recordId: r.id });
      toast.success('Schademelding verwijderd');
      setReportToDelete(null);
    },
    onError: (e: any) => { toast.error(e.message); setReportToDelete(null); },
  });

  const notifyGarageMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error: fnErr } = await supabase.functions.invoke('send-damage-report', {
        body: { report_id: id },
      });
      if (fnErr) {
        const msg = (data as any)?.error ?? fnErr.message;
        throw new Error(msg);
      }
      const { error } = await supabase.from('vehicle_damage_reports')
        .update({ garage_notified: true, garage_notified_at: new Date().toISOString(), route_status: 'internal_notified' } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vehicle-damage', vehicle.id] }); toast.success('Interne regie geïnformeerd'); },
    onError: (e: any) => toast.error(`Notificatie mislukt: ${e.message}`),
  });

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
          const typeLabel = damageTypeLabel(r.damage_type);

          return (
            <Card key={r.id}>
              <CardContent className="pt-5 pb-4 space-y-3">
                {/* Header */}
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{formatDate(r.reported_at)}</span>
                  <span className="text-muted-foreground">·</span>
                  <EntityLink type="employee" id={r.employees?.id}>{empName}</EntityLink>
                  <Badge variant="secondary" className={typeBadgeClass[r.damage_type] ?? typeBadgeClass.overig}>{typeLabel}</Badge>
                  {r.urgency === 'urgent' && <Badge variant="secondary" className="bg-destructive/10 text-destructive border-0">Urgent</Badge>}
                  <Badge variant="outline">{DAMAGE_ROUTE_STATUS_LABELS[r.route_status] ?? r.route_status ?? 'Interne regie'}</Badge>
                  <Badge variant="secondary" className={r.resolved ? 'bg-primary/10 text-stat-blue border-0' : 'bg-destructive/10 text-destructive border-0'}>
                    {r.resolved ? 'Opgelost' : 'Open'}
                  </Badge>
                </div>

                {/* Description */}
                <p className="text-sm">{r.description}</p>
                {canSeeDriverContact && emp && (
                  <p className="text-xs text-muted-foreground inline-flex flex-wrap items-center gap-1">
                    Contact bestuurder: <PhoneLink phone={emp.phone} />{emp.email && <><span>·</span><MailButton email={emp.email} asText /></>}
                  </p>
                )}

                {/* Photos */}
                {r.photos && r.photos.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {r.photos.map((p: string, i: number) => (
                      <button
                        key={p}
                        onClick={() => {
                          const url = damagePhotoUrls[p];
                          if (!url) {
                            toast.error('Foto wordt nog geladen of is niet beschikbaar');
                            return;
                          }
                          setLightbox(url);
                        }}
                        className="h-16 w-16 rounded-md overflow-hidden border bg-muted hover:ring-2 hover:ring-ring"
                        title={`Schadefoto ${i + 1} openen`}
                      >
                        {damagePhotoUrls[p] ? (
                          <img src={damagePhotoUrls[p]} alt={`Schade ${i + 1}`} className="h-full w-full object-cover" />
                        ) : (
                          <div className="h-full w-full animate-pulse bg-muted" />
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {/* Cost */}
                {r.cost_estimate != null && (
                  <p className="text-sm text-muted-foreground">Geschatte kosten: <span className="font-medium text-foreground">{formatEUR(r.cost_estimate)}</span></p>
                )}

                {/* Internal routing */}
                {r.garage_notified || r.route_status === 'internal_notified' ? (
                  <p className="text-xs text-stat-blue">✓ Interne regie geïnformeerd op {formatDate(r.garage_notified_at)}</p>
                ) : (
                  !r.resolved && (
                    <Button size="sm" variant="outline" onClick={() => notifyGarageMutation.mutate(r.id)}>
                      <Bell className="h-3.5 w-3.5 mr-1" /> Interne regie informeren
                    </Button>
                  )
                )}

                {/* Resolution notes */}
                {r.resolution_notes && <p className="text-xs text-muted-foreground bg-muted rounded p-2">{r.resolution_notes}</p>}

                {/* Actions */}
                <div className="flex items-center gap-1 flex-wrap">
                  {!r.resolved ? (
                    <Button size="sm" variant="outline" onClick={() => resolveMutation.mutate(r.id)}>
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Markeer als opgelost
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => reopenMutation.mutate(r.id)}>
                      <RotateCcw className="h-3.5 w-3.5 mr-1" /> Heropenen
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-8 w-8 ml-auto"><MoreHorizontal className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setEditingReport(r)}>
                        <Pencil className="h-3.5 w-3.5 mr-2" /> Bewerken
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setReportToDelete(r)} className="text-destructive">
                        <Trash2 className="h-3.5 w-3.5 mr-2" /> Verwijderen
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}

      {/* Lightbox */}
      <Dialog open={!!lightbox} onOpenChange={() => setLightbox(null)}>
        <DialogContent className="max-w-2xl p-2">
          <DialogTitle className="sr-only">Schade foto</DialogTitle>
          {lightbox && <img src={lightbox} alt="Schade foto" className="w-full rounded" />}
        </DialogContent>
      </Dialog>

      {/* New report sheet */}
      <DamageSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        vehicleId={vehicle.id}
        orgId={orgId}
        defaultInternalEmail={damageSettings.internal_email}
        onDone={() => qc.invalidateQueries({ queryKey: ['vehicle-damage', vehicle.id] })}
      />

      {/* Edit existing report sheet */}
      <DamageSheet
        open={!!editingReport}
        onOpenChange={(o) => { if (!o) setEditingReport(null); }}
        vehicleId={vehicle.id}
        orgId={orgId}
        defaultInternalEmail={damageSettings.internal_email}
        onDone={() => qc.invalidateQueries({ queryKey: ['vehicle-damage', vehicle.id] })}
        existing={editingReport}
      />

      <AlertDialog open={!!reportToDelete} onOpenChange={(o) => { if (!o) setReportToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Schademelding verwijderen?</AlertDialogTitle>
            <AlertDialogDescription>
              Verwijdert de melding van {reportToDelete && formatDate(reportToDelete.reported_at)}
              {reportToDelete?.photos?.length > 0 && ` inclusief ${reportToDelete.photos.length} foto's uit de opslag`}.
              Deze actie kan niet ongedaan worden gemaakt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (reportToDelete) deleteMutation.mutate(reportToDelete); }}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Verwijderen...' : 'Verwijderen'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

/* ─── Damage Sheet (create + edit) ─────────────────────── */

const DamageSheet = ({ open, onOpenChange, vehicleId, orgId, onDone, existing, defaultInternalEmail }: {
  open: boolean; onOpenChange: (o: boolean) => void; vehicleId: string; orgId: string | null; onDone: () => void;
  existing?: any; defaultInternalEmail?: string | null;
}) => {
  const isEdit = !!existing;
  const [form, setForm] = useState({ employee_id: '', damage_type: 'overig', description: '', internal_contact_email: '', external_contact_email: '', cost_estimate: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  // Pre-fill form when opening in edit mode
  useEffect(() => {
    if (!open) return;
    if (existing) {
      setForm({
        employee_id: existing.employee_id ?? '',
        damage_type: existing.damage_type ?? 'overig',
        description: existing.description ?? '',
        internal_contact_email: existing.internal_contact_email ?? existing.garage_email ?? '',
        external_contact_email: existing.external_contact_email ?? '',
        cost_estimate: existing.cost_estimate != null ? String(existing.cost_estimate) : '',
      });
    } else {
      setForm({ employee_id: '', damage_type: 'overig', description: '', internal_contact_email: defaultInternalEmail ?? '', external_contact_email: '', cost_estimate: '' });
    }
    setFiles([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.id, defaultInternalEmail]);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const { data: employees = [] } = useQuery({
    queryKey: ['damage-assignable-employees', orgId, existing?.employee_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees')
        .select('id, candidate_id, status, candidates!employees_candidate_id_fkey(first_name, last_name, employee_status, employee_number)')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return ((data ?? []) as any[])
        .filter((employee) => {
          const status = employee.candidates?.employee_status ?? employee.status;
          return assignableEmployeeStatuses.has(status) || employee.id === existing?.employee_id;
        })
        .sort((a, b) => {
          const aName = `${a.candidates?.last_name ?? ''} ${a.candidates?.first_name ?? ''}`.trim();
          const bName = `${b.candidates?.last_name ?? ''} ${b.candidates?.first_name ?? ''}`.trim();
          return aName.localeCompare(bName, 'nl');
        });
    },
    enabled: !!orgId && open,
  });

  const handleSave = async (notifyGarage: boolean) => {
    if (!orgId || !form.employee_id || !form.description) return;
    const existingPhotoCount = isEdit ? ((existing?.photos ?? []) as string[]).length : 0;
    if (existingPhotoCount + files.length === 0) {
      toast.error('Voeg minimaal één foto toe aan de schademelding');
      return;
    }
    setSaving(true);

    try {
      // Upload nieuwe foto's
      const newPhotoPaths: string[] = [];
      for (const file of files) {
        const ext = file.name.split('.').pop() ?? 'jpg';
        const path = `${orgId}/damage/${vehicleId}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from('documents').upload(path, file);
        if (error) throw error;
        newPhotoPaths.push(path);
      }

      const selectedEmployee = employees.find((employee: any) => employee.id === form.employee_id) as any;

      const corePayload: any = {
        employee_id: form.employee_id,
        candidate_id: selectedEmployee?.candidate_id ?? existing?.candidate_id ?? null,
        damage_type: form.damage_type,
        description: form.description,
        garage_email: form.internal_contact_email || null,
        internal_contact_email: form.internal_contact_email || null,
        external_contact_email: form.external_contact_email || null,
        contact_route: 'internal_fleet',
        route_status: 'pending_internal',
        urgency: damageTypeIsUrgent(form.damage_type) ? 'urgent' : 'normal',
        contact_phone_shared: false,
        cost_estimate: form.cost_estimate ? parseFloat(form.cost_estimate) : null,
      };

      let reportId: string | null = null;

      if (isEdit && existing) {
        // Append nieuwe foto's aan bestaande array
        const existingPhotos: string[] = (existing.photos ?? []) as string[];
        const updatePayload = {
          ...corePayload,
          photos: [...existingPhotos, ...newPhotoPaths],
        };
        const { error } = await supabase.from('vehicle_damage_reports').update(updatePayload).eq('id', existing.id);
        if (error) throw error;
        reportId = existing.id;
        logAudit({ action: 'update', tableName: 'vehicle_damage_reports', recordId: existing.id });
      } else {
        const insertPayload = {
          ...corePayload,
          organization_id: orgId,
          vehicle_id: vehicleId,
          photos: newPhotoPaths,
          garage_notified: false,
          garage_notified_at: null,
        };
        const { data: inserted, error } = await supabase.from('vehicle_damage_reports').insert(insertPayload).select('id').single();
        if (error) throw error;
        reportId = inserted?.id ?? null;
        logAudit({ action: 'create', tableName: 'vehicle_damage_reports', recordId: reportId ?? 'new' });
      }

      if (notifyGarage && reportId && form.internal_contact_email) {
        const { data: notifyData, error: notifyErr } = await supabase.functions.invoke('send-damage-report', {
          body: { report_id: reportId, target: 'internal' },
        });
        if (notifyErr) {
          toast.error(`Interne melding mislukt: ${(notifyData as any)?.error ?? notifyErr.message}`);
        } else {
          await supabase.from('vehicle_damage_reports')
            .update({ garage_notified: true, garage_notified_at: new Date().toISOString(), route_status: 'internal_notified' } as any)
            .eq('id', reportId);
          toast.info(`Interne melding verstuurd naar ${form.internal_contact_email}`);
        }
      }

      toast.success(isEdit ? 'Schademelding bijgewerkt' : 'Schademelding opgeslagen');
      onDone();
      onOpenChange(false);
      setForm({ employee_id: '', damage_type: 'overig', description: '', internal_contact_email: defaultInternalEmail ?? '', external_contact_email: '', cost_estimate: '' });
      setFiles([]);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const hasPhotoEvidence = (isEdit && ((existing?.photos ?? []) as string[]).length > 0) || files.length > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader><SheetTitle>{isEdit ? 'Schademelding bewerken' : 'Nieuwe schademelding'}</SheetTitle></SheetHeader>
        <div className="space-y-4 mt-6">
          <div>
            <Label>Medewerker *</Label>
            <Select value={form.employee_id} onValueChange={v => set('employee_id', v)}>
              <SelectTrigger><SelectValue placeholder="Selecteer medewerker" /></SelectTrigger>
              <SelectContent>
                {employees.map((e: any) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.candidates?.first_name} {e.candidates?.last_name}
                    {e.candidates?.employee_number ? ` #${e.candidates.employee_number}` : ''}
                  </SelectItem>
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
            <Label>{isEdit ? "Extra foto's toevoegen (minimaal 1 totaal)" : "Foto's * (max 4)"}</Label>
            <Input type="file" accept="image/*" multiple onChange={e => {
              const selected = Array.from(e.target.files ?? []).slice(0, 4);
              setFiles(selected);
            }} />
            {files.length > 0 && <p className="text-xs text-muted-foreground mt-1">{files.length} bestand(en) geselecteerd</p>}
            {isEdit && existing?.photos?.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">{existing.photos.length} bestaande foto('s) blijven bewaard.</p>
            )}
            {!hasPhotoEvidence && <p className="text-xs text-destructive mt-1">Minimaal één foto is verplicht.</p>}
          </div>

          <div>
            <Label>Interne melding naar (optioneel)</Label>
            <Input type="email" value={form.internal_contact_email} onChange={e => set('internal_contact_email', e.target.value)} placeholder="fleet@bedrijf.nl" />
            <p className="text-xs text-muted-foreground mt-1">Default is interne regie; bestuurdergegevens worden niet automatisch extern gedeeld.</p>
          </div>

          <div>
            <Label>Extern contact voor opvolging (optioneel)</Label>
            <Input type="email" value={form.external_contact_email} onChange={e => set('external_contact_email', e.target.value)} placeholder="garage@voorbeeld.nl" />
          </div>

          <div>
            <Label>Geschatte kosten (€)</Label>
            <Input type="number" value={form.cost_estimate} onChange={e => set('cost_estimate', e.target.value)} placeholder="0.00" />
          </div>

          <div className="flex flex-col gap-2 pt-4">
            <Button onClick={() => handleSave(false)} disabled={!form.employee_id || !form.description || !hasPhotoEvidence || saving}>
              {saving ? 'Opslaan...' : 'Opslaan'}
            </Button>
            {form.internal_contact_email && (
              <Button variant="outline" onClick={() => handleSave(true)} disabled={!form.employee_id || !form.description || !hasPhotoEvidence || saving}>
                <Bell className="h-4 w-4 mr-1" /> Opslaan & interne regie informeren
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default VehicleDamageTab;
