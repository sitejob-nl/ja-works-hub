import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * useState-achtige hook die een (filter)waarde aan een URL-query-param koppelt.
 *
 * Winst: de waarde is deep-link-baar (bv. `/uren?status=rood`), deelbaar en
 * blijft behouden bij back-navigatie. Wanneer de waarde gelijk is aan de default
 * wordt de param uit de URL verwijderd zodat de URL schoon blijft.
 *
 * Drop-in vervanging voor `useState('all')` op lijstpagina-filters.
 */
export function useSearchParamState<T extends string>(
  key: string,
  defaultValue: T,
): [T, (value: T) => void] {
  const [params, setParams] = useSearchParams();
  const value = (params.get(key) as T) ?? defaultValue;

  const setValue = useCallback(
    (next: T) => {
      setParams(
        (prev) => {
          const updated = new URLSearchParams(prev);
          if (!next || next === defaultValue) updated.delete(key);
          else updated.set(key, next);
          return updated;
        },
        { replace: true },
      );
    },
    [key, defaultValue, setParams],
  );

  return [value, setValue];
}
