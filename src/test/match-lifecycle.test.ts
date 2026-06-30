import { describe, expect, it } from 'vitest';
import {
  advanceMatchStatus,
  buildMatchCreateRow,
  buildMatchFeedbackEvent,
  shouldRecordMatchLifecycleEvent,
} from '@/lib/match-lifecycle';

type Operation = {
  table: string;
  action: 'select' | 'insert' | 'update';
  payload?: unknown;
  filters: Record<string, unknown>;
};

class FakeQuery {
  private action: Operation['action'] = 'select';
  private payload: unknown;
  private filters: Record<string, unknown> = {};

  constructor(
    private readonly table: string,
    private readonly operations: Operation[],
    private readonly rows: Record<string, any[]>,
  ) {}

  select() {
    this.action = 'select';
    return this;
  }

  insert(payload: unknown) {
    this.action = 'insert';
    this.payload = payload;
    return this;
  }

  update(payload: unknown) {
    this.action = 'update';
    this.payload = payload;
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters[key] = value;
    return this;
  }

  maybeSingle() {
    return this;
  }

  single() {
    return this;
  }

  then(resolve: (value: { data: any; error: any }) => void) {
    this.operations.push({
      table: this.table,
      action: this.action,
      payload: this.payload,
      filters: this.filters,
    });

    if (this.action === 'select') {
      const row = (this.rows[this.table] ?? []).find((candidate) =>
        Object.entries(this.filters).every(([key, value]) => candidate[key] === value),
      );
      resolve({ data: row ?? null, error: null });
      return;
    }

    if (this.action === 'insert' && Array.isArray(this.payload)) {
      resolve({ data: this.payload, error: null });
      return;
    }

    if (this.action === 'insert' && this.table === 'matches') {
      resolve({ data: { id: 'created-match' }, error: null });
      return;
    }

    resolve({ data: null, error: null });
  }
}

const fakeClient = (rows: Record<string, any[]> = {}) => {
  const operations: Operation[] = [];
  return {
    operations,
    client: {
      from: (table: string) => new FakeQuery(table, operations, rows),
    },
  };
};

describe('match lifecycle', () => {
  it('bouwt een consistente match-create row met score snapshot', () => {
    const row = buildMatchCreateRow({
      orgId: 'org-1',
      vacancyId: 'vac-1',
      candidateId: 'cand-1',
      proposedBy: 'user-1',
      score: {
        matchPercent: 82,
        reasoning: 'Sterke skill-match',
        distance: { km: 12, durationMin: 21 },
      },
    });

    expect(row).toMatchObject({
      organization_id: 'org-1',
      vacancy_id: 'vac-1',
      candidate_id: 'cand-1',
      proposed_by: 'user-1',
      status: 'nieuwe_match',
      source: 'eigen_match',
      match_score: 82,
      match_reasoning: 'Sterke skill-match',
      distance_km: 12,
      duration_min: 21,
    });
  });

  it('registreert feedback automatisch voor terminale statussen of toelichting', () => {
    expect(shouldRecordMatchLifecycleEvent({ toStatus: 'gescreend' })).toBe(false);
    expect(shouldRecordMatchLifecycleEvent({ toStatus: 'gescreend', notes: 'gebeld' })).toBe(true);
    expect(shouldRecordMatchLifecycleEvent({ toStatus: 'geaccepteerd' })).toBe(true);
    expect(shouldRecordMatchLifecycleEvent({ toStatus: 'geaccepteerd', mode: 'never' })).toBe(false);
    expect(shouldRecordMatchLifecycleEvent({ toStatus: 'gescreend', mode: 'always' })).toBe(true);
  });

  it('bouwt feedback events met status en score snapshots', () => {
    expect(buildMatchFeedbackEvent({
      orgId: 'org-1',
      matchId: 'match-1',
      fromStatus: 'voorgesteld',
      toStatus: 'afgewezen',
      reasonId: 'reason-1',
      notes: ' Niet passend ',
      actorId: 'user-1',
      scoreSnapshot: 64,
      breakdownSnapshot: { label: 'oranje' } as any,
    })).toEqual({
      organization_id: 'org-1',
      match_id: 'match-1',
      from_status: 'voorgesteld',
      to_status: 'afgewezen',
      reason_id: 'reason-1',
      notes: 'Niet passend',
      created_by: 'user-1',
      match_score_snapshot: 64,
      match_breakdown_snapshot: { label: 'oranje' },
    });
  });

  it('advanceMatchStatus schrijft status en feedback via een enkele lifecycle flow', async () => {
    const { client, operations } = fakeClient();

    await advanceMatchStatus(client, {
      orgId: 'org-1',
      matchId: 'match-1',
      toStatus: 'geaccepteerd',
      actorId: 'user-1',
      currentMatch: {
        id: 'match-1',
        status: 'afspraak_op_kantoor',
        match_score: 91,
        match_breakdown: { label: 'groen' } as any,
      },
    });

    expect(operations).toHaveLength(2);
    expect(operations[0]).toMatchObject({
      table: 'matches',
      action: 'update',
      filters: { organization_id: 'org-1', id: 'match-1' },
    });
    expect(operations[0].payload).toMatchObject({ status: 'geaccepteerd' });
    expect(operations[1]).toMatchObject({
      table: 'match_feedback_events',
      action: 'insert',
    });
    expect(operations[1].payload).toMatchObject({
      organization_id: 'org-1',
      match_id: 'match-1',
      from_status: 'afspraak_op_kantoor',
      to_status: 'geaccepteerd',
      created_by: 'user-1',
      match_score_snapshot: 91,
    });
  });

  it('blokkeert afwijzen zonder feedbackreden voordat er geschreven wordt', async () => {
    const { client, operations } = fakeClient();

    await expect(advanceMatchStatus(client, {
      orgId: 'org-1',
      matchId: 'match-1',
      toStatus: 'afgewezen',
      currentMatch: { id: 'match-1', status: 'voorgesteld' },
    })).rejects.toThrow('Kies een feedbackreden');

    expect(operations).toHaveLength(0);
  });

  it('kan de huidige match zelf laden wanneer een adapter geen snapshot meegeeft', async () => {
    const { client, operations } = fakeClient({
      matches: [{ id: 'match-1', organization_id: 'org-1', status: 'nieuwe_match', match_score: 44 }],
    });

    await advanceMatchStatus(client, {
      orgId: 'org-1',
      matchId: 'match-1',
      toStatus: 'gescreend',
    });

    expect(operations.map((operation) => operation.action)).toEqual(['select', 'update']);
  });
});
