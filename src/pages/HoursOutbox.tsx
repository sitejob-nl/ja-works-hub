import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useRolePermission } from '@/hooks/usePermissions';
import { useHoursWeeks } from '@/hooks/useHoursWorkflow';
import { useHoursMailProfile, useHoursOutbox, useHoursOutboxActions } from '@/hooks/useHoursOutbox';
import {
  HoursMailProfilePanel, type RecipientOption,
} from '@/components/hours-workflow/HoursMailProfilePanel';
import { HoursOutboxPanel } from '@/components/hours-workflow/HoursOutboxPanel';
import { HoursMailTemplatePanel } from '@/components/hours-workflow/HoursMailTemplatePanel';
import PageHeader from '@/components/layout/PageHeader';
import ErrorState from '@/components/shared/ErrorState';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { unwrapList } from '@/lib/db';
import { qk } from '@/lib/query-keys';

/**
 * Outgoing hours mail, seen from the office.
 *
 * Two halves of one question: which messages go out for a client (the profile),
 * and what is standing in the queue right now (the outbox). Nothing is sent from
 * here — the unattended run does that, and re-checks every decision server-side.
 */
export default function HoursOutbox() {
  const organizationId = useOrganizationId();
  const { user } = useAuth();
  const canManage = useRolePermission('finance.manage');
  const [companyId, setCompanyId] = useState('');

  const weeks = useHoursWeeks({ organizationId, userId: user?.id ?? '', zone: 'internal' });
  const companies = useMemo(() => {
    const seen = new Map<string, string>();
    for (const week of weeks.data?.weeks ?? []) seen.set(week.company_id, week.company_name);
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [weeks.data]);

  const profile = useHoursMailProfile(organizationId, companyId || undefined);
  const outbox = useHoursOutbox(organizationId);
  const { saveProfile, saveTemplate, approve, withdraw } = useHoursOutboxActions(organizationId);

  // Who a message may be addressed to. Contacts of this client, and the internal
  // people who could own an escalation; the employees on a week are chosen with
  // the wildcard instead, because they change from week to week.
  const recipients = useQuery({
    queryKey: qk.hoursWorkflow.mailRecipients(organizationId, companyId),
    enabled: Boolean(companyId) && canManage,
    queryFn: async (): Promise<RecipientOption[]> => {
      const [contacts, profiles] = await Promise.all([
        unwrapList(supabase.from('company_contacts')
          .select('id, first_name, last_name, email')
          .eq('organization_id', organizationId).eq('company_id', companyId)),
        unwrapList(supabase.from('profiles')
          .select('id, full_name, email')
          .eq('organization_id', organizationId).eq('is_active', true)),
      ]);
      return [
        ...contacts.filter(contact => contact.email).map(contact => ({
          id: contact.id, party: 'customer' as const,
          label: [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email!,
        })),
        ...profiles.filter(entry => entry.email).map(entry => ({
          id: entry.id, party: 'internal' as const, label: entry.full_name || entry.email,
        })),
      ];
    },
  });

  return <div className="space-y-6">
    <PageHeader title="Uitgaande urenmail"
      description="Welke berichten uitgaan, naar wie en wanneer — en wat er nu klaarstaat."
      breadcrumbs={[{ label: 'Uren', to: '/uren/weken' }, { label: 'Uitgaande mail' }]}
      actions={<Button asChild variant="outline"><Link to="/uren/mailinname">Mailinname</Link></Button>} />

    <Alert><AlertDescription>
      Een ingestelde verzendtijd vervangt nooit een goedkeuring. Correctie- en navraagberichten blijven
      concept tot iemand ze goedkeurt, en staat de uitgaande pauze aan, dan wordt er niets verstuurd maar
      alles als concept bewaard.
    </AlertDescription></Alert>

    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="text-base font-semibold">Mailprofiel per opdrachtgever</h2>
      <div className="max-w-md space-y-1.5">
        <Label htmlFor="outbox-company">Opdrachtgever</Label>
        <select id="outbox-company" className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
          value={companyId} onChange={event => setCompanyId(event.target.value)}>
          <option value="">Kies een opdrachtgever</option>
          {companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
        </select>
      </div>
      {weeks.error && <ErrorState error={weeks.error} onRetry={() => void weeks.refetch()} />}
      {companyId && profile.error && <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />}
      {companyId && profile.isPending && <p role="status">Mailprofiel laden…</p>}
      {companyId && profile.data && (canManage
        ? <HoursMailProfilePanel key={`${companyId}:${profile.data.version}`} profile={profile.data}
          recipients={recipients.data ?? []} onReload={() => void profile.refetch()}
          onSave={async input => {
            await saveProfile.mutateAsync({
              companyId, expectedVersion: profile.data!.version, ...input,
            });
          }} />
        : <p className="text-sm text-muted-foreground">
          Je mag dit mailprofiel bekijken maar niet wijzigen.
        </p>)}
    </section>

    {companyId && profile.data && <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="text-base font-semibold">Berichtteksten</h2>
      <p className="text-sm text-muted-foreground">
        Teksten gelden voor de hele organisatie; een berichtsoort verwijst ernaar met de naam en de taal.
      </p>
      <HoursMailTemplatePanel templates={profile.data.templates} canManage={canManage}
        onSave={async input => { await saveTemplate.mutateAsync(input); }} />
    </section>}

    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="text-base font-semibold">Outbox</h2>
      {outbox.error && <ErrorState error={outbox.error} onRetry={() => void outbox.refetch()} />}
      {outbox.isPending ? <p role="status">Outbox laden…</p> : outbox.data && <HoursOutboxPanel
        messages={outbox.data.messages} canManage={canManage && outbox.data.can_manage}
        onReload={() => void outbox.refetch()}
        onApprove={async input => { await approve.mutateAsync(input); }}
        onWithdraw={async input => { await withdraw.mutateAsync(input); }} />}
    </section>
  </div>;
}
