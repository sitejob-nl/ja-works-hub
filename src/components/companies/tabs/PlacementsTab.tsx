import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BriefcaseBusiness, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDate, formatEUR } from '@/lib/format';
import PlacementWizard from '@/components/placement/PlacementWizard';
import DeletePlacementDialog, { type DeletePlacementTarget } from '@/components/placements/DeletePlacementDialog';

const statusColors: Record<string, string> = {
  actief: 'bg-stat-green/10 text-stat-green border-0',
  gepland: 'bg-stat-blue/10 text-stat-blue border-0',
  afgerond: '',
  voortijdig_beeindigd: 'bg-destructive/10 text-destructive border-0',
};

const PlacementsTab = ({ companyId, companyName }: { companyId: string; companyName?: string }) => {
  const orgId = useOrganizationId();
  const { user, role } = useAuth();
  // Definitief verwijderen is admin-only, gelijk aan de RLS-policy tenant_delete op placements.
  const canDelete = role === 'admin';
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeletePlacementTarget | null>(null);

  const { data: placements = [] } = useQuery({
    queryKey: ['company-placements', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('placements')
        .select('*, candidates!placements_candidate_id_fkey(id, first_name, last_name), employees!placements_employee_id_fkey(candidate_id, candidates!employees_candidate_id_fkey(first_name, last_name))')
        .eq('company_id', companyId)
        .order('status', { ascending: true })
        .order('start_date', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Plaatsingen</h3>
        <Button size="sm" variant="outline" className="gap-1" onClick={() => setSheetOpen(true)}>
          <Plus className="h-3.5 w-3.5" />Nieuwe plaatsing
        </Button>
      </div>
      <div className="bg-card rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Medewerker</TableHead>
              <TableHead>Functie</TableHead>
              <TableHead>Startdatum</TableHead>
              <TableHead>Einddatum</TableHead>
              <TableHead>Uurtarief</TableHead>
              <TableHead>Status</TableHead>
              {canDelete && <TableHead className="w-10"><span className="sr-only">Acties</span></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {placements.map((p: any) => {
              const candidate = p.candidates ?? p.employees?.candidates;
              const name = candidate ? `${candidate.first_name} ${candidate.last_name}` : '—';
              const candidateId = p.candidate_id ?? p.employees?.candidate_id ?? candidate?.id;
              return (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    {candidateId ? (
                      <Link to={`/kandidaten/${candidateId}`} className="hover:text-stat-blue transition-colors">
                        {name}
                      </Link>
                    ) : (
                      name
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Link to={`/plaatsingen/${p.id}`} className="hover:text-stat-blue transition-colors">
                        {p.function_name}
                      </Link>
                      {p.vacancy_id && (
                        <Link
                          to={`/vacatures/${p.vacancy_id}`}
                          className="text-muted-foreground hover:text-stat-blue transition-colors"
                          aria-label="Open vacature"
                          title="Open vacature"
                        >
                          <BriefcaseBusiness className="h-4 w-4" />
                        </Link>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{formatDate(p.start_date)}</TableCell>
                  <TableCell>{formatDate(p.end_date)}</TableCell>
                  <TableCell>{formatEUR(p.hourly_rate)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={statusColors[p.status] ?? ''}>
                      {p.status.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  {canDelete && (
                    <TableCell className="w-10 py-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        aria-label={`Plaatsing van ${name} verwijderen`}
                        title="Plaatsing verwijderen"
                        onClick={() => setDeleteTarget({
                          id: p.id,
                          function_name: p.function_name,
                          start_date: p.start_date,
                          end_date: p.end_date,
                          expected_end_date: p.expected_end_date,
                          candidateName: candidate ? name : null,
                          companyName,
                          row: p,
                        })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
            {placements.length === 0 && (
              <TableRow><TableCell colSpan={canDelete ? 7 : 6} className="text-center text-muted-foreground py-8">Nog geen plaatsingen bij dit bedrijf</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {canDelete && (
        <DeletePlacementDialog
          open={!!deleteTarget}
          onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
          placement={deleteTarget}
        />
      )}

      <PlacementWizard
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        defaultCompanyId={companyId}
        lockedCompanyName={companyName}
      />
    </div>
  );
};

export default PlacementsTab;
