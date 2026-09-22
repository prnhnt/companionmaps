import { useEffect, useState } from "react";

/**
 * Keeps the screen on while driving.
 *
 * A convoy display that blanks every thirty seconds is a convoy display
 * nobody looks at — and waking a phone in a cradle is exactly the sort of
 * fiddling this app exists to avoid. The lock is dropped the moment the app
 * is backgrounded, and re-taken when it returns, because holding it otherwise
 * would be rude to the battery.
 */
export function useWakeLock(active: boolean): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      setHeld(false);
      return;
    }

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async (): Promise<void> => {
      if (document.visibilityState !== "visible") return;
      try {
        sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void sentinel.release();
          sentinel = null;
          return;
        }
        setHeld(true);
        sentinel.addEventListener("release", () => setHeld(false));
      } catch {
        // Denied, or the browser dropped it (low battery is a common reason).
        setHeld(false);
      }
    };

    const onVisibility = (): void => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => undefined);
      sentinel = null;
      setHeld(false);
    };
  }, [active]);

  return held;
}
