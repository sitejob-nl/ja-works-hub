import { lazy, type ComponentType } from 'react';

const ROUTE_RELOAD_KEY = 'ja-works-route-chunk-reload';
const RELOAD_WINDOW_MS = 60_000;

const isRouteChunkLoadError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|loading chunk \d+ failed|chunkloaderror|load failed/i.test(message);
};

const readLastReload = () => {
  try {
    return JSON.parse(window.sessionStorage.getItem(ROUTE_RELOAD_KEY) || 'null') as { href?: string; at?: number } | null;
  } catch {
    return null;
  }
};

const rememberReload = () => {
  try {
    window.sessionStorage.setItem(ROUTE_RELOAD_KEY, JSON.stringify({ href: window.location.href, at: Date.now() }));
  } catch {
    // Reloading is still the right recovery path if sessionStorage is unavailable.
  }
};

const canReloadForChunk = () => {
  if (typeof window === 'undefined') return false;
  const last = readLastReload();
  return !last || last.href !== window.location.href || !last.at || Date.now() - last.at > RELOAD_WINDOW_MS;
};

/**
 * Wrap route-level lazy imports so a stale service-worker/browser cache after a
 * deploy does not leave users on a broken page. Missing chunks are usually fixed
 * by one reload; if that reload already happened, surface the real error.
 */
export function lazyRoute<T extends ComponentType<unknown>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const mod = await load();
      try {
        if (typeof window !== 'undefined') window.sessionStorage.removeItem(ROUTE_RELOAD_KEY);
      } catch {
        // Ignore storage access errors.
      }
      return mod;
    } catch (error) {
      if (isRouteChunkLoadError(error) && canReloadForChunk()) {
        rememberReload();
        window.location.reload();
        return new Promise<{ default: T }>(() => {});
      }
      throw error;
    }
  });
}
