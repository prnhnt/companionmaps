import type { LatLng, RouteEstimate } from "@companionmaps/shared";

const API_BASE = (import.meta.env["VITE_API_URL"] as string | undefined) ?? "http://localhost:8787";

export const apiUrl = (path: string): string => new URL(path, API_BASE).toString();

export const socketUrl = (): string => `${API_BASE.replace(/^http/, "ws")}/ws`;

export interface PlaceResult {
  label: string;
  lat: number;
  lng: number;
  kind: string;
}

export interface ConvoySummary {
  code: string;
  name: string;
  memberCount: number;
  memberNames: string[];
  destinationLabel: string | null;
  createdAt: number;
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), init);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as T;
}

export function createConvoy(name: string): Promise<{ id: string; code: string; name: string }> {
  return getJson("/api/convoys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export async function lookupConvoy(code: string): Promise<ConvoySummary | null> {
  try {
    return await getJson<ConvoySummary>(`/api/convoys/${encodeURIComponent(code)}`);
  } catch {
    return null;
  }
}

export async function searchPlaces(query: string, near?: LatLng | null): Promise<PlaceResult[]> {
  const params = new URLSearchParams({ q: query });
  if (near) {
    params.set("lat", String(near.lat));
    params.set("lng", String(near.lng));
  }

  try {
    const { results } = await getJson<{ results: PlaceResult[] }>(`/api/search?${params}`);
    return results;
  } catch {
    return [];
  }
}

export async function fetchRoute(from: LatLng, to: LatLng): Promise<RouteEstimate | null> {
  const params = new URLSearchParams({
    from: `${from.lat},${from.lng}`,
    to: `${to.lat},${to.lng}`,
  });

  try {
    const { route } = await getJson<{ route: RouteEstimate | null }>(`/api/route?${params}`);
    return route;
  } catch {
    return null;
  }
}
