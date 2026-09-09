import { describe, expect, it } from 'vitest';
import {
  buildScanRequestBody, HOURS_SCAN_DEFAULT_MODEL, parseScanResponse, scanRequestUrl,
} from '../../supabase/functions/_shared/hours-scan-gemini';
import { aiPricing } from '../../supabase/functions/_shared/ai-accounting';

const file = { mimeType: 'image/jpeg', bytes: new Uint8Array([1, 2, 3, 4]), fileName: 'week37.jpg' };
const build = (overrides: Record<string, unknown> = {}) => buildScanRequestBody({
  file, weekDates: ['2026-09-07', '2026-09-08'], pageCount: 1, ...overrides,
});

describe('scan request', () => {
  it('sends the delivered bytes inline with their own media type', () => {
    const body = build();
    const parts = body.contents[0].parts as Record<string, any>[];
    expect(parts[0].inlineData.mimeType).toBe('image/jpeg');
    expect(parts[0].inlineData.data).toBe('AQIDBA==');
  });

  it('names the work dates of this week so a written weekday can be placed', () => {
    const text = JSON.stringify(build());
    expect(text).toContain('2026-09-07');
    expect(text).toContain('2026-09-08');
  });

  it('bounds the answer, which the central ledger requires before it will reserve', () => {
    const body = build();
    expect(body.generationConfig.maxOutputTokens).toBeGreaterThan(0);
    expect(body.generationConfig.maxOutputTokens).toBeLessThanOrEqual(65536);
    expect(body.generationConfig.candidateCount).toBeUndefined();
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema).toBeTruthy();
    expect(body.stream).toBeUndefined();
  });

  it('demands every field, because an optional one comes back missing', () => {
    // Structured output fills what it is required to fill. Leaving total_text
    // optional cost a real reading: the model returned names and dates and no
    // hours at all, and every line was honestly skipped. An empty string is the
    // way to say "nothing is written here"; a missing key is not.
    const schema = build().generationConfig.responseSchema as Record<string, any>;
    const entry = schema.properties.entries.items;
    expect(entry.required.sort()).toEqual(Object.keys(entry.properties).sort());
    const unreadable = schema.properties.unreadable.items;
    expect(unreadable.required.sort()).toEqual(Object.keys(unreadable.properties).sort());
    expect(schema.required).toEqual(['entries', 'unreadable']);
  });

  it('asks only for a shape the reader knows how to judge', () => {
    const schema = build().generationConfig.responseSchema as Record<string, any>;
    const entry = schema.properties.entries.items.properties;
    expect(Object.keys(entry).sort()).toEqual([
      'break_text', 'categories', 'employee_text', 'end_text', 'location_text',
      'no_hours_text', 'page_number', 'start_text', 'total_text', 'uncertain', 'work_date',
    ]);
    expect(entry.uncertain.items.enum).toEqual(['employee', 'date', 'total', 'shift', 'break', 'categories', 'reason']);
  });

  it('treats the scan as data and says so, because a timesheet can carry text', () => {
    const instruction = JSON.stringify(build().systemInstruction);
    expect(instruction.toLowerCase()).toContain('instructie');
  });

  it('uses a model with a checked tariff at the exact metered address', () => {
    expect(() => aiPricing('gemini', HOURS_SCAN_DEFAULT_MODEL)).not.toThrow();
    expect(scanRequestUrl(HOURS_SCAN_DEFAULT_MODEL)).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${HOURS_SCAN_DEFAULT_MODEL}:generateContent`);
  });
});

const answer = (text: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], ...extra,
});

describe('scan response', () => {
  it('reads the answer the model returned', () => {
    expect(parseScanResponse(answer('{"entries":[]}'))).toEqual({ entries: [] });
  });

  it('reads an answer the model wrapped in a code fence', () => {
    expect(parseScanResponse(answer('```json\n{"entries":[]}\n```'))).toEqual({ entries: [] });
  });

  it('refuses an answer that was cut off, instead of half a reading', () => {
    const cut = JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"entries":[' }] }, finishReason: 'MAX_TOKENS' }] });
    expect(() => parseScanResponse(cut)).toThrow(/onvolledig/i);
  });

  it('refuses a blocked prompt', () => {
    expect(() => parseScanResponse(answer('{}', { promptFeedback: { blockReason: 'SAFETY' } }))).toThrow();
  });

  it('refuses an empty answer', () => {
    expect(() => parseScanResponse(answer('   '))).toThrow();
    expect(() => parseScanResponse('niet eens json')).toThrow();
  });
});

describe('one list, not six', () => {
  it('offers the model exactly the uncertainties the reader accepts', async () => {
    // A label the model may report but the reader rejects fails the whole paid
    // reading; a label the reader accepts but the model is never offered can
    // never be reported. Both are one-word drifts between two files.
    const { REPORTABLE_UNCERTAINTY } = await import('../../supabase/functions/_shared/hours-scan');
    const schema = build().generationConfig.responseSchema as Record<string, any>;
    expect(schema.properties.entries.items.properties.uncertain.items.enum)
      .toEqual([...REPORTABLE_UNCERTAINTY]);
  });

  it('reads the same media types the endpoint and the screen accept', async () => {
    const kernel = await import('../../supabase/functions/_shared/hours-scan');
    const { isReadableScan } = await import('@/lib/hours-workbook-file');
    for (const type of kernel.HOURS_READABLE_SCAN_TYPES) expect(isReadableScan(type)).toBe(true);
    for (const type of ['application/vnd.ms-excel', 'text/csv']) expect(isReadableScan(type)).toBe(false);
  });

  it('keeps the browser and the kernel on one uncertainty vocabulary', async () => {
    const kernel = await import('../../supabase/functions/_shared/hours-scan');
    const { HOURS_UNCERTAIN_FIELDS } = await import('@/lib/hours-sources');
    expect([...HOURS_UNCERTAIN_FIELDS]).toEqual([...kernel.SCAN_UNCERTAIN_FIELDS]);
  });
});
