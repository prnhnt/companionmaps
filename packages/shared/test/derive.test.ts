import assert from "node:assert/strict";
import { test } from "node:test";

import {
  STRETCHED_ARRIVAL_SPAN_S,
  STRETCHED_SPREAD_M,
  deriveCompanionViews,
  deriveConvoyStats,
  deriveStatus,
} from "../src/derive.js";
import { destinationPoint } from "../src/geo.js";
import { T0, convoy, member, position } from "./helpers.js";

const DEST = { lat: 50.0755, lng: 14.4378 };

/** A member sitting `km` kilometres short of the destination. */
function at(id: string, km: number, extra: Parameters<typeof member>[1] = {}) {
  const point = destinationPoint(DEST, 0, km * 1000);
  const pos = position(point.lat, point.lng, T0, { speedMps: 25 });
  return member(id, { position: pos, trail: [pos], ...extra });
}

test("status is derived, not reported", () => {
  assert.equal(deriveStatus(at("a", 100), DEST, T0), "driving");

  const parked = at("b", 100, { position: position(51, 14, T0, { speedMps: 0 }) });
  assert.equal(deriveStatus(parked, DEST, T0), "stopped");

  const stale = at("c", 100);
  assert.equal(deriveStatus(stale, DEST, T0 + 60_000), "stale");
  assert.equal(deriveStatus(stale, DEST, T0 + 600_000), "offline");

  const arrived = member("d", { position: position(DEST.lat, DEST.lng, T0) });
  assert.equal(deriveStatus(arrived, DEST, T0), "arrived");

  const noFix = member("e", { position: null, trail: [] });
  assert.equal(deriveStatus(noFix, DEST, T0), "stale");
  assert.equal(deriveStatus(member("f", { position: null, trail: [], connected: false }), DEST, T0), "offline");
});

test("arrival beats staleness: a parked car at the destination has arrived", () => {
  const arrived = member("a", { position: position(DEST.lat, DEST.lng, T0) });
  assert.equal(deriveStatus(arrived, DEST, T0 + 120_000), "arrived");
});

test("companion views sort by convoy order, leader first", () => {
  const group = convoy([at("tail", 120), at("lead", 40), at("middle", 80)]);
  const views = deriveCompanionViews(group, "middle", T0);

  assert.deepEqual(views.map((v) => v.member.id), ["lead", "middle", "tail"]);
});

test("standing is relative to the viewer", () => {
  const group = convoy([at("lead", 40), at("me", 80), at("tail", 120)]);
  const views = deriveCompanionViews(group, "me", T0);
  const byId = new Map(views.map((v) => [v.member.id, v]));

  assert.equal(byId.get("lead")!.standing, "ahead");
  assert.equal(byId.get("tail")!.standing, "behind");
  assert.equal(byId.get("me")!.standing, "alongside");
  assert.equal(byId.get("me")!.isYou, true);
  assert.equal(byId.get("me")!.distanceFromYouM, 0);
});

test("two cars within a few hundred metres read as alongside", () => {
  const group = convoy([at("me", 80), at("buddy", 80.2)]);
  const views = deriveCompanionViews(group, "me", T0);
  const buddy = views.find((v) => v.member.id === "buddy")!;

  assert.equal(buddy.standing, "alongside");
  assert.ok(buddy.distanceFromYouM! < 400);
});

test("eta delta is signed against the viewer", () => {
  const group = convoy([at("me", 80), at("lead", 40), at("tail", 120)]);
  const views = deriveCompanionViews(group, "me", T0);
  const byId = new Map(views.map((v) => [v.member.id, v]));

  assert.ok(byId.get("lead")!.etaDeltaS! < 0, "the car ahead arrives earlier");
  assert.ok(byId.get("tail")!.etaDeltaS! > 0, "the car behind arrives later");
  assert.equal(byId.get("me")!.etaDeltaS, null);
});

test("a viewer with no fix still gets companion positions, minus the comparisons", () => {
  const group = convoy([member("me", { position: null, trail: [] }), at("other", 60)]);
  const views = deriveCompanionViews(group, "me", T0);
  const other = views.find((v) => v.member.id === "other")!;

  assert.equal(other.distanceFromYouM, null);
  assert.equal(other.bearingFromYouDeg, null);
  assert.equal(other.standing, "unknown");
  assert.ok(other.progress, "their own progress is still known");
});

test("stats measure spread along the route and flag a stretched convoy", () => {
  const tight = deriveConvoyStats(convoy([at("a", 40), at("b", 41)]), T0);
  assert.ok(tight.spreadM! < STRETCHED_SPREAD_M);
  assert.ok(tight.arrivalSpanS! < STRETCHED_ARRIVAL_SPAN_S);
  assert.equal(tight.isStretched, false);
  assert.equal(tight.frontMemberId, "a");
  assert.equal(tight.backMemberId, "b");

  const loose = deriveConvoyStats(convoy([at("a", 40), at("b", 60)]), T0);
  assert.ok(loose.spreadM! > STRETCHED_SPREAD_M);
  assert.equal(loose.isStretched, true);
});

test("stretch is judged in time, so far-apart cars arriving together are fine", () => {
  const stats = deriveConvoyStats(convoy([at("a", 40), at("b", 44)]), T0);

  assert.ok(stats.spreadM! > STRETCHED_SPREAD_M, "they really are 4 km apart");
  assert.equal(stats.isStretched, false, "but only a couple of minutes apart");
});

test("without a destination, spread falls back to the widest direct gap", () => {
  const group = convoy([at("a", 40), at("b", 60)], { destination: null });
  const stats = deriveConvoyStats(group, T0);

  assert.ok(stats.spreadM! > 15_000);
  assert.equal(stats.arrivalSpanS, null);
});

test("stragglers and arrivals are counted", () => {
  const group = convoy([
    at("a", 40),
    member("gone", { position: position(51, 14, T0 - 120_000), trail: [] }),
    member("there", { position: position(DEST.lat, DEST.lng, T0), arrivedAt: T0 }),
  ]);
  const stats = deriveConvoyStats(group, T0);

  assert.deepEqual(stats.stragglerIds, ["gone"]);
  assert.equal(stats.arrived, 1);
  assert.equal(stats.total, 3);
  assert.equal(stats.allArrived, false);
});

test("allArrived only once everyone is in", () => {
  const here = () => member(Math.random().toString(36).slice(2), {
    position: position(DEST.lat, DEST.lng, T0),
    arrivedAt: T0,
  });
  const stats = deriveConvoyStats(convoy([here(), here()]), T0);
  assert.equal(stats.allArrived, true);
});

test("a single-member convoy has no spread", () => {
  const stats = deriveConvoyStats(convoy([at("solo", 40)]), T0);
  assert.equal(stats.spreadM, null);
  assert.equal(stats.arrivalSpanS, null);
  assert.equal(stats.isStretched, false);
});
