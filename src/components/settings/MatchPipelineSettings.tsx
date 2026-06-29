import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock3 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { normalizeMatchPipelineFollowupDays } from '@/lib/match-followup';

const MatchPipelineSettings = () => {
  const orgId = useOrganizationId();
  const queryClient = useQueryClient();
  const [followupDays, setFollowupDays] = useState('3');

  const { data: org } = useQuery({
    queryKey: ['match-pipeline-settings', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('organizations').select('settings').eq('id', orgId!).single();
      if (error) throw error;
      return data as { settings: Record<string, unknown> | null };
    },
    enabled: !!orgId,
  });

  useEffect(() => {
    setFollowupDays(String(normalizeMatchPipelineFollowupDays((org?.settings as any)?.match_pipeline_followup_days)));
  }, [org?.settings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const nextValue = normalizeMatchPipelineFollowupDays(followupDays);
      const nextSettings = {
        ...((org?.settings as any) ?? {}),
        match_pipeline_followup_days: nextValue,
      };
      const { error } = await supabase.from('organizations').update({ settings: nextSettings }).eq('id', orgId);
      if (error) throw error;
      return nextValue;
    },
    onSuccess: (value) => {
      setFollowupDays(String(value));
      queryClient.invalidateQueries({ queryKey: ['match-pipeline-settings'] });
      toast.success('Matchpipeline-instelling opgeslagen');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock3 className="h-4 w-4" /> Matchpipeline opvolging
        </CardTitle>
        <CardDescription>Stuur waarschuwingen wanneer voorgestelde kandidaten te lang wachten op opvolging.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="w-full max-w-xs space-y-1.5">
          <Label>Opvolgen na aantal dagen</Label>
          <Input
            type="number"
            min={1}
            max={30}
            value={followupDays}
            onChange={(event) => setFollowupDays(event.target.value)}
          />
        </div>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Opslaan...' : 'Opslaan'}
        </Button>
      </CardContent>
    </Card>
  );
};

export default MatchPipelineSettings;
