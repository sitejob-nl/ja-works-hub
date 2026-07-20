import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { unwrap } from '@/lib/db';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { logAudit } from '@/lib/audit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Check, Info, Loader2, Pencil, Upload } from 'lucide-react';
import { toast } from 'sonner';
import type { ComplianceItem, ComplianceResult } from '@/hooks/useComplianceCheck';
import {
  ACCEPTED_UPLOAD_ATTRIBUTE, buildDocumentStoragePath, normalizeComplianceField,
  resolveComplianceAction, validateComplianceField, validateUploadFile,
} from '@/lib/compliance-actions';

interface ComplianceFixListProps {
  candidateId: string;
  compliance: ComplianceResult;
}

/**
 * De "Dossier niet compleet"-strip in de plaatsingswizard. Toont niet alleen wát er mist,
 * maar laat het ook ter plekke aanvullen: ontbrekende documenten uploaden en lege velden
 * invullen, zonder de wizard te verlaten. Na elke geslaagde actie draait de compliance-check
 * opnieuw, zodat de regel uit de lijst verdwijnt.
 */
const ComplianceFixList = ({ candidateId, compliance }: ComplianceFixListProps) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();

  /** Slechts één regel tegelijk open — houdt de strip rustig binnen de wizard. */
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [fieldValue, setFieldValue] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [expiryDate, setExpiryDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const closeEditor = () => {
    setOpenCode(null);
    setFieldValue('');
    setFile(null);
    setExpiryDate('');
    setError(null);
  };

  const openEditor = (code: string) => {
    closeEditor();
    setOpenCode(code);
  };

  /** Compliance opnieuw laten draaien; de strip beweegt daarmee live mee. */
  const refreshCompliance = () => {
    qc.invalidateQueries({ queryKey: ['placement-compliance', candidateId] });
    qc.invalidateQueries({ queryKey: ['documents', candidateId] });
    qc.invalidateQueries({ queryKey: ['candidate', candidateId] });
  };

  const saveField = useMutation({
    mutationFn: async ({ field, value }: { field: string; value: string; sensitive: boolean }) => {
      await unwrap(
        supabase
          .from('candidates')
          .update({ [field]: normalizeComplianceField(field, value) } as any)
          .eq('id', candidateId),
      );
    },
    onSuccess: (_data, variables) => {
      // BSN/IBAN worden door een DB-trigger versleuteld; de gedecrypte cache moet dus weg.
      if (variables.sensitive) {
        qc.invalidateQueries({ queryKey: ['candidate-decrypted', candidateId] });
      }
      logAudit({
        action: 'update',
        tableName: 'candidates',
        recordId: candidateId,
        // Bewust géén waarde in het audit-log: dit gaat langs BSN en IBAN.
        newValues: { field: variables.field, aangevuld_tijdens: 'plaatsing' },
      });
      refreshCompliance();
      toast.success('Gegeven opgeslagen');
      closeEditor();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Opslaan mislukt'),
  });

  const uploadDocument = useMutation({
    mutationFn: async ({ docType, selected, expiry }: { docType: string; selected: File; expiry: string }) => {
      const path = buildDocumentStoragePath(orgId, candidateId, selected.name, crypto.randomUUID());
      const { error: uploadErr } = await supabase.storage.from('documents').upload(path, selected);
      if (uploadErr) throw uploadErr;

      await unwrap(
        supabase.from('documents').insert({
          organization_id: orgId,
          candidate_id: candidateId,
          type: docType as any,
          name: selected.name,
          expiry_date: expiry || null,
          file_path: path,
        } as any),
      );
    },
    onSuccess: (_data, variables) => {
      logAudit({
        action: 'create',
        tableName: 'documents',
        recordId: candidateId,
        newValues: { type: variables.docType, aangevuld_tijdens: 'plaatsing' },
      });
      refreshCompliance();
      toast.success('Document geüpload');
      closeEditor();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Uploaden mislukt'),
  });

  const busy = saveField.isPending || uploadDocument.isPending;

  const submitField = (field: string, sensitive: boolean) => {
    const message = validateComplianceField(field, fieldValue);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    saveField.mutate({ field, value: fieldValue, sensitive });
  };

  const submitUpload = (docType: string) => {
    if (!file) {
      setError('Kies eerst een bestand.');
      return;
    }
    const message = validateUploadFile(file);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    uploadDocument.mutate({ docType, selected: file, expiry: expiryDate });
  };

  const renderEditor = (item: ComplianceItem) => {
    const action = resolveComplianceAction(item);

    if (action.type === 'none') {
      return (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {action.reason}
        </p>
      );
    }

    if (action.type === 'field') {
      return (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1">
              <Label htmlFor={`fix-${item.code}`} className="text-xs">Nieuwe waarde</Label>
              <Input
                id={`fix-${item.code}`}
                className="mt-1 bg-background"
                type={action.inputType}
                inputMode={action.field === 'bsn' ? 'numeric' : undefined}
                placeholder={action.placeholder}
                value={fieldValue}
                autoFocus
                onChange={(e) => { setFieldValue(e.target.value); setError(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submitField(action.field, action.sensitive);
                  }
                }}
              />
            </div>
            <Button size="sm" disabled={busy} onClick={() => submitField(action.field, action.sensitive)}>
              {saveField.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
              Opslaan
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={closeEditor}>Annuleren</Button>
          </div>
          {action.hint && !error && <p className="text-xs text-muted-foreground">{action.hint}</p>}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      );
    }

    return (
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <Label htmlFor={`fix-${item.code}`} className="text-xs">Bestand (PDF, JPG of PNG)</Label>
            <Input
              id={`fix-${item.code}`}
              className="mt-1 bg-background"
              type="file"
              accept={ACCEPTED_UPLOAD_ATTRIBUTE}
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }}
            />
          </div>
          {action.withExpiry && (
            <div className="w-[160px]">
              <Label htmlFor={`fix-exp-${item.code}`} className="text-xs">Geldig tot</Label>
              <Input
                id={`fix-exp-${item.code}`}
                className="mt-1 bg-background"
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
            </div>
          )}
          <Button size="sm" disabled={busy} onClick={() => submitUpload(action.docType)}>
            {uploadDocument.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}
            Uploaden
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={closeEditor}>Annuleren</Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  };

  return (
    <div className="rounded-md border border-orange-200 bg-orange-50 p-3 text-sm dark:border-orange-900 dark:bg-orange-950/30">
      <div className="flex items-center gap-2 font-medium text-orange-800 dark:text-orange-300">
        <AlertTriangle className="h-4 w-4" /> Dossier niet compleet
      </div>

      <ul className="mt-2 space-y-1.5">
        {compliance.items.map((item) => {
          const action = resolveComplianceAction(item);
          const isOpen = openCode === item.code;
          return (
            <li key={item.code} className="border-b border-orange-200/60 pb-1.5 last:border-0 last:pb-0 dark:border-orange-900/60">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-foreground">{item.label}</span>
                {action.type !== 'none' && !isOpen && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 bg-background px-2 text-xs"
                    onClick={() => openEditor(item.code)}
                  >
                    {action.type === 'upload'
                      ? <><Upload className="mr-1 h-3 w-3" />Uploaden</>
                      : <><Pencil className="mr-1 h-3 w-3" />Invullen</>}
                  </Button>
                )}
              </div>
              {(isOpen || action.type === 'none') && renderEditor(item)}
            </li>
          );
        })}
      </ul>

      <p className="mt-2 text-xs text-muted-foreground">
        Vul aan wat je bij de hand hebt. Plaatsen kan straks alsnog, met een gelogde override.
      </p>
    </div>
  );
};

export default ComplianceFixList;
