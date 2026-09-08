import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePortal } from '@/contexts/PortalContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useHoursWeek, useHoursWeeks } from '@/hooks/useHoursWorkflow';
import { hoursWorkflowError, toHoursWeekView } from '@/lib/hours-workflow';
import { HoursPortalWeek } from '@/components/hours-workflow/HoursPortalWeek';
import type { HoursLanguage } from '@/components/hours-workflow/types';
import { Button } from '@/components/ui/button';

const copy = {
  nl: { title: 'Mijn uren ter controle', empty: 'Er staan nog geen urenweken voor je klaar.', loading: 'Uren laden…', error: 'Je uren konden niet worden geladen.', retry: 'Opnieuw proberen', back: 'Alle urenweken', week: 'Week vanaf', conflict: 'Deze uren zijn gewijzigd. Ververs de week en controleer de nieuwe versie.', saveError: 'Je reactie kon niet worden opgeslagen. Probeer het opnieuw.', language: 'Taal urenoverzicht', missingAccount: 'Je account is nog niet gekoppeld aan een medewerker. Neem contact op met JA Werkt.' },
  en: { title: 'My hours to review', empty: 'There are no hours ready for you to review yet.', loading: 'Loading hours…', error: 'Your hours could not be loaded.', retry: 'Try again', back: 'All weeks', week: 'Week starting', conflict: 'These hours have changed. Reload the week and check the new version.', saveError: 'Your response could not be saved. Please try again.', language: 'Hours overview language', missingAccount: 'Your account is not linked to an employee yet. Please contact JA Werkt.' },
  pl: { title: 'Moje godziny do sprawdzenia', empty: 'Nie ma jeszcze godzin do sprawdzenia.', loading: 'Ładowanie godzin…', error: 'Nie udało się załadować godzin.', retry: 'Spróbuj ponownie', back: 'Wszystkie tygodnie', week: 'Tydzień od', conflict: 'Godziny zostały zmienione. Odśwież tydzień i sprawdź nową wersję.', saveError: 'Nie udało się zapisać odpowiedzi. Spróbuj ponownie.', language: 'Język przeglądu godzin', missingAccount: 'Twoje konto nie jest jeszcze powiązane z pracownikiem. Skontaktuj się z JA Werkt.' },
};

export default function PortalHoursWorkflow() {
  const { candidate, session } = usePortal();
  const { language: portalLanguage } = useTranslation();
  const { weekId } = useParams();
  const actor = { organizationId: candidate?.organization_id ?? '', userId: session?.user.id ?? '', zone: 'portal' as const };
  const [language, setLanguage] = useState<HoursLanguage>(() => ['nl', 'en', 'pl'].includes(candidate?.portal_language) ? candidate.portal_language : portalLanguage);
  const previousPortalLanguage = useRef(portalLanguage);
  useEffect(() => {
    // A local Polish choice survives mounting; an explicit global toggle still applies.
    if (previousPortalLanguage.current !== portalLanguage) setLanguage(portalLanguage);
    previousPortalLanguage.current = portalLanguage;
  }, [portalLanguage]);
  const t = copy[language];
  const weeks = useHoursWeeks(actor);
  const week = useHoursWeek(actor, weekId);
  const active = weekId ? week : weeks;
  return <div className="space-y-4" data-no-translate="true">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold">{t.title}</h1>
      <select aria-label={t.language} className="h-10 rounded-md border bg-background px-3 text-sm" value={language} onChange={event => setLanguage(event.target.value as HoursLanguage)}>
        <option value="nl">Nederlands</option><option value="en">English</option><option value="pl">Polski</option>
      </select>
    </div>
    {weekId && <Button asChild variant="outline"><Link to="/portaal/uren/weken">{t.back}</Link></Button>}
    {!actor.organizationId || !actor.userId ? <p role="alert">{t.missingAccount}</p> : active.error ? <div role="alert" className="space-y-3"><p>{t.error}</p><Button variant="outline" onClick={() => void active.refetch()}>{t.retry}</Button></div> : active.isPending ? <p role="status">{t.loading}</p> : weekId && week.data ? <HoursPortalWeek key={week.data.id} week={toHoursWeekView(week.data)} language={language} readOnly={!week.data.can_confirm} onRespond={async input => {
      try { await week.mutation.mutateAsync({ type: 'respond', ...input }); }
      catch (error) {
        const isConflict = typeof error === 'object' && error !== null && 'code' in error && error.code === '40001';
        throw Object.assign(new Error(language === 'nl' ? hoursWorkflowError(error) : isConflict ? t.conflict : t.saveError), isConflict ? { code: '40001' } : {});
      }
    }} onConfirmAll={async input => {
      try { await week.mutation.mutateAsync({ type: 'confirmAll', ...input }); }
      catch (error) {
        const isConflict = typeof error === 'object' && error !== null && 'code' in error && error.code === '40001';
        throw Object.assign(new Error(language === 'nl' ? hoursWorkflowError(error) : isConflict ? t.conflict : t.saveError), isConflict ? { code: '40001' } : {});
      }
    }} onReload={() => void week.refetch()} /> : <>
      {!weeks.data?.weeks.length && <p className="text-muted-foreground">{t.empty}</p>}
      {weeks.data?.weeks.map(item => <Link key={item.id} to={`/portaal/uren/week/${item.id}`} className="block rounded-xl border p-4 hover:border-primary"><p className="font-medium">{item.company_name}</p><p className="text-sm text-muted-foreground">{t.week} {item.week_start}</p></Link>)}
    </>}
  </div>;
}
