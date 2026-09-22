import type { BasemapKind } from "./map/style.js";

const BASEMAP_KEY = "companionmaps.basemap";

/**
 * Which basemap to use, remembered across reloads.
 *
 * Someone who had to fall back once is behind whatever blocked the tiles the
 * first time, so making them choose again on every reload is just rudeness.
 */
export function loadBasemap(): BasemapKind {
  try {
    return localStorage.getItem(BASEMAP_KEY) === "fallback" ? "fallback" : "default";
  } catch {
    return "default";
  }
}

export function saveBasemap(kind: BasemapKind): void {
  try {
    localStorage.setItem(BASEMAP_KEY, kind);
  } catch {
    // Private browsing or blocked storage; the choice just will not persist.
  }
}
