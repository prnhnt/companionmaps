import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EXIT_DELAY_MS,
  PIN_RELEASE_MS,
  type DriveState,
  initialDriveState,
  nextDriveState,
  pinDriveMode,
  unpinDriveMode,
} from "../src/driveModePolicy.js";

const T0 = 1_700_000_000_000;

const MOTORWAY = 30; // m/s, ~108 km/h
const TOWN = 8; // m/s, ~29 km/h
const CRAWL = 1.0; // m/s, queueing
const PARKED = 0;

/** Feeds the policy a speed held for `seconds`, sampling every two seconds. */
function drive(state: DriveState, speedMps: number | null, seconds: number, startAt: number): { state: DriveState; at: number } {
  let current = state;
  let at = startAt;

  for (let elapsed = 0; elapsed <= seconds; elapsed += 2) {
    at = startAt + elapsed * 1000;
    current = nextDriveState(current, { speedMps, enabled: true, now: at });
  }

  return { state: current, at };
}

test("nothing is inferred while no location is shared", () => {
  const state = nextDriveState(initialDriveState, { speedMps: MOTORWAY, enabled: false, now: T0 });
  assert.equal(state.mode, "plan");
  assert.equal(state, initialDriveState, "an unchanged state keeps its identity");
});

test("nothing is inferred from an unknown speed", () => {
  const state = nextDriveState(initialDriveState, { speedMps: null, enabled: true, now: T0 });
  assert.equal(state.mode, "plan");
});

test("pulling away switches to the driving layout immediately", () => {
  const state = nextDriveState(initialDriveState, { speedMps: MOTORWAY, enabled: true, now: T0 });
  assert.equal(state.mode, "drive");
  assert.equal(state.pinned, false);
});

test("walking pace is not driving", () => {
  const { state } = drive(initialDriveState, 1.2, 600, T0);
  assert.equal(state.mode, "plan");
});

test("a red light does not throw the layout away", () => {
  const moving = drive(initialDriveState, TOWN, 60, T0);
  assert.equal(moving.state.mode, "drive");

  // Ninety seconds of standing still is a long light, not the end of a trip.
  const stopped = drive(moving.state, PARKED, 80, moving.at);
  assert.equal(stopped.state.mode, "drive", "still driving as far as the app is concerned");

  const movingAgain = drive(stopped.state, TOWN, 10, stopped.at);
  assert.equal(movingAgain.state.mode, "drive");
  assert.equal(movingAgain.state.slowSince, null, "the exit timer is forgotten once moving");
});

test("arriving and stopping does return the full layout", () => {
  const moving = drive(initialDriveState, MOTORWAY, 60, T0);
  const parked = drive(moving.state, PARKED, EXIT_DELAY_MS / 1000 + 10, moving.at);

  assert.equal(parked.state.mode, "plan");
  assert.equal(parked.state.pinned, false);
});

test("crawling in traffic holds the driving layout", () => {
  const moving = drive(initialDriveState, MOTORWAY, 30, T0);
  // Between the two thresholds: neither clearly driving nor clearly stopped.
  const crawling = drive(moving.state, 2.5, 600, moving.at);

  assert.equal(crawling.state.mode, "drive");
});

test("stop-start traffic never accumulates its way out of drive mode", () => {
  let state = drive(initialDriveState, MOTORWAY, 20, T0).state;
  let at = T0 + 20_000;

  // Six cycles of 40s stopped, 20s moving: 240s stopped in total, but never
  // 90 consecutive, so the layout must hold.
  for (let i = 0; i < 6; i += 1) {
    const stopped = drive(state, CRAWL, 40, at);
    const rolling = drive(stopped.state, TOWN, 20, stopped.at);
    state = rolling.state;
    at = rolling.at;
  }

  assert.equal(state.mode, "drive");
});

test("a pinned plan survives a stop, and the driver keeps the full UI", () => {
  const pinned = pinDriveMode(initialDriveState, "plan");
  const { state } = drive(pinned, PARKED, 600, T0);

  assert.equal(state.mode, "plan");
  assert.equal(state.pinned, true);
});

test("a pinned plan gives way once the car is really driving again", () => {
  const pinned = pinDriveMode(initialDriveState, "plan");

  const brief = drive(pinned, MOTORWAY, 30, T0);
  assert.equal(brief.state.mode, "plan", "half a minute is not yet enough to overrule the driver");
  assert.equal(brief.state.pinned, true);

  const sustained = drive(brief.state, MOTORWAY, PIN_RELEASE_MS / 1000 + 10, T0);
  assert.equal(sustained.state.mode, "drive", "a minute of driving wins");
  assert.equal(sustained.state.pinned, false, "and automatic switching resumes");
});

test("pulling over resets the countdown that would overrule a pin", () => {
  const pinned = pinDriveMode(initialDriveState, "plan");

  const rolling = drive(pinned, MOTORWAY, 40, T0);
  assert.equal(rolling.state.disagreedSince != null, true);

  const stopped = drive(rolling.state, PARKED, 10, rolling.at);
  assert.equal(stopped.state.disagreedSince, null, "the countdown restarts next time");
  assert.equal(stopped.state.mode, "plan");

  // Another 40s of driving must not add to the earlier 40s.
  const again = drive(stopped.state, MOTORWAY, 40, stopped.at);
  assert.equal(again.state.mode, "plan");
});

test("a pinned drive layout is respected indefinitely while stopped", () => {
  const pinned = pinDriveMode(initialDriveState, "drive");
  const { state } = drive(pinned, PARKED, 3600, T0);

  assert.equal(state.mode, "drive", "pinning the safe layout costs nothing, so it is never revoked");
  assert.equal(state.pinned, true);
});

test("releasing the pin by hand hands control straight back to the road", () => {
  const pinned = pinDriveMode(initialDriveState, "plan");
  const released = unpinDriveMode(pinned);

  const state = nextDriveState(released, { speedMps: MOTORWAY, enabled: true, now: T0 });
  assert.equal(state.mode, "drive");
});

test("losing the location signal freezes the layout rather than flipping it", () => {
  const moving = drive(initialDriveState, MOTORWAY, 30, T0);
  const blackout = drive(moving.state, null, 600, moving.at);

  assert.equal(blackout.state.mode, "drive");
  assert.equal(blackout.state.slowSince, null);
});
