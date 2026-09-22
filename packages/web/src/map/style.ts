import type { StyleSpecification } from "maplibre-gl";

/**
 * Basemaps.
 *
 * The default is OpenStreetMap raster tiles: free, key-less, and detailed
 * enough to navigate by, which is what makes this repo runnable the moment it
 * is cloned. It is NOT a production choice — the OSMF tile servers are a
 * donated resource whose usage policy rules out app traffic at any scale, and
 * they do block clients they do not like. Point VITE_MAP_STYLE at your own
 * tiles, or a Protomaps/MapTiler/Stadia style, before shipping.
 *
 * @see https://operations.osmfoundation.org/policies/tiles/
 */

export const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export const OSM_RASTER_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: [OSM_TILE_URL],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#0b1220" } },
    {
      id: "osm",
      type: "raster",
      source: "osm",
      paint: {
        // Knock the basemap back so convoy markers and trails read as the
        // foreground rather than competing with road labels.
        "raster-saturation": -0.35,
        "raster-brightness-min": 0.05,
        "raster-contrast": 0.05,
      },
    },
  ],
};

/**
 * Last resort when the tile server cannot be reached.
 *
 * MapLibre's demo tiles are coastlines and borders and very little else, so
 * this is not a map you could navigate by. It exists so that a blocked or
 * offline tile server leaves you with a usable convoy — relative positions,
 * trails, distances — instead of a featureless void with no explanation.
 */
export const FALLBACK_STYLE_URL = "https://demotiles.maplibre.org/style.json";

export type BasemapKind = "default" | "fallback";

const configured = (import.meta.env["VITE_MAP_STYLE"] as string | undefined)?.trim();

/** What the default basemap actually is, for error messages. */
export const defaultStyleDescription = configured
  ? configured
  : "OpenStreetMap tiles (tile.openstreetmap.org)";

export function resolveMapStyle(kind: BasemapKind): string | StyleSpecification {
  if (kind === "fallback") return FALLBACK_STYLE_URL;
  return configured ? configured : OSM_RASTER_STYLE;
}
