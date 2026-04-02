import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';

interface TerminatedPlacement {
  id: string;
  terminated_by: string | null;
  termination_reason: string | null;
  employee_id: string | null;
  employees: {
    id: string;
    candidate_id: string | null;
    candidates: { id: string; first_name: string; last_name: string } | null;
  } | null;
}

interface AllPlacement {
  id: string;
  employee_id: string | null;
}

interface UitstroomRepeatersTableProps {
  terminatedPlacements: TerminatedPlacement[];
  allPlacements: AllPlacement[];
}

const UitstroomRepeatersTable = ({ terminatedPlacements, allPlacements }: UitstroomRepeatersTableProps) => {
  const navigate = useNavigate();

  // Group by employee/candidate
  const employeeMap: Record<string, {
    employeeId: string;
    candidateId: string;
    name: string;
    totalPlacements: number;
    terminatedCount: number;
    reasons: string[];
  }> = {};

  // Count total placements per employee
  const totalByEmployee: Record<string, number> = {};
  for (const p of allPlacements) {
    if (p.employee_id) {
      totalByEmployee[p.employee_id] = (totalByEmployee[p.employee_id] || 0) + 1;
    }
  }

  for (const p of terminatedPlacements) {
    const empId = p.employee_id || 'unknown';
    const emp = p.employees;
    const cand = emp?.candidates;
    const name = cand ? `${cand.first_name} ${cand.last_name}` : 'Onbekend';
    const candidateId = cand?.id || '';

    if (!employeeMap[empId]) {
      employeeMap[empId] = {
        employeeId: empId,
        candidateId,
        name,
        totalPlacements: totalByEmployee[empId] || 0,
        terminatedCount: 0,
        reasons: [],
      };
    }
    employeeMap[empId].terminatedCount++;
    if (p.termination_reason) {
      employeeMap[empId].reasons.push(p.termination_reason);
    }
  }

  // Only show repeaters (2+ terminated)
  const repeaters = Object.values(employeeMap)
    .filter(e => e.terminatedCount >= 2)
    .sort((a, b) => b.terminatedCount - a.terminatedCount);

  // Deduplicate reasons
  const uniqueReasons = (reasons: string[]) => [...new Set(reasons)];

  return (
    <div className="bg-card border rounded-lg p-4">
      <h3 className="text-xs font-semibold text-muted-foreground mb-3">
        Herhaalde uitstroom per kandidaat
      </h3>
      <p className="text-[10px] text-muted-foreground mb-3">
        Kandidaten met 2 of meer beëindigde plaatsingen
      </p>
      {repeaters.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Geen herhalers gevonden</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-2 font-medium">Naam</th>
                <th className="pb-2 font-medium text-right">Totaal plaatsingen</th>
                <th className="pb-2 font-medium text-right">Beëindigd</th>
                <th className="pb-2 font-medium">Redenen</th>
              </tr>
            </thead>
            <tbody>
              {repeaters.map((r) => (
                <tr
                  key={r.employeeId}
                  className="border-b last:border-0 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => {
                    if (r.candidateId) navigate(`/kandidaten/${r.candidateId}`);
                  }}
                >
                  <td className="py-2 font-medium text-primary">{r.name}</td>
                  <td className="py-2 text-right text-muted-foreground">{r.totalPlacements}</td>
                  <td className="py-2 text-right font-medium text-destructive">{r.terminatedCount}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1">
                      {uniqueReasons(r.reasons).map((reason, i) => (
                        <Badge key={i} variant="outline" className="text-[10px] font-normal">
                          {reason}
                        </Badge>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default UitstroomRepeatersTable;
