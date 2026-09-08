import { beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: api.invoke } } }));
import { hoursClassifyDay } from '@/lib/hours-workflow-api';
import { hoursWeekSchema, toHoursWeekView } from '@/lib/hours-workflow';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function classification(revisionId = id(5)) {
  return {
    id: id(12), revision_id: revisionId, status: 'classified' as const,
    matrix_version_id: id(13), matrix_name: 'Voorbeeldmatrix', matrix_scope: 'client' as const,
    engine_version: 'hours-calculation-v1', created_at: '2026-09-08T08:00:00Z', basis_pinned: true,
    allocations: [{ categoryCode: 'NOR', factor: '1.250', minutes: 570, ruleId: 'r1', sourceCategory: 'OV1' }], issues: [],
  };
}
function week() {
  return {
    id: id(1), company_id: id(2), company_name: 'Voorbeeldbedrijf', week_start: '2026-09-07',
    submission_deadline_at: null, confirmation_deadline_at: null, settings_snapshot: {},
    workflow_enabled: true, can_manage: true, can_confirm: false, release_available: false,
    members: [{ id: id(3), placement_id: id(6), candidate_id: id(7), candidate_name: 'Voorbeeldmedewerker', start_date: '2026-09-07', end_date: '2026-09-13', days: [{
      id: id(4), work_date: '2026-09-07',
      current_revision: { id: id(5), revision_number: 2, minutes: 570, no_hours_reason: null, note: null, source_references: [], created_at: '2026-09-08T08:00:00Z', source_input: { schemaVersion: 1, categories: [{ sourceCode: 'OV1', minutes: 285 }, { sourceCode: 'OV2', minutes: 285 }] } },
      classification: classification(), confirmation: null, review: null,
    }] }],
  };
}

describe('hours source and classification boundary', () => {
  it('retains exact source codes and factor text without applying multipliers to minutes', () => {
    const day = toHoursWeekView(hoursWeekSchema.parse(week())).employees[0].days[0];
    expect(day.revision.sourceInput).toEqual({ schemaVersion: 1, categories: [{ sourceCode: 'OV1', minutes: 285 }, { sourceCode: 'OV2', minutes: 285 }] });
    expect(day.classification).toMatchObject({ revisionId: id(5), status: 'classified', basisPinned: true, allocations: [{ categoryCode: 'NOR', factor: '1.250', minutes: 570, ruleId: 'r1', sourceCategory: 'OV1' }] });
  });

  it('drops a classification on an older revision without carrying over employee approval', () => {
    const input = week(); input.members[0].days[0].classification.revision_id = id(99);
    const day = toHoursWeekView(hoursWeekSchema.parse(input)).employees[0].days[0];
    expect(day.classification).toBeNull();
    expect(day.confirmation).toBeNull();
  });

  it('keeps all absent events null for a genuinely unreceived day', () => {
    const input = hoursWeekSchema.parse(week());
    const day = input.members[0].days[0];
    day.current_revision = null; day.classification = null;
    expect(toHoursWeekView(input).employees[0].days[0]).toMatchObject({ revision: null, classification: null, confirmation: null, review: null });
  });

  it('keeps portal facts when internal classification is hidden', () => {
    const input = hoursWeekSchema.parse(week());
    input.can_manage = false; input.can_confirm = true; input.members[0].days[0].classification = null;
    const day = toHoursWeekView(input).employees[0].days[0];
    expect(day.revision.sourceInput.categories[0].sourceCode).toBe('OV1');
    expect(day.classification).toBeNull();
  });

  it('retains a historical classification only on its own historical revision', () => {
    const input = hoursWeekSchema.parse(week());
    input.members[0].days[0].history = [{ ...input.members[0].days[0].current_revision, id: id(20), revision_number: 1, classification: classification(id(20)) }];
    const day = toHoursWeekView(input).employees[0].days[0];
    expect(day.history[0].classification.revisionId).toBe(id(20));
    expect(day.classification.revisionId).toBe(id(5));
  });

  it('fails closed on a source field that the editor could otherwise discard', () => {
    const input = week();
    Object.assign(input.members[0].days[0].current_revision.source_input, { assumedFactor: 1.5 });
    expect(hoursWeekSchema.safeParse(input).success).toBe(false);
  });
});

describe('hours-classify-day transport', () => {
  beforeEach(() => api.invoke.mockReset());

  it('sends only exact day and revision IDs, never caller-supplied source or matrix input', async () => {
    const result = { classification: classification() };
    api.invoke.mockResolvedValue({ data: result, error: null });
    await expect(hoursClassifyDay({ dayId: id(4), expectedRevisionId: id(5) })).resolves.toEqual(result);
    expect(api.invoke).toHaveBeenCalledWith('hours-classify-day', { body: { day_id: id(4), expected_revision_id: id(5) } });
  });

  it.each(['40001', 'PT409'])('preserves the server CAS code %s from a Supabase FunctionsHttpError response', async code => {
    api.invoke.mockResolvedValue({ data: null, error: { message: 'Non-2xx status', context: new Response(JSON.stringify({ error: 'Revision or matrix context changed', code }), { status: 409 }) } });
    await expect(hoursClassifyDay({ dayId: id(4), expectedRevisionId: id(5) })).rejects.toMatchObject({ code, message: 'Revision or matrix context changed' });
  });

  it('keeps an unreadable gateway response as an error, not a classification', async () => {
    const error = { message: 'Gateway unavailable', context: new Response('Unavailable', { status: 503 }) };
    api.invoke.mockResolvedValue({ data: null, error });
    await expect(hoursClassifyDay({ dayId: id(4), expectedRevisionId: id(5) })).rejects.toBe(error);
  });
});
