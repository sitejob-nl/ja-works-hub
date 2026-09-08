import type { HoursDayView, HoursLanguage } from './types';

export const hoursCopy = {
  nl: {
    title: 'Mijn uren', introduction: 'Controleer je ontvangen uren. Bevestig de dagen die kloppen of geef aan wat er niet klopt.',
    dormant: 'Deze urenstroom staat uit voor deze opdrachtgever. Je kunt je bestaande uren bekijken. Reageren kan zodra de urenstroom weer aan staat.', empty: 'Er staan nog geen dagen klaar voor deze week.',
    deadline: 'Reageren vóór', day: 'Dag', hours: 'uur', missing: 'Nog niet ontvangen', noHours: 'Geen uren',
    confirmed: 'Akkoord', disputed: 'Betwist', waiting: 'Wacht op jouw reactie', previousResponse: 'Gewijzigd na je reactie',
    source: 'Bron', note: 'Opmerking bij de uren', yourNote: 'Jouw opmerking', revision: 'Versie',
    confirm: 'Akkoord', dispute: 'Klopt niet', all: 'Alle ontvangen dagen akkoord',
    allHelp: 'Je bevestigt alleen de ontvangen dagen hieronder. Ontbrekende dagen blijven open.',
    responseNote: 'Opmerking bij je reactie', optional: 'Optioneel', requiredNote: 'Beschrijf wat er niet klopt.',
    save: 'Reactie opslaan', saving: 'Bezig…', cancel: 'Annuleren', saved: 'Je reactie is opgeslagen.',
    conflict: 'Deze uren zijn ondertussen gewijzigd. Laad de actuele versie en controleer die voordat je opnieuw reageert.',
    failure: 'Je reactie is niet opgeslagen. Probeer het opnieuw.', reload: 'Actuele uren laden',
    complete: 'Alle ontvangen dagen zijn bevestigd.', receivedTotal: 'Totaal ontvangen',
    pendingReview: 'Controle door JA Werkt staat open.', blocked: 'JA Werkt controleert een afwijking.',
  },
  en: {
    title: 'My hours', introduction: 'Check the hours received. Confirm the correct days or tell us what is wrong.',
    dormant: 'This hours workflow is disabled for this company. You can view your existing hours. You can respond when it is enabled again.', empty: 'No days are available for this week yet.',
    deadline: 'Respond before', day: 'Day', hours: 'hours', missing: 'Not yet received', noHours: 'No hours',
    confirmed: 'Confirmed', disputed: 'Disputed', waiting: 'Awaiting your response', previousResponse: 'Changed after your response',
    source: 'Source', note: 'Note about these hours', yourNote: 'Your comment', revision: 'Version',
    confirm: 'Confirm', dispute: 'Not correct', all: 'Confirm all received days',
    allHelp: 'You confirm only the received days below. Missing days remain open.',
    responseNote: 'Comment on your response', optional: 'Optional', requiredNote: 'Describe what is wrong.',
    save: 'Save response', saving: 'Saving…', cancel: 'Cancel', saved: 'Your response has been saved.',
    conflict: 'These hours have changed. Load the current version and check it before responding again.',
    failure: 'Your response was not saved. Please try again.', reload: 'Load current hours',
    complete: 'All received days are confirmed.', receivedTotal: 'Total received',
    pendingReview: 'Review by JA Werkt is still pending.', blocked: 'JA Werkt is checking a discrepancy.',
  },
  pl: {
    title: 'Moje godziny', introduction: 'Sprawdź otrzymane godziny. Potwierdź poprawne dni lub zgłoś nieprawidłowości.',
    dormant: 'Rejestracja godzin jest wyłączona dla tej firmy. Możesz przeglądać zapisane godziny. Odpowiedź będzie możliwa po ponownym włączeniu.', empty: 'Nie ma jeszcze dni do sprawdzenia w tym tygodniu.',
    deadline: 'Odpowiedz przed', day: 'Dzień', hours: 'godz.', missing: 'Jeszcze nie otrzymano', noHours: 'Brak godzin',
    confirmed: 'Potwierdzono', disputed: 'Zakwestionowano', waiting: 'Oczekuje na Twoją odpowiedź', previousResponse: 'Zmieniono po Twojej odpowiedzi',
    source: 'Źródło', note: 'Uwagi dotyczące godzin', yourNote: 'Twój komentarz', revision: 'Wersja',
    confirm: 'Potwierdź', dispute: 'Nie zgadza się', all: 'Potwierdź wszystkie otrzymane dni',
    allHelp: 'Potwierdzasz tylko otrzymane dni poniżej. Brakujące dni pozostają otwarte.',
    responseNote: 'Komentarz do odpowiedzi', optional: 'Opcjonalnie', requiredNote: 'Opisz, co się nie zgadza.',
    save: 'Zapisz odpowiedź', saving: 'Zapisywanie…', cancel: 'Anuluj', saved: 'Twoja odpowiedź została zapisana.',
    conflict: 'Te godziny zostały zmienione. Wczytaj aktualną wersję i sprawdź ją przed ponowną odpowiedzią.',
    failure: 'Nie zapisano odpowiedzi. Spróbuj ponownie.', reload: 'Wczytaj aktualne godziny',
    complete: 'Wszystkie otrzymane dni zostały potwierdzone.', receivedTotal: 'Suma otrzymanych godzin',
    pendingReview: 'Godziny oczekują na kontrolę JA Werkt.', blocked: 'JA Werkt sprawdza rozbieżność.',
  },
} as const;

export function formatHours(minutes: number, language: HoursLanguage = 'nl') {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(minutes / 60);
}

export function formatHoursDate(date: string, language: HoursLanguage = 'nl') {
  return new Intl.DateTimeFormat(language, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${date}T12:00:00Z`));
}

export function formatHoursDeadline(timestamp: string, language: HoursLanguage = 'nl') {
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Amsterdam' })
    .format(new Date(timestamp));
}

export function currentConfirmation(day: HoursDayView) {
  return day.revision && day.confirmation?.revisionId === day.revision.id ? day.confirmation : null;
}

export function isHoursConflict(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: string; message?: string };
  return value.code === '40001' || /revision.*conflict|version.*conflict|stale.*revision|uren.*gewijzigd/i.test(value.message ?? '');
}
