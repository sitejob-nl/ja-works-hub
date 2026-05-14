import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Props {
  properties: any[];
  filenameSuffix?: string;
}

const fmtDate = (d: string | null) => {
  if (!d) return '';
  return new Date(d).toLocaleDateString('nl-NL');
};

const permitCell = (has: boolean, expiry: string | null) => {
  if (!has) return 'Nee';
  if (!expiry) return 'Ja';
  return `Ja, geldig t/m ${fmtDate(expiry)}`;
};

function propertiesToRows(properties: any[]) {
  return properties.map((p: any) => ({
    Naam: p.name ?? '',
    Straat: p.address_street ?? '',
    Postcode: p.address_postal ?? '',
    Plaats: p.address_city ?? '',
    Eigenaar: p.property_owners?.name ?? '',
    Capaciteit: p.totalCapacity ?? 0,
    Bezet: p.currentOccupancy ?? 0,
    Vrij: (p.totalCapacity ?? 0) - (p.currentOccupancy ?? 0),
    'Bezetting %': p.percentage ?? 0,
    'Huurcontract begin': fmtDate(p.rental_contract_start_date),
    'Huurcontract einde': fmtDate(p.rental_contract_end_date),
    Huurvergunning: permitCell(p.has_rental_permit, p.rental_permit_expiry),
    'SNF certificaat': permitCell(p.has_snf_certificate, p.snf_certificate_expiry),
    'Max personen': p.max_persons_permit ?? '',
    'Maandhuur': p.monthly_rent ?? '',
    'Actief': p.is_active ? 'Ja' : 'Nee',
  }));
}

function downloadCsv(rows: Record<string, any>[], filename: string) {
  const csv = '﻿' + Papa.unparse(rows, { delimiter: ';' });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadExcel(rows: Record<string, any>[], filename: string) {
  const ws = XLSX.utils.json_to_sheet(rows);
  // Sensible column widths
  ws['!cols'] = [
    { wch: 20 }, { wch: 24 }, { wch: 10 }, { wch: 14 }, { wch: 22 }, { wch: 14 },
    { wch: 11 }, { wch: 7 }, { wch: 6 }, { wch: 11 }, { wch: 16 }, { wch: 16 },
    { wch: 24 }, { wch: 24 }, { wch: 12 }, { wch: 11 }, { wch: 7 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Panden');
  XLSX.writeFile(wb, filename);
}

export default function ExportPropertiesButton({ properties, filenameSuffix }: Props) {
  const rows = propertiesToRows(properties);
  const date = new Date().toISOString().split('T')[0];
  const base = filenameSuffix
    ? `panden_${filenameSuffix}_${date}`.replace(/[^a-zA-Z0-9_-]/g, '_')
    : `panden_${date}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" disabled={rows.length === 0}>
          <Download className="h-3.5 w-3.5" /> Exporteren
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => downloadCsv(rows, `${base}.csv`)}>
          Exporteer CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => downloadExcel(rows, `${base}.xlsx`)}>
          Exporteer Excel
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
