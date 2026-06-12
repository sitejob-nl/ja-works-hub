import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Link } from 'react-router-dom';
import { FolderHeart, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { toast } from 'sonner';

interface CandidateTalentpoolsTabProps {
  candidateId: string;
}

const CandidateTalentpoolsTab = ({ candidateId }: CandidateTalentpoolsTabProps) => {
  const orgId = useOrganizationId();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { data: memberships = [] } = useQuery({
    queryKey: ['candidate-talentpools', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('talentpool_members' as any)
        .select('*, talentpools!talentpool_members_talentpool_id_fkey(id, name, color, description)')
        .eq('candidate_id', candidateId);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!candidateId,
  });

  const { data: allPools = [] } = useQuery({
    queryKey: ['talentpools-for-candidate-add', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('talentpools' as any)
        .select('id, name, color')
        .eq('organization_id', orgId)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: addOpen,
  });

  const existingPoolIds = memberships.map((m: any) => m.talentpool_id);
  const availablePools = allPools.filter((p: any) => !existingPoolIds.includes(p.id));
  const filteredPools = search
    ? availablePools.filter((p: any) => p.name.toLowerCase().includes(search.toLowerCase()))
    : availablePools;

  const addMutation = useMutation({
    mutationFn: async (poolId: string) => {
      const { error } = await supabase.from('talentpool_members' as any).insert({
        talentpool_id: poolId,
        candidate_id: candidateId,
        added_by: profile?.id || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidate-talentpools', candidateId] });
      qc.invalidateQueries({ queryKey: ['talentpools'] });
      toast.success('Toegevoegd aan talentpool');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const removeMutation = useMutation({
    mutationFn: async (poolId: string) => {
      const { error } = await supabase
        .from('talentpool_members' as any)
        .delete()
        .eq('talentpool_id', poolId)
        .eq('candidate_id', candidateId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidate-talentpools', candidateId] });
      qc.invalidateQueries({ queryKey: ['talentpools'] });
      toast.success('Verwijderd uit talentpool');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{memberships.length} talentpool{memberships.length !== 1 ? 's' : ''}</p>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Toevoegen aan pool
        </Button>
      </div>

      {memberships.length === 0 ? (
        <div className="bg-card rounded-lg border p-8 text-center text-muted-foreground">
          <FolderHeart className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
          <p>Deze kandidaat zit nog in geen talentpool.</p>
        </div>
      ) : (
        <div className="bg-card rounded-lg border divide-y">
          {memberships.map((m: any) => {
            const pool = m.talentpools;
            if (!pool) return null;
            return (
              <div key={m.talentpool_id} className="px-4 py-3 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  {pool.color && (
                    <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: pool.color }} />
                  )}
                  <div className="min-w-0">
                    <Link to={`/talentpools/${pool.id}`} className="text-sm font-medium hover:text-stat-blue transition-colors">
                      {pool.name}
                    </Link>
                    {pool.description && (
                      <p className="text-xs text-muted-foreground truncate">{pool.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground">
                    {new Date(m.added_at).toLocaleDateString('nl-NL')}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => removeMutation.mutate(m.talentpool_id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Sheet open={addOpen} onOpenChange={setAddOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Toevoegen aan talentpool</SheetTitle>
          </SheetHeader>
          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Zoek pool..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="mt-3 space-y-1">
            {filteredPools.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {availablePools.length === 0 ? 'Al lid van alle pools' : 'Geen pools gevonden'}
              </p>
            ) : (
              filteredPools.map((p: any) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    addMutation.mutate(p.id);
                    setAddOpen(false);
                  }}
                  className="flex items-center gap-3 w-full px-3 py-2.5 rounded-md hover:bg-muted/50 transition-colors text-left"
                >
                  {p.color ? (
                    <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                  ) : (
                    <FolderHeart className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <span className="text-sm font-medium truncate">{p.name}</span>
                </button>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default CandidateTalentpoolsTab;
