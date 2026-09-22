import type { Server as HttpServer } from "node:http";

import {
  PROTOCOL_VERSION,
  ProtocolError,
  type Convoy,
  type PositionUpdate,
  type ServerMessage,
  parseClientMessage,
} from "@companionmaps/shared";
import { WebSocket, WebSocketServer } from "ws";

import type { Config } from "./config.js";
import type { GeoProviders } from "./providers.js";
import { ConvoyStore } from "./store.js";

/** A client that connects and then says nothing is not a client. */
const HELLO_TIMEOUT_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Refuse oversized frames outright rather than parsing them. */
const MAX_FRAME_BYTES = 16 * 1024;

/**
 * Leaky bucket. Location updates are cheap but unbounded; pings are cheap but
 * land on other people's screens, so they are held to a much tighter budget.
 */
class TokenBucket {
  #tokens: number;
  #lastRefill = Date.now();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {
    this.#tokens = capacity;
  }

  take(now = Date.now()): boolean {
    const elapsedS = (now - this.#lastRefill) / 1000;
    this.#lastRefill = now;
    this.#tokens = Math.min(this.capacity, this.#tokens + elapsedS * this.refillPerSecond);

    if (this.#tokens < 1) return false;
    this.#tokens -= 1;
    return true;
  }
}

interface Session {
  socket: WebSocket;
  convoyId: string;
  memberId: string;
  alive: boolean;
  locations: TokenBucket;
  pings: TokenBucket;
  /** Rate-limit rejections are reported once, not once per dropped frame. */
  warnedAt: number;
}

export class ConvoyHub {
  readonly #sessions = new Map<WebSocket, Session>();
  readonly #byConvoy = new Map<string, Set<Session>>();
  /** Members whose position or status changed since the last flush. */
  readonly #dirty = new Map<string, Set<string>>();

  #wss: WebSocketServer | null = null;
  #timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly store: ConvoyStore,
    private readonly config: Config,
    private readonly providers: GeoProviders,
  ) {}

  attach(server: HttpServer, path = "/ws"): void {
    const wss = new WebSocketServer({ server, path, maxPayload: MAX_FRAME_BYTES });
    this.#wss = wss;

    wss.on("connection", (socket) => this.#onConnection(socket));

    this.#timers.push(
      setInterval(() => this.#flush(), this.config.broadcastIntervalMs),
      setInterval(() => this.#heartbeat(), HEARTBEAT_INTERVAL_MS),
      setInterval(() => void this.#refreshRoutes(), this.config.routeRefreshMs),
      setInterval(() => this.#sweep(), 60_000),
    );

    for (const timer of this.#timers) timer.unref?.();
  }

  async close(): Promise<void> {
    for (const timer of this.#timers) clearInterval(timer);
    this.#timers = [];

    for (const session of this.#sessions.keys()) session.terminate();
    this.#sessions.clear();
    this.#byConvoy.clear();

    const wss = this.#wss;
    if (!wss) return;
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  }

  /* ---------------------------------------------------------------- */
  /* connection lifecycle                                              */
  /* ---------------------------------------------------------------- */

  #onConnection(socket: WebSocket): void {
    const helloTimer = setTimeout(() => {
      if (!this.#sessions.has(socket)) socket.close(4001, "no hello");
    }, HELLO_TIMEOUT_MS);
    helloTimer.unref?.();

    socket.on("pong", () => {
      const session = this.#sessions.get(socket);
      if (session) session.alive = true;
    });

    socket.on("message", (raw) => {
      try {
        this.#onMessage(socket, raw.toString());
      } catch (error) {
        if (error instanceof ProtocolError) {
          this.#send(socket, { t: "error", code: "bad-message", message: error.message });
        } else {
          console.error("[hub] message handler failed", error);
          this.#send(socket, { t: "error", code: "server-error", message: "internal error" });
        }
      }
    });

    socket.on("close", () => {
      clearTimeout(helloTimer);
      this.#onClose(socket);
    });

    socket.on("error", () => socket.terminate());
  }

  #onMessage(socket: WebSocket, raw: string): void {
    const message = parseClientMessage(raw);
    const now = Date.now();
    const session = this.#sessions.get(socket);

    if (message.t === "hello") {
      if (session) {
        this.#send(socket, { t: "error", code: "bad-message", message: "already joined" });
        return;
      }
      this.#onHello(socket, message.code, message.name, message.vehicle ?? null, message.memberId, message.token, now);
      return;
    }

    if (!session) {
      this.#send(socket, { t: "error", code: "not-joined", message: "send hello first" });
      return;
    }

    switch (message.t) {
      case "location": {
        if (!session.locations.take(now)) {
          this.#warn(session, now, "slow down location updates");
          return;
        }

        const position = this.store.updatePosition(
          session.convoyId,
          session.memberId,
          {
            lat: message.lat,
            lng: message.lng,
            headingDeg: message.headingDeg ?? null,
            speedMps: message.speedMps ?? null,
            accuracyM: message.accuracyM ?? null,
            batteryPct: message.batteryPct ?? null,
          },
          now,
        );

        if (position) this.#markDirty(session.convoyId, session.memberId);
        return;
      }

      case "set-destination": {
        const destination = this.store.setDestination(
          session.convoyId,
          session.memberId,
          { label: message.label, lat: message.lat, lng: message.lng },
          now,
        );
        this.#broadcast(session.convoyId, { t: "destination", destination });
        // Arrival state and every cached route were just invalidated.
        this.#markConvoyDirty(session.convoyId);
        return;
      }

      case "clear-destination": {
        this.store.setDestination(session.convoyId, session.memberId, null, now);
        this.#broadcast(session.convoyId, { t: "destination", destination: null });
        this.#markConvoyDirty(session.convoyId);
        return;
      }

      case "ping": {
        if (!session.pings.take(now)) {
          this.#warn(session, now, "too many pings");
          return;
        }
        const ping = this.store.addPing(session.convoyId, session.memberId, message.kind, now);
        if (ping) this.#broadcast(session.convoyId, { t: "ping", ping });
        return;
      }

      case "add-waypoint": {
        const waypoints = this.store.addWaypoint(
          session.convoyId,
          session.memberId,
          message.label,
          message.lat,
          message.lng,
          now,
        );
        if (waypoints) this.#broadcast(session.convoyId, { t: "waypoints", waypoints });
        return;
      }

      case "rename": {
        this.store.rename(session.convoyId, session.memberId, message.name, message.vehicle ?? null);
        const convoy = this.store.getById(session.convoyId);
        if (convoy) this.#broadcast(session.convoyId, { t: "convoy", convoy, serverTime: now });
        return;
      }

      case "heartbeat":
        session.alive = true;
        return;

      case "leave": {
        this.#leave(session, true);
        socket.close(1000, "left");
        return;
      }
    }
  }

  #onHello(
    socket: WebSocket,
    code: string,
    name: string,
    vehicle: string | null,
    memberId: string | undefined,
    token: string | undefined,
    now: number,
  ): void {
    const identity = memberId ? { memberId, token } : undefined;
    const result = this.store.join(code, name, vehicle, now, identity);

    if (!result.ok) {
      const message =
        result.error === "no-such-convoy"
          ? "no convoy with that code"
          : result.error === "convoy-full"
            ? "this convoy is full"
            : "that membership belongs to someone else";

      this.#send(socket, {
        t: "error",
        code: result.error === "no-such-convoy" ? "no-such-convoy" : "not-joined",
        message,
      });
      socket.close(4004, result.error);
      return;
    }

    const { convoy, member } = result;

    // A reload leaves the previous socket for this member open and stale.
    for (const [otherSocket, other] of this.#sessions) {
      if (other.memberId === member.id && otherSocket !== socket) {
        otherSocket.close(4000, "replaced by a newer connection");
      }
    }

    const session: Session = {
      socket,
      convoyId: convoy.id,
      memberId: member.id,
      alive: true,
      // ~2 fixes/second sustained, with room for a burst after a tunnel.
      locations: new TokenBucket(20, 2),
      // One ping every few seconds; they interrupt other drivers.
      pings: new TokenBucket(3, 0.25),
      warnedAt: 0,
    };

    this.#sessions.set(socket, session);
    this.#sessionsFor(convoy.id).add(session);
    this.store.setConnected(convoy.id, member.id, true, now);

    this.#send(socket, {
      t: "welcome",
      protocol: PROTOCOL_VERSION,
      youId: member.id,
      token: result.token,
      convoy,
      serverTime: now,
    });

    if (result.isNewMember) {
      this.#broadcast(convoy.id, { t: "member-joined", member }, socket);
    } else {
      this.#markDirty(convoy.id, member.id);
    }
  }

  #onClose(socket: WebSocket): void {
    const session = this.#sessions.get(socket);
    if (!session) return;
    // Members are not removed on disconnect: a car in a tunnel should stay on
    // the map as "no signal" rather than vanish. The sweep prunes them later.
    this.#leave(session, false);
  }

  #leave(session: Session, remove: boolean): void {
    this.#sessions.delete(session.socket);
    this.#sessionsFor(session.convoyId).delete(session);

    if (remove) {
      this.store.removeMember(session.convoyId, session.memberId);
      this.#broadcast(session.convoyId, { t: "member-left", memberId: session.memberId });
    } else {
      this.store.setConnected(session.convoyId, session.memberId, false, Date.now());
      this.#markDirty(session.convoyId, session.memberId);
    }

    if (this.#sessionsFor(session.convoyId).size === 0) {
      this.#byConvoy.delete(session.convoyId);
    }
  }

  /* ---------------------------------------------------------------- */
  /* broadcasting                                                      */
  /* ---------------------------------------------------------------- */

  #sessionsFor(convoyId: string): Set<Session> {
    let set = this.#byConvoy.get(convoyId);
    if (!set) {
      set = new Set();
      this.#byConvoy.set(convoyId, set);
    }
    return set;
  }

  #send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(message));
  }

  #broadcast(convoyId: string, message: ServerMessage, except?: WebSocket): void {
    const payload = JSON.stringify(message);
    for (const session of this.#sessionsFor(convoyId)) {
      if (session.socket === except) continue;
      if (session.socket.readyState !== WebSocket.OPEN) continue;
      session.socket.send(payload);
    }
  }

  #warn(session: Session, now: number, message: string): void {
    if (now - session.warnedAt < 5000) return;
    session.warnedAt = now;
    this.#send(session.socket, { t: "error", code: "rate-limited", message });
  }

  #markDirty(convoyId: string, memberId: string): void {
    let set = this.#dirty.get(convoyId);
    if (!set) {
      set = new Set();
      this.#dirty.set(convoyId, set);
    }
    set.add(memberId);
  }

  #markConvoyDirty(convoyId: string): void {
    const convoy = this.store.getById(convoyId);
    if (!convoy) return;
    for (const member of convoy.members) this.#markDirty(convoyId, member.id);
  }

  /**
   * One batched tick per convoy.
   *
   * Sending every fix the moment it lands would mean n² frames across a
   * convoy; at one flush per second each client gets a single frame carrying
   * everyone who actually moved, which is what matters on a phone that is also
   * running the GPS.
   */
  #flush(): void {
    const now = Date.now();

    for (const convoyId of this.#byConvoy.keys()) {
      // Staleness is a function of time, not of traffic, so it has to be
      // recomputed on the tick even when nobody sent anything.
      for (const memberId of this.store.refreshStatuses(convoyId, now)) {
        this.#markDirty(convoyId, memberId);
      }

      const dirty = this.#dirty.get(convoyId);
      if (!dirty || dirty.size === 0) continue;

      const convoy = this.store.getById(convoyId);
      if (!convoy) {
        this.#dirty.delete(convoyId);
        continue;
      }

      const updates: PositionUpdate[] = [];
      for (const memberId of dirty) {
        const member = convoy.members.find((m) => m.id === memberId);
        if (!member) continue;
        updates.push({
          id: member.id,
          position: member.position,
          status: member.status,
          route: member.route,
          connected: member.connected,
        });
      }

      dirty.clear();
      if (updates.length > 0) {
        this.#broadcast(convoyId, { t: "positions", updates, serverTime: now });
      }
    }
  }

  #heartbeat(): void {
    for (const [socket, session] of this.#sessions) {
      if (!session.alive) {
        socket.terminate();
        continue;
      }
      session.alive = false;
      socket.ping();
    }
  }

  #sweep(): void {
    const now = Date.now();

    for (const convoyId of [...this.#byConvoy.keys()]) {
      const convoy = this.store.getById(convoyId);
      if (!convoy) continue;

      for (const member of [...convoy.members]) {
        const gone = !member.connected && now - member.lastSeenAt > this.config.offlineAfterMs;
        if (!gone) continue;
        this.store.removeMember(convoyId, member.id);
        this.#broadcast(convoyId, { t: "member-left", memberId: member.id });
      }
    }

    for (const convoyId of this.store.sweep(now)) {
      this.#byConvoy.delete(convoyId);
      this.#dirty.delete(convoyId);
    }
  }

  /**
   * Replaces the straight-line ETA fallback with a real road route.
   *
   * Runs on a slow timer and only for members who are actually moving towards
   * a destination — the public OSRM instance is a shared courtesy, and a
   * convoy's ETAs do not change meaningfully faster than this.
   */
  async #refreshRoutes(): Promise<void> {
    for (const convoyId of [...this.#byConvoy.keys()]) {
      const convoy = this.store.getById(convoyId);
      const destination = convoy?.destination;
      if (!convoy || !destination) continue;

      for (const member of convoy.members) {
        const position = member.position;
        if (!position || member.status === "arrived" || member.status === "offline") continue;

        try {
          const route = await this.providers.route(position, destination);
          if (!route) continue;
          this.store.setRoute(convoyId, member.id, route);
          this.#markDirty(convoyId, member.id);
        } catch {
          // A routing outage degrades ETAs to the straight-line estimate,
          // which is exactly what the fallback is for. Not worth logging
          // once per member per minute.
        }
      }
    }
  }

  /** Test seam: the convoy snapshot as clients would receive it. */
  snapshot(convoyId: string): Convoy | null {
    return this.store.getById(convoyId);
  }
}
