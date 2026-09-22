import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_CAR_ACTIONS, MAX_CAR_ROWS, MAX_CAR_SUBTITLE_CHARS, MAX_CAR_TITLE_CHARS, buildCarView } from "../src/car.js";
import { destinationPoint } from "../src/geo.js";
import { T0, convoy, member, position } from "./helpers.js";

const DEST = { lat: 50.0755, lng: 14.4378 };

function at(id: string, km: number, extra: Parameters<typeof member>[1] = {}) {
  const point = destinationPoint(DEST, 0, km * 1000);
  const pos = position(point.lat, point.lng, T0, { speedMps: 25 });
  return member(id, { position: pos, trail: [pos], ...extra });
}

test("the car view never exceeds the platform caps", () => {
  const members = Array.from({ length: 12 }, (_, i) => at(`driver-${i}`, 40 + i * 5));
  const view = buildCarView(convoy(members), "driver-0", T0);

  assert.equal(view.rows.length, MAX_CAR_ROWS);
  assert.equal(view.truncatedCount, 11 - MAX_CAR_ROWS);
  assert.ok(view.actions.length <= MAX_CAR_ACTIONS);
  assert.ok(view.alerts.length <= 3);

  for (const row of view.rows) {
    assert.ok(row.title.length <= MAX_CAR_TITLE_CHARS, `title too long: ${row.title}`);
    assert.ok(row.subtitle.length <= MAX_CAR_SUBTITLE_CHARS, `subtitle too long: ${row.subtitle}`);
  }
  assert.ok(view.title.length <= MAX_CAR_TITLE_CHARS);
  assert.ok(view.subtitle.length <= MAX_CAR_SUBTITLE_CHARS);
});

test("the driver is not listed among their own companions", () => {
  const view = buildCarView(convoy([at("me", 80), at("other", 60)]), "me", T0);

  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0]!.id, "other");
});

test("the header carries the driver's own trip estimate", () => {
  const view = buildCarView(convoy([at("me", 80), at("other", 60)]), "me", T0);

  assert.notEqual(view.etaText, "--");
  assert.notEqual(view.distanceText, "--");
  assert.match(view.subtitle, /2 cars/);
});

test("a lost companion is hoisted to the top with a stale badge", () => {
  const members = [
    at("me", 100),
    at("near", 95),
    member("lost", { position: position(51.5, 13.9, T0 - 200_000), trail: [] }),
  ];
  const view = buildCarView(convoy(members), "me", T0);

  assert.equal(view.rows[0]!.id, "lost");
  assert.equal(view.rows[0]!.badge, "stale");
  assert.ok(view.alerts.some((alert) => alert.text.includes("lost")));
});

test("an urgent ping outranks a lost signal and raises an alert", () => {
  const members = [at("me", 100), at("mira", 95), member("lost", { position: position(51.5, 13.9, T0 - 200_000), trail: [] })];
  const group = convoy(members, {
    pings: [{ id: "p1", from: "mira", kind: "help", at: T0 - 10_000, at_position: null }],
  });

  const view = buildCarView(group, "me", T0);
  assert.equal(view.rows[0]!.id, "mira");
  assert.equal(view.rows[0]!.badge, "urgent");
  assert.ok(view.alerts.some((alert) => alert.level === "urgent" && alert.text.includes("Need help")));
});

test("your own ping is not echoed back to you as an alert", () => {
  const group = convoy([at("me", 100), at("other", 95)], {
    pings: [{ id: "p1", from: "me", kind: "help", at: T0 - 10_000, at_position: null }],
  });

  const view = buildCarView(group, "me", T0);
  assert.equal(view.alerts.filter((a) => a.level === "urgent").length, 0);
});

test("an old ping stops being urgent", () => {
  const group = convoy([at("me", 100), at("other", 95)], {
    pings: [{ id: "p1", from: "other", kind: "help", at: T0 - 600_000, at_position: null }],
  });

  const view = buildCarView(group, "me", T0);
  assert.equal(view.alerts.filter((a) => a.level === "urgent").length, 0);
  assert.equal(view.rows[0]!.badge, null);
});

test("rows say ahead or behind in the driver's own terms", () => {
  const view = buildCarView(convoy([at("me", 80), at("lead", 40), at("tail", 120)]), "me", T0);
  const byId = new Map(view.rows.map((row) => [row.id, row]));

  assert.match(byId.get("lead")!.title, /ahead/);
  assert.match(byId.get("tail")!.title, /behind/);
});

test("a stretched convoy raises a warning in minutes, not metres", () => {
  const view = buildCarView(convoy([at("me", 40), at("far", 90)]), "me", T0);
  assert.ok(view.alerts.some((alert) => alert.level === "warning" && /apart/.test(alert.text)));
});

test("a convoy that is far apart but arriving together is not stretched", () => {
  // 4 km of road between them at motorway speed is barely two minutes.
  const view = buildCarView(convoy([at("me", 40), at("ahead", 36)]), "me", T0);
  assert.equal(view.alerts.some((alert) => /apart|stretched/.test(alert.text)), false);
});

test("a convoy without a destination still renders", () => {
  const group = convoy([at("me", 80), at("other", 60)], { destination: null });
  const view = buildCarView(group, "me", T0);

  assert.equal(view.title, "Road trip");
  assert.equal(view.etaText, "--");
  assert.equal(view.rows.length, 1);
});

test("a member who has never shared a location says so, not \"Infinity ago\"", () => {
  const silent = member("silent", { position: null, trail: [] });
  const view = buildCarView(convoy([at("me", 80), silent]), "me", T0);

  const row = view.rows.find((r) => r.id === "silent")!;
  assert.match(row.title, /no position yet/);
  assert.equal(row.subtitle, "Not sharing a location yet");
  assert.ok(!JSON.stringify(view).includes("Infinity"));
});

test("a car parked at the destination reads as arrived, not stale", () => {
  // Status is derived server-side and shipped with the member, so the
  // fixture sets it the way the server would.
  const parked = member("parked", {
    position: position(DEST.lat, DEST.lng, T0 - 600_000),
    trail: [],
    arrivedAt: T0 - 600_000,
    status: "arrived",
  });

  const view = buildCarView(convoy([at("me", 80), parked]), "me", T0);
  const row = view.rows.find((r) => r.id === "parked")!;

  assert.match(row.title, /arrived/);
  assert.match(row.subtitle, /^Arrived/);
  assert.equal(row.badge, "arrived");
});

test("a viewer with no fix still sees where everyone is", () => {
  const blind = member("me", { position: null, trail: [] });
  const view = buildCarView(convoy([blind, at("other", 60)]), "me", T0);
  const row = view.rows.find((r) => r.id === "other")!;

  assert.match(row.title, /on the map/);
  assert.equal(view.etaText, "--");
});

test("a solo driver gets an empty but valid view", () => {
  const view = buildCarView(convoy([at("me", 80)]), "me", T0);

  assert.deepEqual(view.rows, []);
  assert.equal(view.truncatedCount, 0);
  assert.ok(view.actions.length > 0);
});
