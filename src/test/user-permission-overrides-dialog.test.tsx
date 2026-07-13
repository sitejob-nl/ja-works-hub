import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import UserPermissionOverridesDialog from '@/components/settings/UserPermissionOverridesDialog';
import { DEFAULT_ROLE_PERMISSIONS } from '@/lib/permissions';
import { useRolePermissionMatrix } from '@/hooks/usePermissions';

vi.mock('@/hooks/usePermissions', () => ({
  useRolePermissionMatrix: vi.fn(),
}));

const matrixMock = vi.mocked(useRolePermissionMatrix);

describe('UserPermissionOverridesDialog', () => {
  it('toont individuele uitzonderingen en kan alles terugzetten naar de rolstandaard', async () => {
    matrixMock.mockReturnValue({
      data: { settings: {}, matrix: DEFAULT_ROLE_PERMISSIONS },
      isLoading: false,
    } as any);
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <UserPermissionOverridesDialog
        open
        onOpenChange={vi.fn()}
        onSave={onSave}
        user={{
          id: 'user-1',
          email: 'backoffice@example.com',
          full_name: 'Backoffice Test',
          role: 'backoffice',
          permission_overrides: {
            'vacancies.edit': true,
            'candidates.edit': false,
          },
          permission_override_count: 2,
        }}
      />,
    );

    expect(screen.getByText('Individueel toegestaan')).toBeInTheDocument();
    expect(screen.getByText('Individueel geblokkeerd')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Herstel rolstandaard' }));
    expect(screen.queryByText('Individueel toegestaan')).toBeNull();
    expect(screen.queryByText('Individueel geblokkeerd')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Rechten opslaan' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), {}));
  });
});
