import type { StyleSpecification } from "maplibre-gl";

/**
 * Default basemap: OpenStreetMap raster tiles.
 *
 * Free and key-less, which is what makes this repo runnable the moment it is
 * cloned. It is NOT a production choice: the OSMF tile servers are a donated
 * resource with a usage policy that rules out app traffic at any scale. Before
 * shipping, point VITE_MAP_STYLE at your own tile server, a Protomaps/
 * MapTiler/Stadia style, or a commercial provider — nothing else in the app
 * changes, because the basemap is only ever referenced from here.
 *
 * @see https://operations.osmfoundation.org/policies/tiles/
 */
export const OSM_RASTER_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
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
        // Knock the basemap back so the convoy markers and trails read as the
        // foreground rather than competing with road labels.
        "raster-saturation": -0.35,
        "raster-brightness-min": 0.05,
        "raster-contrast": 0.05,
      },
    },
  ],
};

const configured = import.meta.env["VITE_MAP_STYLE"] as string | undefined;

export const mapStyle: string | StyleSpecification = configured?.trim()
  ? configured.trim()
  : OSM_RASTER_STYLE;
