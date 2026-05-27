import { supabase } from '@/integrations/supabase/client';

export const SESSION_IDLE_TIMEOUT_MS = 60 * 60 * 1000;

const RECENT_ITEMS_PREFIX = 'recent-items-';

export function clearSessionUiState() {
  try {
    Object.keys(localStorage)
      .filter((key) => key.startsWith(RECENT_ITEMS_PREFIX))
      .forEach((key) => localStorage.removeItem(key));
  } catch {
    // Ignore storage access errors; sign-out should still continue.
  }

  try {
    Object.keys(sessionStorage)
      .filter((key) => key.startsWith(RECENT_ITEMS_PREFIX))
      .forEach((key) => sessionStorage.removeItem(key));
  } catch {
    // Ignore storage access errors; sign-out should still continue.
  }
}

export async function signOutAndRedirect(loginPath: string) {
  clearSessionUiState();
  await supabase.auth.signOut();
  window.location.replace(loginPath);
}
