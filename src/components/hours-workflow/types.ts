export type HoursLanguage = 'nl' | 'en' | 'pl';

export interface HoursRevisionView {
  id: string;
  version: number;
  minutes: number | null;
  noHoursReason: string | null;
  notes: string | null;
  sourceLabel?: string;
  sourceReference?: string;
  createdAt?: string;
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
}

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
