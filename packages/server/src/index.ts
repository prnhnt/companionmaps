import { createServer } from "node:http";

import express from "express";

import { loadConfig } from "./config.js";
import { ConvoyHub } from "./hub.js";
import { GeoProviders } from "./providers.js";
import { createApi } from "./routes.js";
import { ConvoyStore } from "./store.js";

export function createApp(config = loadConfig()) {
  const store = new ConvoyStore(config);
  const providers = new GeoProviders(config);
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));

  const allowAll = config.corsOrigins.includes("*");
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (allowAll) {
      res.setHeader("Access-Control-Allow-Origin", "*");
    } else if (origin && config.corsOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use("/api", createApi(store, config, providers));

  const server = createServer(app);
  const hub = new ConvoyHub(store, config, providers);
  hub.attach(server, "/ws");

  return { app, server, hub, store, config, providers };
}

const isEntrypoint = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");

if (isEntrypoint) {
  const { server, hub, config } = createApp();

  server.listen(config.port, () => {
    console.log(`companionmaps server on http://localhost:${config.port}`);
    console.log(`  websocket   ws://localhost:${config.port}/ws`);
    console.log(`  routing     ${config.osrmUrl ?? "disabled (straight-line ETAs)"}`);
    console.log(`  search      ${config.nominatimUrl ?? "disabled"}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n${signal} received, closing`);
    await hub.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}
