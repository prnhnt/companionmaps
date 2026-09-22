import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type ClientMessage,
  type Convoy,
  type PingKind,
  type ServerMessage,
  applyServerMessage,
} from "@companionmaps/shared";

import { socketUrl } from "./api.js";
import { clearIdentity, loadIdentity, saveIdentity, type StoredIdentity } from "./identity.js";

export type ConnectionState = "idle" | "connecting" | "open" | "reconnecting" | "closed" | "error";

export interface Fix {
  lat: number;
  lng: number;
  headingDeg?: number | null;
  speedMps?: number | null;
  accuracyM?: number | null;
  batteryPct?: number | null;
}

export interface ConvoyClient {
  state: ConnectionState;
  convoy: Convoy | null;
  youId: string | null;
  error: string | null;
  /** The convoy code this client is joined to, or trying to join. */
  code: string | null;
  join: (code: string, name: string, vehicle: string | null) => void;
  resume: () => boolean;
  leave: () => void;
  sendLocation: (fix: Fix) => void;
  setDestination: (label: string, lat: number, lng: number) => void;
  clearDestination: () => void;
  sendPing: (kind: PingKind) => void;
  rename: (name: string, vehicle: string | null) => void;
}

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 15_000];

/** Close codes the server uses for "do not come back". */
const FATAL_CLOSE_CODES = new Set([4004]);

export function useConvoy(): ConvoyClient {
  const [state, setState] = useState<ConnectionState>("idle");
  const [convoy, setConvoy] = useState<Convoy | null>(null);
  const [youId, setYouId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const identityRef = useRef<StoredIdentity | null>(null);
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  /** Set when the user chose to leave, so a close is not retried. */
  const intentionalRef = useRef(false);

  const send = useCallback((message: ClientMessage): void => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, []);

  const connect = useCallback(
    (target: { code: string; name: string; vehicle: string | null; memberId?: string; token?: string }) => {
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      socketRef.current?.close();
      intentionalRef.current = false;
      setCode(target.code);
      setState(attemptRef.current === 0 ? "connecting" : "reconnecting");
      setError(null);

      const socket = new WebSocket(socketUrl());
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        const hello: ClientMessage = {
          t: "hello",
          code: target.code,
          name: target.name,
          vehicle: target.vehicle,
          ...(target.memberId && target.token ? { memberId: target.memberId, token: target.token } : {}),
        };
        socket.send(JSON.stringify(hello));
      });

      socket.addEventListener("message", (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }

        if (message.t === "welcome") {
          attemptRef.current = 0;
          setState("open");
          setYouId(message.youId);

          const identity: StoredIdentity = {
            code: target.code,
            memberId: message.youId,
            token: message.token,
            name: target.name,
            vehicle: target.vehicle,
          };
          identityRef.current = identity;
          saveIdentity(identity);
        }

        if (message.t === "error") {
          setError(message.message);
          // A rejected resume means the stored identity is worthless; drop it
          // so the next attempt is a clean join rather than a loop.
          if (message.code === "no-such-convoy" || message.code === "not-joined") {
            clearIdentity();
            identityRef.current = null;
          }
        }

        setConvoy((current) => applyServerMessage(current, message));
      });

      socket.addEventListener("close", (event) => {
        if (socketRef.current !== socket) return;
        socketRef.current = null;

        if (intentionalRef.current || FATAL_CLOSE_CODES.has(event.code)) {
          setState(intentionalRef.current ? "closed" : "error");
          return;
        }

        const delay = RECONNECT_DELAYS_MS[Math.min(attemptRef.current, RECONNECT_DELAYS_MS.length - 1)]!;
        attemptRef.current += 1;
        setState("reconnecting");

        reconnectTimerRef.current = window.setTimeout(() => {
          const identity = identityRef.current;
          connect(
            identity
              ? { code: identity.code, name: identity.name, vehicle: identity.vehicle, memberId: identity.memberId, token: identity.token }
              : target,
          );
        }, delay);
      });

      socket.addEventListener("error", () => setError("connection problem"));
    },
    [],
  );

  const join = useCallback(
    (joinCode: string, name: string, vehicle: string | null) => {
      attemptRef.current = 0;
      const stored = loadIdentity();
      const normalised = joinCode.trim().toUpperCase();

      // Resume rather than join when this browser already owns a member in
      // exactly this convoy.
      const canResume = stored?.code === normalised;
      identityRef.current = canResume ? stored : null;

      connect({
        code: normalised,
        name,
        vehicle,
        ...(canResume && stored ? { memberId: stored.memberId, token: stored.token } : {}),
      });
    },
    [connect],
  );

  const resume = useCallback((): boolean => {
    const stored = loadIdentity();
    if (!stored) return false;

    identityRef.current = stored;
    attemptRef.current = 0;
    connect({
      code: stored.code,
      name: stored.name,
      vehicle: stored.vehicle,
      memberId: stored.memberId,
      token: stored.token,
    });
    return true;
  }, [connect]);

  const leave = useCallback(() => {
    intentionalRef.current = true;
    send({ t: "leave" });
    socketRef.current?.close();
    socketRef.current = null;
    clearIdentity();
    identityRef.current = null;

    setConvoy(null);
    setYouId(null);
    setCode(null);
    setState("closed");
  }, [send]);

  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current != null) window.clearTimeout(reconnectTimerRef.current);
      intentionalRef.current = true;
      socketRef.current?.close();
    };
  }, []);

  const sendLocation = useCallback(
    (fix: Fix) => {
      send({
        t: "location",
        lat: fix.lat,
        lng: fix.lng,
        headingDeg: fix.headingDeg ?? null,
        speedMps: fix.speedMps ?? null,
        accuracyM: fix.accuracyM ?? null,
        batteryPct: fix.batteryPct ?? null,
      });
    },
    [send],
  );

  const setDestination = useCallback(
    (label: string, lat: number, lng: number) => send({ t: "set-destination", label, lat, lng }),
    [send],
  );

  const clearDestination = useCallback(() => send({ t: "clear-destination" }), [send]);
  const sendPing = useCallback((kind: PingKind) => send({ t: "ping", kind }), [send]);
  const rename = useCallback(
    (name: string, vehicle: string | null) => send({ t: "rename", name, vehicle }),
    [send],
  );

  return useMemo(
    () => ({
      state,
      convoy,
      youId,
      error,
      code,
      join,
      resume,
      leave,
      sendLocation,
      setDestination,
      clearDestination,
      sendPing,
      rename,
    }),
    [state, convoy, youId, error, code, join, resume, leave, sendLocation, setDestination, clearDestination, sendPing, rename],
  );
}
