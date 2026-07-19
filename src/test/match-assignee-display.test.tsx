import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MatchRow from '@/components/matches/MatchRow';
import MatchAssigneeSelect from '@/components/matches/MatchAssigneeSelect';

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

const baseRow = {
  id: 'm1',
  status: 'nieuwe_match',
  candidate: { id: 'c1', first_name: 'Jan', last_name: 'Jansen' },
  vacancy: { id: 'v1', title: 'Orderpicker' },
};

describe('MatchRow — accountmanager-regel', () => {
  it('toont de naam wanneer er een accountmanager gekoppeld is', () => {
    wrap(<MatchRow {...baseRow} assignee={{ full_name: 'Bram de Vries', email: 'bram@jawerkt.nl' }} />);
    expect(screen.getByText('Bram de Vries')).toBeInTheDocument();
  });

  it('meldt "Geen accountmanager" wanneer de embed expliciet leeg is', () => {
    wrap(<MatchRow {...baseRow} assignee={null} />);
    expect(screen.getByText('Geen accountmanager')).toBeInTheDocument();
  });

  it('zwijgt wanneer de aanroeper de accountmanager niet heeft meegeladen', () => {
    // Regressie: eerder toonde elke rij zonder embed onterecht "Geen accountmanager".
    wrap(<MatchRow {...baseRow} />);
    expect(screen.queryByText('Geen accountmanager')).toBeNull();
  });
});

describe('MatchAssigneeSelect — toewijzing buiten de optielijst', () => {
  const options = [{ id: 'p1', full_name: 'Bram de Vries', email: 'bram@jawerkt.nl', role: 'intercedent' }];

  it('toont een gedeactiveerde collega alsnog als gekozen waarde', () => {
    wrap(
      <MatchAssigneeSelect
        value="p9"
        current={{ id: 'p9', full_name: 'Maria Peters', email: 'maria@jawerkt.nl' }}
        options={options}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Maria Peters (niet beschikbaar)')).toBeInTheDocument();
  });

  it('leest niet als "geen accountmanager" wanneer de naam onbekend is', () => {
    wrap(<MatchAssigneeSelect value="p9" options={options} onChange={vi.fn()} />);
    expect(screen.getByText('Onbekend (niet beschikbaar)')).toBeInTheDocument();
  });

  it('toont geen extra regel wanneer de toewijzing gewoon in de lijst staat', () => {
    wrap(<MatchAssigneeSelect value="p1" options={options} onChange={vi.fn()} />);
    expect(screen.queryByText(/niet beschikbaar/)).toBeNull();
  });
});
