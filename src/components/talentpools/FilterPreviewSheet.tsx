import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { FilterCriteria } from './PoolFilterBuilder';

interface FilterPreviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filter: FilterCriteria;
  talentpoolId: string;
  existingMemberIds: string[];
}

export default function FilterPreviewSheet({
  open,
  onOpenChange,
  filter,
  talentpoolId,
  existingMemberIds,
}: FilterPreviewSheetProps) {
  const orgId = useOrganizationId();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const hasFilters = Object.keys(filter).length > 0;

  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ['filter-preview', orgId, filter],
    queryFn: async () => {
      let query = supabase
        .from('candidates')
        .select('id, first_name, last_name, email, phone, status, skills, compliance_status')
        .eq('organization_id', orgId)
        .order('first_name')
        .limit(200);

      if (filter.status?.length) {
        query = query.in('status', filter.status);
      }
      if (filter.compliance_status?.length) {
        query = query.in('compliance_status', filter.compliance_status);
      }
      if (filter.skills?.length) {
        query = query.overlaps('skills', filter.skills);
      }
      if (filter.languages?.length) {
        query = query.overlaps('languages', filter.languages);
      }
      if (filter.city) {
        query = query.ilike('address_city', `%${filter.city}%`);
      }
      if (filter.cv_search) {
        query = query.textSearch('cv_raw_text', filter.cv_search, { config: 'dutch' });
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: open && hasFilters,
  });

  const newCandidates = candidates.filter((c: any) => !existingMemberIds.includes(c.id));
  const alreadyInPool = candidates.length - newCandidates.length;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === newCandidates.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(newCandidates.map((c: any) => c.id)));
    }
  };

  const addMutation = useMutation({
    mutationFn: async () => {
      const rows = Array.from(selected).map((candidate_id) => ({
        talentpool_id: talentpoolId,
        candidate_id,
        added_by: profile?.id || null,
      }));
      const { error } = await supabase.from('talentpool_members' as any).insert(rows);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['talentpool-members', talentpoolId] });
      qc.invalidateQueries({ queryKey: ['talentpools'] });
      toast.success(`${selected.size} kandidaat${selected.size > 1 ? 'en' : ''} toegevoegd`);
      setSelected(new Set());
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Filterresultaten</SheetTitle>
        </SheetHeader>

        {!hasFilters ? (
          <p className="text-sm text-muted-foreground text-center py-12">
            Stel eerst filters in om kandidaten te zoeken.
          </p>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
              <span>
                {newCandidates.length} nieuwe kandidaat{newCandidates.length !== 1 ? 'en' : ''}
                {alreadyInPool > 0 && ` (${alreadyInPool} al in pool)`}
              </span>
              {newCandidates.length > 0 && (
                <button onClick={selectAll} className="text-primary hover:underline text-xs">
                  {selected.size === newCandidates.length ? 'Deselecteer alles' : 'Selecteer alles'}
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto mt-3 -mx-6 px-6 space-y-1">
              {newCandidates.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Geen nieuwe kandidaten gevonden die aan de filters voldoen.
                </p>
              ) : (
                newCandidates.map((c: any) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                  >
                    <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {c.first_name} {c.last_name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{c.email ?? '—'}</p>
                    </div>
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      {c.status}
                    </Badge>
                  </label>
                ))
              )}
            </div>

            {selected.size > 0 && (
              <div className="pt-4 border-t mt-4">
                <Button
                  onClick={() => addMutation.mutate()}
                  disabled={addMutation.isPending}
                  className="w-full gap-1.5"
                >
                  <Plus className="h-4 w-4" />
                  {selected.size} kandidaat{selected.size > 1 ? 'en' : ''} toevoegen
                </Button>
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
