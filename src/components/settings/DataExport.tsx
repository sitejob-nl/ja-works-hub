import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';

const ENTITIES = [
  { key: 'candidates', label: 'Kandidaten' },
  { key: 'employees', label: 'Medewerkers' },
  { key: 'companies', label: 'Opdrachtgevers' },
  { key: 'placements', label: 'Plaatsingen' },
  { key: 'timesheets', label: 'Uren' },
  { key: 'vacancies', label: 'Vacatures' },
  { key: 'properties', label: 'Panden' },
  { key: 'vehicles', label: 'Voertuigen' },
  { key: 'communications', label: 'Communicatie' },
  { key: 'documents', label: 'Documenten' },
] as const;

type EntityKey = typeof ENTITIES[number]['key'];

const DataExport = () => {
  const [entity, setEntity] = useState<EntityKey>('candidates');
  const [fmt, setFmt] = useState<'csv' | 'json'>('csv');
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const { data, error } = await supabase.from(entity).select('*');
      if (error) throw error;
      if (!data || data.length === 0) {
        toast.info('Geen data om te exporteren');
        return;
      }

      let content: string;
      let mimeType: string;
      let ext: string;

      if (fmt === 'json') {
        content = JSON.stringify(data, null, 2);
        mimeType = 'application/json';
        ext = 'json';
      } else {
        // CSV
        const headers = Object.keys(data[0]);
        const csvRows = [
          headers.join(';'),
          ...data.map(row =>
            headers.map(h => {
              const val = (row as any)[h];
              if (val === null || val === undefined) return '';
              const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
              return `"${str.replace(/"/g, '""')}"`;
            }).join(';')
          ),
        ];
        content = csvRows.join('\n');
        mimeType = 'text/csv;charset=utf-8';
        ext = 'csv';
      }

      const blob = new Blob(['\ufeff' + content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${entity}_export_${new Date().toISOString().split('T')[0]}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);

      logAudit({
        action: 'export',
        tableName: entity,
        recordId: null as any,
        newValues: { format: fmt, count: data.length },
      });

      toast.success(`${data.length} records geëxporteerd`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Download className="h-4 w-4" /> Data export
        </CardTitle>
        <CardDescription>Exporteer gegevens als CSV of JSON</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Select value={entity} onValueChange={(v) => setEntity(v as EntityKey)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ENTITIES.map((e) => (
                  <SelectItem key={e.key} value={e.key}>{e.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Select value={fmt} onValueChange={(v) => setFmt(v as 'csv' | 'json')}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="json">JSON</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleExport} disabled={exporting} className="gap-2">
            <Download className="h-4 w-4" /> {exporting ? 'Exporteren...' : 'Exporteren'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default DataExport;
