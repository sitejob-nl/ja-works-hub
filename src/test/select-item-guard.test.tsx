import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Radix gooit een harde Error op `<SelectItem value="" />`. Die crash haalde drie keer
// de huisvestingspagina onderuit (Sentry JA-WERKT-3) omdat een lege optie uit data kwam.
// Deze test pint vast dat één kapotte optie de rest van de lijst niet meer meesleurt.

const openList = () => {
  // Radix rendert items pas als het menu open is; `defaultOpen` volstaat in jsdom.
  render(
    <Select defaultOpen>
      <SelectTrigger><SelectValue placeholder="Kies" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="">Lege optie</SelectItem>
        <SelectItem value="ok">Goede optie</SelectItem>
      </SelectContent>
    </Select>,
  );
};

describe('SelectItem-vangnet', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('rendert de geldige opties en slaat de lege over, zonder te crashen', () => {
    expect(() => openList()).not.toThrow();
    expect(screen.getByText('Goede optie')).toBeInTheDocument();
    expect(screen.queryByText('Lege optie')).not.toBeInTheDocument();
  });

  it('waarschuwt in de console over de overgeslagen optie', () => {
    openList();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Lege optie'));
  });
});
