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

const statusLabel: Record<string, string> = {
  nieuw: 'Nieuw',
  in_behandeling: 'In behandeling',
  beschikbaar: 'Beschikbaar',
  geplaatst: 'Geplaatst',
  inactief: 'Inactief',
  afgewezen: 'Afgewezen',
};

interface ExportPoolButtonProps {
  members: any[];
  poolName: string;
}

function membersToRows(members: any[]) {
  return members
    .filter((m) => m.candidates)
    .map((m) => {
      const c = m.candidates;
      return {
        Naam: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim(),
        Email: c.email ?? '',
        Telefoon: c.phone ?? '',
        Status: statusLabel[c.status] ?? c.status ?? '',
        Vaardigheden: (c.skills ?? []).join(', '),
        'Compliance status': c.compliance_status ?? '',
        'Toegevoegd op': new Date(m.added_at).toLocaleDateString('nl-NL'),
      };
    });
}

function downloadCsv(rows: Record<string, string>[], filename: string) {
  const csv = '\uFEFF' + Papa.unparse(rows, { delimiter: ';' });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadExcel(rows: Record<string, string>[], filename: string) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Leden');
  XLSX.writeFile(wb, filename);
}

export default function ExportPoolButton({ members, poolName }: ExportPoolButtonProps) {
  const rows = membersToRows(members);
  const safeName = poolName.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'talentpool';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Download className="h-3.5 w-3.5" /> Exporteren
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => downloadCsv(rows, `${safeName}.csv`)}>
          Exporteer CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => downloadExcel(rows, `${safeName}.xlsx`)}>
          Exporteer Excel
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
