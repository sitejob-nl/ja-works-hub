import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSuperAdmin } from '@/contexts/SuperAdminContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { feedbackApi } from '@/lib/feedback-api';
import { qk } from '@/lib/query-keys';
import { toFriendlyError } from '@/lib/errorMessages';
import { toast } from 'sonner';
import { feedbackStatusLabel, type FeedbackReport, type FeedbackStatus } from '../../../supabase/functions/_shared/feedback-contract';

export default function FeedbackResolutionEditor({ report }: { report: FeedbackReport }) {
  const { user } = useSuperAdmin();
  const qc = useQueryClient();
  const [message, setMessage] = useState('');
  const mutation = useMutation({
    mutationFn: (status: FeedbackStatus) => feedbackApi<{ changed: boolean }>({
      action: 'set-status', id: report.id, revision: report.resolution_revision, status, resolution: message,
    }),
    retry: false,
    onSuccess: (_data, status) => {
      void qc.invalidateQueries({ queryKey: qk.feedback.all(user?.id ?? '') });
      toast.success(status === 'resolved' ? 'Afgerond. De melder heeft een persoonlijke notificatie.' : 'Melding heropend.');
    },
  });
  return <section className="rounded-md border border-zinc-700 p-4 space-y-3">
    <h3 className="font-medium">Status: {feedbackStatusLabel(report)}</h3>
    {report.status === 'resolved' ? <>
      <p className="text-sm text-zinc-400">Afgerond op {new Date(report.resolved_at!).toLocaleString('nl-NL')}. De melder kan de terugkoppeling in het systeem bekijken.</p>
      {report.resolution && <p className="text-sm whitespace-pre-wrap break-words">{report.resolution}</p>}
      <Button variant="outline" className="text-foreground" disabled={mutation.isPending} onClick={() => mutation.mutate('open')}>Melding heropenen</Button>
    </> : <>
      <div className="space-y-1.5"><Label htmlFor="feedback-resolution">Bericht aan de melder (optioneel)</Label>
        <Textarea id="feedback-resolution" rows={3} maxLength={2000} value={message} onChange={event => setMessage(event.target.value)}
          disabled={mutation.isPending} placeholder="Bijvoorbeeld: opslaan werkt weer. Je kunt het opnieuw proberen." /></div>
      <p className="text-xs text-zinc-400">Bij afronden verschijnt een persoonlijke notificatie bij de melder, met deze toelichting.</p>
      <Button disabled={mutation.isPending} onClick={() => mutation.mutate('resolved')}>
        {mutation.isPending ? 'Afronden…' : report.kind === 'bug' ? 'Oplossen en melder informeren' : 'Doorvoeren en melder informeren'}
      </Button>
    </>}
    {mutation.error && <p role="alert" className="text-sm text-red-400">{toFriendlyError(mutation.error)}</p>}
  </section>;
}
