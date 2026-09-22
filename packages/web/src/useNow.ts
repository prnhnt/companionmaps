import { useEffect, useState } from "react";

/**
 * A clock that re-renders on an interval.
 *
 * Almost everything on screen is a function of elapsed time — ETAs, fix ages,
 * "stale" badges. Without this they would only move when a packet arrived,
 * which is precisely when they are least trustworthy.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}
