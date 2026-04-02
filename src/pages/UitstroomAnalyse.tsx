import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BarChart3 } from 'lucide-react';
import UitstroomKpiCards from '@/components/uitstroom/UitstroomKpiCards';
import UitstroomReasonChart from '@/components/uitstroom/UitstroomReasonChart';
import UitstroomTrendChart from '@/components/uitstroom/UitstroomTrendChart';
import UitstroomCompanyTable from '@/components/uitstroom/UitstroomCompanyTable';
import UitstroomRepeatersTable from '@/components/uitstroom/UitstroomRepeatersTable';

/** Shape returned by the terminated-placements query */
interface TerminatedPlacement {
  id: string;
  status: string;
  terminated_by: string | null;
  termination_reason: string | null;
  termination_notes: string | null;
  terminated_at: string | null;
  start_date: string | null;
  end_date: string | null;
  company_id: string | null;
  employee_id: string | null;
  companies: { id: string; name: string } | null;
  employees: {
    id: string;
    candidate_id: string | null;
    candidates: { id: string; first_name: string; last_name: string } | null;
  } | null;
}

/** Shape returned by the previous-period query (fewer columns) */
interface PrevTerminatedPlacement {
  id: string;
  status: string;
  terminated_by: string | null;
  termination_reason: string | null;
  termination_notes: string | null;
  terminated_at: string | null;
  start_date: string | null;
  end_date: string | null;
}

/** Shape returned by the all-placements query */
interface AllPlacement {
  id: string;
  status: string;
  terminated_by: string | null;
  termination_reason: string | null;
  company_id: string | null;
  employee_id: string | null;
  start_date: string | null;
  companies: { id: string; name: string } | null;
}

type PeriodFilter = 'this_year' | 'last_6_months' | 'last_12_months' | 'all_time';

function getDateRange(period: PeriodFilter): { from: string | null; to: string } {
  const now = new Date();
  const to = now.toISOString();

  switch (period) {
    case 'this_year':
      return { from: `${now.getFullYear()}-01-01`, to };
    case 'last_6_months': {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 6);
      return { from: d.toISOString().split('T')[0], to };
    }
    case 'last_12_months': {
      const d = new Date(now);
      d.setFullYear(d.getFullYear() - 1);
      return { from: d.toISOString().split('T')[0], to };
    }
    case 'all_time':
      return { from: null, to };
  }
}

function getPreviousDateRange(period: PeriodFilter): { from: string | null; to: string } {
  const now = new Date();

  switch (period) {
    case 'this_year': {
      const prevYear = now.getFullYear() - 1;
      return { from: `${prevYear}-01-01`, to: `${prevYear}-12-31` };
    }
    case 'last_6_months': {
      const end = new Date(now);
      end.setMonth(end.getMonth() - 6);
      const start = new Date(end);
      start.setMonth(start.getMonth() - 6);
      return { from: start.toISOString().split('T')[0], to: end.toISOString().split('T')[0] };
    }
    case 'last_12_months': {
      const end = new Date(now);
      end.setFullYear(end.getFullYear() - 1);
      const start = new Date(end);
      start.setFullYear(start.getFullYear() - 1);
      return { from: start.toISOString().split('T')[0], to: end.toISOString().split('T')[0] };
    }
    case 'all_time':
      return { from: null, to: '1970-01-01' }; // no previous period for all time
  }
}

const PERIOD_LABELS: Record<PeriodFilter, string> = {
  this_year: 'Dit jaar',
  last_6_months: 'Laatste 6 maanden',
  last_12_months: 'Laatste 12 maanden',
  all_time: 'Alle tijd',
};

const UitstroomAnalyse = () => {
  const orgId = useOrganizationId();
  const [period, setPeriod] = useState<PeriodFilter>('this_year');

  const range = useMemo(() => getDateRange(period), [period]);
  const prevRange = useMemo(() => getPreviousDateRange(period), [period]);

  // Fetch terminated placements for current period
  const { data: terminated = [], isLoading } = useQuery<TerminatedPlacement[]>({
    queryKey: ['uitstroom-terminated', orgId, range.from, range.to],
    queryFn: async () => {
      let query = supabase
        .from('placements')
        .select(`
          id, status, terminated_by, termination_reason, termination_notes,
          terminated_at, start_date, end_date, company_id, employee_id,
          companies!placements_company_id_fkey(id, name),
          employees!placements_employee_id_fkey(
            id, candidate_id,
            candidates!employees_candidate_id_fkey(id, first_name, last_name)
          )
        `)
        .eq('status', 'voortijdig_beeindigd')
        .eq('organization_id', orgId)
        .limit(10000);

      if (range.from) {
        query = query.gte('terminated_at', range.from);
      }
      query = query.lte('terminated_at', range.to);

      const { data, error } = await query;
      if (error) throw error;
      return (data as TerminatedPlacement[]) ?? [];
    },
  });

  // Fetch terminated placements for previous period (for trend comparison)
  const { data: prevTerminated = [] } = useQuery<PrevTerminatedPlacement[]>({
    queryKey: ['uitstroom-terminated-prev', orgId, prevRange.from, prevRange.to],
    queryFn: async () => {
      if (period === 'all_time') return [];

      let query = supabase
        .from('placements')
        .select(`
          id, status, terminated_by, termination_reason, termination_notes,
          terminated_at, start_date, end_date
        `)
        .eq('status', 'voortijdig_beeindigd')
        .eq('organization_id', orgId)
        .limit(10000);

      if (prevRange.from) {
        query = query.gte('terminated_at', prevRange.from).lte('terminated_at', prevRange.to);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data as PrevTerminatedPlacement[]) ?? [];
    },
    enabled: period !== 'all_time',
  });

  // Fetch ALL placements (all statuses) for company rate calculations
  // Filtered by the same period so rates are meaningful
  const { data: allPlacements = [] } = useQuery<AllPlacement[]>({
    queryKey: ['uitstroom-all-placements', orgId, range.from, range.to],
    queryFn: async () => {
      let query = supabase
        .from('placements')
        .select(`
          id, status, terminated_by, termination_reason, company_id, employee_id, start_date,
          companies!placements_company_id_fkey(id, name)
        `)
        .eq('organization_id', orgId)
        .limit(10000);

      // A placement is "in this period" if it started before period end
      // and hasn't ended before period start (i.e. was active or started during the period)
      if (range.from) {
        query = query.gte('start_date', range.from);
      }
      query = query.lte('start_date', range.to);

      const { data, error } = await query;
      if (error) throw error;
      return (data as AllPlacement[]) ?? [];
    },
  });

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <BarChart3 className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl sm:text-2xl font-semibold">Uitstroom Analyse</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Analyseer beëindigde plaatsingen, patronen en redenen
          </p>
        </div>
        <Select value={period} onValueChange={(v) => setPeriod(v as PeriodFilter)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PERIOD_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground text-center py-12">Laden...</div>
      ) : (
        <>
          {/* KPI Cards */}
          <UitstroomKpiCards data={terminated} previousData={prevTerminated} />

          {/* Charts: reasons + distribution */}
          <UitstroomReasonChart data={terminated} />

          {/* Trend chart */}
          <UitstroomTrendChart data={terminated} />

          {/* Company table */}
          <UitstroomCompanyTable
            allPlacements={allPlacements}
            terminatedPlacements={terminated}
          />

          {/* Repeaters table */}
          <UitstroomRepeatersTable
            terminatedPlacements={terminated}
            allPlacements={allPlacements}
          />
        </>
      )}
    </div>
  );
};

export default UitstroomAnalyse;
