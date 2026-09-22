import assert from "node:assert/strict";
import { test } from "node:test";

import { estimateProgress, rollingSpeedMps } from "../src/eta.js";
import { destinationPoint } from "../src/geo.js";
import { T0, convoy, member, position } from "./helpers.js";

test("rolling speed measures distance over the whole window", () => {
  // Five fixes, 60 s apart, 1 km each: 1000 m / 60 s ~= 16.7 m/s.
  const start = { lat: 52.52, lng: 13.405 };
  const trail = [0, 1, 2, 3, 4].map((i) =>
    position(
      destinationPoint(start, 90, i * 1000).lat,
      destinationPoint(start, 90, i * 1000).lng,
      T0 + i * 60_000,
    ),
  );

  const speed = rollingSpeedMps(trail, T0 + 4 * 60_000);
  assert.ok(speed !== null);
  assert.ok(Math.abs(speed - 16.7) < 1, `got ${speed}`);
});

test("rolling speed folds a stop into the average", () => {
  const start = { lat: 52.52, lng: 13.405 };
  // 1 km covered, then parked for four minutes.
  const trail = [
    position(start.lat, start.lng, T0),
    position(destinationPoint(start, 90, 1000).lat, destinationPoint(start, 90, 1000).lng, T0 + 60_000),
    position(destinationPoint(start, 90, 1000).lat, destinationPoint(start, 90, 1000).lng, T0 + 300_000),
  ];

  const speed = rollingSpeedMps(trail, T0 + 300_000);
  assert.ok(speed !== null);
  assert.ok(speed < 5, `a parked car should drag the average down, got ${speed}`);
});

test("rolling speed falls back to reported speeds when the trail is too short", () => {
  const trail = [position(52.52, 13.405, T0, { speedMps: 25 })];
  assert.equal(rollingSpeedMps(trail, T0), 25);
});

test("rolling speed is null with nothing to go on", () => {
  assert.equal(rollingSpeedMps([], T0), null);
  assert.equal(rollingSpeedMps([position(52.52, 13.405, T0 - 999_999)], T0), null);
});

test("progress is null without a position or a destination", () => {
  const withoutPosition = member("a", { position: null, trail: [] });
  assert.equal(estimateProgress(withoutPosition, { lat: 50, lng: 14 }, T0), null);
  assert.equal(estimateProgress(member("a"), null, T0), null);
});

test("estimated progress applies the detour factor", () => {
  const dest = { lat: 50.0755, lng: 14.4378 };
  const progress = estimateProgress(member("a"), dest, T0);

  assert.ok(progress);
  assert.equal(progress.source, "estimate");
  // ~280 km straight line, inflated by the road factor.
  assert.ok(progress.distanceM > 330_000 && progress.distanceM < 380_000, `got ${progress.distanceM}`);
  assert.equal(progress.arrivalAt, T0 + progress.durationS * 1000);
});

test("a fresh provider route wins over the estimate", () => {
  const dest = { lat: 50.0755, lng: 14.4378 };
  const withRoute = member("a", {
    route: { distanceM: 348_000, durationS: 12_600, computedAt: T0, geometry: null },
  });

  const progress = estimateProgress(withRoute, dest, T0);
  assert.ok(progress);
  assert.equal(progress.source, "route");
  assert.equal(progress.distanceM, 348_000);
  assert.equal(progress.durationS, 12_600);
});

test("a stale provider route is ignored", () => {
  const dest = { lat: 50.0755, lng: 14.4378 };
  const withStaleRoute = member("a", {
    route: { distanceM: 348_000, durationS: 12_600, computedAt: T0 - 600_000, geometry: null },
  });

  const progress = estimateProgress(withStaleRoute, dest, T0);
  assert.ok(progress);
  assert.equal(progress.source, "estimate");
});

test("a member inside the arrival radius reads as arrived with zero remaining", () => {
  const dest = { lat: 50.0755, lng: 14.4378 };
  const nearby = destinationPoint(dest, 10, 80);
  const arrived = member("a", { position: position(nearby.lat, nearby.lng), arrivedAt: T0 });

  const progress = estimateProgress(arrived, dest, T0 + 5000);
  assert.ok(progress);
  assert.equal(progress.hasArrived, true);
  assert.equal(progress.distanceM, 0);
  assert.equal(progress.durationS, 0);
  assert.equal(progress.arrivalAt, T0);
});

test("a parked car still gets a finite ETA", () => {
  const dest = { lat: 50.0755, lng: 14.4378 };
  const parked = member("a", {
    position: position(52.52, 13.405, T0, { speedMps: 0 }),
    trail: [position(52.52, 13.405, T0 - 120_000, { speedMps: 0 }), position(52.52, 13.405, T0, { speedMps: 0 })],
  });

  const progress = estimateProgress(parked, dest, T0);
  assert.ok(progress);
  assert.ok(Number.isFinite(progress.durationS));
  assert.ok(progress.durationS > 0);
  // The speed floor keeps a stopped car from reporting an infinite arrival.
  assert.ok(progress.speedMps >= 8.3);
});

test("convoy helper builds a shape estimateProgress accepts", () => {
  const group = convoy([member("a"), member("b")]);
  assert.equal(group.members.length, 2);
  assert.ok(estimateProgress(group.members[0]!, group.destination, T0));
});
