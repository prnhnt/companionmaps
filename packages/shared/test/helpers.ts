import type { Convoy, Member, Position } from "../src/convoy.js";

export const T0 = 1_700_000_000_000;

export function position(
  lat: number,
  lng: number,
  at: number = T0,
  overrides: Partial<Position> = {},
): Position {
  return {
    lat,
    lng,
    headingDeg: null,
    speedMps: null,
    accuracyM: 8,
    at,
    ...overrides,
  };
}

export function member(id: string, overrides: Partial<Member> = {}): Member {
  const pos = overrides.position ?? position(52.52, 13.405);
  return {
    id,
    name: id,
    color: "#2563eb",
    vehicle: null,
    isLead: false,
    position: pos,
    trail: pos ? [pos] : [],
    status: "driving",
    batteryPct: null,
    joinedAt: T0,
    lastSeenAt: pos?.at ?? T0,
    arrivedAt: null,
    route: null,
    connected: true,
    ...overrides,
  };
}

export function convoy(members: Member[], overrides: Partial<Convoy> = {}): Convoy {
  return {
    id: "convoy-1",
    code: "TRK-4H2",
    name: "Road trip",
    destination: {
      label: "Prague",
      lat: 50.0755,
      lng: 14.4378,
      setBy: members[0]?.id ?? "a",
      setAt: T0,
    },
    waypoints: [],
    members,
    pings: [],
    createdAt: T0,
    createdBy: members[0]?.id ?? "a",
    ...overrides,
  };
}
