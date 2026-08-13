import { describe, it, expect, vi, beforeEach } from 'vitest';

const errorSpy = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (msg: string) => errorSpy(msg) } }));

import { unwrap, unwrapList, unwrapDeleted, toastError } from '@/lib/db';

/** Bootst een PostgREST delete-builder na: `.select(cols)` levert het resultaat. */
const deleteBuilder = (result: { data: unknown[] | null; error: any }) => {
  const select = vi.fn(() => Promise.resolve(result));
  return { builder: { select } as any, select };
};

describe('unwrap', () => {
  it('returns data when there is no error', async () => {
    const res = await unwrap(Promise.resolve({ data: { id: '1' }, error: null }));
    expect(res).toEqual({ id: '1' });
  });

  it('returns null data unchanged', async () => {
    expect(await unwrap(Promise.resolve({ data: null, error: null }))).toBeNull();
  });

  it('throws the postgrest error', async () => {
    const error = { message: 'boom' } as any;
    await expect(unwrap(Promise.resolve({ data: null, error }))).rejects.toBe(error);
  });
});

describe('unwrapList', () => {
  it('returns the array', async () => {
    expect(await unwrapList(Promise.resolve({ data: [1, 2], error: null }))).toEqual([1, 2]);
  });

  it('coalesces null data to an empty array', async () => {
    expect(await unwrapList(Promise.resolve({ data: null, error: null }))).toEqual([]);
  });

  it('throws on error', async () => {
    const error = { message: 'nope' } as any;
    await expect(unwrapList(Promise.resolve({ data: null, error }))).rejects.toBe(error);
  });
});

describe('unwrapDeleted', () => {
  it('vraagt zelf de geraakte rijen op, zodat een call-site dat niet kan vergeten', async () => {
    const { builder, select } = deleteBuilder({ data: [{ id: '1' }], error: null });
    await unwrapDeleted(builder);
    expect(select).toHaveBeenCalledWith('id');
  });

  it('geeft het aantal verwijderde rijen terug', async () => {
    const { builder } = deleteBuilder({ data: [{ id: '1' }, { id: '2' }], error: null });
    expect(await unwrapDeleted(builder)).toBe(2);
  });

  // De kern van de bug: RLS weigert stil, PostgREST geeft geen error maar 0 rijen.
  it('throwt wanneer de delete 0 rijen raakte', async () => {
    const { builder } = deleteBuilder({ data: [], error: null });
    await expect(unwrapDeleted(builder, 'Niet toegestaan')).rejects.toThrow('Niet toegestaan');
  });

  it('throwt ook bij null data', async () => {
    const { builder } = deleteBuilder({ data: null, error: null });
    await expect(unwrapDeleted(builder)).rejects.toThrow();
  });

  it('throwt de postgrest error ongewijzigd door', async () => {
    const error = { message: 'boom' } as any;
    const { builder } = deleteBuilder({ data: null, error });
    await expect(unwrapDeleted(builder)).rejects.toBe(error);
  });
});

describe('toastError', () => {
  beforeEach(() => errorSpy.mockClear());

  it('uses an Error message', () => {
    toastError(new Error('kapot'));
    expect(errorSpy).toHaveBeenCalledWith('kapot');
  });

  it('uses a string error verbatim', () => {
    toastError('mislukt');
    expect(errorSpy).toHaveBeenCalledWith('mislukt');
  });

  it('falls back for an unknown error type', () => {
    toastError(null);
    expect(errorSpy).toHaveBeenCalledWith('Er ging iets mis');
  });

  it('falls back when the Error message is empty', () => {
    toastError(new Error(''));
    expect(errorSpy).toHaveBeenCalledWith('Er ging iets mis');
  });

  it('respects a custom fallback', () => {
    toastError(undefined, 'Opslaan mislukt');
    expect(errorSpy).toHaveBeenCalledWith('Opslaan mislukt');
  });
});
