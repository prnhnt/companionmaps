import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bearingDelta,
  bearingDeg,
  boundsOf,
  compassPoint,
  destinationPoint,
  formatDistance,
  formatDuration,
  formatAge,
  formatSignedDuration,
  haversineMeters,
  padBounds,
} from "../src/geo.js";

test("haversine matches a known city pair", () => {
  // Berlin -> Prague is ~280 km great-circle.
  const meters = haversineMeters({ lat: 52.52, lng: 13.405 }, { lat: 50.0755, lng: 14.4378 });
  assert.ok(Math.abs(meters - 280_000) < 5_000, `got ${meters}`);
});

test("haversine is zero for identical points and symmetric", () => {
  const a = { lat: 41.9, lng: 12.5 };
  const b = { lat: 45.46, lng: 9.19 };
  assert.equal(haversineMeters(a, a), 0);
  assert.ok(Math.abs(haversineMeters(a, b) - haversineMeters(b, a)) < 1e-6);
});

test("bearing points the right way", () => {
  const origin = { lat: 0, lng: 0 };
  assert.ok(Math.abs(bearingDeg(origin, { lat: 1, lng: 0 }) - 0) < 0.5);
  assert.ok(Math.abs(bearingDeg(origin, { lat: 0, lng: 1 }) - 90) < 0.5);
  assert.ok(Math.abs(bearingDeg(origin, { lat: -1, lng: 0 }) - 180) < 0.5);
  assert.ok(Math.abs(bearingDeg(origin, { lat: 0, lng: -1 }) - 270) < 0.5);
});

test("destinationPoint round-trips through haversine", () => {
  const origin = { lat: 48.2, lng: 16.37 };
  const moved = destinationPoint(origin, 42, 12_345);
  assert.ok(Math.abs(haversineMeters(origin, moved) - 12_345) < 1);
  assert.ok(Math.abs(bearingDeg(origin, moved) - 42) < 0.1);
});

test("bearingDelta takes the short way round", () => {
  assert.equal(bearingDelta(350, 10), 20);
  assert.equal(bearingDelta(10, 350), -20);
  assert.equal(bearingDelta(0, 180), 180);
});

test("boundsOf covers every point, padBounds only grows", () => {
  const points = [
    { lat: 1, lng: 2 },
    { lat: -3, lng: 8 },
    { lat: 4, lng: -1 },
  ];
  const bounds = boundsOf(points);
  assert.ok(bounds);
  assert.equal(bounds.north, 4);
  assert.equal(bounds.south, -3);
  assert.equal(bounds.east, 8);
  assert.equal(bounds.west, -1);

  const padded = padBounds(bounds, 0.1);
  assert.ok(padded.north > bounds.north);
  assert.ok(padded.south < bounds.south);
  assert.ok(padded.east > bounds.east);
  assert.ok(padded.west < bounds.west);

  assert.equal(boundsOf([]), null);
});

test("compass points wrap correctly", () => {
  assert.equal(compassPoint(0), "N");
  assert.equal(compassPoint(359), "N");
  assert.equal(compassPoint(90), "E");
  assert.equal(compassPoint(225), "SW");
});

test("formatters stay short enough for a car display", () => {
  assert.equal(formatDistance(340), "340 m");
  assert.equal(formatDistance(1234), "1.2 km");
  assert.equal(formatDistance(48_000), "48 km");
  assert.equal(formatDistance(null), "--");

  assert.equal(formatDuration(30), "<1 min");
  assert.equal(formatDuration(600), "10 min");
  assert.equal(formatDuration(4800), "1 h 20 min");
  assert.equal(formatDuration(7200), "2 h");

  assert.equal(formatSignedDuration(240), "+4 min");
  assert.equal(formatSignedDuration(-240), "-4 min");
  assert.equal(formatSignedDuration(10), "same time");
});

test("formatAge refuses to render a non-finite age", () => {
  assert.equal(formatAge(Number.POSITIVE_INFINITY), "--");
  assert.equal(formatAge(Number.NaN), "--");
  assert.equal(formatAge(0), "live");
  assert.equal(formatAge(45_000), "45s ago");
  assert.equal(formatAge(600_000), "10 min ago");
  assert.equal(formatAge(7_200_000), "2 h ago");
});
