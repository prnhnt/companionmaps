/**
 * Driving-safe projection of a convoy.
 *
 * CarPlay and Android Auto do not let an app draw whatever it likes: the head
 * unit renders fixed templates, row counts are capped while the vehicle is
 * moving, and text is truncated hard. So the server renders every string here,
 * applies the caps here, and the car app becomes a dumb painter of this struct.
 * That keeps one copy of the rules instead of three, and it means the phone UI
 * and the car UI can never disagree about who is ahead.
 *
 * See docs/CAR-PROJECTION.md for the field-by-field mapping to CPListItem and
 * androidx.car.app.model.Row.
 */

import {
  compassPoint,
  formatAge,
  formatClock,
  formatDistance,
  formatDuration,
  formatSignedDuration,
} from "./geo.js";
import { PING_LABELS, URGENT_PINGS, type Convoy } from "./convoy.js";
import {
  deriveCompanionViews,
  deriveConvoyStats,
  type CompanionView,
} from "./derive.js";

/** Android Auto caps a list at 6 rows while the vehicle is in motion. */
export const MAX_CAR_ROWS = 6;

/** Android Auto ActionStrip holds at most 4 actions. */
export const MAX_CAR_ACTIONS = 4;

/** Two lines of text per row is the shared floor across both platforms. */
export const MAX_CAR_TITLE_CHARS = 32;
export const MAX_CAR_SUBTITLE_CHARS = 42;

export type CarBadge = "arrived" | "stale" | "urgent" | "lagging" | null;

export interface CarRow {
  id: string;
  title: string;
  subtitle: string;
  /** Marker colour, so the row and the map pin match at a glance. */
  tint: string;
  badge: CarBadge;
  distanceM: number | null;
  /** Compass bearing from the driver to this companion, for the row glyph. */
  bearingDeg: number | null;
  lat: number | null;
  lng: number | null;
}

export interface CarAlert {
  level: "info" | "warning" | "urgent";
  text: string;
}

export interface CarAction {
  id: string;
  title: string;
}

export interface CarView {
  /** CPMapTemplate.title / NavigationTemplate header. */
  title: string;
  subtitle: string;
  /** Your own trip estimate — CPTravelEstimates / TravelEstimate. */
  etaText: string;
  arrivalText: string;
  distanceText: string;
  rows: CarRow[];
  /** How many companions did not fit inside MAX_CAR_ROWS. */
  truncatedCount: number;
  alerts: CarAlert[];
  actions: CarAction[];
  generatedAt: number;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/**
 * Rows are ordered by how much they deserve the driver's attention, then by
 * convoy order. Pure convoy order would be more predictable, but a car that
 * dropped off the map an hour into a drive is the one thing the driver must
 * not have to scroll for.
 */
function attentionScore(view: CompanionView, urgentFrom: ReadonlySet<string>): number {
  if (urgentFrom.has(view.member.id)) return 4;
  if (view.member.status === "offline") return 3;
  if (view.isStale) return 3;
  if (view.standing === "behind" && (view.etaDeltaS ?? 0) > 600) return 2;
  return 0;
}

function standingText(view: CompanionView): string {
  if (view.member.status === "arrived") return "arrived";
  if (!view.member.position) return "no position yet";

  // They are on the map but we are not: no gap can be computed.
  const distance = view.distanceFromYouM;
  if (distance == null) return "on the map";

  const gap = formatDistance(distance);
  switch (view.standing) {
    case "ahead":
      return `${gap} ahead`;
    case "behind":
      return `${gap} behind`;
    case "alongside":
      return `${gap} away, together`;
    default:
      return `${gap} away`;
  }
}

function rowSubtitle(view: CompanionView, now: number): string {
  if (view.member.status === "offline") {
    return `No signal · last seen ${formatAge(now - view.member.lastSeenAt)}`;
  }
  // Arrival is checked before staleness: a car parked at the destination
  // stops producing fixes, and "last fix 4 min ago" is not the news.
  if (view.member.status === "arrived") {
    const at = view.member.arrivedAt;
    return at ? `Arrived ${formatClock(at)}` : "Arrived";
  }
  if (!view.member.position) {
    return "Not sharing a location yet";
  }
  if (view.isStale) {
    return `Last fix ${formatAge(view.fixAgeMs)}`;
  }

  const progress = view.progress;
  if (!progress) return "Waiting for destination";

  const eta = `ETA ${formatClock(progress.arrivalAt)}`;
  const delta = view.etaDeltaS == null ? null : formatSignedDuration(view.etaDeltaS);
  return delta ? `${eta} · ${delta}` : eta;
}

function badgeFor(view: CompanionView, urgentFrom: ReadonlySet<string>): CarBadge {
  if (urgentFrom.has(view.member.id)) return "urgent";
  if (view.member.status === "arrived") return "arrived";
  if (view.member.status === "offline" || view.isStale) return "stale";
  if (view.standing === "behind" && (view.etaDeltaS ?? 0) > 600) return "lagging";
  return null;
}

/** Pings newer than this still count as "happening now" for the driver. */
const URGENT_PING_WINDOW_MS = 120_000;

export function buildCarView(convoy: Convoy, viewerId: string, now: number): CarView {
  const views = deriveCompanionViews(convoy, viewerId, now);
  const stats = deriveConvoyStats(convoy, now);

  const you = views.find((view) => view.isYou) ?? null;
  const companions = views.filter((view) => !view.isYou);

  const urgentFrom = new Set(
    convoy.pings
      .filter(
        (ping) =>
          now - ping.at <= URGENT_PING_WINDOW_MS &&
          URGENT_PINGS.has(ping.kind) &&
          ping.from !== viewerId,
      )
      .map((ping) => ping.from),
  );

  const ordered = [...companions].sort((a, b) => {
    const score = attentionScore(b, urgentFrom) - attentionScore(a, urgentFrom);
    if (score !== 0) return score;
    return companions.indexOf(a) - companions.indexOf(b);
  });

  const rows: CarRow[] = ordered.slice(0, MAX_CAR_ROWS).map((view) => ({
    id: view.member.id,
    title: truncate(`${view.member.name} · ${standingText(view)}`, MAX_CAR_TITLE_CHARS),
    subtitle: truncate(rowSubtitle(view, now), MAX_CAR_SUBTITLE_CHARS),
    tint: view.member.color,
    badge: badgeFor(view, urgentFrom),
    distanceM: view.distanceFromYouM,
    bearingDeg: view.bearingFromYouDeg,
    lat: view.member.position?.lat ?? null,
    lng: view.member.position?.lng ?? null,
  }));

  const alerts: CarAlert[] = [];

  for (const ping of convoy.pings.slice(-3)) {
    if (now - ping.at > URGENT_PING_WINDOW_MS) continue;
    if (ping.from === viewerId) continue;
    const sender = convoy.members.find((m) => m.id === ping.from);
    alerts.push({
      level: URGENT_PINGS.has(ping.kind) ? "urgent" : "info",
      text: `${sender?.name ?? "Someone"}: ${PING_LABELS[ping.kind]}`,
    });
  }

  for (const stragglerId of stats.stragglerIds) {
    if (stragglerId === viewerId) continue;
    const member = convoy.members.find((m) => m.id === stragglerId);
    if (!member) continue;
    alerts.push({
      level: "warning",
      text: `${member.name} lost signal ${formatAge(now - member.lastSeenAt)}`,
    });
  }

  if (stats.isStretched) {
    alerts.push({
      level: "warning",
      text:
        stats.arrivalSpanS != null
          ? `Convoy ${formatDuration(stats.arrivalSpanS)} apart`
          : `Convoy stretched over ${formatDistance(stats.spreadM ?? 0)}`,
    });
  }

  const subtitleParts = [`${stats.total} ${stats.total === 1 ? "car" : "cars"}`];
  if (stats.spreadM != null) subtitleParts.push(`spread ${formatDistance(stats.spreadM)}`);
  if (stats.arrived > 0) subtitleParts.push(`${stats.arrived} arrived`);

  // Free-text entry is blocked while driving, so every action must be a
  // single tap that needs no confirmation.
  const actions: CarAction[] = [
    { id: "ping:wait-for-me", title: "Wait for me" },
    { id: "ping:rest-stop", title: "Rest stop" },
    { id: "ping:on-my-way", title: "On my way" },
    { id: "fit:convoy", title: "Show all" },
  ].slice(0, MAX_CAR_ACTIONS);

  return {
    title: truncate(convoy.destination?.label ?? convoy.name, MAX_CAR_TITLE_CHARS),
    subtitle: truncate(subtitleParts.join(" · "), MAX_CAR_SUBTITLE_CHARS),
    etaText: you?.progress ? formatDuration(you.progress.durationS) : "--",
    arrivalText: you?.progress ? formatClock(you.progress.arrivalAt) : "--",
    distanceText: you?.progress ? formatDistance(you.progress.distanceM) : "--",
    rows,
    truncatedCount: Math.max(0, companions.length - rows.length),
    alerts: alerts.slice(0, 3),
    actions,
    generatedAt: now,
  };
}

export { compassPoint };
