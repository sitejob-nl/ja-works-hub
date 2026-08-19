import { useState, useRef, type DragEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useHasRole } from '@/contexts/AuthContext';
import { logAudit } from '@/lib/audit';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Plus, CreditCard, Car, Award, FileText, FileCheck, File, Download, FileSignature, ClipboardCheck, GraduationCap, Camera, UserSquare, Upload, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { unwrap, unwrapDeleted } from '@/lib/db';
import { formatDate } from '@/lib/format';
import { toast } from 'sonner';
import type { Database } from '@/integrations/supabase/types';
import { allowFileDrop, getDroppedFiles } from '@/lib/file-input';

type DocType = Database['public']['Enums']['document_type'];

const typeIcons: Record<DocType, any> = {
  cv: FileSignature, pasfoto: UserSquare, onboarding_formulier: ClipboardCheck,
  id_bewijs: CreditCard, rijbewijs: Car, certificaat: Award, diploma: GraduationCap,
  contract: FileText, reglement: FileCheck, bankbewijs: CreditCard,
  loonstrook: FileText, jaaropgave: FileText, urenbrief: FileText,
  werkfoto: Camera, overig: File,
};

const typeLabels: Record<DocType, string> = {
  cv: 'CV', pasfoto: 'Pasfoto', onboarding_formulier: 'Onboarding-formulier',
  id_bewijs: 'ID Bewijs', rijbewijs: 'Rijbewijs', certificaat: 'Certificaat', diploma: 'Diploma',
  contract: 'Contract', reglement: 'Reglement', bankbewijs: 'Bankbewijs',
  loonstrook: 'Loonstrook', jaaropgave: 'Jaaropgave', urenbrief: 'Urenbrief',
  werkfoto: 'Werkfoto', overig: 'Overig',
};

const statusBadge: Record<string, string> = {
  geldig: 'bg-stat-green/10 text-stat-green border-0',
  verloopt_binnenkort: 'bg-orange-100 text-orange-600 border-0',
  verlopen: 'bg-red-100 text-red-600 border-0',
  ongeldig: 'bg-muted text-muted-foreground border-0',
};

const emptyForm = { type: 'overig' as DocType, name: '', issued_date: '', expiry_date: '', notes: '' };

const CandidateDocumentsTab = ({ candidateId }: { candidateId: string }) => {
  const orgId = useOrganizationId();
  // De DELETE-policy op documents is admin-only (ID-kopieën weggooien is onomkeerbaar
  // en AVG-gevoelig). Andere rollen krijgen de knop dus niet te zien in plaats van een
  // foutmelding achteraf. Bewerken mag wél elke interne rol.
  const canDeleteDocuments = useHasRole(['admin']);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  // Punt 3b — "We kunnen de toegevoegde documenten niet bewerken". Na uploaden waren
  // soort, naam en verloopdatum niet meer te wijzigen, en verwijderen kon ook niet.
  const [editingDoc, setEditingDoc] = useState<any | null>(null);
  const [docToDelete, setDocToDelete] = useState<any | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [file, setFile] = useState<File | null>(null);

  const { data: docs = [] } = useQuery({
    queryKey: ['documents', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase.from('documents').select('*').eq('candidate_id', candidateId).order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
  const isImagePath = (path: string | null) => {
    if (!path) return false;
    const ext = path.split('.').pop()?.toLowerCase();
    return ext ? IMAGE_EXT.includes(ext) : false;
  };

  // Bulk-genereer signed URLs voor alle image-docs in één call (TTL 1u).
  const imagePaths = (docs as Array<{ file_path: string | null }>)
    .filter((d) => isImagePath(d.file_path))
    .map((d) => d.file_path as string);

  const { data: previewMap = {} } = useQuery({
    queryKey: ['document-previews', candidateId, imagePaths.length, imagePaths.join('|')],
    queryFn: async () => {
      if (imagePaths.length === 0) return {} as Record<string, string>;
      const { data, error } = await supabase.storage
        .from('documents')
        .createSignedUrls(imagePaths, 3600);
      if (error || !data) return {} as Record<string, string>;
      const map: Record<string, string> = {};
      for (const item of data) {
        if (item.path && item.signedUrl) map[item.path] = item.signedUrl;
      }
      return map;
    },
    enabled: imagePaths.length > 0,
  });

  const openDoc = async (filePath: string | null) => {
    if (!filePath) {
      toast.error('Bestand nog niet gedownload uit bron');
      return;
    }
    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(filePath, 300);
    if (error || !data?.signedUrl) {
      toast.error(`Openen mislukt: ${error?.message ?? 'onbekend'}`);
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const selectFile = (selected: File | null) => {
    setFile(selected);
    if (selected && !form.name.trim()) {
      setForm((f) => ({ ...f, name: selected.name }));
    }
  };

  const handleFileDrop = (event: DragEvent<HTMLDivElement>) => {
    const [droppedFile] = getDroppedFiles(event);
    if (droppedFile) selectFile(droppedFile);
  };

  const add = useMutation({
    mutationFn: async () => {
      let filePath: string | null = null;
      if (file) {
        const ext = file.name.split('.').pop();
        const path = `${orgId}/${candidateId}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadErr } = await supabase.storage.from('documents').upload(path, file);
        if (uploadErr) throw uploadErr;
        filePath = path;
      }
      const { error } = await supabase.from('documents').insert({
        organization_id: orgId,
        candidate_id: candidateId,
        type: form.type,
        name: form.name,
        issued_date: form.issued_date || null,
        expiry_date: form.expiry_date || null,
        notes: form.notes || null,
        file_path: filePath,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      logAudit({ action: 'create', tableName: 'documents', recordId: candidateId, newValues: { type: form.type, name: form.name } });
      qc.invalidateQueries({ queryKey: ['documents', candidateId] });
      setAdding(false);
      setForm(emptyForm);
      setFile(null);
      toast.success('Document geüpload');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const startEdit = (doc: any) => {
    setForm({
      type: doc.type as DocType,
      name: doc.name ?? '',
      issued_date: doc.issued_date ?? '',
      expiry_date: doc.expiry_date ?? '',
      notes: doc.notes ?? '',
    });
    setFile(null);
    setEditingDoc(doc);
  };

  const save = useMutation({
    mutationFn: async () => {
      await unwrap(supabase.from('documents').update({
        type: form.type,
        name: form.name,
        issued_date: form.issued_date || null,
        expiry_date: form.expiry_date || null,
        notes: form.notes || null,
      }).eq('id', editingDoc.id));
    },
    onSuccess: () => {
      logAudit({
        action: 'update', tableName: 'documents', recordId: editingDoc.id,
        oldValues: { type: editingDoc.type, name: editingDoc.name, expiry_date: editingDoc.expiry_date },
        newValues: { type: form.type, name: form.name, expiry_date: form.expiry_date || null },
      });
      qc.invalidateQueries({ queryKey: ['documents', candidateId] });
      setEditingDoc(null);
      toast.success('Document bijgewerkt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (doc: any) => {
      // Eerst de rij: als de policy de delete weigert raakt unwrapDeleted 0 rijen en
      // gooit hij, zodat het bestand in de opslag blijft staan. Andersom zou een
      // geweigerde delete het bestand alsnog wissen.
      await unwrapDeleted(supabase.from('documents').delete().eq('id', doc.id));
      if (doc.file_path) {
        await supabase.storage.from('documents').remove([doc.file_path]);
      }
    },
    onSuccess: (_data, doc: any) => {
      logAudit({ action: 'delete', tableName: 'documents', recordId: doc.id, oldValues: { name: doc.name, type: doc.type } });
      qc.invalidateQueries({ queryKey: ['documents', candidateId] });
      setDocToDelete(null);
      toast.success('Document verwijderd');
    },
    onError: (e: any) => { setDocToDelete(null); toast.error(e.message); },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Documenten</h3>
        {/* Bewust resetten: startEdit() schrijft in dezelfde form-state, dus zonder deze
            reset opende "Nieuw document" ná een bewerksessie met de soort en naam van dát
            document — met een geüpload bestand onder de verkeerde naam als gevolg. */}
        <Button size="sm" variant="outline" onClick={() => { setForm(emptyForm); setFile(null); setAdding(true); }} className="gap-1"><Plus className="h-3.5 w-3.5" />Nieuw document</Button>
      </div>

      <Sheet open={adding} onOpenChange={setAdding}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>Nieuw document</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6">
            <div>
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm(f => ({ ...f, type: v as DocType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(typeLabels) as DocType[]).map(t => <SelectItem key={t} value={t}>{typeLabels[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Naam</Label><Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Uitgiftedatum</Label><Input type="date" value={form.issued_date} onChange={(e) => setForm(f => ({ ...f, issued_date: e.target.value }))} /></div>
              <div><Label>Verloopdatum</Label><Input type="date" value={form.expiry_date} onChange={(e) => setForm(f => ({ ...f, expiry_date: e.target.value }))} /></div>
            </div>
            <div>
              <Label>Bestand</Label>
              <div
                className="rounded-md border border-dashed border-input bg-background p-3 transition-colors hover:border-primary/60"
                onDragOver={allowFileDrop}
                onDrop={handleFileDrop}
              >
                <div className="flex items-center gap-2">
                  <Upload className="h-4 w-4 text-muted-foreground" />
                  <Input ref={fileRef} type="file" onChange={(e) => selectFile(e.target.files?.[0] ?? null)} />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {file ? `${file.name} staat klaar` : 'Sleep hier een bestand naartoe of kies een bestand.'}
                </p>
              </div>
            </div>
            <div><Label>Notities</Label><Textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} /></div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={() => setAdding(false)}>Annuleren</Button>
              <Button onClick={() => add.mutate()} disabled={!form.name || add.isPending}>{add.isPending ? 'Uploaden...' : 'Opslaan'}</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Punt 3b — bewerken van een bestaand document: soort, naam, datums, notitie.
          Het bestand zelf blijft staan; vervangen doe je met een nieuwe upload. */}
      <Sheet open={!!editingDoc} onOpenChange={(open) => { if (!open) setEditingDoc(null); }}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>Document bewerken</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6">
            <div>
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm(f => ({ ...f, type: v as DocType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(typeLabels) as DocType[]).map(t => <SelectItem key={t} value={t}>{typeLabels[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Naam</Label><Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Uitgiftedatum</Label><Input type="date" value={form.issued_date} onChange={(e) => setForm(f => ({ ...f, issued_date: e.target.value }))} /></div>
              <div><Label>Verloopdatum</Label><Input type="date" value={form.expiry_date} onChange={(e) => setForm(f => ({ ...f, expiry_date: e.target.value }))} /></div>
            </div>
            <div><Label>Notities</Label><Textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} /></div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={() => setEditingDoc(null)}>Annuleren</Button>
              <Button onClick={() => save.mutate()} disabled={!form.name || save.isPending}>{save.isPending ? 'Opslaan...' : 'Opslaan'}</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!docToDelete} onOpenChange={(open) => { if (!open) setDocToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Document verwijderen?</AlertDialogTitle>
            <AlertDialogDescription>
              "{docToDelete?.name}" wordt verwijderd, samen met het bestand. Dit is niet terug te draaien.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => remove.mutate(docToDelete)}
              className="bg-transparent border border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              Verwijderen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {docs.map((d: any) => {
          const Icon = typeIcons[d.type as DocType] ?? File;
          const hasFile = Boolean(d.file_path);
          const previewUrl = isImagePath(d.file_path) ? previewMap[d.file_path] : undefined;
          return (
            <div key={d.id} className="bg-card rounded-lg border p-3 flex gap-3 transition hover:border-primary/40 hover:shadow-sm">
            <button
              type="button"
              onClick={() => openDoc(d.file_path)}
              disabled={!hasFile}
              className="flex flex-1 min-w-0 gap-3 text-left disabled:opacity-60 disabled:cursor-not-allowed"
              title={hasFile ? 'Open document' : 'Bestand nog niet gedownload uit bron'}
            >
              <div className="h-16 w-16 rounded-md bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={d.name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <Icon className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{d.name}</p>
                <p className="text-xs text-muted-foreground">{typeLabels[d.type as DocType] ?? d.type}</p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <Badge variant="secondary" className={`text-xs ${statusBadge[d.status] ?? ''}`}>{d.status}</Badge>
                  {d.ai_verification_result && <Badge variant="outline" className="text-xs">AI geverifieerd</Badge>}
                  {!hasFile && <Badge variant="outline" className="text-xs">Geen bestand</Badge>}
                </div>
                {d.expiry_date && <p className="text-xs text-muted-foreground mt-1">Verloopt: {formatDate(d.expiry_date)}</p>}
                <p className="text-xs text-muted-foreground">Geüpload: {formatDate(d.created_at)}</p>
              </div>
              {hasFile && <Download className="h-4 w-4 text-muted-foreground shrink-0 self-start mt-1" />}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={`Acties voor ${d.name}`}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => startEdit(d)}>
                  <Pencil className="h-4 w-4 mr-2" /> Bewerken
                </DropdownMenuItem>
                {canDeleteDocuments && (
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDocToDelete(d)}>
                    <Trash2 className="h-4 w-4 mr-2" /> Verwijderen
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            </div>
          );
        })}
      </div>
      {docs.length === 0 && <p className="text-center text-muted-foreground py-8">Nog geen documenten</p>}
    </div>
  );
};

export default CandidateDocumentsTab;
