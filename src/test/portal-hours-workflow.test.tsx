import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PortalHoursWorkflow from '@/pages/portal/PortalHoursWorkflow';

const mocks = vi.hoisted(() => ({
  language: 'nl',
  candidate: { organization_id: 'org-1', portal_language: 'nl' } as { organization_id: string; portal_language: string } | null,
  canConfirm: true,
  pending: false,
  mutation: vi.fn(),
  workspace: vi.fn(),
}));

vi.mock('@/contexts/PortalContext', () => ({
  usePortal: () => ({ candidate: mocks.candidate, session: { user: { id: 'user-1' } } }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ language: mocks.language }) }));
vi.mock('@/hooks/useHoursWorkflow', () => ({
  useHoursWeeks: () => ({ isPending: mocks.pending, error: null, data: { weeks: [] } }),
  useHoursWeek: () => ({
    isPending: mocks.pending, error: null,
    data: {
      id: 'week-1', company_name: 'Werkgever', week_start: '2026-09-07',
      settings_snapshot: {}, workflow_enabled: true, can_confirm: mocks.canConfirm, members: [],
    },
    mutation: { mutateAsync: mocks.mutation },
  }),
}));
vi.mock('@/components/hours-workflow/HoursPortalWeek', () => ({
  HoursPortalWeek: (props: { language: string }) => {
    mocks.workspace(props);
    return <div data-testid="week-language">{props.language}</div>;
  },
}));

function Page() {
  return <MemoryRouter initialEntries={['/portaal/uren/week/week-1']}>
    <Routes><Route path="/portaal/uren/week/:weekId" element={<PortalHoursWorkflow />} /></Routes>
  </MemoryRouter>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.language = 'nl';
  mocks.candidate = { organization_id: 'org-1', portal_language: 'nl' };
  mocks.canConfirm = true;
  mocks.pending = false;
  mocks.mutation.mockResolvedValue({});
});

describe('portal hours integration', () => {
  it('keeps an initial Polish preference and offers all three hours languages', () => {
    mocks.candidate!.portal_language = 'pl';
    render(<Page />);
    expect(screen.getByTestId('week-language')).toHaveTextContent('pl');
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Nederlands', 'English', 'Polski']);
  });

  it('updates when the global portal language changes', async () => {
    const page = render(<Page />);
    expect(screen.getByTestId('week-language')).toHaveTextContent('nl');
    mocks.language = 'en';
    page.rerender(<Page />);
    await waitFor(() => expect(screen.getByTestId('week-language')).toHaveTextContent('en'));
    expect(screen.getByRole('heading')).toHaveTextContent('My hours to review');
  });

  it('changes only the hours display when Polish is selected locally', () => {
    render(<Page />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pl' } });
    expect(screen.getByTestId('week-language')).toHaveTextContent('pl');
    expect(mocks.candidate!.portal_language).toBe('nl');
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it('passes the server response capability to the workspace', () => {
    mocks.canConfirm = false;
    render(<Page />);
    expect(mocks.workspace).toHaveBeenLastCalledWith(expect.objectContaining({ readOnly: true }));
  });

  it('shows a missing employee link instead of loading indefinitely', () => {
    mocks.candidate = null;
    mocks.pending = true;
    render(<Page />);
    expect(screen.getByRole('alert')).toHaveTextContent('Je account is nog niet gekoppeld aan een medewerker');
    expect(screen.queryByRole('status')).toBeNull();
    expect(mocks.workspace).not.toHaveBeenCalled();
  });

  it.each([
    { language: 'nl', message: 'Ververs de week' },
    { language: 'en', message: 'These hours have changed' },
    { language: 'pl', message: 'Godziny zostały zmienione' },
  ].flatMap(translation => ['40001', 'PT409'].flatMap(code => ['onRespond', 'onConfirmAll'].map(action => ({ ...translation, code, action })))))('preserves $code and translates the $action conflict to $language', async ({ language, message, code, action }) => {
    mocks.candidate!.portal_language = language;
    mocks.mutation.mockRejectedValue({ code, message: 'Private SQL detail' });
    render(<Page />);
    const props = mocks.workspace.mock.lastCall![0];
    const operation = action === 'onRespond'
      ? props.onRespond({ dayId: 'day-1', expectedRevisionId: 'revision-1', response: 'confirmed', comment: null })
      : props.onConfirmAll({ revisions: [{ dayId: 'day-1', expectedRevisionId: 'revision-1' }], comment: null });
    await expect(operation).rejects.toMatchObject({ code, message: expect.stringContaining(message) });
    await expect(operation).rejects.not.toHaveProperty('message', expect.stringContaining('Private SQL detail'));
  });
});
