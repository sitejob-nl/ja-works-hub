import type { HoursIssue } from './hours-calculation.ts';
import type { HoursSourceInput } from './hours-source-control.ts';
import type { HoursWeekMember } from './hours-member-match.ts';

/**
 * The shape every hours reader speaks, on its own so both sides can reach it.
 *
 * A worksheet, a Word table and the body of a message are read by one set of
 * rules; the browser runs that reading when somebody uploads a delivery, and a
 * Deno edge function runs the very same code when a message arrives by itself.
 * A Deno function cannot import from the browser bundle, so the vocabulary the
 * two share lives here, beside the calculation kernel.
 *
 * These are declarations only. There is no runtime code in this module, which is
 * what keeps it importable from both sides without dragging anything along.
 */

/** A decoded cell exactly as the spreadsheet stored it; formulas are never run. */
export type WorkbookCell = string | number | boolean | Date | null;
export interface WorkbookSheet { name: string; rows: WorkbookCell[][] }

export type WorkbookWeekMember = HoursWeekMember;
export interface WorkbookWeekDay { id: string; memberId: string; workDate: string }
export interface WorkbookContext { members: WorkbookWeekMember[]; days: WorkbookWeekDay[] }

/**
 * One reviewable proposal candidate. It carries exactly what the delivery said
 * and where it said it; it is not an hour until an internal user saves it as a
 * proposal and then applies that proposal.
 */
export interface WorkbookCandidate {
  dayId: string; memberId: string; employeeName: string; workDate: string;
  minutes: number; noHoursReason: string | null;
  /** The delivered breakdown, kept exactly as the delivery wrote it. */
  sourceInput: HoursSourceInput | null;
  pageNumber: number; pageLabel: string;
  /** Where this came from, for a message that can name the row. */
  sheetName: string; row: number;
  assignmentUncertain: boolean;
  /** What the delivery literally said about this employee. */
  employeeText: string;
  /**
   * What this row supersedes, as the delivery wrote it. A message that corrects
   * itself ("zaterdag was geen 9,5 maar 4,75") says two things about one day;
   * the reviewer has to see both, or the correction looks like a plain reading.
   */
  correctionOf?: string;
  notices: HoursIssue[];
}

/** A row the reader deliberately left alone, named so nothing disappears silently. */
export interface WorkbookSkippedRow { sheet: string; row: number; text: string; reason: string }

/** A delivered row total that does not match the days read from that same row. */
export interface WorkbookRowTotal {
  sheet: string; row: number; employeeName: string;
  deliveredMinutes: number; readMinutes: number;
  /** Days of this week the row left empty; they explain part of a difference. */
  unreadDays: string[];
}

/**
 * Which kind of delivery a reading came out of. The rules are identical; only
 * the words a screen uses for "where it stood" differ, and a worksheet, a table
 * and a message are not the same place.
 */
export type WorkbookSourceKind = 'workbook' | 'document' | 'message';

export type WorkbookReading =
  | { ok: false; issues: HoursIssue[] }
  | {
      ok: true; sourceKind: WorkbookSourceKind;
      candidates: WorkbookCandidate[]; skipped: WorkbookSkippedRow[];
      rowTotals: WorkbookRowTotal[]; sheetsRead: string[];
      /** Worksheets whose layout was not recognised; named so none disappears silently. */
      sheetsIgnored: string[];
    };

/** What a delivery calls the thing a row stands on. */
export interface WorkbookReadingOptions { sheetNoun?: string; sourceKind?: WorkbookSourceKind }
