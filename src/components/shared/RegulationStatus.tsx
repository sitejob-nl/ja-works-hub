import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { unwrapList } from '@/lib/db';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Clock, Send } from 'lucide-react';
import { formatDate } from '@/lib/format';

/**
 * Toont of de reglementen bij een toewijzing zijn verstuurd en bevestigd.
 *
 * Zonder dit weet de intercedent nog steeds niets: de mail gaat automatisch, maar of iemand 'm
 * ook daadwerkelijk heeft doorgenomen is precies waar Jeroen om vroeg.
 *
 * De verzendlog leest uit regulation_send_tokens (token staat gehasht, dus intern lezen is
 * veilig); de bevestiging uit regulation_acknowledgements.
 */
const RegulationStatus = ({
  candidateId,
  category,
}: {
  candidateId: string;
  category: 'voertuig' | 'huisvesting';
}) => {
  const orgId = useOrganizationId();

  const { data: rows = [] } = useQuery({
    queryKey: ['regulation-status', orgId, candidateId, category],
    queryFn: async () => {
      const sends = await unwrapList(supabase
        .from('regulation_send_tokens')
        .select('id, regulation_id, sent_at, used_at, regulations(title, requires_acknowledgement)')
        .eq('organization_id', orgId)
        .eq('candidate_id', candidateId)
        .eq('context_type', category)
        .order('sent_at', { ascending: false }));

      const acks = await unwrapList(supabase
        .from('regulation_acknowledgements')
        .select('regulation_id, signed_at')
        .eq('organization_id', orgId)
        .eq('candidate_id', candidateId));

      const signedByReg = new Map<string, string>();
      for (const a of acks as any[]) {
        if (!signedByReg.has(a.regulation_id)) signedByReg.set(a.regulation_id, a.signed_at);
      }

      // Eén regel per reglement: de nieuwste verzending telt.
      const seen = new Set<string>();
      return (sends as any[])
        .filter((s) => !seen.has(s.regulation_id) && seen.add(s.regulation_id))
        .map((s) => ({
          id: s.id,
          title: s.regulations?.title ?? 'Reglement',
          sentAt: s.sent_at,
          signedAt: signedByReg.get(s.regulation_id) ?? null,
        }));
    },
    enabled: !!orgId && !!candidateId,
  });

  if (rows.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase text-muted-foreground">Reglementen</p>
      {rows.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-foreground">{r.title}</span>
          {r.signedAt ? (
            <Badge variant="secondary" className="gap-1 border-0 bg-stat-green/10 text-xs text-stat-green">
              <CheckCircle2 className="h-3 w-3" /> Bevestigd {formatDate(r.signedAt)}
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1 border-0 bg-yellow-100 text-xs text-yellow-700">
              <Clock className="h-3 w-3" /> Nog niet bevestigd
            </Badge>
          )}
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Send className="h-3 w-3" /> verstuurd {formatDate(r.sentAt)}
          </span>
        </div>
      ))}
    </div>
  );
};

export default RegulationStatus;
