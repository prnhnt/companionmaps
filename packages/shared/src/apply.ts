/**
 * Reduces server messages onto a convoy snapshot.
 *
 * Lives in shared rather than in the React client so that the browser and any
 * future native client interpret a delta the same way — and so the reducer can
 * be tested without a socket or a DOM.
 */

import type { Convoy, Member, Position } from "./convoy.js";
import type { ServerMessage } from "./protocol.js";

/** Mirrors the server's trail cap; the client rebuilds trails from deltas. */
const CLIENT_TRAIL_LENGTH = 120;

/** Below this the new fix is the same place, and a trail point is just noise. */
const TRAIL_MIN_DELTA = 1e-5;

function appendTrail(trail: readonly Position[], position: Position): Position[] {
  const last = trail[trail.length - 1];

  if (
    last &&
    Math.abs(last.lat - position.lat) < TRAIL_MIN_DELTA &&
    Math.abs(last.lng - position.lng) < TRAIL_MIN_DELTA
  ) {
    return trail as Position[];
  }

  const next = [...trail, position];
  return next.length > CLIENT_TRAIL_LENGTH
    ? next.slice(next.length - CLIENT_TRAIL_LENGTH)
    : next;
}

/**
 * Returns a new convoy, or the same reference when nothing changed so React
 * can skip the re-render.
 */
export function applyServerMessage(convoy: Convoy | null, message: ServerMessage): Convoy | null {
  switch (message.t) {
    case "welcome":
      return message.convoy;

    case "convoy":
      return message.convoy;

    case "positions": {
      if (!convoy) return convoy;

      const byId = new Map(message.updates.map((update) => [update.id, update]));
      let changed = false;

      const members = convoy.members.map((member): Member => {
        const update = byId.get(member.id);
        if (!update) return member;
        changed = true;

        return {
          ...member,
          position: update.position,
          status: update.status,
          route: update.route,
          connected: update.connected,
          lastSeenAt: update.position?.at ?? member.lastSeenAt,
          trail: update.position ? appendTrail(member.trail, update.position) : member.trail,
        };
      });

      return changed ? { ...convoy, members } : convoy;
    }

    case "member-joined": {
      if (!convoy) return convoy;
      if (convoy.members.some((member) => member.id === message.member.id)) return convoy;
      return { ...convoy, members: [...convoy.members, message.member] };
    }

    case "member-left": {
      if (!convoy) return convoy;
      const members = convoy.members.filter((member) => member.id !== message.memberId);
      return members.length === convoy.members.length ? convoy : { ...convoy, members };
    }

    case "destination": {
      if (!convoy) return convoy;
      // A new destination invalidates cached routes and arrivals, exactly as
      // it does server-side; otherwise stale ETAs linger until the next tick.
      return {
        ...convoy,
        destination: message.destination,
        members: convoy.members.map((member) => ({ ...member, route: null, arrivedAt: null })),
      };
    }

    case "waypoints":
      return convoy ? { ...convoy, waypoints: message.waypoints } : convoy;

    case "ping": {
      if (!convoy) return convoy;
      if (convoy.pings.some((ping) => ping.id === message.ping.id)) return convoy;
      return { ...convoy, pings: [...convoy.pings, message.ping].slice(-40) };
    }

    case "error":
      return convoy;

    default:
      return convoy;
  }
}
