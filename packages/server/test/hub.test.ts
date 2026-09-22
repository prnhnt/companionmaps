import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

import type { ServerMessage } from "@companionmaps/shared";
import { WebSocket } from "ws";

import { loadConfig } from "../src/config.js";
import { createApp } from "../src/index.js";

/** Fast flush, and no outbound network: these tests must not touch OSRM. */
const config = {
  ...loadConfig({}),
  port: 0,
  broadcastIntervalMs: 25,
  routeRefreshMs: 3_600_000,
  osrmUrl: null,
  nominatimUrl: null,
  corsOrigins: ["*"],
};

const app = createApp(config);
let baseUrl = "";
let wsUrl = "";

before(async () => {
  await new Promise<void>((resolve) => app.server.listen(0, resolve));
  const { port } = app.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/ws`;
});

after(async () => {
  await app.hub.close();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
});

/** Minimal client that lets a test await the next message of a given type. */
class TestClient {
  readonly received: ServerMessage[] = [];
  readonly #waiters: { match: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  #closeCode: number | null = null;

  private constructor(readonly socket: WebSocket) {
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as ServerMessage;
      this.received.push(message);

      for (let i = this.#waiters.length - 1; i >= 0; i -= 1) {
        const waiter = this.#waiters[i]!;
        if (waiter.match(message)) {
          this.#waiters.splice(i, 1);
          waiter.resolve(message);
        }
      }
    });

    socket.on("close", (code) => {
      this.#closeCode = code;
    });
  }

  static async open(): Promise<TestClient> {
    const socket = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return new TestClient(socket);
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  waitFor<T extends ServerMessage["t"]>(
    type: T,
    match: (message: Extract<ServerMessage, { t: T }>) => boolean = () => true,
    timeoutMs = 3000,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    const predicate = (message: ServerMessage): boolean =>
      message.t === type && match(message as Extract<ServerMessage, { t: T }>);

    const already = this.received.find(predicate);
    if (already) return Promise.resolve(already as Extract<ServerMessage, { t: T }>);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for "${type}"; saw ${this.received.map((m) => m.t).join(", ") || "nothing"}`)),
        timeoutMs,
      );

      this.#waiters.push({
        match: predicate,
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message as Extract<ServerMessage, { t: T }>);
        },
      });
    });
  }

  async waitForClose(timeoutMs = 3000): Promise<number> {
    if (this.#closeCode != null) return this.#closeCode;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("socket did not close")), timeoutMs);
      this.socket.once("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
  }

  close(): void {
    this.socket.close();
  }
}

async function newConvoy(name = "Test trip"): Promise<string> {
  const response = await fetch(`${baseUrl}/api/convoys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  assert.equal(response.status, 201);
  return ((await response.json()) as { code: string }).code;
}

async function joinedClient(code: string, name: string): Promise<{ client: TestClient; youId: string; token: string }> {
  const client = await TestClient.open();
  client.send({ t: "hello", code, name });
  const welcome = await client.waitFor("welcome");
  return { client, youId: welcome.youId, token: welcome.token };
}

test("health reports what the server can actually do", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const body = (await response.json()) as { ok: boolean; routing: boolean };

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.routing, false, "routing is disabled in tests");
});

test("hello returns a welcome with an identity and the convoy", async () => {
  const code = await newConvoy();
  const { client, youId, token } = await joinedClient(code, "Mira");

  assert.ok(youId);
  assert.ok(token);
  const welcome = await client.waitFor("welcome");
  assert.equal(welcome.convoy.code, code);
  assert.equal(welcome.convoy.members.length, 1);
  assert.equal(welcome.convoy.members[0]?.name, "Mira");

  client.close();
});

test("an unknown code is rejected and the socket closed", async () => {
  const client = await TestClient.open();
  client.send({ t: "hello", code: "NOP-E00", name: "Mira" });

  const error = await client.waitFor("error");
  assert.equal(error.code, "no-such-convoy");
  assert.equal(await client.waitForClose(), 4004);
});

test("a second member is announced to the first", async () => {
  const code = await newConvoy();
  const first = await joinedClient(code, "Mira");
  const second = await joinedClient(code, "Tom");

  const joined = await first.client.waitFor("member-joined");
  assert.equal(joined.member.name, "Tom");
  assert.equal(joined.member.id, second.youId);

  // The announcement must not echo back to the member who caused it.
  assert.equal(second.client.received.some((m) => m.t === "member-joined"), false);

  first.client.close();
  second.client.close();
});

test("positions are batched and fanned out to the rest of the convoy", async () => {
  const code = await newConvoy();
  const mira = await joinedClient(code, "Mira");
  const tom = await joinedClient(code, "Tom");

  mira.client.send({ t: "location", lat: 52.52, lng: 13.405, speedMps: 22, headingDeg: 210 });

  const update = await tom.client.waitFor("positions", (m) =>
    m.updates.some((u) => u.id === mira.youId && u.position != null),
  );

  const entry = update.updates.find((u) => u.id === mira.youId)!;
  assert.equal(entry.position?.lat, 52.52);
  assert.equal(entry.position?.speedMps, 22);
  assert.equal(entry.status, "driving");
  assert.equal(entry.connected, true);

  mira.client.close();
  tom.client.close();
});

test("several fixes inside one tick arrive as a single frame", async () => {
  const code = await newConvoy();
  const mira = await joinedClient(code, "Mira");
  const tom = await joinedClient(code, "Tom");

  for (let i = 0; i < 8; i += 1) {
    mira.client.send({ t: "location", lat: 52.52 + i * 0.001, lng: 13.405 });
  }

  await tom.client.waitFor("positions");
  await new Promise((resolve) => setTimeout(resolve, 120));

  const frames = tom.client.received.filter((m) => m.t === "positions");
  assert.ok(frames.length < 8, `8 fixes should not mean 8 frames, got ${frames.length}`);

  mira.client.close();
  tom.client.close();
});

test("the destination is shared with everyone and echoed to the setter", async () => {
  const code = await newConvoy();
  const mira = await joinedClient(code, "Mira");
  const tom = await joinedClient(code, "Tom");

  mira.client.send({ t: "set-destination", label: "Prague", lat: 50.0755, lng: 14.4378 });

  for (const peer of [mira, tom]) {
    const message = await peer.client.waitFor("destination");
    assert.equal(message.destination?.label, "Prague");
    assert.equal(message.destination?.setBy, mira.youId);
  }

  mira.client.close();
  tom.client.close();
});

test("a ping reaches the convoy with its sender attached", async () => {
  const code = await newConvoy();
  const mira = await joinedClient(code, "Mira");
  const tom = await joinedClient(code, "Tom");

  mira.client.send({ t: "location", lat: 52.52, lng: 13.405 });
  mira.client.send({ t: "ping", kind: "rest-stop" });

  const ping = await tom.client.waitFor("ping");
  assert.equal(ping.ping.kind, "rest-stop");
  assert.equal(ping.ping.from, mira.youId);

  mira.client.close();
  tom.client.close();
});

test("ping spam is rate limited rather than relayed", async () => {
  const code = await newConvoy();
  const mira = await joinedClient(code, "Mira");
  const tom = await joinedClient(code, "Tom");

  for (let i = 0; i < 15; i += 1) mira.client.send({ t: "ping", kind: "fuel" });

  const rateLimited = await mira.client.waitFor("error", (m) => m.code === "rate-limited");
  assert.match(rateLimited.message, /ping/);

  await new Promise((resolve) => setTimeout(resolve, 100));
  const relayed = tom.client.received.filter((m) => m.t === "ping").length;
  assert.ok(relayed <= 4, `expected the burst to be clipped, ${relayed} got through`);

  mira.client.close();
  tom.client.close();
});

test("a malformed frame is reported without dropping the connection", async () => {
  const code = await newConvoy();
  const { client } = await joinedClient(code, "Mira");

  client.socket.send("this is not json");
  const error = await client.waitFor("error", (m) => m.code === "bad-message");
  assert.ok(error.message);

  // Still usable afterwards.
  client.send({ t: "location", lat: 52.52, lng: 13.405 });
  client.send({ t: "rename", name: "Mira B" });
  const snapshot = await client.waitFor("convoy");
  assert.equal(snapshot.convoy.members[0]?.name, "Mira B");

  client.close();
});

test("anything before hello is refused", async () => {
  const client = await TestClient.open();
  client.send({ t: "location", lat: 52.52, lng: 13.405 });

  const error = await client.waitFor("error");
  assert.equal(error.code, "not-joined");
  client.close();
});

test("reconnecting with the token resumes the same member", async () => {
  const code = await newConvoy();
  const first = await joinedClient(code, "Mira");
  first.client.send({ t: "location", lat: 52.52, lng: 13.405 });
  await new Promise((resolve) => setTimeout(resolve, 60));
  first.client.close();

  const resumed = await TestClient.open();
  resumed.send({ t: "hello", code, name: "Mira", memberId: first.youId, token: first.token });

  const welcome = await resumed.waitFor("welcome");
  assert.equal(welcome.youId, first.youId);
  assert.equal(welcome.convoy.members.length, 1, "a reload must not leave a ghost car behind");
  assert.equal(welcome.convoy.members[0]?.position?.lat, 52.52, "the trail survives the reconnect");

  resumed.close();
});

test("a wrong token cannot hijack a membership", async () => {
  const code = await newConvoy();
  const mira = await joinedClient(code, "Mira");

  const impostor = await TestClient.open();
  impostor.send({ t: "hello", code, name: "Mira", memberId: mira.youId, token: "not-the-token" });

  const error = await impostor.waitFor("error");
  assert.equal(error.code, "not-joined");
  assert.equal(await impostor.waitForClose(), 4004);

  mira.client.close();
});

test("a second connection for the same member replaces the first", async () => {
  const code = await newConvoy();
  const first = await joinedClient(code, "Mira");

  const second = await TestClient.open();
  second.send({ t: "hello", code, name: "Mira", memberId: first.youId, token: first.token });
  await second.waitFor("welcome");

  assert.equal(await first.client.waitForClose(), 4000);
  second.close();
});

test("leaving removes the member for everyone else", async () => {
  const code = await newConvoy();
  const mira = await joinedClient(code, "Mira");
  const tom = await joinedClient(code, "Tom");

  tom.client.send({ t: "leave" });

  const left = await mira.client.waitFor("member-left");
  assert.equal(left.memberId, tom.youId);

  mira.client.close();
});

test("a dropped connection leaves the car on the map as disconnected", async () => {
  const code = await newConvoy();
  const mira = await joinedClient(code, "Mira");
  const tom = await joinedClient(code, "Tom");

  tom.client.send({ t: "location", lat: 52.52, lng: 13.405 });
  await mira.client.waitFor("positions");
  tom.client.socket.terminate();

  const update = await mira.client.waitFor("positions", (m) =>
    m.updates.some((u) => u.id === tom.youId && !u.connected),
  );

  const entry = update.updates.find((u) => u.id === tom.youId)!;
  assert.equal(entry.connected, false);
  assert.ok(entry.position, "their last known position is still there");

  mira.client.close();
});

test("the car view is served over HTTP for a head unit to poll", async () => {
  const code = await newConvoy();
  const mira = await joinedClient(code, "Mira");
  const tom = await joinedClient(code, "Tom");

  mira.client.send({ t: "set-destination", label: "Prague", lat: 50.0755, lng: 14.4378 });
  mira.client.send({ t: "location", lat: 51.5, lng: 13.9, speedMps: 25 });
  tom.client.send({ t: "location", lat: 51.2, lng: 13.8, speedMps: 25 });
  await mira.client.waitFor("positions", (m) => m.updates.some((u) => u.id === tom.youId));

  const response = await fetch(`${baseUrl}/api/convoys/${code}/car-view?memberId=${mira.youId}`);
  assert.equal(response.status, 200);

  const view = (await response.json()) as { title: string; rows: { id: string; title: string }[]; etaText: string };
  assert.equal(view.title, "Prague");
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0]?.id, tom.youId);
  assert.match(view.rows[0]!.title, /Tom/);
  assert.notEqual(view.etaText, "--");

  mira.client.close();
  tom.client.close();
});

test("the car view refuses a member who is not in the convoy", async () => {
  const code = await newConvoy();
  const notFound = await fetch(`${baseUrl}/api/convoys/${code}/car-view?memberId=nobody`);
  assert.equal(notFound.status, 400);

  const missingConvoy = await fetch(`${baseUrl}/api/convoys/NOP-E00/car-view?memberId=x`);
  assert.equal(missingConvoy.status, 404);
});

test("the pre-join lookup describes a convoy without exposing positions", async () => {
  const code = await newConvoy("Alps run");
  const mira = await joinedClient(code, "Mira");
  mira.client.send({ t: "location", lat: 52.52, lng: 13.405 });
  await new Promise((resolve) => setTimeout(resolve, 60));

  const response = await fetch(`${baseUrl}/api/convoys/${code}`);
  const body = (await response.json()) as {
    name: string;
    memberNames: string[];
  } & Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body).sort(), [
    "code",
    "createdAt",
    "destinationLabel",
    "memberCount",
    "memberNames",
    "name",
  ]);
  assert.equal(body.name, "Alps run");
  assert.deepEqual(body.memberNames, ["Mira"]);
  assert.ok(!JSON.stringify(body).includes("52.52"), "the lookup leaked a position");

  mira.client.close();
});

test("search and route degrade to an empty answer when no provider is configured", async () => {
  const search = await fetch(`${baseUrl}/api/search?q=prague`);
  assert.deepEqual(await search.json(), { results: [] });

  const route = await fetch(`${baseUrl}/api/route?from=52.52,13.405&to=50.07,14.43`);
  assert.deepEqual(await route.json(), { route: null });

  const bad = await fetch(`${baseUrl}/api/route?from=nonsense&to=50.07,14.43`);
  assert.equal(bad.status, 400);
});
