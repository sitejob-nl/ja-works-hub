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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { FileText, Plus, Eye, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate } from '@/lib/format';

const MERGE_FIELDS = [
  '{{employee_name}}', '{{employee_number}}', '{{start_date}}', '{{end_date}}',
  '{{function_name}}', '{{hourly_rate}}', '{{contract_hours}}', '{{contract_type}}',
  '{{company_name}}', '{{organization_name}}', '{{today}}',
];

const ContractTemplatesSettings = () => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: '', content: '' });

  const { data: templates = [] } = useQuery({
    queryKey: ['contract-templates', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contract_templates')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        const { error } = await supabase.from('contract_templates')
          .update({ name: form.name, content: form.content })
          .eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('contract_templates').insert({
          organization_id: orgId,
          name: form.name,
          content: form.content,
          created_by: user?.id ?? null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contract-templates'] });
      setOpen(false);
      setEditing(null);
      setForm({ name: '', content: '' });
      toast.success(editing ? 'Template bijgewerkt' : 'Template aangemaakt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('contract_templates').update({ is_active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contract-templates'] });
      toast.success('Status bijgewerkt');
    },
  });

  const openEdit = (t: any) => {
    setEditing(t);
    setForm({ name: t.name, content: t.content });
    setOpen(true);
  };

  const openNew = () => {
    setEditing(null);
    setForm({ name: '', content: '' });
    setOpen(true);
  };

  const insertField = (field: string) => {
    setForm(f => ({ ...f, content: f.content + field }));
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" /> Contracttemplates
            </CardTitle>
            <CardDescription>Maak templates met merge fields voor contractgeneratie</CardDescription>
          </div>
          <Button size="sm" onClick={openNew} className="gap-1">
            <Plus className="h-3.5 w-3.5" /> Nieuw template
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {templates.length === 0 ? (
          <p className="text-center text-muted-foreground py-6">Nog geen templates aangemaakt</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Naam</TableHead>
                <TableHead>Actief</TableHead>
                <TableHead>Aangemaakt</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t: any) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell>
                    <Switch checked={t.is_active} onCheckedChange={(v) => toggleActive.mutate({ id: t.id, is_active: v })} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(t.created_at)}</TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" onClick={() => openEdit(t)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Template bewerken' : 'Nieuw contracttemplate'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Naam</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Standaard uitzendovereenkomst" />
            </div>
            <div>
              <Label>Merge fields</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {MERGE_FIELDS.map(f => (
                  <Button key={f} size="sm" variant="outline" className="text-xs h-7" onClick={() => insertField(f)}>
                    {f}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <Label>Inhoud</Label>
              <Textarea
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                rows={16}
                className="font-mono text-xs"
                placeholder="UITZENDOVEREENKOMST&#10;&#10;Ondergetekenden:&#10;{{organization_name}}, hierna te noemen 'werkgever'&#10;en&#10;{{employee_name}}, hierna te noemen 'werknemer'&#10;&#10;zijn het volgende overeengekomen:&#10;..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Annuleren</Button>
              <Button onClick={() => save.mutate()} disabled={!form.name || !form.content || save.isPending}>
                {save.isPending ? 'Opslaan...' : 'Opslaan'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default ContractTemplatesSettings;
