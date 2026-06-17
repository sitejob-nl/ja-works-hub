import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/format';

const statusLabels: Record<string, string> = {
  open: 'Open',
  on_hold: 'On hold',
  vervuld: 'Vervuld',
  gesloten: 'Gesloten',
};

const statusColors: Record<string, string> = {
  open: 'bg-stat-green/10 text-stat-green border-0',
  on_hold: 'bg-orange-100 text-orange-700 border-0',
  vervuld: 'bg-stat-blue/10 text-stat-blue border-0',
  gesloten: '',
};

const urgencyLabels: Record<number, string> = { 1: 'Laag', 2: 'Normaal', 3: 'Hoog' };

const CompanyVacanciesTab = ({ companyId }: { companyId: string }) => {
  const navigate = useNavigate();

  const { data: vacancies = [] } = useQuery({
    queryKey: ['company-vacancies', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vacancies')
        .select('id, title, status, required_count, start_date, start_date_text, urgency, created_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Vacatures</h3>
        <Button size="sm" variant="outline" className="gap-1" onClick={() => navigate(`/vacatures/new?company=${companyId}`)}>
          <Plus className="h-3.5 w-3.5" />Nieuwe vacature
        </Button>
      </div>

      <div className="bg-card rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Titel</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Aantal</TableHead>
              <TableHead>Startdatum</TableHead>
              <TableHead>Urgentie</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vacancies.map((v: any) => (
              <TableRow key={v.id}>
                <TableCell className="font-medium">
                  <Link to={`/vacatures/${v.id}`} className="hover:text-stat-blue transition-colors">
                    {v.title}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className={statusColors[v.status] ?? ''}>
                    {statusLabels[v.status] ?? v.status}
                  </Badge>
                </TableCell>
                <TableCell>{v.required_count ?? 1}</TableCell>
                <TableCell>{v.start_date ? formatDate(v.start_date) : (v.start_date_text || '—')}</TableCell>
                <TableCell>{urgencyLabels[v.urgency] ?? v.urgency}</TableCell>
              </TableRow>
            ))}
            {vacancies.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Nog geen vacatures bij dit bedrijf</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default CompanyVacanciesTab;
