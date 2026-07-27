import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Stuurt de reglementen die bij een toewijzing horen naar de medewerker.
 *
 * Bewust non-blocking: een toewijzing die al gelukt is mag niet alsnog "mislukken" doordat de
 * mail niet weg kan. Bij een fout een waarschuwing, geen exception — dezelfde lijn als
 * PlacementTriggers.
 *
 * Welke reglementen meegaan is instelbaar in Instellingen → HR (categorie + "automatisch
 * meesturen"), niet hier vastgelegd. Staat er niets aan, dan is dit een no-op.
 */
export async function sendRegulationsForAssignment(input: {
  candidateId: string;
  category: 'voertuig' | 'huisvesting';
  /** vehicle_assignment- of housing_assignment-id, puur voor herleidbaarheid. */
  contextId?: string | null;
}): Promise<void> {
  try {
    const { data, error } = await supabase.functions.invoke('send-regulations', {
      body: {
        candidate_id: input.candidateId,
        category: input.category,
        context_id: input.contextId ?? null,
      },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    const sent = Number(data?.sent ?? 0);
    if (sent > 0) {
      toast.success(`${sent} reglement${sent === 1 ? '' : 'en'} verstuurd naar de medewerker`);
      return;
    }
    // Geen reglementen ingesteld is de normale begintoestand — daar wil je geen melding over.
    if (data?.reason === 'geen_emailadres') {
      toast.warning('Reglement niet verstuurd: de medewerker heeft geen e-mailadres.');
    } else if (Number(data?.failed ?? 0) > 0) {
      toast.warning('Reglement kon niet worden verstuurd. Controleer de mailkoppeling.');
    }
  } catch (e: any) {
    toast.warning(`Reglement niet verstuurd: ${e?.message ?? 'onbekende fout'}`);
  }
}
