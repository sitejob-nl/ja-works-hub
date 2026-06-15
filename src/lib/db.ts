import { toast } from 'sonner';
import type { PostgrestError } from '@supabase/supabase-js';

/**
 * Small typed helpers over the Supabase PostgREST client.
 *
 * They replace the boilerplate that is currently repeated at ~329 call sites:
 *   const { data, error } = await supabase.from(...).select(...);
 *   if (error) throw error;
 *   return data ?? [];
 *
 * `unwrap`/`unwrapList` keep the exact same semantics (throw on error), so they are a
 * drop-in for any queryFn that already does `if (error) throw error`. They do NOT change
 * error handling for call sites that intentionally swallow errors — leave those as-is.
 */

type PostgrestLike<T> = PromiseLike<{ data: T | null; error: PostgrestError | null }>;

/** Await a PostgREST builder, throw on error, return the (possibly null) typed data. */
export async function unwrap<T>(query: PostgrestLike<T>): Promise<T> {
  const { data, error } = await query;
  if (error) throw error;
  return data as T;
}

/** List variant: returns `[]` instead of `null`, matching the prevailing `data ?? []` idiom. */
export async function unwrapList<T>(query: PostgrestLike<T[]>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/**
 * Turn an unknown error into a single, consistent Dutch toast.
 * Centralizes the duplicated `toast.error(err.message)` handling across the app.
 */
export function toastError(error: unknown, fallback = 'Er ging iets mis'): void {
  const message =
    error instanceof Error ? error.message :
    typeof error === 'string' ? error : '';
  toast.error(message || fallback);
}
