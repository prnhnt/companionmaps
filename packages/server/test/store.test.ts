import assert from "node:assert/strict";
import { test } from "node:test";

import { ARRIVAL_RADIUS_M, destinationPoint } from "@companionmaps/shared";

import { loadConfig } from "../src/config.js";
import { ConvoyStore, MAX_MEMBERS } from "../src/store.js";

const T0 = 1_700_000_000_000;
const DEST = { lat: 50.0755, lng: 14.4378 };

const testConfig = () => ({ ...loadConfig({}), trailLength: 5, offlineAfterMs: 300_000 });
const fix = (lat: number, lng: number, extra: Record<string, unknown> = {}) => ({
  lat,
  lng,
  headingDeg: null,
  speedMps: null,
  accuracyM: null,
  batteryPct: null,
  ...extra,
});

test("a new convoy gets a readable, unambiguous code", () => {
  const store = new ConvoyStore(testConfig());
  const convoy = store.create("Road trip", T0);

  assert.match(convoy.code, /^[ACDEFGHJKMNPQRTUVWXY34679]{3}-[ACDEFGHJKMNPQRTUVWXY34679]{3}$/);
  assert.equal(store.getByCode(convoy.code)?.id, convoy.id);
  assert.equal(store.getByCode(convoy.code.toLowerCase())?.id, convoy.id, "codes are case-insensitive");
  assert.equal(store.getByCode("NOP-E00"), null);
});

test("the first member becomes lead and names the convoy's creator", () => {
  const store = new ConvoyStore(testConfig());
  const convoy = store.create("Trip", T0);

  const first = store.join(convoy.code, "Mira", "blue Golf", T0);
  const second = store.join(convoy.code, "Tom", null, T0);

  assert.ok(first.ok && second.ok);
  assert.equal(first.member.isLead, true);
  assert.equal(second.member.isLead, false);
  assert.equal(convoy.createdBy, first.member.id);
  assert.notEqual(first.member.color, second.member.color, "members get distinct colours");
});

test("tokens never appear on the convoy that gets broadcast", () => {
  const store = new ConvoyStore(testConfig());
  const convoy = store.create("Trip", T0);
  const joined = store.join(convoy.code, "Mira", null, T0);

  assert.ok(joined.ok);
  assert.ok(joined.token.length > 10);
  assert.ok(!JSON.stringify(convoy).includes(joined.token), "the token leaked into the snapshot");
});

test("resuming needs the right token", () => {
  const store = new ConvoyStore(testConfig());
  const convoy = store.create("Trip", T0);
  const joined = store.join(convoy.code, "Mira", null, T0);
  assert.ok(joined.ok);

  const resumed = store.join(convoy.code, "Mira", null, T0 + 5000, {
    memberId: joined.member.id,
    token: joined.token,
  });
  assert.ok(resumed.ok);
  assert.equal(resumed.isNewMember, false);
  assert.equal(resumed.member.id, joined.member.id);
  assert.equal(convoy.members.length, 1, "resuming must not duplicate the member");

  const impostor = store.join(convoy.code, "Mira", null, T0, {
    memberId: joined.member.id,
    token: "wrong",
  });
  assert.equal(impostor.ok, false);
  assert.equal(impostor.ok === false ? impostor.error : null, "bad-token");

  const noToken = store.join(convoy.code, "Mira", null, T0, { memberId: joined.member.id });
  assert.equal(noToken.ok, false);
});

test("an unknown memberId falls through to a fresh join", () => {
  const store = new ConvoyStore(testConfig());
  const convoy = store.create("Trip", T0);

  const joined = store.join(convoy.code, "Mira", null, T0, { memberId: "stale-id", token: "x" });
  assert.ok(joined.ok);
  assert.equal(joined.isNewMember, true);
});

test("a convoy has a hard member cap", () => {
  const store = new ConvoyStore(testConfig());
  const convoy = store.create("Trip", T0);

  for (let i = 0; i < MAX_MEMBERS; i += 1) {
    assert.ok(store.join(convoy.code, `driver-${i}`, null, T0).ok);
  }

  const overflow = store.join(convoy.code, "one-too-many", null, T0);
  assert.equal(overflow.ok, false);
  assert.equal(overflow.ok === false ? overflow.error : null, "convoy-full");
});

test("joining a code that does not exist fails cleanly", () => {
  const store = new ConvoyStore(testConfig());
  const result = store.join("NOP-E00", "Mira", null, T0);

  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.error : null, "no-such-convoy");
});

test("the server stamps fix times, not the device", () => {
  const store = new ConvoyStore(testConfig());
  const convoy = store.create("Trip", T0);
  const joined = store.join(convoy.code, "Mira", null, T0);
  assert.ok(joined.ok);

  const position = store.updatePosition(convoy.id, joined.member.id, fix(52.52, 13.405), T0 + 9999);
  assert.equal(position?.at, T0 + 9999);
});

test("the trail skips points that add nothing and stays capped", () => {
  const store = new ConvoyStore(testConfig()); // trailLength: 5
  const convoy = store.create("Trip", T0);
  const joined = store.join(convoy.code, "Mira", null, T0);
  assert.ok(joined.ok);
  const id = joined.member.id;

  // Four fixes a second apart, barely moving: only the first is worth keeping.
  const start = { lat: 52.52, lng: 13.405 };
  for (let i = 0; i < 4; i += 1) {
    const nudged = destinationPoint(start, 90, i * 2);
    store.updatePosition(convoy.id, id, fix(nudged.lat, nudged.lng), T0 + i * 1000);
  }
  assert.equal(joined.member.trail.length, 1, "a stationary car should not fill the trail");

  // Fixes 100 m apart all earn a slot, up to the cap.
  for (let i = 1; i <= 10; i += 1) {
    const moved = destinationPoint(start, 90, i * 100);
    store.updatePosition(convoy.id, id, fix(moved.lat, moved.lng), T0 + 10_000 + i * 1000);
  }
  assert.equal(joined.member.trail.length, 5);
  assert.equal(joined.member.position?.at, T0 + 20_000, "the live position always updates");
});

test("arrival latches on entry and needs real distance to clear", () => {
  const store = new ConvoyStore(testConfig());
  const convoy = store.create("Trip", T0);
  const joined = store.join(convoy.code, "Mira", null, T0);
  assert.ok(joined.ok);
  const id = joined.member.id;

  store.setDestination(convoy.id, id, { label: "Prague", ...DEST }, T0);

  const inside = destinationPoint(DEST, 0, ARRIVAL_RADIUS_M - 20);
  store.updatePosition(convoy.id, id, fix(inside.lat, inside.lng), T0 + 1000);
  assert.equal(joined.member.arrivedAt, T0 + 1000);
  assert.equal(joined.member.status, "arrived");

  // Just outside the arrival radius: still arrived, thanks to the hysteresis.
  const nudgedOut = destinationPoint(DEST, 0, ARRIVAL_RADIUS_M + 20);
  store.updatePosition(convoy.id, id, fix(nudgedOut.lat, nudgedOut.lng), T0 + 2000);
  assert.equal(joined.member.arrivedAt, T0 + 1000, "a parking manoeuvre must not un-arrive a car");

  // Genuinely driving away clears it.
  const away = destinationPoint(DEST, 0, 5000);
  store.updatePosition(convoy.id, id, fix(away.lat, away.lng), T0 + 3000);
  assert.equal(joined.member.arrivedAt, null);
});

test("a new destination invalidates cached routes and arrivals", () => {
  const store = new ConvoyStore(testConfig());
  const convoy = store.create("Trip", T0);
  const joined = store.join(convoy.code, "Mira", null, T0);
  assert.ok(joined.ok);
  const id = joined.member.id;

  store.setDestination(convoy.id, id, { label: "Prague", ...DEST }, T0);
  store.updatePosition(convoy.id, id, fix(DEST.lat, DEST.lng), T0 + 1000);
  store.setRoute(convoy.id, id, { distanceM: 10, durationS: 10, computedAt: T0, geometry: null });
  assert.ok(joined.member.arrivedAt);

  store.setDestination(convoy.id, id, { label: "Vienna", lat: 48.2, lng: 16.37 }, T0 + 2000);
  assert.equal(joined.member.route, null);
  assert.equal(joined.member.arrivedAt, null);
  assert.equal(convoy.destination?.setBy, id);
});

test("clearing the destination is allowed", () => {
  const store = new ConvoyStore(testConfig());
  const convoy = store.create("Trip", T0);
  const joined = store.join(convoy.code, "Mira", null, T0);
  assert.ok(joined.ok);

  store.setDestination(convoy.id, joined.member.id, { label: "Prague", ...DEST }, T0);
  assert.equal(store.setDestination(convoy.id, joined.member.id, null, T0), null);
  assert.equal(convoy.destination, null);
});

test("statuses go stale then offline as fixes age", () => {
  const store = new ConvoyStore({ ...testConfig(), staleAfterMs: 45_000, offlineAfterMs: 300_000 });
  const convoy = store.create("Trip", T0);
  const joined = store.join(convoy.code, "Mira", null, T0);
  assert.ok(joined.ok);

  store.updatePosition(convoy.id, joined.member.id, fix(52.52, 13.405, { speedMps: 25 }), T0);
  assert.equal(joined.member.status, "driving");

  assert.deepEqual(store.refreshStatuses(convoy.id, T0 + 60_000), [joined.member.id]);
  assert.equal(joined.member.status, "stale");

  assert.deepEqual(store.refreshStatuses(convoy.id, T0 + 60_000), [], "no change, no churn");

  store.refreshStatuses(convoy.id, T0 + 400_000);
  assert.equal(joined.member.status, "offline");
});

test("removing the lead promotes someone else", () => {
  const store = new ConvoyStore(testConfig());
  const convoy = store.create("Trip", T0);
  const lead = store.join(convoy.code, "Mira", null, T0);
  const second = store.join(convoy.code, "Tom", null, T0 + 1);
  assert.ok(lead.ok && second.ok);

  store.removeMember(convoy.id, lead.member.id);
  assert.equal(convoy.members.length, 1);
  assert.equal(convoy.members[0]?.isLead, true);
});

test("pings are capped and carry where the sender was", () => {
  const store = new ConvoyStore(testConfig());
  const convoy = store.create("Trip", T0);
  const joined = store.join(convoy.code, "Mira", null, T0);
  assert.ok(joined.ok);

  store.updatePosition(convoy.id, joined.member.id, fix(52.52, 13.405), T0);
  const ping = store.addPing(convoy.id, joined.member.id, "fuel", T0);
  assert.equal(ping?.at_position?.lat, 52.52);

  for (let i = 0; i < 60; i += 1) store.addPing(convoy.id, joined.member.id, "fuel", T0 + i);
  assert.ok(convoy.pings.length <= 40);
});

test("the sweep only drops convoys nobody is coming back to", () => {
  const store = new ConvoyStore({ ...testConfig(), convoyTtlMs: 1000 });
  const convoy = store.create("Trip", T0);
  const joined = store.join(convoy.code, "Mira", null, T0);
  assert.ok(joined.ok);

  assert.deepEqual(store.sweep(T0 + 10_000), [], "someone is still connected");

  store.setConnected(convoy.id, joined.member.id, false, T0);
  assert.deepEqual(store.sweep(T0 + 500), [], "still inside the TTL");

  assert.deepEqual(store.sweep(T0 + 10_000), [convoy.id]);
  assert.equal(store.getByCode(convoy.code), null);
  assert.equal(store.size, 0);
});

test("operations on a convoy that no longer exists are no-ops, not crashes", () => {
  const store = new ConvoyStore(testConfig());

  assert.equal(store.updatePosition("gone", "gone", fix(0, 0), T0), null);
  assert.equal(store.setDestination("gone", "gone", null, T0), null);
  assert.equal(store.addPing("gone", "gone", "fuel", T0), null);
  assert.equal(store.addWaypoint("gone", "gone", "x", 0, 0, T0), null);
  assert.deepEqual(store.refreshStatuses("gone", T0), []);
  store.removeMember("gone", "gone");
  store.setRoute("gone", "gone", null);
  store.rename("gone", "gone", "x", null);
});
