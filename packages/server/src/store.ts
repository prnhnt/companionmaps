import {
  ARRIVAL_RADIUS_M,
  type Convoy,
  type Destination,
  type Member,
  type Ping,
  type PingKind,
  type Position,
  type RouteEstimate,
  type Waypoint,
  deriveStatus,
  haversineMeters,
  pickColor,
} from "@companionmaps/shared";

import type { Config } from "./config.js";
import { newConvoyCode, newId, newToken } from "./ids.js";

export const MAX_MEMBERS = 12;
const MAX_PINGS = 40;
const MAX_WAYPOINTS = 12;

/** Trail points closer together than this add nothing but bytes. */
const TRAIL_MIN_SPACING_M = 25;
const TRAIL_MIN_SPACING_MS = 10_000;

/** Leaving the arrival radius takes twice the distance that entering it did,
 *  so a car that stops just outside does not flicker between states. */
const ARRIVAL_EXIT_RADIUS_M = ARRIVAL_RADIUS_M * 2;

export interface Fix {
  lat: number;
  lng: number;
  headingDeg: number | null;
  speedMps: number | null;
  accuracyM: number | null;
  batteryPct: number | null;
}

export interface Identity {
  memberId: string;
  token: string;
}

export type JoinError = "no-such-convoy" | "bad-token" | "convoy-full";

export interface JoinSuccess {
  ok: true;
  convoy: Convoy;
  member: Member;
  token: string;
  /** False when an existing member resumed rather than a new one joining. */
  isNewMember: boolean;
}

export interface JoinFailure {
  ok: false;
  error: JoinError;
}

/**
 * Convoys live in memory. That is a deliberate fit for the shape of the data —
 * a convoy is worthless ten minutes after the drive ends — but it does mean a
 * single process and no horizontal scaling. The interface is narrow enough
 * that a Redis-backed implementation is a drop-in when that matters.
 */
export class ConvoyStore {
  /** Tokens are kept beside the convoy, never on it: the whole Convoy object
   *  is broadcast to every member, and a token is a credential. */
  readonly #convoys = new Map<string, Convoy>();
  readonly #byCode = new Map<string, string>();
  readonly #tokens = new Map<string, Map<string, string>>();
  readonly #config: Config;

  constructor(config: Config) {
    this.#config = config;
  }

  get size(): number {
    return this.#convoys.size;
  }

  getById(convoyId: string): Convoy | null {
    return this.#convoys.get(convoyId) ?? null;
  }

  getByCode(code: string): Convoy | null {
    const id = this.#byCode.get(code.trim().toUpperCase());
    return id ? (this.#convoys.get(id) ?? null) : null;
  }

  create(name: string, now: number): Convoy {
    let code = newConvoyCode();
    while (this.#byCode.has(code)) code = newConvoyCode();

    const convoy: Convoy = {
      id: newId(),
      code,
      name: name.trim().slice(0, 60) || "Convoy",
      destination: null,
      waypoints: [],
      members: [],
      pings: [],
      createdAt: now,
      createdBy: "",
    };

    this.#convoys.set(convoy.id, convoy);
    this.#byCode.set(code, convoy.id);
    this.#tokens.set(convoy.id, new Map());
    return convoy;
  }

  /**
   * Join by code, or resume an existing membership.
   *
   * Resuming needs the token handed out at first join. Without it a reload
   * would either strand the old marker on the map or let anyone with the code
   * impersonate a member.
   */
  join(
    code: string,
    name: string,
    vehicle: string | null,
    now: number,
    identity?: Partial<Identity>,
  ): JoinSuccess | JoinFailure {
    const convoy = this.getByCode(code);
    if (!convoy) return { ok: false, error: "no-such-convoy" };

    const tokens = this.#tokens.get(convoy.id)!;

    if (identity?.memberId) {
      const existing = convoy.members.find((m) => m.id === identity.memberId);
      if (existing) {
        if (!identity.token || tokens.get(existing.id) !== identity.token) {
          return { ok: false, error: "bad-token" };
        }
        existing.name = name;
        existing.vehicle = vehicle;
        existing.connected = true;
        existing.lastSeenAt = now;
        return { ok: true, convoy, member: existing, token: identity.token, isNewMember: false };
      }
    }

    if (convoy.members.length >= MAX_MEMBERS) return { ok: false, error: "convoy-full" };

    const member: Member = {
      id: newId(),
      name,
      color: pickColor(convoy.members.map((m) => m.color)),
      vehicle,
      isLead: convoy.members.length === 0,
      position: null,
      trail: [],
      status: "stale",
      batteryPct: null,
      joinedAt: now,
      lastSeenAt: now,
      arrivedAt: null,
      route: null,
      connected: true,
    };

    convoy.members.push(member);
    if (convoy.createdBy === "") convoy.createdBy = member.id;

    const token = newToken();
    tokens.set(member.id, token);

    return { ok: true, convoy, member, token, isNewMember: true };
  }

  #member(convoyId: string, memberId: string): Member | null {
    const convoy = this.#convoys.get(convoyId);
    return convoy?.members.find((m) => m.id === memberId) ?? null;
  }

  /** Records a fix and returns it, or null if the member is gone. */
  updatePosition(convoyId: string, memberId: string, fix: Fix, now: number): Position | null {
    const convoy = this.#convoys.get(convoyId);
    const member = convoy?.members.find((m) => m.id === memberId);
    if (!convoy || !member) return null;

    const position: Position = {
      lat: fix.lat,
      lng: fix.lng,
      headingDeg: fix.headingDeg,
      speedMps: fix.speedMps,
      accuracyM: fix.accuracyM,
      // Stamped on receipt. Device clocks are wrong often enough that trusting
      // them would corrupt every ETA in the convoy.
      at: now,
    };

    const last = member.trail[member.trail.length - 1];
    const farEnough = !last || haversineMeters(last, position) >= TRAIL_MIN_SPACING_M;
    const longEnough = !last || position.at - last.at >= TRAIL_MIN_SPACING_MS;

    if (farEnough || longEnough) {
      member.trail.push(position);
      if (member.trail.length > this.#config.trailLength) {
        member.trail.splice(0, member.trail.length - this.#config.trailLength);
      }
    }

    member.position = position;
    member.lastSeenAt = now;
    if (fix.batteryPct != null) member.batteryPct = fix.batteryPct;

    if (convoy.destination) {
      const distance = haversineMeters(position, convoy.destination);
      if (distance <= ARRIVAL_RADIUS_M) {
        member.arrivedAt ??= now;
      } else if (distance > ARRIVAL_EXIT_RADIUS_M) {
        member.arrivedAt = null;
      }
    }

    member.status = deriveStatus(member, convoy.destination, now, {
      staleAfterMs: this.#config.staleAfterMs,
      offlineAfterMs: this.#config.offlineAfterMs,
    });

    return position;
  }

  setRoute(convoyId: string, memberId: string, route: RouteEstimate | null): void {
    const member = this.#member(convoyId, memberId);
    if (member) member.route = route;
  }

  rename(convoyId: string, memberId: string, name: string, vehicle: string | null): void {
    const member = this.#member(convoyId, memberId);
    if (!member) return;
    member.name = name;
    member.vehicle = vehicle;
  }

  setConnected(convoyId: string, memberId: string, connected: boolean, now: number): void {
    const member = this.#member(convoyId, memberId);
    if (!member) return;
    member.connected = connected;
    if (connected) member.lastSeenAt = now;
  }

  setDestination(
    convoyId: string,
    memberId: string,
    destination: Omit<Destination, "setBy" | "setAt"> | null,
    now: number,
  ): Destination | null {
    const convoy = this.#convoys.get(convoyId);
    if (!convoy) return null;

    convoy.destination = destination
      ? { ...destination, setBy: memberId, setAt: now }
      : null;

    // A new destination invalidates every cached route and every arrival.
    for (const member of convoy.members) {
      member.route = null;
      member.arrivedAt = null;
    }

    return convoy.destination;
  }

  addWaypoint(
    convoyId: string,
    memberId: string,
    label: string,
    lat: number,
    lng: number,
    now: number,
  ): Waypoint[] | null {
    const convoy = this.#convoys.get(convoyId);
    if (!convoy) return null;

    convoy.waypoints.push({ id: newId(), label, lat, lng, addedBy: memberId, addedAt: now });
    if (convoy.waypoints.length > MAX_WAYPOINTS) convoy.waypoints.shift();

    return convoy.waypoints;
  }

  addPing(convoyId: string, memberId: string, kind: PingKind, now: number): Ping | null {
    const convoy = this.#convoys.get(convoyId);
    const member = convoy?.members.find((m) => m.id === memberId);
    if (!convoy || !member) return null;

    const ping: Ping = {
      id: newId(),
      from: memberId,
      kind,
      at: now,
      at_position: member.position ? { lat: member.position.lat, lng: member.position.lng } : null,
    };

    convoy.pings.push(ping);
    if (convoy.pings.length > MAX_PINGS) convoy.pings.shift();

    return ping;
  }

  removeMember(convoyId: string, memberId: string): void {
    const convoy = this.#convoys.get(convoyId);
    if (!convoy) return;

    convoy.members = convoy.members.filter((m) => m.id !== memberId);
    this.#tokens.get(convoyId)?.delete(memberId);

    // The convoy always has a lead, so the next-longest-standing member gets it.
    if (convoy.members.length > 0 && !convoy.members.some((m) => m.isLead)) {
      convoy.members[0]!.isLead = true;
    }
  }

  /** Recomputes derived statuses. Returns the ids whose status changed. */
  refreshStatuses(convoyId: string, now: number): string[] {
    const convoy = this.#convoys.get(convoyId);
    if (!convoy) return [];

    const thresholds = {
      staleAfterMs: this.#config.staleAfterMs,
      offlineAfterMs: this.#config.offlineAfterMs,
    };

    const changed: string[] = [];
    for (const member of convoy.members) {
      const status = deriveStatus(member, convoy.destination, now, thresholds);
      if (status !== member.status) {
        member.status = status;
        changed.push(member.id);
      }
    }
    return changed;
  }

  /** Drops convoys that nobody has touched for a while. Returns ids removed. */
  sweep(now: number): string[] {
    const removed: string[] = [];

    for (const [id, convoy] of this.#convoys) {
      const anyoneConnected = convoy.members.some((m) => m.connected);
      const lastActivity = convoy.members.reduce(
        (latest, member) => Math.max(latest, member.lastSeenAt),
        convoy.createdAt,
      );

      if (!anyoneConnected && now - lastActivity > this.#config.convoyTtlMs) {
        this.#convoys.delete(id);
        this.#byCode.delete(convoy.code);
        this.#tokens.delete(id);
        removed.push(id);
      }
    }

    return removed;
  }
}
