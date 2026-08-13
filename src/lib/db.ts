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

/** Een delete-builder waar `.select()` nog op kan; de helper zet die zelf. */
type DeletableBuilder = {
  select: (columns: string) => PostgrestLike<unknown[]>;
};

/**
 * Delete-variant: throwt óók wanneer de delete 0 rijen raakte.
 *
 * PostgREST geeft bij een DELETE die door RLS wordt geblokkeerd geen error terug maar
 * een lege set — `if (error) throw error` slaat dan nooit aan en de UI meldt ten onrechte
 * succes terwijl de rij blijft staan (gemeld op vehicle_assignments, 2026-08-13).
 *
 * De helper zet `.select('id')` zélf, zodat een call-site die dat vergeet geen false
 * negative oplevert. Retourneert het aantal verwijderde rijen, bruikbaar voor bulk-acties
 * ("3 van 5 verwijderd").
 */
export async function unwrapDeleted(
  query: DeletableBuilder,
  message = 'Verwijderen niet toegestaan — je hebt hiervoor mogelijk beheerdersrechten nodig.',
): Promise<number> {
  const { data, error } = await query.select('id');
  if (error) throw error;
  const deleted = data?.length ?? 0;
  if (deleted === 0) throw new Error(message);
  return deleted;
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
