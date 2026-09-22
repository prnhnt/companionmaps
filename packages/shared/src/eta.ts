import { haversineMeters, type LatLng } from "./geo.js";
import type { Member, Position } from "./convoy.js";

/** Within this radius of the destination a member counts as arrived. */
export const ARRIVAL_RADIUS_M = 150;

/** Straight-line distance under-reports road distance. This is the median
 *  ratio for inter-city driving; it is a placeholder that a real routing
 *  response always beats. */
export const ROAD_DETOUR_FACTOR = 1.28;

/** A cached provider route older than this is no longer trusted. */
export const ROUTE_MAX_AGE_MS = 90_000;

/** Window used to average out traffic lights and short stops. */
const SPEED_WINDOW_MS = 300_000;

const MIN_EFFECTIVE_SPEED_MPS = 8.3; // 30 km/h
const MAX_EFFECTIVE_SPEED_MPS = 36.1; // 130 km/h
const DEFAULT_SPEED_MPS = 20; // 72 km/h

export type ProgressSource = "route" | "estimate";

export interface Progress {
  /** Remaining distance to the destination, in metres. */
  distanceM: number;
  /** Remaining travel time, in seconds. */
  durationS: number;
  /** Absolute predicted arrival time (epoch ms). */
  arrivalAt: number;
  /** Speed used for the estimate, in m/s. */
  speedMps: number;
  source: ProgressSource;
  hasArrived: boolean;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Average ground speed over the recent trail.
 *
 * Distance-over-time across the whole window is preferred to averaging the
 * per-fix speed readings, because it folds stops into the average — which is
 * what an ETA actually needs. Reported speeds are the fallback for devices
 * that give a speed but a sparse trail.
 */
export function rollingSpeedMps(
  trail: readonly Position[],
  now: number,
  windowMs: number = SPEED_WINDOW_MS,
): number | null {
  const recent = trail.filter((p) => now - p.at <= windowMs);

  if (recent.length >= 2) {
    const first = recent[0]!;
    const last = recent[recent.length - 1]!;
    const elapsedS = (last.at - first.at) / 1000;

    if (elapsedS >= 5) {
      let meters = 0;
      for (let i = 1; i < recent.length; i += 1) {
        meters += haversineMeters(recent[i - 1]!, recent[i]!);
      }
      return meters / elapsedS;
    }
  }

  const reported = recent
    .map((p) => p.speedMps)
    .filter((s): s is number => s != null && Number.isFinite(s) && s >= 0);

  if (reported.length === 0) return null;
  return reported.reduce((sum, s) => sum + s, 0) / reported.length;
}

/**
 * Remaining distance and time for one member.
 *
 * Uses the provider route when it is fresh, and falls back to a
 * detour-corrected straight line at the member's own rolling speed. The
 * fallback is deliberately conservative: a convoy needs everyone's numbers to
 * be comparable more than it needs any one of them to be exact.
 */
export function estimateProgress(
  member: Member,
  destination: LatLng | null,
  now: number,
): Progress | null {
  const position = member.position;
  if (!position || !destination) return null;

  const straightM = haversineMeters(position, destination);
  const hasArrived = straightM <= ARRIVAL_RADIUS_M;

  const sampled = rollingSpeedMps(member.trail, now);
  const speedMps = clamp(
    sampled ?? DEFAULT_SPEED_MPS,
    MIN_EFFECTIVE_SPEED_MPS,
    MAX_EFFECTIVE_SPEED_MPS,
  );

  if (hasArrived) {
    return {
      distanceM: 0,
      durationS: 0,
      arrivalAt: member.arrivedAt ?? now,
      speedMps,
      source: member.route ? "route" : "estimate",
      hasArrived: true,
    };
  }

  const route = member.route;
  if (route && now - route.computedAt <= ROUTE_MAX_AGE_MS) {
    return {
      distanceM: route.distanceM,
      durationS: route.durationS,
      arrivalAt: now + route.durationS * 1000,
      speedMps: route.durationS > 0 ? route.distanceM / route.durationS : speedMps,
      source: "route",
      hasArrived: false,
    };
  }

  const distanceM = straightM * ROAD_DETOUR_FACTOR;
  const durationS = distanceM / speedMps;

  return {
    distanceM,
    durationS,
    arrivalAt: now + durationS * 1000,
    speedMps,
    source: "estimate",
    hasArrived: false,
  };
}
