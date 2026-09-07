import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HousingCheckOutDialog } from '@/components/housing/HousingCheckOutDialog';
import { todayISO } from '@/lib/tasks';

/**
 * Uitchecken van een bewoner: de dialoog stelt vandaag voor, laat verleden en
 * toekomst toe, maar nooit een datum vóór de incheckdatum. Annuleren raakt niets aan.
 */
describe('HousingCheckOutDialog', () => {
  const assignment = { id: 'a1', check_in_date: '2026-08-01' };

  const renderDialog = (overrides: Partial<Parameters<typeof HousingCheckOutDialog>[0]> = {}) => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <HousingCheckOutDialog
        assignment={assignment}
        residentName="Jan Kowalski"
        unitName="Kamer 3"
        pending={false}
        onConfirm={onConfirm}
        onClose={onClose}
        {...overrides}
      />,
    );
    return { onConfirm, onClose };
  };

  const dateInput = () => screen.getByLabelText('Uitcheckdatum') as HTMLInputElement;
  const confirmButton = () => screen.getByRole('button', { name: 'Uitchecken' });

  it('opent met vandaag als uitcheckdatum, noemt bewoner en kamer, en bevestigt neutraal (niet rood)', () => {
    renderDialog();

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('Bewoner uitchecken?')).toBeInTheDocument();
    expect(screen.getByText(/Jan Kowalski wordt uitgecheckt uit kamer Kamer 3/)).toBeInTheDocument();
    expect(dateInput().value).toBe(todayISO());
    expect(dateInput().min).toBe('2026-08-01');
    expect(confirmButton()).toBeEnabled();
    expect(confirmButton().className).not.toMatch(/bg-destructive/);
    expect(screen.getByText(/Ingecheckt op 01-08-2026/)).toBeInTheDocument();
  });

  it('blokkeert een datum vóór de incheckdatum en legt uit waarom; dezelfde dag mag wel', () => {
    const { onConfirm } = renderDialog();

    fireEvent.change(dateInput(), { target: { value: '2026-07-31' } });
    expect(confirmButton()).toBeDisabled();
    expect(screen.getByText('De uitcheckdatum kan niet vóór de incheckdatum liggen.')).toBeInTheDocument();
    fireEvent.click(confirmButton());
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(dateInput(), { target: { value: '2026-08-01' } });
    expect(confirmButton()).toBeEnabled();
  });

  it('blokkeert bevestigen zolang de datum leeg is', () => {
    renderDialog();

    fireEvent.change(dateInput(), { target: { value: '' } });
    expect(confirmButton()).toBeDisabled();
    expect(screen.getByText('Kies een uitcheckdatum.')).toBeInTheDocument();
  });

  it('geeft een datum in het verleden of de toekomst door en sluit zichzelf niet (aanroeper sluit na de mutatie)', () => {
    const { onConfirm, onClose } = renderDialog();

    fireEvent.change(dateInput(), { target: { value: '2026-08-20' } });
    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenLastCalledWith('2026-08-20');

    fireEvent.change(dateInput(), { target: { value: '2027-01-15' } });
    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenLastCalledWith('2027-01-15');

    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('annuleren sluit de dialoog zonder te bevestigen', () => {
    const { onConfirm, onClose } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Annuleren' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('toont het laadlabel en blokkeert bevestigen zolang de mutatie loopt', () => {
    renderDialog({ pending: true });

    expect(screen.getByRole('button', { name: 'Uitchecken...' })).toBeDisabled();
  });

  it('blijft dicht zonder toewijzing', () => {
    renderDialog({ assignment: null });

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
