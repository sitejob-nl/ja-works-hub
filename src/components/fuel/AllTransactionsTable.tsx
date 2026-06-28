import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate, formatEUR } from '@/lib/format';
import { displayPlate } from '@/lib/fuel-analysis';

export const AllTransactionsTable = ({ data }: { data: any[] }) => (
  <div className="rounded-md border overflow-auto">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Datum</TableHead>
          <TableHead>Kenteken</TableHead>
          <TableHead>Medewerker</TableHead>
          <TableHead className="text-right">Liters</TableHead>
          <TableHead className="text-right">Bedrag</TableHead>
          <TableHead>Station</TableHead>
          <TableHead>Flags</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map(t => {
          const emp = t.employees?.candidates;
          const empName = emp ? `${emp.first_name} ${emp.last_name}` : null;
          const plate = displayPlate(t);
          const hasFlag = t.flag_over_capacity || t.flag_multiple_same_day || t.flag_excessive_consumption;
          return (
            <TableRow key={t.id}>
              <TableCell>{formatDate(t.transaction_date)}</TableCell>
              <TableCell className="font-mono font-semibold text-foreground">
                {t.vehicles ? (
                  <Link to={`/transport/${t.vehicles.id}`} className="text-foreground hover:hover:underline">{plate}</Link>
                ) : plate ? (
                  <span>{plate}</span>
                ) : (
                  <span className="text-xs italic text-muted-foreground font-normal">Kaart {t.fuel_card_reference || '—'}</span>
                )}
              </TableCell>
              <TableCell>
                {empName && t.employees?.id ? (
                  <Link to={`/medewerkers/${t.employees.id}`} className="text-foreground hover:hover:underline font-medium">{empName}</Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right">{t.liters}</TableCell>
              <TableCell className="text-right">{formatEUR(t.amount_eur)}</TableCell>
              <TableCell>{t.station_name || <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell>
                {hasFlag ? (
                  <div className="flex flex-wrap gap-1">
                    {t.flag_over_capacity && <Badge variant="destructive" className="text-[10px]">Capaciteit</Badge>}
                    {t.flag_multiple_same_day && <Badge variant="destructive" className="text-[10px]">Meerdere/dag</Badge>}
                    {t.flag_excessive_consumption && <Badge variant="destructive" className="text-[10px]">Verbruik</Badge>}
                  </div>
                ) : (
                  <span className="text-muted-foreground text-xs">—</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
        {data.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Geen transacties</TableCell></TableRow>}
      </TableBody>
    </Table>
  </div>
);
