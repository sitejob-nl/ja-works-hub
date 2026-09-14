import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useCanDeletePlacement } from '@/hooks/useRecordDeleteAccess';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { qk } from '@/lib/query-keys';
import { unwrap } from '@/lib/db';
import { toFriendlyError } from '@/lib/errorMessages';
import {
  canDeletePlacement,
  describePlacementPeriod,
  placementDeleteBlockers,
  type PlacementDeleteImpact,
} from '@/lib/placement-delete';

export interface DeletePlacementTarget {
  id: string;
  function_name?: string | null;
  start_date: string;
  end_date?: string | null;
  expected_end_date?: string | null;
  candidateName?: string | null;
  companyName?: string | null;
  /** Context van de aanroeper; de server gebruikt de actuele rij voor het auditlog. */
  row?: Record<string, unknown> | null;
}

interface DeletePlacementDialogProps {
  placement: DeletePlacementTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Na een geslaagde verwijdering, bv. om weg te navigeren van het detailscherm. */
  onDeleted?: () => void;
}

/** Server-side counts include history hidden by the caller's finance permissions. */
async function fetchPlacementDeleteImpact(placementId: string): Promise<PlacementDeleteImpact> {
  return await unwrap(supabase.rpc('get_placement_delete_impact', { p_placement_id: placementId })) as unknown as PlacementDeleteImpact;
}

/**
 * Query-prefixes waarin een plaatsing kan voorkomen. Na verwijderen allemaal
 * verversen, zodat overzicht, opdrachtgever-tab, kandidaat/medewerker-tab,
 * vacature-tab en planning de rij niet blijven tonen.
 */
const PLACEMENT_LIST_PREFIXES = [
  'placements-list',
  'company-placements',
  'candidate-placements',
  'employee-placements',
  'vacancy-placements',
  'placements-for-employee',
  'planning-placements',
  'uitstroom-all-placements',
];

/**
 * Bevestiging voor het definitief verwijderen van een onjuiste of testplaatsing.
 * Beëindigen blijft de weg voor een plaatsing met historie; dit is uitsluitend
 * voor een regel die er nooit had moeten zijn.
 *
 * Bereikbaar vanaf het plaatsingsoverzicht, het detailscherm en het
 * plaatsingen-tabblad van de opdrachtgever — één dialoog, zodat de uitleg en
 * de auditregel overal hetzelfde zijn.
 */
export default function DeletePlacementDialog({ placement, open, onOpenChange, onDeleted }: DeletePlacementDialogProps) {
  const canRemove = useCanDeletePlacement();
  const qc = useQueryClient();
  const placementId = placement?.id ?? '';

  const impactQuery = useQuery({
    queryKey: qk.placements.deleteImpact(placementId),
    queryFn: () => fetchPlacementDeleteImpact(placementId),
    enabled: open && !!placementId && canRemove,
    // Elke keer dat de dialoog opengaat opnieuw tellen: intussen kan er een urenregel bij zijn gekomen.
    staleTime: 0,
  });

  const blockers = placementDeleteBlockers(impactQuery.data);
  const deletable = impactQuery.isSuccess && canDeletePlacement(impactQuery.data);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!placement) return;
      if (!canRemove) throw new Error('Je hebt geen rechten om deze plaatsing te verwijderen.');
      const deletedId = await unwrap(supabase.rpc('delete_placement_record', { p_placement_id: placement.id }));
      if (deletedId !== placement.id) throw new Error('De plaatsing kon niet worden verwijderd.');
    },
    onSuccess: () => {
      // Het detailscherm zou anders bij een refetch op "Niet gevonden" stranden.
      qc.removeQueries({ queryKey: ['placement', placementId] });
      for (const prefix of PLACEMENT_LIST_PREFIXES) qc.invalidateQueries({ queryKey: [prefix] });
      toast.success('Plaatsing verwijderd');
      onOpenChange(false);
      onDeleted?.();
    },
    onError: (error: unknown) => {
      toast.error(toFriendlyError(error, 'Verwijderen mislukt'));
      // Dialoog blijft open en telt opnieuw, zodat een nieuwe blokkade meteen zichtbaar is.
      qc.invalidateQueries({ queryKey: qk.placements.deleteImpact(placementId) });
    },
  });

  const candidateName = placement?.candidateName?.trim() || 'Onbekende kandidaat';
  const companyName = placement?.companyName?.trim() || 'Onbekende opdrachtgever';
  const period = placement ? describePlacementPeriod(placement.start_date, placement.end_date, placement.expected_end_date) : '';

  let statusText: string;
  if (!canRemove) {
    statusText = 'Je hebt geen rechten om deze plaatsing te verwijderen.';
  } else if (impactQuery.isError) {
    statusText = 'De gekoppelde gegevens konden niet worden gecontroleerd. Sluit dit venster en probeer het opnieuw.';
  } else if (!impactQuery.isSuccess) {
    statusText = 'Gekoppelde gegevens worden gecontroleerd…';
  } else if (blockers.length > 0) {
    statusText = 'Verwijderen is niet mogelijk zolang er uren, urenweken, urenbrieven, ziekmeldingen of factuurregels aan deze plaatsing hangen.';
  } else {
    statusText = 'Er hangen geen uren, urenweken, urenbrieven, ziekmeldingen of factuurregels aan. De plaatsing verdwijnt definitief, inclusief de bijbehorende uurtypes, reistypes en vergoedingen. Dit kan niet ongedaan worden gemaakt.';
  }

  return (
    <ConfirmDialog
      open={open && !!placement}
      onOpenChange={onOpenChange}
      title="Plaatsing verwijderen?"
      description={
        <>
          <span className="block">
            <span className="font-medium text-foreground">{candidateName}</span>
            {' bij '}
            <span className="font-medium text-foreground">{companyName}</span>
            {placement?.function_name ? ` — ${placement.function_name}` : ''}
            {', '}
            <span className="whitespace-nowrap">{period}</span>.
          </span>
          <span className="block mt-2">{statusText}</span>
        </>
      }
      confirmLabel="Verwijderen"
      pendingLabel="Verwijderen..."
      pending={mutation.isPending}
      confirmDisabled={!canRemove || !deletable}
      onConfirm={() => mutation.mutate()}
    >
      {blockers.length > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <p className="font-medium">Hier hangt nog iets aan:</p>
          <ul className="mt-1 list-disc pl-5">
            {blockers.map((b) => <li key={b.key}>{b.label}</li>)}
          </ul>
          <p className="mt-2 text-muted-foreground">
            Een plaatsing met historie verwijder je niet, die beëindig je. Gebruik <strong>Beëindigen</strong>;
            dan blijft ze als afgesloten plaatsing staan.
          </p>
        </div>
      )}
    </ConfirmDialog>
  );
}
