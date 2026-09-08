import { z } from 'zod';
import type { Database } from '@/integrations/supabase/types';
import { supabase } from '@/integrations/supabase/client';
import { unwrap } from '@/lib/db';
import { toFriendlyError } from '@/lib/errorMessages';
import {
  classifyHoursDay, parseHoursToMinutes, selectEffectiveHoursMatrix,
  type HoursDayInput, type HoursMatrixVersion, type HoursResult, type ClassifiedHoursDay,
} from '../../supabase/functions/_shared/hours-calculation';

const categorySchema = z.object({ code: z.string(), factor: z.string() }).strict();
const mappingSchema = z.object({ id: z.string(), sourceCode: z.string(), categoryCode: z.string() }).strict();
const windowSchema = z.object({ id: z.string(), categoryCode: z.string(), daysOfWeek: z.array(z.number().int()), start: z.string(), end: z.string() }).strict();
export const matrixConfigSchema = z.object({
  schemaVersion: z.literal(1), timeBasis: z.literal('wall_clock'), categories: z.array(categorySchema),
  categoryMappings: z.array(mappingSchema), automaticRules: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('explicit_only') }).strict(),
    z.object({ kind: z.literal('flat'), rule: z.object({ id: z.string(), categoryCode: z.string() }).strict() }).strict(),
    z.object({ kind: z.literal('time_windows'), rules: z.array(windowSchema) }).strict(),
  ]),
}).strict();
export type MatrixConfig = z.infer<typeof matrixConfigSchema>;
export const matrixDefinitionSchema = matrixConfigSchema.extend({
  id: z.string(), scope: z.enum(['client', 'cao']), validFrom: z.string(), validUntil: z.string().nullable().optional(), confirmed: z.boolean(),
}).strict();
export const matrixVersionSchema = z.object({
  id: z.string().uuid(), matrix_id: z.string().uuid(), version_number: z.number().int(),
  status: z.enum(['draft', 'published']), revision: z.number().int(), valid_from: z.string(), valid_until: z.string().nullable(),
  effective_valid_until: z.string().nullable(), published_definition: matrixDefinitionSchema.nullable(),
  definition: matrixDefinitionSchema, created_at: z.string(), updated_at: z.string(), published_at: z.string().nullable(), published_by: z.string().nullable(),
});
export type MatrixVersion = z.infer<typeof matrixVersionSchema>;
export const matrixSummarySchema = z.object({
  id: z.string().uuid(), name: z.string(), scope: z.enum(['client', 'cao']), company_id: z.string().uuid().nullable(),
  company_name: z.string().nullable(), version_count: z.number().int(), published_version_count: z.number().int(),
});
export const matrixDetailSchema = matrixSummarySchema.extend({ versions: z.array(matrixVersionSchema), can_manage: z.boolean() });
export const matrixListSchema = z.object({ matrices: z.array(matrixSummarySchema), can_manage: z.boolean() });
export type MatrixDetail = z.infer<typeof matrixDetailSchema>;
export type MatrixDraftInput = { validFrom: string; validUntil: string | null; config: MatrixConfig };
export const matrixBindingSchema = z.object({ company_id: z.string().uuid(), version: z.number().int(), cao_matrix_id: z.string().uuid().nullable(), can_manage: z.boolean() });
export type MatrixBinding = z.infer<typeof matrixBindingSchema>;

type RpcArgs<Name extends keyof Database['public']['Functions']> = Database['public']['Functions'][Name]['Args'];

interface MatrixRpcArguments {
  hours_list_matrices: Required<RpcArgs<'hours_list_matrices'>>;
  hours_get_matrix: RpcArgs<'hours_get_matrix'>;
  hours_create_matrix: RpcArgs<'hours_create_matrix'> & { p_scope: 'client' | 'cao' };
  hours_create_matrix_draft: RpcArgs<'hours_create_matrix_draft'> & { p_config: MatrixConfig };
  hours_save_matrix_draft: RpcArgs<'hours_save_matrix_draft'> & { p_config: MatrixConfig };
  hours_publish_matrix_version: RpcArgs<'hours_publish_matrix_version'>;
  hours_get_company_matrix_binding: RpcArgs<'hours_get_company_matrix_binding'>;
  hours_set_company_matrix_binding: RpcArgs<'hours_set_company_matrix_binding'>;
}

/** Domain arguments refine the generated signatures; reads still pass through Zod. */
export async function hoursMatrixRpc<K extends keyof MatrixRpcArguments>(name: K, args: MatrixRpcArguments[K]): Promise<unknown> {
  return unwrap(supabase.rpc(name, args));
}

export function configFromDefinition(definition: z.infer<typeof matrixDefinitionSchema>): MatrixConfig {
  const { schemaVersion, timeBasis, categories, categoryMappings, automaticRules } = definition;
  return { schemaVersion, timeBasis, categories, categoryMappings, automaticRules };
}

export const emptyMatrixConfig = (): MatrixConfig => ({
  schemaVersion: 1, timeBasis: 'wall_clock', categories: [], categoryMappings: [], automaticRules: { kind: 'explicit_only' },
});

/** Only this in-memory simulation sets confirmed=true; it never persists a published status. */
export function matrixPreviewDefinition(matrix: Pick<MatrixDetail, 'scope'>, input: MatrixDraftInput, versionId = 'draft-preview'): HoursMatrixVersion {
  return { ...input.config, id: versionId, scope: matrix.scope, validFrom: input.validFrom, validUntil: input.validUntil, confirmed: true } as HoursMatrixVersion;
}

// Zod's inferred object fields are optional under this repository's relaxed
// strictNullChecks. Runtime parsing above is required before this pure adapter.
export function matrixDefinitionForCalculation(definition: z.infer<typeof matrixDefinitionSchema>): HoursMatrixVersion {
  return definition as HoursMatrixVersion;
}

export function validateMatrixDraft(matrix: Pick<MatrixDetail, 'scope'>, input: MatrixDraftInput): HoursResult<HoursMatrixVersion> {
  const definition = matrixPreviewDefinition(matrix, input);
  return selectEffectiveHoursMatrix({
    workDate: input.validFrom,
    clientVersions: matrix.scope === 'client' ? [definition] : [], caoVersions: matrix.scope === 'cao' ? [definition] : [],
  });
}

export function matrixPeriodOverlaps(input: MatrixDraftInput, versions: MatrixVersion[], currentVersionId?: string): boolean {
  // Successors close their predecessor's effective period. Publishing backwards
  // or on an existing start date cannot produce an unambiguous version sequence.
  return versions.some(version => version.id !== currentVersionId && version.status === 'published' && input.validFrom <= version.valid_from);
}

export function matrixPublicationIssue(input: MatrixDraftInput, versions: MatrixVersion[], currentVersionId?: string, now = new Date()): string | null {
  const published = versions.filter(version => version.id !== currentVersionId && version.status === 'published');
  if (matrixPeriodOverlaps(input, published, currentVersionId)) return 'Een opvolgende versie moet later beginnen dan alle al gepubliceerde versies.';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const datePart = (type: string) => parts.find(part => part.type === type)?.value;
  const today = `${datePart('year')}-${datePart('month')}-${datePart('day')}`;
  if (published.length && input.validFrom < today) return `Een opvolgende versie mag niet vóór vandaag (${today}, Nederlandse tijd) beginnen. Zo veranderen al verstreken dagen niet achteraf van matrix.`;
  return null;
}

export function previewHoursMatrix(matrix: HoursMatrixVersion, input: { workDate: string; duration: string; categories?: { sourceCode: string; duration: string }[]; shifts?: HoursDayInput['shifts'] }): HoursResult<ClassifiedHoursDay> {
  const duration = parseHoursToMinutes(input.duration, { maxMinutes: 1440 });
  if (duration.ok === false) return duration;
  const day: HoursDayInput = { workDate: input.workDate, totalMinutes: duration.value };
  if (input.shifts !== undefined) day.shifts = input.shifts;
  if (input.categories !== undefined) {
    day.categories = [];
    for (const category of input.categories) {
      const minutes = parseHoursToMinutes(category.duration, { maxMinutes: 1440 });
      if (minutes.ok === false) return minutes;
      day.categories.push({ sourceCode: category.sourceCode, minutes: minutes.value });
    }
  }
  return classifyHoursDay(day, matrix);
}

export const formatMatrixMinutes = (minutes: number): string => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;

export function hoursMatrixError(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (code === 'PT409' || code === '40001') return 'Dit concept is ondertussen gewijzigd. Laad de actuele versie en controleer je wijzigingen opnieuw.';
  if (code === '42501') return 'Je hebt geen toegang tot deze matrix of deze actie.';
  if (error instanceof z.ZodError) return 'De matrix bevat onbekende of ongeldige instellingen en kan niet veilig worden geopend.';
  if (code === '22023' || code === '23P01') return 'De matrix kan niet worden opgeslagen of gepubliceerd. Controleer de periode, uurcodes en regels. Een opvolgende versie moet later beginnen dan de vorige versie en mag niet vóór vandaag starten.';
  return toFriendlyError(error);
}
