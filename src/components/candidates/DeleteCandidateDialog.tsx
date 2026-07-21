import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { toFriendlyError } from '@/lib/errorMessages';

interface DeleteTarget {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: DeleteTarget[];
  onDeleted?: () => void;
}

interface PreviewCounts {
  matches: number;
  placements: number;
  timesheets: number;
  contracts: number;
  documents: number;
  housing: number;
  vehicles: number;
  invoice_lines: number;
  notes: number;
  communications: number;
}

const RELATION_LABELS: Array<{ key: keyof PreviewCounts; label: string }> = [
  { key: 'placements', label: 'plaatsingen' },
  { key: 'timesheets', label: 'urenregistraties' },
  { key: 'contracts', label: 'contracten' },
  { key: 'documents', label: 'documenten' },
  { key: 'matches', label: 'matches' },
  { key: 'housing', label: 'huisvestingstoewijzingen' },
  { key: 'vehicles', label: 'voertuigtoewijzingen' },
  { key: 'notes', label: 'notities' },
  { key: 'communications', label: 'communicatie-items' },
];

/** Verwijdert storage-bestanden in batches; faalt stil (bestanden zijn al ontkoppeld). */
async function removeStorageFiles(paths: string[]) {
  for (let i = 0; i < paths.length; i += 50) {
    const chunk = paths.slice(i, i + 50);
    const { error } = await supabase.storage.from('documents').remove(chunk);
    if (error) console.warn('Storage-cleanup faalde (niet-blokkerend):', error.message);
  }
}

const DeleteCandidateDialog = ({ open, onOpenChange, candidates, onDeleted }: Props) => {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const isBulk = candidates.length > 1;

  // Tellingen ophalen zodat de dialoog laat zien wat er mee verdwijnt.
  const { data: totals, isLoading: previewLoading } = useQuery({
    queryKey: ['candidate-delete-preview', candidates.map((c) => c.id)],
    queryFn: async () => {
      const previews = await Promise.all(
        candidates.map(async (c) => {
          const { data, error } = await supabase.rpc('delete_candidate_preview', { p_candidate_id: c.id });
          if (error) throw error;
          return data as unknown as PreviewCounts;
        }),
      );
      const sum = {} as PreviewCounts;
      for (const { key } of RELATION_LABELS) sum[key] = previews.reduce((n, p) => n + (p?.[key] ?? 0), 0);
      sum.invoice_lines = previews.reduce((n, p) => n + (p?.invoice_lines ?? 0), 0);
      return sum;
    },
    enabled: open && candidates.length > 0,
  });

  const relations = totals
    ? RELATION_LABELS.filter(({ key }) => totals[key] > 0).map(({ key, label }) => `${totals[key]} ${label}`)
    : [];

  const deletion = useMutation({
    mutationFn: async () => {
      const docPaths: string[] = [];
      const failures: string[] = [];
      for (const c of candidates) {
        const { data, error } = await supabase.rpc('delete_candidate_record', {
          p_candidate_id: c.id,
          p_reason: reason || null,
        });
        if (error) {
          failures.push(`${c.name}: ${toFriendlyError(error)}`);
          continue;
        }
        const paths = (data as any)?.document_paths;
        if (Array.isArray(paths)) docPaths.push(...paths.filter((p: unknown) => typeof p === 'string'));
      }
      await removeStorageFiles(docPaths);
      return { deleted: candidates.length - failures.length, failures };
    },
    onSuccess: ({ deleted, failures }) => {
      qc.invalidateQueries({ queryKey: ['candidates'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
      if (failures.length === 0) {
        toast.success(isBulk ? `${deleted} kandidaten verwijderd` : 'Kandidaat verwijderd');
      } else {
        toast.warning(`${deleted} verwijderd, ${failures.length} mislukt`, {
          description: failures.slice(0, 3).join(' · '),
        });
      }
      setReason('');
      onOpenChange(false);
      onDeleted?.();
    },
    onError: (e) => toast.error(toFriendlyError(e)),
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isBulk ? `${candidates.length} kandidaten verwijderen?` : `${candidates[0]?.name ?? 'Kandidaat'} verwijderen?`}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                Dit verwijdert {isBulk ? 'deze kandidaten' : 'deze kandidaat'} <strong>onomkeerbaar</strong>,
                inclusief alle gekoppelde gegevens. Factuurregels blijven bewaard (financiële administratie)
                maar worden losgekoppeld.
              </p>
              {previewLoading ? (
                <p className="text-muted-foreground">Gekoppelde gegevens tellen…</p>
              ) : relations.length > 0 ? (
                <p>
                  Gaat mee de prullenbak in:{' '}
                  <strong className="text-destructive">{relations.join(', ')}</strong>.
                </p>
              ) : (
                <p className="text-muted-foreground">Er zijn geen gekoppelde gegevens gevonden.</p>
              )}
              {totals && totals.invoice_lines > 0 && (
                <p className="text-muted-foreground">
                  {totals.invoice_lines} factuurregel(s) worden losgekoppeld, niet verwijderd.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          placeholder="Reden (optioneel, voor het auditlog)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <AlertDialogFooter>
          <AlertDialogCancel>Annuleren</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => { e.preventDefault(); deletion.mutate(); }}
            disabled={deletion.isPending || previewLoading}
          >
            {deletion.isPending ? 'Verwijderen…' : 'Definitief verwijderen'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DeleteCandidateDialog;
