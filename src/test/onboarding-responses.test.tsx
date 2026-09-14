import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OnboardingResponses from '@/components/onboarding/OnboardingResponses';

const query = vi.hoisted(() => ({ data: [] as any[], isLoading: false, error: null as Error | null, refetch: vi.fn() }));
vi.mock('@/lib/org-scope', () => ({ useOrgQuery: () => query }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

const response = (id: string, fieldId: string, label: string, value: string, fieldType = 'text', column: string | null = null) => ({
  id, field_id: fieldId, value, created_at: '2026-09-14T10:00:00Z',
  onboarding_form_fields: { label, field_type: fieldType, sort_order: 1, maps_to_column: column,
    onboarding_form_steps: { title: 'Gegevens', sort_order: 1 } },
});
beforeEach(() => { query.data = []; query.isLoading = false; query.error = null; });
describe('onboardingantwoorden in het profiel', () => {
  it('toont de nieuwste antwoorden, inclusief niet-gekoppelde vragen en nee-antwoorden', () => {
    query.data = [response('new', 'city', 'Woonplaats', 'Eindhoven'), response('check', 'agree', 'Akkoord', 'false', 'checkbox'),
      response('old', 'city', 'Woonplaats', 'Mierlo')];
    render(<OnboardingResponses candidateId="candidate-a" />);
    expect(screen.getByText('Eindhoven')).toBeVisible();
    expect(screen.getByText('Nee')).toBeVisible();
    expect(screen.queryByText('Mierlo')).not.toBeInTheDocument();
  });
  it('omzeilt de afgeschermde persoonsgegevens niet', () => {
    query.data = [response('bank', 'iban', 'Bankrekening', 'NL91ABNA0417164300', 'text', 'iban')];
    render(<OnboardingResponses candidateId="candidate-a" />);
    expect(screen.queryByText('NL91ABNA0417164300')).not.toBeInTheDocument();
    expect(screen.getByText(/Afgeschermd/)).toBeVisible();
  });
  it('toont een laadfout niet als een leeg formulier', () => {
    query.error = new Error('Antwoorden konden niet worden geladen');
    render(<OnboardingResponses candidateId="candidate-a" />);
    expect(screen.getByRole('button', { name: /Opnieuw/i })).toBeVisible();
    expect(screen.queryByText('Nog geen onboardingformulier ingediend.')).not.toBeInTheDocument();
  });
});
