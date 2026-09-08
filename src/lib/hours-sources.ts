import { z } from 'zod';
import { hoursSourceInputSchema, type HoursSourceInput } from '@/components/hours-workflow/hours-day-source';

/** Storage enforces both limits again; these keep the browser from uploading in vain. */
export const HOURS_SOURCE_MAX_BYTES = 26_214_400;
export const HOURS_SOURCE_TYPES = {
  'application/pdf': { extension: 'pdf', label: 'PDF' },
  'image/jpeg': { extension: 'jpg', label: 'JPG' },
  'image/png': { extension: 'png', label: 'PNG' },
} as const;
export type HoursSourceContentType = keyof typeof HOURS_SOURCE_TYPES;
export const HOURS_SOURCE_ACCEPT = Object.keys(HOURS_SOURCE_TYPES).join(',');
export const HOURS_SOURCE_BUCKET = 'hours-sources';

const uuid = z.string().uuid();
export const hoursProposalSchema = z.object({
  id: uuid, day_id: uuid, member_id: uuid, work_date: z.string(), candidate_name: z.string(),
  status: z.enum(['open', 'applied', 'discarded']),
  minutes: z.number().int().min(0).max(1440),
  no_hours_reason: z.string().nullable(), note: z.string().nullable(),
  source_input: hoursSourceInputSchema.nullable(),
  page_label: z.string().nullable(), applied_revision_id: uuid.nullable(),
  applied_created_revision: z.boolean().nullable(), resolution_note: z.string().nullable(),
  resolved_at: z.string().nullable(), created_at: z.string(),
});
export const hoursWeekSourcesSchema = z.object({
  week_id: uuid, can_manage: z.boolean(),
  sources: z.array(z.object({
    id: uuid, file_name: z.string(), content_type: z.string(), byte_size: z.number().int().nonnegative(),
    content_hash: z.string(), storage_path: z.string(), created_at: z.string(),
    proposals: z.array(hoursProposalSchema),
  })),
});
/**
 * Declared rather than inferred: the relaxed compiler settings widen a Zod
 * inference into all-optional fields, which loses the guarantees the schema
 * above actually checks at the boundary.
 */
export interface HoursSourceProposal {
  id: string; day_id: string; member_id: string; work_date: string; candidate_name: string;
  status: 'open' | 'applied' | 'discarded'; minutes: number;
  no_hours_reason: string | null; note: string | null;
  source_input: HoursSourceInput | null; page_label: string | null;
  applied_revision_id: string | null; applied_created_revision: boolean | null;
  resolution_note: string | null; resolved_at: string | null; created_at: string;
}
export interface HoursWeekSourceFile {
  id: string; file_name: string; content_type: string; byte_size: number;
  content_hash: string; storage_path: string; created_at: string;
  proposals: HoursSourceProposal[];
}
export interface HoursWeekSources { week_id: string; can_manage: boolean; sources: HoursWeekSourceFile[] }

export function parseWeekSources(value: unknown): HoursWeekSources {
  return hoursWeekSourcesSchema.parse(value) as HoursWeekSources;
}

export function hoursSourceTypeError(file: { type: string; size: number }): string | null {
  if (!(file.type in HOURS_SOURCE_TYPES)) {
    return 'Alleen PDF, JPG en PNG kunnen op dit moment als bron worden bewaard. Andere bestanden volgen in een latere stap.';
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

export interface HoursSourceOrigin { label: string; reference: string | null }

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
    if (value.kind === 'manual') return { label: label ?? 'Handmatige invoer', reference };
    if (value.kind === 'upload') return { label: label ?? 'Geüpload bestand', reference };
    return { label: label ?? 'Bron niet beschikbaar', reference };
  });
}

export function sourceOriginText(references: unknown[] | undefined): string {
  const origins = describeSourceReferences(references);
  if (!origins.length) return 'Bron niet beschikbaar';
  return origins.map(origin => origin.reference ? `${origin.label} · ${origin.reference}` : origin.label).join(' · ');
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
