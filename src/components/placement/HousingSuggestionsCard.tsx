import { useState } from 'react';
import { HousingSuggestion } from './PlacementTriggers';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { logAudit } from '@/lib/audit';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Home, Users, MapPin, Check } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  suggestions: HousingSuggestion[];
  candidateId: string;
  startDate: string;
  onAssigned?: () => void;
}

const HousingSuggestionsCard = ({ suggestions, candidateId, startDate, onAssigned }: Props) => {
  const orgId = useOrganizationId();
  const [assigning, setAssigning] = useState<string | null>(null);
  const [assigned, setAssigned] = useState<string | null>(null);

  const handleAssign = async (s: HousingSuggestion) => {
    setAssigning(s.unitId);
    try {
      const { error } = await supabase.from('housing_assignments').insert({
        organization_id: orgId,
        unit_id: s.unitId,
        candidate_id: candidateId,
        check_in_date: startDate,
        status: 'ingecheckt' as any,
        monthly_deduction: s.monthlyCost,
      });
      if (error) throw error;
      logAudit({ action: 'create', tableName: 'housing_assignments', recordId: candidateId, newValues: { unit_id: s.unitId, unit_name: s.unitName } });
      setAssigned(s.unitId);
      toast.success(`Huisvesting toegewezen: ${s.unitName}`);
      onAssigned?.();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setAssigning(null);
    }
  };

  if (suggestions.length === 0) return null;

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium flex items-center gap-1.5">
        <Home className="h-4 w-4" /> Huisvesting suggesties
      </h4>
      <div className="space-y-2 max-h-[200px] overflow-y-auto">
        {suggestions.map((s) => (
          <div key={s.unitId} className="flex items-center justify-between p-2.5 bg-muted/50 rounded-md text-sm">
            <div className="flex-1 min-w-0">
              <div className="font-medium">{s.unitName} — {s.propertyName}</div>
              <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" /> {s.propertyCity}</span>
                <span>{s.currentOccupancy}/{s.capacity} bezet</span>
                {s.colleagueCount > 0 && (
                  <Badge variant="secondary" className="text-[10px] h-4 px-1 gap-0.5">
                    <Users className="h-2.5 w-2.5" /> {s.colleagueCount} collega{s.colleagueCount > 1 ? "'s" : ''}
                  </Badge>
                )}
                {s.monthlyCost != null && <span>€{s.monthlyCost}/mnd</span>}
              </div>
            </div>
            {assigned === s.unitId ? (
              <Check className="h-4 w-4 text-green-600" />
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7"
                onClick={() => handleAssign(s)}
                disabled={!!assigning || !!assigned}
              >
                {assigning === s.unitId ? '...' : 'Toewijzen'}
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default HousingSuggestionsCard;
