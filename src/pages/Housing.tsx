import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Link } from 'react-router-dom';
import { Home, Plus, Search, LayoutGrid, List, Bed, Building2, ArrowUpDown, CheckCircle2, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import PropertySlideOver from '@/components/housing/PropertySlideOver';
import AvailabilityChart from '@/components/housing/AvailabilityChart';
import ExportPropertiesButton from '@/components/housing/ExportPropertiesButton';
import { formatEUR } from '@/lib/format';

const ALL_CITIES = '__all__';
const WEEKS_PER_MONTH = 4.33;

type SortKey =
  | 'address_asc'
  | 'address_desc'
  | 'name_asc'
  | 'free_desc'
  | 'free_asc'
  | 'occupancy_desc'
  | 'occupancy_asc'
  | 'capacity_desc'
  | 'capacity_asc';

const SORT_LABELS: Record<SortKey, string> = {
  address_asc: 'Adres (A → Z)',
  address_desc: 'Adres (Z → A)',
  name_asc: 'Naam (A → Z)',
  free_desc: 'Vrije plekken (meeste)',
  free_asc: 'Vrije plekken (minste)',
  occupancy_desc: 'Bezetting % (hoog)',
  occupancy_asc: 'Bezetting % (laag)',
  capacity_desc: 'Capaciteit (groot)',
  capacity_asc: 'Capaciteit (klein)',
};

const Housing = () => {
  const [search, setSearch] = useState('');
  const [city, setCity] = useState<string>(ALL_CITIES);
  const [sort, setSort] = useState<SortKey>('address_asc');
  const [view, setView] = useState<string>('cards');
  const [sheetOpen, setSheetOpen] = useState(false);

  // Fetch alle panden eenmaal — filtering doen we client-side voor snappy UX en
  // omdat de tellers (capaciteit/bezetting) altijd over de complete set moeten.
  const { data: allProperties = [], isLoading } = useQuery({
    queryKey: ['properties'],
    queryFn: async () => {
      const { data, error } = await supabase.from('properties').select(`
        *,
        property_owners(name),
        units!units_property_id_fkey(
          id, capacity, status,
          housing_assignments!housing_assignments_unit_id_fkey(id, status)
        )
      `).order('address_city').order('address_street');
      if (error) throw error;
      return (data ?? []).map((p: any) => {
        const units = p.units ?? [];
        const totalCapacity = units.reduce((s: number, u: any) => s + (u.capacity ?? 0), 0);
        const currentOccupancy = units.reduce((s: number, u: any) =>
          s + ((u.housing_assignments ?? []).filter((a: any) => a.status === 'ingecheckt').length), 0);
        const percentage = totalCapacity > 0 ? Math.round((currentOccupancy / totalCapacity) * 100) : 0;
        return { ...p, totalCapacity, currentOccupancy, percentage };
      });
    },
  });

  const { data: cleaningTasks = [] } = useQuery({
    queryKey: ['housing-cleaning-overview'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('housing_cleaning_tasks' as any)
        .select('id, title, due_date, priority, property_id, properties(name, address_street, address_city)')
        .in('status', ['open', 'in_progress'])
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(5);
      if (error) throw error;
      return data as any[];
    },
  });

  const cities = useMemo(() => {
    const set = new Set<string>();
    allProperties.forEach((p: any) => { if (p.address_city) set.add(p.address_city); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'nl'));
  }, [allProperties]);

  const properties = useMemo(() => {
    const s = search.trim().toLowerCase();
    const filtered = allProperties.filter((p: any) => {
      if (city !== ALL_CITIES && p.address_city !== city) return false;
      if (s) {
        const haystack = [p.name, p.address_street, p.address_city, p.address_postal]
          .filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(s)) return false;
      }
      return true;
    });

    const cmpAddress = (a: any, b: any) => {
      const cityCmp = (a.address_city ?? '').localeCompare(b.address_city ?? '', 'nl');
      if (cityCmp !== 0) return cityCmp;
      return (a.address_street ?? '').localeCompare(b.address_street ?? '', 'nl');
    };
    const free = (p: any) => (p.totalCapacity ?? 0) - (p.currentOccupancy ?? 0);
    const labelOf = (p: any) => p.name || `${p.address_street ?? ''} ${p.address_city ?? ''}`;

    const sorted = [...filtered];
    switch (sort) {
      case 'address_asc': sorted.sort(cmpAddress); break;
      case 'address_desc': sorted.sort((a, b) => -cmpAddress(a, b)); break;
      case 'name_asc': sorted.sort((a, b) => labelOf(a).localeCompare(labelOf(b), 'nl')); break;
      case 'free_desc': sorted.sort((a, b) => free(b) - free(a) || cmpAddress(a, b)); break;
      case 'free_asc': sorted.sort((a, b) => free(a) - free(b) || cmpAddress(a, b)); break;
      case 'occupancy_desc': sorted.sort((a, b) => (b.percentage ?? 0) - (a.percentage ?? 0) || cmpAddress(a, b)); break;
      case 'occupancy_asc': sorted.sort((a, b) => (a.percentage ?? 0) - (b.percentage ?? 0) || cmpAddress(a, b)); break;
      case 'capacity_desc': sorted.sort((a, b) => (b.totalCapacity ?? 0) - (a.totalCapacity ?? 0) || cmpAddress(a, b)); break;
      case 'capacity_asc': sorted.sort((a, b) => (a.totalCapacity ?? 0) - (b.totalCapacity ?? 0) || cmpAddress(a, b)); break;
    }
    return sorted;
  }, [allProperties, search, city, sort]);

  const getBarColor = (pct: number) => {
    if (pct >= 90) return 'bg-red-500';
    if (pct >= 70) return 'bg-orange-500';
    return 'bg-stat-green';
  };

  const getPctBadge = (pct: number) => {
    if (pct >= 90) return 'bg-red-100 text-red-600 border-0';
    if (pct >= 70) return 'bg-orange-100 text-orange-600 border-0';
    return 'bg-stat-green/10 text-stat-green border-0';
  };

  const totalCapacity = properties.reduce((s: number, p: any) => s + (p.totalCapacity ?? 0), 0);
  const totalOccupancy = properties.reduce((s: number, p: any) => s + (p.currentOccupancy ?? 0), 0);
  const totalAvailable = totalCapacity - totalOccupancy;
  const overallPct = totalCapacity > 0 ? Math.round((totalOccupancy / totalCapacity) * 100) : 0;
  const totalMonthlyCost = properties.reduce((sum: number, p: any) => {
    return sum
      + (Number(p.monthly_rent) || 0)
      + (Number(p.cost_gas) || 0)
      + (Number(p.cost_water) || 0)
      + (Number(p.cost_electra) || 0)
      + (Number(p.cost_municipal_tax) || 0)
      + (Number(p.cost_other) || 0);
  }, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Huisvesting</h1>
          <p className="text-muted-foreground text-sm mt-1">Beheer panden, kamers en toewijzingen</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportPropertiesButton
            properties={properties}
            filenameSuffix={city !== ALL_CITIES ? city : undefined}
          />
          <Button onClick={() => setSheetOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Nieuw pand
          </Button>
        </div>
      </div>

      {/* Top KPIs — focus op vrije plekken (klant-wens 2026-04-25) */}
      {properties.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6 flex items-center gap-4">
              <div className="h-10 w-10 rounded-md bg-stat-green/10 flex items-center justify-center">
                <Bed className="h-5 w-5 text-stat-green" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalAvailable}</p>
                <p className="text-xs text-muted-foreground">Vrije plekken nu</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 flex items-center gap-4">
              <div className="h-10 w-10 rounded-md bg-blue-100 flex items-center justify-center">
                <Building2 className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalCapacity}</p>
                <p className="text-xs text-muted-foreground">Totale capaciteit · {properties.length} panden</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 flex items-center gap-4">
              <div className={`h-10 w-10 rounded-md flex items-center justify-center ${overallPct >= 90 ? 'bg-red-100' : overallPct >= 70 ? 'bg-orange-100' : 'bg-stat-green/10'}`}>
                <Home className={`h-5 w-5 ${overallPct >= 90 ? 'text-red-600' : overallPct >= 70 ? 'text-orange-600' : 'text-stat-green'}`} />
              </div>
              <div>
                <p className="text-2xl font-bold">{overallPct}%</p>
                <p className="text-xs text-muted-foreground">Bezettingsgraad ({totalOccupancy}/{totalCapacity})</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 flex items-center gap-4">
              <div className="h-10 w-10 rounded-md bg-purple-100 flex items-center justify-center">
                <Wallet className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{formatEUR(totalMonthlyCost)}</p>
                <p className="text-xs text-muted-foreground">Totale maandlasten · ~{formatEUR(totalMonthlyCost / WEEKS_PER_MONTH)}/wk</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {properties.length > 0 && totalCapacity > 0 && (
        <AvailabilityChart totalCapacity={totalCapacity} />
      )}

      {cleaningTasks.length > 0 && (
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Open schoonmaaktaken</h2>
            </div>
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {cleaningTasks.map((task: any) => {
                const property = task.properties;
                const label = property?.name || [property?.address_street, property?.address_city].filter(Boolean).join(', ');
                return (
                  <Link key={task.id} to={`/huisvesting/${task.property_id}`} className="rounded-md border p-3 hover:bg-muted/50 transition">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{task.title}</p>
                        <p className="text-xs text-muted-foreground">{label || 'Pand'}</p>
                      </div>
                      <Badge variant="secondary" className={task.priority === 'high' ? 'bg-red-100 text-red-700 border-0' : 'bg-yellow-100 text-yellow-700 border-0'}>
                        {task.priority}
                      </Badge>
                    </div>
                    {task.due_date && <p className="text-xs text-muted-foreground mt-2">Deadline {new Date(task.due_date).toLocaleDateString('nl-NL')}</p>}
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Zoek op naam, straat of stad..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={city} onValueChange={setCity}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Plaats" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CITIES}>Alle plaatsen</SelectItem>
            {cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-52 gap-1.5">
            <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <SelectItem key={k} value={k}>{SORT_LABELS[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v)}>
          <ToggleGroupItem value="cards" aria-label="Kaarten"><LayoutGrid className="h-4 w-4" /></ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="Lijst"><List className="h-4 w-4" /></ToggleGroupItem>
        </ToggleGroup>
        <span className="text-sm text-muted-foreground">
          {properties.length} {properties.length === 1 ? 'pand' : 'panden'}
          {properties.length !== allProperties.length && ` van ${allProperties.length}`}
        </span>
      </div>

      {!isLoading && properties.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Home className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-lg font-medium text-muted-foreground">Nog geen panden</p>
          <Button onClick={() => setSheetOpen(true)} variant="outline" className="mt-4 gap-2">
            <Plus className="h-4 w-4" /> Voeg je eerste pand toe
          </Button>
        </div>
      ) : view === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {properties.map((p: any) => (
            <Link key={p.id} to={`/huisvesting/${p.id}`} className="bg-card rounded-lg border p-5 hover:shadow-md transition-shadow block">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <p className="font-medium">{p.name || [p.address_street, p.address_city].filter(Boolean).join(', ')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {[p.address_street, p.address_postal, p.address_city].filter(Boolean).join(', ')}
                  </p>
                </div>
                {!p.is_active && <Badge variant="secondary" className="bg-muted text-muted-foreground border-0 text-xs">Inactief</Badge>}
              </div>
              <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                <div className={`absolute inset-y-0 left-0 rounded-full ${getBarColor(p.percentage)}`} style={{ width: `${p.percentage}%` }} />
              </div>
              <p className="text-xs text-muted-foreground mt-2">{p.currentOccupancy} van {p.totalCapacity} bezet — {p.percentage}%</p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="bg-card rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pand</TableHead>
                <TableHead>Adres</TableHead>
                <TableHead className="text-right">Capaciteit</TableHead>
                <TableHead className="text-right">Bezet</TableHead>
                <TableHead className="text-right">Beschikbaar</TableHead>
                <TableHead>Bezettingsgraad</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {properties.map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link to={`/huisvesting/${p.id}`} className="font-medium text-foreground hover:text-primary transition-colors">{p.name || [p.address_street, p.address_city].filter(Boolean).join(', ')}</Link>
                  </TableCell>
                  <TableCell className="text-sm">{[p.address_street, p.address_city].filter(Boolean).join(', ') || '—'}</TableCell>
                  <TableCell className="text-right">{p.totalCapacity}</TableCell>
                  <TableCell className="text-right">{p.currentOccupancy}</TableCell>
                  <TableCell className="text-right">{p.totalCapacity - p.currentOccupancy}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={getPctBadge(p.percentage)}>{p.percentage}%</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <PropertySlideOver open={sheetOpen} onOpenChange={setSheetOpen} />
    </div>
  );
};

export default Housing;
