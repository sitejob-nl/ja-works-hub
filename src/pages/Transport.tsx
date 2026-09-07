import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Link, useNavigate } from 'react-router-dom';
import { Car, Plus, Search, Fuel } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import EntityLink from '@/components/ui/entity-link';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import SortableTableHead from '@/components/ui/sortable-table-head';
import TablePagination from '@/components/ui/table-pagination';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDate } from '@/lib/format';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import TransportFinesTab from '@/components/transport/TransportFinesTab';
import { useAuth } from '@/contexts/AuthContext';
import { fetchFacilityTransportSnapshot, isFacilityRole } from '@/lib/facility';
import { vehicleDisplayStatus } from '@/lib/vehicle-availability';
import { useTableControls } from '@/hooks/useTableControls';
import type { SortableColumn, SortState } from '@/lib/table-sort';


// Bovengrens voor het afgeleide 'Gereserveerd'-filter, dat client-side moet filteren.
const DERIVED_FILTER_SCAN_LIMIT = 500;

// Sorteerbaar zijn de kolommen die één-op-één een voertuigkolom zijn. Status en
// 'Toegewezen aan' bewust niet: de getoonde status is afgeleid ('Gereserveerd' bestaat
// niet als databasewaarde) en de naam komt uit een gejoinde tabel — server-side ordenen
// daarop zou een andere volgorde opleveren dan wat er in de kolom staat.
const SORT_COLUMNS: readonly SortableColumn[] = [
  { key: 'license_plate' },
  {
    key: 'brand',
    orderBy: ['brand', 'model'],
    value: (v: any) => [v.brand, v.model].filter(Boolean).join(' '),
  },
  { key: 'year', defaultDirection: 'desc' },
  { key: 'fuel_type' },
  { key: 'doors', defaultDirection: 'desc' },
  { key: 'current_mileage', defaultDirection: 'desc' },
  { key: 'apk_expiry' },
];

// De facility-rol ziet de tankpaskolom niet; hij mag dus ook niet sorteerbaar opduiken.
const INTERNAL_SORT_COLUMNS: readonly SortableColumn[] = [
  ...SORT_COLUMNS,
  { key: 'fuel_card_reference' },
];

const DEFAULT_SORT: SortState = { column: 'license_plate', direction: 'asc' };

const statusBadge: Record<string, string> = {
  beschikbaar: 'bg-stat-green/10 text-stat-green border-0',
  toegewezen: 'bg-blue-100 text-blue-700 border-0',
  gereserveerd: 'bg-purple-100 text-purple-700 border-0',
  onderhoud: 'bg-orange-100 text-orange-600 border-0',
  uit_dienst: 'bg-muted text-muted-foreground border-0',
};
// 'Non-Actief' i.p.v. 'Uit dienst' (punt 18): die term is bij een medewerker het
// einde van het dienstverband en betekent bij een auto iets heel anders.
// 'gereserveerd' is afgeleid (zie vehicleDisplayStatus) en staat niet in de enum,
// dus ook niet in het statusfilter hieronder.
const statusLabel: Record<string, string> = {
  beschikbaar: 'Beschikbaar', toegewezen: 'Toegewezen', onderhoud: 'Onderhoud', uit_dienst: 'Non-Actief',
};
const displayStatusLabel: Record<string, string> = { ...statusLabel, gereserveerd: 'Gereserveerd' };

const Transport = () => {
  const navigate = useNavigate();
  const { role, profile } = useAuth();
  const isFacility = isFacilityRole(role);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const todayStr = new Date().toISOString().slice(0, 10);
  const hasActiveFilter = search.trim() !== '' || statusFilter !== 'all';

  const sortColumns = useMemo(
    () => (isFacility ? SORT_COLUMNS : INTERNAL_SORT_COLUMNS),
    [isFacility],
  );
  const table = useTableControls({
    columns: sortColumns,
    defaultSort: DEFAULT_SORT,
    // Ordenen op bouwjaar of brandstof laat gelijke rijen anders in willekeurige volgorde
    // staan; met .range() zou een voertuig dan op twee pagina's tegelijk kunnen belanden.
    tiebreak: ['license_plate', 'id'],
  });
  const { page, pageSize, sortRows: sortVehicles, pageSlice, applySort, resetPage } = table;

  const { data: facilitySnapshot, isLoading: isFacilityLoading } = useQuery({
    queryKey: ['facility-transport-snapshot', profile?.organization_id],
    queryFn: () => fetchFacilityTransportSnapshot(),
    enabled: isFacility,
  });

  const { data: internalData, isLoading: isInternalLoading } = useQuery({
    queryKey: ['vehicles', search, statusFilter, page, pageSize, table.sort.column, table.sort.direction, todayStr],
    queryFn: async () => {
      let query = supabase.from('vehicles').select(`
        *,
        vehicle_assignments!vehicle_assignments_vehicle_id_fkey(
          id, assigned_date, returned_date,
          employees!vehicle_assignments_employee_id_fkey(
            id,
            candidates!employees_candidate_id_fkey(first_name, last_name)
          )
        )
      `, { count: 'exact' });

      if (search) query = query.or(`license_plate.ilike.%${search}%,brand.ilike.%${search}%,model.ilike.%${search}%`);

      // "Gereserveerd" is een afgeleide status (een toewijzing die later begint) en staat
      // dus niet in de kolom. Zo'n voertuig heeft in de database gewoon 'beschikbaar', dus
      // die halen we op en filteren en pagineren we hier. Alle andere filters blijven
      // server-side met paginering.
      const isDerivedFilter = statusFilter === 'gereserveerd';
      if (statusFilter !== 'all') {
        query = query.eq('status', (isDerivedFilter ? 'beschikbaar' : statusFilter) as any);
      }
      // Sorteren gebeurt in de database, dus over de héle set — niet over de zichtbare pagina.
      query = applySort(query);
      query = isDerivedFilter
        ? query.limit(DERIVED_FILTER_SCAN_LIMIT)
        : query.range(table.from, table.to);

      const { data, count, error } = await query;
      if (error) throw error;
      if (!isDerivedFilter) return { vehicles: data ?? [], total: count ?? 0 };

      const reserved = (data ?? []).filter(
        (v: any) => vehicleDisplayStatus(v, todayStr).key === 'gereserveerd',
      );
      // Al gesorteerd binnengekomen; het afgeleide filter houdt die volgorde aan.
      return { vehicles: pageSlice(reserved), total: reserved.length };
    },
    enabled: !isFacility,
  });

  const facilityData = useMemo(() => {
    if (!isFacility) return { vehicles: [], total: 0 };
    const normalizedSearch = search.trim().toLocaleLowerCase('nl-NL');
    const filtered = (facilitySnapshot?.vehicles ?? [])
      .filter((vehicle: any) => statusFilter === 'all' || vehicle.status === statusFilter)
      .filter((vehicle: any) => {
        if (!normalizedSearch) return true;
        return [vehicle.license_plate, vehicle.brand, vehicle.model]
          .some((value) => String(value ?? '').toLocaleLowerCase('nl-NL').includes(normalizedSearch));
      });
    // Eerst de volledige gefilterde set sorteren, dan pas de pagina eruit snijden.
    const sorted = sortVehicles(filtered);
    return { vehicles: pageSlice(sorted), total: sorted.length };
  }, [facilitySnapshot, isFacility, pageSlice, search, sortVehicles, statusFilter]);

  const data = isFacility ? facilityData : internalData;
  const isLoading = isFacility ? isFacilityLoading : isInternalLoading;

  const vehicles = data?.vehicles ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  // Stats from all vehicles (unfiltered)
  const { data: allVehicles } = useQuery({
    queryKey: ['vehicles-stats'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicles').select('status');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !isFacility,
  });

  const { data: fuelFlagCount = 0 } = useQuery({
    queryKey: ['fuel-flag-count'],
    queryFn: async () => {
      const { count, error } = await supabase.from('fuel_card_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('reviewed', false)
        .or('flag_over_capacity.eq.true,flag_multiple_same_day.eq.true,flag_excessive_consumption.eq.true');
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !isFacility,
  });

  const { data: internalOpenDamageCount = 0 } = useQuery({
    queryKey: ['damage-open-count'],
    queryFn: async () => {
      const { count, error } = await supabase.from('vehicle_damage_reports')
        .select('id', { count: 'exact', head: true })
        .eq('resolved', false);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !isFacility,
  });

  const openDamageCount = isFacility
    ? (facilitySnapshot?.damage_reports ?? []).filter((report: any) => !report.resolved).length
    : internalOpenDamageCount;

  const stats = useMemo(() => {
    const v = isFacility ? (facilitySnapshot?.vehicles ?? []) : (allVehicles ?? []);
    return {
      total: v.length,
      beschikbaar: v.filter((x: any) => x.status === 'beschikbaar').length,
      toegewezen: v.filter((x: any) => x.status === 'toegewezen').length,
      onderhoud: v.filter((x: any) => x.status === 'onderhoud').length,
    };
  }, [allVehicles, facilitySnapshot, isFacility]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Transport</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isFacility ? 'Voertuigen, toewijzingen en schademeldingen' : 'Voertuigen, toewijzingen en kilometerregistratie'}
          </p>
        </div>
        <div className="flex gap-2">
          {!isFacility && <Button asChild variant="outline" className="gap-2"><Link to="/tankpas-analyse"><Fuel className="h-4 w-4" /> Tankpas analyse</Link></Button>}
          {!isFacility && <Button onClick={() => navigate('/transport/new')} className="gap-2"><Plus className="h-4 w-4" /> Nieuw voertuig</Button>}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        {[
          { label: 'Totaal voertuigen', value: stats.total },
          { label: 'Beschikbaar', value: stats.beschikbaar },
          { label: 'Toegewezen', value: stats.toegewezen },
          { label: 'In onderhoud', value: stats.onderhoud },
        ].map((s) => (
          <div key={s.label} className="bg-card border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="text-lg font-semibold">{s.value}</div>
          </div>
        ))}
        {!isFacility && (
          <Link to="/tankpas-analyse" className={`bg-card border rounded-lg p-3 hover:ring-2 hover:ring-ring transition ${fuelFlagCount > 0 ? 'border-destructive bg-destructive/5' : ''}`}>
            <div className="text-xs text-muted-foreground">Afwijkingen tankpas</div>
            <div className={`text-lg font-semibold ${fuelFlagCount > 0 ? 'text-destructive' : ''}`}>{fuelFlagCount}</div>
          </Link>
        )}
        <div className={`bg-card border rounded-lg p-3 ${openDamageCount > 0 ? 'border-orange-400 bg-orange-50 dark:bg-orange-950/20' : ''}`}>
          <div className="text-xs text-muted-foreground">Open schademeldingen</div>
          <div className={`text-lg font-semibold ${openDamageCount > 0 ? 'text-orange-600' : ''}`}>{openDamageCount}</div>
        </div>
      </div>

      <Tabs defaultValue="voertuigen" className="space-y-4">
        <TabsList>
          <TabsTrigger value="voertuigen">Voertuigen</TabsTrigger>
          {!isFacility && <TabsTrigger value="boetes">Boetes</TabsTrigger>}
        </TabsList>

        <TabsContent value="voertuigen" className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Zoek op kenteken, merk of model..." value={search} onChange={(e) => { setSearch(e.target.value); resetPage(); }} className="pl-9" />
            </div>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); resetPage(); }}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle statussen</SelectItem>
                {Object.entries(displayStatusLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">{total} voertuigen</span>
          </div>

          {!isLoading && vehicles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Car className="h-12 w-12 text-muted-foreground/40 mb-4" />
              {/* Filteren tot nul resultaten is iets anders dan een leeg wagenpark. Eerst
                  stond hier "Voeg je eerste voertuig toe" terwijl er 49 voertuigen zijn. */}
              {hasActiveFilter ? (
                <>
                  <p className="text-lg font-medium text-muted-foreground">Geen voertuigen gevonden</p>
                  <p className="text-sm text-muted-foreground mt-1">Er zijn wel voertuigen, maar geen enkele past bij deze zoekopdracht of dit filter.</p>
                  <Button variant="outline" className="mt-4" onClick={() => { setSearch(''); setStatusFilter('all'); resetPage(); }}>
                    Filters wissen
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-lg font-medium text-muted-foreground">Nog geen voertuigen</p>
                  {!isFacility && <Button onClick={() => navigate('/transport/new')} variant="outline" className="mt-4 gap-2"><Plus className="h-4 w-4" /> Voeg je eerste voertuig toe</Button>}
                </>
              )}
            </div>
          ) : (
            <>
              <div className="bg-card rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableTableHead column="license_plate" sort={table.sort} onSort={table.toggleSort}>Kenteken</SortableTableHead>
                      <SortableTableHead column="brand" sort={table.sort} onSort={table.toggleSort}>Merk / Model</SortableTableHead>
                      <SortableTableHead column="year" sort={table.sort} onSort={table.toggleSort}>Bouwjaar</SortableTableHead>
                      <SortableTableHead column="fuel_type" sort={table.sort} onSort={table.toggleSort}>Brandstof</SortableTableHead>
                      <SortableTableHead column="doors" sort={table.sort} onSort={table.toggleSort} align="right">Deuren</SortableTableHead>
                      <SortableTableHead column="current_mileage" sort={table.sort} onSort={table.toggleSort} align="right">KM-stand</SortableTableHead>
                      <SortableTableHead column="apk_expiry" sort={table.sort} onSort={table.toggleSort}>APK</SortableTableHead>
                      {!isFacility && (
                        <SortableTableHead column="fuel_card_reference" sort={table.sort} onSort={table.toggleSort}>Tankpas</SortableTableHead>
                      )}
                      {/* Status en 'Toegewezen aan' zijn afgeleid resp. gejoind — zie SORT_COLUMNS. */}
                      <TableHead>Status</TableHead>
                      <TableHead>Toegewezen aan</TableHead>
                      {!isFacility && <TableHead>Notitie</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vehicles.map((v: any, i: number) => {
                      const activeAssignment = ((v.assignments ?? v.vehicle_assignments) as any[])?.find((a: any) => !a.returned_date);
                      const assignee = activeAssignment?.employees?.candidates ?? activeAssignment?.worker ?? activeAssignment;
                      return (
                        <TableRow key={v.id} className={i % 2 === 1 ? 'bg-background' : ''}>
                          <TableCell>
                            <Link to={`/transport/${v.id}`} className="font-medium text-foreground hover:text-stat-blue transition-colors">{v.license_plate}</Link>
                          </TableCell>
                          <TableCell>{[v.brand, v.model].filter(Boolean).join(' ') || '—'}</TableCell>
                          <TableCell>{v.year ?? '—'}</TableCell>
                          <TableCell className="capitalize">{v.fuel_type ?? '—'}</TableCell>
                          <TableCell className="text-right">{v.doors ?? '—'}</TableCell>
                          <TableCell className="text-right">{v.current_mileage != null ? v.current_mileage.toLocaleString('nl-NL') : '—'}</TableCell>
                          <TableCell>
                            {(() => {
                              if (!v.apk_expiry) return <span className="text-muted-foreground">—</span>;
                              const days = (() => { try { return differenceInCalendarDays(parseISO(v.apk_expiry), new Date()); } catch { return null; } })();
                              const variant = days != null && days < 0 ? 'destructive' : days != null && days < 60 ? 'secondary' : null;
                              return (
                                <span className="flex items-center gap-2 text-xs">
                                  <span>{formatDate(v.apk_expiry)}</span>
                                  {variant && <Badge variant={variant} className="text-[10px]">{days! < 0 ? `${Math.abs(days!)}d verlopen` : `${days}d`}</Badge>}
                                </span>
                              );
                            })()}
                          </TableCell>
                          {!isFacility && <TableCell className="font-mono text-xs">{v.fuel_card_reference ?? '—'}</TableCell>}
                          <TableCell>
                            {(() => {
                              const display = vehicleDisplayStatus(v, todayStr);
                              return (
                                <span className="flex items-center gap-1.5">
                                  <Badge variant="secondary" className={statusBadge[display.key] ?? ''}>
                                    {displayStatusLabel[display.key] ?? display.key}
                                  </Badge>
                                  {display.reservedFrom && (
                                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">vanaf {formatDate(display.reservedFrom)}</span>
                                  )}
                                </span>
                              );
                            })()}
                          </TableCell>
                          <TableCell>{assignee ? (
                            isFacility
                              ? <span>{assignee.first_name} {assignee.last_name}</span>
                              : <EntityLink type="employee" id={activeAssignment?.employees?.id}>{assignee.first_name} {assignee.last_name}</EntityLink>
                          ) : '—'}</TableCell>
                          {!isFacility && <TableCell className="max-w-[200px]">
                            {v.notes ? (
                              <span className="text-xs text-muted-foreground truncate block" title={v.notes}>{v.notes}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <TablePagination
                page={page}
                totalPages={totalPages}
                onPageChange={table.setPage}
                pageSize={pageSize}
                onPageSizeChange={table.setPageSize}
              />
            </>
          )}
        </TabsContent>

        {!isFacility && (
          <TabsContent value="boetes">
            <TransportFinesTab />
          </TabsContent>
        )}
      </Tabs>

      
    </div>
  );
};

export default Transport;
