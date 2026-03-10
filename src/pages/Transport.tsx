import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Link } from 'react-router-dom';
import { Car, Plus, Search, Fuel } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import VehicleSlideOver from '@/components/transport/VehicleSlideOver';

const PAGE_SIZE = 10;

const statusBadge: Record<string, string> = {
  beschikbaar: 'bg-stat-green/10 text-stat-green border-0',
  toegewezen: 'bg-blue-100 text-blue-700 border-0',
  onderhoud: 'bg-orange-100 text-orange-600 border-0',
  uit_dienst: 'bg-muted text-muted-foreground border-0',
};
const statusLabel: Record<string, string> = {
  beschikbaar: 'Beschikbaar', toegewezen: 'Toegewezen', onderhoud: 'Onderhoud', uit_dienst: 'Uit dienst',
};

const Transport = () => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [slideOverOpen, setSlideOverOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['vehicles', search, statusFilter, page],
    queryFn: async () => {
      let query = supabase.from('vehicles').select(`
        *,
        vehicle_assignments!vehicle_assignments_vehicle_id_fkey(
          id, returned_date,
          employees!vehicle_assignments_employee_id_fkey(
            id,
            candidates!employees_candidate_id_fkey(first_name, last_name)
          )
        )
      `, { count: 'exact' });

      if (search) query = query.or(`license_plate.ilike.%${search}%,brand.ilike.%${search}%,model.ilike.%${search}%`);
      if (statusFilter !== 'all') query = query.eq('status', statusFilter as any);

      query = query.order('license_plate').range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      const { data, count, error } = await query;
      if (error) throw error;
      return { vehicles: data ?? [], total: count ?? 0 };
    },
  });

  const vehicles = data?.vehicles ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Stats from all vehicles (unfiltered)
  const { data: allVehicles } = useQuery({
    queryKey: ['vehicles-stats'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicles').select('status');
      if (error) throw error;
      return data ?? [];
    },
  });

  const stats = useMemo(() => {
    const v = allVehicles ?? [];
    return {
      total: v.length,
      beschikbaar: v.filter((x: any) => x.status === 'beschikbaar').length,
      toegewezen: v.filter((x: any) => x.status === 'toegewezen').length,
      onderhoud: v.filter((x: any) => x.status === 'onderhoud').length,
    };
  }, [allVehicles]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Transport</h1>
          <p className="text-muted-foreground text-sm mt-1">Voertuigen, toewijzingen en kilometerregistratie</p>
        </div>
        <Button onClick={() => setSlideOverOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> Nieuw voertuig</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Zoek op kenteken, merk of model..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle statussen</SelectItem>
            {Object.entries(statusLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{total} voertuigen</span>
      </div>

      {!isLoading && vehicles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Car className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-lg font-medium text-muted-foreground">Nog geen voertuigen</p>
          <Button onClick={() => setSlideOverOpen(true)} variant="outline" className="mt-4 gap-2"><Plus className="h-4 w-4" /> Voeg je eerste voertuig toe</Button>
        </div>
      ) : (
        <>
          <div className="bg-card rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kenteken</TableHead>
                  <TableHead>Merk / Model</TableHead>
                  <TableHead>Bouwjaar</TableHead>
                  <TableHead>Brandstof</TableHead>
                  <TableHead className="text-right">KM-stand</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Toegewezen aan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicles.map((v: any, i: number) => {
                  const activeAssignment = (v.vehicle_assignments as any[])?.find((a: any) => !a.returned_date);
                  const assignee = activeAssignment?.employees?.candidates as any;
                  return (
                    <TableRow key={v.id} className={i % 2 === 1 ? 'bg-background' : ''}>
                      <TableCell>
                        <Link to={`/transport/${v.id}`} className="font-medium text-foreground hover:text-primary transition-colors">{v.license_plate}</Link>
                      </TableCell>
                      <TableCell>{[v.brand, v.model].filter(Boolean).join(' ') || '—'}</TableCell>
                      <TableCell>{v.year ?? '—'}</TableCell>
                      <TableCell>{v.fuel_type ?? '—'}</TableCell>
                      <TableCell className="text-right">{v.current_mileage != null ? v.current_mileage.toLocaleString('nl-NL') : '—'}</TableCell>
                      <TableCell><Badge variant="secondary" className={statusBadge[v.status] ?? ''}>{statusLabel[v.status] ?? v.status}</Badge></TableCell>
                      <TableCell>{assignee ? `${assignee.first_name} ${assignee.last_name}` : '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {totalPages > 1 && (
            <Pagination>
              <PaginationContent>
                <PaginationItem><PaginationPrevious onClick={() => setPage(Math.max(0, page - 1))} className={page === 0 ? 'pointer-events-none opacity-50' : 'cursor-pointer'} /></PaginationItem>
                {Array.from({ length: totalPages }, (_, i) => (
                  <PaginationItem key={i}><PaginationLink isActive={i === page} onClick={() => setPage(i)} className="cursor-pointer">{i + 1}</PaginationLink></PaginationItem>
                ))}
                <PaginationItem><PaginationNext onClick={() => setPage(Math.min(totalPages - 1, page + 1))} className={page >= totalPages - 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'} /></PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </>
      )}

      <VehicleSlideOver open={slideOverOpen} onOpenChange={setSlideOverOpen} />
    </div>
  );
};

export default Transport;
