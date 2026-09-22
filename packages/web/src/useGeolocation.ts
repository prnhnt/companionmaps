import { useCallback, useEffect, useRef, useState } from "react";

import { bearingDeg, haversineMeters, type LatLng } from "@companionmaps/shared";

import type { Fix } from "./useConvoy.js";

export type GeolocationMode = "off" | "live" | "simulated";

export interface GeolocationState {
  mode: GeolocationMode;
  fix: Fix | null;
  error: string | null;
  supported: boolean;
}

/** How often a fix is pushed upstream. Faster drains the battery for nothing. */
const REPORT_INTERVAL_MS = 2000;

/**
 * The driver's own position.
 *
 * "simulated" exists because this is a convoy app: demoing it, or developing
 * it at a desk, otherwise needs a car. It drives a straight line toward the
 * shared destination at a plausible speed.
 */
export function useGeolocation(
  onFix: (fix: Fix) => void,
  destination: LatLng | null,
  simulateFrom?: LatLng | null,
): GeolocationState & { setMode: (mode: GeolocationMode) => void } {
  const supported = typeof navigator !== "undefined" && "geolocation" in navigator;

  const [mode, setMode] = useState<GeolocationMode>("off");
  const [fix, setFix] = useState<Fix | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFixRef = useRef(onFix);
  onFixRef.current = onFix;

  const lastSentRef = useRef(0);
  const simPositionRef = useRef<LatLng | null>(null);
  const destinationRef = useRef(destination);
  destinationRef.current = destination;

  const publish = useCallback((next: Fix) => {
    setFix(next);
    const now = Date.now();
    if (now - lastSentRef.current < REPORT_INTERVAL_MS) return;
    lastSentRef.current = now;
    onFixRef.current(next);
  }, []);

  useEffect(() => {
    if (mode !== "live" || !supported) return;

    const watchId = navigator.geolocation.watchPosition(
      (browserPosition) => {
        setError(null);
        publish({
          lat: browserPosition.coords.latitude,
          lng: browserPosition.coords.longitude,
          headingDeg: browserPosition.coords.heading,
          speedMps: browserPosition.coords.speed,
          accuracyM: browserPosition.coords.accuracy,
        });
      },
      (geoError) => setError(geoError.message),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20_000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [mode, supported, publish]);

  useEffect(() => {
    if (mode !== "simulated") return;

    simPositionRef.current ??= simulateFrom ?? { lat: 52.5208, lng: 13.4095 };

    const SPEED_MPS = 24;
    const timer = window.setInterval(() => {
      const current = simPositionRef.current;
      const target = destinationRef.current;
      if (!current) return;

      if (!target) {
        publish({ ...current, headingDeg: 0, speedMps: 0, accuracyM: 5 });
        return;
      }

      const remaining = haversineMeters(current, target);
      const heading = bearingDeg(current, target);
      const step = Math.min(SPEED_MPS * 2, remaining);

      // Walk toward the destination in a straight line; good enough to drive
      // the UI, and honest about being a simulation.
      const fraction = remaining > 0 ? step / remaining : 0;
      const next: LatLng = {
        lat: current.lat + (target.lat - current.lat) * fraction,
        lng: current.lng + (target.lng - current.lng) * fraction,
      };

      simPositionRef.current = next;
      publish({ ...next, headingDeg: heading, speedMps: remaining > 20 ? SPEED_MPS : 0, accuracyM: 5 });
    }, 2000);

    return () => window.clearInterval(timer);
  }, [mode, simulateFrom, publish]);

  return { mode, fix, error, supported, setMode };
}
