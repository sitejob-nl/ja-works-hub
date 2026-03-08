import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import Papa from 'papaparse';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Upload, FileText } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Expected CSV columns: medewerkernummer, datum (YYYY-MM-DD), uren, overwerk
const TimesheetCsvImport = ({ open, onOpenChange }: Props) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [result, setResult] = useState<{ imported: number; errors: string[] } | null>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null);
    Papa.parse(file, {
      complete: (res) => {
        const data = res.data as string[][];
        if (data.length > 0) {
          setHeaders(data[0]);
          setRows(data.slice(1).filter((r) => r.some((c) => c?.trim())));
        }
      },
      skipEmptyLines: true,
    });
  };

  const importMutation = useMutation({
    mutationFn: async () => {
      const errors: string[] = [];
      let imported = 0;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const empNumber = row[0]?.trim();
        const dateStr = row[1]?.trim();
        const hoursStr = row[2]?.trim();
        const overtimeStr = row[3]?.trim();

        if (!empNumber || !dateStr || !hoursStr) {
          errors.push(`Rij ${i + 2}: Onvolledig (medewerkernummer, datum of uren ontbreekt)`);
          continue;
        }

        // Find employee by number
        const { data: emp } = await supabase
          .from('employees')
          .select('id')
          .eq('employee_number', empNumber)
          .eq('organization_id', orgId)
          .maybeSingle();

        if (!emp) {
          errors.push(`Rij ${i + 2}: Medewerker "${empNumber}" niet gevonden`);
          continue;
        }

        // Find active placement
        const { data: placement } = await supabase
          .from('placements')
          .select('id, hourly_rate')
          .eq('employee_id', emp.id)
          .eq('status', 'actief' as any)
          .limit(1)
          .maybeSingle();

        if (!placement) {
          errors.push(`Rij ${i + 2}: Geen actieve plaatsing voor medewerker "${empNumber}"`);
          continue;
        }

        const { error } = await supabase.from('timesheets').insert({
          organization_id: orgId,
          employee_id: emp.id,
          placement_id: placement.id,
          work_date: dateStr,
          hours: parseFloat(hoursStr),
          overtime_hours: parseFloat(overtimeStr || '0'),
          hourly_rate: placement.hourly_rate,
          source: 'csv_import' as any,
          status: 'concept' as any,
        });

        if (error) {
          errors.push(`Rij ${i + 2}: ${error.message}`);
        } else {
          imported++;
        }
      }

      return { imported, errors };
    },
    onSuccess: (res) => {
      setResult(res);
      qc.invalidateQueries({ queryKey: ['timesheets'] });
      if (res.imported > 0) toast.success(`${res.imported} van ${rows.length} rijen geïmporteerd`);
      if (res.errors.length > 0) toast.error(`${res.errors.length} fouten bij import`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const reset = () => {
    setRows([]); setHeaders([]); setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader><SheetTitle>CSV importeren</SheetTitle></SheetHeader>
        <div className="space-y-4 mt-6">
          <div className="text-sm text-muted-foreground">
            <p>Verwacht CSV-formaat: <strong>medewerkernummer, datum (YYYY-MM-DD), uren, overwerk</strong></p>
          </div>

          <div>
            <Label>Bestand selecteren</Label>
            <div className="mt-2">
              <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFile} className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90" />
            </div>
          </div>

          {rows.length > 0 && !result && (
            <>
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{rows.length} rijen gevonden</span>
              </div>

              <div className="bg-card rounded-lg border max-h-64 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      {headers.map((h, i) => <TableHead key={i}>{h}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, 10).map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-muted-foreground">{i + 2}</TableCell>
                        {row.map((cell, j) => <TableCell key={j}>{cell}</TableCell>)}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {rows.length > 10 && <p className="text-xs text-muted-foreground">...en {rows.length - 10} meer rijen</p>}

              <div className="flex justify-end gap-3 pt-2">
                <Button variant="ghost" onClick={reset}>Annuleren</Button>
                <Button onClick={() => importMutation.mutate()} disabled={importMutation.isPending} className="gap-2">
                  <Upload className="h-4 w-4" />
                  {importMutation.isPending ? 'Importeren...' : `${rows.length} rijen importeren`}
                </Button>
              </div>
            </>
          )}

          {result && (
            <div className="space-y-3">
              <div className="p-4 bg-muted rounded-lg">
                <p className="font-medium">{result.imported} van {rows.length} rijen geïmporteerd</p>
                {result.errors.length > 0 && <p className="text-sm text-red-600">{result.errors.length} fouten</p>}
              </div>
              {result.errors.length > 0 && (
                <div className="max-h-40 overflow-auto space-y-1">
                  {result.errors.map((err, i) => (
                    <div key={i} className="text-xs text-red-600 flex items-start gap-1">
                      <span>•</span><span>{err}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>Sluiten</Button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default TimesheetCsvImport;
