import { describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke } } }));

const { hoursReadScan } = await import('@/lib/hours-workflow-api');
const SOURCE = '33333333-3333-4333-8333-333333333333';

/**
 * Edge functions deploy by hand while the frontend deploys on merge, so the
 * two can disagree about the shape of a reading. That has to fail as a message
 * a reviewer can read, not as a blank panel after a call that was paid for.
 */
describe('a reading that arrived in an unknown shape', () => {
  it('is refused with a readable message', async () => {
    invoke.mockResolvedValue({ data: { reading: { ok: true, candidates: [{ dayId: 'x' }] } }, error: null });
    await expect(hoursReadScan(SOURCE)).rejects.toThrow(/onbekende vorm/i);
    invoke.mockResolvedValue({ data: {}, error: null });
    await expect(hoursReadScan(SOURCE)).rejects.toThrow(/onbekende vorm/i);
  });

  it('accepts a reading that is missing only fields the panel can do without', async () => {
    invoke.mockResolvedValue({ data: { reading: { ok: true, candidates: [{
      dayId: 'day-1', memberId: 'member-1', employeeName: 'A', workDate: '2026-09-07',
      minutes: 480, noHoursReason: null, sourceInput: null, pageNumber: 1, pageLabel: 'rij 3',
      assignmentUncertain: false, employeeText: 'A',
    }] }, cost_cents: 1, balance_cents: 4870 }, error: null });
    const result = await hoursReadScan(SOURCE);
    expect(result.costCents).toBe(1);
    if (result.reading.ok === false) throw new Error('expected a reading');
    expect(result.reading.candidates[0].uncertainFields).toEqual([]);
    expect(result.reading.candidates[0].readText.total).toBeNull();
  });

  it('keeps a blocked reading readable', async () => {
    invoke.mockResolvedValue({ data: { reading: { ok: false, issues: [{ code: 'X', message: 'nee' }] },
      cost_cents: 2 }, error: null });
    const result = await hoursReadScan(SOURCE);
    expect(result.reading.ok).toBe(false);
    expect(result.costCents).toBe(2);
  });
});
