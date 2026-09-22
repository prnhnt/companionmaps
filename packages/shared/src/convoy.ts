import type { LatLng } from "./geo.js";

/** A single GPS fix, as reported by a device. */
export interface Position extends LatLng {
  /** Degrees clockwise from true north; null when the device cannot tell. */
  headingDeg: number | null;
  /** Ground speed in m/s; null when unknown. */
  speedMps: number | null;
  /** Horizontal accuracy radius in metres; null when unknown. */
  accuracyM: number | null;
  /** Server-stamped receipt time (epoch ms). Never trust device clocks. */
  at: number;
}

export type MemberStatus =
  /** Moving, fix is fresh. */
  | "driving"
  /** Fix is fresh but the car is not moving. */
  | "stopped"
  /** Inside the arrival radius of the destination. */
  | "arrived"
  /** Connected recently but the last fix has aged out. */
  | "stale"
  /** Socket closed, or no fix for a long time. */
  | "offline";

export type PingKind =
  | "rest-stop"
  | "fuel"
  | "slow-down"
  | "wait-for-me"
  | "lost-you"
  | "on-my-way"
  | "help";

export interface Ping {
  id: string;
  from: string;
  kind: PingKind;
  at: number;
  /** Where the sender was when they pressed it. */
  at_position: LatLng | null;
}

export interface Waypoint {
  id: string;
  label: string;
  lat: number;
  lng: number;
  addedBy: string;
  addedAt: number;
}

export interface Destination {
  label: string;
  lat: number;
  lng: number;
  /** Who set it, and when — a convoy destination is a shared, auditable fact. */
  setBy: string;
  setAt: number;
}

/** A route leg computed by the routing provider, cached on the member. */
export interface RouteEstimate {
  distanceM: number;
  durationS: number;
  /** When this estimate was computed (epoch ms). Ages out. */
  computedAt: number;
  /** Encoded polyline of the remaining route, if the provider returned one. */
  geometry: string | null;
}

export interface Member {
  id: string;
  name: string;
  /** Hex colour used for this member's marker, trail and card accent. */
  color: string;
  /** Free-text, e.g. "Blue Golf" — helps spot each other at a junction. */
  vehicle: string | null;
  isLead: boolean;
  position: Position | null;
  /** Newest-last breadcrumb trail, capped by the server. */
  trail: Position[];
  status: MemberStatus;
  batteryPct: number | null;
  joinedAt: number;
  lastSeenAt: number;
  arrivedAt: number | null;
  /** Latest provider route to the shared destination, when available. */
  route: RouteEstimate | null;
  connected: boolean;
}

export interface Convoy {
  id: string;
  /** Short human-shareable join code, e.g. "TRK-4H2". */
  code: string;
  name: string;
  destination: Destination | null;
  waypoints: Waypoint[];
  members: Member[];
  /** Newest-last, capped. */
  pings: Ping[];
  createdAt: number;
  createdBy: string;
}

/** Marker palette: picked for contrast against OSM raster tiles and for
 *  distinguishability under the most common form of colour-blindness. */
export const MEMBER_COLORS = [
  "#2563eb", // blue
  "#ea580c", // orange
  "#16a34a", // green
  "#c026d3", // magenta
  "#0891b2", // cyan
  "#ca8a04", // amber
  "#dc2626", // red
  "#7c3aed", // violet
] as const;

export function pickColor(taken: readonly string[]): string {
  const free = MEMBER_COLORS.find((c) => !taken.includes(c));
  return free ?? MEMBER_COLORS[taken.length % MEMBER_COLORS.length]!;
}

export const PING_LABELS: Record<PingKind, string> = {
  "rest-stop": "Rest stop",
  fuel: "Need fuel",
  "slow-down": "Slow down",
  "wait-for-me": "Wait for me",
  "lost-you": "Lost you",
  "on-my-way": "On my way",
  help: "Need help",
};

/** Pings that should interrupt the driver rather than sit in a feed. */
export const URGENT_PINGS: ReadonlySet<PingKind> = new Set<PingKind>([
  "help",
  "wait-for-me",
  "lost-you",
]);
