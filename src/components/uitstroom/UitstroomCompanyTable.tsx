import { useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';

interface PlacementWithCompany {
  id: string;
  status: string;
  terminated_by: string | null;
  termination_reason: string | null;
  company_id: string | null;
  companies: { id: string; name: string } | null;
}

interface UitstroomCompanyTableProps {
  allPlacements: PlacementWithCompany[];
  terminatedPlacements: PlacementWithCompany[];
}

type SortKey = 'name' | 'total' | 'terminated' | 'rate';

const UitstroomCompanyTable = ({ allPlacements, terminatedPlacements }: UitstroomCompanyTableProps) => {
  const [sortKey, setSortKey] = useState<SortKey>('rate');
  const [sortAsc, setSortAsc] = useState(false);

  // Build company stats
  const companyMap: Record<string, {
    companyId: string;
    name: string;
    total: number;
    terminated: number;
    reasons: Record<string, number>;
  }> = {};

  for (const p of allPlacements) {
    const companyId = p.company_id || 'unknown';
    const companyName = p.companies?.name || 'Onbekend';
    if (!companyMap[companyId]) {
      companyMap[companyId] = { companyId, name: companyName, total: 0, terminated: 0, reasons: {} };
    }
    companyMap[companyId].total++;
  }

  for (const p of terminatedPlacements) {
    const companyId = p.company_id || 'unknown';
    const companyName = p.companies?.name || 'Onbekend';
    if (!companyMap[companyId]) {
      companyMap[companyId] = { companyId, name: companyName, total: 0, terminated: 0, reasons: {} };
    }
    companyMap[companyId].terminated++;
    const reason = p.termination_reason || 'Onbekend';
    companyMap[companyId].reasons[reason] = (companyMap[companyId].reasons[reason] || 0) + 1;
  }

  const companies = Object.values(companyMap).filter(c => c.terminated > 0);

  const getMostCommonReason = (reasons: Record<string, number>) => {
    let maxReason = '';
    let maxCount = 0;
    for (const [reason, count] of Object.entries(reasons)) {
      if (count > maxCount) {
        maxCount = count;
        maxReason = reason;
      }
    }
    return maxReason;
  };

  const sorted = [...companies].sort((a, b) => {
    const rateA = a.total > 0 ? a.terminated / a.total : 0;
    const rateB = b.total > 0 ? b.terminated / b.total : 0;
    let cmp = 0;
    switch (sortKey) {
      case 'name': cmp = a.name.localeCompare(b.name); break;
      case 'total': cmp = a.total - b.total; break;
      case 'terminated': cmp = a.terminated - b.terminated; break;
      case 'rate': cmp = rateA - rateB; break;
    }
    return sortAsc ? cmp : -cmp;
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const SortIcon = ({ columnKey }: { columnKey: SortKey }) => {
    if (sortKey !== columnKey) return null;
    return sortAsc ? <ChevronUp className="h-3 w-3 inline ml-0.5" /> : <ChevronDown className="h-3 w-3 inline ml-0.5" />;
  };

  return (
    <div className="bg-card border rounded-lg p-4">
      <h3 className="text-xs font-semibold text-muted-foreground mb-3">
        Uitstroom per opdrachtgever
      </h3>
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Geen data</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-2 font-medium cursor-pointer" onClick={() => handleSort('name')}>
                  Opdrachtgever <SortIcon columnKey="name" />
                </th>
                <th className="pb-2 font-medium text-right cursor-pointer" onClick={() => handleSort('total')}>
                  Totaal <SortIcon columnKey="total" />
                </th>
                <th className="pb-2 font-medium text-right cursor-pointer" onClick={() => handleSort('terminated')}>
                  Beëindigd <SortIcon columnKey="terminated" />
                </th>
                <th className="pb-2 font-medium text-right cursor-pointer" onClick={() => handleSort('rate')}>
                  Uitstroom % <SortIcon columnKey="rate" />
                </th>
                <th className="pb-2 font-medium">Meest voorkomende reden</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => {
                const rate = c.total > 0 ? Math.round((c.terminated / c.total) * 100) : 0;
                const isHighRisk = rate > 30;
                return (
                  <tr
                    key={c.companyId}
                    className={`border-b last:border-0 ${isHighRisk ? 'bg-red-50 dark:bg-red-950/20' : ''}`}
                  >
                    <td className="py-2 font-medium">{c.name}</td>
                    <td className="py-2 text-right text-muted-foreground">{c.total}</td>
                    <td className="py-2 text-right">{c.terminated}</td>
                    <td className={`py-2 text-right font-medium ${isHighRisk ? 'text-destructive' : ''}`}>
                      {rate}%
                    </td>
                    <td className="py-2 text-muted-foreground text-xs">
                      {getMostCommonReason(c.reasons)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default UitstroomCompanyTable;
