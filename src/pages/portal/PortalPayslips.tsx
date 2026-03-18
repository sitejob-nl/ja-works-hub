import { usePortal } from '@/contexts/PortalContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Download, FileText } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { toast } from 'sonner';

const PortalPayslips = () => {
  const { employee } = usePortal();

  const { data: payslips = [], isLoading } = useQuery({
    queryKey: ['portal-payslips', employee?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payslips')
        .select('*')
        .eq('employee_id', employee!.id)
        .eq('status', 'definitief' as any)
        .order('period_year', { ascending: false })
        .order('period_number', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!employee?.id,
  });

  const downloadPdf = async (url: string) => {
    if (!url) { toast.error('Geen PDF beschikbaar'); return; }
    window.open(url, '_blank');
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Mijn loonstroken</h1>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Laden...</p>
      ) : payslips.length === 0 ? (
        <div className="bg-card rounded-xl border p-8 text-center text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p>Geen loonstroken gevonden</p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border divide-y">
          {payslips.map((ps: any) => (
            <div key={ps.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium">Periode {ps.period_number} – {ps.period_year}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(ps.period_start)} – {formatDate(ps.period_end)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px] bg-stat-green/10 text-stat-green border-0">
                  Definitief
                </Badge>
                {ps.pdf_url && (
                  <Button variant="ghost" size="icon" onClick={() => downloadPdf(ps.pdf_url)}>
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

export default PortalPayslips;
