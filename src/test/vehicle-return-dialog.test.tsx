import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// De dialoog gebruikt alleen de pure validatie-helpers uit @/lib/assignments, maar die
// module maakt bij import de Supabase-client aan — en die eist VITE_SUPABASE_URL, die in
// CI (geen .env) ontbreekt. Mocken op modulegrens, zoals compliance-check.test.ts.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { VehicleReturnDialog } from '@/components/transport/VehicleReturnDialog';
import { todayISO } from '@/lib/tasks';

/**
 * Gedeelde inleverdialoog (voertuigkant + medewerkersdossier). De validatie zelf zit in
 * vehicleReturnIssue (zie assignments.test.ts); hier gaat het om de koppeling met de knop:
 * blokkeren zolang de invoer niet klopt, en de geparste waarden doorgeven bij bevestigen.
 */
const assignment = { id: 'va-1', assigned_date: '2026-09-01', start_mileage: 10000 };

const setup = (overrides: Partial<React.ComponentProps<typeof VehicleReturnDialog>> = {}) => {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <VehicleReturnDialog
      assignment={assignment}
      vehicleLabel="AB-123-C"
      onOpenChange={onOpenChange}
      pending={false}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { onConfirm, onOpenChange };
};

describe('VehicleReturnDialog', () => {
  it('opent met vandaag als inleverdatum, een lege eindstand en een geblokkeerde knop', () => {
    setup();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('AB-123-C')).toBeInTheDocument();
    expect(screen.getByLabelText('Inleverdatum *')).toHaveValue(todayISO());
    expect(screen.getByLabelText('Eind kilometerstand *')).toHaveValue(null);
    expect(screen.getByRole('button', { name: 'Inleveren' })).toBeDisabled();
  });

  it('blijft geblokkeerd en legt uit waarom bij een eindstand onder de beginstand', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Eind kilometerstand *'), { target: { value: '9500' } });
    expect(screen.getByText(/lager dan de beginstand/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inleveren' })).toBeDisabled();
  });

  it('weigert een inleverdatum vóór de toewijsdatum', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Inleverdatum *'), { target: { value: '2026-08-15' } });
    fireEvent.change(screen.getByLabelText('Eind kilometerstand *'), { target: { value: '10500' } });
    expect(screen.getByText(/vóór de toewijsdatum/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inleveren' })).toBeDisabled();
  });

  it('geeft bij bevestigen de datum en de geparste kilometerstand door', () => {
    const { onConfirm, onOpenChange } = setup();
    fireEvent.change(screen.getByLabelText('Inleverdatum *'), { target: { value: '2026-09-05' } });
    fireEvent.change(screen.getByLabelText('Eind kilometerstand *'), { target: { value: '10500' } });

    const button = screen.getByRole('button', { name: 'Inleveren' });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    expect(onConfirm).toHaveBeenCalledWith({ returnedDate: '2026-09-05', endMileage: 10500 });
    // De aanroeper sluit zelf na de mutatie (ConfirmDialog-patroon).
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('toont de laadstaat en blokkeert dubbel bevestigen', () => {
    setup({ pending: true });
    expect(screen.getByRole('button', { name: 'Inleveren...' })).toBeDisabled();
  });

  it('rendert niets zonder toewijzing', () => {
    setup({ assignment: null });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
