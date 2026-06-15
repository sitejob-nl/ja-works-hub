import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { ScrollText, Plus, Eye, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate } from '@/lib/format';
import { unwrap } from '@/lib/db';
import { qk } from '@/lib/query-keys';

const RegulationsSettings = () => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ title: '', content: '', version: 1 });
  const [viewContent, setViewContent] = useState<string | null>(null);

  const { data: regulations = [] } = useQuery({
    queryKey: qk.regulations.list(orgId),
    queryFn: () => unwrap(
      supabase
        .from('regulations')
        .select('*, regulation_acknowledgements(count)')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false }),
    ),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        const { error } = await supabase.from('regulations')
          .update({ title: form.title, content: form.content, version: form.version })
          .eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('regulations').insert({
          organization_id: orgId,
          title: form.title,
          content: form.content,
          version: form.version,
          created_by: user?.id ?? null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['regulations'] });
      setOpen(false);
      setEditing(null);
      setForm({ title: '', content: '', version: 1 });
      toast.success(editing ? 'Reglement bijgewerkt' : 'Reglement aangemaakt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('regulations').update({ is_active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['regulations'] });
      toast.success('Status bijgewerkt');
    },
  });

  const openEdit = (reg: any) => {
    setEditing(reg);
    setForm({ title: reg.title, content: reg.content, version: reg.version });
    setOpen(true);
  };

  const openNew = () => {
    setEditing(null);
    setForm({ title: '', content: '', version: 1 });
    setOpen(true);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ScrollText className="h-4 w-4" /> Reglementen
            </CardTitle>
            <CardDescription>Beheer bedrijfsreglementen die medewerkers moeten tekenen</CardDescription>
          </div>
          <Button size="sm" onClick={openNew} className="gap-1">
            <Plus className="h-3.5 w-3.5" /> Nieuw reglement
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {regulations.length === 0 ? (
          <p className="text-center text-muted-foreground py-6">Nog geen reglementen aangemaakt</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Titel</TableHead>
                <TableHead>Versie</TableHead>
                <TableHead>Getekend</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Aangemaakt</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {regulations.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell>v{r.version}</TableCell>
                  <TableCell>{r.regulation_acknowledgements?.[0]?.count ?? 0}×</TableCell>
                  <TableCell>
                    <Switch
                      checked={r.is_active}
                      onCheckedChange={(v) => toggleActive.mutate({ id: r.id, is_active: v })}
                    />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(r.created_at)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => setViewContent(r.content)}>
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => openEdit(r)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Edit/Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Reglement bewerken' : 'Nieuw reglement'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <Label>Titel</Label>
                <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Huisreglement" />
              </div>
              <div>
                <Label>Versie</Label>
                <Input type="number" min={1} value={form.version} onChange={e => setForm(f => ({ ...f, version: parseInt(e.target.value) || 1 }))} />
              </div>
            </div>
            <div>
              <Label>Inhoud</Label>
              <Textarea
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                rows={12}
                placeholder="Volledige tekst van het reglement..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Annuleren</Button>
              <Button onClick={() => save.mutate()} disabled={!form.title || !form.content || save.isPending}>
                {save.isPending ? 'Opslaan...' : 'Opslaan'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* View dialog */}
      <Dialog open={!!viewContent} onOpenChange={() => setViewContent(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Inhoud reglement</DialogTitle>
          </DialogHeader>
          <div className="whitespace-pre-wrap text-sm">{viewContent}</div>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default RegulationsSettings;
