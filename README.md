# Companion Maps

Navigation for people who are driving to the same place in different cars.

Everyone in a convoy shares one destination and sees everyone else live on the
map — who is ahead, who is behind, how far apart you are, and who is going to
arrive when. Nobody has to tailgate the lead car to avoid getting lost, and
nobody has to phone the person behind to ask where they got to.

Tap a companion and their map opens **beside** yours, so you can watch their
position and yours at the same time without losing your own view.

> **Status: working prototype.** The convoy engine, the real-time protocol, the
> web client and the car projection are all real and tested. There is no native
> iOS/Android app yet — see [CarPlay and Android Auto](#carplay-and-android-auto).

---

## Quickstart

```bash
npm install

# terminal 1 — API + WebSocket hub
npm run dev:server

# terminal 2 — web client on http://localhost:5173
npm run dev:web

# terminal 3 — four simulated cars driving Berlin → Potsdam
npm run sim
```

The simulator prints a convoy code and a URL. Open it, enter a name, join, and
you will see four cars moving, stretching apart, stopping for a break and
losing signal. Click any of them for the side-by-side view.

You do not need an API key, an account, or a car.

### Trying it without a GPS

At a desk, the browser either has no location or reports your desk. The top bar
has a **Simulate** toggle that drives your own car toward the shared
destination, so you appear on everyone else's map too.

---

## What it does

**Convoy** — one destination, a short join code (`TRK-4H2`), up to 12 cars.
Anyone can set or change the destination; it applies to everyone at once.

**Live positions** — each car's position, heading, speed and battery, with a
breadcrumb trail behind it. Markers glide between fixes instead of teleporting,
and turn to face the direction of travel.

**Convoy order** — the sidebar is sorted by who is closest to the destination,
so the list *is* the running order. Each row shows the gap to you, whether they
are ahead or behind, and how their arrival compares to yours (`+4 min`).

**Side-by-side** — clicking a companion splits the stage: your convoy overview
on the left, their own followed map on the right, with the numbers underneath.
Drag the divider, use `←`/`→` to cycle companions, `Esc` to close.

**Convoy health** — spread between the front and back car, a warning when the
group drifts more than five minutes apart, and a flag on anyone whose signal
has gone.

**Pings** — one-tap messages that need no typing: *wait for me*, *rest stop*,
*need fuel*, *on my way*, *lost you*.

**Reconnects properly** — a reload or a tunnel rejoins as the same car rather
than leaving a ghost marker behind, and a disconnected car stays on the map as
"no signal" instead of vanishing.

---

## How it fits together

```
packages/shared   domain model, geo math, ETA, convoy derivation,
                  wire protocol, car projection   ← all the rules live here
packages/server   WebSocket hub, in-memory store, provider proxy, simulator
packages/web      React + MapLibre client
```

Everything that decides *anything* — who is ahead, what the ETA is, whether the
convoy is stretched, what a car display should show — lives in `shared` and is
unit-tested without a socket, a map or a DOM. The server and the client are
both thin layers over it. That is what keeps the phone UI and the car UI from
ever disagreeing about who is in front.

`docs/ARCHITECTURE.md` goes into the real-time design, the ETA strategy and
the scaling limits.

### Real-time

Clients send fixes as they get them. The server stamps them with its own clock
(device clocks are wrong often enough to corrupt every ETA in the convoy),
recomputes derived state, and flushes **one batched frame per convoy per
second** rather than a frame per fix per member. Rate limits are per-connection
and per-message-type; pings are held to a much tighter budget than positions
because they land on other people's screens.

### ETAs

If a road route is available it is used. If not, the fallback is a
detour-corrected straight line at the member's own rolling average speed,
measured as distance-over-time across a five-minute window so that traffic
lights and short stops are folded in. Both paths produce the same shape, so a
convoy's numbers stay comparable even when routing is down.

---

## Map, routing and search providers

The default stack is free and needs no key, which is what makes this repo
runnable the moment you clone it:

| Concern | Default | Notes |
| --- | --- | --- |
| Basemap | OpenStreetMap raster tiles | via MapLibre GL |
| Routing | public OSRM demo server | `OSRM_URL` |
| Search | Nominatim | `NOMINATIM_URL` |

**None of these defaults are shippable.** The OSMF tile servers and the OSRM
and Nominatim demo instances are donated resources with usage policies that
rule out app traffic at any real scale. Before this goes anywhere near users:

- point `VITE_MAP_STYLE` at your own tiles or a commercial style;
- self-host OSRM (`docker run osrm/osrm-backend`) and set `OSRM_URL`;
- self-host Nominatim, or use a paid geocoder, and set `NOMINATIM_URL`;
- set `GEO_CONTACT` to a real contact address.

Routing and search are proxied through the server rather than called from the
browser. That is deliberate: it is what lets us honour Nominatim's
one-request-per-second policy, cache across all clients instead of per tab, and
swap either provider without shipping a new client. Swapping in Google Maps
Platform, Mapbox or anything else means rewriting `packages/server/src/providers.ts`
and `packages/web/src/map/style.ts` — and nothing else.

Copy `.env.example` to `.env` to change any of this.

---

## CarPlay and Android Auto

There is no native app in this repo yet, but the hard part is done and testable.

Neither platform lets an app draw what it likes: the head unit renders fixed
templates, Android Auto caps a list at **six rows** while the vehicle is
moving, the action strip holds **four** actions, text truncates hard, and free
text entry is blocked outright while driving.

So the server renders the whole driving-safe view — every string, every cap
already applied — and the car app becomes a dumb painter of it:

```
GET /api/convoys/:code/car-view?memberId=…
```

The web client's **Car view** button previews exactly that payload, using the
same `buildCarView` the endpoint uses. If it fits in the preview, it fits in
the car.

`docs/CAR-PROJECTION.md` maps every field onto `CPListItem` /
`androidx.car.app.model.Row`, with the Swift and Kotlin to consume it.

---

## Commands

```bash
npm test                 # 108 tests across shared + server
npm run typecheck        # all three packages
npm run build            # production web bundle
npm run sim -- --help    # see below
```

Simulator flags:

```bash
npm run sim -- --drivers 6 --speed 20        # six cars, 20× real time
npm run sim -- --code TRK-4H2                # join a convoy you already opened
npm run sim -- --from 48.21,16.37 --to 47.80,13.04
```

---

## Known limits

These are design choices for a prototype, not oversights:

- **Convoys live in memory**, so there is one server process and no horizontal
  scaling. A convoy is worthless ten minutes after the drive ends, so this fits
  the data — but `ConvoyStore` is a narrow interface precisely so a Redis
  implementation can drop in.
- **Anyone with the code can join.** The code is the only credential. Fine for
  a group chat, not fine for strangers; real deployment needs an account model.
- **No location history or consent flow.** Positions are kept only while the
  convoy is alive, which is the right default, but a shipping product needs an
  explicit "who can see me, and until when" surface.
- **Up to 12 cars.** The batching is fine well past that; the UI is not.
- **Route geometry is only drawn for you and the companion you have open**, to
  keep the map readable.
