import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import WorkHistoryTimeline from '@/components/candidates/WorkHistoryTimeline';
import { buildTickYears, buildTimelineRows, parseYearRange } from '@/lib/work-history';

const CURRENT_YEAR = new Date().getFullYear();

const werkgevers = [
  { functie: 'Heftruckchauffeur', bedrijf: 'Van Dijk Logistiek', periode: '2022 - heden', duur_maanden: 38 },
  { functie: 'Productiemedewerker', bedrijf: 'Acme Food', periode: '2018 - 2020', duur_maanden: 26 },
];

const gaten = [
  { periode: '2020 - 2022', duur_maanden: 18, mogelijke_verklaring: 'Terug naar Polen' },
];

describe('parseYearRange', () => {
  it('leest begin- en eindjaar uit een periode', () => {
    expect(parseYearRange('2018 - 2020')).toEqual({ start: 2018, end: 2020 });
    expect(parseYearRange('jan 2019 - mrt 2021')).toEqual({ start: 2019, end: 2021 });
  });

  it('mapt een lopend dienstverband op het huidige jaar', () => {
    expect(parseYearRange('2022 - heden')).toEqual({ start: 2022, end: CURRENT_YEAR });
  });

  it('laat de tijdlijn nooit in de toekomst doorlopen', () => {
    const { start, end } = parseYearRange(`${CURRENT_YEAR + 3} - ${CURRENT_YEAR + 5}`);
    expect(start).toBe(CURRENT_YEAR);
    expect(end).toBe(CURRENT_YEAR);
  });
});

describe('buildTickYears', () => {
  it('begint op het beginjaar en eindigt op het eindjaar', () => {
    const ticks = buildTickYears(2010, 2026, 6);
    expect(ticks[0]).toBe(2010);
    expect(ticks[ticks.length - 1]).toBe(2026);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
  });

  it('geeft één label bij een periode binnen hetzelfde jaar', () => {
    expect(buildTickYears(2026, 2026, 6)).toEqual([2026]);
  });
});

describe('buildTimelineRows', () => {
  it('zet werk en gaten in één reeks, nieuwste eerst', () => {
    const rows = buildTimelineRows(werkgevers, gaten);
    expect(rows.map((r) => r.kind)).toEqual(['werk', 'gat', 'werk']);
    expect(rows[0].meta).toBe('Van Dijk Logistiek · 2022 - heden');
    expect(rows[1].note).toBe('Terug naar Polen');
  });

  it('valt terug op leesbare tekst bij ontbrekende velden', () => {
    const [row] = buildTimelineRows([{ duur_maanden: 0 }], []);
    expect(row.title).toBe('Functie onbekend');
    expect(row.meta).toBe('Werkgever onbekend · Periode onbekend');
    expect(row.months).toBeNull();
  });
});

describe('WorkHistoryTimeline', () => {
  it('toont functie, werkgever, periode en duur precies één keer per dienstverband', () => {
    render(<WorkHistoryTimeline werkgevers={werkgevers} gaten={gaten} />);

    expect(screen.getAllByText('Heftruckchauffeur')).toHaveLength(1);
    expect(screen.getAllByText('Van Dijk Logistiek · 2022 - heden')).toHaveLength(1);
    expect(screen.getAllByText('Productiemedewerker')).toHaveLength(1);
    expect(screen.getAllByText('Acme Food · 2018 - 2020')).toHaveLength(1);
    // 26 maanden -> "2j 2m", 38 maanden -> "3j 2m"
    expect(screen.getAllByText('2j 2m')).toHaveLength(1);
  });

  it('zet gaten als eigen regel tussen de dienstverbanden, met verklaring', () => {
    render(<WorkHistoryTimeline werkgevers={werkgevers} gaten={gaten} />);

    expect(screen.getByText('Gat in werkhistorie')).toBeInTheDocument();
    expect(screen.getByText('2020 - 2022')).toBeInTheDocument();
    expect(screen.getByText('Terug naar Polen')).toBeInTheDocument();
  });

  it('sorteert nieuwste periode bovenaan', () => {
    render(<WorkHistoryTimeline werkgevers={werkgevers} gaten={gaten} />);

    const titles = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(titles[0]).toContain('Heftruckchauffeur');
    expect(titles[1]).toContain('Gat in werkhistorie');
    expect(titles[2]).toContain('Productiemedewerker');
  });

  it('houdt de details weg wanneer het scherm ze zelf al toont', () => {
    render(<WorkHistoryTimeline werkgevers={werkgevers} gaten={gaten} showDetails={false} />);

    expect(screen.queryByText('Heftruckchauffeur')).toBeNull();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('beperkt compact tot drie regels en meldt de rest', () => {
    const veel = [
      ...werkgevers,
      { functie: 'Orderpicker', bedrijf: 'Bol', periode: '2016 - 2018', duur_maanden: 20 },
      { functie: 'Magazijnmedewerker', bedrijf: 'Jumbo', periode: '2014 - 2016', duur_maanden: 22 },
    ];
    render(<WorkHistoryTimeline werkgevers={veel} gaten={gaten} compact />);

    // 3 regels + de "+n eerdere periodes"-regel
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText('+2 eerdere periodes')).toBeInTheDocument();
  });

  it('rendert niets zonder werkgevers', () => {
    const { container } = render(<WorkHistoryTimeline werkgevers={[]} gaten={gaten} />);
    expect(container).toBeEmptyDOMElement();
  });
});
