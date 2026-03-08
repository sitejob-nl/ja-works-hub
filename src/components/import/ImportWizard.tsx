import { useState, useCallback, useMemo } from 'react';
import Papa from 'papaparse';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useQueryClient } from '@tanstack/react-query';
import { Upload, FileSpreadsheet, ArrowRight, ArrowLeft, Check, AlertTriangle, X } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';

type TargetTable = 'candidates' | 'companies';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: TargetTable;
  preset?: 'carerix' | 'buddy' | null;
}

const CANDIDATE_FIELDS: Record<string, string> = {
  first_name: 'Voornaam *',
  last_name: 'Achternaam *',
  email: 'E-mail',
  phone: 'Telefoon',
  date_of_birth: 'Geboortedatum',
  nationality: 'Nationaliteit',
  bsn: 'BSN',
  iban: 'IBAN',
  address_street: 'Straat',
  address_postal: 'Postcode',
  address_city: 'Stad',
  address_country: 'Land',
  skills: 'Vaardigheden (kommagescheiden)',
  languages: 'Talen (kommagescheiden)',
  source: 'Bron',
  notes: 'Notities',
};

const COMPANY_FIELDS: Record<string, string> = {
  name: 'Bedrijfsnaam *',
  email: 'E-mail',
  phone: 'Telefoon',
  website: 'Website',
  kvk_number: 'KvK-nummer',
  btw_number: 'BTW-nummer',
  address_street: 'Straat',
  address_postal: 'Postcode',
  address_city: 'Stad',
  notes: 'Notities',
};

const PRESETS: Record<string, Record<string, string>> = {
  carerix: {
    'Voornaam': 'first_name', 'Achternaam': 'last_name', 'E-mail': 'email', 'Emailadres': 'email',
    'Telefoonnummer': 'phone', 'Telefoon': 'phone', 'Geboortedatum': 'date_of_birth',
    'Nationaliteit': 'nationality', 'BSN': 'bsn', 'IBAN': 'iban', 'Straat': 'address_street',
    'Postcode': 'address_postal', 'Stad': 'address_city', 'Woonplaats': 'address_city',
    'Land': 'address_country', 'Vaardigheden': 'skills', 'Talen': 'languages', 'Bron': 'source',
    'Notities': 'notes', 'Opmerking': 'notes',
    'Bedrijfsnaam': 'name', 'KvK': 'kvk_number', 'BTW': 'btw_number', 'Website': 'website',
  },
  buddy: {
    'Voornaam': 'first_name', 'Achternaam': 'last_name', 'Email': 'email', 'E-mailadres': 'email',
    'Mobiel': 'phone', 'Telefoon': 'phone', 'Geboortedatum': 'date_of_birth',
    'Nationaliteit': 'nationality', 'BSN-nummer': 'bsn', 'BSN': 'bsn', 'Bankrekeningnummer': 'iban',
    'IBAN': 'iban', 'Straatnaam': 'address_street', 'Adres': 'address_street',
    'Postcode': 'address_postal', 'Woonplaats': 'address_city', 'Plaats': 'address_city',
    'Land': 'address_country', 'Competenties': 'skills', 'Talen': 'languages',
    'Herkomst': 'source', 'Opmerkingen': 'notes',
    'Bedrijfsnaam': 'name', 'Naam': 'name', 'KvK-nummer': 'kvk_number', 'BTW-nummer': 'btw_number',
  },
};

const ImportWizard = ({ open, onOpenChange, target, preset }: Props) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: string[] }>({ imported: 0, skipped: 0, errors: [] });
  const [importing, setImporting] = useState(false);

  const fields = target === 'candidates' ? CANDIDATE_FIELDS : COMPANY_FIELDS;

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      complete: (result) => {
        const rows = result.data as string[][];
        if (rows.length < 2) { toast.error('Bestand bevat geen data'); return; }
        const h = rows[0].map(s => (s ?? '').trim());
        setHeaders(h);
        setCsvData(rows.slice(1).filter(r => r.some(c => c?.trim())));

        // Auto-map with preset
        const presetMap = preset ? PRESETS[preset] ?? {} : { ...PRESETS.carerix, ...PRESETS.buddy };
        const autoMapping: Record<string, string> = {};
        h.forEach(col => {
          const match = presetMap[col] || presetMap[col.toLowerCase()];
          if (match && fields[match]) autoMapping[col] = match;
        });
        setMapping(autoMapping);
        setStep(2);
      },
      error: () => toast.error('Bestand kon niet worden gelezen'),
    });
  }, [preset, fields]);

  const setMap = (csvCol: string, field: string) => {
    setMapping(prev => {
      const next = { ...prev };
      if (field === '__skip__') { delete next[csvCol]; return next; }
      // Remove any other col mapped to same field
      Object.keys(next).forEach(k => { if (next[k] === field && k !== csvCol) delete next[k]; });
      next[csvCol] = field;
      return next;
    });
  };

  // Validation
  const validationErrors = useMemo(() => {
    const requiredFields = target === 'candidates' ? ['first_name', 'last_name'] : ['name'];
    const mappedFields = Object.values(mapping);
    const missing = requiredFields.filter(f => !mappedFields.includes(f));
    return missing.map(f => `Verplicht veld "${fields[f]}" is niet gekoppeld`);
  }, [mapping, target, fields]);

  // Preview data
  const previewRows = useMemo(() => {
    return csvData.slice(0, 10).map((row, ri) => {
      const mapped: Record<string, string> = {};
      const errors: string[] = [];
      headers.forEach((h, i) => {
        const field = mapping[h];
        if (field) mapped[field] = (row[i] ?? '').trim();
      });
      const requiredFields = target === 'candidates' ? ['first_name', 'last_name'] : ['name'];
      requiredFields.forEach(f => { if (!mapped[f]) errors.push(`${fields[f]} ontbreekt`); });
      return { row: mapped, errors, index: ri };
    });
  }, [csvData, headers, mapping, target, fields]);

  const doImport = async () => {
    setImporting(true);
    let imported = 0, skipped = 0;
    const errors: string[] = [];
    const requiredFields = target === 'candidates' ? ['first_name', 'last_name'] : ['name'];

    for (let ri = 0; ri < csvData.length; ri++) {
      const row = csvData[ri];
      const mapped: Record<string, any> = {};
      headers.forEach((h, i) => {
        const field = mapping[h];
        if (field) {
          const val = (row[i] ?? '').trim();
          if (['skills', 'languages'].includes(field)) {
            mapped[field] = val ? val.split(',').map(s => s.trim()).filter(Boolean) : [];
          } else {
            mapped[field] = val || null;
          }
        }
      });

      // Validate required
      const missingReq = requiredFields.some(f => !mapped[f]);
      if (missingReq) { skipped++; errors.push(`Rij ${ri + 2}: verplichte velden ontbreken`); continue; }

      // Duplicate check
      if (target === 'candidates') {
        if (mapped.bsn) {
          const { data: dup } = await supabase.from('candidates').select('id').eq('bsn', mapped.bsn).maybeSingle();
          if (dup) { skipped++; errors.push(`Rij ${ri + 2}: BSN ${mapped.bsn} bestaat al`); continue; }
        }
        if (mapped.email) {
          const { data: dup } = await supabase.from('candidates').select('id').eq('email', mapped.email).maybeSingle();
          if (dup) { skipped++; errors.push(`Rij ${ri + 2}: email ${mapped.email} bestaat al`); continue; }
        }
      } else {
        if (mapped.kvk_number) {
          const { data: dup } = await supabase.from('companies').select('id').eq('kvk_number', mapped.kvk_number).maybeSingle();
          if (dup) { skipped++; errors.push(`Rij ${ri + 2}: KvK ${mapped.kvk_number} bestaat al`); continue; }
        }
      }

      const insertData = { ...mapped, organization_id: orgId };
      const { data: inserted, error } = await supabase.from(target).insert(insertData as any).select('id').single();
      if (error) {
        skipped++;
        errors.push(`Rij ${ri + 2}: ${error.message}`);
      } else {
        imported++;
        logAudit({ action: 'create', tableName: target, recordId: inserted.id, newValues: { source: 'csv_import', ...mapped } });
      }
    }

    setImportResult({ imported, skipped, errors });
    setStep(4);
    setImporting(false);
    qc.invalidateQueries({ queryKey: [target] });
    if (target === 'candidates') qc.invalidateQueries({ queryKey: ['candidates'] });
    if (target === 'companies') qc.invalidateQueries({ queryKey: ['companies'] });
  };

  const reset = () => {
    setStep(1); setCsvData([]); setHeaders([]); setMapping({});
    setImportResult({ imported: 0, skipped: 0, errors: [] });
  };

  const targetLabel = target === 'candidates' ? 'kandidaten' : 'opdrachtgevers';

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Importeer {targetLabel}
            {preset && <Badge variant="secondary" className="text-xs">{preset === 'buddy' ? 'Buddy HRM' : 'Carerix'} preset</Badge>}
          </SheetTitle>
        </SheetHeader>

        {/* Progress */}
        <div className="flex items-center gap-2 mt-4 mb-6">
          {[1, 2, 3, 4].map(s => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${step >= s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                {step > s ? <Check className="h-4 w-4" /> : s}
              </div>
              {s < 4 && <div className={`w-8 h-0.5 ${step > s ? 'bg-primary' : 'bg-muted'}`} />}
            </div>
          ))}
          <span className="text-xs text-muted-foreground ml-2">
            {step === 1 && 'Bestand uploaden'}
            {step === 2 && 'Kolommen koppelen'}
            {step === 3 && 'Preview & validatie'}
            {step === 4 && 'Resultaat'}
          </span>
        </div>

        {/* Step 1: Upload */}
        {step === 1 && (
          <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed rounded-lg">
            <Upload className="h-10 w-10 text-muted-foreground mb-4" />
            <p className="text-sm text-muted-foreground mb-4">Upload een CSV-bestand met {targetLabel}</p>
            <label className="cursor-pointer">
              <input type="file" accept=".csv,.txt" onChange={handleFile} className="hidden" />
              <Button variant="outline" asChild><span>Bestand kiezen</span></Button>
            </label>
          </div>
        )}

        {/* Step 2: Mapping */}
        {step === 2 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Koppel de CSV-kolommen aan de juiste velden. {csvData.length} rijen gevonden.</p>
            <div className="border rounded-lg divide-y max-h-[400px] overflow-y-auto">
              {headers.map(h => (
                <div key={h} className="flex items-center gap-3 p-3">
                  <span className="text-sm font-medium min-w-[140px] truncate">{h}</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Select value={mapping[h] ?? '__skip__'} onValueChange={(v) => setMap(h, v)}>
                    <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__skip__">— Overslaan —</SelectItem>
                      {Object.entries(fields).map(([k, v]) => (
                        <SelectItem key={k} value={k} disabled={Object.values(mapping).includes(k) && mapping[h] !== k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {mapping[h] && <Check className="h-4 w-4 text-stat-green" />}
                </div>
              ))}
            </div>
            {validationErrors.length > 0 && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg space-y-1">
                {validationErrors.map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-red-600">
                    <AlertTriangle className="h-3 w-3" />{e}
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-between pt-4">
              <Button variant="ghost" onClick={() => { reset(); }}><ArrowLeft className="h-4 w-4 mr-1" />Terug</Button>
              <Button onClick={() => setStep(3)} disabled={validationErrors.length > 0}>
                Volgende <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Preview */}
        {step === 3 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Preview van de eerste 10 rijen. Totaal: {csvData.length} rijen.</p>
            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    {Object.entries(mapping).map(([_, field]) => (
                      <TableHead key={field}>{fields[field]}</TableHead>
                    ))}
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map(({ row, errors, index }) => (
                    <TableRow key={index} className={errors.length > 0 ? 'bg-red-50' : ''}>
                      <TableCell className="text-xs text-muted-foreground">{index + 2}</TableCell>
                      {Object.values(mapping).map(field => (
                        <TableCell key={field} className="text-xs max-w-[150px] truncate">{row[field] ?? '—'}</TableCell>
                      ))}
                      <TableCell>
                        {errors.length === 0 ? (
                          <Check className="h-4 w-4 text-stat-green" />
                        ) : (
                          <span className="text-xs text-red-600">{errors.join(', ')}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-between pt-4">
              <Button variant="ghost" onClick={() => setStep(2)}><ArrowLeft className="h-4 w-4 mr-1" />Terug</Button>
              <Button onClick={doImport} disabled={importing}>
                {importing ? 'Importeren...' : `${csvData.length} rijen importeren`}
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Result */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="border rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-stat-green">{importResult.imported}</div>
                <div className="text-xs text-muted-foreground">Geïmporteerd</div>
              </div>
              <div className="border rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-orange-500">{importResult.skipped}</div>
                <div className="text-xs text-muted-foreground">Overgeslagen</div>
              </div>
              <div className="border rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-red-500">{importResult.errors.length}</div>
                <div className="text-xs text-muted-foreground">Fouten</div>
              </div>
            </div>
            {importResult.errors.length > 0 && (
              <div className="border rounded-lg p-3 max-h-[200px] overflow-y-auto space-y-1">
                {importResult.errors.map((e, i) => (
                  <div key={i} className="text-xs text-red-600 flex items-start gap-1">
                    <X className="h-3 w-3 mt-0.5 shrink-0" />{e}
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end pt-4">
              <Button onClick={() => { reset(); onOpenChange(false); }}>Sluiten</Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default ImportWizard;
