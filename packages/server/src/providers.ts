/**
 * Free geo providers: Nominatim for search, OSRM for routing.
 *
 * Both are proxied through this server rather than called from the browser.
 * That is not incidental — it is what lets us honour Nominatim's one-request-
 * per-second policy and send a real User-Agent, cache across all clients
 * instead of per-tab, and swap either provider (for a self-hosted instance, or
 * for a commercial one) without shipping a new client.
 */

import type { LatLng, RouteEstimate } from "@companionmaps/shared";

import type { Config } from "./config.js";

export interface PlaceResult {
  label: string;
  lat: number;
  lng: number;
  kind: string;
}

export interface RouteResult extends RouteEstimate {
  /** Encoded polyline, precision 5, as OSRM returns it. */
  geometry: string | null;
}

/** Serialises calls to one provider and keeps them at least `spacingMs` apart. */
class PoliteQueue {
  #chain: Promise<unknown> = Promise.resolve();
  #lastStart = 0;

  constructor(private readonly spacingMs: number) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#chain.then(async () => {
      const wait = this.spacingMs - (Date.now() - this.#lastStart);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.#lastStart = Date.now();
      return task();
    });

    // Keep the chain alive even when a task rejects.
    this.#chain = result.catch(() => undefined);
    return result;
  }
}

class TtlCache<T> {
  readonly #entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 500,
  ) {}

  get(key: string): T | null {
    const entry = this.#entries.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.#entries.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.#entries.size >= this.maxEntries) {
      const oldest = this.#entries.keys().next();
      if (!oldest.done) this.#entries.delete(oldest.value);
    }
    this.#entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

async function fetchJson(url: string, headers: Record<string, string>, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const num = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

export class GeoProviders {
  // Nominatim's usage policy is one request per second, absolute.
  readonly #searchQueue = new PoliteQueue(1100);
  readonly #routeQueue = new PoliteQueue(250);
  readonly #searchCache = new TtlCache<PlaceResult[]>(15 * 60_000);
  readonly #routeCache = new TtlCache<RouteResult>(60_000, 2000);

  constructor(private readonly config: Config) {}

  get #userAgent(): string {
    return `CompanionMaps/0.1 (${this.config.geoContact})`;
  }

  async search(query: string, near?: LatLng): Promise<PlaceResult[]> {
    const base = this.config.nominatimUrl;
    const trimmed = query.trim();
    if (!base || trimmed.length < 2) return [];

    const cacheKey = `${trimmed.toLowerCase()}|${near ? `${near.lat.toFixed(1)},${near.lng.toFixed(1)}` : ""}`;
    const cached = this.#searchCache.get(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams({
      q: trimmed,
      format: "jsonv2",
      limit: "6",
      addressdetails: "0",
    });

    // Bias results towards where the convoy actually is, without excluding
    // everything else — a destination is often several countries away.
    if (near) {
      const span = 2;
      params.set(
        "viewbox",
        [near.lng - span, near.lat + span, near.lng + span, near.lat - span].join(","),
      );
    }

    const results = await this.#searchQueue.run(async () => {
      const payload = await fetchJson(
        `${base}/search?${params.toString()}`,
        { "User-Agent": this.#userAgent, Accept: "application/json" },
        8000,
      );

      if (!Array.isArray(payload)) return [];

      return payload.flatMap((entry): PlaceResult[] => {
        if (!isRecord(entry)) return [];
        const lat = num(entry["lat"]);
        const lng = num(entry["lon"]);
        const label = typeof entry["display_name"] === "string" ? entry["display_name"] : null;
        if (lat == null || lng == null || !label) return [];
        return [{ label, lat, lng, kind: String(entry["type"] ?? "place") }];
      });
    });

    this.#searchCache.set(cacheKey, results);
    return results;
  }

  async reverse(point: LatLng): Promise<PlaceResult | null> {
    const base = this.config.nominatimUrl;
    if (!base) return null;

    const cacheKey = `rev|${point.lat.toFixed(4)},${point.lng.toFixed(4)}`;
    const cached = this.#searchCache.get(cacheKey);
    if (cached) return cached[0] ?? null;

    const params = new URLSearchParams({
      lat: String(point.lat),
      lon: String(point.lng),
      format: "jsonv2",
      zoom: "16",
    });

    const result = await this.#searchQueue.run(async () => {
      const payload = await fetchJson(
        `${base}/reverse?${params.toString()}`,
        { "User-Agent": this.#userAgent, Accept: "application/json" },
        8000,
      );

      if (!isRecord(payload)) return null;
      const label = typeof payload["display_name"] === "string" ? payload["display_name"] : null;
      if (!label) return null;

      return {
        label,
        lat: point.lat,
        lng: point.lng,
        kind: String(payload["type"] ?? "place"),
      } satisfies PlaceResult;
    });

    this.#searchCache.set(cacheKey, result ? [result] : []);
    return result;
  }

  /**
   * Driving route between two points.
   *
   * Cached on a ~100 m grid: a convoy of six refreshing every minute would
   * otherwise hammer a shared demo server, and 100 m of staleness is far
   * inside the error of the ETA it feeds.
   */
  async route(from: LatLng, to: LatLng): Promise<RouteResult | null> {
    const base = this.config.osrmUrl;
    if (!base) return null;

    const cacheKey = [from.lat, from.lng, to.lat, to.lng]
      .map((value) => value.toFixed(3))
      .join(",");
    const cached = this.#routeCache.get(cacheKey);
    if (cached) return cached;

    const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const params = new URLSearchParams({ overview: "full", geometries: "polyline", alternatives: "false", steps: "false" });

    const result = await this.#routeQueue.run(async () => {
      const payload = await fetchJson(
        `${base}/route/v1/driving/${coords}?${params.toString()}`,
        { "User-Agent": this.#userAgent, Accept: "application/json" },
        10_000,
      );

      if (!isRecord(payload) || payload["code"] !== "Ok") return null;

      const routes = payload["routes"];
      if (!Array.isArray(routes) || routes.length === 0) return null;

      const route = routes[0];
      if (!isRecord(route)) return null;

      const distanceM = num(route["distance"]);
      const durationS = num(route["duration"]);
      if (distanceM == null || durationS == null) return null;

      return {
        distanceM,
        durationS,
        computedAt: Date.now(),
        geometry: typeof route["geometry"] === "string" ? route["geometry"] : null,
      } satisfies RouteResult;
    });

    if (result) this.#routeCache.set(cacheKey, result);
    return result;
  }
}
