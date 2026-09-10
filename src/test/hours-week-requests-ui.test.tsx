import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HoursWeekRequests } from '@/components/hours-workflow/HoursWeekRequests';
import type { HoursWeekRequest } from '@/lib/hours-sources';

const request = (overrides: Partial<HoursWeekRequest> = {}): HoursWeekRequest => ({
  id: 'r1', code: 'UR-7K3M-2XQ9', label: 'Planning Acme',
  created_at: '2026-09-14T08:00:00Z', expires_at: '2026-10-14T08:00:00Z',
  revoked_at: null, revoke_note: null, sent_at: null, received: 0, ...overrides,
});

const actions = { onIssue: vi.fn(), onRevoke: vi.fn(), busy: false };

afterEach(cleanup);

describe('de uitvraagreferentie bij een klantweek', () => {
  it('toont de code zoals hij in het onderwerp komt te staan', () => {
    render(<HoursWeekRequests canManage requests={[request()]} {...actions} />);
    expect(screen.getByText('[UR-7K3M-2XQ9]')).toBeInTheDocument();
  });

  it('zegt dat de code geen geheim is', () => {
    render(<HoursWeekRequests canManage requests={[request()]} {...actions} />);
    expect(screen.getByText(/geen geheim/i)).toBeInTheDocument();
  });

  it('telt hoeveel antwoorden er op deze uitvraag zijn binnengekomen', () => {
    render(<HoursWeekRequests canManage requests={[request({ received: 3 })]} {...actions} />);
    expect(screen.getByText(/3 antwoorden verwerkt/i)).toBeInTheDocument();
  });

  it('noemt een ingetrokken uitvraag als ingetrokken', () => {
    render(<HoursWeekRequests canManage
      requests={[request({ revoked_at: '2026-09-15T08:00:00Z' })]} {...actions} />);
    expect(screen.getByText(/Ingetrokken/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /intrekken/i })).not.toBeInTheDocument();
  });

  it('noemt een verlopen uitvraag als verlopen', () => {
    render(<HoursWeekRequests canManage
      requests={[request({ expires_at: '2026-01-01T08:00:00Z' })]} {...actions} />);
    expect(screen.getByText(/Verlopen/)).toBeInTheDocument();
  });

  it('biedt zonder beheerrecht geen handeling aan', () => {
    render(<HoursWeekRequests canManage={false} requests={[request()]} {...actions} />);
    expect(screen.queryByRole('button', { name: /uitvraag maken/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /intrekken/i })).not.toBeInTheDocument();
  });

  it('meldt wanneer er nog geen uitvraag is', () => {
    render(<HoursWeekRequests canManage requests={[]} {...actions} />);
    expect(screen.getByText(/Er is nog geen uitvraag voor deze week/i)).toBeInTheDocument();
  });
});
