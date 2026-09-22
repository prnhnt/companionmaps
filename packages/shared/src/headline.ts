/**
 * The one sentence a driver gets to read.
 *
 * A glance at a screen in a moving car is worth about a second and a half.
 * That is not enough to scan a roster and work out whether anything needs
 * attention, so the app does the scanning and says the single most important
 * thing. Everything else is available, but nothing else is asserted.
 */

import { PING_LABELS, URGENT_PINGS, type Convoy } from "./convoy.js";
import { deriveCompanionViews, deriveConvoyStats, type CompanionView } from "./derive.js";
import { formatDuration } from "./geo.js";

export type HeadlineTone = "calm" | "info" | "warn" | "urgent";

export interface Headline {
  /** Short enough to read at a glance. Never longer than ~34 characters. */
  text: string;
  /** Optional second line, for when stopped. */
  detail: string | null;
  tone: HeadlineTone;
  /** Who it is about, so the UI can tint it and offer one tap to them. */
  memberId: string | null;
}

/** A ping stops being "now" after this. */
const PING_WINDOW_MS = 120_000;

/** Falling this far behind is worth saying out loud. */
const LAGGING_S = 300;

/** Longest line that reliably reads in a glance at driving speed. */
const MAX_HEADLINE_CHARS = 34;

const firstName = (name: string): string => name.split(/\s+/)[0] ?? name;

/** A long name plus a long duration can still overrun; clip rather than wrap. */
const cap = (text: string): string =>
  text.length <= MAX_HEADLINE_CHARS
    ? text
    : `${text.slice(0, MAX_HEADLINE_CHARS - 1).trimEnd()}…`;

export function deriveHeadline(convoy: Convoy, viewerId: string, now: number): Headline {
  const views = deriveCompanionViews(convoy, viewerId, now);
  const stats = deriveConvoyStats(convoy, now);

  const companions = views.filter((view) => !view.isYou);
  const you = views.find((view) => view.isYou) ?? null;

  if (companions.length === 0) {
    return {
      text: "Just you so far",
      detail: "Share the code to bring people in",
      tone: "info",
      memberId: null,
    };
  }

  // 1. Somebody is asking for something, right now.
  const urgent = [...convoy.pings]
    .reverse()
    .find(
      (ping) =>
        now - ping.at <= PING_WINDOW_MS && URGENT_PINGS.has(ping.kind) && ping.from !== viewerId,
    );

  if (urgent) {
    const sender = convoy.members.find((member) => member.id === urgent.from);
    return {
      text: cap(`${firstName(sender?.name ?? "Someone")}: ${PING_LABELS[urgent.kind].toLowerCase()}`),
      detail: null,
      tone: "urgent",
      memberId: urgent.from,
    };
  }

  // 2. Somebody has dropped off the map.
  const lost = companions.find(
    (view) => view.member.status === "offline" || view.isStale,
  );
  if (lost) {
    return {
      text: cap(`${firstName(lost.member.name)} lost signal`),
      detail: "Showing their last known position",
      tone: "warn",
      memberId: lost.member.id,
    };
  }

  // 3. Everyone made it.
  if (stats.allArrived) {
    return { text: "Everyone's here", detail: null, tone: "calm", memberId: null };
  }

  // 4. You made it; they have not.
  if (you?.member.status === "arrived") {
    const waiting = companions.filter((view) => view.member.status !== "arrived");
    const next = waiting[0];
    return {
      text: cap(
        waiting.length === 1 && next
          ? `Waiting for ${firstName(next.member.name)}`
          : `Waiting for ${waiting.length}`,
      ),
      detail: next?.progress ? `${formatDuration(next.progress.durationS)} out` : null,
      tone: "info",
      memberId: waiting.length === 1 ? (next?.member.id ?? null) : null,
    };
  }

  // 5. Somebody is dropping away from the group.
  const lagging = companions
    .filter((view) => view.standing === "behind" && (view.etaDeltaS ?? 0) >= LAGGING_S)
    .sort((a, b) => (b.etaDeltaS ?? 0) - (a.etaDeltaS ?? 0))[0];

  if (lagging) {
    return {
      text: cap(`${firstName(lagging.member.name)} ${formatDuration(lagging.etaDeltaS ?? 0)} behind`),
      detail: "Ease off, or send a wait",
      tone: "warn",
      memberId: lagging.member.id,
    };
  }

  // 6. Nobody in particular, but the group is coming apart.
  if (stats.isStretched && stats.arrivalSpanS != null) {
    return {
      text: cap(`Convoy ${formatDuration(stats.arrivalSpanS)} apart`),
      detail: null,
      tone: "warn",
      memberId: stats.backMemberId,
    };
  }

  // 7. All well.
  const count = convoy.members.length;
  return {
    text: `${count} cars together`,
    detail: null,
    tone: "calm",
    memberId: null,
  };
}

/** Short "2.1 km ahead" style phrase for one companion. */
export function standingPhrase(view: CompanionView, formatDistance: (m: number | null) => string): string {
  if (view.member.status === "arrived") return "arrived";
  if (!view.member.position) return "no position";
  if (view.distanceFromYouM == null) return "on the map";

  const gap = formatDistance(view.distanceFromYouM);
  switch (view.standing) {
    case "ahead":
      return `${gap} ahead`;
    case "behind":
      return `${gap} behind`;
    default:
      return `${gap} away`;
  }
}
