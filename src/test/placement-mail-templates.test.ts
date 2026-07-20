import { describe, it, expect } from 'vitest';
import {
  mergeTemplateText,
  parseTemplateBlocks,
  renderTemplateBody,
} from '../../supabase/functions/_shared/placement-mail.ts';

const theme = { navyHex: '#0C4D78', textHex: '#334155' } as any;

// De teksten zoals ze op productie in contract_templates staan (JA Werkt).
// Deze fixture is er om te bewaken dat de échte templates goed renderen — niet
// alleen de parser in het algemeen.
const CLIENT_TEMPLATE = `Beste {{contact_name}},

Hierbij bevestigen wij de plaatsing van {{employee_name}} bij {{company_name}}.

Medewerker: {{employee_name}}
Vacature: {{vacancy_title}}
Functie: {{function_name}}
Startdatum: {{start_date}}
Verwachte einddatum: {{expected_end_date}}
Werklocatie: {{work_location}}
Werkdagen: {{work_days}}
Uurtarief: {{client_hourly_rate}}

Contactgegevens medewerker: {{candidate_phone}}

Heeft u vragen over deze plaatsing of over de urenregistratie, neem dan gerust contact met ons op.

Met vriendelijke groet,
{{organization_name}}`;

/** Waarden zoals de plaatsing van 17-07 op productie (Ariel Kęsicki / Bax Metaal). */
const vars = {
  contact_name: 'Mathijs Kox',
  employee_name: 'Ariel Kęsicki',
  company_name: 'Bax Metaal B.V.',
  // Leeg omdat de vacaturetitel gelijk is aan de functienaam (plaatsing vanuit match).
  vacancy_title: '',
  function_name: 'Samensteller & Lasser TIG RVS',
  start_date: 'maandag 10 augustus 2026',
  expected_end_date: '—',
  work_location: 'Nader te bepalen',
  work_days: 'ma, di, wo, do, vr',
  client_hourly_rate: '',
  candidate_phone: '',
  organization_name: 'JA Werkt',
};

describe('productie-template opdrachtgever', () => {
  const text = mergeTemplateText(CLIENT_TEMPLATE, vars);
  const blocks = parseTemplateBlocks(text);
  const table = blocks.find((b) => b.kind === 'table') as any;
  const labels = table.rows.map((r: any) => r.label);

  it('laat geen onvervangen placeholders achter', () => {
    expect(text).not.toMatch(/\{\{|\}\}/);
  });

  it('noemt de kandidaat bij naam', () => {
    expect(text).toContain('Ariel Kęsicki');
    expect(labels).toContain('Medewerker');
  });

  it('rendert de gegevens als tabel, niet als platte regels', () => {
    expect(table).toBeDefined();
    expect(labels).toEqual(['Medewerker', 'Functie', 'Startdatum', 'Werklocatie', 'Werkdagen']);
  });

  it('laat lege en onbekende waarden weg in plaats van een halve regel', () => {
    // Geen tarief, geen einddatum, geen telefoonnummer, vacature == functie.
    expect(labels).not.toContain('Uurtarief');
    expect(labels).not.toContain('Verwachte einddatum');
    expect(labels).not.toContain('Vacature');
    expect(renderTemplateBody(text, theme)).not.toContain('Contactgegevens medewerker:');
  });

  it('toont de vacature wél als die afwijkt van de functienaam', () => {
    const afwijkend = mergeTemplateText(CLIENT_TEMPLATE, { ...vars, vacancy_title: 'Productiemedewerker verwerking' });
    const rows = (parseTemplateBlocks(afwijkend).find((b) => b.kind === 'table') as any).rows;
    expect(rows.map((r: any) => r.label)).toContain('Vacature');
  });

  it('houdt aanhef en afsluiting als alinea, niet als tabelregel', () => {
    expect(blocks[0]).toEqual({ kind: 'paragraph', lines: expect.arrayContaining(['Beste Mathijs Kox,']) });
    const last = blocks[blocks.length - 1] as any;
    expect(last.kind).toBe('paragraph');
    expect(last.lines).toContain('JA Werkt');
  });
});
