import { usePortal } from '@/contexts/PortalContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Download, FileText } from 'lucide-react';
import { formatEUR } from '@/lib/format';

const PortalAnnualStatements = () => {
  const { employee } = usePortal();

  const { data: statements = [], isLoading } = useQuery({
    queryKey: ['portal-annual-statements', employee?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('annual_statements')
        .select('*')
        .eq('candidate_id', employee!.id)
        .in('status', ['definitief', 'verzonden'])
        .order('year', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!employee?.id,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Mijn jaaropgaven</h1>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Laden...</p>
      ) : statements.length === 0 ? (
        <div className="bg-card rounded-xl border p-8 text-center text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p>Geen jaaropgaven gevonden</p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border divide-y">
          {statements.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium">Jaaropgave {s.year}</p>
                <p className="text-xs text-muted-foreground">
                  Bruto: {formatEUR(s.total_gross)} · Netto: {formatEUR(s.total_net)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px] bg-stat-green/10 text-stat-green border-0">
                  {s.status === 'verzonden' ? 'Verzonden' : 'Definitief'}
                </Badge>
                {s.pdf_url && (
                  <Button variant="ghost" size="icon" onClick={() => window.open(s.pdf_url!, '_blank')}>
                    <Download className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PortalAnnualStatements;
