import { usePortal } from '@/contexts/PortalContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Download, FileText } from 'lucide-react';

const statusLabels: Record<string, { label: string; className: string }> = {
  concept: { label: 'Concept', className: 'bg-muted text-muted-foreground border-0' },
  ingediend: { label: 'Ingediend', className: 'bg-yellow-100 text-yellow-700 border-0' },
  goedgekeurd: { label: 'Goedgekeurd', className: 'bg-stat-green/10 text-stat-green border-0' },
  afgekeurd: { label: 'Afgekeurd', className: 'bg-red-100 text-red-600 border-0' },
  verwerkt: { label: 'Verwerkt', className: 'bg-stat-blue/10 text-stat-blue border-0' },
};

const PortalHourLetters = () => {
  const { employee } = usePortal();

  const { data: hourLetters = [], isLoading } = useQuery({
    queryKey: ['portal-hour-letters', employee?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hour_letters')
        .select('*, placements:placement_id(companies:company_id(name))')
        .eq('candidate_id', employee!.id)
        .order('year', { ascending: false })
        .order('week_number', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!employee?.id,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Mijn urenbrieven</h1>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Laden...</p>
      ) : hourLetters.length === 0 ? (
        <div className="bg-card rounded-xl border p-8 text-center text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p>Geen urenbrieven gevonden</p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border divide-y">
          {hourLetters.map((hl: any) => {
            const sc = statusLabels[hl.status] ?? statusLabels.concept;
            return (
              <div key={hl.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium">
                    Week {hl.week_number} – {hl.year}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {hl.placements?.companies?.name ?? '—'} · {hl.total_hours ?? 0}u
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className={`text-[10px] ${sc.className}`}>
                    {sc.label}
                  </Badge>
                  {hl.pdf_url && (
                    <Button variant="ghost" size="icon" onClick={() => window.open(hl.pdf_url, '_blank')}>
                      <Download className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PortalHourLetters;
