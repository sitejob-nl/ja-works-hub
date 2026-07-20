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
    expect(parseYearRange('2018 - 2020')).toEqual({ start: 2018, end: 2020, known: true });
    expect(parseYearRange('jan 2019 - mrt 2021')).toEqual({ start: 2019, end: 2021, known: true });
  });

  it('mapt een lopend dienstverband op het huidige jaar', () => {
    expect(parseYearRange('2022 - heden')).toEqual({ start: 2022, end: CURRENT_YEAR, known: true });
  });

  it('markeert een periode zonder jaartal als onbekend', () => {
    expect(parseYearRange('een paar jaar').known).toBe(false);
    expect(parseYearRange(undefined).known).toBe(false);
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

  it('zet een dienstverband zonder leesbare periode onderaan, niet bovenaan', () => {
    const rows = buildTimelineRows(
      [{ functie: 'Losse klus', bedrijf: 'Onbekend' }, ...werkgevers],
      [],
    );
    expect(rows[rows.length - 1].title).toBe('Losse klus');
    expect(rows[0].title).toBe('Heftruckchauffeur');
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

  it('geeft de overzichtsbalk een tekstalternatief met werkgevers en gaten', () => {
    render(<WorkHistoryTimeline werkgevers={werkgevers} gaten={gaten} showDetails={false} />);

    const label = screen.getByRole('img').getAttribute('aria-label') ?? '';
    expect(label).toContain('Heftruckchauffeur: Van Dijk Logistiek · 2022 - heden');
    expect(label).toContain('Gat in werkhistorie: 2020 - 2022');
    expect(label).toContain('Productiemedewerker: Acme Food · 2018 - 2020');
  });

  it('houdt een balk uit het lopende jaar binnen de as', () => {
    render(
      <WorkHistoryTimeline
        werkgevers={[
          { functie: 'Starter', bedrijf: 'Nieuw', periode: `${CURRENT_YEAR}`, duur_maanden: 3 },
          { functie: 'Oud', bedrijf: 'Vorig', periode: '2015 - 2018', duur_maanden: 36 },
        ]}
        gaten={[]}
        showDetails={false}
      />,
    );

    // left mag nooit op 100% staan: de container heeft overflow-hidden, de balk
    // zou dan onzichtbaar buiten beeld vallen.
    const bar = screen.getByRole('img').querySelector('div') as HTMLElement;
    expect(parseFloat(bar.style.left)).toBeLessThan(100);
    expect(parseFloat(bar.style.left) + parseFloat(bar.style.width)).toBeCloseTo(100, 5);
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

describe('WorkHistoryTimeline — kleurlegenda', () => {
  it('legt uit waarvoor de kleur staat zodra er meerdere banden in beeld zijn', () => {
    // Tomasz-scenario: drie dienstverbanden van 2+ jaar (allemaal groen) plus één
    // van 1j7m (blauw). Zonder legenda leest dat als "waarom drie dezelfde kleuren?".
    render(<WorkHistoryTimeline werkgevers={werkgevers} gaten={gaten} />);
    expect(screen.getByText(/Kleur = hoe lang bij één werkgever/)).toBeInTheDocument();
  });

  it('toont alleen de banden die echt voorkomen', () => {
    // Eén werkgever van ruim 2 jaar en geen gaten: een legenda voegt niets toe.
    render(<WorkHistoryTimeline werkgevers={[{ functie: 'Lasser', bedrijf: 'Solo BV', periode: '2019 - 2024', duur_maanden: 60 }]} gaten={[]} />);
    expect(screen.queryByText(/Kleur = hoe lang bij één werkgever/)).not.toBeInTheDocument();
  });

  it('benoemt gaten apart in de legenda', () => {
    render(<WorkHistoryTimeline werkgevers={werkgevers} gaten={gaten} />);
    expect(screen.getByText('gat tussen banen')).toBeInTheDocument();
  });
});
