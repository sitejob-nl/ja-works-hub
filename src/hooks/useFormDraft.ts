import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

// Bewaart formulier-state in sessionStorage zodat ingevulde gegevens niet verloren gaan bij
// een per ongeluk weg-navigeren of een refresh. Bewust sessionStorage (tab-scope) i.p.v.
// localStorage: een concept overleeft een refresh/navigatie binnen dezelfde sessie, maar
// blijft niet eindeloos hangen tussen sessies door.
//
// Gebruik: geef dezelfde `key`, de form-state en de raw React-setter mee. Roep `clearDraft()`
// aan zodra het formulier succesvol is opgeslagen. Zet `enabled: false` om te stoppen met
// bewaren (bv. nadat het record is aangemaakt).
export function useFormDraft<T extends object>(
  key: string,
  form: T,
  setForm: Dispatch<SetStateAction<T>>,
  options: { enabled?: boolean } = {},
): { clearDraft: () => void } {
  const enabled = options.enabled ?? true;
  // Hydratie eerst afronden vóór we gaan bewaren — anders zou de persist-effect bij mount
  // het opgeslagen concept overschrijven met de lege begin-state.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setHydrated(true);
      return;
    }
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          setForm((prev) => ({ ...prev, ...parsed }));
        }
      }
    } catch {
      /* corrupt concept genegeerd */
    }
    setHydrated(true);
    // Eénmalig bij mount; `key` is stabiel per formulier.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!hydrated || !enabled) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(form));
    } catch {
      /* opslag vol of niet beschikbaar — concept gaat dan gewoon niet bewaard */
    }
  }, [key, form, hydrated, enabled]);

  const clearDraft = () => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* noop */
    }
  };

  return { clearDraft };
}
