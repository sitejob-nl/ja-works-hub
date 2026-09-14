import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/layout/PageHeader';
import ErrorState from '@/components/shared/ErrorState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { feedbackApi } from '@/lib/feedback-api';
import { qk } from '@/lib/query-keys';
import { feedbackStatusLabel, INTERNAL_FEEDBACK_ROLES, type MyFeedbackReport } from '../../supabase/functions/_shared/feedback-contract';

export default function MyFeedback() {
  const { id } = useParams<{ id: string }>();
  const { user, role, profile } = useAuth();
  const scope = `${profile?.organization_id ?? ''}:${user?.id ?? ''}`;
  const [page, setPage] = useState(0);
  const allowed = !!user && INTERNAL_FEEDBACK_ROLES.some(r => r === role);
  const list = useQuery({ queryKey: qk.feedback.mine(scope, page), enabled: allowed && !id,
    queryFn: () => feedbackApi<{ reports: MyFeedbackReport[] }>({ action: 'mine', page }) });
  const detail = useQuery({ queryKey: qk.feedback.myDetail(scope, id ?? ''), enabled: allowed && !!id,
    queryFn: () => feedbackApi<{ report: MyFeedbackReport }>({ action: 'my-detail', id }), staleTime: 0, gcTime: 0 });
  const query = id ? detail : list;
  const report = detail.data?.report;
  return <div className="space-y-5">
    <PageHeader title={report ? `Mijn melding #${report.number}` : 'Mijn meldingen'} description="Je bugs, verbeterideeën en de terugkoppeling van SiteJob."
      actions={<Button variant="outline" onClick={() => void query.refetch()} disabled={!allowed}>Vernieuwen</Button>} />
    {id && <Link className="text-sm underline" to="/feedback">Alle eigen meldingen</Link>}
    {!allowed && <p>Deze pagina is beschikbaar voor interne melders.</p>}
    {query.isLoading && <p role="status">Meldingen laden…</p>}
    {query.error && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
    {report && <article className="max-w-3xl rounded-lg border bg-card p-5 space-y-5">
      <div className="space-y-2"><Badge variant={report.status === 'resolved' ? 'default' : 'secondary'}>{feedbackStatusLabel(report)}</Badge>
        <h2 className="text-xl font-semibold break-words">{report.title}</h2>
        <p className="text-xs text-muted-foreground">Gemeld op {new Date(report.created_at).toLocaleString('nl-NL')}</p></div>
      {report.status === 'resolved' && <section className="rounded-md bg-primary/5 border border-primary/20 p-4 space-y-2">
        <h3 className="font-medium">Terugkoppeling van SiteJob</h3>
        <p className="text-sm whitespace-pre-wrap break-words">{report.resolution || (report.kind === 'bug' ? 'Je gemelde bug is opgelost. Bedankt voor het melden!' : 'Je verbeteridee is doorgevoerd. Bedankt voor het meedenken!')}</p>
        <p className="text-xs text-muted-foreground">{new Date(report.resolved_at!).toLocaleString('nl-NL')}</p>
      </section>}
      {([['Je omschrijving', report.description], ['Stappen', report.steps], ['Verwacht resultaat', report.expected]] as const).map(([label, value]) => value &&
        <section key={label}><h3 className="font-medium text-sm mb-1">{label}</h3><p className="text-sm whitespace-pre-wrap break-words">{value}</p></section>)}
    </article>}
    {!id && list.data && <>
      <div className="rounded-lg border divide-y bg-card">
        {list.data.reports.map(item => <Link key={item.id} to={`/feedback/${item.id}`} className="block p-4 hover:bg-muted/50">
          <div className="flex items-start justify-between gap-3"><p className="font-medium break-words">#{item.number} · {item.title}</p>
            <Badge variant={item.status === 'resolved' ? 'default' : 'secondary'}>{feedbackStatusLabel(item)}</Badge></div>
          <p className="text-xs text-muted-foreground mt-1">{new Date(item.created_at).toLocaleString('nl-NL')}</p>
        </Link>)}
        {!list.data.reports.length && <p className="p-6 text-sm text-muted-foreground">Je hebt nog geen melding verstuurd. Gebruik ‘Bug of idee melden’ in de bovenbalk.</p>}
      </div>
      <div className="flex items-center gap-3"><Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Vorige</Button>
        <span className="text-sm">Pagina {page + 1}</span><Button variant="outline" disabled={list.data.reports.length < 50} onClick={() => setPage(page + 1)}>Volgende</Button></div>
    </>}
  </div>;
}
