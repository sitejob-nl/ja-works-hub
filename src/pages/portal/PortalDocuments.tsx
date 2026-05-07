import { useState } from 'react';
import { usePortal } from '@/contexts/PortalContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { FileText, Download, Plus, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { nl } from 'date-fns/locale';
import type { Database } from '@/integrations/supabase/types';

type DocType = Database['public']['Enums']['document_type'];
type DocStatus = Database['public']['Enums']['document_status'];

const typeLabels: Record<DocType, string> = {
  cv: 'CV',
  pasfoto: 'Pasfoto',
  onboarding_formulier: 'Onboarding-formulier',
  id_bewijs: 'ID Bewijs',
  rijbewijs: 'Rijbewijs',
  certificaat: 'Certificaat',
  diploma: 'Diploma',
  contract: 'Contract',
  reglement: 'Reglement',
  bankbewijs: 'Bankbewijs',
  loonstrook: 'Loonstrook',
  jaaropgave: 'Jaaropgave',
  urenbrief: 'Urenbrief',
  werkfoto: 'Werkfoto',
  overig: 'Overig',
};

const statusConfig: Record<DocStatus, { label: string; className: string }> = {
  geldig: { label: 'Geldig', className: 'bg-stat-green/10 text-stat-green border-0' },
  verloopt_binnenkort: { label: 'Verloopt binnenkort', className: 'bg-orange-100 text-orange-600 border-0' },
  verlopen: { label: 'Verlopen', className: 'bg-red-100 text-red-600 border-0' },
  ongeldig: { label: 'Ongeldig', className: 'bg-muted text-muted-foreground border-0' },
};

const PortalDocuments = () => {
  const { employee, candidate } = usePortal();
  const qc = useQueryClient();
  const candidateId = candidate?.id;
  const orgId = employee?.organization_id;

  const [open, setOpen] = useState(false);
  const [docType, setDocType] = useState<DocType>('overig');
  const [docName, setDocName] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const { data: documents, isLoading } = useQuery({
    queryKey: ['portal-documents', candidateId],
    queryFn: async () => {
      const { data } = await supabase
        .from('documents')
        .select('*')
        .eq('candidate_id', candidateId!)
        .order('created_at', { ascending: false });
      return data ?? [];
    },
    enabled: !!candidateId,
  });

  const downloadDoc = async (filePath: string, name: string) => {
    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(filePath, 300);
    if (error || !data?.signedUrl) {
      toast.error('Download mislukt');
      return;
    }
    window.open(data.signedUrl, '_blank');
  };

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file || !candidateId || !orgId) throw new Error('Vul alle velden in');

      let filePath: string | null = null;
      const ext = file.name.split('.').pop();
      const storagePath = `${orgId}/${candidateId}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(storagePath, file);
      if (uploadError) throw uploadError;
      filePath = storagePath;

      const { error } = await supabase.from('documents').insert({
        candidate_id: candidateId,
        organization_id: orgId,
        type: docType,
        name: docName || file.name,
        file_path: filePath,
        expiry_date: expiryDate || null,
        status: 'geldig' as DocStatus,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-documents'] });
      setOpen(false);
      resetForm();
      toast.success('Document geüpload');
    },
    onError: (err: any) => toast.error(err.message || 'Upload mislukt'),
  });

  const resetForm = () => {
    setDocType('overig');
    setDocName('');
    setExpiryDate('');
    setFile(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Documenten</h1>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button size="sm" className="gap-2">
              <Plus className="h-4 w-4" /> Toevoegen
            </Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Document toevoegen</SheetTitle>
            </SheetHeader>
            <div className="space-y-4 mt-6">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={docType} onValueChange={(v) => setDocType(v as DocType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(typeLabels).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Naam</Label>
                <Input value={docName} onChange={(e) => setDocName(e.target.value)} placeholder="Bijv. Paspoort" />
              </div>
              <div className="space-y-2">
                <Label>Bestand</Label>
                <Input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </div>
              <div className="space-y-2">
                <Label>Vervaldatum (optioneel)</Label>
                <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
              </div>
              <Button
                onClick={() => uploadMutation.mutate()}
                disabled={uploadMutation.isPending || !file}
                className="w-full gap-2"
              >
                <Upload className="h-4 w-4" />
                {uploadMutation.isPending ? 'Uploaden...' : 'Uploaden'}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Laden...</div>
      ) : !documents?.length ? (
        <div className="bg-card rounded-xl border p-8 text-center text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p>Geen documenten gevonden</p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border divide-y">
          {documents.map((doc) => {
            const sc = statusConfig[doc.status as DocStatus] ?? statusConfig.ongeldig;
            return (
              <div key={doc.id} className="flex items-center justify-between px-4 py-3">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px]">
                      {typeLabels[doc.type as DocType] ?? doc.type}
                    </Badge>
                    <Badge variant="secondary" className={`text-[10px] ${sc.className}`}>
                      {sc.label}
                    </Badge>
                  </div>
                  <p className="text-sm font-medium truncate">{doc.name}</p>
                  {doc.expiry_date && (
                    <p className="text-xs text-muted-foreground">
                      Vervalt: {format(new Date(doc.expiry_date), 'd MMM yyyy', { locale: nl })}
                    </p>
                  )}
                </div>
                {doc.file_path && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => downloadDoc(doc.file_path!, doc.name)}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PortalDocuments;
