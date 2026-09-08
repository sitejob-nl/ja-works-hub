import { describe, expect, it } from 'vitest';
import { decodeWorkbook, workbookBytesError, workbookContentType } from '@/lib/hours-workbook-file';
import { buildLegacyXlsFile, buildWorkbookFile, formatted, formula, text } from './support/xlsx-workbook';

describe('decoding a delivered spreadsheet', () => {
  it('reads every worksheet with its name and cells', async () => {
    const decoding = await decodeWorkbook(buildWorkbookFile([
      { name: 'Week 37', rows: [[text('Naam'), text('Datum')], [text('Jan Kowalski'), text('07-09-2026')]] },
      { name: 'Toelichting', rows: [[text('Vragen? Bel het kantoor.')]] },
    ]));

    expect(decoding.ok).toBe(true);
    if (decoding.ok === false) return;
    expect(decoding.sheets.map(sheet => sheet.name)).toEqual(['Week 37', 'Toelichting']);
    expect(decoding.sheets[0].rows[1]).toEqual(['Jan Kowalski', '07-09-2026']);
  });

  it('reads the stored result of a formula instead of calculating it', async () => {
    // The stored result deliberately disagrees with the expression: a reader
    // that calculated would produce 9, one that reads what was saved gives 7.
    const decoding = await decodeWorkbook(buildWorkbookFile([
      { name: 'Week 37', rows: [[text('Totaal')], [formula('4+5', '7')]] },
    ]));

    expect(decoding.ok).toBe(true);
    if (decoding.ok === false) return;
    expect(decoding.sheets[0].rows[1]).toEqual([7]);
  });

  it('reads a workbook that carries macros without running them', async () => {
    const decoding = await decodeWorkbook(buildWorkbookFile(
      [{ name: 'Week 37', rows: [[text('Naam')], [text('Jan Kowalski')]] }], { macros: true }));

    expect(decoding.ok).toBe(true);
    if (decoding.ok === false) return;
    expect(decoding.sheets[0].rows[1]).toEqual(['Jan Kowalski']);
  });

  it('blocks a legacy binary Excel file with a message that says what to do', async () => {
    const decoding = await decodeWorkbook(buildLegacyXlsFile());

    expect(decoding.ok).toBe(false);
    if (decoding.ok !== false) return;
    expect(decoding.issues[0].code).toBe('LEGACY_WORKBOOK');
    expect(decoding.issues[0].message).toMatch(/\.xlsx/);
  });

  it('blocks a file that is not a spreadsheet at all', async () => {
    const decoding = await decodeWorkbook(new TextEncoder().encode('dit is gewoon tekst').buffer as ArrayBuffer);

    expect(decoding.ok).toBe(false);
    if (decoding.ok !== false) return;
    expect(decoding.issues[0].code).toBe('UNREADABLE_WORKBOOK');
  });
});

describe('how a spreadsheet stores a duration', () => {
  it('keeps a clock-formatted cell a duration and leaves an elapsed-time cell a bare number', async () => {
    const decoding = await decodeWorkbook(buildWorkbookFile([{ name: 'Week 37', rows: [
      [text('Klok'), text('Verstreken')],
      [formatted('0.5', 'h:mm'), formatted('0.5', '[h]:mm')],
    ] }]));

    expect(decoding.ok).toBe(true);
    if (decoding.ok === false) return;
    const [clock, elapsed] = decoding.sheets[0].rows[1];
    // Half a day: the clock format arrives as a time, the elapsed format as a raw fraction.
    expect(clock).toBeInstanceOf(Date);
    expect((clock as Date).getTime() - Date.UTC(1899, 11, 30)).toBe(12 * 60 * 60 * 1000);
    expect(elapsed).toBe(0.5);
  });
});

describe('what may be stored as a workbook at all', () => {
  it('refuses a file that is not a workbook, whatever its media type claims', () => {
    const csv = new TextEncoder().encode('naam;datum;uren\nJan;07-09-2026;8\n').buffer as ArrayBuffer;
    expect(workbookBytesError(csv)).toMatch(/geen Excel-werkmap/i);
  });

  it('accepts the two real workbook containers', () => {
    expect(workbookBytesError(buildWorkbookFile([{ name: 'Week 37', rows: [[text('Naam')]] }]))).toBeNull();
    expect(workbookBytesError(buildLegacyXlsFile())).toBeNull();
  });
});

describe('what the bytes say the file really is', () => {
  it('stores a workbook by what it is, not by what the browser called it', () => {
    const xlsx = buildWorkbookFile([{ name: 'Week 37', rows: [[text('Naam')]] }]);
    // Windows hands an .xlsx over as the legacy media type often enough.
    expect(workbookContentType('application/vnd.ms-excel', xlsx))
      .toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(workbookContentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xlsx))
      .toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(workbookContentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buildLegacyXlsFile()))
      .toBe('application/vnd.ms-excel');
  });
});
