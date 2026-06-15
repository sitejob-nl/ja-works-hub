import { describe, it, expect, vi, beforeEach } from 'vitest';

const errorSpy = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (msg: string) => errorSpy(msg) } }));

import { unwrap, unwrapList, toastError } from '@/lib/db';

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
