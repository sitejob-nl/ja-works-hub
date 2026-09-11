import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useRolePermission } from '@/hooks/usePermissions';
import { useHoursMailActions, useHoursMailIntake } from '@/hooks/useHoursMailIntake';
import { useHoursWeeks } from '@/hooks/useHoursWorkflow';
import { invokeOutlookFunction, useOutlookAccounts } from '@/hooks/useOutlookAccounts';
import { HoursMailIntakePanel } from '@/components/hours-workflow/HoursMailIntakePanel';
import PageHeader from '@/components/layout/PageHeader';
import ErrorState from '@/components/shared/ErrorState';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { formatHoursDate } from '@/components/hours-workflow/presentation';

/**
 * Durable mail intake, seen from the office.
 *
 * Nobody opens the inbox here: this page shows which folders the unattended run
 * follows, and everything it refused to place. A message in the control bin
 * produced no source, no proposal and no hours — the intake would rather stop
 * visibly than put a delivery on a week it is not sure about.
 */
export default function HoursMailIntake() {
  const organizationId = useOrganizationId();
  const { user } = useAuth();
  const canManage = useRolePermission('finance.manage');
  const overview = useHoursMailIntake(organizationId);
  const { dismiss, assign, follow, run } = useHoursMailActions(organizationId);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [mailbox, setMailbox] = useState('');

  // Only mailboxes this person may actually read: the access matrix is leading,
  // and the server refuses a folder in any other mailbox anyway.
  const { accounts } = useOutlookAccounts('mail_read');
  const mailboxes = useMemo(() => (accounts ?? [])
    .filter(account => account.scope === 'organization')
    .map(account => ({ id: account.id, label: account.label, email: account.email })), [accounts]);

  const folders = useQuery({
    queryKey: ['hours-mail-folders', organizationId, mailbox],
    enabled: Boolean(mailbox) && canManage,
    queryFn: async () => {
      const data = await invokeOutlookFunction<{ folders: { id: string; display_name: string }[] }>(
        'outlook-mail', { action: 'folders', account_id: mailbox });
      return data.folders ?? [];
    },
  });

  const weeks = useHoursWeeks({ organizationId, userId: user?.id ?? '', zone: 'internal' });
  const weekOptions = useMemo(() => (weeks.data?.weeks ?? []).map(week => ({
    id: week.id, label: `${week.company_name} — week van ${formatHoursDate(week.week_start)}`,
  })), [weeks.data]);

  return <div className="space-y-6">
    <PageHeader title="Mailinname" description="Antwoorden op de urenuitvraag, zonder de inbox te openen"
      breadcrumbs={[{ label: 'Uren', to: '/uren/weken' }, { label: 'Mailinname' }]} />

    {outcome && <Alert><AlertDescription>{outcome}</AlertDescription></Alert>}
    {overview.error && <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />}
    {dismiss.error && <ErrorState error={dismiss.error} />}
    {assign.error && <ErrorState error={assign.error} />}
    {follow.error && <ErrorState error={follow.error} />}
    {folders.error && <ErrorState error={folders.error} onRetry={() => void folders.refetch()} />}
    {run.error && <ErrorState error={run.error} />}

    {overview.isPending
      ? <p role="status" className="text-sm text-muted-foreground">Mailinname laden…</p>
      : <HoursMailIntakePanel
          canManage={canManage && (overview.data?.can_manage ?? false)}
          folders={overview.data?.folders ?? []}
          attention={overview.data?.attention ?? []}
          running={run.isPending}
          mailboxes={mailboxes}
          mailboxFolders={folders.data ?? []}
          selectedMailbox={mailbox}
          onSelectMailbox={setMailbox}
          folderBusy={follow.isPending || folders.isFetching}
          onFollow={(mailAccountId, folderId, folderLabel) => {
            setOutcome(null);
            follow.mutate({ mailAccountId, folderId, folderLabel, enabled: true });
          }}
          weeks={weekOptions}
          onAssign={(messageId, weekId, note) => {
            setOutcome(null);
            assign.mutate({ messageId, weekId, note }, {
              onSuccess: () => setOutcome('Dit bericht is aan die week gehangen. '
                + 'De eerstvolgende doorloop legt het daar vast als bron met voorstel.'),
            });
          }}
          onDismiss={(messageId, note) => dismiss.mutate({ messageId, note })}
          onRun={() => {
            setOutcome(null);
            run.mutate(undefined, {
              onSuccess: result => {
                setOutcome(result.folders === 0
                  ? 'Er wordt nog geen map gevolgd, dus er is niets opgehaald.'
                  : `${result.folders} ${result.folders === 1 ? 'map' : 'mappen'} doorlopen. `
                    + `${result.filed} ${result.filed === 1 ? 'bericht' : 'berichten'} vastgelegd, `
                    + `${result.attention} in de controlebak.`);
                void overview.refetch();
              },
            });
          }} />}
  </div>;
}
