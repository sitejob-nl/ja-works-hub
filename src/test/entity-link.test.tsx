import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EntityLink } from '@/components/ui/entity-link';
import { PhoneLink } from '@/components/ui/contact-links';

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('EntityLink', () => {
  it('linkt naar de detailpagina wanneer er een id is', () => {
    wrap(
      <EntityLink type="candidate" id="abc">
        Jan Jansen
      </EntityLink>,
    );
    expect(screen.getByRole('link', { name: 'Jan Jansen' })).toHaveAttribute('href', '/kandidaten/abc');
  });

  it('valt terug op platte tekst zonder id', () => {
    wrap(
      <EntityLink type="candidate" id={null}>
        Jan Jansen
      </EntityLink>,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Jan Jansen')).toBeInTheDocument();
  });

  it('stopt propagatie zodat een klikbare rij niet ook navigeert', () => {
    const rowClick = vi.fn();
    wrap(
      <div onClick={rowClick}>
        <EntityLink type="company" id="c1">
          Acme BV
        </EntityLink>
      </div>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Acme BV' }));
    expect(rowClick).not.toHaveBeenCalled();
  });

  it('ondersteunt tab-deeplink', () => {
    wrap(
      <EntityLink type="company" id="c1" tab="plaatsingen">
        Acme BV
      </EntityLink>,
    );
    expect(screen.getByRole('link', { name: 'Acme BV' })).toHaveAttribute('href', '/opdrachtgevers/c1?tab=plaatsingen');
  });
});

describe('PhoneLink', () => {
  it('rendert een tel:-link en strips opmaak', () => {
    wrap(<PhoneLink phone="06 12 34 56 78" />);
    expect(screen.getByRole('link', { name: '06 12 34 56 78' })).toHaveAttribute('href', 'tel:0612345678');
  });

  it('toont een streepje wanneer leeg', () => {
    wrap(<PhoneLink phone={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
