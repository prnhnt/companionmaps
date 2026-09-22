import assert from "node:assert/strict";
import { test } from "node:test";

import { applyServerMessage } from "../src/apply.js";
import { T0, convoy, member, position } from "./helpers.js";

test("welcome and convoy snapshots replace the state outright", () => {
  const snapshot = convoy([member("a")]);

  assert.equal(
    applyServerMessage(null, {
      t: "welcome",
      protocol: 1,
      youId: "a",
      token: "t",
      convoy: snapshot,
      serverTime: T0,
    }),
    snapshot,
  );

  assert.equal(applyServerMessage(convoy([]), { t: "convoy", convoy: snapshot, serverTime: T0 }), snapshot);
});

test("a positions delta updates only the members it names", () => {
  const before = convoy([member("a"), member("b")]);
  const moved = position(48.2, 16.37, T0 + 1000, { speedMps: 30 });

  const after = applyServerMessage(before, {
    t: "positions",
    updates: [{ id: "a", position: moved, status: "driving", route: null, connected: true }],
    serverTime: T0 + 1000,
  });

  assert.ok(after);
  assert.notEqual(after, before, "a change must produce a new object");
  assert.equal(after.members[0]?.position?.lat, 48.2);
  assert.equal(after.members[0]?.lastSeenAt, T0 + 1000);
  assert.equal(after.members[1], before.members[1], "untouched members keep their identity");
});

test("the client rebuilds trails from position deltas", () => {
  let state = convoy([member("a")]);

  for (let i = 1; i <= 3; i += 1) {
    state = applyServerMessage(state, {
      t: "positions",
      updates: [
        {
          id: "a",
          position: position(52.52 + i * 0.01, 13.405, T0 + i * 1000),
          status: "driving",
          route: null,
          connected: true,
        },
      ],
      serverTime: T0,
    })!;
  }

  assert.equal(state.members[0]?.trail.length, 4, "the snapshot's point plus three deltas");
});

test("a repeated fix at the same spot does not grow the trail", () => {
  let state = convoy([member("a")]);
  const stationary = position(52.52, 13.405, T0 + 1000);

  for (let i = 0; i < 5; i += 1) {
    state = applyServerMessage(state, {
      t: "positions",
      updates: [{ id: "a", position: stationary, status: "stopped", route: null, connected: true }],
      serverTime: T0,
    })!;
  }

  assert.equal(state.members[0]?.trail.length, 1);
});

test("an update for an unknown member is ignored", () => {
  const before = convoy([member("a")]);
  const after = applyServerMessage(before, {
    t: "positions",
    updates: [{ id: "ghost", position: position(0, 0), status: "driving", route: null, connected: true }],
    serverTime: T0,
  });

  assert.equal(after, before, "nothing changed, so the reference should be stable");
});

test("members join and leave without disturbing the rest", () => {
  const before = convoy([member("a")]);
  const newcomer = member("b");

  const joined = applyServerMessage(before, { t: "member-joined", member: newcomer })!;
  assert.equal(joined.members.length, 2);

  const duplicate = applyServerMessage(joined, { t: "member-joined", member: newcomer });
  assert.equal(duplicate, joined, "a duplicate join is a no-op");

  const left = applyServerMessage(joined, { t: "member-left", memberId: "a" })!;
  assert.deepEqual(left.members.map((m) => m.id), ["b"]);

  assert.equal(applyServerMessage(left, { t: "member-left", memberId: "gone" }), left);
});

test("a new destination clears every cached route and arrival", () => {
  const before = convoy([
    member("a", {
      route: { distanceM: 100, durationS: 100, computedAt: T0, geometry: null },
      arrivedAt: T0,
    }),
  ]);

  const after = applyServerMessage(before, {
    t: "destination",
    destination: { label: "Vienna", lat: 48.2, lng: 16.37, setBy: "a", setAt: T0 },
  })!;

  assert.equal(after.destination?.label, "Vienna");
  assert.equal(after.members[0]?.route, null);
  assert.equal(after.members[0]?.arrivedAt, null);
});

test("pings accumulate, deduplicate and stay capped", () => {
  let state = convoy([member("a")]);
  const ping = { id: "p1", from: "a", kind: "fuel" as const, at: T0, at_position: null };

  state = applyServerMessage(state, { t: "ping", ping })!;
  assert.equal(state.pings.length, 1);

  const same = applyServerMessage(state, { t: "ping", ping });
  assert.equal(same, state, "the same ping twice is a no-op");

  for (let i = 0; i < 60; i += 1) {
    state = applyServerMessage(state, {
      t: "ping",
      ping: { ...ping, id: `p-${i}` },
    })!;
  }
  assert.equal(state.pings.length, 40);
});

test("deltas that arrive before the snapshot are dropped, not crashed on", () => {
  for (const message of [
    { t: "positions" as const, updates: [], serverTime: T0 },
    { t: "member-left" as const, memberId: "a" },
    { t: "ping" as const, ping: { id: "p", from: "a", kind: "fuel" as const, at: T0, at_position: null } },
  ]) {
    assert.equal(applyServerMessage(null, message), null);
  }
});

test("an error message leaves the convoy untouched", () => {
  const before = convoy([member("a")]);
  assert.equal(
    applyServerMessage(before, { t: "error", code: "rate-limited", message: "slow down" }),
    before,
  );
});
