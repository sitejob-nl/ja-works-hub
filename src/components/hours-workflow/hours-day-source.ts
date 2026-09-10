import { z } from 'zod';
import { parseHoursToMinutes, type HoursResult, type HoursShift } from '../../../supabase/functions/_shared/hours-calculation';
import { sourceControlIssues, type HoursSourceInput } from '../../../supabase/functions/_shared/hours-source-control';

// Both live beside the calculation kernel now: every reader has to reach them,
// and a Deno edge function cannot import from the browser bundle.
export { sourceControlIssues };
export type { HoursSourceInput };

const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const offset = z.union([z.literal(0), z.literal(1)]);
const pauseSchema = z.object({ start: time, end: time, startDayOffset: offset.optional(), endDayOffset: offset.optional() }).strict();
const shiftSchema = z.object({ start: time, end: time, endDayOffset: offset, breaks: z.array(pauseSchema).max(32) }).strict();
export const hoursSourceInputSchema = z.object({
  schemaVersion: z.literal(1), shifts: z.array(shiftSchema).max(32).optional(),
  categories: z.array(z.object({ sourceCode: z.string().max(200).refine(value => value.trim().length > 0), minutes: z.number().int().min(0).max(1440) }).strict()).max(256).optional(),
}).strict();
export interface SourceBreakDraft { start: string; end: string; startDayOffset: '' | '0' | '1'; endDayOffset: '' | '0' | '1' }
export interface SourceShiftDraft { start: string; end: string; endDayOffset: '' | '0' | '1'; breaks: SourceBreakDraft[]; breaksConfirmed: boolean }
export interface HoursSourceDraft {
  includeShifts: boolean; includeCategories: boolean;
  shifts: SourceShiftDraft[]; categories: { sourceCode: string; duration: string }[];
}
export const emptySourceShift = (): SourceShiftDraft => ({ start: '', end: '', endDayOffset: '', breaks: [], breaksConfirmed: false });
export const sourceDuration = (minutes: number): string => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
export function sourceDraftFromInput(input?: HoursSourceInput | null): HoursSourceDraft {
  return {
    includeShifts: input?.shifts !== undefined, includeCategories: input?.categories !== undefined,
    shifts: input?.shifts?.map(shift => ({
      start: shift.start, end: shift.end, endDayOffset: String(shift.endDayOffset) as '0' | '1', breaksConfirmed: true,
      breaks: shift.breaks.map(pause => ({ ...pause, startDayOffset: String(pause.startDayOffset ?? 0) as '0' | '1', endDayOffset: String(pause.endDayOffset ?? pause.startDayOffset ?? 0) as '0' | '1' })),
    })) ?? [],
    categories: input?.categories?.map(category => ({ sourceCode: category.sourceCode, duration: sourceDuration(category.minutes) })) ?? [],
  };
}

/** Accept contradictory facts for review, but never round or silently fill missing facts. */
export function compileHoursSourceInput(draft: HoursSourceDraft): HoursResult<HoursSourceInput | null> {
  const fail = (code: string, message: string): HoursResult<HoursSourceInput> => ({ ok: false, issues: [{ code, message }] });
  if (!draft.includeShifts && !draft.includeCategories) return { ok: true, value: null };
  const source: HoursSourceInput = { schemaVersion: 1 };
  if (draft.includeShifts) {
    source.shifts = [];
    for (const [index, shift] of draft.shifts.entries()) {
      if (!shift.breaksConfirmed) return fail('UNCONFIRMED_BREAKS', `Controleer en bevestig de pauzes van dienst ${index + 1}, ook als er geen pauzes waren.`);
      if (shift.endDayOffset === '' || shift.breaks.some(pause => pause.startDayOffset === '' || pause.endDayOffset === '')) return fail('MISSING_DAY_OFFSET', 'Geef voor de dienst en iedere pauze expliciet aan op welke dag het tijdstip valt.');
      source.shifts.push({
        start: shift.start, end: shift.end, endDayOffset: Number(shift.endDayOffset) as 0 | 1,
        breaks: shift.breaks.map(pause => ({ start: pause.start, end: pause.end, startDayOffset: Number(pause.startDayOffset) as 0 | 1, endDayOffset: Number(pause.endDayOffset) as 0 | 1 })),
      });
    }
  }
  if (draft.includeCategories) {
    source.categories = [];
    for (const category of draft.categories) {
      const parsed = parseHoursToMinutes(category.duration, { maxMinutes: 1440 });
      if (parsed.ok === false) return parsed;
      source.categories.push({ sourceCode: category.sourceCode, minutes: parsed.value });
    }
  }
  if (!hoursSourceInputSchema.safeParse(source).success) return fail('INVALID_SOURCE_INPUT', 'Controleer de tijdstippen (UU:MM), broncodes en aantallen. Er mogen maximaal 32 diensten, 32 pauzes per dienst en 256 broncategorieën worden ingevuld.');
  if (new TextEncoder().encode(JSON.stringify(source)).length > 65536) return fail('SOURCE_TOO_LARGE', 'De brongegevens zijn te groot om in één dag op te slaan.');
  return { ok: true, value: source };
}

export function removedSourceSections(original: HoursSourceInput | null | undefined, draft: HoursSourceDraft): boolean {
  return !!(original && ((!draft.includeShifts && !draft.includeCategories) || (original.shifts && !draft.includeShifts) || (original.categories && !draft.includeCategories)));
}

