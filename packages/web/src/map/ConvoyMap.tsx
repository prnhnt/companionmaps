import { useEffect, useRef, useState } from "react";

import {
  type Destination,
  type LatLng,
  type Member,
  boundsOf,
  decodePolyline,
  padBounds,
} from "@companionmaps/shared";
import maplibregl, {
  type GeoJSONSource,
  type LngLatBoundsLike,
  type Map as MapLibreMap,
  type Marker,
} from "maplibre-gl";

import { createMotion, retarget, stepMotion, type MarkerMotion } from "./markers.js";
import { resolveMapStyle, type BasemapKind } from "./style.js";

export type CameraMode = "fit-all" | "follow" | "free";

export interface ConvoyMapProps {
  members: Member[];
  youId: string | null;
  destination: Destination | null;
  selectedId: string | null;
  onSelect: (memberId: string | null) => void;
  camera: CameraMode;
  /** Member to keep centred when camera is "follow". */
  followId?: string | null;
  /** Encoded polyline of the route to draw, if any. */
  routeGeometry?: string | null;
  /** Bumping this refits the camera, even if nothing else changed. */
  fitNonce?: number;
  compact?: boolean;
  className?: string;
  /** Which basemap to draw. Changing it rebuilds the map. */
  basemap?: BasemapKind;
  /** Reports whether basemap tiles are arriving. */
  onTileStatus?: (status: TileStatus) => void;
  /** Reports the attribution the loaded style requires, as HTML. */
  onAttribution?: (html: string) => void;
}

/**
 * Whether the basemap is actually being drawn.
 *
 * Worth reporting because the failure mode is silent: MapLibre renders the
 * background colour and nothing else, which looks exactly like a map of the
 * open sea at night.
 */
export type TileStatus = "loading" | "ok" | "failed";

/** Failures before we call it: a couple of dropped tiles is not an outage. */
const TILE_FAILURE_THRESHOLD = 4;

/**
 * Sources this component adds itself.
 *
 * MapLibre tiles GeoJSON sources internally, so these emit exactly the same
 * tile-loaded events as the basemap. Counting them would mean the map always
 * reports healthy tiles the moment a convoy trail renders — which is
 * precisely when the basemap has most obviously failed.
 */
const OWN_SOURCE_IDS = new Set(["trails", "route"]);

/**
 * How long to wait for the style to load before calling it a failure.
 *
 * Tile errors only surface once a style has loaded and asked for tiles. If
 * the style document itself cannot be fetched — offline, blocked, a bad
 * VITE_MAP_STYLE — no source errors ever arrive and the map sits there
 * blank and silent. This is the catch-all for that.
 */
const STYLE_LOAD_TIMEOUT_MS = 12_000;

/** MapLibre's event types do not all declare sourceId, but they carry it. */
const sourceIdOf = (event: unknown): string | undefined => {
  const candidate = (event as { sourceId?: unknown }).sourceId;
  return typeof candidate === "string" ? candidate : undefined;
};

const FOLLOW_ZOOM = 14.5;

function markerElement(member: Member, isYou: boolean): { root: HTMLDivElement; arrow: HTMLDivElement } {
  const root = document.createElement("div");
  root.className = "car-marker";
  root.setAttribute("role", "button");
  root.setAttribute("tabindex", "0");

  const arrow = document.createElement("div");
  arrow.className = "car-marker__arrow";
  arrow.style.setProperty("--car-color", member.color);
  arrow.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 L20 21 L12 16.5 L4 21 Z" /></svg>';

  const label = document.createElement("div");
  label.className = "car-marker__label";
  label.style.setProperty("--car-color", member.color);
  label.textContent = isYou ? `${member.name} (you)` : member.name;

  root.append(arrow, label);
  return { root, arrow };
}

interface TrackedMarker {
  marker: Marker;
  motion: MarkerMotion;
  root: HTMLDivElement;
  arrow: HTMLDivElement;
  label: HTMLDivElement;
  color: string;
}

export function ConvoyMap({
  members,
  youId,
  destination,
  selectedId,
  onSelect,
  camera,
  followId = null,
  routeGeometry = null,
  fitNonce = 0,
  compact = false,
  className,
  basemap = "default",
  onTileStatus,
  onAttribution,
}: ConvoyMapProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  // Nothing may touch the map until its style has loaded: markers added
  // beforehand blow up inside MapLibre, which is exactly what happens when you
  // join a convoy that is already moving and every member has a position on
  // the very first render.
  const [ready, setReady] = useState(false);
  const markersRef = useRef(new Map<string, TrackedMarker>());
  const destinationMarkerRef = useRef<Marker | null>(null);
  const frameRef = useRef<number | null>(null);

  // Handlers and data the imperative map code reads but must not re-subscribe
  // to: re-creating the map on every position update would be catastrophic.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onTileStatusRef = useRef(onTileStatus);
  onTileStatusRef.current = onTileStatus;
  const onAttributionRef = useRef(onAttribution);
  onAttributionRef.current = onAttribution;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      style: resolveMapStyle(basemap),
      center: [13.405, 52.52],
      zoom: 9,
      // Rendered by the app instead: the control's own corner is underneath
      // the floating rail, and OpenStreetMap attribution has to stay visible.
      attributionControl: false,
      // Pitch and rotation are a liability on a glanceable convoy map.
      pitchWithRotate: false,
      dragRotate: false,
    });

    mapRef.current = map;

    if (!compact) {
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    }

    // Tile delivery, watched rather than assumed.
    const isOwnSource = (sourceId: string | undefined): boolean =>
      sourceId != null && OWN_SOURCE_IDS.has(sourceId);

    let tilesLoaded = 0;
    let tilesFailed = 0;
    let styleFailed = false;
    let reported: TileStatus | null = null;

    const reportTiles = (): void => {
      const status: TileStatus =
        tilesLoaded > 0
          ? "ok"
          : styleFailed || tilesFailed >= TILE_FAILURE_THRESHOLD
            ? "failed"
            : "loading";
      if (status === reported) return;
      reported = status;
      onTileStatusRef.current?.(status);
    };

    map.on("data", (event) => {
      if (event.dataType !== "source") return;
      if (!("tile" in event) || !event.tile) return;
      if (isOwnSource(sourceIdOf(event))) return;
      tilesLoaded += 1;
      reportTiles();
    });

    map.on("error", (event) => {
      // Errors carrying a sourceId are tile or source failures; everything
      // else is a style or runtime problem and belongs in the console.
      const sourceId = sourceIdOf(event);
      if (!sourceId) {
        console.error("[map]", event.error);
        return;
      }
      if (isOwnSource(sourceId)) return;
      tilesFailed += 1;
      reportTiles();
    });

    const styleWatchdog = setTimeout(() => {
      if (map.isStyleLoaded()) return;
      styleFailed = true;
      reportTiles();
    }, STYLE_LOAD_TIMEOUT_MS);

    map.on("load", () => {
      clearTimeout(styleWatchdog);
      setReady(true);

      // Attribution is a licence condition, not decoration, so it is read
      // back from whatever style actually loaded rather than hardcoded.
      const sources = map.getStyle()?.sources ?? {};
      const notices = [
        ...new Set(
          Object.entries(sources)
            .filter(([id]) => !OWN_SOURCE_IDS.has(id))
            .map(([, source]) => (source as { attribution?: string }).attribution)
            .filter((value): value is string => typeof value === "string" && value.length > 0),
        ),
      ];
      if (notices.length > 0) onAttributionRef.current?.(notices.join(" · "));

      map.addSource("trails", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "trails",
        type: "line",
        source: "trails",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 3,
          "line-opacity": 0.55,
        },
      });

      map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer(
        {
          id: "route",
          type: "line",
          source: "route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#38bdf8", "line-width": 5, "line-opacity": 0.35 },
        },
        "trails",
      );
    });

    // Clicking empty map is how you get out of the side-by-side view.
    map.on("click", (event) => {
      if ((event.originalEvent.target as HTMLElement | null)?.closest(".car-marker")) return;
      onSelectRef.current(null);
    });

    return () => {
      clearTimeout(styleWatchdog);
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      markersRef.current.forEach((tracked) => tracked.marker.remove());
      markersRef.current.clear();
      destinationMarkerRef.current?.remove();
      destinationMarkerRef.current = null;
      setReady(false);
      map.remove();
      mapRef.current = null;
    };
    // `basemap` is a dependency on purpose: switching it rebuilds the map,
    // which is heavier than setStyle but avoids having to re-add every source
    // and layer by hand. It is a rare, user-initiated recovery action.
  }, [compact, basemap]);

  /* ---------------------------------------------------------------- */
  /* markers                                                           */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const tracked = markersRef.current;
    const seen = new Set<string>();

    for (const member of members) {
      const position = member.position;
      if (!position) continue;
      seen.add(member.id);

      let entry = tracked.get(member.id);

      if (!entry) {
        const { root, arrow } = markerElement(member, member.id === youId);
        const label = root.querySelector<HTMLDivElement>(".car-marker__label")!;

        root.addEventListener("click", (event) => {
          event.stopPropagation();
          onSelectRef.current(member.id);
        });
        root.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onSelectRef.current(member.id);
        });

        const marker = new maplibregl.Marker({ element: root, anchor: "center" })
          .setLngLat([position.lng, position.lat])
          .addTo(map);

        entry = {
          marker,
          motion: createMotion(position, position.headingDeg),
          root,
          arrow,
          label,
          color: member.color,
        };
        tracked.set(member.id, entry);
      }

      retarget(entry.motion, position, position.headingDeg);

      entry.label.textContent = member.id === youId ? `${member.name} (you)` : member.name;
      entry.root.classList.toggle("car-marker--selected", member.id === selectedId);
      entry.root.classList.toggle("car-marker--you", member.id === youId);
      entry.root.classList.toggle(
        "car-marker--lost",
        member.status === "stale" || member.status === "offline",
      );
      entry.root.classList.toggle("car-marker--arrived", member.status === "arrived");
      entry.root.setAttribute("aria-label", `${member.name}, ${member.status}`);

      if (entry.color !== member.color) {
        entry.color = member.color;
        entry.arrow.style.setProperty("--car-color", member.color);
        entry.label.style.setProperty("--car-color", member.color);
      }
    }

    for (const [id, entry] of tracked) {
      if (seen.has(id)) continue;
      entry.marker.remove();
      tracked.delete(id);
    }
  }, [members, youId, selectedId, ready]);

  /** One animation loop drives every marker on this map. */
  useEffect(() => {
    const step = (): void => {
      for (const entry of markersRef.current.values()) {
        if (stepMotion(entry.motion)) {
          entry.marker.setLngLat([entry.motion.rendered.lng, entry.motion.rendered.lat]);
        }
        entry.arrow.style.transform = `rotate(${entry.motion.renderedHeading}deg)`;
      }
      frameRef.current = requestAnimationFrame(step);
    };

    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /* trails, route and destination                                     */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const source = map.getSource("trails") as GeoJSONSource | undefined;
    if (!source) return;

    source.setData({
      type: "FeatureCollection",
      features: members
        .filter((member) => member.trail.length > 1)
        .map((member) => ({
          type: "Feature" as const,
          properties: { color: member.color },
          geometry: {
            type: "LineString" as const,
            coordinates: member.trail.map((point) => [point.lng, point.lat]),
          },
        })),
    });
  }, [members, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const source = map.getSource("route") as GeoJSONSource | undefined;
    if (!source) return;

    const points: LatLng[] = routeGeometry ? decodePolyline(routeGeometry) : [];

    source.setData({
      type: "FeatureCollection",
      features:
        points.length > 1
          ? [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates: points.map((p) => [p.lng, p.lat]) },
              },
            ]
          : [],
    });
  }, [routeGeometry, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    if (!destination) {
      destinationMarkerRef.current?.remove();
      destinationMarkerRef.current = null;
      return;
    }

    if (!destinationMarkerRef.current) {
      const element = document.createElement("div");
      element.className = "destination-marker";
      element.innerHTML = '<span class="destination-marker__pin">◎</span>';
      // The position has to be set before the marker is added: MapLibre
      // projects it on the way in, and a marker with no position throws.
      destinationMarkerRef.current = new maplibregl.Marker({ element, anchor: "center" })
        .setLngLat([destination.lng, destination.lat])
        .addTo(map);
    }

    destinationMarkerRef.current.setLngLat([destination.lng, destination.lat]);
  }, [destination, ready]);

  /* ---------------------------------------------------------------- */
  /* camera                                                            */
  /* ---------------------------------------------------------------- */

  // Which cars exist, not where they are: refitting on every fix would yank
  // the map out from under anyone trying to look at it.
  const memberKey = members
    .filter((member) => member.position)
    .map((member) => member.id)
    .sort()
    .join(",");

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || camera !== "fit-all") return;

    const points: LatLng[] = members
      .map((member) => member.position)
      .filter((position): position is NonNullable<typeof position> => position != null);

    if (destination) points.push(destination);
    if (points.length === 0) return;

    if (points.length === 1) {
      map.easeTo({ center: [points[0]!.lng, points[0]!.lat], zoom: FOLLOW_ZOOM, duration: 700 });
      return;
    }

    const bounds = boundsOf(points);
    if (!bounds) return;

    const padded = padBounds(bounds, 0.2);
    map.fitBounds(
      [
        [padded.west, padded.south],
        [padded.east, padded.north],
      ] as LngLatBoundsLike,
      { padding: compact ? 40 : 80, duration: 700, maxZoom: 15 },
    );
    // `members` is intentionally not a dependency — see memberKey above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, memberKey, destination, fitNonce, compact, ready]);

  const followTarget = members.find((member) => member.id === followId)?.position ?? null;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || camera !== "follow" || !followTarget) return;

    map.easeTo({
      center: [followTarget.lng, followTarget.lat],
      zoom: Math.max(map.getZoom(), FOLLOW_ZOOM),
      duration: 900,
    });
  }, [camera, followTarget?.lat, followTarget?.lng, followTarget, ready]);

  // A pane that appears or resizes beside another one leaves MapLibre with a
  // stale canvas size until it is told otherwise.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => mapRef.current?.resize());
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return <div ref={containerRef} className={className ?? "map"} />;
}
