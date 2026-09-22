# Architecture

## The shape of the problem

A convoy app looks like a maps app and is actually a distributed-state app. The
map is the easy part — MapLibre draws markers. The hard parts are:

1. **Everyone must agree on who is ahead.** If my phone thinks I am leading and
   yours thinks you are, the feature is worse than useless.
2. **Fixes arrive irregularly, from devices that lie.** Phones report stale
   positions, wrong clocks, nonsense headings, and nothing at all in a tunnel.
3. **Battery and bandwidth are real constraints.** The phone is already running
   the GPS and the screen.
4. **The car display cannot think.** CarPlay and Android Auto render templates
   under strict caps; whatever logic they need must have happened already.

Every structural decision below falls out of one of those four.

## One source of truth for every rule

```
packages/shared/src/
  geo.ts        spherical geometry, formatters
  convoy.ts     the domain types
  eta.ts        remaining distance and time
  derive.ts     status, convoy order, standing, convoy health
  car.ts        the driving-safe projection
  protocol.ts   wire messages + validation
  apply.ts      client-side reducer for server messages
  polyline.ts   encoded polyline codec
```

Nothing in `server` or `web` decides anything a user sees. The server does I/O
and lifecycle; the client does rendering and input. Both import the same
functions for "is this member ahead of me", "what is their ETA", "is this
convoy stretched".

The practical payoff is that the entire product logic is testable with no
socket, no map and no DOM — and that the `/car-view` HTTP endpoint and the web
client's car preview cannot drift apart, because they are one function.

## Derived state, never reported state

A device sends a position. It does **not** send its status.

`deriveStatus` decides `driving | stopped | arrived | stale | offline` from the
fix, its age and the destination. A phone that claims to be driving while its
last fix is four minutes old is stale, whatever it says. Arrival latches with
hysteresis — you arrive inside 150 m and stop being arrived only past 300 m —
so a parking manoeuvre does not flicker the whole convoy's UI.

The server also stamps the receipt time over the device's own. Device clocks
are wrong often enough that trusting them would corrupt every ETA in the
convoy, and a relative-time product cannot survive that.

## Real-time transport

WebSocket, one connection per member, `hello` first or the socket is closed
after ten seconds.

**Batching.** Fixes are stored immediately and marked dirty; a per-convoy
timer flushes one `positions` frame per second carrying everyone who actually
moved. Broadcasting each fix on arrival would be O(n²) frames across a convoy
for no benefit — the map interpolates between updates anyway.

Staleness is recomputed on that same tick even when no traffic arrives, because
staleness is a function of time, not of packets. That is what makes a car going
into a tunnel turn grey without anyone sending anything.

**Identity across reconnects.** First join issues a member id and a token. The
token is stored per convoy beside the convoy, never *on* it — the whole
`Convoy` object is broadcast to every member, and a token is a credential.
Reconnecting with both resumes the same car; reconnecting without them starts a
new one. Without this, every reload leaves a ghost marker.

**Disconnect ≠ leave.** A closed socket marks the member disconnected and keeps
them on the map with their last known position; only an explicit `leave`, or
five minutes of silence, removes them. A car in a tunnel should not vanish.

**Rate limits** are per connection and per message type: a token bucket
allowing ~2 fixes/second sustained with a burst after a tunnel, and a much
tighter one for pings, because pings land on other people's screens. Exceeding
either drops the frame and warns once every five seconds rather than once per
frame.

## ETA strategy

Two paths, one shape:

- **Route** — a provider route to the shared destination, refreshed on a slow
  timer, cached on a ~100 m grid. 100 m of staleness is far inside the error of
  the estimate it feeds.
- **Estimate** — straight-line distance × 1.28 (the median inter-city road
  detour factor) ÷ the member's own rolling speed.

Rolling speed is measured as **distance over time across a five-minute
window**, not as the mean of the per-fix speed readings. That difference
matters: distance-over-time folds stops into the average, which is exactly what
an ETA needs. A car waiting at lights for two of the last five minutes should
not claim it will keep doing 90.

The speed is clamped to 30–130 km/h so a stopped car still produces a finite
arrival time rather than infinity.

Both paths return the same `Progress`, so a convoy's numbers stay comparable
even when routing is down — which matters more than any single number being
exact. `progress.source` says which path produced it, and the UI shows it.

## Convoy order and standing

Order is "remaining distance to the destination, ascending". That is a better
definition than any geometric one: two cars on opposite sides of a river are
not in convoy order by distance-to-each-other, but they are by
distance-to-destination.

Standing (`ahead` / `behind` / `alongside`) compares remaining distances with a
400 m dead zone, so two cars in the same traffic queue read as "together"
rather than swapping places every tick.

**Stretch is judged in time, not distance.** Four kilometres apart on a
motorway is two minutes and nobody cares; four kilometres apart through a city
is a quarter of an hour and someone is going to be standing in a car park. The
warning fires past five minutes of arrival spread, falling back to a 3 km
distance rule only when there is no destination to measure against.

## Client state

The client holds a `Convoy` and folds server messages onto it with
`applyServerMessage`, a pure function in `shared`. It returns the *same
reference* when nothing changed, so React skips the re-render — which matters
when frames arrive every second.

Trails are rebuilt client-side from the position deltas rather than
re-broadcast, so the wire carries one point per member per second instead of a
whole polyline.

Marker motion is interpolated in a single `requestAnimationFrame` loop per map:
each marker chases its reported position and heading, taking the shortest
rotation (a car crossing north must not spin 350° the wrong way) and teleporting
rather than gliding when a fix jumps more than half a degree.

## Providers

`GeoProviders` wraps routing and search behind two methods, with a serialised
polite queue (Nominatim's policy is one request per second, absolute), a TTL
cache, timeouts, and failure that degrades to the fallback rather than throwing.

All of it is server-side. The browser never talks to a provider. That is what
allows one rate-limit budget across all clients, one cache, and a provider swap
without shipping a new client.

## Scaling limits, honestly

- **In-memory store, single process.** Fits the data — a convoy is worthless
  ten minutes after the drive — but caps you at one box. `ConvoyStore` is
  deliberately a narrow interface so Redis can drop in; the hub would then need
  pub/sub for cross-process fan-out.
- **Fan-out is O(members²) in bytes** per tick. Irrelevant at 12 members,
  relevant at 200.
- **The join code is the only credential.** Fine for a group chat, not for
  strangers.
- **No persistence, no history.** Deliberate, and the right privacy default,
  but a shipping product needs an explicit consent surface.
