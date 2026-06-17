import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import Papa from 'papaparse';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { readExcelRows } from '@/lib/spreadsheet';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Upload, FileSpreadsheet, ArrowLeft, ArrowRight, CheckCircle2, AlertTriangle, ChevronDown, Loader2, Users } from 'lucide-react';

const CANDIDATE_FIELDS = [
  { value: '', label: '— Overslaan —' },
  { value: 'first_name', label: 'Voornaam *' },
  { value: 'last_name', label: 'Achternaam *' },
  { value: 'email', label: 'E-mail' },
  { value: 'phone', label: 'Telefoon' },
  { value: 'date_of_birth', label: 'Geboortedatum' },
  { value: 'nationality', label: 'Nationaliteit' },
  { value: 'bsn', label: 'BSN' },
  { value: 'iban', label: 'IBAN' },
  { value: 'address_street', label: 'Straat' },
  { value: 'address_postal', label: 'Postcode' },
  { value: 'address_city', label: 'Stad' },
  { value: 'skills', label: 'Vaardigheden (kommagescheiden)' },
  { value: 'languages', label: 'Talen (kommagescheiden)' },
  { value: 'source', label: 'Bron' },
  { value: 'notes', label: 'Notities' },
  { value: 'external_id', label: 'Extern ID (Carerix)' },
];

const AUTO_MAP: Record<string, string> = {
  voornaam: 'first_name', 'first name': 'first_name', firstname: 'first_name',
  achternaam: 'last_name', 'last name': 'last_name', lastname: 'last_name',
  email: 'email', 'e-mail': 'email',
  telefoon: 'phone', phone: 'phone', mobiel: 'phone',
  geboortedatum: 'date_of_birth', 'date of birth': 'date_of_birth',
  nationaliteit: 'nationality', nationality: 'nationality',
  bsn: 'bsn', iban: 'iban',
  straat: 'address_street', street: 'address_street',
  postcode: 'address_postal', 'postal code': 'address_postal',
  stad: 'address_city', city: 'address_city', woonplaats: 'address_city',
  vaardigheden: 'skills', skills: 'skills',
  talen: 'languages', languages: 'languages',
  bron: 'source', source: 'source',
  notities: 'notes', notes: 'notes',
};

const ImportData = () => {
  const orgId = useOrganizationId();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(1);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<number, string>>({});

  // Step 3 options
  const [deduplicateOnEmail, setDeduplicateOnEmail] = useState(true);
  const [importStatus, setImportStatus] = useState('nieuw');
  const [saveExternalId, setSaveExternalId] = useState(true);
  const [externalSystem, setExternalSystem] = useState('carerix');

  // Step 4
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [progress, setProgress] = useState({ processed: 0, imported: 0, skipped: 0, errors: [] as string[] });
  const [errorsOpen, setErrorsOpen] = useState(false);

  const hasExternalIdMapped = Object.values(mapping).includes('external_id');
  const hasFirstName = Object.values(mapping).includes('first_name');
  const hasLastName = Object.values(mapping).includes('last_name');

  const handleFile = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'csv') {
      Papa.parse(file, {
        complete: (res) => {
          const data = res.data as string[][];
          if (data.length > 0) {
            setHeaders(data[0]);
            setRows(data.slice(1).filter(r => r.some(c => c?.trim())));
          }
        },
        skipEmptyLines: true,
      });
    } else if (ext === 'xlsx') {
      readExcelRows(file)
        .then((data) => {
          if (data.length > 0) {
            setHeaders(data[0].map(String));
            setRows(data.slice(1).filter(r => r.some(c => c != null && String(c).trim())));
          }
        })
        .catch(() => toast.error('Excel-bestand kon niet worden gelezen'));
    } else {
      toast.error('Gebruik een CSV- of .xlsx-bestand');
    }
  };

  // Auto-map when entering step 2
  useEffect(() => {
    if (step === 2 && headers.length > 0) {
      const auto: Record<number, string> = {};
      headers.forEach((h, i) => {
        const key = h.toLowerCase().trim();
        if (AUTO_MAP[key]) auto[i] = AUTO_MAP[key];
      });
      setMapping((current) => {
        if (Object.keys(current).length > 0 || Object.keys(auto).length === 0) return current;
        return auto;
      });
    }
  }, [step, headers]);

  const runImport = async () => {
    setImporting(true);
    setImportDone(false);
    const results = { processed: 0, imported: 0, skipped: 0, errors: [] as string[] };
    const BATCH = 50;

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);

      for (let j = 0; j < batch.length; j++) {
        const row = batch[j];
        const rowNum = i + j + 2;
        results.processed++;

        try {
          const candidate: Record<string, unknown> = { organization_id: orgId, status: importStatus };

          for (const [colIdx, field] of Object.entries(mapping)) {
            const rawVal = row[Number(colIdx)];
            const value = rawVal != null ? String(rawVal).trim() : '';
            if (!value || !field) continue;

            if (field === 'skills' || field === 'languages') {
              candidate[field] = value.split(',').map(s => s.trim()).filter(Boolean);
            } else {
              candidate[field] = value;
            }
          }

          if (!candidate.first_name || !candidate.last_name) {
            results.errors.push(`Rij ${rowNum}: voornaam of achternaam ontbreekt`);
            continue;
          }

          if (deduplicateOnEmail && candidate.email) {
            const { count } = await supabase
              .from('candidates')
              .select('id', { count: 'exact', head: true })
              .eq('organization_id', orgId)
              .eq('email', candidate.email as string);
            if ((count ?? 0) > 0) {
              results.skipped++;
              continue;
            }
          }

          // Remove external_id before insert (not a candidates column)
          const externalId = candidate.external_id as string | undefined;
          delete candidate.external_id;

          const { data: inserted, error } = await supabase
            .from('candidates')
            .insert(candidate as any)
            .select('id')
            .single();

          if (error) {
            results.errors.push(`Rij ${rowNum}: ${error.message}`);
            continue;
          }

          if (saveExternalId && externalId && inserted) {
            await supabase.from('external_mappings').insert({
              organization_id: orgId,
              entity_type: 'candidate',
              entity_id: inserted.id,
              external_system: externalSystem,
              external_id: externalId,
            });
          }

          results.imported++;
        } catch (err: any) {
          results.errors.push(`Rij ${rowNum}: ${err.message}`);
        }
      }

      setProgress({ ...results });
    }

    setImporting(false);
    setImportDone(true);
    setProgress(results);
    queryClient.invalidateQueries({ queryKey: ['candidates'] });
    toast.success(`Import voltooid: ${results.imported} kandidaten geïmporteerd`);
  };

  const resetAll = () => {
    setStep(1);
    setHeaders([]);
    setRows([]);
    setMapping({});
    setDeduplicateOnEmail(true);
    setImportStatus('nieuw');
    setSaveExternalId(true);
    setExternalSystem('carerix');
    setImporting(false);
    setImportDone(false);
    setProgress({ processed: 0, imported: 0, skipped: 0, errors: [] });
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Data importeren</h1>
      <p className="text-sm text-muted-foreground mb-6">Importeer kandidaten en opdrachtgevers vanuit Excel of CSV</p>

      <Tabs defaultValue="kandidaten">
        <TabsList>
          <TabsTrigger value="kandidaten">Kandidaten importeren</TabsTrigger>
          <TabsTrigger value="opdrachtgevers" disabled>Opdrachtgevers importeren</TabsTrigger>
        </TabsList>

        <TabsContent value="kandidaten" className="mt-6">
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-6">
            {[1, 2, 3, 4].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  s === step ? 'bg-primary text-primary-foreground' :
                  s < step ? 'bg-primary/20 text-stat-blue' : 'bg-muted text-muted-foreground'
                }`}>
                  {s < step ? '✓' : s}
                </div>
                {s < 4 && <div className={`h-0.5 w-8 ${s < step ? 'bg-primary/40' : 'bg-muted'}`} />}
              </div>
            ))}
          </div>

          {/* Step 1: Upload */}
          {step === 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Upload className="h-4 w-4" /> Bestand uploaden
                </CardTitle>
                <CardDescription>Upload een CSV of Excel bestand met kandidaatgegevens</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Selecteer bestand</Label>
                  <Input
                    type="file"
                    accept=".csv,.xlsx"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFile(file);
                    }}
                    className="mt-1"
                  />
                </div>

                {headers.length > 0 && (
                  <>
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="h-4 w-4 text-stat-blue" />
                      <span className="text-sm font-medium">{rows.length} rijen gevonden</span>
                    </div>

                    <div className="border rounded-lg overflow-auto max-h-64">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {headers.map((h, i) => (
                              <TableHead key={i} className="text-xs whitespace-nowrap">{h}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.slice(0, 5).map((row, ri) => (
                            <TableRow key={ri}>
                              {row.map((cell, ci) => (
                                <TableCell key={ci} className="text-xs whitespace-nowrap max-w-[200px] truncate">
                                  {cell}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    <div className="flex justify-end">
                      <Button onClick={() => setStep(2)}>
                        Volgende <ArrowRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Step 2: Column mapping */}
          {step === 2 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Kolom mapping</CardTitle>
                <CardDescription>Koppel de kolommen uit je bestand aan de kandidaatvelden</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!hasFirstName || !hasLastName ? (
                  <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
                    <AlertTriangle className="h-4 w-4" />
                    Voornaam en achternaam moeten gemapt zijn om door te gaan
                  </div>
                ) : null}

                <div className="border rounded-lg overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Kolom in bestand</TableHead>
                        <TableHead>Kandidaatveld</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {headers.map((h, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium text-sm">{h}</TableCell>
                          <TableCell>
                            <Select
                              value={mapping[i] ?? ''}
                              onValueChange={(val) => setMapping(prev => ({ ...prev, [i]: val }))}
                            >
                              <SelectTrigger className="w-[240px]">
                                <SelectValue placeholder="— Overslaan —" />
                              </SelectTrigger>
                              <SelectContent>
                                {CANDIDATE_FIELDS.map((f) => (
                                  <SelectItem key={f.value} value={f.value || '_skip'}>
                                    {f.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setStep(1)}>
                    <ArrowLeft className="h-4 w-4 mr-1" /> Vorige
                  </Button>
                  <Button onClick={() => setStep(3)} disabled={!hasFirstName || !hasLastName}>
                    Volgende <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 3: Import options */}
          {step === 3 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Import opties</CardTitle>
                <CardDescription>Configureer hoe de import wordt uitgevoerd</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="dedup"
                    checked={deduplicateOnEmail}
                    onCheckedChange={(c) => setDeduplicateOnEmail(!!c)}
                  />
                  <Label htmlFor="dedup">Dubbele records overslaan (op basis van e-mail)</Label>
                </div>

                <div>
                  <Label>Status voor nieuwe kandidaten</Label>
                  <Select value={importStatus} onValueChange={setImportStatus}>
                    <SelectTrigger className="w-[240px] mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nieuw">Nieuw</SelectItem>
                      <SelectItem value="werkzoekend">Werkzoekend</SelectItem>
                      <SelectItem value="in_screening">In screening</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {hasExternalIdMapped && (
                  <>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="extid"
                        checked={saveExternalId}
                        onCheckedChange={(c) => setSaveExternalId(!!c)}
                      />
                      <Label htmlFor="extid">Extern ID opslaan voor koppeling</Label>
                    </div>

                    <div>
                      <Label>Extern systeem</Label>
                      <Input
                        value={externalSystem}
                        onChange={(e) => setExternalSystem(e.target.value)}
                        className="w-[240px] mt-1"
                        placeholder="carerix"
                      />
                    </div>
                  </>
                )}

                <div className="flex justify-between pt-2">
                  <Button variant="outline" onClick={() => setStep(2)}>
                    <ArrowLeft className="h-4 w-4 mr-1" /> Vorige
                  </Button>
                  <Button onClick={() => { setStep(4); runImport(); }}>
                    Importeren <Upload className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 4: Progress & Results */}
          {step === 4 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {importing ? 'Bezig met importeren...' : 'Import voltooid'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {importing && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {progress.processed} van {rows.length} verwerkt
                    </div>
                    <Progress value={(progress.processed / rows.length) * 100} />
                  </div>
                )}

                {importDone && (
                  <div className="space-y-4">
                    <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 flex items-center gap-3">
                      <CheckCircle2 className="h-5 w-5 text-stat-blue" />
                      <span className="font-medium">Import voltooid</span>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="text-center p-3 rounded-lg bg-muted">
                        <div className="text-2xl font-bold text-stat-blue">{progress.imported}</div>
                        <div className="text-xs text-muted-foreground">Geïmporteerd</div>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-muted">
                        <div className="text-2xl font-bold text-muted-foreground">{progress.skipped}</div>
                        <div className="text-xs text-muted-foreground">Overgeslagen</div>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-muted">
                        <div className="text-2xl font-bold text-destructive">{progress.errors.length}</div>
                        <div className="text-xs text-muted-foreground">Fouten</div>
                      </div>
                    </div>

                    {progress.errors.length > 0 && (
                      <Collapsible open={errorsOpen} onOpenChange={setErrorsOpen}>
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="sm" className="gap-1 text-destructive">
                            <AlertTriangle className="h-4 w-4" />
                            {progress.errors.length} fouten bekijken
                            <ChevronDown className={`h-4 w-4 transition-transform ${errorsOpen ? 'rotate-180' : ''}`} />
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="mt-2 max-h-48 overflow-auto border rounded-lg p-3 space-y-1">
                            {progress.errors.map((err, i) => (
                              <p key={i} className="text-xs text-destructive">{err}</p>
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    <div className="flex gap-2 pt-2">
                      <Button variant="outline" onClick={resetAll}>
                        Nog een import
                      </Button>
                      <Button asChild>
                        <Link to="/kandidaten">
                          <Users className="h-4 w-4 mr-1" /> Naar kandidaten
                        </Link>
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="opdrachtgevers" className="mt-6">
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Binnenkort beschikbaar
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ImportData;
