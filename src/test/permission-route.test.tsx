import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PermissionRoute from '@/components/PermissionRoute';
import { useRolePermissionAccess } from '@/hooks/usePermissions';

vi.mock('@/hooks/usePermissions', () => ({
  useRolePermissionAccess: vi.fn(),
}));

const accessMock = vi.mocked(useRolePermissionAccess);

const renderRoute = () => render(
  <MemoryRouter initialEntries={['/instellingen']}>
    <Routes>
      <Route path="/" element={<div>Dashboard</div>} />
      <Route
        path="/instellingen"
        element={(
          <PermissionRoute permission="settings.manage">
            <div>Instellingen</div>
          </PermissionRoute>
        )}
      />
    </Routes>
  </MemoryRouter>,
);

describe('PermissionRoute', () => {
  it('toont de beveiligde pagina met het vereiste recht', () => {
    accessMock.mockReturnValue({ allowed: true, isLoading: false, error: null } as any);
    renderRoute();
    expect(screen.getByText('Instellingen')).toBeInTheDocument();
  });

  it('stuurt zonder recht terug naar het dashboard', () => {
    accessMock.mockReturnValue({ allowed: false, isLoading: false, error: null } as any);
    renderRoute();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Instellingen')).toBeNull();
  });

  it('faalt gesloten als de rechtenmatrix niet geladen kan worden', () => {
    accessMock.mockReturnValue({ allowed: false, isLoading: false, error: new Error('offline') } as any);
    renderRoute();
    expect(screen.getByText('Rechten konden niet worden gecontroleerd')).toBeInTheDocument();
    expect(screen.queryByText('Instellingen')).toBeNull();
  });
});
