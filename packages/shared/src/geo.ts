/** Spherical-earth geometry. Accurate to ~0.3% at convoy distances, which is
 *  well inside the error of a consumer GPS fix. */

export const EARTH_RADIUS_M = 6_371_008.8;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Great-circle distance in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `a` to `b`, in degrees clockwise from true north. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point reached by travelling `distanceM` from `origin` along `bearing`. */
export function destinationPoint(
  origin: LatLng,
  bearing: number,
  distanceM: number,
): LatLng {
  const angular = distanceM / EARTH_RADIUS_M;
  const brng = toRad(bearing);
  const lat1 = toRad(origin.lat);
  const lng1 = toRad(origin.lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
      Math.cos(lat1) * Math.sin(angular) * Math.cos(brng),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    lat: toDeg(lat2),
    lng: ((toDeg(lng2) + 540) % 360) - 180,
  };
}

/** Smallest signed difference between two bearings, in (-180, 180].
 *  An exact reversal returns +180, not -180, so a U-turn never reads as a
 *  left turn. */
export function bearingDelta(from: number, to: number): number {
  const delta = (((to - from) % 360) + 360) % 360;
  return delta > 180 ? delta - 360 : delta;
}

/** Axis-aligned bounds. Does not handle the antimeridian; a convoy that
 *  straddles ±180° is out of scope. */
export function boundsOf(points: readonly LatLng[]): Bounds | null {
  if (points.length === 0) return null;

  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;

  for (const p of points) {
    if (p.lat > north) north = p.lat;
    if (p.lat < south) south = p.lat;
    if (p.lng > east) east = p.lng;
    if (p.lng < west) west = p.lng;
  }

  return { north, south, east, west };
}

/** Grow bounds by a fraction of their own span, so fitted markers are not
 *  flush against the viewport edge. */
export function padBounds(bounds: Bounds, fraction = 0.15): Bounds {
  const latSpan = Math.max(bounds.north - bounds.south, 0.002);
  const lngSpan = Math.max(bounds.east - bounds.west, 0.002);

  return {
    north: Math.min(90, bounds.north + latSpan * fraction),
    south: Math.max(-90, bounds.south - latSpan * fraction),
    east: Math.min(180, bounds.east + lngSpan * fraction),
    west: Math.max(-180, bounds.west - lngSpan * fraction),
  };
}

const COMPASS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
] as const;

export function compassPoint(bearing: number): string {
  const index = Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS[index] ?? "N";
}

export function formatDistance(meters: number | null | undefined): string {
  if (meters == null || !Number.isFinite(meters)) return "--";
  if (meters < 950) return `${Math.round(meters / 10) * 10} m`;
  if (meters < 10_000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000)} km`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "--";
  if (seconds < 60) return "<1 min";

  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/** Signed gap, e.g. "+4 min" for a companion arriving later than you. */
export function formatSignedDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "--";
  const rounded = Math.round(seconds / 60);
  if (rounded === 0) return "same time";
  const sign = rounded > 0 ? "+" : "-";
  return `${sign}${formatDuration(Math.abs(rounded) * 60)}`;
}

export function formatSpeed(metersPerSecond: number | null | undefined): string {
  if (metersPerSecond == null || !Number.isFinite(metersPerSecond)) return "--";
  return `${Math.round(metersPerSecond * 3.6)} km/h`;
}

export function formatAge(ageMs: number): string {
  // A member who has never sent a fix has an infinite age; "Infinity h ago"
  // is worse than admitting we do not know.
  if (!Number.isFinite(ageMs)) return "--";
  if (ageMs < 10_000) return "live";
  if (ageMs < 60_000) return `${Math.round(ageMs / 1000)}s ago`;
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)} min ago`;
  return `${Math.round(ageMs / 3_600_000)} h ago`;
}

export function formatClock(timestamp: number, locale?: string): string {
  return new Date(timestamp).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
