import { lazy, Suspense, useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { collectFeedbackDiagnostics } from '@/lib/feedback-diagnostics';
import { INTERNAL_FEEDBACK_ROLES, type FeedbackDiagnostics } from '../../../supabase/functions/_shared/feedback-contract';

const FeedbackDialog = lazy(() => import('./FeedbackDialog'));
export default function FeedbackButton() {
  const { role, user, profile } = useAuth();
  const [context, setContext] = useState<FeedbackDiagnostics | null>(null);
  const [open, setOpen] = useState(false);
  if (!INTERNAL_FEEDBACK_ROLES.some(r => r === role)) return null;
  return <>
    <Button variant="ghost" size="sm" aria-label="Bug of idee melden" title="Bug of idee melden" onClick={() => {
      if (!context) setContext(collectFeedbackDiagnostics());
      setOpen(true);
    }}><MessageSquarePlus className="h-4 w-4" /><span className="hidden lg:inline ml-2">Bug of idee melden</span></Button>
    {context && <Suspense fallback={open ? <span role="status" className="text-xs">Meldformulier laden…</span> : null}>
      <FeedbackDialog key={`${profile?.organization_id}:${user?.id}`} open={open} onOpenChange={setOpen} diagnostics={context}
        onNewReport={() => setContext(collectFeedbackDiagnostics())}
        onComplete={() => { setOpen(false); setContext(null); }} />
    </Suspense>}
  </>;
}
