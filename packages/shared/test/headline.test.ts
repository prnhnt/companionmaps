import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveHeadline } from "../src/headline.js";
import { destinationPoint } from "../src/geo.js";
import { T0, convoy, member, position } from "./helpers.js";

const DEST = { lat: 50.0755, lng: 14.4378 };

/** The shared helper names a member after its id; these need display names. */
const titleCase = (id: string): string =>
  id.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");

function at(id: string, km: number, extra: Parameters<typeof member>[1] = {}) {
  const point = destinationPoint(DEST, 0, km * 1000);
  const pos = position(point.lat, point.lng, T0, { speedMps: 25 });
  return member(id, { name: titleCase(id), position: pos, trail: [pos], ...extra });
}

const arrived = (id: string) =>
  member(id, {
    name: titleCase(id),
    position: position(DEST.lat, DEST.lng, T0),
    trail: [],
    arrivedAt: T0,
    status: "arrived",
  });

test("every headline is short enough to read at a glance", () => {
  const cases = [
    convoy([at("me", 80)]),
    convoy([at("me", 80), at("other", 60)]),
    convoy([at("me", 80), at("far-behind", 400)]),
    convoy([at("me", 80), member("gone", { name: "Gone", position: position(51, 14, T0 - 300_000), trail: [] })]),
    convoy([arrived("me"), at("other", 60)]),
    convoy([arrived("me"), arrived("a"), arrived("b")]),
    convoy([at("me", 80), at("other", 60)], {
      pings: [{ id: "p", from: "other", kind: "help", at: T0 - 5000, at_position: null }],
    }),
  ];

  for (const group of cases) {
    const headline = deriveHeadline(group, "me", T0);
    assert.ok(headline.text.length > 0);
    assert.ok(headline.text.length <= 34, `too long (${headline.text.length}): "${headline.text}"`);
    assert.ok(!headline.text.includes("Infinity"));
    assert.ok(!headline.text.includes("NaN"));
  }
});

test("a solo driver is told how to fix that", () => {
  const headline = deriveHeadline(convoy([at("me", 80)]), "me", T0);

  assert.equal(headline.text, "Just you so far");
  assert.equal(headline.tone, "info");
  assert.match(headline.detail ?? "", /code/);
});

test("an urgent ping outranks everything else", () => {
  const group = convoy(
    [at("me", 80), at("mira", 60), member("gone", { position: position(51, 14, T0 - 300_000), trail: [] })],
    { pings: [{ id: "p", from: "mira", kind: "wait-for-me", at: T0 - 3000, at_position: null }] },
  );

  const headline = deriveHeadline(group, "me", T0);
  assert.equal(headline.tone, "urgent");
  assert.match(headline.text, /^Mira: wait for me$/);
  assert.equal(headline.memberId, "mira");
});

test("your own ping is never headlined back at you", () => {
  const group = convoy([at("me", 80), at("other", 60)], {
    pings: [{ id: "p", from: "me", kind: "help", at: T0 - 3000, at_position: null }],
  });

  assert.notEqual(deriveHeadline(group, "me", T0).tone, "urgent");
});

test("a stale ping stops being the headline", () => {
  const group = convoy([at("me", 80), at("other", 60)], {
    pings: [{ id: "p", from: "other", kind: "help", at: T0 - 600_000, at_position: null }],
  });

  assert.notEqual(deriveHeadline(group, "me", T0).tone, "urgent");
});

test("a lost signal beats a lagging car", () => {
  const group = convoy([
    at("me", 80),
    at("slowpoke", 400),
    member("gone", { name: "Gone", position: position(51, 14, T0 - 300_000), trail: [] }),
  ]);

  const headline = deriveHeadline(group, "me", T0);
  assert.equal(headline.text, "Gone lost signal");
  assert.equal(headline.tone, "warn");
  assert.equal(headline.memberId, "gone");
});

test("only first names are used, so the line stays short", () => {
  const group = convoy([
    at("me", 80),
    at("x", 60, { name: "Alexandra Constantinopoulos" }),
  ]);
  const withPing = convoy([...group.members], {
    pings: [{ id: "p", from: "x", kind: "help", at: T0 - 1000, at_position: null }],
  });

  const headline = deriveHeadline(withPing, "me", T0);
  assert.match(headline.text, /^Alexandra: /);
});

test("arrival states read the way a person would say them", () => {
  const everyone = deriveHeadline(convoy([arrived("me"), arrived("a")]), "me", T0);
  assert.equal(everyone.text, "Everyone's here");
  assert.equal(everyone.tone, "calm");

  const oneOut = deriveHeadline(convoy([arrived("me"), at("tom", 40)]), "me", T0);
  assert.equal(oneOut.text, "Waiting for Tom");
  assert.equal(oneOut.memberId, "tom");
  assert.ok(oneOut.detail?.includes("out"));

  const twoOut = deriveHeadline(convoy([arrived("me"), at("tom", 40), at("sam", 50)]), "me", T0);
  assert.equal(twoOut.text, "Waiting for 2");
  assert.equal(twoOut.memberId, null, "no single member to focus on");
});

test("a car dropping well behind is named", () => {
  const headline = deriveHeadline(convoy([at("me", 40), at("tom", 300)]), "me", T0);

  assert.equal(headline.tone, "warn");
  assert.match(headline.text, /^Tom .* behind$/);
  assert.equal(headline.memberId, "tom");
});

test("a tight convoy says nothing alarming", () => {
  const headline = deriveHeadline(convoy([at("me", 40), at("a", 41), at("b", 42)]), "me", T0);

  assert.equal(headline.text, "3 cars together");
  assert.equal(headline.tone, "calm");
  assert.equal(headline.memberId, null);
});

test("a car slightly ahead is not an alarm", () => {
  const headline = deriveHeadline(convoy([at("me", 41), at("a", 40)]), "me", T0);
  assert.equal(headline.tone, "calm");
});
