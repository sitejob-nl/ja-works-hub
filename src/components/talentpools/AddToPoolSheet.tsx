import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Search, Plus, FolderHeart } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

interface AddToPoolSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidateIds: string[];
  onDone?: () => void;
}

type TalentpoolOption = {
  id: string;
  name: string;
  color: string | null;
};

const AddToPoolSheet = ({ open, onOpenChange, candidateIds, onDone }: AddToPoolSheetProps) => {
  const orgId = useOrganizationId();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const { data: pools = [] } = useQuery({
    queryKey: ['talentpools-for-add', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('talentpools' as any)
        .select('id, name, color')
        .eq('organization_id', orgId)
        .order('name');
      if (error) throw error;
      return ((data ?? []) as unknown) as TalentpoolOption[];
    },
    enabled: open,
  });

  const filteredPools = search
    ? pools.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : pools;

  const addToPoolMutation = useMutation({
    mutationFn: async (poolId: string) => {
      const rows = candidateIds.map((candidate_id) => ({
        talentpool_id: poolId,
        candidate_id,
        added_by: profile?.id || null,
      }));
      // Use upsert to skip duplicates
      const { error } = await supabase.from('talentpool_members' as any).upsert(rows, { onConflict: 'talentpool_id,candidate_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['talentpool-members'] });
      qc.invalidateQueries({ queryKey: ['talentpools'] });
      toast.success(`${candidateIds.length} kandidaat${candidateIds.length > 1 ? 'en' : ''} toegevoegd aan pool`);
      onOpenChange(false);
      onDone?.();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const createAndAddMutation = useMutation({
    mutationFn: async () => {
      const { data: pool, error: createError } = await supabase
        .from('talentpools' as any)
        .insert({
          organization_id: orgId,
          name: newName,
          created_by: profile?.id || null,
        })
        .select('id')
        .single();
      if (createError) throw createError;
      const poolId = (((pool as unknown) as { id: string } | null)?.id);
      if (!poolId) throw new Error('Nieuwe talentpool kon niet worden bepaald');

      const rows = candidateIds.map((candidate_id) => ({
        talentpool_id: poolId,
        candidate_id,
        added_by: profile?.id || null,
      }));
      const { error } = await supabase.from('talentpool_members' as any).insert(rows);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['talentpools'] });
      qc.invalidateQueries({ queryKey: ['talentpool-members'] });
      toast.success('Nieuwe pool aangemaakt en kandidaten toegevoegd');
      setCreating(false);
      setNewName('');
      onOpenChange(false);
      onDone?.();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col">
        <SheetHeader>
          <SheetTitle>Toevoegen aan talentpool</SheetTitle>
        </SheetHeader>

        <p className="text-sm text-muted-foreground mt-2">
          {candidateIds.length} kandidaat{candidateIds.length > 1 ? 'en' : ''} geselecteerd
        </p>

        {!creating && (
          <>
            <div className="relative mt-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Zoek pool..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="flex-1 overflow-y-auto mt-3 -mx-6 px-6 space-y-1">
              {filteredPools.length === 0 && !search ? (
                <p className="text-sm text-muted-foreground text-center py-8">Nog geen talentpools</p>
              ) : filteredPools.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Geen pools gevonden</p>
              ) : (
                filteredPools.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addToPoolMutation.mutate(p.id)}
                    disabled={addToPoolMutation.isPending}
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

            <div className="pt-4 border-t mt-4">
              <Button variant="outline" onClick={() => setCreating(true)} className="w-full gap-1.5">
                <Plus className="h-4 w-4" /> Nieuwe pool aanmaken
              </Button>
            </div>
          </>
        )}

        {creating && (
          <div className="space-y-4 mt-4">
            <div className="space-y-1.5">
              <Label>Naam nieuwe pool *</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="bijv. Lassers regio Utrecht"
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => createAndAddMutation.mutate()}
                disabled={!newName.trim() || createAndAddMutation.isPending}
                className="flex-1"
              >
                Aanmaken & toevoegen
              </Button>
              <Button variant="outline" onClick={() => { setCreating(false); setNewName(''); }}>
                Terug
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default AddToPoolSheet;
