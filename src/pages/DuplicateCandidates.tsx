import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, Merge, ShieldCheck, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { toFriendlyError } from '@/lib/errorMessages';

interface DupRow {
  group_key: string;
  match_reason: string;
  candidate_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  status: string | null;
  created_at: string;
  has_employee: boolean;
}

interface DupGroup {
  key: string;
  reason: string;
  rows: DupRow[];
}

const DuplicateCandidates = () => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  // survivor per group_key
  const [survivors, setSurvivors] = useState<Record<string, string>>({});

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['duplicate-candidates', orgId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('find_duplicate_candidates');
      if (error) throw error;
      const byKey = new Map<string, DupGroup>();
      for (const row of (data ?? []) as DupRow[]) {
        if (!byKey.has(row.group_key)) byKey.set(row.group_key, { key: row.group_key, reason: row.match_reason, rows: [] });
        byKey.get(row.group_key)!.rows.push(row);
      }
      return Array.from(byKey.values());
    },
    enabled: !!orgId,
  });

  const mergeGroup = useMutation({
    mutationFn: async (group: DupGroup) => {
      const survivorId = survivors[group.key] ?? group.rows[0].candidate_id;
      const losers = group.rows.filter((r) => r.candidate_id !== survivorId);
      if (losers.length === 0) throw new Error('Kies een ander profiel om te behouden');
      // Sequentieel: elke loser in de survivor mergen (RPC werkt per paar).
      for (const loser of losers) {
        const { error } = await (supabase as any).rpc('merge_candidate_records', {
          p_survivor: survivorId,
          p_loser: loser.candidate_id,
          p_actor: user?.id ?? null,
        });
        if (error) throw new Error(error.message);
      }
      return { merged: losers.length };
    },
    onSuccess: ({ merged }) => {
      qc.invalidateQueries({ queryKey: ['duplicate-candidates', orgId] });
      qc.invalidateQueries({ queryKey: ['candidates'] });
      toast.success(`${merged} dubbel profiel${merged === 1 ? '' : 'en'} samengevoegd`);
    },
    onError: (e: any) => toast.error(toFriendlyError(e)),
  });

  const fullName = (r: DupRow) => `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || '(naamloos)';

  return (
    <div className="space-y-6">
      <div>
        <Link to="/kandidaten" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Kandidaten
        </Link>
        <div className="flex items-center justify-between gap-3 flex-wrap mt-1">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold">Duplicatenbeheer</h1>
            <p className="text-sm text-muted-foreground">
              Mogelijke dubbele kandidaten op basis van e-mail, telefoonnummer of geboortedatum + achternaam.
              Kies per groep welk profiel je behoudt; de rest wordt erin samengevoegd.
            </p>
          </div>
          {!isLoading && <Badge variant="outline">{groups.length} groep{groups.length === 1 ? '' : 'en'}</Badge>}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <ShieldCheck className="h-12 w-12 text-stat-green/50 mb-4" />
          <p className="text-lg font-medium text-muted-foreground">Geen mogelijke duplicaten gevonden</p>
          <p className="text-sm text-muted-foreground">Je kandidatenbestand is schoon op telefoon en geboortedatum + naam.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => {
            const survivorId = survivors[group.key] ?? group.rows[0].candidate_id;
            const employeeCount = group.rows.filter((r) => r.has_employee).length;
            const blocked = employeeCount > 1;
            return (
              <Card key={group.key} className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <Badge variant="secondary" className="gap-1">
                    <Users className="h-3 w-3" /> {group.reason} · {group.rows.length} profielen
                  </Badge>
                  <Button
                    size="sm"
                    onClick={() => mergeGroup.mutate(group)}
                    disabled={mergeGroup.isPending || blocked}
                    className="gap-1.5"
                  >
                    <Merge className="h-3.5 w-3.5" /> Samenvoegen in geselecteerde
                  </Button>
                </div>
                {blocked && (
                  <p className="text-xs text-amber-700 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" /> Meerdere profielen hebben een dienstverband/payroll-record — samenvoegen moet hier handmatig.
                  </p>
                )}
                <div className="grid gap-2">
                  {group.rows.map((r) => {
                    const isSurvivor = r.candidate_id === survivorId;
                    return (
                      <div
                        key={r.candidate_id}
                        className={cn(
                          'flex items-start justify-between gap-3 rounded-md border p-3 cursor-pointer transition-colors',
                          isSurvivor ? 'border-primary bg-primary/5' : 'hover:bg-muted/40',
                        )}
                        onClick={() => setSurvivors((s) => ({ ...s, [group.key]: r.candidate_id }))}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link
                              to={`/kandidaten/${r.candidate_id}`}
                              className="font-medium text-foreground hover:text-stat-blue"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {fullName(r)}
                            </Link>
                            {isSurvivor && <Badge className="bg-primary/10 text-stat-blue border-0 text-[10px]">Behouden</Badge>}
                            {r.has_employee && <Badge variant="outline" className="text-[10px]">Dienstverband</Badge>}
                            {r.status && <Badge variant="outline" className="text-[10px]">{r.status}</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {[r.email, r.phone, r.date_of_birth ? `geb. ${formatDate(r.date_of_birth)}` : null]
                              .filter(Boolean)
                              .join(' · ') || '—'}
                          </p>
                          <p className="text-[11px] text-muted-foreground">Aangemaakt {formatDate(r.created_at)}</p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant={isSurvivor ? 'secondary' : 'ghost'}
                          className="flex-shrink-0 text-xs h-7"
                          onClick={(e) => { e.stopPropagation(); setSurvivors((s) => ({ ...s, [group.key]: r.candidate_id })); }}
                        >
                          {isSurvivor ? 'Behouden' : 'Behoud deze'}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DuplicateCandidates;
