import { describe, expect, it, vi } from 'vitest';
import {
  emptyMatrixConfig, hoursMatrixError, matrixConfigSchema, matrixDefinitionSchema,
  matrixPeriodOverlaps, matrixPreviewDefinition, matrixPublicationIssue, previewHoursMatrix, validateMatrixDraft,
  type MatrixConfig, type MatrixDraftInput, type MatrixVersion,
} from '@/lib/hours-matrices';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(() => { throw new Error('These contract tests must not contact Supabase.'); }) },
}));

const client = { scope: 'client' as const };
const draft = (overrides: Partial<MatrixDraftInput> = {}): MatrixDraftInput => ({
  validFrom: '2026-09-01', validUntil: '2026-10-01',
  config: {
    schemaVersion: 1, timeBasis: 'wall_clock',
    categories: [{ code: 'NOR', factor: '1.00' }, { code: 'OV', factor: '1.250' }],
    categoryMappings: [{ id: 'map-ov1', sourceCode: 'OV1', categoryCode: 'OV' }],
    automaticRules: { kind: 'flat', rule: { id: 'normal-hours', categoryCode: 'NOR' } },
  },
  ...overrides,
});

const version = (overrides: Partial<MatrixVersion> = {}): MatrixVersion => ({
  id: '00000000-0000-4000-8000-000000000001', matrix_id: '00000000-0000-4000-8000-000000000002',
  version_number: 1, revision: 2, status: 'published', valid_from: '2026-09-01', valid_until: '2026-10-01',
  effective_valid_until: '2026-10-01', published_definition: matrixPreviewDefinition(client, draft()),
  definition: matrixPreviewDefinition(client, draft()), created_at: '2026-09-01T09:00:00Z',
  updated_at: '2026-09-01T09:00:00Z', published_at: '2026-09-01T09:00:00Z', published_by: null,
  ...overrides,
});

describe('matrix configuration trust boundary', () => {
  it.each([
    ['unknown definition', { ...matrixPreviewDefinition(client, draft()), weeklyThreshold: 2400 }],
    ['unknown schema', { ...matrixPreviewDefinition(client, draft()), schemaVersion: 2 }],
    ['unknown time basis', { ...matrixPreviewDefinition(client, draft()), timeBasis: 'elapsed' }],
    ['unknown automatic rule', { ...matrixPreviewDefinition(client, draft()), automaticRules: { kind: 'weekly_overtime', threshold: 2400 } }],
    ['unknown rule property', { ...matrixPreviewDefinition(client, draft()), automaticRules: { kind: 'flat', rule: { id: 'normal-hours', categoryCode: 'NOR', stacking: true } } }],
    ['unknown category property', { ...matrixPreviewDefinition(client, draft()), categories: [{ code: 'NOR', factor: '1.00', holiday: true }] }],
    ['unknown mapping property', { ...matrixPreviewDefinition(client, draft()), categoryMappings: [{ id: 'ov', sourceCode: 'OV1', categoryCode: 'OV', stacking: true }] }],
  ])('rejects %s instead of silently removing it', (_label, definition) => {
    const result = matrixDefinitionSchema.safeParse(definition);
    expect(result.success).toBe(false);
    if (result.success === false) expect(hoursMatrixError(result.error)).toMatch(/onbekende of ongeldige instellingen/);
  });

  it('does not provide default categories, factors or a guessed automatic rule', () => {
    const config = emptyMatrixConfig();
    expect(config.categories).toEqual([]);
    expect(config.categoryMappings).toEqual([]);
    expect(validateMatrixDraft(client, draft({ config }))).toMatchObject({
      ok: false, issues: [{ code: 'INVALID_CATEGORIES' }],
    });
    const { automaticRules: _omitted, ...missingRules } = draft().config;
    expect(matrixConfigSchema.safeParse(missingRules).success).toBe(false);
    expect(validateMatrixDraft(client, draft({ config: missingRules as MatrixConfig }))).toMatchObject({
      ok: false, issues: [{ code: 'UNSUPPORTED_RULES' }],
    });
  });

  it('validates the actual rule targets, not only the JSON structure', () => {
    const config = draft().config;
    config.automaticRules = { kind: 'flat', rule: { id: 'invalid-target', categoryCode: 'UNKNOWN' } };
    expect(matrixConfigSchema.safeParse(config).success).toBe(true);
    expect(validateMatrixDraft(client, draft({ config }))).toMatchObject({
      ok: false, issues: [{ code: 'INVALID_FLAT_RULE' }],
    });
  });
});

describe('matrix calculation preview', () => {
  it('maps supplied OV categories and keeps the configured factor without multiplying the minutes', () => {
    const input = draft();
    const before = JSON.stringify(input);
    const definition = matrixPreviewDefinition(client, input, 'preview-version');
    const result = previewHoursMatrix(definition, {
      workDate: '2026-09-07', duration: '8,5', categories: [{ sourceCode: 'OV1', duration: '8:30' }],
    });
    expect(result).toEqual({ ok: true, value: {
      matrixVersionId: 'preview-version', workDate: '2026-09-07', totalMinutes: 510,
      allocations: [{ categoryCode: 'OV', factor: '1.250', minutes: 510, ruleId: 'map-ov1', sourceCategory: 'OV1' }],
    } });
    expect(JSON.stringify(input)).toBe(before);
  });

  it('blocks an unmapped OV category instead of classifying it as normal hours', () => {
    expect(previewHoursMatrix(matrixPreviewDefinition(client, draft()), {
      workDate: '2026-09-07', duration: '8', categories: [{ sourceCode: 'OV5', duration: '8' }],
    })).toMatchObject({ ok: false, issues: [{ code: 'UNMAPPED_SOURCE_CATEGORY' }] });
  });

  it('compares the reported total with shift minutes after the explicit break', () => {
    const definition = matrixPreviewDefinition(client, draft());
    const shifts = [{ start: '08:00', end: '17:00', endDayOffset: 0 as const, breaks: [{ start: '12:00', end: '12:30' }] }];
    expect(previewHoursMatrix(definition, { workDate: '2026-09-07', duration: '9', shifts })).toMatchObject({
      ok: false, issues: [{ code: 'TOTAL_MISMATCH', expectedMinutes: 510, actualMinutes: 540 }],
    });
    expect(previewHoursMatrix(definition, { workDate: '2026-09-07', duration: '8,5', shifts })).toMatchObject({
      ok: true, value: { totalMinutes: 510, allocations: [{ minutes: 510, factor: '1.00' }] },
    });
  });

  it('rejects fractional minutes and incorrect category totals without rounding or filling', () => {
    const definition = matrixPreviewDefinition(client, draft());
    expect(previewHoursMatrix(definition, { workDate: '2026-09-07', duration: '8.001' })).toMatchObject({
      ok: false, issues: [{ code: 'SUB_MINUTE_PRECISION' }],
    });
    expect(previewHoursMatrix(definition, {
      workDate: '2026-09-07', duration: '8', categories: [{ sourceCode: 'OV1', duration: '7' }],
    })).toMatchObject({ ok: false, issues: [{ code: 'TOTAL_MISMATCH', expectedMinutes: 420, actualMinutes: 480 }] });
  });

  it.each(['2026-08-31', '2026-10-01'])('rejects a preview outside the version period: %s', workDate => {
    expect(previewHoursMatrix(matrixPreviewDefinition(client, draft()), { workDate, duration: '8' })).toMatchObject({
      ok: false, issues: [{ code: 'MATRIX_NOT_EFFECTIVE' }],
    });
  });

  it.each(['2026-09-01', '2026-09-30'])('accepts a preview inside the version period: %s', workDate => {
    expect(previewHoursMatrix(matrixPreviewDefinition(client, draft()), { workDate, duration: '8' }).ok).toBe(true);
  });

  it('rejects a reversed or invalid calendar period before the preview can be used', () => {
    expect(validateMatrixDraft(client, draft({ validUntil: '2026-09-01' }))).toMatchObject({
      ok: false, issues: [{ code: 'INVALID_MATRIX_PERIOD' }],
    });
    expect(validateMatrixDraft(client, draft({ validFrom: '2026-02-30' }))).toMatchObject({
      ok: false, issues: [{ code: 'INVALID_WORK_DATE' }],
    });
  });
});

describe('published period conflicts', () => {
  it('allows a successor to close the predecessor and blocks backwards or duplicate start dates', () => {
    expect(matrixPeriodOverlaps(draft({ validFrom: '2026-10-01', validUntil: null }), [version()])).toBe(false);
    expect(matrixPeriodOverlaps(draft({ validFrom: '2026-09-30', validUntil: null }), [version()])).toBe(false);
    expect(matrixPeriodOverlaps(draft(), [version({ valid_until: null })])).toBe(true);
    expect(matrixPeriodOverlaps(draft({ validFrom: '2026-08-31' }), [version()])).toBe(true);
  });

  it('ignores unpublished drafts and the version currently being edited', () => {
    expect(matrixPeriodOverlaps(draft(), [version({ status: 'draft' })])).toBe(false);
    expect(matrixPeriodOverlaps(draft(), [version()], version().id)).toBe(false);
  });
});

describe('successor publication uses the Amsterdam calendar date', () => {
  const predecessor = () => version({ valid_from: '2026-08-01' });
  const currentTime = new Date('2026-09-07T22:30:00Z'); // 8 September, 00:30 in Amsterdam.

  it('allows an explicitly configured first historical version', () => {
    const historical = draft({ validFrom: '2026-01-01', validUntil: null });
    expect(matrixPublicationIssue(historical, [], undefined, currentTime)).toBeNull();
    expect(matrixPublicationIssue(historical, [version({ status: 'draft' })], undefined, currentTime)).toBeNull();
  });

  it('blocks a backdated successor even when it begins after the previous version', () => {
    expect(matrixPublicationIssue(draft({ validFrom: '2026-09-07' }), [predecessor()], undefined, currentTime))
      .toEqual(expect.any(String));
  });

  it.each(['2026-09-08', '2026-09-09'])('allows a successor beginning today or later: %s', validFrom => {
    expect(matrixPublicationIssue(draft({ validFrom }), [predecessor()], undefined, currentTime)).toBeNull();
  });

  it.each(['2026-10-01', '2026-09-30'])('blocks a successor on or before an existing future start: %s', validFrom => {
    const scheduled = version({ valid_from: '2026-10-01', valid_until: null });
    expect(matrixPublicationIssue(draft({ validFrom, validUntil: null }), [scheduled], undefined, currentTime))
      .toEqual(expect.any(String));
  });

  it('changes the summer publication date at Amsterdam midnight, two hours before UTC midnight', () => {
    const successor = draft({ validFrom: '2026-09-07' });
    expect(matrixPublicationIssue(successor, [predecessor()], undefined, new Date('2026-09-07T21:59:59Z'))).toBeNull();
    expect(matrixPublicationIssue(successor, [predecessor()], undefined, new Date('2026-09-07T22:00:00Z')))
      .toEqual(expect.any(String));
  });

  it('changes the winter publication date one hour before UTC midnight', () => {
    const successor = draft({ validFrom: '2027-01-07', validUntil: null });
    const previous = version({ valid_from: '2026-12-01', valid_until: null });
    expect(matrixPublicationIssue(successor, [previous], undefined, new Date('2027-01-07T22:30:00Z'))).toBeNull();
    expect(matrixPublicationIssue(successor, [previous], undefined, new Date('2027-01-07T23:00:00Z')))
      .toEqual(expect.any(String));
  });

  it('ignores the current version and unpublished drafts when checking for predecessors', () => {
    const historical = draft({ validFrom: '2026-01-01', validUntil: null });
    expect(matrixPublicationIssue(historical, [version()], version().id, currentTime)).toBeNull();
    const versions = [predecessor(), version({ id: '00000000-0000-4000-8000-000000000003', status: 'draft', valid_from: '2026-12-01' })];
    expect(matrixPublicationIssue(draft({ validFrom: '2026-09-08' }), versions, undefined, currentTime)).toBeNull();
  });
});
