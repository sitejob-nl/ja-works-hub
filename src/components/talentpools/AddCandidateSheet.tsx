import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Search, Plus, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

interface AddCandidateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  talentpoolId: string;
  existingMemberIds: string[];
}

const AddCandidateSheet = ({ open, onOpenChange, talentpoolId, existingMemberIds }: AddCandidateSheetProps) => {
  const orgId = useOrganizationId();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: candidates = [] } = useQuery({
    queryKey: ['candidates-for-pool', orgId, search],
    queryFn: async () => {
      let query = supabase
        .from('candidates')
        .select('id, first_name, last_name, email, status, skills')
        .eq('organization_id', orgId)
        .order('first_name')
        .limit(50);

      if (search) {
        query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
  });

  const filteredCandidates = candidates.filter((c: any) => !existingMemberIds.includes(c.id));

  const toggleCandidate = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
      <SheetContent className="flex flex-col">
        <SheetHeader>
          <SheetTitle>Kandidaten toevoegen</SheetTitle>
        </SheetHeader>

        <div className="relative mt-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Zoek op naam of email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex-1 overflow-y-auto mt-4 -mx-6 px-6 space-y-1">
          {filteredCandidates.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {search ? 'Geen kandidaten gevonden' : 'Alle kandidaten zijn al lid'}
            </p>
          ) : (
            filteredCandidates.map((c: any) => (
              <label
                key={c.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
              >
                <Checkbox
                  checked={selected.has(c.id)}
                  onCheckedChange={() => toggleCandidate(c.id)}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{c.first_name} {c.last_name}</p>
                  <p className="text-xs text-muted-foreground truncate">{c.email ?? '—'}</p>
                </div>
                <Badge variant="secondary" className="text-[10px] shrink-0">{c.status}</Badge>
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
      </SheetContent>
    </Sheet>
  );
};

export default AddCandidateSheet;
