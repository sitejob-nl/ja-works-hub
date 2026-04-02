import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, Trash2, ArrowUp, ArrowDown, AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { TYPE_LABELS, TYPE_BADGE_COLORS } from '@/lib/termination-constants';

interface TerminationReason {
  id: string;
  organization_id: string;
  terminated_by: string;
  reason: string;
  sort_order: number | null;
  is_active: boolean;
}

const TerminationReasonsSettings = () => {
  const orgId = useOrganizationId();
  const queryClient = useQueryClient();

  const [newReason, setNewReason] = useState('');
  const [newType, setNewType] = useState<string>('opdrachtgever');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: reasons = [], isLoading } = useQuery({
    queryKey: ['termination-reasons-all', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('termination_reasons')
        .select('*')
        .eq('organization_id', orgId)
        .order('terminated_by')
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const maxSort = reasons
        .filter((r: TerminationReason) => r.terminated_by === newType)
        .reduce((max: number, r: TerminationReason) => Math.max(max, r.sort_order ?? 0), 0);

      const { error } = await supabase.from('termination_reasons').insert({
        organization_id: orgId,
        terminated_by: newType,
        reason: newReason.trim(),
        sort_order: maxSort + 1,
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['termination-reasons-all'] });
      setNewReason('');
      toast.success('Reden toegevoegd');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase.from('termination_reasons')
        .update({ is_active: isActive })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['termination-reasons-all'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('termination_reasons').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['termination-reasons-all'] });
      setDeleteId(null);
      toast.success('Reden verwijderd');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reorderMutation = useMutation({
    mutationFn: async ({ idA, orderA, idB, orderB }: { idA: string; orderA: number; idB: string; orderB: number }) => {
      const { error: errA } = await supabase.from('termination_reasons')
        .update({ sort_order: orderA })
        .eq('id', idA);
      if (errA) throw errA;

      const { error: errB } = await supabase.from('termination_reasons')
        .update({ sort_order: orderB })
        .eq('id', idB);
      if (errB) throw errB;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['termination-reasons-all'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleMoveUp = (reason: TerminationReason, groupReasons: TerminationReason[]) => {
    const idx = groupReasons.findIndex((r) => r.id === reason.id);
    if (idx <= 0) return;
    const prev = groupReasons[idx - 1];
    reorderMutation.mutate({
      idA: reason.id, orderA: prev.sort_order ?? 0,
      idB: prev.id, orderB: reason.sort_order ?? 0,
    });
  };

  const handleMoveDown = (reason: TerminationReason, groupReasons: TerminationReason[]) => {
    const idx = groupReasons.findIndex((r) => r.id === reason.id);
    if (idx >= groupReasons.length - 1) return;
    const next = groupReasons[idx + 1];
    reorderMutation.mutate({
      idA: reason.id, orderA: next.sort_order ?? 0,
      idB: next.id, orderB: reason.sort_order ?? 0,
    });
  };

  const grouped = {
    opdrachtgever: reasons.filter((r: TerminationReason) => r.terminated_by === 'opdrachtgever'),
    medewerker: reasons.filter((r: TerminationReason) => r.terminated_by === 'medewerker'),
    uitzendbureau: reasons.filter((r: TerminationReason) => r.terminated_by === 'uitzendbureau'),
  };

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Laden...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4" /> Beëindigingsredenen
        </CardTitle>
        <CardDescription>
          Beheer de redenen die beschikbaar zijn bij het beëindigen van plaatsingen
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Add new reason */}
        <div className="flex flex-col sm:flex-row gap-2">
          <Select value={newType} onValueChange={setNewType}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="opdrachtgever">Opdrachtgever</SelectItem>
              <SelectItem value="medewerker">Medewerker</SelectItem>
              <SelectItem value="uitzendbureau">Uitzendbureau</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={newReason}
            onChange={(e) => setNewReason(e.target.value)}
            placeholder="Nieuwe reden toevoegen..."
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newReason.trim()) addMutation.mutate();
            }}
          />
          <Button
            onClick={() => addMutation.mutate()}
            disabled={!newReason.trim() || addMutation.isPending}
            size="sm"
          >
            <Plus className="h-4 w-4 mr-1" /> Toevoegen
          </Button>
        </div>

        {/* Grouped lists */}
        {(['opdrachtgever', 'medewerker', 'uitzendbureau'] as const).map((type) => {
          const groupReasons = grouped[type];
          return (
            <div key={type}>
              <div className="flex items-center gap-2 mb-2">
                <Badge className={TYPE_BADGE_COLORS[type]}>
                  {TYPE_LABELS[type]}
                </Badge>
                <span className="text-xs text-muted-foreground">({groupReasons.length} redenen)</span>
              </div>
              {groupReasons.length === 0 ? (
                <p className="text-xs text-muted-foreground pl-2 py-2">Geen redenen geconfigureerd</p>
              ) : (
                <div className="space-y-1">
                  {groupReasons.map((r: TerminationReason) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 group"
                    >
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleMoveUp(r, groupReasons)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                          title="Omhoog"
                        >
                          <ArrowUp className="h-3 w-3 text-muted-foreground" />
                        </button>
                        <button
                          onClick={() => handleMoveDown(r, groupReasons)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                          title="Omlaag"
                        >
                          <ArrowDown className="h-3 w-3 text-muted-foreground" />
                        </button>
                      </div>
                      <span className={`flex-1 text-sm ${!r.is_active ? 'text-muted-foreground line-through' : ''}`}>
                        {r.reason}
                      </span>
                      <div className="flex items-center gap-2">
                        <Label className="text-[10px] text-muted-foreground">Actief</Label>
                        <Switch
                          checked={r.is_active}
                          onCheckedChange={(checked) => toggleMutation.mutate({ id: r.id, isActive: checked })}
                        />
                        <button
                          onClick={() => setDeleteId(r.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-muted-foreground hover:text-destructive"
                          title="Verwijderen"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Delete confirmation */}
        <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reden verwijderen?</AlertDialogTitle>
              <AlertDialogDescription>
                Weet je zeker dat je deze beëindigingsreden wilt verwijderen?
                Dit kan niet ongedaan worden gemaakt.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuleren</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteId && deleteMutation.mutate(deleteId)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Verwijderen
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
};

export default TerminationReasonsSettings;
