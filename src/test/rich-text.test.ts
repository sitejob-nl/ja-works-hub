import { describe, expect, it } from 'vitest';
import {
  markdownToBlocks,
  stripMarkdown,
  stripMarkdownInline,
  looksLikeMarkdown,
  splitGeneratedVacancyDescription,
} from '@/lib/rich-text';

// Verkorte versie van wat er in productie in `vacancies.description` staat bij de 26
// vacatures die vóór de SEO-tab zijn gemaakt.
const LEGACY_DUMP = `## Volledige SEO-vacaturetekst
Productiemedewerker Food - Helmond | Fulltime werk in dagdienst

Als Productiemedewerker Food in Helmond sta jij niet stil.

## AI matchingprofiel op basis van de vacature
Ideale kandidaat

Een fysiek fitte productiemedewerker.

## Zoekwoorden voor vacaturebanken en AI matching
Food, productie, Helmond

Eindcontrole

De opdrachtgever wordt nergens genoemd`;

const SAMPLE = `## Wat ga je doen als MIG-MAG lasser?

Je werkt aan **stalen constructies** in een moderne werkplaats.

- Lassen volgens tekening
- Werken met *dun plaatwerk*
* Slijpen en afwerken

### Wat bieden we jou?
Een uurloon van €18,50 en [meer info](https://voorbeeld.nl).`;

describe('markdownToBlocks', () => {
  it('herkent koppen, alinea\'s en lijsten', () => {
    const blocks = markdownToBlocks(SAMPLE);
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'heading', 'paragraph']);
    expect(blocks[0]).toEqual({ type: 'heading', text: 'Wat ga je doen als MIG-MAG lasser?' });
    expect(blocks[2]).toEqual({
      type: 'list',
      items: ['Lassen volgens tekening', 'Werken met dun plaatwerk', 'Slijpen en afwerken'],
    });
  });

  it('geeft een lege lijst bij lege invoer', () => {
    expect(markdownToBlocks('')).toEqual([]);
    expect(markdownToBlocks(null)).toEqual([]);
  });
});

describe('stripMarkdown', () => {
  it('laat geen # of * achter', () => {
    const out = stripMarkdown(SAMPLE);
    expect(out).not.toMatch(/[#*_`]/);
    expect(out).toContain('Wat ga je doen als MIG-MAG lasser?');
    expect(out).toContain('• Lassen volgens tekening');
    expect(out).toContain('stalen constructies');
  });

  it('houdt de linktekst en gooit de URL weg', () => {
    expect(stripMarkdown('Zie [onze site](https://voorbeeld.nl) voor meer.')).toBe('Zie onze site voor meer.');
  });

  it('raakt gewone tekst met een sterretje in een woord niet aan', () => {
    expect(stripMarkdown('Werken met 3*4 mm plaat')).toBe('Werken met 3*4 mm plaat');
  });
});

describe('stripMarkdownInline', () => {
  it('haalt opmaaktekens weg zonder de regelindeling te verliezen', () => {
    expect(stripMarkdownInline('**MIG-MAG lasser** in Helmond')).toBe('MIG-MAG lasser in Helmond');
    expect(stripMarkdownInline('# Titel\nTweede regel')).toBe('Titel\nTweede regel');
  });

  it('is leeg bij lege invoer', () => {
    expect(stripMarkdownInline(null)).toBe('');
    expect(stripMarkdownInline('   ')).toBe('');
  });
});

describe('splitGeneratedVacancyDescription', () => {
  it('scheidt de vacaturetekst van het interne materiaal', () => {
    const out = splitGeneratedVacancyDescription(LEGACY_DUMP);
    expect(out.isGenerated).toBe(true);
    expect(out.candidateText).toContain('Productiemedewerker Food - Helmond');
    expect(out.candidateText).toContain('sta jij niet stil');
    // Alles wat intern is mag hier absoluut niet in zitten.
    expect(out.candidateText).not.toContain('matchingprofiel');
    expect(out.candidateText).not.toContain('Zoekwoorden');
    expect(out.candidateText).not.toContain('Eindcontrole');
    expect(out.internalText).toContain('AI matchingprofiel');
    expect(out.internalText).toContain('Eindcontrole');
  });

  it('laat een gewone korte omschrijving met rust', () => {
    const out = splitGeneratedVacancyDescription('Lasser gezocht voor dagdienst in Helmond.');
    expect(out.isGenerated).toBe(false);
    expect(out.candidateText).toBe('Lasser gezocht voor dagdienst in Helmond.');
    expect(out.internalText).toBe('');
  });

  it('is leeg bij lege invoer', () => {
    expect(splitGeneratedVacancyDescription(null)).toEqual({
      isGenerated: false, candidateText: '', internalText: '',
    });
  });
});

describe('looksLikeMarkdown', () => {
  it('herkent markdown-syntax', () => {
    expect(looksLikeMarkdown('## Kop')).toBe(true);
    expect(looksLikeMarkdown('Dit is **vet**')).toBe(true);
    expect(looksLikeMarkdown('* bullet')).toBe(true);
  });

  it('geeft false op schone tekst', () => {
    expect(looksLikeMarkdown('Gewone zin zonder opmaak.')).toBe(false);
    expect(looksLikeMarkdown('')).toBe(false);
  });
});
