import type { HoursIssue } from '../../supabase/functions/_shared/hours-calculation';
import type { WorkbookCell, WorkbookSheet } from '@/lib/hours-workbook';

/** Spreadsheet media types accepted as a delivered source. */
export const HOURS_WORKBOOK_TYPES = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { extension: 'xlsx', label: 'Excel' },
  'application/vnd.ms-excel': { extension: 'xls', label: 'Excel' },
} as const;
export type HoursWorkbookContentType = keyof typeof HOURS_WORKBOOK_TYPES;

export function isWorkbookSource(contentType: string): contentType is HoursWorkbookContentType {
  return contentType in HOURS_WORKBOOK_TYPES;
}

export type WorkbookDecoding =
  | { ok: true; sheets: WorkbookSheet[] }
  | { ok: false; issues: HoursIssue[] };

const blocked = (code: string, message: string): WorkbookDecoding => ({ ok: false, issues: [{ code, message }] });

/** An OLE compound document: the container of a pre-2007 binary .xls. */
function isLegacyWorkbook(bytes: ArrayBuffer): boolean {
  const header = new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength));
  return header.length === 8 && [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
    .every((value, index) => header[index] === value);
}

/**
 * Reads the worksheets exactly as they were saved. Formulas keep their stored
 * result and macros are never executed: this only unpacks the archive and parses
 * the sheet XML. The reviewer still sees the original file before anything is
 * applied, so this is a convenience, not a trust boundary.
 */
export async function decodeWorkbook(bytes: ArrayBuffer): Promise<WorkbookDecoding> {
  if (isLegacyWorkbook(bytes)) {
    return blocked('LEGACY_WORKBOOK',
      'Dit is een oud binair Excel-bestand. Sla het in Excel op als .xlsx en lever het opnieuw aan, of leg de uren handmatig als voorstel vast.');
  }
  try {
    const readWorkbook = (await import('read-excel-file/browser')).default;
    const sheets = await readWorkbook(bytes);
    return {
      ok: true,
      sheets: sheets.map(sheet => ({
        name: String(sheet.sheet),
        rows: (sheet.data ?? []).map(row => row.map(cell => cell as WorkbookCell)),
      })),
    };
  } catch {
    return blocked('UNREADABLE_WORKBOOK',
      'Dit bestand kon niet als werkmap worden gelezen. Er zijn geen voorstellen gemaakt; bewaar het als bron en leg de uren handmatig vast.');
  }
}

/** How many worksheets the delivery had; a worksheet is this format's page. */
export async function countWorkbookSheets(bytes: ArrayBuffer): Promise<number | null> {
  const decoding = await decodeWorkbook(bytes);
  return decoding.ok && decoding.sheets.length ? decoding.sheets.length : null;
}
