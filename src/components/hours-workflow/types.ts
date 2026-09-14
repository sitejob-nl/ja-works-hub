import type { HoursSourceInput } from './hours-day-source';
import type { HoursAllocation, HoursIssue } from '../../../supabase/functions/_shared/hours-calculation';

export type HoursLanguage = 'nl' | 'en' | 'pl';

export interface HoursClassificationView {
  id: string; revisionId: string; status: 'classified' | 'blocked' | 'no_hours';
  matrixVersionId: string | null; matrixName: string | null; matrixScope: 'client' | 'cao' | null;
  engineVersion: string; createdAt: string; allocations: HoursAllocation[]; issues: HoursIssue[]; basisPinned: boolean;
  /** Which basis this outcome used: 0 is the first pinned one, N the Nth replacement. */
  basisVersion: number | null;
}

/** One link in the chain of bases a day has stood on. The first has no reason. */
export interface HoursBasisEntryView {
  basisVersion: number; matrixId: string; matrixVersionId: string; matrixName: string;
  scope: 'client' | 'cao'; reason: string | null; revisionId: string; createdBy: string; createdAt: string;
}

/** The basis in force, with every basis the day has had underneath it. */
export interface HoursDayBasisView {
  basisVersion: number; matrixId: string; matrixVersionId: string; matrixName: string;
  scope: 'client' | 'cao'; entries: HoursBasisEntryView[];
}

export interface HoursMatrixOptionView {
  matrixId: string; matrixVersionId: string; matrixName: string; scope: 'client' | 'cao';
  validFrom: string; validUntil: string | null; isCurrent: boolean;
}

/** What the server will accept as a new basis for one day, and its release state. */
export interface HoursMatrixOptionsView {
  dayId: string; workDate: string; released: boolean; canManage: boolean;
  basis: HoursDayBasisView | null; options: HoursMatrixOptionView[];
}

export interface HoursReplaceBasisInput {
  dayId: string; expectedRevisionId: string; expectedBasisVersion: number;
  matrixVersionId: string; reason: string;
}

export interface HoursRevisionView {
  id: string;
  version: number;
  minutes: number | null;
  noHoursReason: string | null;
  notes: string | null;
  sourceLabel?: string;
  sourceReference?: string;
  createdAt?: string;
  sourceInput?: HoursSourceInput | null;
  classification?: HoursClassificationView | null;
}

export interface HoursDayView {
  id: string;
  workDate: string;
  revision: HoursRevisionView | null;
  confirmation: {
    revisionId: string;
    status: 'confirmed' | 'disputed';
    comment?: string | null;
  } | null;
  review?: {
    revisionId: string;
    status: 'checked' | 'blocked';
    comment?: string | null;
  } | null;
  history?: HoursRevisionView[];
  issues?: string[];
  classification?: HoursClassificationView | null;
  /** Earlier outcomes for the current day version, newest first. */
  previousClassifications?: HoursClassificationView[];
  matrixBasis?: HoursDayBasisView | null;
}

export interface HoursEmployeeView {
  id: string;
  candidateId: string;
  name: string;
  placementLabel?: string;
  days: HoursDayView[];
}

export interface HoursWeekView {
  id: string;
  companyName: string;
  weekStart: string;
  submissionDeadline?: string | null;
  confirmationDeadline?: string | null;
  enabled: boolean;
  employees: HoursEmployeeView[];
}

export interface HoursSaveDayInput {
  dayId: string;
  expectedRevisionId: string | null;
  minutes: number;
  noHoursReason: string | null;
  notes: string | null;
  sourceInput?: HoursSourceInput | null;
}

export interface HoursClassifyInput { dayId: string; expectedRevisionId: string }

export interface HoursRespondInput {
  dayId: string;
  expectedRevisionId: string;
  response: 'confirmed' | 'disputed';
  comment: string | null;
}

export interface HoursReviewInput {
  dayId: string;
  expectedRevisionId: string;
  status: 'checked' | 'blocked';
  comment: string | null;
}

export interface HoursConfirmAllInput {
  revisions: { dayId: string; expectedRevisionId: string }[];
  comment: string | null;
}
