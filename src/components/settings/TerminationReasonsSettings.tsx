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
import { Plus, Trash2, ArrowUp, ArrowDown, AlertTriangle, Pencil, Check, X } from 'lucide-react';
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
import type { Database } from '@/integrations/supabase/types';

type TerminatedByType = Database['public']['Enums']['terminated_by_type'];

interface TerminationReason {
  id: string;
  organization_id: string;
  terminated_by: TerminatedByType;
  reason: string;
  sort_order: number | null;
  is_active: boolean;
}

const TerminationReasonsSettings = () => {
  const orgId = useOrganizationId();
  const queryClient = useQueryClient();

  const [newReason, setNewReason] = useState('');
  const [newType, setNewType] = useState<TerminatedByType>('opdrachtgever');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editReason, setEditReason] = useState('');

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

  const updateReasonMutation = useMutation({
    mutationFn: async ({ reason, newReason }: { reason: TerminationReason; newReason: string }) => {
      const trimmedReason = newReason.trim();
      if (!trimmedReason) throw new Error('Vul een reden in');

      const duplicate = reasons.some((r: TerminationReason) =>
        r.id !== reason.id
        && r.terminated_by === reason.terminated_by
        && r.reason.trim().toLowerCase() === trimmedReason.toLowerCase()
      );
      if (duplicate) throw new Error('Deze reden bestaat al voor deze categorie');

      const oldReason = reason.reason;
      if (oldReason === trimmedReason) return;

      const { error } = await supabase.from('termination_reasons')
        .update({ reason: trimmedReason })
        .eq('id', reason.id);
      if (error) throw error;

      const { error: placementError } = await supabase.from('placements')
        .update({ termination_reason: trimmedReason })
        .eq('organization_id', orgId)
        .eq('terminated_by', reason.terminated_by)
        .eq('termination_reason', oldReason);
      if (placementError) throw placementError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['termination-reasons-all'] });
      queryClient.invalidateQueries({ queryKey: ['termination-reasons'] });
      queryClient.invalidateQueries({ queryKey: ['uitstroom-terminated'] });
      queryClient.invalidateQueries({ queryKey: ['uitstroom-terminated-prev'] });
      queryClient.invalidateQueries({ queryKey: ['uitstroom-all-placements'] });
      setEditingId(null);
      setEditReason('');
      toast.success('Reden aangepast');
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

  const startEditing = (reason: TerminationReason) => {
    setEditingId(reason.id);
    setEditReason(reason.reason);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditReason('');
  };

  const saveEditing = (reason: TerminationReason) => {
    updateReasonMutation.mutate({ reason, newReason: editReason });
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
          <Select value={newType} onValueChange={(value) => setNewType(value as TerminatedByType)}>
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
                  {groupReasons.map((r: TerminationReason) => {
                    const isEditing = editingId === r.id;

                    return (
                      <div
                        key={r.id}
                        className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 group"
                      >
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleMoveUp(r, groupReasons)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                            title="Omhoog"
                          >
                            <ArrowUp className="h-3 w-3 text-muted-foreground" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveDown(r, groupReasons)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                            title="Omlaag"
                          >
                            <ArrowDown className="h-3 w-3 text-muted-foreground" />
                          </button>
                        </div>
                        {isEditing ? (
                          <Input
                            value={editReason}
                            onChange={(e) => setEditReason(e.target.value)}
                            className="h-8 flex-1 text-sm"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEditing(r);
                              if (e.key === 'Escape') cancelEditing();
                            }}
                          />
                        ) : (
                          <span className={`flex-1 text-sm ${!r.is_active ? 'text-muted-foreground line-through' : ''}`}>
                            {r.reason}
                          </span>
                        )}
                        <div className="flex items-center gap-2">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                onClick={() => saveEditing(r)}
                                disabled={!editReason.trim() || updateReasonMutation.isPending}
                                className="p-1 text-muted-foreground hover:text-primary disabled:opacity-50"
                                title="Opslaan"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={cancelEditing}
                                disabled={updateReasonMutation.isPending}
                                className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
                                title="Annuleren"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </>
                          ) : (
                            <>
                              <Label className="text-[10px] text-muted-foreground">Actief</Label>
                              <Switch
                                checked={r.is_active}
                                onCheckedChange={(checked) => toggleMutation.mutate({ id: r.id, isActive: checked })}
                              />
                              <button
                                type="button"
                                onClick={() => startEditing(r)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-muted-foreground hover:text-primary"
                                title="Bewerken"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteId(r.id)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-muted-foreground hover:text-destructive"
                                title="Verwijderen"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
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
