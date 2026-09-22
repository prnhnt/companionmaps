import { buildCarView } from "@companionmaps/shared";
import { Router, type Request, type Response } from "express";

import type { Config } from "./config.js";
import type { GeoProviders } from "./providers.js";
import type { ConvoyStore } from "./store.js";

const asNumber = (value: unknown, min: number, max: number): number | null => {
  const parsed = typeof value === "string" ? Number.parseFloat(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
};

/** "52.52,13.405" -> a point, or null. */
function parsePoint(value: unknown): { lat: number; lng: number } | null {
  if (typeof value !== "string") return null;
  const [rawLat, rawLng] = value.split(",");
  const lat = asNumber(rawLat, -90, 90);
  const lng = asNumber(rawLng, -180, 180);
  return lat == null || lng == null ? null : { lat, lng };
}

export function createApi(
  store: ConvoyStore,
  config: Config,
  providers: GeoProviders,
): Router {
  const api = Router();

  api.get("/health", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      convoys: store.size,
      routing: config.osrmUrl != null,
      search: config.nominatimUrl != null,
      time: Date.now(),
    });
  });

  api.post("/convoys", (req: Request, res: Response) => {
    const name = typeof req.body?.name === "string" ? req.body.name : "Convoy";
    const convoy = store.create(name, Date.now());
    res.status(201).json({ id: convoy.id, code: convoy.code, name: convoy.name });
  });

  /**
   * Pre-join lookup for the "join a convoy" screen.
   *
   * Deliberately thin: anyone holding a code can call this, and a code is
   * shared over group chat. Live positions require an actual join.
   */
  api.get("/convoys/:code", (req: Request, res: Response) => {
    const convoy = store.getByCode(req.params.code ?? "");
    if (!convoy) {
      res.status(404).json({ error: "no-such-convoy" });
      return;
    }

    res.json({
      code: convoy.code,
      name: convoy.name,
      memberCount: convoy.members.length,
      memberNames: convoy.members.map((member) => member.name),
      destinationLabel: convoy.destination?.label ?? null,
      createdAt: convoy.createdAt,
    });
  });

  /**
   * The driving-safe projection, for a CarPlay or Android Auto app that would
   * rather poll HTTP than hold a socket open. Same builder the web client
   * uses, so the two can never disagree.
   */
  api.get("/convoys/:code/car-view", (req: Request, res: Response) => {
    const convoy = store.getByCode(req.params.code ?? "");
    if (!convoy) {
      res.status(404).json({ error: "no-such-convoy" });
      return;
    }

    const memberId = typeof req.query["memberId"] === "string" ? req.query["memberId"] : "";
    if (!convoy.members.some((member) => member.id === memberId)) {
      res.status(400).json({ error: "unknown-member" });
      return;
    }

    res.json(buildCarView(convoy, memberId, Date.now()));
  });

  api.get("/search", async (req: Request, res: Response) => {
    const query = typeof req.query["q"] === "string" ? req.query["q"] : "";
    if (query.trim().length < 2) {
      res.json({ results: [] });
      return;
    }

    const lat = asNumber(req.query["lat"], -90, 90);
    const lng = asNumber(req.query["lng"], -180, 180);
    const near = lat != null && lng != null ? { lat, lng } : undefined;

    try {
      res.json({ results: await providers.search(query, near) });
    } catch (error) {
      console.error("[api] search failed", error);
      res.status(502).json({ error: "search-unavailable", results: [] });
    }
  });

  api.get("/reverse", async (req: Request, res: Response) => {
    const lat = asNumber(req.query["lat"], -90, 90);
    const lng = asNumber(req.query["lng"], -180, 180);
    if (lat == null || lng == null) {
      res.status(400).json({ error: "bad-coordinates" });
      return;
    }

    try {
      res.json({ result: await providers.reverse({ lat, lng }) });
    } catch (error) {
      console.error("[api] reverse failed", error);
      res.status(502).json({ error: "search-unavailable", result: null });
    }
  });

  api.get("/route", async (req: Request, res: Response) => {
    const from = parsePoint(req.query["from"]);
    const to = parsePoint(req.query["to"]);
    if (!from || !to) {
      res.status(400).json({ error: "bad-coordinates" });
      return;
    }

    try {
      res.json({ route: await providers.route(from, to) });
    } catch (error) {
      console.error("[api] route failed", error);
      res.status(502).json({ error: "routing-unavailable", route: null });
    }
  });

  return api;
}
