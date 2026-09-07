import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * Gedeelde bevestigingsdialoog. De twee bestaande bevestigingen (voertuig- en
 * bewonerstoewijzing verwijderen) leunen op dit gedrag: de dialoog sluit zichzelf
 * niet na bevestigen, want de aanroeper houdt hem open tijdens de mutatie.
 */
describe('ConfirmDialog', () => {
  const baseProps = {
    open: true,
    onOpenChange: vi.fn(),
    title: 'Toewijzing verwijderen?',
    description: 'Deze actie kan niet ongedaan worden gemaakt.',
    onConfirm: vi.fn(),
  };

  it('toont titel, uitleg en Nederlandse knoppen, en legt de focus in de dialoog', async () => {
    render(<ConfirmDialog {...baseProps} onOpenChange={vi.fn()} onConfirm={vi.fn()} confirmLabel="Verwijderen" />);

    const dialog = screen.getByRole('alertdialog');
    expect(screen.getByText('Toewijzing verwijderen?')).toBeInTheDocument();
    expect(screen.getByText('Deze actie kan niet ongedaan worden gemaakt.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annuleren' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verwijderen' })).toBeInTheDocument();

    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('annuleert met Escape', () => {
    const onOpenChange = vi.fn();
    render(<ConfirmDialog {...baseProps} onOpenChange={onOpenChange} onConfirm={vi.fn()} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('annuleert met de annuleerknop', () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...baseProps} onOpenChange={onOpenChange} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('button', { name: 'Annuleren' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('bevestigt en houdt de dialoog open zodat de aanroeper de mutatie kan tonen', () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog {...baseProps} onOpenChange={onOpenChange} onConfirm={onConfirm} confirmLabel="Verwijderen" />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Verwijderen' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('sluit wel na bevestigen met closeOnConfirm', () => {
    const onOpenChange = vi.fn();
    render(<ConfirmDialog {...baseProps} onOpenChange={onOpenChange} onConfirm={vi.fn()} closeOnConfirm />);

    fireEvent.click(screen.getByRole('button', { name: 'Bevestigen' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('toont het laadlabel en blokkeert bevestigen zolang de mutatie loopt', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        {...baseProps}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
        confirmLabel="Verwijderen"
        pendingLabel="Verwijderen..."
        pending
      />,
    );

    const confirm = screen.getByRole('button', { name: 'Verwijderen...' });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('blokkeert bevestigen wanneer er eerst iets anders moet gebeuren', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        {...baseProps}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
        confirmLabel="Verwijderen"
        description="Voertuig is nog niet ingeleverd."
        confirmDisabled
      />,
    );

    expect(screen.getByRole('button', { name: 'Verwijderen' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Verwijderen' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('rendert extra velden in de dialoog', () => {
    render(
      <ConfirmDialog {...baseProps} onOpenChange={vi.fn()} onConfirm={vi.fn()}>
        <label htmlFor="uitcheckdatum">Uitcheckdatum</label>
        <input id="uitcheckdatum" type="date" defaultValue="2026-09-07" />
      </ConfirmDialog>,
    );

    expect(screen.getByLabelText('Uitcheckdatum')).toHaveValue('2026-09-07');
  });

  it('kleurt destructief by default en neutraal in de default-variant', () => {
    const { unmount } = render(
      <ConfirmDialog {...baseProps} onOpenChange={vi.fn()} onConfirm={vi.fn()} confirmLabel="Verwijderen" />,
    );
    expect(screen.getByRole('button', { name: 'Verwijderen' }).className).toContain('bg-destructive');
    unmount();

    render(
      <ConfirmDialog
        {...baseProps}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
        variant="default"
        confirmLabel="Markeren als betaald"
      />,
    );
    expect(screen.getByRole('button', { name: 'Markeren als betaald' }).className).not.toContain('bg-destructive');
  });
});

/**
 * De twee migrerende schermen, met exact de props die ze doorgeven. Pint de
 * teksten en de geblokkeerde staat vast: dit gedrag mag door de prefactor niet
 * veranderd zijn.
 */
describe('ConfirmDialog op de bestaande bevestigingen', () => {
  it('voertuigtoewijzing: blokkeert verwijderen zolang het voertuig niet is ingeleverd', () => {
    const onConfirm = vi.fn();
    const props = (returnedDate: string | null) => ({
      open: true,
      onOpenChange: vi.fn(),
      title: 'Toewijzing verwijderen?',
      description: returnedDate
        ? 'Verwijdert de historische toewijzing permanent. Deze actie kan niet ongedaan worden gemaakt.'
        : 'Voertuig is nog niet ingeleverd. Eerst inleveren voordat je de toewijzing kunt verwijderen.',
      confirmLabel: 'Verwijderen',
      pendingLabel: 'Verwijderen...',
      confirmDisabled: !returnedDate,
      onConfirm,
    });

    const { unmount } = render(<ConfirmDialog {...props(null)} />);
    expect(
      screen.getByText('Voertuig is nog niet ingeleverd. Eerst inleveren voordat je de toewijzing kunt verwijderen.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verwijderen' })).toBeDisabled();
    unmount();

    render(<ConfirmDialog {...props('2026-01-31')} />);
    expect(
      screen.getByText('Verwijdert de historische toewijzing permanent. Deze actie kan niet ongedaan worden gemaakt.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Verwijderen' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('bewonerstoewijzing: blokkeert verwijderen zolang de bewoner is ingecheckt', () => {
    const onConfirm = vi.fn();
    const props = (status: string) => ({
      open: true,
      onOpenChange: vi.fn(),
      title: 'Toewijzing verwijderen?',
      description:
        status === 'ingecheckt' ? (
          <>
            Bewoner is <strong>ingecheckt</strong>. Eerst uitchecken, dan kun je de toewijzing verwijderen of laten
            staan als historie.
          </>
        ) : (
          <>Dit verwijdert de toewijzing van Jan Kowalski aan kamer Kamer 3. Deze actie kan niet ongedaan worden gemaakt.</>
        ),
      confirmLabel: 'Verwijderen',
      pendingLabel: 'Verwijderen...',
      confirmDisabled: status === 'ingecheckt',
      onConfirm,
    });

    const { unmount } = render(<ConfirmDialog {...props('ingecheckt')} />);
    expect(screen.getByText('ingecheckt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verwijderen' })).toBeDisabled();
    unmount();

    render(<ConfirmDialog {...props('uitgecheckt')} />);
    expect(
      screen.getByText(/Dit verwijdert de toewijzing van Jan Kowalski aan kamer Kamer 3\./),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Verwijderen' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
