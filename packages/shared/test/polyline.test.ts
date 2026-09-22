import assert from "node:assert/strict";
import { test } from "node:test";

import { decodePolyline, encodePolyline } from "../src/polyline.js";

test("decodes the reference polyline from the format spec", () => {
  const points = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");

  assert.equal(points.length, 3);
  assert.deepEqual(
    points.map((p) => [Number(p.lat.toFixed(5)), Number(p.lng.toFixed(5))]),
    [
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ],
  );
});

test("encode and decode round-trip at precision 5", () => {
  const points = [
    { lat: 52.52001, lng: 13.40495 },
    { lat: 52.51234, lng: 13.41999 },
    { lat: 50.07553, lng: 14.43780 },
  ];

  const decoded = decodePolyline(encodePolyline(points));
  assert.equal(decoded.length, points.length);

  for (const [i, point] of points.entries()) {
    assert.ok(Math.abs(decoded[i]!.lat - point.lat) < 1e-5);
    assert.ok(Math.abs(decoded[i]!.lng - point.lng) < 1e-5);
  }
});

test("an empty polyline decodes to no points", () => {
  assert.deepEqual(decodePolyline(""), []);
  assert.equal(encodePolyline([]), "");
});

test("negative and southern-hemisphere coordinates survive the round-trip", () => {
  const points = [
    { lat: -33.86785, lng: 151.20732 },
    { lat: -37.81364, lng: 144.96306 },
  ];
  const decoded = decodePolyline(encodePolyline(points));

  for (const [i, point] of points.entries()) {
    assert.ok(Math.abs(decoded[i]!.lat - point.lat) < 1e-5);
    assert.ok(Math.abs(decoded[i]!.lng - point.lng) < 1e-5);
  }
});
