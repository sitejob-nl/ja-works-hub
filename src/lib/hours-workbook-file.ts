import { HOURS_READABLE_SCAN_TYPES } from '../../supabase/functions/_shared/hours-scan';
import type { HoursIssue } from '../../supabase/functions/_shared/hours-calculation';
import type { WorkbookCell, WorkbookSheet } from '@/lib/hours-workbook';
// The sniffer lives beside the kernel: a mailed attachment and an uploaded one
// must be judged by exactly the same first bytes.
export { attachmentSourceType } from '../../supabase/functions/_shared/hours-attachment-type';

/** Spreadsheet media types accepted as a delivered source. */
export const HOURS_WORKBOOK_TYPES = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { extension: 'xlsx', label: 'Excel' },
  'application/vnd.ms-excel': { extension: 'xls', label: 'Excel' },
} as const;
export type HoursWorkbookContentType = keyof typeof HOURS_WORKBOOK_TYPES;

/** Word media types accepted as a delivered source. */
export const HOURS_WORD_TYPES = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { extension: 'docx', label: 'Word' },
  'application/msword': { extension: 'doc', label: 'Word' },
} as const;
export type HoursWordContentType = keyof typeof HOURS_WORD_TYPES;

/** One delivered message; its attachments become sources of their own. */
export const HOURS_MAIL_TYPES = {
  'message/rfc822': { extension: 'eml', label: 'E-mail' },
} as const;

export function isWorkbookSource(contentType: string): contentType is HoursWorkbookContentType {
  return contentType in HOURS_WORKBOOK_TYPES;
}

export function isWordSource(contentType: string): contentType is HoursWordContentType {
  return contentType in HOURS_WORD_TYPES;
}

export function isMailSource(contentType: string): boolean {
  return contentType === 'message/rfc822';
}

/**
 * A legacy binary .xls is kept as a source — the reviewer can open it and record
 * a proposal by hand — but it can never be read out, so it is never offered.
 */
export function isReadableWorkbook(contentType: string): boolean {
  return contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

/**
 * Every delivery this browser reads without a model and without a paid call: a
 * modern workbook, a modern Word file and a message. The legacy binary formats
 * are deliberately absent — offering an action that always fails is an
 * honest blockade turned into a detour.
 */
export function isBrowserReadable(contentType: string): boolean {
  return isReadableWorkbook(contentType)
    || contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || contentType === 'message/rfc822';
}

const isZipContainer = (bytes: ArrayBuffer): boolean => {
  const header = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  return header[0] === 0x50 && header[1] === 0x4b;
};

/**
 * What the file actually is, rather than what the browser called it. A modern
 * .xlsx is handed over as the legacy media type often enough, and storing it
 * under that name would leave a perfectly readable workbook unreadable forever.
 */
export function workbookContentType(declared: string, bytes: ArrayBuffer): HoursWorkbookContentType | null {
  if (!isWorkbookSource(declared)) return null;
  if (isZipContainer(bytes)) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return isLegacyWorkbook(bytes) ? 'application/vnd.ms-excel' : null;
}

/**
 * The same question for Word. `application/msword` is what Windows reports for
 * anything Word can open, a modern .docx included; storing that as a legacy
 * document would leave a readable file unreadable forever.
 */
export function wordSourceContentType(declared: string, bytes: ArrayBuffer): HoursWordContentType | null {
  if (!isWordSource(declared)) return null;
  if (isZipContainer(bytes)) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return isLegacyWorkbook(bytes) ? 'application/msword' : null;
}

/** A Word file is a zip container or an OLE compound document; nothing else is. */
export function wordBytesError(bytes: ArrayBuffer): string | null {
  if (isZipContainer(bytes) || isLegacyWorkbook(bytes)) return null;
  return 'Dit bestand is geen Word-document. Sla het in Word op als .docx en lever het opnieuw aan.';
}

/**
 * Windows browsers report `application/vnd.ms-excel` for a plain .csv, so the
 * declared media type is not enough. A workbook is either a zip container
 * (.xlsx) or an OLE compound document (.xls); anything else is refused before
 * it is stored, with a message that says what to do.
 */
export function workbookBytesError(bytes: ArrayBuffer): string | null {
  if (isZipContainer(bytes) || isLegacyWorkbook(bytes)) return null;
  return 'Dit bestand is geen Excel-werkmap. Sla het in Excel op als .xlsx en lever het opnieuw aan.';
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
  // Loading the reader is a transport problem, not a problem with this file, so
  // a failure there must not be reported as an unreadable workbook.
  const readWorkbook = (await import('read-excel-file/browser')).default;
  try {
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

/** The one list the endpoint and the database also read; see the scan kernel. */
export function isReadableScan(contentType: string): boolean {
  return (HOURS_READABLE_SCAN_TYPES as readonly string[]).includes(contentType);
}
