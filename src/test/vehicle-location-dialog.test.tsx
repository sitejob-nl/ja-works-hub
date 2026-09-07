import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { VehicleLocationDialog } from '@/components/transport/VehicleLocationDialog';

/**
 * Dialoog voor de laatste bekende locatie. De opslagregels zelf zitten in
 * `vehicleLocationPatch` (zie vehicle-location.test.ts); hier gaat het om de koppeling
 * met de knop: niets opslaan als er niets veranderde, en leegmaken expliciet als wissen
 * presenteren in plaats van als een gewone opslag.
 */
const setup = (overrides: Partial<React.ComponentProps<typeof VehicleLocationDialog>> = {}) => {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <VehicleLocationDialog
      open
      onOpenChange={onOpenChange}
      vehicle={{ license_plate: 'AB-123-C', last_known_location: 'Parkeerterrein Mierlo' }}
      pending={false}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { onConfirm, onOpenChange };
};

describe('VehicleLocationDialog', () => {
  it('opent voorgevuld met de huidige locatie en een geblokkeerde knop', () => {
    setup();
    expect(screen.getByText('AB-123-C')).toBeInTheDocument();
    expect(screen.getByLabelText('Locatie')).toHaveValue('Parkeerterrein Mierlo');
    expect(screen.getByRole('button', { name: 'Opslaan' })).toBeDisabled();
  });

  it('geeft de getrimde locatie door bij opslaan', () => {
    const { onConfirm, onOpenChange } = setup();
    fireEvent.change(screen.getByLabelText('Locatie'), { target: { value: '  Garage Van Dijk ' } });

    const button = screen.getByRole('button', { name: 'Opslaan' });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    expect(onConfirm).toHaveBeenCalledWith('Garage Van Dijk');
    // De aanroeper sluit zelf na de mutatie (ConfirmDialog-patroon).
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('blijft geblokkeerd als alleen de spaties veranderen', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Locatie'), { target: { value: ' Parkeerterrein Mierlo  ' } });
    expect(screen.getByRole('button', { name: 'Opslaan' })).toBeDisabled();
  });

  it('noemt leegmaken wissen en geeft een lege waarde door', () => {
    const { onConfirm } = setup();
    fireEvent.change(screen.getByLabelText('Locatie'), { target: { value: '' } });

    expect(screen.getByText('Leeg opslaan wist de locatie, de datum en de naam.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Wissen' }));
    expect(onConfirm).toHaveBeenCalledWith('');
  });

  it('start leeg bij een voertuig zonder locatie en slaat de eerste invoer op', () => {
    const { onConfirm } = setup({ vehicle: { license_plate: 'XY-99-ZZ', last_known_location: null } });
    expect(screen.getByLabelText('Locatie')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Opslaan' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Locatie'), { target: { value: 'Werf Helmond' } });
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan' }));
    expect(onConfirm).toHaveBeenCalledWith('Werf Helmond');
  });

  it('toont de laadstaat en blokkeert dubbel opslaan', () => {
    setup({ pending: true });
    expect(screen.getByRole('button', { name: 'Opslaan...' })).toBeDisabled();
  });

  it('rendert niets zolang hij dicht staat', () => {
    setup({ open: false });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
