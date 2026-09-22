/**
 * Convoy simulator.
 *
 * Testing this product properly needs several cars, several phones and a
 * motorway. This stands in for all three: it drives N fake members along a
 * real OSRM route at different speeds, with a rest stop and a signal blackout
 * thrown in, so the map, the ETAs, the spread warning and the car projection
 * can all be exercised from one terminal.
 *
 *   npm run sim -- --drivers 4 --speed 8
 *   npm run sim -- --code TRK-4H2        # join a convoy you already opened
 */

import {
  type LatLng,
  bearingDeg,
  decodePolyline,
  formatDistance,
  haversineMeters,
} from "@companionmaps/shared";
import { WebSocket } from "ws";

interface Options {
  server: string;
  drivers: number;
  code: string | null;
  from: LatLng;
  to: LatLng;
  destinationLabel: string;
  /** Wall-clock speed multiplier: 8 turns a 40-minute drive into 5 minutes. */
  speed: number;
}

const DEFAULTS: Options = {
  server: "http://localhost:8787",
  drivers: 4,
  code: null,
  from: { lat: 52.5208, lng: 13.4095 }, // Berlin, Alexanderplatz
  to: { lat: 52.4013, lng: 13.0396 }, // Potsdam, Sanssouci
  destinationLabel: "Sanssouci, Potsdam",
  speed: 8,
};

const NAMES = ["Mira", "Tom", "Jules", "Sam", "Ada", "Ben", "Kit", "Noor"];
const VEHICLES = ["blue Golf", "white van", "red Panda", "grey estate", "black SUV", "green camper", "silver hatch", "yellow Fiat"];

function parseArgs(argv: string[]): Options {
  const options: Options = { ...DEFAULTS };

  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!flag?.startsWith("--") || value == null) continue;

    switch (flag) {
      case "--server":
        options.server = value.replace(/\/+$/, "");
        break;
      case "--drivers":
        options.drivers = Math.max(1, Math.min(NAMES.length, Number.parseInt(value, 10) || 4));
        break;
      case "--code":
        options.code = value.toUpperCase();
        break;
      case "--speed":
        options.speed = Math.max(1, Number.parseFloat(value) || 8);
        break;
      case "--from":
      case "--to": {
        const [lat, lng] = value.split(",").map(Number);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          const point = { lat: lat!, lng: lng! };
          if (flag === "--from") options.from = point;
          else options.to = point;
        }
        break;
      }
    }
  }

  return options;
}

/** Path plus cumulative distance, so a driver can be placed at "x metres in". */
interface Track {
  points: LatLng[];
  cumulative: number[];
  totalM: number;
}

function buildTrack(points: LatLng[]): Track {
  const cumulative = [0];
  for (let i = 1; i < points.length; i += 1) {
    cumulative.push(cumulative[i - 1]! + haversineMeters(points[i - 1]!, points[i]!));
  }
  return { points, cumulative, totalM: cumulative[cumulative.length - 1] ?? 0 };
}

function pointAt(track: Track, distanceM: number): { point: LatLng; headingDeg: number } {
  const clamped = Math.max(0, Math.min(track.totalM, distanceM));

  let index = 1;
  while (index < track.cumulative.length - 1 && track.cumulative[index]! < clamped) index += 1;

  const before = track.points[index - 1]!;
  const after = track.points[index]!;
  const segmentStart = track.cumulative[index - 1]!;
  const segmentLength = track.cumulative[index]! - segmentStart;
  const t = segmentLength > 0 ? (clamped - segmentStart) / segmentLength : 0;

  return {
    point: {
      lat: before.lat + (after.lat - before.lat) * t,
      lng: before.lng + (after.lng - before.lng) * t,
    },
    headingDeg: bearingDeg(before, after),
  };
}

/** Straight-line stand-in for when the routing provider is unreachable. */
function straightLine(from: LatLng, to: LatLng, steps = 200): LatLng[] {
  return Array.from({ length: steps + 1 }, (_, i) => ({
    lat: from.lat + ((to.lat - from.lat) * i) / steps,
    lng: from.lng + ((to.lng - from.lng) * i) / steps,
  }));
}

async function loadTrack(options: Options): Promise<Track> {
  const url = new URL("/api/route", options.server);
  url.searchParams.set("from", `${options.from.lat},${options.from.lng}`);
  url.searchParams.set("to", `${options.to.lat},${options.to.lng}`);

  try {
    const response = await fetch(url);
    const payload = (await response.json()) as { route?: { geometry?: string | null } | null };
    const geometry = payload.route?.geometry;

    if (geometry) {
      const points = decodePolyline(geometry);
      if (points.length > 1) {
        console.log(`route: ${points.length} points, ${formatDistance(buildTrack(points).totalM)}`);
        return buildTrack(points);
      }
    }
  } catch {
    // fall through
  }

  console.log("route: routing unavailable, using a straight line");
  return buildTrack(straightLine(options.from, options.to));
}

interface Driver {
  name: string;
  vehicle: string;
  socket: WebSocket;
  /** Metres travelled along the track. */
  distanceM: number;
  /** Cruising speed in m/s before any personality applies. */
  cruiseMps: number;
  /** Simulated seconds remaining of a rest stop. */
  restingForS: number;
  /** Simulated seconds remaining of a signal blackout. */
  blackoutForS: number;
  restAtM: number | null;
  blackoutAtM: number | null;
  arrived: boolean;
  isFirst: boolean;
}

function connect(options: Options, code: string, index: number, track: Track): Promise<Driver> {
  const wsUrl = `${options.server.replace(/^http/, "ws")}/ws`;
  const socket = new WebSocket(wsUrl);

  const driver: Driver = {
    name: NAMES[index]!,
    vehicle: VEHICLES[index]!,
    socket,
    // Stagger the start so the convoy is strung out from the off.
    distanceM: -index * 350,
    cruiseMps: 18 + index * 2.5,
    restingForS: 0,
    blackoutForS: 0,
    // One driver stops for coffee, another loses signal in a dead zone.
    restAtM: index === 1 ? track.totalM * 0.45 : null,
    blackoutAtM: index === 2 ? track.totalM * 0.6 : null,
    arrived: false,
    isFirst: index === 0,
  };

  return new Promise((resolve, reject) => {
    socket.once("error", reject);

    socket.on("open", () => {
      socket.send(JSON.stringify({ t: "hello", code, name: driver.name, vehicle: driver.vehicle }));
    });

    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as { t: string; message?: string };

      if (message.t === "welcome") {
        if (driver.isFirst) {
          socket.send(
            JSON.stringify({
              t: "set-destination",
              label: options.destinationLabel,
              lat: options.to.lat,
              lng: options.to.lng,
            }),
          );
        }
        resolve(driver);
        return;
      }

      if (message.t === "error") {
        console.error(`[${driver.name}] server error: ${message.message}`);
      }
    });
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  let code = options.code;
  if (!code) {
    const response = await fetch(new URL("/api/convoys", options.server), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Simulated road trip" }),
    });

    if (!response.ok) {
      console.error(`could not create a convoy: ${response.status}. Is the server running?`);
      process.exit(1);
    }

    code = ((await response.json()) as { code: string }).code;
  }

  const track = await loadTrack(options);
  const drivers: Driver[] = [];

  for (let i = 0; i < options.drivers; i += 1) {
    drivers.push(await connect(options, code, i, track));
  }

  console.log("");
  console.log(`  convoy code   ${code}`);
  console.log(`  watch it at   http://localhost:5173/?code=${code}`);
  console.log(`  drivers       ${drivers.map((d) => d.name).join(", ")}`);
  console.log(`  speed         ${options.speed}x real time`);
  console.log("");

  const TICK_MS = 1000;

  const tick = setInterval(() => {
    const simulatedSeconds = (TICK_MS / 1000) * options.speed;

    for (const driver of drivers) {
      if (driver.restingForS > 0) {
        driver.restingForS -= simulatedSeconds;
      } else {
        // A little jitter keeps the gaps between cars from being perfectly
        // static, which is what makes a convoy stretch and close up for real.
        const jitter = 0.85 + Math.random() * 0.3;
        driver.distanceM += driver.cruiseMps * jitter * simulatedSeconds;
      }

      if (driver.restAtM != null && driver.distanceM >= driver.restAtM) {
        driver.restAtM = null;
        driver.restingForS = 240;
        driver.socket.send(JSON.stringify({ t: "ping", kind: "rest-stop" }));
        console.log(`[${driver.name}] pulling over for a break`);
      }

      if (driver.blackoutAtM != null && driver.distanceM >= driver.blackoutAtM) {
        driver.blackoutAtM = null;
        driver.blackoutForS = 150;
        console.log(`[${driver.name}] lost signal`);
      }

      if (driver.blackoutForS > 0) {
        driver.blackoutForS -= simulatedSeconds;
        if (driver.blackoutForS <= 0) console.log(`[${driver.name}] back online`);
        continue;
      }

      if (driver.distanceM < 0) continue;

      const { point, headingDeg } = pointAt(track, driver.distanceM);
      const isResting = driver.restingForS > 0;

      driver.socket.send(
        JSON.stringify({
          t: "location",
          lat: point.lat,
          lng: point.lng,
          headingDeg,
          speedMps: isResting ? 0 : driver.cruiseMps,
          accuracyM: 6 + Math.random() * 8,
          batteryPct: Math.max(5, 95 - Math.floor(driver.distanceM / 1500)),
        }),
      );

      if (!driver.arrived && driver.distanceM >= track.totalM) {
        driver.arrived = true;
        console.log(`[${driver.name}] arrived`);
      }
    }

    if (drivers.every((driver) => driver.arrived)) {
      console.log("\nwhole convoy has arrived. Ctrl-C to stop.");
      clearInterval(tick);
    }
  }, TICK_MS);

  const stop = (): void => {
    clearInterval(tick);
    for (const driver of drivers) driver.socket.close();
    process.exit(0);
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
