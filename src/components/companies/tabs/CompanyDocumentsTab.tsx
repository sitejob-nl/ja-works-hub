import { useState, useRef, useMemo, type DragEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { unwrap, unwrapDeleted, unwrapList } from '@/lib/db';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Plus, FileText, File, FileCheck, FileSignature, Download, Upload, MoreHorizontal, Pencil, Trash2,
  ClipboardList, Ruler, Euro, Briefcase,
} from 'lucide-react';
import { formatDate } from '@/lib/format';
import { toast } from 'sonner';
import { allowFileDrop, getDroppedFiles } from '@/lib/file-input';
import type { Database } from '@/integrations/supabase/types';

type DocType = Database['public']['Enums']['document_type'];

type CompanyDocumentType = {
  id: string;
  key: string;
  label: string;
  legacy_document_type: DocType | null;
  sort_order: number;
  is_active: boolean;
};

// Iconen per bekende sleutel; een org-toegevoegd type zonder match valt terug op File.
const TYPE_ICONS: Record<string, any> = {
  contract: FileSignature,
  reglement: FileCheck,
  certificaat: FileText,
  overig: File,
  inventarisatie_formulier: ClipboardList,
  tekeningen: Ruler,
  financieel: Euro,
  vacatures: Briefcase,
};

const statusBadge: Record<string, string> = {
  geldig: 'bg-stat-green/10 text-stat-green border-0',
  verloopt_binnenkort: 'bg-orange-100 text-orange-600 border-0',
  verlopen: 'bg-red-100 text-red-600 border-0',
  ongeldig: 'bg-muted text-muted-foreground border-0',
};

const emptyForm = { typeId: '', name: '', issued_date: '', expiry_date: '', notes: '' };

const CompanyDocumentsTab = ({ companyId }: { companyId: string }) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  // Zelfde afweging als bij kandidaatdocumenten: de DELETE-policy is admin-only.
  const canDeleteDocuments = useHasRole(['admin']);

  const [adding, setAdding] = useState(false);
  const [editingDoc, setEditingDoc] = useState<any | null>(null);
  const [docToDelete, setDocToDelete] = useState<any | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [file, setFile] = useState<File | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const { data: types = [] } = useQuery({
    queryKey: ['company-document-types', orgId],
    queryFn: () => unwrapList<CompanyDocumentType>(
      supabase.from('company_document_types')
        .select('id, key, label, legacy_document_type, sort_order, is_active')
        .eq('organization_id', orgId)
        .order('sort_order'),
    ),
  });
  const activeTypes = useMemo(() => types.filter((t) => t.is_active), [types]);
  // Documenten van vóór dit ticket dragen alleen het oude enum-type; die
  // resolven we via de geseedde catalogusrij met dezelfde legacy_document_type.
  const legacyTypeMap = useMemo(
    () => new Map(types.filter((t) => t.legacy_document_type).map((t) => [t.legacy_document_type as DocType, t])),
    [types],
  );
  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
  const resolveType = (doc: any): CompanyDocumentType | undefined =>
    (doc.company_document_type_id && typeById.get(doc.company_document_type_id)) || legacyTypeMap.get(doc.type);

  const { data: docs = [] } = useQuery({
    queryKey: ['company-documents', companyId],
    queryFn: () => unwrapList<any>(
      supabase.from('documents').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
    ),
  });

  const filteredDocs = useMemo(
    () => (typeFilter === 'all' ? docs : docs.filter((d: any) => resolveType(d)?.id === typeFilter)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resolveType leunt op types/legacyTypeMap/typeById, al in deps
    [docs, typeFilter, types],
  );

  const openDoc = async (filePath: string | null) => {
    if (!filePath) {
      toast.error('Er hangt geen bestand aan dit document');
      return;
    }
    const { data, error } = await supabase.storage.from('documents').createSignedUrl(filePath, 300);
    if (error || !data?.signedUrl) {
      toast.error(`Openen mislukt: ${error?.message ?? 'onbekend'}`);
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const selectFile = (selected: File | null) => {
    setFile(selected);
    if (selected && !form.name.trim()) setForm((f) => ({ ...f, name: selected.name }));
  };

  const handleFileDrop = (event: DragEvent<HTMLDivElement>) => {
    const [droppedFile] = getDroppedFiles(event);
    if (droppedFile) selectFile(droppedFile);
  };

  const add = useMutation({
    mutationFn: async () => {
      const selectedType = typeById.get(form.typeId);
      if (!selectedType) throw new Error('Kies een documenttype');
      let filePath: string | null = null;
      if (file) {
        const ext = file.name.split('.').pop();
        // Eigen padsegment 'companies': de opslagcontrole geeft interne rollen toegang
        // tot de hele org-map, terwijl portaal- en facility-rollen alleen bij hun eigen
        // categorieën komen. Bedrijfsdocumenten blijven daarmee intern.
        const path = `${orgId}/companies/${companyId}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadErr } = await supabase.storage.from('documents').upload(path, file);
        if (uploadErr) throw uploadErr;
        filePath = path;
      }
      await unwrap(supabase.from('documents').insert({
        organization_id: orgId,
        company_id: companyId,
        candidate_id: null,
        type: selectedType.legacy_document_type,
        company_document_type_id: selectedType.id,
        name: form.name,
        issued_date: form.issued_date || null,
        expiry_date: form.expiry_date || null,
        notes: form.notes || null,
        file_path: filePath,
      }).select('id').single());
    },
    onSuccess: () => {
      const selectedType = typeById.get(form.typeId);
      logAudit({ action: 'create', tableName: 'documents', recordId: companyId, newValues: { type: selectedType?.label, name: form.name } });
      qc.invalidateQueries({ queryKey: ['company-documents', companyId] });
      setAdding(false);
      setForm(emptyForm);
      setFile(null);
      toast.success('Document toegevoegd');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const startEdit = (doc: any) => {
    setForm({
      typeId: resolveType(doc)?.id ?? '',
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
      const selectedType = typeById.get(form.typeId);
      if (!selectedType) throw new Error('Kies een documenttype');
      await unwrap(supabase.from('documents').update({
        type: selectedType.legacy_document_type,
        company_document_type_id: selectedType.id,
        name: form.name,
        issued_date: form.issued_date || null,
        expiry_date: form.expiry_date || null,
        notes: form.notes || null,
      }).eq('id', editingDoc.id));
    },
    onSuccess: () => {
      const selectedType = typeById.get(form.typeId);
      logAudit({ action: 'update', tableName: 'documents', recordId: editingDoc.id, newValues: { type: selectedType?.label, name: form.name } });
      qc.invalidateQueries({ queryKey: ['company-documents', companyId] });
      setEditingDoc(null);
      toast.success('Document bijgewerkt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (doc: any) => {
      await unwrapDeleted(supabase.from('documents').delete().eq('id', doc.id));
      if (doc.file_path) await supabase.storage.from('documents').remove([doc.file_path]);
    },
    onSuccess: (_data, doc: any) => {
      logAudit({ action: 'delete', tableName: 'documents', recordId: doc.id, oldValues: { name: doc.name } });
      qc.invalidateQueries({ queryKey: ['company-documents', companyId] });
      setDocToDelete(null);
      toast.success('Document verwijderd');
    },
    onError: (e: any) => { setDocToDelete(null); toast.error(e.message); },
  });

  const typeSelect = (
    <div>
      <Label>Type</Label>
      <Select value={form.typeId} onValueChange={(v) => setForm((f) => ({ ...f, typeId: v }))}>
        <SelectTrigger><SelectValue placeholder="Kies een documenttype" /></SelectTrigger>
        <SelectContent>
          {activeTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  const fields = (
    <div className="space-y-4">
      {typeSelect}
      <div><Label>Naam</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><Label>Ingangsdatum</Label><Input type="date" value={form.issued_date} onChange={(e) => setForm((f) => ({ ...f, issued_date: e.target.value }))} /></div>
        <div><Label>Verloopdatum</Label><Input type="date" value={form.expiry_date} onChange={(e) => setForm((f) => ({ ...f, expiry_date: e.target.value }))} /></div>
      </div>
      <div><Label>Notities</Label><Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={3} /></div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <h3 className="font-medium">Documenten</h3>
        <div className="flex items-center gap-2">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Alle types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle types</SelectItem>
              {types.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => { setForm(emptyForm); setFile(null); setAdding(true); }} className="gap-1">
            <Plus className="h-3.5 w-3.5" />Nieuw document
          </Button>
        </div>
      </div>

      <Sheet open={adding} onOpenChange={setAdding}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>Nieuw document</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6">
            {fields}
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
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={() => setAdding(false)}>Annuleren</Button>
              <Button onClick={() => add.mutate()} disabled={!form.name || !form.typeId || add.isPending}>
                {add.isPending ? 'Uploaden...' : 'Opslaan'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={!!editingDoc} onOpenChange={(open) => { if (!open) setEditingDoc(null); }}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>Document bewerken</SheetTitle></SheetHeader>
          <div className="mt-6">{fields}</div>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="ghost" onClick={() => setEditingDoc(null)}>Annuleren</Button>
            <Button onClick={() => save.mutate()} disabled={!form.name || !form.typeId || save.isPending}>
              {save.isPending ? 'Opslaan...' : 'Opslaan'}
            </Button>
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
        {filteredDocs.map((d: any) => {
          const docType = resolveType(d);
          const Icon = TYPE_ICONS[docType?.key ?? ''] ?? File;
          const hasFile = Boolean(d.file_path);
          return (
            <div key={d.id} className="bg-card rounded-lg border p-3 flex gap-3 transition hover:border-primary/40 hover:shadow-sm">
              <button
                type="button"
                onClick={() => openDoc(d.file_path)}
                disabled={!hasFile}
                className="flex flex-1 min-w-0 gap-3 text-left disabled:opacity-60 disabled:cursor-not-allowed"
                title={hasFile ? 'Open document' : 'Er hangt geen bestand aan dit document'}
              >
                <div className="h-12 w-12 rounded-md bg-muted flex items-center justify-center shrink-0">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{d.name}</p>
                  <p className="text-xs text-muted-foreground">{docType?.label ?? d.type ?? 'Onbekend type'}</p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <Badge variant="secondary" className={`text-xs ${statusBadge[d.status] ?? ''}`}>{d.status}</Badge>
                    {!hasFile && <Badge variant="outline" className="text-xs">Geen bestand</Badge>}
                  </div>
                  {d.expiry_date && <p className="text-xs text-muted-foreground mt-1">Verloopt: {formatDate(d.expiry_date)}</p>}
                  <p className="text-xs text-muted-foreground">Toegevoegd: {formatDate(d.created_at)}</p>
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
      {filteredDocs.length === 0 && (
        <p className="text-center text-muted-foreground py-8">
          {docs.length === 0 ? 'Nog geen documenten' : 'Geen documenten voor dit type'}
        </p>
      )}
    </div>
  );
};

export default CompanyDocumentsTab;
