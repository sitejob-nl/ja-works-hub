import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { Database, Json } from '@/integrations/supabase/types';
import type { HoursSourceInput } from '@/components/hours-workflow/hours-day-source';
import { hoursWorkflowRpc } from '@/lib/hours-workflow-api';
import { hoursMatrixRpc, type MatrixConfig } from '@/lib/hours-matrices';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));

type GeneratedFunctions = Database['public']['Functions'];
type ConfirmArguments = Parameters<typeof hoursWorkflowRpc<'hours_confirm_day'>>[1];
type SourceArguments = Parameters<typeof hoursWorkflowRpc<'hours_save_day_source'>>[1];
type CreateMatrixArguments = Parameters<typeof hoursMatrixRpc<'hours_create_matrix'>>[1];
type PublishArguments = Parameters<typeof hoursMatrixRpc<'hours_publish_matrix_version'>>[1];

const dayId = '00000000-0000-4000-8000-000000000001';
const revisionId = '00000000-0000-4000-8000-000000000002';
const matrixId = '00000000-0000-4000-8000-000000000003';
const source: HoursSourceInput = {
  schemaVersion: 1,
  shifts: [{ start: '22:00', end: '06:30', endDayOffset: 1, breaks: [{ start: '02:00', end: '02:30', startDayOffset: 1, endDayOffset: 1 }] }],
  categories: [{ sourceCode: 'OV1', minutes: 480 }],
};
const save: SourceArguments = {
  p_day_id: dayId, p_expected_revision_id: revisionId, p_minutes: 480,
  p_no_hours_reason: null, p_note: null, p_source_input: source,
};

// These invalid calls are deliberately never executed. `npm run typecheck` must
// reject them even though PostgreSQL represents decisions as text and facts as JSON.
function rejectedRpcInputsAreTypecheckedOnly() {
  // @ts-expect-error A generated text argument must not admit arbitrary approval states.
  void hoursWorkflowRpc('hours_confirm_day', { p_day_id: dayId, p_expected_revision_id: revisionId, p_decision: 'approved', p_note: null });
  // @ts-expect-error Approval remains tied to an explicit revision.
  void hoursWorkflowRpc('hours_confirm_day', { p_day_id: dayId, p_decision: 'confirmed', p_note: null });
  // @ts-expect-error Source schema versions cannot become arbitrary JSON after type regeneration.
  void hoursWorkflowRpc('hours_save_day_source', { ...save, p_source_input: { schemaVersion: 2 } });
  // @ts-expect-error A source save must distinguish explicit null from a forgotten argument.
  void hoursWorkflowRpc('hours_save_day_source', { p_day_id: dayId, p_expected_revision_id: revisionId, p_minutes: 480, p_no_hours_reason: null, p_note: null });
  // @ts-expect-error Database text does not make an unimplemented matrix scope valid.
  void hoursMatrixRpc('hours_create_matrix', { p_scope: 'organization', p_company_id: null, p_name: 'Voorbeeld' });
  // @ts-expect-error Publication requires an explicit optimistic-concurrency revision.
  void hoursMatrixRpc('hours_publish_matrix_version', { p_version_id: matrixId, p_confirmed: true });
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: { saved: true }, error: null });
});

describe('generated hours RPC contracts retain domain constraints', () => {
  it('narrows text and JSON arguments while remaining compatible with deployed scalar signatures', () => {
    expectTypeOf<ConfirmArguments['p_decision']>().toEqualTypeOf<'confirmed' | 'disputed'>();
    expectTypeOf<ConfirmArguments>().toExtend<GeneratedFunctions['hours_confirm_day']['Args']>();
    expectTypeOf<CreateMatrixArguments['p_scope']>().toEqualTypeOf<'client' | 'cao'>();
    expectTypeOf<CreateMatrixArguments>().toExtend<GeneratedFunctions['hours_create_matrix']['Args']>();
    expectTypeOf<PublishArguments>().toExtend<GeneratedFunctions['hours_publish_matrix_version']['Args']>();
    expectTypeOf<SourceArguments['p_source_input']>().toEqualTypeOf<HoursSourceInput | null>();
    expectTypeOf<GeneratedFunctions['hours_save_day_source']['Args']['p_source_input']>().toEqualTypeOf<Json>();
    expectTypeOf<GeneratedFunctions['hours_get_module_access']['Args']>().toEqualTypeOf<never>();
  });

  it('preserves source codes, overnight offsets, empty notes and the exact revision in a save request', async () => {
    await hoursWorkflowRpc('hours_save_day_source', save);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('hours_save_day_source', save);
    expect(rpc.mock.calls[0][1].p_source_input).toEqual(source);
  });

  it('sends an explicit cleared source without changing the no-hours reason or concurrency token', async () => {
    const args: SourceArguments = { ...save, p_expected_revision_id: null, p_minutes: 0, p_no_hours_reason: 'Niet ingepland', p_source_input: null };
    await hoursWorkflowRpc('hours_save_day_source', args);
    expect(rpc).toHaveBeenCalledWith('hours_save_day_source', args);
  });

  it('preserves every exact revision in an atomic employee confirmation', async () => {
    const args = {
      p_week_id: matrixId,
      p_revisions: [{ day_id: dayId, revision_id: revisionId }, { day_id: matrixId, revision_id: dayId }],
      p_note: null,
    };
    await hoursWorkflowRpc('hours_confirm_days', args);
    expect(rpc).toHaveBeenCalledWith('hours_confirm_days', args);
  });

  it('does not infer factors, end dates or publication when sending a matrix draft', async () => {
    const config: MatrixConfig = {
      schemaVersion: 1, timeBasis: 'wall_clock', categories: [{ code: 'OV', factor: '1.250' }],
      categoryMappings: [{ id: 'source-ov1', sourceCode: 'OV1', categoryCode: 'OV' }], automaticRules: { kind: 'explicit_only' },
    };
    const args = { p_matrix_id: matrixId, p_valid_from: '2026-09-08', p_valid_until: null, p_config: config };
    await hoursMatrixRpc('hours_create_matrix_draft', args);
    expect(rpc).toHaveBeenCalledWith('hours_create_matrix_draft', args);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it('sends the explicit publication acknowledgement and expected version unchanged', async () => {
    const args: PublishArguments = { p_version_id: matrixId, p_expected_revision: 4, p_confirmed: true };
    await hoursMatrixRpc('hours_publish_matrix_version', args);
    expect(rpc).toHaveBeenCalledWith('hours_publish_matrix_version', args);
  });

  it.each(['40001', '42501'])('keeps the server %s error intact so callers can distinguish conflicts and denied access', async (code) => {
    const error = { code, message: 'Server contract rejected this request', details: 'Expected revision or authorization changed', hint: null };
    rpc.mockResolvedValue({ data: null, error });
    await expect(hoursWorkflowRpc('hours_save_day_source', save)).rejects.toBe(error);
    await expect(hoursMatrixRpc('hours_publish_matrix_version', { p_version_id: matrixId, p_expected_revision: 4, p_confirmed: true })).rejects.toBe(error);
  });

  it('returns untrusted response data to the existing Zod boundary without supplying missing fields', async () => {
    const malformed = { unexpected: 'server contract changed' };
    rpc.mockResolvedValue({ data: malformed, error: null });
    await expect(hoursWorkflowRpc('hours_get_week', { p_week_id: matrixId })).resolves.toEqual(malformed);
    await expect(hoursMatrixRpc('hours_get_matrix', { p_matrix_id: matrixId })).resolves.toEqual(malformed);
  });
});
