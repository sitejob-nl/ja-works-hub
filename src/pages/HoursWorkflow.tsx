import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, startOfWeek } from 'date-fns';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useRolePermission } from '@/hooks/usePermissions';
import { useHoursWeek, useHoursWeeks } from '@/hooks/useHoursWorkflow';
import { qk } from '@/lib/query-keys';
import { unwrap } from '@/lib/db';
import { hoursWorkflowRpc } from '@/lib/hours-workflow-api';
import { hoursWeekSchema, hoursWorkflowError, toHoursWeekView } from '@/lib/hours-workflow';
import PageHeader from '@/components/layout/PageHeader';
import ErrorState from '@/components/shared/ErrorState';
import { HoursWeekWorkspace } from '@/components/hours-workflow/HoursWeekWorkspace';
import { HoursWeekSources } from '@/components/hours-workflow/HoursWeekSources';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const settingsSchema = z.object({
  company_id: z.string().uuid(), version: z.number().int(), enabled: z.boolean(),
  submission_day_offset: z.number().int(), submission_time: z.string(),
  confirmation_day_offset: z.number().int(), confirmation_time: z.string(),
});

function CompanyWeekSetup({ orgId }: { orgId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState('');
  const [weekStart, setWeekStart] = useState(format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'));
  const companies = useQuery({
    queryKey: qk.hoursWorkflow.companies(orgId),
    queryFn: () => unwrap(supabase.from('companies').select('id,name').eq('organization_id', orgId).order('name')),
  });
  const settings = useQuery({
    queryKey: qk.hoursWorkflow.settings(orgId, companyId),
    queryFn: async () => settingsSchema.parse(await hoursWorkflowRpc('hours_get_company_settings', { p_company_id: companyId })),
    enabled: !!companyId,
  });
  const create = useMutation({
    mutationFn: async () => hoursWeekSchema.parse(await hoursWorkflowRpc('hours_create_week', { p_company_id: companyId, p_week_start: weekStart })),
    onSuccess: async week => { await qc.invalidateQueries({ queryKey: qk.hoursWorkflow.all(orgId) }); navigate(`/uren/weken/${week.id}`); },
  });
  return <Card>
    <CardHeader><CardTitle className="text-base">Klantweek voorbereiden</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">Leg per opdrachtgever de aanleverdeadline en akkoorddeadline vast. Deze handmatige weekcontrole verstuurt geen berichten en levert geen uren aan de payroller.</p>
      {companies.error ? <ErrorState error={companies.error} onRetry={() => void companies.refetch()} /> : <div className="space-y-2">
        <Label htmlFor="hours-company">Opdrachtgever</Label>
        <select id="hours-company" className="flex h-10 w-full rounded-md border bg-background px-3 text-sm" value={companyId} onChange={event => setCompanyId(event.target.value)} disabled={companies.isPending}>
          <option value="">Kies een opdrachtgever</option>
          {companies.data?.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
        </select>
      </div>}
      {settings.error && <ErrorState message={hoursWorkflowError(settings.error)} onRetry={() => void settings.refetch()} />}
      {settings.data && <CompanySettingsForm key={`${companyId}-${settings.data.version}`} value={settings.data} orgId={orgId} />}
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="space-y-2"><Label htmlFor="hours-week-start">Maandag van de werkweek</Label><Input id="hours-week-start" type="date" value={weekStart} onChange={event => setWeekStart(event.target.value)} /></div>
        <Button disabled={!settings.data?.enabled || create.isPending || !weekStart} onClick={() => create.mutate()}>Week openen of aanmaken</Button>
      </div>
      {create.error && <p role="alert" className="text-sm text-destructive">{hoursWorkflowError(create.error)}</p>}
    </CardContent>
  </Card>;
}

function CompanySettingsForm({ value, orgId }: { value: z.infer<typeof settingsSchema>; orgId: string }) {
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(value.enabled);
  const [submissionDay, setSubmissionDay] = useState(String(value.submission_day_offset));
  const [submissionTime, setSubmissionTime] = useState(value.submission_time.slice(0, 5));
  const [confirmationDay, setConfirmationDay] = useState(String(value.confirmation_day_offset));
  const [confirmationTime, setConfirmationTime] = useState(value.confirmation_time.slice(0, 5));
  const save = useMutation({
    mutationFn: () => hoursWorkflowRpc('hours_set_company_settings', {
      p_company_id: value.company_id, p_expected_version: value.version, p_enabled: enabled,
      p_submission_day_offset: Number(submissionDay), p_submission_time: submissionTime,
      p_confirmation_day_offset: Number(confirmationDay), p_confirmation_time: confirmationTime,
    }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: qk.hoursWorkflow.settings(orgId, value.company_id) }); },
  });
  const days = Array.from({ length: 21 }, (_, offset) => ({ offset, label: `${['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'][offset % 7]} · ${offset < 7 ? 'werkweek' : offset < 14 ? 'week erna' : 'twee weken erna'}` }));
  return <form className="space-y-3 rounded-lg bg-muted/30 p-4" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
    <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />Handmatige weekcontrole beschikbaar</label>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-2"><Label htmlFor="submission-day">Aanleverdeadline</Label><select id="submission-day" className="h-10 w-full rounded-md border bg-background px-2 text-sm" value={submissionDay} onChange={event => setSubmissionDay(event.target.value)}>{days.map(day => <option key={day.offset} value={day.offset}>{day.label}</option>)}</select><Input type="time" aria-label="Tijd aanleverdeadline" value={submissionTime} onChange={event => setSubmissionTime(event.target.value)} required /></div>
      <div className="space-y-2"><Label htmlFor="confirmation-day">Deadline medewerkerakkoord</Label><select id="confirmation-day" className="h-10 w-full rounded-md border bg-background px-2 text-sm" value={confirmationDay} onChange={event => setConfirmationDay(event.target.value)}>{days.map(day => <option key={day.offset} value={day.offset}>{day.label}</option>)}</select><Input type="time" aria-label="Tijd akkoorddeadline" value={confirmationTime} onChange={event => setConfirmationTime(event.target.value)} required /></div>
    </div>
    <p className="text-xs text-muted-foreground">Nederlandse tijd. Wijzigingen gelden voor nieuwe weken; bestaande weken behouden hun deadlines.</p>
    <Button type="submit" variant="outline" disabled={save.isPending}>Instellingen opslaan</Button>
    {save.error && <p role="alert" className="text-sm text-destructive">{hoursWorkflowError(save.error)}</p>}
  </form>;
}

export default function HoursWorkflow() {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const { weekId } = useParams();
  const actor = { organizationId: orgId, userId: user?.id ?? '', zone: 'internal' as const };
  const canManage = useRolePermission('finance.manage');
  const weeks = useHoursWeeks(actor);
  const week = useHoursWeek(actor, weekId);
  return <div className="space-y-6">
    <PageHeader title="Urenweken" breadcrumbs={[{ label: 'Uren', to: '/uren' }, { label: 'Urenweken', to: weekId ? '/uren/weken' : undefined }, ...(weekId ? [{ label: 'Week controleren' }] : [])]} description="Aanlevering, brongegevens, uursoortencontrole en medewerkerreacties per dagversie." actions={<Button asChild variant="outline"><Link to="/uren/matrices">Urenmatrices</Link></Button>} />
    {weekId ? week.error ? <ErrorState message={hoursWorkflowError(week.error)} onRetry={() => void week.refetch()} /> : week.data ? <HoursWeekWorkspace key={week.data.id} week={toHoursWeekView(week.data)} readOnly={!canManage || !week.data.can_manage} onSaveDay={async input => { try { await week.mutation.mutateAsync({ type: 'save', ...input }); } catch (error) { throw new Error(hoursWorkflowError(error)); } }} onReview={async input => { try { await week.mutation.mutateAsync({ type: 'review', ...input }); } catch (error) { throw new Error(hoursWorkflowError(error)); } }} onClassify={async input => { await week.classificationMutation.mutateAsync(input); }} onReload={() => void week.refetch()}
      sourcesSlot={<HoursWeekSources organizationId={orgId} week={toHoursWeekView(week.data)} onReload={() => void week.refetch()} />} /> : <p role="status">Week laden…</p> : <>
      {canManage && <CompanyWeekSetup orgId={orgId} />}
      {weeks.error ? <ErrorState message={hoursWorkflowError(weeks.error)} onRetry={() => void weeks.refetch()} /> : weeks.isPending ? <p role="status">Weken laden…</p> : weeks.data?.weeks.length === 0 ? <p className="text-sm text-muted-foreground">Er zijn nog geen klantweken voorbereid.</p> : <div className="grid gap-3 md:grid-cols-2">
        {weeks.data?.weeks.map(item => <Link className="rounded-xl border bg-card p-4 hover:border-primary focus-visible:outline-primary" to={`/uren/weken/${item.id}`} key={item.id}>
          <p className="font-semibold" data-no-translate="true">{item.company_name}</p><p className="text-sm text-muted-foreground">Week vanaf {item.week_start}</p>
          <p className="mt-3 text-sm">{item.received_day_count} van {item.day_count} dagen ontvangen · {item.confirmed_day_count} bevestigd</p>
          {item.blocked_day_count > 0 && <p className="text-sm text-destructive">{item.blocked_day_count} dagen vragen aandacht</p>}
        </Link>)}
      </div>}
    </>}
  </div>;
}
