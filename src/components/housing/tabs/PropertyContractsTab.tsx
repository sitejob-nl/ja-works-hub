import { useEffect, useState, type DragEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Upload, ExternalLink, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';
import { unwrap, unwrapDeleted } from '@/lib/db';
import { formatEUR } from '@/lib/format';
import { toFriendlyError } from '@/lib/errorMessages';
import { allowFileDrop, getDroppedFiles } from '@/lib/file-input';

const CONTRACT_TYPE_LABELS: Record<string, string> = {
  inhuur: 'Inhuurcontract',
  onderhuur: 'Onderhuurcontract',
};

export default function PropertyContractsTab({ property }: { property: any }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ contract_type: 'inhuur', start_date: '', end_date: '', notes: '' });

  const { data: contracts = [] } = useQuery({
    queryKey: ['property-contracts', property.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('property_contracts' as any)
        .select('*')
        .eq('property_id', property.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  // Borg van het pand: wat JA Werkt aan de verhuurder heeft betaald voor de woning als
  // geheel. Hoort bij het huurcontract en niet bij de bewonerskosten — dat is de borg die
  // een bewoner betaalt, een ander bedrag en een andere tegenpartij. Op `properties` en
  // niet op een contractrij, omdat een contractrij een geüpload bestand vereist en de borg
  // ook bekend is zonder pdf.
  const [deposit, setDeposit] = useState({
    amount: property.deposit_amount == null ? '' : String(property.deposit_amount),
    paidDate: property.deposit_paid_date ?? '',
  });

  useEffect(() => {
    setDeposit({
      amount: property.deposit_amount == null ? '' : String(property.deposit_amount),
      paidDate: property.deposit_paid_date ?? '',
    });
  }, [property.id, property.deposit_amount, property.deposit_paid_date]);

  const depositDirty =
    deposit.amount !== (property.deposit_amount == null ? '' : String(property.deposit_amount))
    || deposit.paidDate !== (property.deposit_paid_date ?? '');

  const saveDeposit = useMutation({
    mutationFn: async () => {
      const payload = {
        deposit_amount: deposit.amount === '' ? null : Number(deposit.amount),
        deposit_paid_date: deposit.paidDate || null,
      };
      await unwrap(supabase.from('properties').update(payload as any).eq('id', property.id).select('id').single());
      return payload;
    },
    onSuccess: (payload) => {
      qc.invalidateQueries({ queryKey: ['property', property.id] });
      qc.invalidateQueries({ queryKey: ['properties'] });
      logAudit({ action: 'update', tableName: 'properties', recordId: property.id, newValues: payload });
      toast.success('Borg opgeslagen');
    },
    onError: (e: any) => toast.error(toFriendlyError(e)),
  });

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Kies eerst een bestand');
      const ext = file.name.split('.').pop() || 'pdf';
      const path = `${property.organization_id}/${property.id}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('property-contracts').upload(path, file, { upsert: false });
      if (uploadError) throw uploadError;
      const payload = {
        organization_id: property.organization_id,
        property_id: property.id,
        file_path: path,
        original_name: file.name,
        contract_type: form.contract_type,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        notes: form.notes || null,
        uploaded_by: user?.id ?? null,
      };
      const { data, error } = await supabase.from('property_contracts' as any).insert(payload).select('id').single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['property-contracts', property.id] });
      logAudit({ action: 'create', tableName: 'property_contracts', recordId: data.id });
      toast.success('Contract geüpload');
      setFile(null);
      setForm({ contract_type: 'inhuur', start_date: '', end_date: '', notes: '' });
    },
    onError: (e: any) => toast.error(e.message ?? 'Upload mislukt'),
  });

  const remove = useMutation({
    mutationFn: async (contract: any) => {
      // Rowcount-check: een door RLS geweigerde delete geeft geen error, alleen 0 rijen.
      // Eerst de rij, dan pas het bestand — anders is bij een geweigerde delete het PDF weg
      // terwijl het contract in de lijst blijft staan.
      await unwrapDeleted(
        supabase.from('property_contracts' as any).delete().eq('id', contract.id),
        'Dit contract kon niet worden verwijderd — je hebt hiervoor mogelijk beheerdersrechten nodig.',
      );
      await supabase.storage.from('property-contracts').remove([contract.file_path]);
      logAudit({ action: 'delete', tableName: 'property_contracts', recordId: contract.id });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['property-contracts', property.id] });
      toast.success('Contract verwijderd');
    },
    onError: (e: any) => toast.error(toFriendlyError(e, 'Verwijderen mislukt')),
  });

  const openContract = async (path: string) => {
    const { data, error } = await supabase.storage.from('property-contracts').createSignedUrl(path, 60 * 10);
    if (error) {
      toast.error(error.message);
      return;
    }
    window.open(data.signedUrl, '_blank');
  };

  const handleFileDrop = (event: DragEvent<HTMLDivElement>) => {
    const [droppedFile] = getDroppedFiles(event);
    if (droppedFile) setFile(droppedFile);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Borg pand</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3 md:items-end">
          <div className="space-y-1.5">
            <Label>Borgbedrag</Label>
            <Input
              type="number"
              step="0.01"
              placeholder="0,00"
              value={deposit.amount}
              onChange={(e) => setDeposit((d) => ({ ...d, amount: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Betaald op</Label>
            <Input
              type="date"
              value={deposit.paidDate}
              onChange={(e) => setDeposit((d) => ({ ...d, paidDate: e.target.value }))}
            />
          </div>
          <div className="flex justify-start md:justify-end">
            <Button onClick={() => saveDeposit.mutate()} disabled={!depositDirty || saveDeposit.isPending}>
              Opslaan
            </Button>
          </div>
          <p className="text-xs text-muted-foreground md:col-span-3">
            Het bedrag dat aan de verhuurder is betaald voor dit pand
            {property.deposit_amount != null && ` (nu ${formatEUR(property.deposit_amount)})`}.
            De borg die bewoners betalen staat per bewoner op de Bewoners-tab.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Nieuw huurcontract</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label>Contracttype</Label>
            <Select value={form.contract_type} onValueChange={(value) => setForm((f) => ({ ...f, contract_type: value }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="inhuur">Inhuurcontract (JA Werkt ↔ eigenaar)</SelectItem>
                <SelectItem value="onderhuur">Onderhuurcontract (JA Werkt ↔ bewoner)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>Bestand</Label>
            <div
              className="rounded-md border border-dashed border-input bg-background p-3 transition-colors hover:border-primary/60"
              onDragOver={allowFileDrop}
              onDrop={handleFileDrop}
            >
              <Input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <p className="mt-2 text-xs text-muted-foreground">
                {file ? `${file.name} staat klaar` : 'Sleep hier een contract naartoe of kies een bestand.'}
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Begindatum</Label>
            <Input type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Einddatum</Label>
            <Input type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>Notities</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button onClick={() => upload.mutate()} disabled={!file || upload.isPending} className="gap-2">
              <Upload className="h-4 w-4" /> Uploaden
            </Button>
          </div>
        </CardContent>
      </Card>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Bestand</TableHead>
            <TableHead>Begindatum</TableHead>
            <TableHead>Einddatum</TableHead>
            <TableHead>Notities</TableHead>
            <TableHead className="text-right">Actie</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contracts.map((contract: any) => (
            <TableRow key={contract.id}>
              <TableCell>{CONTRACT_TYPE_LABELS[contract.contract_type] ?? contract.contract_type ?? 'Huurcontract'}</TableCell>
              <TableCell className="font-medium">{contract.original_name}</TableCell>
              <TableCell>{contract.start_date ? new Date(contract.start_date).toLocaleDateString('nl-NL') : '—'}</TableCell>
              <TableCell>{contract.end_date ? new Date(contract.end_date).toLocaleDateString('nl-NL') : '—'}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{contract.notes ?? '—'}</TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openContract(contract.file_path)} className="gap-1">
                    <ExternalLink className="h-3.5 w-3.5" /> Open
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => remove.mutate(contract)} className="gap-1 text-destructive">
                    <Trash2 className="h-3.5 w-3.5" /> Verwijder
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {contracts.length === 0 && (
            <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Geen contractbestanden</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
