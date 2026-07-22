import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePortal } from '@/contexts/PortalContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock, Mail, MapPin, Phone, ChevronDown, ChevronUp } from 'lucide-react';
import { formatDate } from '@/lib/format';

const statusColors: Record<string, string> = {
  actief: 'bg-stat-green/10 text-stat-green border-0',
  gepland: 'bg-blue-100 text-blue-700 border-0',
  afgerond: 'bg-muted text-muted-foreground border-0',
  voortijdig_beeindigd: 'bg-red-100 text-red-600 border-0',
};

const statusLabels: Record<string, string> = {
  actief: 'Actief',
  gepland: 'Gepland',
  afgerond: 'Afgerond',
  voortijdig_beeindigd: 'Voortijdig beëindigd',
};

const PortalPlacements = () => {
  const { employee } = usePortal();
  const employeeId = employee?.id;
  const [showPast, setShowPast] = useState(false);

  const { data: placements = [], isLoading } = useQuery({
    queryKey: ['portal-all-placements', employeeId],
    queryFn: async () => {
      const { data } = await supabase
        .from('placements')
        .select('*, companies!placements_company_id_fkey(name, address_city, phone, email)')
        .eq('candidate_id', employeeId!)
        .order('start_date', { ascending: false });
      return data ?? [];
    },
    enabled: !!employeeId,
  });

  const activePlacements = placements.filter(
    (p: any) => p.status === 'actief' || p.status === 'gepland'
  );
  const pastPlacements = placements.filter(
    (p: any) => p.status === 'afgerond' || p.status === 'voortijdig_beeindigd'
  );

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (placements.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <MapPin className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-lg font-semibold">Je hebt nog geen plaatsingen.</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Zodra je geplaatst wordt bij een opdrachtgever zie je dat hier terug.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Mijn plaatsingen</h1>

      {/* Active placements */}
      {activePlacements.map((p: any) => (
        <Card key={p.id} className="border-primary/20">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{p.companies?.name ?? 'Onbekend bedrijf'}</CardTitle>
              <Badge variant="secondary" className={statusColors[p.status] ?? ''}>
                {statusLabels[p.status] ?? p.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {p.function_name && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Functie</span>
                <span className="font-medium">{p.function_name}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Periode</span>
              <span className="font-medium">
                {formatDate(p.start_date)} — {p.end_date ? formatDate(p.end_date) : 'heden'}
              </span>
            </div>
            {p.work_location && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Werklocatie</span>
                <span className="font-medium">{p.work_location}</span>
              </div>
            )}
            {p.work_days && p.work_days.length > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Werkdagen</span>
                <span className="font-medium">{p.work_days.join(', ')}</span>
              </div>
            )}
            {/* salary_indication is vrije tekst ("EUR 20 per uur", "3000-4000"), geen bedrag —
                door formatEUR halen gaf "€ NaN". */}
            {p.salary_indication && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Salarisindicatie</span>
                <span className="font-medium">{p.salary_indication}</span>
              </div>
            )}
            {p.companies?.address_city && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Stad</span>
                <span className="font-medium">{p.companies.address_city}</span>
              </div>
            )}
            {p.companies?.phone && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Telefoon</span>
                <a className="font-medium hover:underline" href={`tel:${p.companies.phone}`}>{p.companies.phone}</a>
              </div>
            )}
            {p.companies?.email && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">E-mail</span>
                <a className="font-medium hover:underline" href={`mailto:${p.companies.email}`}>{p.companies.email}</a>
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              <Button asChild size="sm" variant="outline" className="gap-1.5">
                <Link to="/portaal/uren"><Clock className="h-3.5 w-3.5" /> Uren</Link>
              </Button>
              {p.companies?.phone && (
                <Button asChild size="sm" variant="outline" className="gap-1.5">
                  <a href={`tel:${p.companies.phone}`}><Phone className="h-3.5 w-3.5" /> Bel</a>
                </Button>
              )}
              {p.companies?.email && (
                <Button asChild size="sm" variant="outline" className="gap-1.5">
                  <a href={`mailto:${p.companies.email}`}><Mail className="h-3.5 w-3.5" /> Mail</a>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Past placements toggle */}
      {pastPlacements.length > 0 && (
        <>
          <Button
            variant="ghost"
            className="w-full justify-between text-muted-foreground"
            onClick={() => setShowPast(!showPast)}
          >
            <span>Toon vorige plaatsingen ({pastPlacements.length})</span>
            {showPast ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>

          {showPast && (
            <div className="bg-card rounded-xl border divide-y">
              {pastPlacements.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between px-4 py-3">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">{p.companies?.name ?? 'Onbekend bedrijf'}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.function_name && `${p.function_name} · `}
                      {formatDate(p.start_date)} — {p.end_date ? formatDate(p.end_date) : '—'}
                    </p>
                  </div>
                  <Badge variant="secondary" className={`text-[10px] ${statusColors[p.status] ?? ''}`}>
                    {statusLabels[p.status] ?? p.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PortalPlacements;
