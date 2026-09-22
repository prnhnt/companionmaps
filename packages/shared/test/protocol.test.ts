import assert from "node:assert/strict";
import { test } from "node:test";

import { ProtocolError, parseClientMessage } from "../src/protocol.js";

test("hello is normalised", () => {
  const message = parseClientMessage(
    JSON.stringify({ t: "hello", code: "trk-4h2", name: "  Mira  ", vehicle: "" }),
  );

  assert.deepEqual(message, { t: "hello", code: "TRK-4H2", name: "Mira", vehicle: null });
});

test("hello keeps a resume identity when supplied", () => {
  const message = parseClientMessage({
    t: "hello",
    code: "TRK-4H2",
    name: "Mira",
    memberId: "m-1",
    token: "secret",
  });

  assert.equal(message.t, "hello");
  assert.equal(message.t === "hello" ? message.memberId : null, "m-1");
  assert.equal(message.t === "hello" ? message.token : null, "secret");
});

test("location accepts a bare fix and nulls the rest", () => {
  const message = parseClientMessage({ t: "location", lat: 52.52, lng: 13.405 });

  assert.deepEqual(message, {
    t: "location",
    lat: 52.52,
    lng: 13.405,
    headingDeg: null,
    speedMps: null,
    accuracyM: null,
    batteryPct: null,
  });
});

test("nonsense optional telemetry is dropped, not fatal", () => {
  const message = parseClientMessage({
    t: "location",
    lat: 52.52,
    lng: 13.405,
    headingDeg: 900,
    speedMps: -4,
    batteryPct: "full",
  });

  assert.equal(message.t === "location" ? message.headingDeg : 0, null);
  assert.equal(message.t === "location" ? message.speedMps : 0, null);
  assert.equal(message.t === "location" ? message.batteryPct : 0, null);
});

test("an out-of-range coordinate is rejected", () => {
  assert.throws(() => parseClientMessage({ t: "location", lat: 91, lng: 0 }), ProtocolError);
  assert.throws(() => parseClientMessage({ t: "location", lat: 0, lng: 181 }), ProtocolError);
  assert.throws(() => parseClientMessage({ t: "location", lat: "52", lng: 13 }), ProtocolError);
  assert.throws(() => parseClientMessage({ t: "location", lat: Number.NaN, lng: 13 }), ProtocolError);
});

test("long strings are truncated rather than rejected", () => {
  const message = parseClientMessage({ t: "rename", name: "x".repeat(200) });
  assert.equal(message.t === "rename" ? message.name.length : 0, 40);
});

test("ping kinds are checked against the enum", () => {
  assert.equal(parseClientMessage({ t: "ping", kind: "fuel" }).t, "ping");
  assert.throws(() => parseClientMessage({ t: "ping", kind: "party" }), ProtocolError);
  assert.throws(() => parseClientMessage({ t: "ping" }), ProtocolError);
});

test("malformed input never escapes as something else", () => {
  assert.throws(() => parseClientMessage("not json"), ProtocolError);
  assert.throws(() => parseClientMessage(null), ProtocolError);
  assert.throws(() => parseClientMessage([1, 2, 3]), ProtocolError);
  assert.throws(() => parseClientMessage({}), ProtocolError);
  assert.throws(() => parseClientMessage({ t: "launch-missiles" }), ProtocolError);
  assert.throws(() => parseClientMessage({ t: "hello", code: "", name: "Mira" }), ProtocolError);
});

test("the no-payload messages round-trip", () => {
  assert.deepEqual(parseClientMessage({ t: "heartbeat" }), { t: "heartbeat" });
  assert.deepEqual(parseClientMessage({ t: "leave" }), { t: "leave" });
  assert.deepEqual(parseClientMessage({ t: "clear-destination" }), { t: "clear-destination" });
});
