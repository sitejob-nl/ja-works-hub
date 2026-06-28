import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { unwrap } from '@/lib/db';
import { getDrivingDistance } from '@/lib/distance';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { toast } from 'sonner';
import { formatDate } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import {
  isLikelyVehiclePlateReference, normalizeVehicleRef, appendFlagNote,
  isoDate, countWorkDays, haversineKm,
} from '@/lib/fuel-analysis';
import type { FuelAnalysisConditions } from '@/lib/fuel-analysis';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import Papa from 'papaparse';
import { addDays } from 'date-fns';
import { readExcelObjects } from '@/lib/spreadsheet';

type ColMap = {
  datum: string;
  kenteken: string;
  kaartnummer: string;
  liters: string;
  bedrag: string;
  prijs: string;
  station: string;
};

const EMPTY_COL_MAP: ColMap = { datum: '', kenteken: '', kaartnummer: '', liters: '', bedrag: '', prijs: '', station: '' };
const Q8_CARD_COLUMN = 'Kaartnummer';
const Q8_PLATE_COLUMN = 'Kentekenplaat';
const Q8_REFERENCE_COLUMN = 'Referentie kaartgebruik';
const Q8_SIGNATURE = [Q8_CARD_COLUMN, 'Hoeveelheid', 'transactie datum'];
const q8PresetForHeaders = (headers: string[]): ColMap => ({
  datum: 'transactie datum',
  kenteken: headers.includes(Q8_REFERENCE_COLUMN) ? Q8_REFERENCE_COLUMN : Q8_PLATE_COLUMN,
  kaartnummer: headers.includes(Q8_CARD_COLUMN) ? Q8_CARD_COLUMN : '',
  liters: 'Hoeveelheid',
  bedrag: 'Bedrag incl BTW',
  prijs: 'Pompprijs incl. BTW',
  station: 'Site',
});

type ExistingImport = { id: string; file_name: string | null; transaction_count: number; created_at: string };

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export const ImportSheet = ({ open, onOpenChange, orgId, conditions, onDone }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  orgId: string | null;
  conditions: FuelAnalysisConditions;
  onDone: () => void;
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [colMap, setColMap] = useState<ColMap>(EMPTY_COL_MAP);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; flags: number; kmUpdates: number; fuelCardUpdates: number } | null>(null);
  const [autoDetected, setAutoDetected] = useState(false);
  const [fileMeta, setFileMeta] = useState<{ name: string; hash: string } | null>(null);
  const [existing, setExisting] = useState<ExistingImport | null>(null);

  const reset = () => {
    setStep(1); setRows([]); setHeaders([]);
    setColMap(EMPTY_COL_MAP);
    setResult(null); setAutoDetected(false); setFileMeta(null); setExisting(null);
  };

  const handleFile = async (file: File) => {
    if (!orgId) return;
    const buffer = await file.arrayBuffer();
    const hash = await sha256Hex(buffer);
    setFileMeta({ name: file.name, hash });

    // Duplicate-check tegen fuel_card_imports
    const { data: dup } = await supabase
      .from('fuel_card_imports')
      .select('id, file_name, transaction_count, created_at')
      .eq('organization_id', orgId)
      .eq('file_hash', hash)
      .maybeSingle();
    if (dup) {
      setExisting(dup as ExistingImport);
    } else {
      setExisting(null);
    }

    if (/\.xls$/i.test(file.name) && !/\.xlsx$/i.test(file.name)) {
      toast.error('Oude .xls-bestanden worden niet ondersteund. Sla het bestand op als .xlsx of CSV.');
      return;
    }

    const isExcel = /\.xlsx$/i.test(file.name);
    if (isExcel) {
      try {
        const { headers: headersList, rows: stringRows } = await readExcelObjects(buffer);
        if (stringRows.length === 0) {
          toast.error('Excel-bestand bevat geen data');
          return;
        }
        setHeaders(headersList);
        setRows(stringRows);

        const isQ8 = Q8_SIGNATURE.every((h) => headersList.includes(h))
          && (headersList.includes(Q8_REFERENCE_COLUMN) || headersList.includes(Q8_PLATE_COLUMN));
        if (isQ8) {
          setColMap(q8PresetForHeaders(headersList));
          setAutoDetected(true);
          setStep(3);
        } else {
          setAutoDetected(false);
          setStep(2);
        }
      } catch {
        toast.error('Excel parse fout');
      }
      return;
    }

    // CSV-pad
    const text = new TextDecoder().decode(buffer);
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const fields = res.meta.fields ?? [];
        setHeaders(fields);
        setRows(res.data as Record<string, string>[]);
        const isQ8 = Q8_SIGNATURE.every((h) => fields.includes(h))
          && (fields.includes(Q8_REFERENCE_COLUMN) || fields.includes(Q8_PLATE_COLUMN));
        if (isQ8) {
          setColMap(q8PresetForHeaders(fields));
          setAutoDetected(true);
          setStep(3);
        } else {
          setAutoDetected(false);
          setStep(2);
        }
      },
      error: () => toast.error('CSV parse fout'),
    });
  };

  const handleImport = async () => {
    if (!orgId) return;
    setImporting(true);
    const batchId = crypto.randomUUID();

    try {
      // Vervang oude import als duplicate werd gedetecteerd
      if (existing) {
        await unwrap(supabase.from('fuel_card_transactions').delete().eq('import_batch_id', existing.id));
        await unwrap(supabase.from('fuel_card_imports').delete().eq('id', existing.id));
      }

      // Fetch vehicles, active assignments and active placements for matching.
      const { data: vehicles } = await supabase.from('vehicles').select('id, license_plate, fuel_card_reference, tank_capacity_liters, avg_consumption_per_100km, current_mileage').eq('organization_id', orgId);
      const { data: assignments } = await supabase
        .from('vehicle_assignments')
        .select('vehicle_id, employee_id, employees(id, candidate_id, candidates(first_name, last_name, address_lat, address_lng))')
        .is('returned_date', null);
      const { data: placements } = await supabase
        .from('placements')
        .select('id, candidate_id, employee_id, start_date, end_date, status, work_days, work_location, companies!placements_company_id_fkey(name, address_lat, address_lng, visit_address_lat, visit_address_lng)')
        .eq('organization_id', orgId)
        .in('status', ['actief', 'gepland']);

      const vehicleByPlate: Record<string, any> = {};
      const vehicleByRef: Record<string, any> = {};
      const vehicleById: Record<string, any> = {};
      (vehicles ?? []).forEach(v => {
        vehicleById[v.id] = v;
        if (v.license_plate) vehicleByPlate[normalizeVehicleRef(v.license_plate)] = v;
        if (v.fuel_card_reference) {
          vehicleByRef[v.fuel_card_reference.toUpperCase().trim()] = v;
          vehicleByRef[normalizeVehicleRef(v.fuel_card_reference)] = v;
        }
      });
      const assignmentByVehicle: Record<string, string> = {};
      const candidateByVehicle: Record<string, any> = {};
      (assignments ?? []).forEach((a: any) => {
        assignmentByVehicle[a.vehicle_id] = a.employee_id;
        const candidate = a.employees?.candidates ?? null;
        if (candidate) {
          candidateByVehicle[a.vehicle_id] = {
            id: a.employees?.candidate_id ?? null,
            ...candidate,
          };
        }
      });
      const placementsByCandidate: Record<string, any[]> = {};
      (placements ?? []).forEach((placement: any) => {
        if (!placement.candidate_id) return;
        if (!placementsByCandidate[placement.candidate_id]) placementsByCandidate[placement.candidate_id] = [];
        placementsByCandidate[placement.candidate_id].push(placement);
      });

      const inserts: any[] = [];
      const rowMeta: Array<{ vehicleId: string | null; odometer: number | null; transactionDate: string; rowIndex: number }> = [];
      const maxKmByVehicle: Record<string, number> = {};
      const fuelCardByVehicle: Record<string, string> = {};
      const readCell = (row: Record<string, string>, column: string) => (column ? String(row[column] ?? '').trim() : '');
      // Oudere Q8 exports hadden soms lege kentekenregels. Alleen dan vullen
      // we door; zodra `Referentie kaartgebruik` bestaat, is die leidend per rij.
      const canForwardFillPlate = !headers.includes(Q8_REFERENCE_COLUMN);
      let lastPlateRef = '';
      for (const row of rows) {
        const rawDate = readCell(row, colMap.datum);
        const mappedRef = readCell(row, colMap.kenteken);
        const referenceUsage = readCell(row, Q8_REFERENCE_COLUMN);
        const q8Plate = readCell(row, Q8_PLATE_COLUMN);
        const rawCard = readCell(row, colMap.kaartnummer) || readCell(row, Q8_CARD_COLUMN);
        const plateCandidate = [mappedRef, referenceUsage, q8Plate].find(isLikelyVehiclePlateReference) ?? '';
        if (plateCandidate) lastPlateRef = plateCandidate;
        const rawRef = plateCandidate || (canForwardFillPlate ? lastPlateRef : '') || mappedRef || referenceUsage || q8Plate;
        const displayPlateRef = (isLikelyVehiclePlateReference(q8Plate) ? q8Plate : plateCandidate) || '';
        const rawLiters = row[colMap.liters] ?? '0';
        const rawAmount = row[colMap.bedrag] ?? '0';
        const rawPrice = colMap.prijs ? (row[colMap.prijs] ?? null) : null;
        const rawStation = colMap.station ? (row[colMap.station] ?? null) : null;
        const rawKm = String(row['Kilometerstand'] ?? '').replace(',', '.').trim();

        const liters = parseFloat(rawLiters.replace(',', '.')) || 0;
        const amount = parseFloat(rawAmount.replace(',', '.')) || 0;
        const price = rawPrice ? parseFloat(rawPrice.replace(',', '.')) || null : null;

        // Parse date — strip optional time-suffix (na spatie of T) voor regex/split.
        let parsedDate = '';
        const dateOnly = rawDate.trim().split(/[\sT]+/)[0];
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
          parsedDate = dateOnly;
        } else if (/^\d{2}-\d{2}-\d{4}$/.test(dateOnly)) {
          const [d, m, y] = dateOnly.split('-');
          parsedDate = `${y}-${m}-${d}`;
        } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateOnly)) {
          const [d, m, y] = dateOnly.split('/');
          parsedDate = `${y}-${m}-${d}`;
        }
        if (!parsedDate) continue;

        const normalRef = normalizeVehicleRef(rawRef);
        const normalCard = normalizeVehicleRef(rawCard);
        const vehicle = vehicleByPlate[normalRef]
          ?? vehicleByRef[rawRef.toUpperCase().trim()]
          ?? (normalCard ? vehicleByRef[normalCard] : null)
          ?? (rawCard ? vehicleByRef[rawCard.toUpperCase().trim()] : null);
        const vehicleId = vehicle?.id ?? null;
        const employeeId = vehicleId ? (assignmentByVehicle[vehicleId] ?? null) : null;
        const candidateId = vehicleId ? (candidateByVehicle[vehicleId]?.id ?? null) : null;
        if (vehicleId && rawCard && !fuelCardByVehicle[vehicleId]) {
          fuelCardByVehicle[vehicleId] = rawCard;
        }

        // Fraud checks
        let flagOverCap = false;
        if (conditions.tank_capacity_enabled && vehicle?.tank_capacity_liters) {
          const maxLiters = Number(vehicle.tank_capacity_liters) * (1 + conditions.tank_capacity_margin_pct / 100);
          flagOverCap = liters > maxLiters;
        }

        const odometer = parseFloat(rawKm);
        const validOdometer = Number.isFinite(odometer) && odometer > 0 ? odometer : null;

        // raw_data krijgt een ingevuld kenteken zodat blanco Q8-velden ook
        // het juiste kenteken tonen, zonder algemene tankpassen als kenteken te tonen.
        const filledRow = displayPlateRef && !row[Q8_PLATE_COLUMN]
          ? { ...row, [Q8_PLATE_COLUMN]: displayPlateRef }
          : row;

        const insertIndex = inserts.length;
        inserts.push({
          organization_id: orgId,
          import_batch_id: batchId,
          fuel_card_reference: rawCard || rawRef.trim(),
          license_plate: (displayPlateRef || vehicle?.license_plate || '').toUpperCase() || null,
          transaction_date: parsedDate,
          liters,
          amount_eur: amount,
          price_per_liter: price,
          station_name: rawStation?.trim() || null,
          vehicle_id: vehicleId,
          employee_id: employeeId,
          candidate_id: candidateId,
          flag_over_capacity: flagOverCap,
          raw_data: filledRow,
        });
        rowMeta[insertIndex] = {
          vehicleId,
          odometer: validOdometer,
          transactionDate: parsedDate,
          rowIndex: insertIndex,
        };

        if (vehicleId && validOdometer != null) {
          if (Number.isFinite(validOdometer) && validOdometer > 0) {
            maxKmByVehicle[vehicleId] = Math.max(maxKmByVehicle[vehicleId] ?? 0, validOdometer);
          }
        }
      }

      // Detect same-day multiples
      if (conditions.multiple_same_day_enabled) {
        const dayGroups: Record<string, number[]> = {};
        inserts.forEach((ins, i) => {
          const key = `${ins.fuel_card_reference}__${ins.transaction_date}`;
          if (!dayGroups[key]) dayGroups[key] = [];
          dayGroups[key].push(i);
        });
        Object.values(dayGroups).forEach(indices => {
          if (indices.length >= 2) indices.forEach(i => { inserts[i].flag_multiple_same_day = true; });
        });
      }

      // Consumption and odometer checks based on Q8 kilometerstanden.
      if (conditions.consumption_enabled || conditions.mileage_jump_enabled) {
        const byVehicle: Record<string, typeof rowMeta> = {};
        rowMeta.forEach((meta) => {
          if (!meta.vehicleId || meta.odometer == null) return;
          if (!byVehicle[meta.vehicleId]) byVehicle[meta.vehicleId] = [];
          byVehicle[meta.vehicleId].push(meta);
        });

        Object.entries(byVehicle).forEach(([vehicleId, metas]) => {
          const sorted = [...metas].sort((a, b) => {
            const dateCmp = a.transactionDate.localeCompare(b.transactionDate);
            return dateCmp !== 0 ? dateCmp : a.rowIndex - b.rowIndex;
          });
          const vehicle = vehicleById[vehicleId];
          const avgConsumption = Number(vehicle?.avg_consumption_per_100km);
          let lastKm: number | null = null;
          const currentMileage = Number(vehicle?.current_mileage);
          if (Number.isFinite(currentMileage) && currentMileage > 0 && sorted[0]?.odometer && currentMileage < sorted[0].odometer) {
            lastKm = currentMileage;
          }

          sorted.forEach((meta) => {
            const insert = inserts[meta.rowIndex];
            if (meta.odometer == null) return;

            if (lastKm != null) {
              const distance = meta.odometer - lastKm;
              if (conditions.mileage_jump_enabled && distance <= 0) {
                insert.flag_excessive_consumption = true;
                appendFlagNote(insert, `Kilometerstand niet oplopend: ${meta.odometer} km na ${lastKm} km.`);
              } else if (conditions.mileage_jump_enabled && distance > conditions.mileage_jump_max_km) {
                insert.flag_excessive_consumption = true;
                appendFlagNote(insert, `Kilometersprong ${Math.round(distance)} km boven grens ${conditions.mileage_jump_max_km} km.`);
              }

              if (
                conditions.consumption_enabled
                && distance > 0
                && Number.isFinite(avgConsumption)
                && avgConsumption > 0
              ) {
                const expectedLiters = (distance * avgConsumption) / 100;
                const allowedLiters = expectedLiters * (1 + conditions.consumption_margin_pct / 100);
                if (insert.liters > allowedLiters) {
                  insert.flag_excessive_consumption = true;
                  appendFlagNote(
                    insert,
                    `Verbruik ${insert.liters.toFixed(1)}L bij ${Math.round(distance)} km; verwacht ca. ${expectedLiters.toFixed(1)}L + ${conditions.consumption_margin_pct}% marge.`,
                  );
                }
              }
            }

            lastKm = meta.odometer;
          });
        });
      }

      // Route-based consumption check: home address -> active work location.
      if (conditions.route_consumption_enabled) {
        const byVehicle: Record<string, typeof rowMeta> = {};
        rowMeta.forEach((meta) => {
          if (!meta.vehicleId) return;
          if (!byVehicle[meta.vehicleId]) byVehicle[meta.vehicleId] = [];
          byVehicle[meta.vehicleId].push(meta);
        });

        const distanceCache = new Map<string, { distanceKm: number; source: 'mapbox' | 'estimated' } | null>();
        const getRouteDistance = async (homeLat: number, homeLng: number, workLat: number, workLng: number) => {
          const key = `${homeLat},${homeLng}__${workLat},${workLng}`;
          if (distanceCache.has(key)) return distanceCache.get(key) ?? null;
          const driving = await getDrivingDistance(homeLat, homeLng, workLat, workLng);
          const result = driving?.distanceKm
            ? { distanceKm: driving.distanceKm, source: 'mapbox' as const }
            : {
              distanceKm: Math.round(haversineKm(homeLat, homeLng, workLat, workLng) * conditions.route_distance_multiplier * 10) / 10,
              source: 'estimated' as const,
            };
          distanceCache.set(key, result);
          return result;
        };

        for (const [vehicleId, metas] of Object.entries(byVehicle)) {
          const vehicle = vehicleById[vehicleId];
          const avgConsumption = Number(vehicle?.avg_consumption_per_100km);
          const candidate = candidateByVehicle[vehicleId];
          if (!candidate?.id || !Number.isFinite(avgConsumption) || avgConsumption <= 0) continue;
          if (!Number.isFinite(Number(candidate.address_lat)) || !Number.isFinite(Number(candidate.address_lng))) continue;

          const sorted = [...metas].sort((a, b) => {
            const dateCmp = a.transactionDate.localeCompare(b.transactionDate);
            return dateCmp !== 0 ? dateCmp : a.rowIndex - b.rowIndex;
          });
          let lastTransactionDate: string | null = null;

          for (const meta of sorted) {
            const insert = inserts[meta.rowIndex];
            const candidatePlacements = placementsByCandidate[candidate.id] ?? [];
            const placement = candidatePlacements.find((p: any) => (
              p.start_date <= meta.transactionDate
              && (!p.end_date || p.end_date >= meta.transactionDate)
            )) ?? candidatePlacements[0];
            const company = placement?.companies;
            const workLat = Number(company?.visit_address_lat ?? company?.address_lat);
            const workLng = Number(company?.visit_address_lng ?? company?.address_lng);
            if (!placement || !Number.isFinite(workLat) || !Number.isFinite(workLng)) continue;

            const route = await getRouteDistance(Number(candidate.address_lat), Number(candidate.address_lng), workLat, workLng);
            if (!route?.distanceKm) continue;

            const periodStart = lastTransactionDate
              ? isoDate(addDays(new Date(`${lastTransactionDate}T00:00:00`), 1))
              : isoDate(addDays(new Date(`${meta.transactionDate}T00:00:00`), -6));
            const workDayCount = countWorkDays(periodStart, meta.transactionDate, placement.work_days);
            const expectedKm = route.distanceKm * 2 * workDayCount;
            const expectedLiters = (expectedKm * avgConsumption) / 100;
            const allowedLiters = expectedLiters * (1 + conditions.route_consumption_margin_pct / 100);

            if (workDayCount > 0 && insert.liters > allowedLiters) {
              insert.flag_excessive_consumption = true;
              appendFlagNote(
                insert,
                `Woon-werkverbruik ${insert.liters.toFixed(1)}L; verwacht ca. ${expectedLiters.toFixed(1)}L voor ${Math.round(expectedKm)} km (${workDayCount} werkdagen, ${route.source === 'mapbox' ? 'rijafstand' : 'geschatte routeafstand'} ${route.distanceKm} km enkele reis) + ${conditions.route_consumption_margin_pct}% marge.`,
              );
            }

            lastTransactionDate = meta.transactionDate;
          }
        }
      }

      // Maak fuel_card_imports row met aggregaten — id wordt batchId
      if (inserts.length > 0 && fileMeta) {
        const totalLiters = inserts.reduce((s, i) => s + (Number(i.liters) || 0), 0);
        const totalAmount = inserts.reduce((s, i) => s + (Number(i.amount_eur) || 0), 0);
        const dates = inserts.map(i => i.transaction_date).filter(Boolean).sort();
        await unwrap(supabase.from('fuel_card_imports').insert({
          id: batchId,
          organization_id: orgId,
          file_hash: fileMeta.hash,
          file_name: fileMeta.name,
          transaction_count: inserts.length,
          total_liters: Math.round(totalLiters * 100) / 100,
          total_amount_eur: Math.round(totalAmount * 100) / 100,
          period_start: dates[0] ?? null,
          period_end: dates[dates.length - 1] ?? null,
        }));
      }

      // Insert in batches of 100
      let totalInserted = 0;
      for (let i = 0; i < inserts.length; i += 100) {
        const batch = inserts.slice(i, i + 100);
        await unwrap(supabase.from('fuel_card_transactions').insert(batch));
        totalInserted += batch.length;
      }

      // Update vehicles.current_mileage waar Q8 hoger is dan huidige stand
      let kmUpdates = 0;
      for (const [vehicleId, km] of Object.entries(maxKmByVehicle)) {
        const v = (vehicles ?? []).find(x => x.id === vehicleId);
        const current = Number(v?.current_mileage) || 0;
        if (km > current) {
          // eslint-disable-next-line no-restricted-syntax -- per-rij best-effort: bij fout doorgaan met de loop (geen throw), unwrap zou afbreken
          const { error } = await supabase.from('vehicles').update({ current_mileage: km }).eq('id', vehicleId);
          if (!error) {
            kmUpdates += 1;
            void logAudit({
              action: 'update',
              tableName: 'vehicles',
              recordId: vehicleId,
              oldValues: { current_mileage: current },
              newValues: { current_mileage: km },
              reason: 'q8-import-km-update',
            });
          }
        }
      }

      let fuelCardUpdates = 0;
      for (const [vehicleId, fuelCardReference] of Object.entries(fuelCardByVehicle)) {
        const v = (vehicles ?? []).find(x => x.id === vehicleId);
        const current = String(v?.fuel_card_reference ?? '').trim();
        if (fuelCardReference && current !== fuelCardReference) {
          // eslint-disable-next-line no-restricted-syntax -- per-rij best-effort: bij fout doorgaan met de loop (geen throw), unwrap zou afbreken
          const { error } = await supabase.from('vehicles').update({ fuel_card_reference: fuelCardReference }).eq('id', vehicleId);
          if (!error) {
            fuelCardUpdates += 1;
            void logAudit({
              action: 'update',
              tableName: 'vehicles',
              recordId: vehicleId,
              oldValues: { fuel_card_reference: current || null },
              newValues: { fuel_card_reference: fuelCardReference },
              reason: 'q8-import-fuel-card-reference',
            });
          }
        }
      }

      const flagCount = inserts.filter(i => i.flag_over_capacity || i.flag_multiple_same_day || i.flag_excessive_consumption).length;
      setResult({ imported: totalInserted, flags: flagCount, kmUpdates, fuelCardUpdates });
      setStep(3);
      onDone();
    } catch (e: any) {
      toast.error(e.message ?? 'Import mislukt');
    } finally {
      setImporting(false);
    }
  };

  const mapFields: { key: keyof ColMap; label: string; required: boolean }[] = [
    { key: 'datum', label: 'Datum', required: true },
    { key: 'kenteken', label: 'Kenteken', required: true },
    { key: 'kaartnummer', label: 'Tankpas / Kaartnummer', required: false },
    { key: 'liters', label: 'Liters', required: true },
    { key: 'bedrag', label: 'Bedrag (EUR)', required: true },
    { key: 'prijs', label: 'Prijs per liter', required: false },
    { key: 'station', label: 'Station', required: false },
  ];

  const canImport = colMap.datum && colMap.kenteken && colMap.liters && colMap.bedrag;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader><SheetTitle>Transactielijst importeren</SheetTitle></SheetHeader>

        {step === 1 && (
          <div className="mt-6 space-y-4">
            <Label>Selecteer bestand</Label>
            <Input type="file" accept=".csv,.txt,.xlsx" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            <p className="text-xs text-muted-foreground">Q8 Liberty wekelijkse export (.csv of .xlsx)</p>
          </div>
        )}

        {step === 2 && (
          <div className="mt-6 space-y-6">
            {/* Preview */}
            <div>
              <p className="text-sm font-medium mb-2">Preview ({rows.length} rijen)</p>
              <div className="rounded border overflow-auto max-h-40 text-xs">
                <table className="w-full">
                  <thead><tr className="bg-muted">{headers.map(h => <th key={h} className="px-2 py-1 text-left font-medium">{h}</th>)}</tr></thead>
                  <tbody>
                    {rows.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-t">{headers.map(h => <td key={h} className="px-2 py-1 truncate max-w-[120px]">{r[h]}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Column mapping */}
            <div className="space-y-3">
              <p className="text-sm font-medium">Kolom mapping</p>
              {mapFields.map(f => (
                <div key={f.key} className="grid grid-cols-2 gap-2 items-center">
                  <Label className="text-sm">{f.label}{f.required && ' *'}</Label>
                  <Select value={colMap[f.key]} onValueChange={v => setColMap(p => ({ ...p, [f.key]: v }))}>
                    <SelectTrigger><SelectValue placeholder="Selecteer kolom" /></SelectTrigger>
                    <SelectContent>
                      {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={() => { reset(); onOpenChange(false); }}>Annuleren</Button>
              <Button onClick={handleImport} disabled={!canImport || importing}>
                {importing ? 'Importeren...' : `Importeer ${rows.length} rijen`}
              </Button>
            </div>
          </div>
        )}

        {step === 3 && !result && (
          <div className="mt-6 space-y-6">
            {autoDetected && (
              <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 flex items-start gap-2">
                <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                <div className="text-xs text-blue-900">
                  <strong>Q8-formaat herkend</strong> — kolom-mapping is automatisch ingesteld. Klik <strong>Vorige</strong> om handmatig aan te passen.
                </div>
              </div>
            )}
            {existing && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
                <div className="text-xs text-amber-900">
                  <strong>Dit bestand is eerder geïmporteerd</strong> — {existing.file_name ?? 'onbekend bestand'} op {formatDate(existing.created_at)} ({existing.transaction_count} transacties).
                  Bij <strong>Importeren</strong> wordt de oude import vervangen door deze nieuwe.
                </div>
              </div>
            )}
            <div>
              <p className="text-sm font-medium mb-2">Preview ({rows.length} rijen)</p>
              <div className="rounded border overflow-auto max-h-40 text-xs">
                <table className="w-full">
                  <thead><tr className="bg-muted">{headers.map(h => <th key={h} className="px-2 py-1 text-left font-medium">{h}</th>)}</tr></thead>
                  <tbody>
                    {rows.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-t">{headers.map(h => <td key={h} className="px-2 py-1 truncate max-w-[120px]">{r[h]}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={() => setStep(2)}>Vorige</Button>
              <Button onClick={handleImport} disabled={!canImport || importing}>
                {importing ? 'Importeren...' : `Importeer ${rows.length} rijen`}
              </Button>
            </div>
          </div>
        )}

        {step === 3 && result && (
          <div className="mt-6 space-y-4 text-center py-8">
            <CheckCircle2 className="h-12 w-12 text-stat-blue mx-auto" />
            <p className="text-lg font-semibold">{result.imported} transacties geïmporteerd</p>
            {result.flags > 0 ? (
              <Badge variant="destructive" className="text-sm">{result.flags} afwijkingen gedetecteerd</Badge>
            ) : (
              <p className="text-sm text-muted-foreground">Geen afwijkingen gevonden</p>
            )}
            {result.kmUpdates > 0 && (
              <p className="text-sm text-muted-foreground">{result.kmUpdates} voertuig{result.kmUpdates === 1 ? '' : 'en'} kilometerstand bijgewerkt</p>
            )}
            {result.fuelCardUpdates > 0 && (
              <p className="text-sm text-muted-foreground">{result.fuelCardUpdates} tankpas{result.fuelCardUpdates === 1 ? '' : 'sen'} aan kenteken gekoppeld</p>
            )}
            <Button className="mt-4" onClick={() => { reset(); onOpenChange(false); }}>Sluiten</Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};
