import { useState } from 'react';
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
      await supabase.storage.from('property-contracts').remove([contract.file_path]);
      const { error } = await supabase.from('property_contracts' as any).delete().eq('id', contract.id);
      if (error) throw error;
      logAudit({ action: 'delete', tableName: 'property_contracts', recordId: contract.id });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['property-contracts', property.id] });
      toast.success('Contract verwijderd');
    },
    onError: (e: any) => toast.error(e.message ?? 'Verwijderen mislukt'),
  });

  const openContract = async (path: string) => {
    const { data, error } = await supabase.storage.from('property-contracts').createSignedUrl(path, 60 * 10);
    if (error) {
      toast.error(error.message);
      return;
    }
    window.open(data.signedUrl, '_blank');
  };

  return (
    <div className="space-y-4">
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
            <Input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
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
