import { useEffect, useRef } from 'react';
import { SESSION_IDLE_TIMEOUT_MS } from '@/lib/session-security';

const ACTIVITY_EVENTS = [
  'click',
  'keydown',
  'mousemove',
  'mousedown',
  'scroll',
  'touchstart',
] as const;

export function useSessionIdleTimeout(active: boolean, onTimeout: () => void | Promise<void>) {
  const onTimeoutRef = useRef(onTimeout);

  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  useEffect(() => {
    if (!active) return;

    let timeoutId: number | undefined;

    const resetTimer = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        void onTimeoutRef.current();
      }, SESSION_IDLE_TIMEOUT_MS);
    };

    resetTimer();
    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, resetTimer, { passive: true });
    });

    return () => {
      window.clearTimeout(timeoutId);
      ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, resetTimer);
      });
    };
  }, [active]);
}
