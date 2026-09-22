import { bearingDeg, haversineMeters, type LatLng } from "./geo.js";
import type { Convoy, Member, MemberStatus } from "./convoy.js";
import { ARRIVAL_RADIUS_M, estimateProgress, type Progress } from "./eta.js";

/** Below this speed a fresh member is parked rather than driving. */
const MOVING_SPEED_MPS = 1.5;

/** Progress difference under which two cars are "together". */
const ALONGSIDE_M = 400;

/** Convoy spread past which the group is coming apart, when time is unknown. */
export const STRETCHED_SPREAD_M = 3000;

/**
 * Arrival spread past which the convoy counts as stretched.
 *
 * Time, not distance, is the unit a driver actually feels: 4 km apart on a
 * motorway is two minutes and nobody cares, while 4 km apart through a city
 * is a quarter of an hour and someone is going to be standing in a car park.
 */
export const STRETCHED_ARRIVAL_SPAN_S = 300;

export interface StatusThresholds {
  staleAfterMs: number;
  offlineAfterMs: number;
}

export const DEFAULT_STATUS_THRESHOLDS: StatusThresholds = {
  staleAfterMs: 45_000,
  offlineAfterMs: 300_000,
};

/**
 * Status is derived, never reported. A device that claims to be "driving"
 * while its last fix is four minutes old is stale, whatever it says.
 */
export function deriveStatus(
  member: Member,
  destination: LatLng | null,
  now: number,
  thresholds: StatusThresholds = DEFAULT_STATUS_THRESHOLDS,
): MemberStatus {
  const position = member.position;
  if (!position) return member.connected ? "stale" : "offline";

  const fixAge = now - position.at;
  if (fixAge > thresholds.offlineAfterMs) return "offline";

  if (destination && haversineMeters(position, destination) <= ARRIVAL_RADIUS_M) {
    return "arrived";
  }

  if (fixAge > thresholds.staleAfterMs) return "stale";

  const speed = position.speedMps;
  if (speed != null && speed < MOVING_SPEED_MPS) return "stopped";

  return "driving";
}

export type RelativeStanding = "ahead" | "behind" | "alongside" | "unknown";

/**
 * Everything one member needs to know about one other member — the shape the
 * companion cards, the side-by-side panel and the car projection all read.
 */
export interface CompanionView {
  member: Member;
  isYou: boolean;
  progress: Progress | null;
  /** Direct line between the two cars, in metres. */
  distanceFromYouM: number | null;
  /** Which way to look out of the window, in degrees from true north. */
  bearingFromYouDeg: number | null;
  /** Their arrival minus yours, in seconds. Positive = they get there later. */
  etaDeltaS: number | null;
  standing: RelativeStanding;
  fixAgeMs: number;
  isStale: boolean;
}

function standingOf(
  yours: Progress | null,
  theirs: Progress | null,
): RelativeStanding {
  if (!yours || !theirs) return "unknown";
  const delta = theirs.distanceM - yours.distanceM;
  if (Math.abs(delta) <= ALONGSIDE_M) return "alongside";
  return delta < 0 ? "ahead" : "behind";
}

export function deriveCompanionViews(
  convoy: Convoy,
  viewerId: string,
  now: number,
  thresholds: StatusThresholds = DEFAULT_STATUS_THRESHOLDS,
): CompanionView[] {
  const destination = convoy.destination;
  const viewer = convoy.members.find((m) => m.id === viewerId) ?? null;
  const viewerProgress = viewer ? estimateProgress(viewer, destination, now) : null;
  const viewerPosition = viewer?.position ?? null;

  const views = convoy.members.map((member): CompanionView => {
    const progress = estimateProgress(member, destination, now);
    const position = member.position;

    const distanceFromYouM =
      viewerPosition && position && member.id !== viewerId
        ? haversineMeters(viewerPosition, position)
        : member.id === viewerId
          ? 0
          : null;

    const bearingFromYouDeg =
      viewerPosition && position && member.id !== viewerId
        ? bearingDeg(viewerPosition, position)
        : null;

    const etaDeltaS =
      viewerProgress && progress && member.id !== viewerId
        ? (progress.arrivalAt - viewerProgress.arrivalAt) / 1000
        : null;

    const fixAgeMs = position ? now - position.at : Number.POSITIVE_INFINITY;

    return {
      member,
      isYou: member.id === viewerId,
      progress,
      distanceFromYouM,
      bearingFromYouDeg,
      etaDeltaS,
      standing:
        member.id === viewerId
          ? "alongside"
          : standingOf(viewerProgress, progress),
      fixAgeMs,
      isStale: fixAgeMs > thresholds.staleAfterMs,
    };
  });

  // Convoy order: whoever is closest to the destination leads. Members with no
  // progress (no fix yet, or no destination set) sort last, by join time.
  return views.sort((a, b) => {
    if (a.progress && b.progress) return a.progress.distanceM - b.progress.distanceM;
    if (a.progress) return -1;
    if (b.progress) return 1;
    return a.member.joinedAt - b.member.joinedAt;
  });
}

export interface ConvoyStats {
  total: number;
  connected: number;
  arrived: number;
  /** Gap between the front-most and back-most car, in metres. */
  spreadM: number | null;
  frontMemberId: string | null;
  backMemberId: string | null;
  isStretched: boolean;
  /** Members whose fix has aged out — the ones you actually worry about. */
  stragglerIds: string[];
  /** Seconds between the first and last predicted arrival. */
  arrivalSpanS: number | null;
  lastArrivalAt: number | null;
  allArrived: boolean;
}

/**
 * Whole-convoy health.
 *
 * Spread is measured along progress-to-destination when there is one, because
 * that is what "are we still together" means on a road. Without a destination
 * it falls back to the widest direct gap between any two cars.
 */
export function deriveConvoyStats(
  convoy: Convoy,
  now: number,
  thresholds: StatusThresholds = DEFAULT_STATUS_THRESHOLDS,
): ConvoyStats {
  const members = convoy.members;
  const destination = convoy.destination;

  const withProgress = members
    .map((member) => ({ member, progress: estimateProgress(member, destination, now) }))
    .filter((entry): entry is { member: Member; progress: Progress } => entry.progress !== null);

  let spreadM: number | null = null;
  let frontMemberId: string | null = null;
  let backMemberId: string | null = null;

  if (destination && withProgress.length >= 2) {
    const sorted = [...withProgress].sort((a, b) => a.progress.distanceM - b.progress.distanceM);
    const front = sorted[0]!;
    const back = sorted[sorted.length - 1]!;
    spreadM = back.progress.distanceM - front.progress.distanceM;
    frontMemberId = front.member.id;
    backMemberId = back.member.id;
  } else {
    const located = members.filter(
      (m): m is Member & { position: LatLng } => m.position !== null,
    );
    if (located.length >= 2) {
      let widest = 0;
      for (let i = 0; i < located.length; i += 1) {
        for (let j = i + 1; j < located.length; j += 1) {
          const gap = haversineMeters(located[i]!.position, located[j]!.position);
          if (gap > widest) {
            widest = gap;
            frontMemberId = located[i]!.id;
            backMemberId = located[j]!.id;
          }
        }
      }
      spreadM = widest;
    }
  }

  const arrivals = withProgress.map((entry) => entry.progress.arrivalAt);
  const arrivalSpanS =
    arrivals.length >= 2 ? (Math.max(...arrivals) - Math.min(...arrivals)) / 1000 : null;

  const stragglerIds = members
    .filter((member) => {
      const status = deriveStatus(member, destination, now, thresholds);
      return status === "stale" || status === "offline";
    })
    .map((member) => member.id);

  const arrived = members.filter(
    (member) => deriveStatus(member, destination, now, thresholds) === "arrived",
  ).length;

  return {
    total: members.length,
    connected: members.filter((m) => m.connected).length,
    arrived,
    spreadM,
    frontMemberId,
    backMemberId,
    isStretched:
      arrivalSpanS != null
        ? arrivalSpanS > STRETCHED_ARRIVAL_SPAN_S
        : spreadM != null && spreadM > STRETCHED_SPREAD_M,
    stragglerIds,
    arrivalSpanS,
    lastArrivalAt: arrivals.length > 0 ? Math.max(...arrivals) : null,
    allArrived: members.length > 0 && arrived === members.length,
  };
}
