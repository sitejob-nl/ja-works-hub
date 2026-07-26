/**
 * Opruimen van AI-tekst die als markdown terugkomt.
 *
 * De vacaturegenerator vraagt om markdown voor de websitetekst, maar die tekst wordt op
 * veel plekken als platte tekst getoond: in een textarea, in het kandidatenportaal, in de
 * voorstelmail. Daar leest "## Wat ga je doen" en "**MIG-MAG**" als rommel — precies de
 * klacht "het lijkt net markdown wat eruit komt" (meeting 27-07).
 *
 * Twee richtingen:
 *   - `stripMarkdown()`  → leesbare platte tekst (koppen als gewone regel, bullets als •)
 *   - `markdownToBlocks()` → gestructureerde blokken zodat de UI echte koppen/lijsten rendert
 */

export type RichTextBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] };

/** Inline-opmaak (**vet**, *cursief*, `code`, [tekst](url)) → kale tekst. */
const stripInline = (line: string): string =>
  line
    // Links: hou de zichtbare tekst, gooi de URL weg.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // Vet/cursief in beide notaties. Langste marker eerst, anders blijft er een * achter.
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    .replace(/___(.+?)___/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[\s(])\*(?!\s)(.+?)(?<!\s)\*/g, '$1$2')
    .replace(/(^|[\s(])_(?!\s)(.+?)(?<!\s)_/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .trim();

const isHeading = (line: string) => /^#{1,6}\s+/.test(line);
const headingText = (line: string) => stripInline(line.replace(/^#{1,6}\s+/, '').replace(/\s*#+\s*$/, ''));
const isBullet = (line: string) => /^\s*([-*+•]|\d+[.)])\s+/.test(line);
const bulletText = (line: string) => stripInline(line.replace(/^\s*([-*+•]|\d+[.)])\s+/, ''));
const isRule = (line: string) => /^\s*([-*_])\1{2,}\s*$/.test(line);

/**
 * Markdown → blokken. Onbekende syntax wordt gewoon tekst; er gaat nooit inhoud verloren.
 */
export function markdownToBlocks(input: string | null | undefined): RichTextBlock[] {
  const text = (input ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) return [];

  const blocks: RichTextBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: 'paragraph', text: paragraph.join(' ').trim() });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      blocks.push({ type: 'list', items: list });
      list = [];
    }
  };
  const flushAll = () => { flushParagraph(); flushList(); };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();

    if (!line.trim() || isRule(line)) { flushAll(); continue; }

    if (isHeading(line)) {
      flushAll();
      const heading = headingText(line);
      if (heading) blocks.push({ type: 'heading', text: heading });
      continue;
    }

    if (isBullet(line)) {
      flushParagraph();
      const item = bulletText(line);
      if (item) list.push(item);
      continue;
    }

    flushList();
    paragraph.push(stripInline(line));
  }

  flushAll();
  return blocks;
}

/**
 * Markdown → leesbare platte tekst. Koppen worden een eigen regel, bullets krijgen "• ".
 * Bedoeld voor kopiëren, e-mail en elke plek die geen opmaak kan tonen.
 */
export function stripMarkdown(input: string | null | undefined): string {
  return markdownToBlocks(input)
    .map((block) => {
      if (block.type === 'heading') return block.text;
      if (block.type === 'list') return block.items.map((i) => `• ${i}`).join('\n');
      return block.text;
    })
    .join('\n\n')
    .trim();
}

/**
 * Markdown-resten uit een veld dat sowieso platte tekst hoort te zijn (titels, meta
 * description, kandidaatomschrijving). Houdt alles op één alinea-structuur maar verwijdert
 * de tekens. Onmisbaar omdat een taalmodel ook bij "geen markdown" nog wel eens **vet** doet.
 */
export function stripMarkdownInline(input: string | null | undefined): string {
  const text = (input ?? '').replace(/\r\n/g, '\n');
  if (!text.trim()) return '';
  return text
    .split('\n')
    .map((line) => {
      if (isHeading(line)) return headingText(line);
      if (isBullet(line)) return `• ${bulletText(line)}`;
      return stripInline(line);
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Bevat deze tekst nog markdown-syntax? Voor een waarschuwing in de UI. */
export function looksLikeMarkdown(input: string | null | undefined): boolean {
  const text = input ?? '';
  return /^#{1,6}\s+/m.test(text) || /\*\*[^*]+\*\*/.test(text) || /^\s*[*+]\s+/m.test(text);
}
