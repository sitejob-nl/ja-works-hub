import { describe, expect, it, vi } from 'vitest';
import { AiAccountingError } from '../../supabase/functions/_shared/ai-accounting';
import {
  createHoursScanHandler, HOURS_SCAN_MAX_FILE_BYTES, type HoursScanPorts,
} from '../../supabase/functions/_shared/hours-scan-handler';

const SOURCE = '33333333-3333-4333-8333-333333333333';
const ORG = '44444444-4444-4444-8444-444444444444';
const USER = '55555555-5555-4555-8555-555555555555';
const MEMBER = '11111111-1111-4111-8111-111111111111';
const DAY = 'aaaaaaa1-1111-4111-8111-111111111111';

const context = (overrides: Record<string, unknown> = {}) => ({
  source_id: SOURCE, week_id: '66666666-6666-4666-8666-666666666666', organization_id: ORG,
  storage_path: `${ORG}/week/abc.jpg`, content_type: 'image/jpeg', byte_size: 2048,
  file_name: 'week37.jpg', page_count: 1,
  members: [{ id: MEMBER, name: 'Jan Kowalski' }],
  days: [{ id: DAY, member_id: MEMBER, work_date: '2026-09-07' }],
  ...overrides,
});

const modelOutput = {
  entries: [{
    employee_text: 'Jan Kowalski', work_date: '2026-09-07', page_number: 1,
    location_text: 'regel 3', total_text: '8:00',
  }],
};

type MockedPorts = { [K in keyof HoursScanPorts]: ReturnType<typeof vi.fn> } & HoursScanPorts;

function ports(overrides: Partial<HoursScanPorts> = {}): MockedPorts {
  return {
    authorize: vi.fn(async () => ({ userId: USER, organizationId: ORG })),
    userRpc: vi.fn(async () => ({ data: context(), error: null })),
    download: vi.fn(async () => new Uint8Array([1, 2, 3])),
    read: vi.fn(async () => ({
      output: modelOutput, model: 'gemini-3.5-flash', requestId: 'req-1',
      costCents: 2, balanceCents: 4876, durationMs: 900,
    })),
    ...overrides,
  } as unknown as MockedPorts;
}

const post = (body: unknown = { source_id: SOURCE }) =>
  new Request('https://edge.test/hours-read-scan', { method: 'POST', body: JSON.stringify(body) });

describe('scan reading endpoint — the request', () => {
  it('answers a preflight without doing any work', async () => {
    const doubles = ports();
    const response = await createHoursScanHandler(doubles)(
      new Request('https://edge.test/hours-read-scan', { method: 'OPTIONS' }));
    expect(response.status).toBe(204);
    expect(doubles.read).not.toHaveBeenCalled();
  });

  it('refuses anything but POST', async () => {
    const response = await createHoursScanHandler(ports())(
      new Request('https://edge.test/hours-read-scan', { method: 'GET' }));
    expect(response.status).toBe(405);
  });

  it('accepts one source identifier and nothing else', async () => {
    for (const body of [{}, { source_id: 'not-a-uuid' }, { source_id: SOURCE, storage_path: 'x' },
      { source_id: SOURCE, model: 'gemini-3.5-flash' }]) {
      const doubles = ports();
      const response = await createHoursScanHandler(doubles)(post(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(doubles.read).not.toHaveBeenCalled();
    }
  });

  it('hands back whatever the authorisation refused with', async () => {
    const refusal = new Response('nee', { status: 403 });
    const doubles = ports({ authorize: vi.fn(async () => refusal) });
    const response = await createHoursScanHandler(doubles)(post());
    expect(response.status).toBe(403);
    expect(doubles.userRpc).not.toHaveBeenCalled();
    expect(doubles.read).not.toHaveBeenCalled();
  });
});

describe('scan reading endpoint — nothing is paid for before the source is known', () => {
  it('translates the database refusals it can name', async () => {
    for (const [code, status] of [['42501', 403], ['22023', 400], ['PT409', 409], ['XX000', 503]] as const) {
      const doubles = ports({ userRpc: vi.fn(async () => ({ data: null, error: { code } })) });
      const response = await createHoursScanHandler(doubles)(post());
      expect(response.status, code).toBe(status);
      expect(doubles.read).not.toHaveBeenCalled();
    }
  });

  it('refuses a context belonging to another organization', async () => {
    const doubles = ports({
      userRpc: vi.fn(async () => ({ data: context({ organization_id: 'other' }), error: null })),
    });
    const response = await createHoursScanHandler(doubles)(post());
    expect(response.status).toBe(500);
    expect(doubles.download).not.toHaveBeenCalled();
    expect(doubles.read).not.toHaveBeenCalled();
  });

  it('refuses a context that answers about another source', async () => {
    const doubles = ports({
      userRpc: vi.fn(async () => ({ data: context({ source_id: 'aaaaaaa9-1111-4111-8111-111111111111' }), error: null })),
    });
    expect((await createHoursScanHandler(doubles)(post())).status).toBe(500);
    expect(doubles.read).not.toHaveBeenCalled();
  });

  it('reads only the path the server gave it', async () => {
    const doubles = ports();
    await createHoursScanHandler(doubles)(post({ source_id: SOURCE }));
    expect(doubles.download).toHaveBeenCalledWith(`${ORG}/week/abc.jpg`);
  });

  it('blocks a file too large to send and says manual entry still works', async () => {
    const doubles = ports({
      userRpc: vi.fn(async () => ({ data: context({ byte_size: HOURS_SCAN_MAX_FILE_BYTES + 1 }), error: null })),
    });
    const response = await createHoursScanHandler(doubles)(post());
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('handmatig');
    expect(doubles.download).not.toHaveBeenCalled();
    expect(doubles.read).not.toHaveBeenCalled();
  });

  it('does not pay for a file it could not fetch back', async () => {
    const doubles = ports({ download: vi.fn(async () => { throw new Error('gone'); }) });
    const response = await createHoursScanHandler(doubles)(post());
    expect(response.status).toBe(503);
    expect(doubles.read).not.toHaveBeenCalled();
  });

  it('refuses to read a delivery that is not a scan or a photo', async () => {
    const doubles = ports({
      userRpc: vi.fn(async () => ({ data: context({ content_type: 'application/vnd.ms-excel' }), error: null })),
    });
    expect((await createHoursScanHandler(doubles)(post())).status).toBe(400);
    expect(doubles.read).not.toHaveBeenCalled();
  });
});

describe('scan reading endpoint — one paid call, and what it costs', () => {
  it('reads once and reports the reading with what it cost', async () => {
    const doubles = ports();
    const response = await createHoursScanHandler(doubles)(post());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(doubles.read).toHaveBeenCalledTimes(1);
    expect(body.reading.ok).toBe(true);
    expect(body.reading.candidates).toHaveLength(1);
    expect(body.reading.candidates[0].dayId).toBe(DAY);
    expect(body.cost_cents).toBe(2);
    expect(body.balance_cents).toBe(4876);
    expect(body.request_id).toBe('req-1');
    expect(body.model).toBe('gemini-3.5-flash');
  });

  it('never sends the employee names along, so a name cannot be pulled towards the list', async () => {
    const doubles = ports();
    await createHoursScanHandler(doubles)(post());
    const sent = JSON.stringify(doubles.read.mock.calls[0][0]);
    expect(sent).not.toContain('Kowalski');
    expect(sent).toContain('2026-09-07');
  });

  it('reports an exhausted budget as such, and says manual entry keeps working', async () => {
    const doubles = ports({
      read: vi.fn(async () => {
        const error = new AiAccountingError('insufficient_credits', 'Onvoldoende beschikbaar AI-tegoed voor deze opdracht.', 402);
        throw error;
      }),
    });
    const response = await createHoursScanHandler(doubles)(post());
    expect(response.status).toBe(402);
    const body = await response.json();
    expect(body.code).toBe('insufficient_credits');
    expect(body.error).toContain('budget');
    expect(body.error.toLowerCase()).toContain('handmatig');
  });

  it('passes a provider outcome that stayed unknown through with its own code', async () => {
    const doubles = ports({
      read: vi.fn(async () => {
        throw new AiAccountingError('ai_provider_outcome_unknown', 'Geen volledig antwoord.', 503);
      }),
    });
    const response = await createHoursScanHandler(doubles)(post());
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('ai_provider_outcome_unknown');
  });

  it('reports an unusable model answer as a blocked reading, with the cost that was still incurred', async () => {
    const doubles = ports({
      read: vi.fn(async () => ({
        output: { entries: 'nonsense' }, model: 'gemini-3.5-flash', requestId: 'req-2',
        costCents: 3, balanceCents: 4875, durationMs: 700,
      })),
    });
    const response = await createHoursScanHandler(doubles)(post());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.reading.ok).toBe(false);
    expect(body.cost_cents).toBe(3);
  });

  it('writes nothing: the only database call is the one that reads the context', async () => {
    const doubles = ports();
    await createHoursScanHandler(doubles)(post());
    expect(doubles.userRpc).toHaveBeenCalledTimes(1);
    expect(doubles.userRpc.mock.calls[0][1]).toBe('hours_get_source_reading_context');
    expect(doubles.userRpc.mock.calls[0][2]).toEqual({ p_source_id: SOURCE });
  });
});
