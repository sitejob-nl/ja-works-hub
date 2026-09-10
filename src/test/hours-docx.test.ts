import { describe, expect, it } from 'vitest';
import { decodeWordDocument, countWordTables } from '@/lib/hours-docx';
import { readHoursWorkbook, type WorkbookContext } from '@/lib/hours-workbook';

/**
 * A Word delivery reaches the same reader as a spreadsheet, so the proof here is
 * twofold: the tables come out of the file in the shape that reader expects, and
 * a file it cannot read ends in a blockade rather than in half a reading.
 */

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (text: string, span = 1) =>
  `<w:tc>${span > 1 ? `<w:tcPr><w:gridSpan w:val="${span}"/></w:tcPr>` : ''}${paragraph(text)}</w:tc>`;
const row = (cells: string[]) => `<w:tr>${cells.join('')}</w:tr>`;
const table = (rows: string[][]) => `<w:tbl>${rows.map(cells => row(cells.map(text => cell(text)))).join('')}</w:tbl>`;
const document = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;

/** A zip with one stored entry: enough of the container for this reader to walk. */
function zipWith(name: string, contents: string): ArrayBuffer {
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(name);
  const data = encoder.encode(contents);
  const local = new Uint8Array(30 + nameBytes.length + data.length);
  const localView = new DataView(local.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint32(18, data.length, true);
  localView.setUint32(22, data.length, true);
  localView.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  local.set(data, 30 + nameBytes.length);

  const central = new Uint8Array(46 + nameBytes.length);
  const centralView = new DataView(central.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint32(20, data.length, true);
  centralView.setUint32(24, data.length, true);
  centralView.setUint16(28, nameBytes.length, true);
  centralView.setUint32(42, 0, true);
  central.set(nameBytes, 46);

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, 1, true);
  endView.setUint16(10, 1, true);
  endView.setUint32(12, central.length, true);
  endView.setUint32(16, local.length, true);

  const all = new Uint8Array(local.length + central.length + end.length);
  all.set(local, 0);
  all.set(central, local.length);
  all.set(end, local.length + central.length);
  return all.buffer;
}

const wordFile = (body: string) => zipWith('word/document.xml', document(body));

const OLE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]).buffer;

const context: WorkbookContext = {
  members: [{ id: 'm1', name: 'Jan Kowalski' }],
  days: ['07', '08', '09'].map((day, index) => ({
    id: `day-${index}`, memberId: 'm1', workDate: `2026-09-${day}`,
  })),
};

describe('reading a delivered Word file', () => {
  it('hands its tables to the spreadsheet reader in the shape it expects', async () => {
    const decoding = await decodeWordDocument(wordFile(
      paragraph('Week 37') + table([
        ['Naam', '2026-09-07', '2026-09-08'],
        ['Jan Kowalski', '8', '8,5'],
      ])));

    expect(decoding.ok).toBe(true);
    if (decoding.ok === false) return;
    expect(decoding.tables).toHaveLength(1);
    expect(decoding.tables[0].name, 'the text above a table is what it is called').toBe('Week 37');

    const reading = readHoursWorkbook(decoding.tables, context, { sheetNoun: 'tabel', sourceKind: 'document' });
    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.sourceKind).toBe('document');
    expect(reading.candidates.map(candidate => candidate.minutes)).toEqual([480, 510]);
    expect(reading.candidates[0].pageLabel).toBe('tabel Week 37 · rij 2');
  });

  it('keeps a merged heading cell from shifting every column after it', async () => {
    const decoding = await decodeWordDocument(wordFile(`<w:tbl>${
      row([cell('Weekoverzicht', 3)])
    }${row([cell('Naam'), cell('2026-09-07'), cell('2026-09-08')])
    }${row([cell('Jan Kowalski'), cell('8'), cell('8,5')])}</w:tbl>`));

    expect(decoding.ok).toBe(true);
    if (decoding.ok === false) return;
    expect(decoding.tables[0].rows[0]).toEqual(['Weekoverzicht', null, null]);

    const reading = readHoursWorkbook(decoding.tables, context, { sheetNoun: 'tabel', sourceKind: 'document' });
    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates.map(candidate => candidate.workDate)).toEqual(['2026-09-07', '2026-09-08']);
  });

  it('offers a nested table once, as part of the table around it', async () => {
    const inner = `<w:tbl>${row([cell('binnenin')])}</w:tbl>`;
    const decoding = await decodeWordDocument(wordFile(
      `<w:tbl>${row([`<w:tc>${inner}</w:tc>`, cell('naast')])}</w:tbl>`));

    expect(decoding.ok).toBe(true);
    if (decoding.ok === false) return;
    expect(decoding.tables).toHaveLength(1);
  });

  it('counts its tables, because a table is this format\'s page', async () => {
    const file = wordFile(table([['a']]) + paragraph('tussen') + table([['b']]));
    expect(await countWordTables(file)).toBe(2);
  });

  it('blocks an old binary .doc rather than guessing at its text', async () => {
    const decoding = await decodeWordDocument(OLE);

    expect(decoding.ok).toBe(false);
    if (decoding.ok === true) return;
    expect(decoding.issues[0].code).toBe('LEGACY_WORD_DOCUMENT');
    expect(decoding.issues[0].message).toContain('.docx');
    expect(await countWordTables(OLE)).toBeNull();
  });

  it('blocks a Word file that carries no table at all', async () => {
    const decoding = await decodeWordDocument(wordFile(paragraph('Jan werkte maandag 8 uur.')));

    expect(decoding.ok).toBe(false);
    if (decoding.ok === true) return;
    expect(decoding.issues[0].code).toBe('NO_WORD_TABLE');
  });

  it('blocks a file that is not a Word document at all', async () => {
    const decoding = await decodeWordDocument(zipWith('other.txt', 'niets'));

    expect(decoding.ok).toBe(false);
    if (decoding.ok === true) return;
    expect(decoding.issues[0].code).toBe('UNREADABLE_WORD_DOCUMENT');
  });
});
