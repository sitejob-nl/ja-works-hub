import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { GitCompareArrows, Search, User, Building2, Briefcase, Star } from 'lucide-react';
import { cn } from '@/lib/utils';

const COLUMNS = [
  { key: 'nieuwe_match', label: 'Nieuwe match', color: 'bg-amber-500' },
  { key: 'gescreend', label: 'Gescreend', color: 'bg-cyan-500' },
  { key: 'voorgesteld', label: 'Voorgesteld', color: 'bg-slate-400' },
  { key: 'voorgesteld_bij_klant', label: 'Bij klant', color: 'bg-indigo-500' },
  { key: 'in_gesprek', label: 'In gesprek', color: 'bg-blue-500' },
  { key: 'geaccepteerd', label: 'Geaccepteerd', color: 'bg-emerald-500' },
  { key: 'afgewezen', label: 'Afgewezen', color: 'bg-red-500' },
] as const;

const sourceLabel: Record<string, string> = {
  sollicitatie: 'Sollicitatie',
  intern_gematcht: 'Intern',
  jobmarket: 'Jobmarket',
  extern: 'Extern',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
};

const MatchPipeline = () => {
  const orgId = useOrganizationId();
  const [search, setSearch] = useState('');
  const [vacancyFilter, setVacancyFilter] = useState('all');

  const { data: matches = [], isLoading } = useQuery({
    queryKey: ['match-pipeline', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matches')
        .select('*, candidates!matches_candidate_id_fkey(id, first_name, last_name, phone, compliance_status), vacancies!matches_vacancy_id_fkey(id, title, companies!vacancies_company_id_fkey(id, name))')
        .eq('organization_id', orgId)
        .neq('status', 'geplaatst')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Get unique vacancies for filter
  const vacancies = Array.from(
    new Map((matches as any[]).map((m: any) => [m.vacancies?.id, m.vacancies]).filter(([id]: any) => id)).values()
  );

  // Filter matches
  const filtered = (matches as any[]).filter((m: any) => {
    if (vacancyFilter !== 'all' && m.vacancy_id !== vacancyFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      const name = `${m.candidates?.first_name ?? ''} ${m.candidates?.last_name ?? ''}`.toLowerCase();
      const vacancy = m.vacancies?.title?.toLowerCase() ?? '';
      const company = (m.vacancies?.companies as any)?.name?.toLowerCase() ?? '';
      if (!name.includes(s) && !vacancy.includes(s) && !company.includes(s)) return false;
    }
    return true;
  });

  // Group by status
  const grouped: Record<string, any[]> = {};
  for (const col of COLUMNS) grouped[col.key] = [];
  for (const m of filtered) {
    if (grouped[m.status]) grouped[m.status].push(m);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Match Pipeline</h1>
          <Badge variant="secondary" className="ml-2">{filtered.length} matches</Badge>
        </div>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Zoek op naam, vacature of bedrijf..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={vacancyFilter} onValueChange={setVacancyFilter}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Vacature" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle vacatures</SelectItem>
            {vacancies.map((v: any) => <SelectItem key={v.id} value={v.id}>{v.title}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-center py-12">Laden...</div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {COLUMNS.map(col => (
            <div key={col.key} className="flex-shrink-0 w-64">
              <div className="flex items-center gap-2 mb-3">
                <div className={cn('w-2 h-2 rounded-full', col.color)} />
                <span className="text-sm font-medium">{col.label}</span>
                <Badge variant="outline" className="text-xs ml-auto">{grouped[col.key].length}</Badge>
              </div>
              <div className="space-y-2 min-h-[200px]">
                {grouped[col.key].map((m: any) => (
                  <MatchCard key={m.id} match={m} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function MatchCard({ match }: { match: any }) {
  const candidate = match.candidates;
  const vacancy = match.vacancies;
  const company = vacancy?.companies as any;

  return (
    <Card className="hover:shadow-md transition-shadow cursor-pointer">
      <CardContent className="p-3 space-y-2">
        <Link to={`/vacatures/${vacancy?.id}`} className="block">
          <div className="flex items-start justify-between gap-1">
            <div className="flex items-center gap-1.5 text-sm font-medium truncate">
              <User className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span className="truncate">{candidate?.first_name} {candidate?.last_name}</span>
            </div>
            {match.match_score != null && (
              <div className="flex items-center gap-0.5 text-xs text-amber-600 flex-shrink-0">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                {Math.round(match.match_score)}%
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
            <Briefcase className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{vacancy?.title ?? '—'}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Building2 className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{company?.name ?? '—'}</span>
          </div>
        </Link>
        {match.source && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {sourceLabel[match.source] ?? match.source}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

export default MatchPipeline;
