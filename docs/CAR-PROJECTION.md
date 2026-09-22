# CarPlay and Android Auto

## Why the server renders the car UI

Neither platform is a normal UI surface. The head unit draws **templates**, not
your views, and the constraints are enforced, not advisory:

| Constraint | CarPlay | Android Auto |
| --- | --- | --- |
| List rows while driving | keep it short (Apple's guidance) | **6**, enforced |
| Action strip | map buttons, keep to 4 | **4**, enforced |
| Lines of text per row | 2 | 2 |
| Free text entry while driving | blocked | blocked |
| Custom drawing | map layer only | map layer only |
| Template refresh rate | throttled | throttled |

A car app that recomputes "who is ahead" locally is a third implementation of
rules the server and the web client already have — and the first time the three
disagree, the driver is looking at a screen telling them something different
from their passenger's phone.

So the entire driving-safe view is computed server-side, with every cap already
applied and every string already rendered. The car app paints it.

```
GET /api/convoys/:code/car-view?memberId=<your member id>
```

`buildCarView()` in `packages/shared/src/car.ts` is the single implementation.
The HTTP endpoint calls it; the web client's **Car view** button calls it. If
it fits in the preview, it fits in the car.

## The payload

```jsonc
{
  "title": "Sanssouci, Potsdam",          // ≤ 32 chars
  "subtitle": "4 cars · spread 4.2 km",   // ≤ 42 chars
  "etaText": "38 min",
  "arrivalText": "14:32",
  "distanceText": "34 km",
  "rows": [                                // ≤ 6, most urgent first
    {
      "id": "…",
      "title": "Mira · 2.1 km ahead",      // ≤ 32 chars
      "subtitle": "ETA 14:28 · -4 min",    // ≤ 42 chars
      "tint": "#2563eb",
      "badge": "urgent",                   // urgent | stale | arrived | lagging | null
      "distanceM": 2140,
      "bearingDeg": 287.4,
      "lat": 52.41, "lng": 13.06
    }
  ],
  "truncatedCount": 0,
  "alerts": [                              // ≤ 3
    { "level": "urgent", "text": "Mira: Need help" }
  ],
  "actions": [                             // ≤ 4, every one a single tap
    { "id": "ping:wait-for-me", "title": "Wait for me" }
  ],
  "generatedAt": 1790067426760
}
```

### Row ordering

Rows are sorted by how much they deserve the driver's attention — an urgent
ping, then a lost signal, then someone falling badly behind — and by convoy
order within each tier.

Pure convoy order would be more predictable, which usually wins in a car. It
loses here because the one thing a driver must never have to scroll for is the
car that dropped off the map an hour into the drive.

`truncatedCount` tells you how many companions did not fit, so the UI can say
so rather than silently hiding people.

## CarPlay

`CPMapTemplate` for the map, with the convoy markers drawn on your own
`MKMapView`, and a `CPListTemplate` for the companions.

```swift
struct CarRow: Decodable {
    let id: String, title: String, subtitle: String
    let tint: String
    let badge: String?
    let lat: Double?, lng: Double?
}

struct CarView: Decodable {
    let title: String, subtitle: String
    let etaText: String, arrivalText: String, distanceText: String
    let rows: [CarRow]
    let truncatedCount: Int
    let alerts: [CarAlert]
    let actions: [CarAction]
}

func listTemplate(from view: CarView) -> CPListTemplate {
    let items = view.rows.map { row -> CPListItem in
        // Both strings are already capped server-side; no truncation here.
        let item = CPListItem(text: row.title, detailText: row.subtitle)
        item.handler = { _, completion in
            focusCompanion(row.id)          // recentre the map on them
            completion()
        }
        return item
    }

    let template = CPListTemplate(title: view.title, sections: [CPListSection(items: items)])
    template.emptyViewSubtitleVariants = ["Nobody else has joined yet"]
    return template
}

// The header estimate is the trip estimate, not a list row.
mapTemplate.update(
    CPTravelEstimates(
        distanceRemaining: Measurement(value: distanceM, unit: UnitLength.meters),
        timeRemaining: durationS
    ),
    for: tripSession,
    with: .green
)
```

- Map the four `actions` onto `mapTemplate.leadingNavigationBarButtons` /
  `trailingNavigationBarButtons`, or `CPMapButton`s. Send the `id` straight
  back to the server; `ping:*` ids map onto the `ping` WebSocket message.
- `alerts` with `level: "urgent"` belong in a `CPAlertTemplate` or the
  navigation banner, not buried in the list.
- Refresh on a timer (the same one-second cadence as the phone is fine) and
  call `updateSections` — do not rebuild the template.

## Android Auto

`NavigationTemplate` with an `ItemList`, from `androidx.car.app`.

```kotlin
fun buildPane(view: CarView, ctx: CarContext): ItemList {
    val builder = ItemList.Builder()

    // The server already applied the 6-row cap. Re-clamp anyway: the cap is
    // enforced by the host and an over-long list throws.
    view.rows.take(ctx.constraintManager
        .getContentLimit(ConstraintManager.CONTENT_LIMIT_TYPE_LIST)).forEach { row ->
        builder.addItem(
            Row.Builder()
                .setTitle(row.title)
                .addText(row.subtitle)
                .setOnClickListener { focusCompanion(row.id) }
                .build()
        )
    }

    if (view.truncatedCount > 0) {
        builder.setNoItemsMessage("+${view.truncatedCount} more")
    }
    return builder.build()
}

fun buildTemplate(view: CarView, ctx: CarContext) = NavigationTemplate.Builder()
    .setActionStrip(
        ActionStrip.Builder().apply {
            // ActionStrip holds at most 4; actions is already capped at 4.
            view.actions.forEach { action ->
                addAction(Action.Builder()
                    .setTitle(action.title)
                    .setOnClickListener { sendCarAction(action.id) }
                    .build())
            }
        }.build()
    )
    .setNavigationInfo(
        RoutingInfo.Builder()
            .setCurrentStep(currentStep, Distance.create(distanceM, Distance.UNIT_METERS))
            .build()
    )
    .setDestinationTravelEstimate(
        TravelEstimate.Builder(
            Distance.create(distanceM, Distance.UNIT_METERS),
            arrivalDateTime
        ).setRemainingTimeSeconds(durationS).build()
    )
    .build()
```

- Always re-clamp with `ConstraintManager.getContentLimit(...)`. The six-row
  figure is the common case, not a guarantee; some hosts are stricter.
- `invalidate()` on new data; do not construct a new `Screen`.
- Android Auto throttles template refreshes. Polling `/car-view` once a second
  and invalidating only when the payload actually differs is the right pattern.

## Action ids

| id | meaning |
| --- | --- |
| `ping:wait-for-me` | send the `wait-for-me` ping |
| `ping:rest-stop` | send the `rest-stop` ping |
| `ping:on-my-way` | send the `on-my-way` ping |
| `fit:convoy` | client-side: zoom the map to the whole convoy |

`ping:*` ids map directly onto the `{ "t": "ping", "kind": … }` WebSocket
message. Everything else is a client-side camera command, handled without a
round trip.

## What is deliberately absent

- **No free text anywhere.** Every action is one tap. This is why pings exist
  in the protocol at all instead of a chat.
- **No confirmation dialogs.** A modal in a moving car is a hazard.
- **No colour-only meaning.** `badge` carries the state as a word; `tint` only
  matches the row to its map marker.
- **No scrolling expectation.** Anything past six rows is summarised, never
  silently dropped.
