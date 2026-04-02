import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollText, Check, Clock, Eye } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { toast } from 'sonner';
import { useState } from 'react';
import { logAudit } from '@/lib/audit';

const EmployeeRegulationsTab = ({ candidateId }: { candidateId: string }) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [viewReg, setViewReg] = useState<any>(null);
  const [agreed, setAgreed] = useState(false);

  const { data: regulations = [] } = useQuery({
    queryKey: ['regulations', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('regulations')
        .select('*')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('title');
      if (error) throw error;
      return data;
    },
  });

  const { data: acknowledgements = [] } = useQuery({
    queryKey: ['regulation-acks', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('regulation_acknowledgements')
        .select('*')
        .eq('candidate_id', candidateId);
      if (error) throw error;
      return data;
    },
  });

  const sign = useMutation({
    mutationFn: async (regulationId: string) => {
      const { error } = await supabase.from('regulation_acknowledgements').insert({
        organization_id: orgId,
        regulation_id: regulationId,
        candidate_id: candidateId,
      });
      if (error) throw error;
    },
    onSuccess: (_, regulationId) => {
      qc.invalidateQueries({ queryKey: ['regulation-acks', candidateId] });
      logAudit({ action: 'create', tableName: 'regulation_acknowledgements', recordId: regulationId, newValues: { candidate_id: candidateId } });
      setViewReg(null);
      setAgreed(false);
      toast.success('Reglement getekend');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const ackMap = new Map(acknowledgements.map((a: any) => [a.regulation_id, a]));

  const pending = regulations.filter((r: any) => !ackMap.has(r.id));
  const signed = regulations.filter((r: any) => ackMap.has(r.id));

  return (
    <div className="space-y-6">
      {/* Pending */}
      <div>
        <h3 className="font-medium mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4 text-orange-500" />
          Te tekenen ({pending.length})
        </h3>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">Alle reglementen zijn getekend ✓</p>
        ) : (
          <div className="bg-card rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reglement</TableHead>
                  <TableHead>Versie</TableHead>
                  <TableHead>Gepubliceerd</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.title}</TableCell>
                    <TableCell>v{r.version}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(r.published_at)}</TableCell>
                    <TableCell>
                      <Button size="sm" onClick={() => { setViewReg(r); setAgreed(false); }}>
                        <Eye className="h-3.5 w-3.5 mr-1.5" /> Bekijken & tekenen
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Signed */}
      {signed.length > 0 && (
        <div>
          <h3 className="font-medium mb-3 flex items-center gap-2">
            <Check className="h-4 w-4 text-stat-green" />
            Getekend ({signed.length})
          </h3>
          <div className="bg-card rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reglement</TableHead>
                  <TableHead>Versie</TableHead>
                  <TableHead>Getekend op</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {signed.map((r: any) => {
                  const ack = ackMap.get(r.id);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.title}</TableCell>
                      <TableCell>v{r.version}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(ack?.signed_at)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Sign dialog */}
      <Dialog open={!!viewReg} onOpenChange={() => { setViewReg(null); setAgreed(false); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewReg?.title} (v{viewReg?.version})</DialogTitle>
          </DialogHeader>
          <div className="whitespace-pre-wrap text-sm border rounded-lg p-4 bg-muted/30 max-h-[40vh] overflow-y-auto">
            {viewReg?.content}
          </div>
          <div className="flex items-start gap-2 pt-2">
            <Checkbox
              id="agree"
              checked={agreed}
              onCheckedChange={(v) => setAgreed(v === true)}
            />
            <label htmlFor="agree" className="text-sm cursor-pointer">
              Ik heb dit reglement gelezen en ga akkoord met de inhoud
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setViewReg(null)}>Sluiten</Button>
            <Button
              onClick={() => sign.mutate(viewReg.id)}
              disabled={!agreed || sign.isPending}
            >
              {sign.isPending ? 'Tekenen...' : 'Tekenen'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EmployeeRegulationsTab;
