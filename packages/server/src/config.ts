const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export interface Config {
  port: number;
  corsOrigins: string[];
  /** How often batched position updates are flushed to each client. */
  broadcastIntervalMs: number;
  staleAfterMs: number;
  offlineAfterMs: number;
  trailLength: number;
  /** A convoy with nobody connected is deleted after this long. */
  convoyTtlMs: number;
  /** How often each member's route to the destination is recomputed. */
  routeRefreshMs: number;
  osrmUrl: string | null;
  nominatimUrl: string | null;
  geoContact: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const origins = (env["CORS_ORIGIN"] ?? "http://localhost:5173")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    port: int(env["PORT"], 8787),
    corsOrigins: origins,
    broadcastIntervalMs: int(env["BROADCAST_INTERVAL_MS"], 1000),
    staleAfterMs: int(env["STALE_AFTER_MS"], 45_000),
    offlineAfterMs: int(env["OFFLINE_AFTER_MS"], 300_000),
    trailLength: int(env["TRAIL_LENGTH"], 120),
    convoyTtlMs: int(env["CONVOY_TTL_MS"], 6 * 60 * 60 * 1000),
    routeRefreshMs: int(env["ROUTE_REFRESH_MS"], 60_000),
    osrmUrl: (env["OSRM_URL"] ?? "https://router.project-osrm.org").replace(/\/+$/, "") || null,
    nominatimUrl:
      (env["NOMINATIM_URL"] ?? "https://nominatim.openstreetmap.org").replace(/\/+$/, "") || null,
    geoContact: env["GEO_CONTACT"] ?? "companionmaps-dev",
  };
}
