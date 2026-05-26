import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type MatchFeedbackReason = {
  id: string;
  applies_to: string;
  reason: string;
  sort_order: number | null;
  is_active: boolean;
};

const STATUS_LABELS: Record<string, string> = {
  afgewezen: 'Afwijzen',
  geaccepteerd: 'Accepteren',
  geplaatst: 'Plaatsen',
};

const MatchFeedbackReasonsSettings = () => {
  const orgId = useOrganizationId();
  const queryClient = useQueryClient();
  const [newReason, setNewReason] = useState('');
  const [newStatus, setNewStatus] = useState('afgewezen');

  const { data: reasons = [], isLoading } = useQuery({
    queryKey: ['match-feedback-reasons-settings', orgId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('match_feedback_reasons')
        .select('*')
        .eq('organization_id', orgId)
        .order('applies_to')
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orgId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['match-feedback-reasons-settings'] });
    queryClient.invalidateQueries({ queryKey: ['match-feedback-reasons'] });
  };

  const addMutation = useMutation({
    mutationFn: async () => {
      const reason = newReason.trim();
      if (!reason) throw new Error('Vul een reden in');
      const maxSort = reasons
        .filter((item: MatchFeedbackReason) => item.applies_to === newStatus)
        .reduce((max: number, item: MatchFeedbackReason) => Math.max(max, item.sort_order ?? 0), 0);
      const { error } = await (supabase as any).from('match_feedback_reasons').insert({
        organization_id: orgId,
        applies_to: newStatus,
        reason,
        sort_order: maxSort + 10,
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewReason('');
      invalidate();
      toast.success('Feedbackreden toegevoegd');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await (supabase as any).from('match_feedback_reasons').update({ is_active: isActive }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('match_feedback_reasons').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Feedbackreden verwijderd');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Laden...</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="h-4 w-4" /> Match-feedbackredenen
        </CardTitle>
        <CardDescription>Beheer redenen voor afwijzen, accepteren en plaatsen van matches</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-col sm:flex-row gap-2">
          <Select value={newStatus} onValueChange={setNewStatus}>
            <SelectTrigger className="sm:w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_LABELS).map(([status, label]) => (
                <SelectItem key={status} value={status}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={newReason}
            onChange={(event) => setNewReason(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addMutation.mutate();
            }}
            placeholder="Nieuwe feedbackreden"
          />
          <Button onClick={() => addMutation.mutate()} disabled={!newReason.trim() || addMutation.isPending} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Toevoegen
          </Button>
        </div>

        {Object.entries(STATUS_LABELS).map(([status, label]) => {
          const group = reasons.filter((reason: MatchFeedbackReason) => reason.applies_to === status);
          return (
            <div key={status} className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{label}</Badge>
                <span className="text-xs text-muted-foreground">{group.length} redenen</span>
              </div>
              {group.map((reason: MatchFeedbackReason) => (
                <div key={reason.id} className="flex items-center gap-2 rounded-md border p-2">
                  <span className="text-sm flex-1">{reason.reason}</span>
                  <Switch checked={reason.is_active} onCheckedChange={(checked) => toggleMutation.mutate({ id: reason.id, isActive: checked })} />
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-red-600" onClick={() => deleteMutation.mutate(reason.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

export default MatchFeedbackReasonsSettings;
