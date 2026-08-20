import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Pencil, Trash2, Building } from 'lucide-react';
import { toast } from 'sonner';
import { GuardedDialog, useDirtyForm } from '@/components/shared/UnsavedCloseGuard';
import { logAudit } from '@/lib/audit';

type Owner = {
  id: string;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
};

const emptyForm = { name: '', contact_person: '', email: '', phone: '', notes: '' };

const PropertyOwnersSettings = () => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Owner | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm, formDirty] = useDirtyForm(emptyForm);

  const { data: owners = [], isLoading } = useQuery({
    queryKey: ['property-owners', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('property_owners')
        .select('id, name, contact_person, email, phone, notes')
        .order('name');
      if (error) throw error;
      return (data ?? []) as Owner[];
    },
    enabled: !!orgId,
  });

  const { data: usageMap = {} } = useQuery({
    queryKey: ['property-owners-usage', orgId, owners.length],
    queryFn: async () => {
      if (owners.length === 0) return {} as Record<string, number>;
      const { data, error } = await supabase
        .from('properties')
        .select('owner_id')
        .not('owner_id', 'is', null);
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const p of data ?? []) {
        if (p.owner_id) map[p.owner_id] = (map[p.owner_id] ?? 0) + 1;
      }
      return map;
    },
    enabled: !!orgId && owners.length > 0,
  });

  const openCreate = () => {
    setForm(emptyForm);
    setCreating(true);
  };

  const openEdit = (o: Owner) => {
    setForm({
      name: o.name,
      contact_person: o.contact_person ?? '',
      email: o.email ?? '',
      phone: o.phone ?? '',
      notes: o.notes ?? '',
    });
    setEditing(o);
  };

  const closeAll = () => {
    setEditing(null);
    setCreating(false);
    setForm(emptyForm);
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        organization_id: orgId,
        name: form.name.trim(),
        contact_person: form.contact_person.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        notes: form.notes.trim() || null,
      };
      if (editing) {
        const { error } = await supabase.from('property_owners').update(payload).eq('id', editing.id);
        if (error) throw error;
        logAudit({ action: 'update', tableName: 'property_owners', recordId: editing.id, newValues: payload });
      } else {
        const { data, error } = await supabase.from('property_owners').insert(payload).select('id').single();
        if (error) throw error;
        logAudit({ action: 'create', tableName: 'property_owners', recordId: data.id, newValues: payload });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['property-owners'] });
      qc.invalidateQueries({ queryKey: ['property-owners-usage'] });
      toast.success(editing ? 'Eigenaar bijgewerkt' : 'Eigenaar aangemaakt');
      closeAll();
    },
    onError: (e: any) => toast.error(e.message ?? 'Opslaan mislukt'),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('property_owners').delete().eq('id', id);
      if (error) throw error;
      logAudit({ action: 'delete', tableName: 'property_owners', recordId: id });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['property-owners'] });
      qc.invalidateQueries({ queryKey: ['property-owners-usage'] });
      toast.success('Eigenaar verwijderd');
    },
    onError: (e: any) => toast.error(e.message ?? 'Verwijderen mislukt'),
  });

  const formOpen = creating || !!editing;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building className="h-4 w-4" /> Eigenaren / Verhuurders
            </CardTitle>
            <CardDescription>Beheer unieke eigenaren — gebruikt door panden in huisvesting</CardDescription>
          </div>
          <Button size="sm" onClick={openCreate} className="gap-1">
            <Plus className="h-3.5 w-3.5" /> Nieuwe eigenaar
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Laden...</p>
        ) : owners.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nog geen eigenaren.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Naam</TableHead>
                <TableHead>Contactpersoon</TableHead>
                <TableHead>Telefoon</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead className="text-right">Panden</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {owners.map((o) => {
                const usage = usageMap[o.id] ?? 0;
                return (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">{o.name}</TableCell>
                    <TableCell className="text-muted-foreground">{o.contact_person ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{o.phone ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{o.email ?? '—'}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{usage}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(o)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            if (usage > 0) {
                              toast.error(`Eigenaar wordt nog gebruikt door ${usage} pand(en)`);
                              return;
                            }
                            if (confirm(`Eigenaar "${o.name}" verwijderen?`)) remove.mutate(o.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <GuardedDialog open={formOpen} dirty={formDirty} onOpenChange={(v) => !v && closeAll()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Eigenaar bewerken' : 'Nieuwe eigenaar'}</DialogTitle>
            <DialogDescription>Wordt gekoppeld aan panden via dropdown.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-4">
            <div><Label>Naam *</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <div><Label>Contactpersoon</Label><Input value={form.contact_person} onChange={(e) => setForm((f) => ({ ...f, contact_person: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Telefoon</Label><Input type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
              <div><Label>E-mail</Label><Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
            </div>
            <div><Label>Notities</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={closeAll}>Annuleren</Button>
            <Button onClick={() => save.mutate()} disabled={!form.name.trim() || save.isPending}>
              {save.isPending ? 'Opslaan...' : editing ? 'Bijwerken' : 'Aanmaken'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </GuardedDialog>
    </Card>
  );
};

export default PropertyOwnersSettings;
