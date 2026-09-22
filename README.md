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

## Designed to be used while driving

A glance at a screen in a moving car is worth about a second and a half. That
is the constraint everything below falls out of.

**The app picks its own layout.** Speed decides: above ~15 km/h you get the
driving layout, and after a minute and a half stopped the full one comes back.
The threshold has a 90-second delay on the way out, so a red light or a toll
booth does not reshuffle the interface underneath you. You can override it,
and the override lasts — except that a full minute of genuine driving will
overrule a manual "I'm parked", because otherwise one tap at a services stop
would disable the safe layout for the rest of the journey.

**Driving, there are three controls.** Say something, show the whole convoy,
and go back to the full layout. Everything else a moving car does not need,
and a control you do not need makes the one you do need harder to hit. Every
target clears 44pt several times over; the type, spacing and tap sizes all
step up bodily from one set of tokens.

**One sentence, not a dashboard.** The app does the scanning and asserts the
single most important thing — *Tom 7 min behind*, *Mira lost signal*,
*4 cars together* — ranked so an urgent ping beats a lost signal beats a
straggler. Everything else is available; nothing else is asserted.

**Nobody types.** There is no text entry anywhere except the join screen and
destination search, and destination search warns you if you are moving.
Talking to the convoy is six buttons: *wait for me*, *rest stop*, *need fuel*,
*on my way*, *lost you*, *need help*. One tap, sent, closed — no confirmation
step, because a modal on top of a modal in a moving car is worse than an
occasional stray ping.

**The screen stays on** while you are driving and sharing a location, and the
lock is dropped the moment the app is backgrounded.

## What it does

**Convoy** — one destination, a short join code (`TRK-4H2`), up to 12 cars.
Anyone can set or change the destination; it applies to everyone at once.

**Live positions** — each car's position, heading, speed and battery, with a
breadcrumb trail behind it. Markers glide between fixes instead of teleporting,
and turn to face the direction of travel.

**Convoy order** — companions are sorted by who is closest to the destination,
so the list *is* the running order. Each card carries three facts and no more:
who, how far, which way.

**Side-by-side** — tap a companion and their own followed map opens beside
yours, with the numbers underneath: the gap between you, whether they are
ahead or behind, and how their arrival compares to yours. On a phone it
becomes a dock over the lower half instead, because two maps across a 400px
screen is two maps you cannot read. Drag the divider, `←`/`→` to cycle,
`Esc` to close.

**Convoy health** — a warning when the group drifts more than five minutes
apart, and a flag on anyone whose signal has gone.

**Getting in is one screen** — the code fills itself in from the link, your
name is remembered, and the invite goes out through the OS share sheet to
whatever group chat you are already using.

**Reconnects properly** — a reload or a tunnel rejoins as the same car rather
than leaving a ghost marker behind, and a disconnected car stays on the map as
"no signal" instead of vanishing.

## How it fits together

```
packages/shared   domain model, geo math, ETA, convoy derivation, the
                  glanceable headline, wire protocol, car projection
packages/server   WebSocket hub, in-memory store, provider proxy, simulator
packages/web      React + MapLibre client, drive-mode policy
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
npm test                 # 133 tests across all three packages
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

## If the map is just a dark background

The convoy still works — positions, distances, ETAs and trails are all
computed by this app. What is missing is the basemap underneath, and the app
now says so on screen rather than leaving you with an unexplained void.

The default basemap is OpenStreetMap's public tile server, which is a donated
resource with a [usage policy](https://operations.osmfoundation.org/policies/tiles/)
that rules out app traffic — and it does turn requests away. Other common
causes are no internet, a privacy or ad blocker (tile domains are on some
filter lists), or a corporate network.

Quickest check: open the browser console and look for failed requests to
`tile.openstreetmap.org`.

The fix is to point `VITE_MAP_STYLE` at a basemap you control:

```bash
# .env
VITE_MAP_STYLE=https://your-tileserver.example/style.json
```

Free-tier options that work without a key, or with a free one:

| Provider | Style URL | Notes |
| --- | --- | --- |
| MapLibre demo | `https://demotiles.maplibre.org/style.json` | No key. Coastlines and borders only — not navigable, but always up. This is what the in-app "low-detail map" button switches to. |
| MapTiler | `https://api.maptiler.com/maps/streets-v2/style.json?key=YOUR_KEY` | Free tier, needs a key. Full detail. |
| Stadia Maps | `https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json` | Free for non-commercial, domain registration required. |
| Protomaps | self-hosted `.pmtiles` | No per-request cost; one file you serve yourself. |

Attribution is read back from whichever style actually loads, so swapping
providers keeps the credit line correct.

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
- **Map markers do not avoid each other.** Cars sitting within a few hundred
  metres overlap their name labels. Fixing it properly means moving from
  MapLibre markers to a symbol layer with collision detection.
- **Drive mode is inferred from speed alone**, so a passenger holding the phone
  gets the driving layout too. The manual override is the answer, and it is one
  tap.
- **The default basemap is not reliable and is not meant to be.** See
  [If the map is just a dark background](#if-the-map-is-just-a-dark-background).
