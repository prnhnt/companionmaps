/**
 * Wire protocol shared by the server and every client.
 *
 * Validation lives here rather than in the server so that the browser client
 * and any future native client fail on a malformed message the same way, and
 * so the protocol cannot drift between the two.
 */

import type { Convoy, Destination, Member, MemberStatus, PingKind, Position, RouteEstimate, Waypoint } from "./convoy.js";

export const PROTOCOL_VERSION = 1;

/* ------------------------------------------------------------------ */
/* client -> server                                                     */
/* ------------------------------------------------------------------ */

export interface HelloMessage {
  t: "hello";
  /** Convoy join code. */
  code: string;
  /** Present when rejoining after a reconnect or a reload. */
  memberId?: string;
  /** Proves ownership of `memberId`. */
  token?: string;
  name: string;
  vehicle?: string | null;
}

export interface LocationMessage {
  t: "location";
  lat: number;
  lng: number;
  headingDeg?: number | null;
  speedMps?: number | null;
  accuracyM?: number | null;
  batteryPct?: number | null;
}

export interface SetDestinationMessage {
  t: "set-destination";
  label: string;
  lat: number;
  lng: number;
}

export interface ClearDestinationMessage {
  t: "clear-destination";
}

export interface SendPingMessage {
  t: "ping";
  kind: PingKind;
}

export interface AddWaypointMessage {
  t: "add-waypoint";
  label: string;
  lat: number;
  lng: number;
}

export interface RenameMessage {
  t: "rename";
  name: string;
  vehicle?: string | null;
}

export interface HeartbeatMessage {
  t: "heartbeat";
}

export interface LeaveMessage {
  t: "leave";
}

export type ClientMessage =
  | HelloMessage
  | LocationMessage
  | SetDestinationMessage
  | ClearDestinationMessage
  | SendPingMessage
  | AddWaypointMessage
  | RenameMessage
  | HeartbeatMessage
  | LeaveMessage;

/* ------------------------------------------------------------------ */
/* server -> client                                                     */
/* ------------------------------------------------------------------ */

export interface WelcomeMessage {
  t: "welcome";
  protocol: number;
  youId: string;
  /** Store this; it is what lets the same member resume after a reload. */
  token: string;
  convoy: Convoy;
  serverTime: number;
}

export interface SnapshotMessage {
  t: "convoy";
  convoy: Convoy;
  serverTime: number;
}

/** One member's movement, as sent in the batched position tick. */
export interface PositionUpdate {
  id: string;
  position: Position | null;
  status: MemberStatus;
  route: RouteEstimate | null;
  connected: boolean;
}

export interface PositionsMessage {
  t: "positions";
  updates: PositionUpdate[];
  serverTime: number;
}

export interface MemberJoinedMessage {
  t: "member-joined";
  member: Member;
}

export interface MemberLeftMessage {
  t: "member-left";
  memberId: string;
}

export interface DestinationMessage {
  t: "destination";
  destination: Destination | null;
}

export interface WaypointsMessage {
  t: "waypoints";
  waypoints: Waypoint[];
}

export interface PingBroadcastMessage {
  t: "ping";
  ping: import("./convoy.js").Ping;
}

export interface ErrorMessage {
  t: "error";
  code: "bad-message" | "no-such-convoy" | "not-joined" | "rate-limited" | "server-error";
  message: string;
}

export type ServerMessage =
  | WelcomeMessage
  | SnapshotMessage
  | PositionsMessage
  | MemberJoinedMessage
  | MemberLeftMessage
  | DestinationMessage
  | WaypointsMessage
  | PingBroadcastMessage
  | ErrorMessage;

/* ------------------------------------------------------------------ */
/* validation                                                           */
/* ------------------------------------------------------------------ */

export class ProtocolError extends Error {}

const PING_KINDS: readonly PingKind[] = [
  "rest-stop",
  "fuel",
  "slow-down",
  "wait-for-me",
  "lost-you",
  "on-my-way",
  "help",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function requireString(source: Record<string, unknown>, key: string, maxLength: number): string {
  const value = source[key];
  if (typeof value !== "string") throw new ProtocolError(`"${key}" must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new ProtocolError(`"${key}" must not be empty`);
  return trimmed.slice(0, maxLength);
}

function optionalString(
  source: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | null {
  const value = source[key];
  if (value == null) return null;
  if (typeof value !== "string") throw new ProtocolError(`"${key}" must be a string`);
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, maxLength);
}

function requireNumber(
  source: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ProtocolError(`"${key}" must be a finite number`);
  }
  if (value < min || value > max) {
    throw new ProtocolError(`"${key}" must be between ${min} and ${max}`);
  }
  return value;
}

function optionalNumber(
  source: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number | null {
  const value = source[key];
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  // Out-of-range optional telemetry is dropped rather than fatal: a phone
  // reporting a nonsense heading should not kill the connection.
  if (value < min || value > max) return null;
  return value;
}

/** Throws ProtocolError on anything malformed. Never trusts the input. */
export function parseClientMessage(raw: unknown): ClientMessage {
  let payload: unknown = raw;

  if (typeof raw === "string") {
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new ProtocolError("message is not valid JSON");
    }
  }

  if (!isRecord(payload)) throw new ProtocolError("message must be an object");

  const type = payload["t"];
  if (typeof type !== "string") throw new ProtocolError('message is missing "t"');

  switch (type) {
    case "hello": {
      const message: HelloMessage = {
        t: "hello",
        code: requireString(payload, "code", 16).toUpperCase(),
        name: requireString(payload, "name", 40),
        vehicle: optionalString(payload, "vehicle", 40),
      };
      const memberId = optionalString(payload, "memberId", 64);
      const token = optionalString(payload, "token", 128);
      if (memberId) message.memberId = memberId;
      if (token) message.token = token;
      return message;
    }

    case "location":
      return {
        t: "location",
        lat: requireNumber(payload, "lat", -90, 90),
        lng: requireNumber(payload, "lng", -180, 180),
        headingDeg: optionalNumber(payload, "headingDeg", 0, 360),
        speedMps: optionalNumber(payload, "speedMps", 0, 150),
        accuracyM: optionalNumber(payload, "accuracyM", 0, 100_000),
        batteryPct: optionalNumber(payload, "batteryPct", 0, 100),
      };

    case "set-destination":
      return {
        t: "set-destination",
        label: requireString(payload, "label", 120),
        lat: requireNumber(payload, "lat", -90, 90),
        lng: requireNumber(payload, "lng", -180, 180),
      };

    case "clear-destination":
      return { t: "clear-destination" };

    case "ping": {
      const kind = payload["kind"];
      if (typeof kind !== "string" || !PING_KINDS.includes(kind as PingKind)) {
        throw new ProtocolError(`"kind" must be one of ${PING_KINDS.join(", ")}`);
      }
      return { t: "ping", kind: kind as PingKind };
    }

    case "add-waypoint":
      return {
        t: "add-waypoint",
        label: requireString(payload, "label", 120),
        lat: requireNumber(payload, "lat", -90, 90),
        lng: requireNumber(payload, "lng", -180, 180),
      };

    case "rename":
      return {
        t: "rename",
        name: requireString(payload, "name", 40),
        vehicle: optionalString(payload, "vehicle", 40),
      };

    case "heartbeat":
      return { t: "heartbeat" };

    case "leave":
      return { t: "leave" };

    default:
      throw new ProtocolError(`unknown message type "${type}"`);
  }
}
