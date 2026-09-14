import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSuperAdmin } from '@/contexts/SuperAdminContext';
import { feedbackApi } from '@/lib/feedback-api';
import { qk } from '@/lib/query-keys';
import { toFriendlyError } from '@/lib/errorMessages';
import PageHeader from '@/components/layout/PageHeader';
import ErrorState from '@/components/shared/ErrorState';
import { Button } from '@/components/ui/button';
import { feedbackReceiptMessage, type FeedbackReport, type FeedbackReceipt } from '../../../supabase/functions/_shared/feedback-contract';

const deliveryLabels: Record<string, string> = {
  pending: 'Wacht op verzending', preparing: 'Wordt voorbereid', sending: 'Verzending gestart',
  sent: 'E-mail verstuurd', paused: 'Concept · verzending gepauzeerd', failed: 'Verzending mislukt', unknown: 'Bezorgen niet bevestigd',
};
export default function SuperAdminFeedback() {
  const { id } = useParams<{ id: string }>();
  const { user, isSuperAdmin } = useSuperAdmin();
  const [page, setPage] = useState(0);
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: qk.feedback.list(user?.id ?? '', page), enabled: isSuperAdmin && !id,
    queryFn: () => feedbackApi<{ reports: FeedbackReport[] }>({ action: 'list', page }),
  });
  const detail = useQuery({
    queryKey: qk.feedback.detail(user?.id ?? '', id ?? ''), enabled: isSuperAdmin && !!id,
    queryFn: () => feedbackApi<{ report: FeedbackReport; screenshotUrl: string | null }>({ action: 'detail', id }),
    staleTime: 0, gcTime: 0,
  });
  const retry = useMutation({
    mutationFn: () => feedbackApi<FeedbackReceipt>({ action: 'retry', id }),
    retry: false,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.feedback.all(user?.id ?? '') }),
  });
  const query = id ? detail : list;
  const report = detail.data?.report;
  return <div className="p-4 sm:p-6 space-y-5 text-zinc-100">
    <PageHeader title={report ? `Melding #${report.number}` : 'Bugs & verbeterideeën'}
      description="Meldingen van interne gebruikers aan SiteJob."
      actions={<Button variant="outline" className="text-foreground" onClick={() => void query.refetch()}>Vernieuwen</Button>} />
    {id && <Link to="/superadmin/feedback" className="inline-block text-sm underline">Alle meldingen</Link>}
    {query.isLoading && <p role="status">Meldingen laden…</p>}
    {query.error && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
    {report && <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 space-y-4">
      <div><p className="text-xs text-zinc-400">{report.kind === 'bug' ? 'Bug' : 'Verbeteridee'} · {new Date(report.created_at).toLocaleString('nl-NL')}</p><h2 className="text-xl font-semibold break-words">{report.title}</h2></div>
      <p className="text-sm">{report.reporter_name} · <a className="underline" href={`mailto:${report.reporter_email}`}>{report.reporter_email}</a></p>
      <p className="text-sm">{deliveryLabels[report.email_status]}</p>
      {report.email_error_code && <p className="text-xs text-zinc-400">{report.email_error_code}</p>}
      {['pending', 'failed', 'paused'].includes(report.email_status) && (!report.has_screenshot || report.screenshot_path) &&
        <Button disabled={retry.isPending} onClick={() => retry.mutate()}>E-mail opnieuw proberen</Button>}
      {retry.data && <p role="status" className="text-sm">{feedbackReceiptMessage(retry.data)}</p>}
      {retry.error && <p role="alert">{toFriendlyError(retry.error)}</p>}
      {([['Omschrijving', report.description], ['Stappen', report.steps], ['Verwacht resultaat', report.expected]] as const).map(([label, text]) => text && <section key={label}><h3 className="font-medium text-sm mb-1">{label}</h3><p className="text-sm whitespace-pre-wrap break-words">{text}</p></section>)}
      {detail.data?.screenshotUrl && <section><h3 className="font-medium text-sm mb-2">Screenshot</h3><img src={detail.data.screenshotUrl} referrerPolicy="no-referrer" alt={`Screenshot bij melding #${report.number}`} className="max-w-full rounded border border-zinc-700" /><p className="text-xs text-zinc-400 mt-1">De afbeeldingslink verloopt na vijf minuten. Gebruik Vernieuwen als het beeld niet meer laadt.</p></section>}
      {report.has_screenshot && !report.screenshot_path && <p>Het screenshot is nog niet ontvangen.</p>}
      <details><summary className="cursor-pointer text-sm font-medium">Debuggegevens</summary><pre className="mt-2 text-xs whitespace-pre-wrap break-all rounded bg-zinc-950 p-3">{JSON.stringify({ organizationId: report.organization_id, userId: report.submitted_by, ...report.diagnostics }, null, 2)}</pre></details>
    </div>}
    {!id && list.data && <>
      <div className="rounded-lg border border-zinc-700 divide-y divide-zinc-700">
        {list.data.reports.map(item => <Link key={item.id} to={`/superadmin/feedback/${item.id}`} className="block p-4 hover:bg-zinc-900 focus-visible:outline focus-visible:outline-2">
          <p className="font-medium break-words">#{item.number} · {item.title}</p>
          <p className="text-xs text-zinc-400 mt-1">{item.kind === 'bug' ? 'Bug' : 'Verbeteridee'} · {item.reporter_name} · {new Date(item.created_at).toLocaleString('nl-NL')}</p>
          <p className="text-xs mt-1">{deliveryLabels[item.email_status]}</p>
        </Link>)}
        {!list.data.reports.length && <p className="p-6 text-sm text-zinc-400">Geen meldingen gevonden.</p>}
      </div>
      <div className="flex items-center gap-3"><Button variant="outline" className="text-foreground" disabled={page === 0} onClick={() => setPage(page - 1)}>Vorige</Button><span className="text-sm">Pagina {page + 1}</span><Button variant="outline" className="text-foreground" disabled={list.data.reports.length < 50} onClick={() => setPage(page + 1)}>Volgende</Button></div>
    </>}
  </div>;
}
