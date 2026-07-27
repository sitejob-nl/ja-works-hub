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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollText, Plus, Eye, Pencil, Paperclip, Send } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate } from '@/lib/format';
import { unwrap } from '@/lib/db';
import { qk } from '@/lib/query-keys';

const CATEGORY_LABELS: Record<string, string> = {
  algemeen: 'Algemeen',
  voertuig: 'Voertuig',
  huisvesting: 'Huisvesting',
};

/** Bij welke gebeurtenis een categorie automatisch verstuurd wordt — puur voor de uitleg in de UI. */
const CATEGORY_TRIGGER: Record<string, string> = {
  algemeen: 'wordt niet automatisch verstuurd — alleen bij onboarding',
  voertuig: 'wordt verstuurd zodra iemand een auto toegewezen krijgt',
  huisvesting: 'wordt verstuurd zodra iemand een kamer toegewezen krijgt',
};

type RegulationForm = {
  title: string;
  content: string;
  version: number;
  category: string;
  auto_send: boolean;
  requires_acknowledgement: boolean;
  file_url: string | null;
};

const emptyForm: RegulationForm = {
  title: '', content: '', version: 1,
  category: 'algemeen', auto_send: false, requires_acknowledgement: true, file_url: null,
};

const RegulationsSettings = () => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<RegulationForm>(emptyForm);
  const [viewContent, setViewContent] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

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
      // Nieuw bestand vervangt het oude pad; zonder nieuw bestand blijft file_url ongemoeid.
      let fileUrl = form.file_url;
      if (file) {
        setUploading(true);
        try {
          const ext = file.name.split('.').pop();
          const path = `${orgId}/regulations/${crypto.randomUUID()}.${ext}`;
          const { error } = await supabase.storage.from('documents').upload(path, file);
          if (error) throw error;
          fileUrl = path;
        } finally {
          setUploading(false);
        }
      }

      const payload = {
        title: form.title,
        content: form.content,
        version: form.version,
        category: form.category,
        // Alleen voertuig/huisvesting kennen een verzendmoment; 'algemeen' kan dus niet
        // per ongeluk op automatisch blijven staan na het wisselen van categorie.
        auto_send: form.category === 'algemeen' ? false : form.auto_send,
        requires_acknowledgement: form.requires_acknowledgement,
        file_url: fileUrl,
      };

      if (editing) {
        const { error } = await supabase.from('regulations').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('regulations').insert({
          organization_id: orgId,
          created_by: user?.id ?? null,
          ...payload,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['regulations'] });
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
      setFile(null);
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
    setForm({
      title: reg.title,
      content: reg.content ?? '',
      version: reg.version,
      category: reg.category ?? 'algemeen',
      auto_send: !!reg.auto_send,
      requires_acknowledgement: reg.requires_acknowledgement !== false,
      file_url: reg.file_url ?? null,
    });
    setFile(null);
    setOpen(true);
  };

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setFile(null);
    setOpen(true);
  };

  // Een reglement moet íets te tonen hebben: een PDF, of tekst.
  const hasDocument = !!file || !!form.file_url || !!form.content.trim();

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
                <TableHead>Hoort bij</TableHead>
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
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-1.5">
                      {r.title}
                      {r.file_url && <Paperclip className="h-3 w-3 text-muted-foreground" aria-label="PDF bijgevoegd" />}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-xs">{CATEGORY_LABELS[r.category] ?? r.category}</Badge>
                      {r.auto_send && (
                        <Badge
                          variant="secondary"
                          className="gap-1 border-0 bg-stat-green/10 text-xs text-stat-green"
                          title={r.requires_acknowledgement
                            ? 'Wordt automatisch verstuurd en moet bevestigd worden'
                            : 'Wordt automatisch verstuurd, ter informatie'}
                        >
                          <Send className="h-2.5 w-2.5" />
                          {r.requires_acknowledgement ? 'auto + bevestiging' : 'auto'}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
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
              <Label>Hoort bij</Label>
              <Select value={form.category} onValueChange={(v) => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">{CATEGORY_TRIGGER[form.category]}</p>
            </div>

            <div>
              <Label>Document (PDF)</Label>
              <Input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              {file
                ? <p className="mt-1 text-xs text-muted-foreground">Nieuw bestand: {file.name}</p>
                : form.file_url
                  ? <p className="mt-1 text-xs text-muted-foreground">Er staat al een PDF. Kies een bestand om die te vervangen.</p>
                  : <p className="mt-1 text-xs text-muted-foreground">Nog geen PDF. Zonder PDF wordt de tekst hieronder getoond.</p>}
            </div>

            <div>
              <Label>Inhoud {form.file_url || file ? '(optionele toelichting bij de PDF)' : ''}</Label>
              <Textarea
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                rows={form.file_url || file ? 4 : 12}
                placeholder={form.file_url || file
                  ? 'Korte toelichting in de mail, bijvoorbeeld waaróm ze dit krijgen...'
                  : 'Volledige tekst van het reglement...'}
              />
            </div>

            {form.category !== 'algemeen' && (
              <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Label htmlFor="auto-send">Automatisch meesturen</Label>
                    <p className="text-xs text-muted-foreground">{CATEGORY_TRIGGER[form.category]}.</p>
                  </div>
                  <Switch
                    id="auto-send"
                    checked={form.auto_send}
                    onCheckedChange={(v) => setForm(f => ({ ...f, auto_send: v }))}
                  />
                </div>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Label htmlFor="requires-ack">Bevestiging vereist</Label>
                    <p className="text-xs text-muted-foreground">
                      Ontvanger moet het document doorlopen tot de laatste pagina en bevestigen.
                      Uit = alleen ter informatie meesturen.
                    </p>
                  </div>
                  <Switch
                    id="requires-ack"
                    checked={form.requires_acknowledgement}
                    onCheckedChange={(v) => setForm(f => ({ ...f, requires_acknowledgement: v }))}
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Annuleren</Button>
              <Button onClick={() => save.mutate()} disabled={!form.title || !hasDocument || save.isPending || uploading}>
                {uploading ? 'Uploaden...' : save.isPending ? 'Opslaan...' : 'Opslaan'}
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
