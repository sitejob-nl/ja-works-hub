import { z } from 'zod';
import { hoursSourceInputSchema, type HoursSourceInput } from '@/components/hours-workflow/hours-day-source';
import { HOURS_WORKBOOK_TYPES } from '@/lib/hours-workbook-file';

/** Storage enforces both limits again; these keep the browser from uploading in vain. */
export const HOURS_SOURCE_MAX_BYTES = 26_214_400;
export const HOURS_SOURCE_TYPES = {
  'application/pdf': { extension: 'pdf', label: 'PDF' },
  'image/jpeg': { extension: 'jpg', label: 'JPG' },
  'image/png': { extension: 'png', label: 'PNG' },
  ...HOURS_WORKBOOK_TYPES,
} as const;
export type HoursSourceContentType = keyof typeof HOURS_SOURCE_TYPES;
export const HOURS_SOURCE_ACCEPT = Object.keys(HOURS_SOURCE_TYPES).join(',');
export const HOURS_SOURCE_BUCKET = 'hours-sources';

const uuid = z.string().uuid();
/** What an internal user decided about one page of one delivered file. */
export const HOURS_PAGE_ASSIGNMENTS = ['single', 'multiple', 'unclear'] as const;
export type HoursPageAssignment = (typeof HOURS_PAGE_ASSIGNMENTS)[number];
export const hoursSourcePageSchema = z.object({
  id: uuid, page_number: z.number().int().min(1), assignment: z.enum(HOURS_PAGE_ASSIGNMENTS),
  member_id: uuid.nullable(), candidate_name: z.string().nullable(),
  note: z.string().nullable(), created_at: z.string(),
});
export const hoursProposalSchema = z.object({
  id: uuid, day_id: uuid, member_id: uuid, work_date: z.string(), candidate_name: z.string(),
  status: z.enum(['open', 'applied', 'discarded']),
  minutes: z.number().int().min(0).max(1440),
  no_hours_reason: z.string().nullable(), note: z.string().nullable(),
  source_input: hoursSourceInputSchema.nullable(),
  page_label: z.string().nullable(), page_number: z.number().int().min(1).nullable(),
  assignment_uncertain: z.boolean(), assignment_confirmed_at: z.string().nullable(),
  assignment_note: z.string().nullable(), applied_revision_id: uuid.nullable(),
  applied_created_revision: z.boolean().nullable(), resolution_note: z.string().nullable(),
  resolved_at: z.string().nullable(), created_at: z.string(),
});
/**
 * A personal link to one client week. The token digest is deliberately absent
 * from this projection: no screen ever needs it, and the secret itself exists
 * nowhere but in the link that was handed out once.
 */
export const hoursClientLinkSchema = z.object({
  id: uuid, label: z.string(), created_at: z.string(), expires_at: z.string(),
  last_opened_at: z.string().nullable(), revoked_at: z.string().nullable(),
  revoke_note: z.string().nullable(),
  report: z.object({
    kind: z.enum(['later', 'complete']), note: z.string().nullable(), created_at: z.string(),
  }).nullable(),
  expected_days: z.number().int().nonnegative(), provided_days: z.number().int().nonnegative(),
  outstanding_days: z.number().int().nonnegative(), complete: z.boolean(),
  proposals: z.array(hoursProposalSchema),
});
export const hoursWeekSourcesSchema = z.object({
  week_id: uuid, can_manage: z.boolean(),
  open_proposals: z.number().int().nonnegative(), undecided_assignments: z.number().int().nonnegative(),
  client_links: z.array(hoursClientLinkSchema),
  sources: z.array(z.object({
    id: uuid, file_name: z.string(), content_type: z.string(), byte_size: z.number().int().nonnegative(),
    content_hash: z.string(), storage_path: z.string(), created_at: z.string(),
    page_count: z.number().int().min(1).nullable(),
    client_link_id: uuid.nullable(),
    pages: z.array(hoursSourcePageSchema),
    proposals: z.array(hoursProposalSchema),
  })),
});
/**
 * Declared rather than inferred: the relaxed compiler settings widen a Zod
 * inference into all-optional fields, which loses the guarantees the schema
 * above actually checks at the boundary.
 */
export interface HoursSourcePage {
  id: string; page_number: number; assignment: HoursPageAssignment;
  member_id: string | null; candidate_name: string | null; note: string | null; created_at: string;
}
export interface HoursSourceProposal {
  id: string; day_id: string; member_id: string; work_date: string; candidate_name: string;
  status: 'open' | 'applied' | 'discarded'; minutes: number;
  no_hours_reason: string | null; note: string | null;
  source_input: HoursSourceInput | null; page_label: string | null; page_number: number | null;
  assignment_uncertain: boolean; assignment_confirmed_at: string | null; assignment_note: string | null;
  applied_revision_id: string | null; applied_created_revision: boolean | null;
  resolution_note: string | null; resolved_at: string | null; created_at: string;
}
export interface HoursWeekSourceFile {
  id: string; file_name: string; content_type: string; byte_size: number;
  content_hash: string; storage_path: string; created_at: string;
  page_count: number | null;
  /** Set when the client delivered this file through its own week page. */
  client_link_id: string | null;
  pages: HoursSourcePage[];
  proposals: HoursSourceProposal[];
}
export interface HoursClientLink {
  id: string; label: string; created_at: string; expires_at: string;
  last_opened_at: string | null; revoked_at: string | null; revoke_note: string | null;
  report: { kind: 'later' | 'complete'; note: string | null; created_at: string } | null;
  expected_days: number; provided_days: number; outstanding_days: number; complete: boolean;
  proposals: HoursSourceProposal[];
}
export interface HoursWeekSources {
  week_id: string; can_manage: boolean;
  open_proposals: number; undecided_assignments: number;
  client_links: HoursClientLink[];
  sources: HoursWeekSourceFile[];
}

/**
 * Whether a personal link can still be opened right now. Withdrawing wins over
 * expiry, because that is the decision someone actually made.
 */
export type HoursClientLinkState = 'active' | 'revoked' | 'expired';
export function clientLinkState(link: Pick<HoursClientLink, 'revoked_at' | 'expires_at'>,
  now: Date = new Date()): HoursClientLinkState {
  if (link.revoked_at) return 'revoked';
  return new Date(link.expires_at) <= now ? 'expired' : 'active';
}

/** What a link has delivered, in the words the office uses about it. */
export function describeClientLinkProgress(link: Pick<HoursClientLink, 'expected_days' | 'provided_days' | 'outstanding_days' | 'complete'>): string {
  if (link.complete) return `Alle ${link.expected_days} dagen aangeleverd`;
  if (link.provided_days === 0) return `Nog niets aangeleverd van ${link.expected_days} dagen`;
  return `${link.provided_days} van ${link.expected_days} dagen aangeleverd · ${link.outstanding_days} nog open`;
}

export const HOURS_CLIENT_REPORT_LABELS: Record<'later' | 'complete', string> = {
  later: 'De opdrachtgever levert later aan',
  complete: 'De opdrachtgever meldt dit als volledig',
};

/** The address the client opens. Public and token-based; it carries no session. */
export function clientWeekUrl(secret: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}/urenweek/${secret}`;
}

/**
 * A proposal whose employee was recorded as uncertain may not be applied before
 * a named internal user has confirmed who it is about. The server refuses it
 * too; this only keeps the screen from offering an act it would reject. A
 * resolved proposal blocks nothing, matching the server-side open-point count.
 */
export function proposalIsBlocked(
  proposal: Pick<HoursSourceProposal, 'status' | 'assignment_uncertain' | 'assignment_confirmed_at'>,
): boolean {
  return proposal.status === 'open' && proposal.assignment_uncertain && !proposal.assignment_confirmed_at;
}

/** How a page decision reads on screen, in the language of the delivery. */
export const HOURS_PAGE_ASSIGNMENT_LABELS: Record<HoursPageAssignment, string> = {
  single: 'Eén medewerker',
  multiple: 'Meerdere medewerkers',
  unclear: 'Onduidelijk wie',
};

export function describePageCount(pageCount: number | null): string {
  if (pageCount === null) return 'aantal pagina\u2019s onbekend';
  return pageCount === 1 ? '1 pagina' : `${pageCount} pagina\u2019s`;
}

export function parseWeekSources(value: unknown): HoursWeekSources {
  return hoursWeekSourcesSchema.parse(value) as HoursWeekSources;
}

export function hoursSourceTypeError(file: { type: string; size: number }): string | null {
  if (!(file.type in HOURS_SOURCE_TYPES)) {
    return 'Alleen PDF, JPG, PNG en Excel kunnen op dit moment als bron worden bewaard. Andere bestanden volgen in een latere stap.';
  }
  if (file.size <= 0) return 'Dit bestand is leeg.';
  if (file.size > HOURS_SOURCE_MAX_BYTES) return 'Dit bestand is groter dan 25 MB en kan niet worden bewaard.';
  return null;
}

/** The digest is both the deduplication key and the stored object name. */
export async function hoursSourceDigest(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function hoursSourcePath(organizationId: string, weekId: string, digest: string, contentType: HoursSourceContentType): string {
  return `${organizationId}/${weekId}/${digest}.${HOURS_SOURCE_TYPES[contentType].extension}`;
}

export function formatSourceSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/** `kind` travels with the origin so a reader can phrase it, not just print it. */
export type HoursSourceOriginKind = 'manual' | 'upload' | 'client' | 'unknown';
export interface HoursSourceOrigin { kind: HoursSourceOriginKind; label: string; reference: string | null }

/**
 * Provenance is written by the server. Unknown kinds from later readers stay
 * readable instead of being dropped or presented as manual entry.
 */
export function describeSourceReferences(references: unknown[] | undefined): HoursSourceOrigin[] {
  if (!references?.length) return [];
  return references.map(entry => {
    const value = (entry ?? {}) as Record<string, unknown>;
    const label = typeof value.label === 'string' && value.label.trim() ? value.label : null;
    const reference = typeof value.reference === 'string' && value.reference.trim() ? value.reference : null;
    if (value.kind === 'manual') return { kind: 'manual', label: label ?? 'Handmatige invoer', reference };
    if (value.kind === 'upload') return { kind: 'upload', label: label ?? 'Geüpload bestand', reference };
    // A client delivered these hours through its personal week page. The label is
    // the client itself, never the internal label of the link that was handed out.
    if (value.kind === 'client') return { kind: 'client', label: label ?? 'De opdrachtgever', reference };
    return { kind: 'unknown', label: label ?? 'Bron niet beschikbaar', reference };
  });
}

export function sourceOriginText(references: unknown[] | undefined): string {
  const origins = describeSourceReferences(references);
  if (!origins.length) return 'Bron niet beschikbaar';
  return origins.map(origin => {
    const label = origin.kind === 'client' ? `Aangeleverd door ${origin.label}` : origin.label;
    return origin.reference ? `${label} · ${origin.reference}` : label;
  }).join(' · ');
}

export interface HoursProposalChange { field: string; current: string; proposed: string }

const formatMinutes = (minutes: number): string => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')} uur`;
const describeSourceInput = (source: HoursSourceInput | null | undefined): string => {
  if (!source) return 'geen diensttijden of broncategorieën';
  const parts: string[] = [];
  if (source.shifts) parts.push(`${source.shifts.length} ${source.shifts.length === 1 ? 'dienst' : 'diensten'}`);
  if (source.categories) parts.push(`${source.categories.length} ${source.categories.length === 1 ? 'broncode' : 'broncodes'}`);
  return parts.length ? parts.join(', ') : 'lege brongegevens';
};

/**
 * What applying this proposal changes about the current day version. An empty
 * list means the proposal matches what is already recorded.
 */
export function proposalChanges(
  proposal: Pick<HoursSourceProposal, 'minutes' | 'no_hours_reason' | 'note' | 'source_input'>,
  current: { minutes: number; noHoursReason: string | null; notes: string | null; sourceInput?: HoursSourceInput | null } | null,
): HoursProposalChange[] {
  const changes: HoursProposalChange[] = [];
  const currentHours = !current ? 'nog niet ontvangen'
    : current.noHoursReason ? `geen uren (${current.noHoursReason})` : formatMinutes(current.minutes);
  const proposedHours = proposal.no_hours_reason
    ? `geen uren (${proposal.no_hours_reason})` : formatMinutes(proposal.minutes);
  if (currentHours !== proposedHours) changes.push({ field: 'Uren', current: currentHours, proposed: proposedHours });
  const currentNote = current?.notes ?? 'geen opmerking';
  const proposedNote = proposal.note ?? 'geen opmerking';
  if (currentNote !== proposedNote) changes.push({ field: 'Opmerking', current: currentNote, proposed: proposedNote });
  const currentSource = describeSourceInput(current?.sourceInput);
  const proposedSource = describeSourceInput(proposal.source_input);
  if (JSON.stringify(current?.sourceInput ?? null) !== JSON.stringify(proposal.source_input ?? null)) {
    changes.push({ field: 'Aangeleverde details', current: currentSource, proposed: proposedSource });
  }
  return changes;
}
