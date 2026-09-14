import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { isHoursConflict } from '@/components/hours-workflow/presentation';
import {
  hoursMatrixOptionsSchema, hoursWeekSchema, hoursWorkflowFailure, toHoursMatrixOptions, toHoursWeekView,
} from '@/lib/hours-workflow';

const revisionId = '00000000-0000-4000-8000-000000000991';
const versionId = '00000000-0000-4000-8000-000000000881';
const otherVersionId = '00000000-0000-4000-8000-000000000882';
const dayId = '00000000-0000-4000-8000-000000000771';
const actor = '00000000-0000-4000-8000-000000000661';

const classification = (overrides: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-0000000000c1', revision_id: revisionId,
  status: 'classified', matrix_version_id: versionId,
  matrix_name: 'Klantmatrix', matrix_scope: 'client', engine_version: 'hours-calculation-v1',
  created_at: '2026-09-17T08:00:00Z', basis_pinned: true, basis_version: 0,
  allocations: [{ categoryCode: 'NORMAAL', factor: '1', minutes: 480, ruleId: 'default' }],
  issues: [], ...overrides,
});

const basisEntry = (overrides: Record<string, unknown> = {}) => ({
  basis_version: 0, matrix_id: '00000000-0000-4000-8000-000000000551', matrix_version_id: versionId,
  matrix_name: 'Klantmatrix', scope: 'client', reason: null, revision_id: revisionId,
  created_by: actor, created_at: '2026-09-17T08:00:00Z', ...overrides,
});

function weekPayload(day: Record<string, unknown>) {
  return {
    id: '00000000-0000-4000-8000-000000000111', company_id: '00000000-0000-4000-8000-000000000222',
    company_name: 'Testopdrachtgever', week_start: '2026-09-14',
    submission_deadline_at: null, confirmation_deadline_at: null, settings_snapshot: {},
    workflow_enabled: true, can_manage: true, can_confirm: false, release_available: false as const,
    members: [{
      id: '00000000-0000-4000-8000-000000000331', placement_id: '00000000-0000-4000-8000-000000000441',
      candidate_id: '00000000-0000-4000-8000-000000000442', candidate_name: 'Testmedewerker',
      start_date: '2026-09-14', end_date: '2026-09-20',
      days: [{
        id: dayId, work_date: '2026-09-14', confirmation: null, review: null,
        current_revision: {
          id: revisionId, revision_number: 2, minutes: 480, no_hours_reason: null, note: null,
          source_references: [], created_at: '2026-09-17T07:00:00Z', source_input: null,
        },
        ...day,
      }],
    }],
  };
}

const firstDay = (payload: unknown) => toHoursWeekView(hoursWeekSchema.parse(payload)).employees[0].days[0];

describe('the basis chain in the week projection', () => {
  it('reads the effective basis and every basis the day has had, oldest first', () => {
    const day = firstDay(weekPayload({
      matrix_basis: {
        basis_version: 1, matrix_id: '00000000-0000-4000-8000-000000000552', matrix_version_id: otherVersionId,
        matrix_name: 'CAO-matrix', scope: 'cao',
        entries: [basisEntry(), basisEntry({
          basis_version: 1, matrix_id: '00000000-0000-4000-8000-000000000552', matrix_version_id: otherVersionId,
          matrix_name: 'CAO-matrix', scope: 'cao', reason: 'Verkeerde klantmatrix gekozen',
          created_at: '2026-09-17T09:00:00Z',
        })],
      },
    }));
    expect(day.matrixBasis?.basisVersion).toBe(1);
    expect(day.matrixBasis?.matrixVersionId).toBe(otherVersionId);
    expect(day.matrixBasis?.entries.map(entry => entry.basisVersion)).toEqual([0, 1]);
    expect(day.matrixBasis?.entries[0].reason).toBeNull();
    expect(day.matrixBasis?.entries[1].reason).toBe('Verkeerde klantmatrix gekozen');
    expect(day.matrixBasis?.entries[1].scope).toBe('cao');
  });

  it('keeps the superseded outcome of the same day version next to the current one', () => {
    const day = firstDay(weekPayload({
      classification: classification({ basis_version: 1, matrix_version_id: otherVersionId, matrix_name: 'CAO-matrix', matrix_scope: 'cao' }),
      previous_classifications: [classification({ id: '00000000-0000-4000-8000-0000000000c0' })],
    }));
    expect(day.classification?.matrixName).toBe('CAO-matrix');
    expect(day.classification?.basisVersion).toBe(1);
    expect(day.previousClassifications?.map(entry => entry.matrixName)).toEqual(['Klantmatrix']);
    expect(day.previousClassifications?.[0].basisVersion).toBe(0);
  });

  it('drops a superseded outcome that belongs to a different day version', () => {
    const day = firstDay(weekPayload({
      classification: classification(),
      previous_classifications: [classification({
        id: '00000000-0000-4000-8000-0000000000c0', revision_id: '00000000-0000-4000-8000-000000000992',
      })],
    }));
    expect(day.previousClassifications).toEqual([]);
  });

  it('carries only the last outcome on an older day version', () => {
    const day = firstDay(weekPayload({
      history: [{
        id: '00000000-0000-4000-8000-000000000992', revision_number: 1, minutes: 420, no_hours_reason: null,
        note: null, source_references: [], created_at: '2026-09-16T07:00:00Z', source_input: null,
        classification: classification({ revision_id: '00000000-0000-4000-8000-000000000992', basis_version: 1 }),
      }],
    }));
    expect(day.history?.[0].classification?.basisVersion).toBe(1);
    expect(day.history?.[0]).not.toHaveProperty('previousClassifications');
  });

  it('reads a week from a database that has not been migrated yet without inventing a basis', () => {
    const day = firstDay(weekPayload({}));
    expect(day.matrixBasis ?? null).toBeNull();
    expect(day.previousClassifications).toEqual([]);
  });

  it('shows the employee portal no basis and no superseded outcome', () => {
    const day = firstDay(weekPayload({ matrix_basis: null, previous_classifications: [] }));
    expect(day.matrixBasis).toBeNull();
    expect(day.previousClassifications).toEqual([]);
  });
});

describe('what a replacement may choose from', () => {
  const payload = {
    day_id: dayId, work_date: '2026-09-14', released: false, can_manage: true,
    basis: {
      basis_version: 0, matrix_id: '00000000-0000-4000-8000-000000000551', matrix_version_id: versionId,
      matrix_name: 'Klantmatrix', scope: 'client', entries: [basisEntry()],
    },
    options: [
      { matrix_id: '00000000-0000-4000-8000-000000000551', matrix_version_id: versionId, matrix_name: 'Klantmatrix', scope: 'client', valid_from: '2026-01-01', valid_until: null, is_current: true },
      { matrix_id: '00000000-0000-4000-8000-000000000552', matrix_version_id: otherVersionId, matrix_name: 'CAO-matrix', scope: 'cao', valid_from: '2026-01-01', valid_until: '2027-01-01', is_current: false },
    ],
  };

  it('keeps the server answer exactly, including which option the day already stands on', () => {
    const options = toHoursMatrixOptions(hoursMatrixOptionsSchema.parse(payload));
    expect(options.released).toBe(false);
    expect(options.basis?.basisVersion).toBe(0);
    expect(options.options.map(option => [option.matrixName, option.isCurrent]))
      .toEqual([['Klantmatrix', true], ['CAO-matrix', false]]);
    expect(options.options[1].validUntil).toBe('2027-01-01');
  });

  it('refuses an answer that does not say whether the day has been released', () => {
    expect(() => hoursMatrixOptionsSchema.parse({ ...payload, released: undefined })).toThrow();
  });
});

describe('what a screen is told when the data layer refuses', () => {
  it('turns a parse failure into the readable message and keeps nothing technical', () => {
    const failure = hoursWorkflowFailure(new z.ZodError([]));
    expect(failure.message).toBe('Het urenoverzicht kon niet betrouwbaar worden gelezen. Ververs de pagina.');
    expect(isHoursConflict(failure)).toBe(false);
  });

  it('keeps the conflict code so the screen still recognises a stale basis or day version', () => {
    const failure = hoursWorkflowFailure({ code: 'PT409', message: 'De matrixbasis van deze dag is gewijzigd; laad opnieuw' });
    expect(failure.code).toBe('PT409');
    expect(isHoursConflict(failure)).toBe(true);
  });

  it('passes a server refusal through in the words the server chose', () => {
    const failure = hoursWorkflowFailure({ code: '22023', message: 'Kies een andere matrixversie dan de basis die deze dag al heeft' });
    expect(failure.message).toBe('Kies een andere matrixversie dan de basis die deze dag al heeft');
    expect(failure.code).toBe('22023');
  });
});
