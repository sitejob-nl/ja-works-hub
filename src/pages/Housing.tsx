import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Link } from 'react-router-dom';
import { Home, Plus, Search, LayoutGrid, List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import PropertySlideOver from '@/components/housing/PropertySlideOver';

const Housing = () => {
  const [search, setSearch] = useState('');
  const [view, setView] = useState<string>('cards');
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data: properties = [], isLoading } = useQuery({
    queryKey: ['properties', search],
    queryFn: async () => {
      let query = supabase.from('properties').select(`
        *,
        units!units_property_id_fkey(
          id, capacity, status,
          housing_assignments!housing_assignments_unit_id_fkey(id, status)
        )
      `).order('name');
      if (search) query = query.or(`name.ilike.%${search}%,address_city.ilike.%${search}%`);
      const { data, error } = await query;
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Huisvesting</h1>
          <p className="text-muted-foreground text-sm mt-1">Beheer panden, kamers en toewijzingen</p>
        </div>
        <Button onClick={() => setSheetOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Nieuw pand
        </Button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Zoek op naam of stad..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v)}>
          <ToggleGroupItem value="cards" aria-label="Kaarten"><LayoutGrid className="h-4 w-4" /></ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="Lijst"><List className="h-4 w-4" /></ToggleGroupItem>
        </ToggleGroup>
        <span className="text-sm text-muted-foreground">{properties.length} panden</span>
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
