import type { HoursIssue } from '../../supabase/functions/_shared/hours-calculation';
import type { WorkbookSheet } from '@/lib/hours-workbook';
import { readZipText } from '@/lib/hours-zip';

/**
 * The tables of a delivered Word file, in the shape the spreadsheet reader
 * already understands.
 *
 * A .docx is a zip whose `word/document.xml` describes the document; a table in
 * it is a grid of rows and cells, which is exactly what a worksheet is. Handing
 * those tables to the same reader means a Word delivery and an Excel delivery
 * are judged by one set of rules — the same header detection, the same duration
 * reading, the same refusal to guess at a name — instead of by two readers that
 * drift apart. A table is this format's page.
 *
 * Nothing in the document is executed. Fields, macros and linked content are
 * ignored; only the text that was saved in the file is read.
 */

const WORD_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DOCUMENT_ENTRY = 'word/document.xml';

export type DocxDecoding =
  | { ok: true; tables: WorkbookSheet[] }
  | { ok: false; issues: HoursIssue[] };

const blocked = (code: string, message: string): DocxDecoding => ({ ok: false, issues: [{ code, message }] });

/** An OLE compound document: the container of a pre-2007 binary .doc. */
export function isLegacyWordDocument(bytes: ArrayBuffer): boolean {
  const header = new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength));
  return header.length === 8 && [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
    .every((value, index) => header[index] === value);
}

/** Elements directly inside this one carrying the given WordprocessingML name. */
function childrenNamed(element: Element, local: string): Element[] {
  return Array.from(element.children).filter(child => child.localName === local);
}

function descendantsNamed(element: Element, local: string): Element[] {
  const byNamespace = element.getElementsByTagNameNS(WORD_NAMESPACE, local);
  if (byNamespace.length) return Array.from(byNamespace);
  return Array.from(element.getElementsByTagName('*')).filter(node => node.localName === local);
}

/** How wide this cell is; a merged header cell would otherwise shift every column after it. */
function gridSpan(cell: Element): number {
  const properties = childrenNamed(cell, 'tcPr')[0];
  const span = properties ? childrenNamed(properties, 'gridSpan')[0] : undefined;
  const value = span?.getAttributeNS(WORD_NAMESPACE, 'val') ?? span?.getAttribute('w:val');
  const parsed = value ? Number.parseInt(value, 10) : 1;
  return Number.isInteger(parsed) && parsed > 1 && parsed <= 64 ? parsed : 1;
}

/**
 * What one cell says. A cell may hold several paragraphs and a paragraph several
 * runs; a nested table belongs to that table and not to the cell around it, so
 * its text is left where it stands.
 */
function cellText(cell: Element): string {
  const parts: string[] = [];
  for (const paragraph of childrenNamed(cell, 'p')) {
    const text = descendantsNamed(paragraph, 't').map(node => node.textContent ?? '').join('').trim();
    if (text) parts.push(text);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function tableRows(table: Element): (string | null)[][] {
  return childrenNamed(table, 'tr').map(row => {
    const cells: (string | null)[] = [];
    for (const cell of childrenNamed(row, 'tc')) {
      cells.push(cellText(cell) || null);
      // A merged cell covers several grid columns. Repeating its text would
      // invent a second column with the same title; padding keeps every column
      // after it under the heading it actually belongs to.
      for (let extra = 1; extra < gridSpan(cell); extra += 1) cells.push(null);
    }
    return cells;
  });
}

/**
 * A table's name is the last piece of text above it, the way a delivered file
 * labels its own tables ("Week 37", "Kowalski"). Without one, its position has
 * to serve, so a message can still say which table it means.
 */
function tableName(table: Element, position: number): string {
  let previous = table.previousElementSibling;
  while (previous) {
    if (previous.localName === 'p') {
      const text = descendantsNamed(previous, 't').map(node => node.textContent ?? '').join('').trim();
      if (text) return text.replace(/\s+/g, ' ').slice(0, 100);
    }
    if (previous.localName === 'tbl') break;
    previous = previous.previousElementSibling;
  }
  return `tabel ${position}`;
}

/**
 * The tables of the document, in reading order. A table inside a cell belongs to
 * the table around it and is not offered a second time on its own.
 */
function topLevelTables(document: Document): Element[] {
  return descendantsNamed(document.documentElement, 'tbl').filter(table => !isNested(table));
}

function isNested(element: Element): boolean {
  let parent = element.parentElement;
  while (parent) {
    if (parent.localName === 'tbl') return true;
    parent = parent.parentElement;
  }
  return false;
}

export async function decodeWordDocument(bytes: ArrayBuffer): Promise<DocxDecoding> {
  if (isLegacyWordDocument(bytes)) {
    return blocked('LEGACY_WORD_DOCUMENT',
      'Dit is een oud binair Word-bestand. Sla het in Word op als .docx en lever het opnieuw aan, of leg de uren handmatig als voorstel vast.');
  }
  const xml = await readZipText(bytes, DOCUMENT_ENTRY);
  if (xml === null) {
    return blocked('UNREADABLE_WORD_DOCUMENT',
      'Dit bestand kon niet als Word-document worden gelezen. Er zijn geen voorstellen gemaakt; bewaar het als bron en leg de uren handmatig vast.');
  }
  const parsed = new DOMParser().parseFromString(xml, 'application/xml');
  if (parsed.getElementsByTagName('parsererror').length || !parsed.documentElement) {
    return blocked('UNREADABLE_WORD_DOCUMENT',
      'De inhoud van dit Word-document is niet te lezen. Er zijn geen voorstellen gemaakt.');
  }
  const tables = topLevelTables(parsed);
  if (!tables.length) {
    return blocked('NO_WORD_TABLE',
      'Dit Word-document bevat geen tabel met namen, dagen en uren. Losse tekst wordt hier niet uitgelezen; '
      + 'bewaar het als bron en leg de uren handmatig als voorstel vast.');
  }
  return {
    ok: true,
    tables: tables.map((table, index) => ({
      name: tableName(table, index + 1),
      rows: tableRows(table),
    })),
  };
}

/** How many tables the delivery had; a table is this format's page. */
export async function countWordTables(bytes: ArrayBuffer): Promise<number | null> {
  const decoding = await decodeWordDocument(bytes);
  return decoding.ok && decoding.tables.length ? decoding.tables.length : null;
}
