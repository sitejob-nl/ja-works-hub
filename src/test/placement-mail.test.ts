import { describe, it, expect } from 'vitest';
import {
  generalTermsSection,
  mergeTemplateText,
  parseTemplateBlocks,
  renderTemplateBody,
} from '../../supabase/functions/_shared/placement-mail.ts';

const theme = { navyHex: '#0C4D78', textHex: '#334155' } as any;

describe('mergeTemplateText', () => {
  it('vult bekende variabelen zonder te escapen (platte tekst, bewerkbaar)', () => {
    expect(mergeTemplateText('Beste {{contact_name}}', { contact_name: 'Bax & Zn' })).toBe('Beste Bax & Zn');
  });

  it('laat onbekende variabelen ongemoeid staan', () => {
    expect(mergeTemplateText('Hoi {{onbekend}}', { naam: 'x' })).toBe('Hoi {{onbekend}}');
  });

  it('vervangt null door lege tekst', () => {
    expect(mergeTemplateText('Tarief: {{rate}}', { rate: null })).toBe('Tarief: ');
  });
});

describe('parseTemplateBlocks', () => {
  it('maakt een tabel van opeenvolgende label-regels', () => {
    const blocks = parseTemplateBlocks('Functie: Lasser\nStartdatum: maandag 10 augustus 2026');
    expect(blocks).toEqual([
      {
        kind: 'table',
        rows: [
          { label: 'Functie', value: 'Lasser' },
          { label: 'Startdatum', value: 'maandag 10 augustus 2026' },
        ],
      },
    ]);
  });

  it('laat lege waarden weg — geen "Uurtarief:" zonder bedrag in de klantmail', () => {
    const blocks = parseTemplateBlocks('Functie: Lasser\nUurtarief: \nEinddatum: —');
    expect(blocks).toEqual([{ kind: 'table', rows: [{ label: 'Functie', value: 'Lasser' }] }]);
  });

  it('maakt géén tabel van één losse zin met dubbele punt', () => {
    const blocks = parseTemplateBlocks('Let op: neem een geldig ID mee.');
    expect(blocks).toEqual([{ kind: 'paragraph', lines: ['Let op: neem een geldig ID mee.'] }]);
  });

  it('scheidt alinea, tabel en afsluiting', () => {
    const blocks = parseTemplateBlocks(
      'Beste Mathijs,\n\nFunctie: Lasser\nOpdrachtgever: Bax Metaal\n\nMet vriendelijke groet,\nJA Werkt',
    );
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'table', 'paragraph']);
    expect(blocks[2]).toEqual({ kind: 'paragraph', lines: ['Met vriendelijke groet,', 'JA Werkt'] });
  });

  it('behandelt een lege template als leeg', () => {
    expect(parseTemplateBlocks('')).toEqual([]);
  });
});

describe('renderTemplateBody', () => {
  it('escapet gebruikersinhoud, ook in tabelwaarden', () => {
    const html = renderTemplateBody('Functie: <script>x</script>\nBedrijf: Bax & Zn', theme);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Bax &amp; Zn');
  });

  it('rendert een tabel in plaats van platte pre-wrap tekst', () => {
    const html = renderTemplateBody('Functie: Lasser\nStartdatum: morgen', theme);
    expect(html).toContain('<table');
    expect(html).toContain('Functie');
    expect(html).toContain('Lasser');
  });
});

describe('generalTermsSection', () => {
  it('rendert niets als er geen voorwaarden zijn', () => {
    expect(generalTermsSection('')).toBe('');
  });

  it('toont de gemergede tekst, niet de ruwe placeholder', () => {
    const merged = mergeTemplateText('Voorwaarden van {{organization_name}}.', { organization_name: 'JA Werkt' });
    const html = generalTermsSection(merged);
    expect(html).toContain('Voorwaarden van JA Werkt.');
    expect(html).not.toContain('{{organization_name}}');
  });
});
