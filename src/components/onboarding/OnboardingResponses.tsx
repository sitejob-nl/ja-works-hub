import { supabase } from '@/integrations/supabase/client';
import { useOrgQuery } from '@/lib/org-scope';
import { qk } from '@/lib/query-keys';
import { unwrapList } from '@/lib/db';
import { formatDate, formatDateTime } from '@/lib/format';
import ErrorState from '@/components/shared/ErrorState';

type ResponseRow = {
  id: string;
  field_id: string;
  value: string | null;
  created_at: string;
  onboarding_form_fields: {
    label: string;
    field_type: string;
    sort_order: number;
    maps_to_column: string | null;
    onboarding_form_steps: { title: string; sort_order: number } | null;
  } | null;
};

function responseValue(row: ResponseRow) {
  const field = row.onboarding_form_fields;
  // BSN/IBAN staan afgeschermd bij Persoonsgegevens; de antwoordenkaart mag die
  // afscherming niet omzeilen via de oorspronkelijke formulierwaarde.
  if (['bsn', 'iban'].includes(field?.maps_to_column ?? '') || /\b(bsn|iban)\b/i.test(field?.label ?? '')) {
    return 'Afgeschermd — zie Persoonsgegevens';
  }
  if (['file', 'file_upload'].includes(field?.field_type ?? '')) return `${row.value || 'Bestand'} — zie Documenten`;
  if (!row.value) return '—';
  if (field?.field_type === 'checkbox') return row.value === 'true' ? 'Ja' : 'Nee';
  if (field?.field_type === 'date') return formatDate(row.value);
  return row.value;
}

/** Dezelfde ingediende antwoorden in het kandidaatprofiel en op de onboarding-tab. */
export default function OnboardingResponses({ candidateId }: { candidateId: string }) {
  const { data: responses = [], isLoading, error, refetch } = useOrgQuery(
    (orgId) => qk.onboarding.responses(orgId, candidateId),
    (orgId) => unwrapList<ResponseRow>(supabase.from('onboarding_responses')
      .select(`id, field_id, value, created_at, onboarding_form_fields (
        label, field_type, sort_order, maps_to_column,
        onboarding_form_steps (title, sort_order)
      )`)
      .eq('organization_id', orgId)
      .eq('candidate_id', candidateId)
      .order('created_at', { ascending: false })),
  );

  // Meerdere inzendingen kunnen hetzelfde veld bevatten. Toon de nieuwste waarde.
  const latest = new Map<string, ResponseRow>();
  for (const row of responses) {
    if (row.onboarding_form_fields && !latest.has(row.field_id)) latest.set(row.field_id, row);
  }
  const rows = [...latest.values()].sort((a, b) =>
    (a.onboarding_form_fields?.onboarding_form_steps?.sort_order ?? 0) - (b.onboarding_form_fields?.onboarding_form_steps?.sort_order ?? 0)
    || (a.onboarding_form_fields?.sort_order ?? 0) - (b.onboarding_form_fields?.sort_order ?? 0));

  return (
    <section className="bg-card rounded-lg border p-6 space-y-4" aria-label="Onboardingformulier">
      <div>
        <h3 className="font-medium">Onboardingformulier</h3>
        <p className="text-xs text-muted-foreground">Antwoorden die de kandidaat tijdens de onboarding heeft ingevuld.</p>
        {responses[0]?.created_at && <p className="text-xs text-muted-foreground mt-1">Laatst ingediend op {formatDateTime(responses[0].created_at)}</p>}
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Antwoorden laden...</p>
        : error ? <ErrorState error={error} onRetry={() => refetch()} />
        : rows.length === 0 ? <p className="text-sm text-muted-foreground">Nog geen onboardingformulier ingediend.</p>
        : <dl className="divide-y">
          {rows.map((row) => <div key={row.id} className="py-3 grid gap-1 sm:grid-cols-2 sm:gap-4">
            <dt className="text-sm text-muted-foreground">{row.onboarding_form_fields?.label}</dt>
            <dd className="text-sm whitespace-pre-wrap break-words">{responseValue(row)}</dd>
          </div>)}
        </dl>}
    </section>
  );
}
