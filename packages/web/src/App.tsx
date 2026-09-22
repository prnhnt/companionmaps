import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  deriveCompanionViews,
  deriveConvoyStats,
  formatDistance,
  formatDuration,
} from "@companionmaps/shared";

import { CarPanel } from "./components/CarPanel.js";
import { CompanionDetail } from "./components/CompanionDetail.js";
import { CompanionList } from "./components/CompanionList.js";
import { DestinationBar } from "./components/DestinationBar.js";
import { JoinScreen } from "./components/JoinScreen.js";
import { PingBar } from "./components/PingBar.js";
import { ConvoyMap } from "./map/ConvoyMap.js";
import { useConvoy } from "./useConvoy.js";
import { useGeolocation } from "./useGeolocation.js";
import { useNow } from "./useNow.js";

const CONNECTION_LABEL: Record<string, string> = {
  connecting: "connecting…",
  reconnecting: "reconnecting…",
  open: "live",
  closed: "disconnected",
  error: "disconnected",
  idle: "",
};

export function App(): JSX.Element {
  const client = useConvoy();
  const now = useNow(1000);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [splitRatio, setSplitRatio] = useState(0.58);
  const [fitNonce, setFitNonce] = useState(0);
  const [showCarPreview, setShowCarPreview] = useState(false);
  const [copied, setCopied] = useState(false);

  const stageRef = useRef<HTMLDivElement | null>(null);

  const convoy = client.convoy;
  const youId = client.youId;
  const destination = convoy?.destination ?? null;
  const you = convoy?.members.find((member) => member.id === youId) ?? null;

  const geo = useGeolocation(client.sendLocation, destination, you?.position ?? null);

  const views = useMemo(
    () => (convoy && youId ? deriveCompanionViews(convoy, youId, now) : []),
    [convoy, youId, now],
  );
  const stats = useMemo(() => (convoy ? deriveConvoyStats(convoy, now) : null), [convoy, now]);

  const companions = useMemo(() => views.filter((view) => !view.isYou), [views]);
  const selected = companions.find((view) => view.member.id === selectedId) ?? null;

  // Someone you were watching can leave, or lose their place in the convoy.
  useEffect(() => {
    if (selectedId && !companions.some((view) => view.member.id === selectedId)) {
      setSelectedId(null);
    }
  }, [companions, selectedId]);

  const cycleSelection = useCallback(
    (direction: -1 | 1) => {
      if (companions.length === 0) return;
      const index = companions.findIndex((view) => view.member.id === selectedId);
      const next = (index + direction + companions.length) % companions.length;
      setSelectedId(companions[next]!.member.id);
    },
    [companions, selectedId],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement) return;

      if (event.key === "Escape") {
        setSelectedId(null);
        setShowCarPreview(false);
      }
      if (!selectedId) return;
      if (event.key === "ArrowLeft") cycleSelection(-1);
      if (event.key === "ArrowRight") cycleSelection(1);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, cycleSelection]);

  const startSplitDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const onMove = (moveEvent: PointerEvent): void => {
      const rect = stage.getBoundingClientRect();
      const ratio = (moveEvent.clientX - rect.left) / rect.width;
      setSplitRatio(Math.min(0.78, Math.max(0.28, ratio)));
    };

    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const copyCode = useCallback(async () => {
    if (!convoy) return;
    const link = `${window.location.origin}${window.location.pathname}?code=${convoy.code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be refused; the code is on screen regardless.
    }
  }, [convoy]);

  if (!convoy || !youId) {
    return (
      <JoinScreen
        onJoin={client.join}
        onResume={client.resume}
        error={client.error}
        connecting={client.state === "connecting" || client.state === "reconnecting"}
      />
    );
  }

  if (showCarPreview) {
    return <CarPanel convoy={convoy} youId={youId} now={now} onClose={() => setShowCarPreview(false)} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__identity">
          <h1 className="topbar__name">{convoy.name}</h1>
          <button type="button" className="code-chip" onClick={() => void copyCode()} title="Copy invite link">
            {convoy.code}
            <span className="code-chip__hint">{copied ? "copied" : "copy link"}</span>
          </button>
        </div>

        <div className="topbar__stats">
          <span className={`status status--${client.state}`}>
            <span className="status__dot" aria-hidden="true" />
            {CONNECTION_LABEL[client.state] ?? client.state}
          </span>

          <span className="topbar__stat">
            {convoy.members.length} {convoy.members.length === 1 ? "car" : "cars"}
          </span>

          {stats?.spreadM != null ? (
            <span className={`topbar__stat ${stats.isStretched ? "topbar__stat--warn" : ""}`}>
              spread {formatDistance(stats.spreadM)}
            </span>
          ) : null}

          {stats?.arrivalSpanS != null && stats.arrivalSpanS > 60 ? (
            <span className="topbar__stat">arrivals {formatDuration(stats.arrivalSpanS)} apart</span>
          ) : null}
        </div>

        <div className="topbar__actions">
          <div className="segmented" role="group" aria-label="Location sharing">
            <button
              type="button"
              className={geo.mode === "live" ? "segmented__option segmented__option--active" : "segmented__option"}
              onClick={() => geo.setMode(geo.mode === "live" ? "off" : "live")}
              disabled={!geo.supported}
              title={geo.supported ? "Share your real GPS position" : "This browser has no geolocation"}
            >
              GPS
            </button>
            <button
              type="button"
              className={geo.mode === "simulated" ? "segmented__option segmented__option--active" : "segmented__option"}
              onClick={() => geo.setMode(geo.mode === "simulated" ? "off" : "simulated")}
              title="Drive a simulated car toward the destination"
            >
              Simulate
            </button>
          </div>

          <button type="button" className="button" onClick={() => setFitNonce((value) => value + 1)}>
            Fit all
          </button>
          <button type="button" className="button" onClick={() => setShowCarPreview(true)}>
            Car view
          </button>
          <button type="button" className="button button--ghost" onClick={client.leave}>
            Leave
          </button>
        </div>
      </header>

      {geo.mode === "off" ? (
        <p className="banner">
          You are watching without sharing a position. Turn on <strong>GPS</strong> to appear on
          everyone else's map{geo.supported ? "" : " (not available in this browser)"}, or{" "}
          <strong>Simulate</strong> to try it from a desk.
        </p>
      ) : null}
      {geo.error ? <p className="banner banner--warn">Location error: {geo.error}</p> : null}
      {client.state === "reconnecting" ? (
        <p className="banner banner--warn">Connection lost — retrying. Positions may be out of date.</p>
      ) : null}

      <main className="workspace">
        <div
          className={`stage ${selected ? "stage--split" : ""}`}
          ref={stageRef}
          style={
            selected
              ? ({ gridTemplateColumns: `${splitRatio}fr 8px ${1 - splitRatio}fr` } as React.CSSProperties)
              : undefined
          }
        >
          <ConvoyMap
            members={convoy.members}
            youId={youId}
            destination={destination}
            selectedId={selectedId}
            onSelect={setSelectedId}
            camera="fit-all"
            routeGeometry={you?.route?.geometry ?? null}
            fitNonce={fitNonce}
          />

          {selected ? (
            <>
              <div
                className="splitter"
                onPointerDown={startSplitDrag}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize the side-by-side view"
              />

              <section className="companion-pane">
                <ConvoyMap
                  members={convoy.members}
                  youId={youId}
                  destination={destination}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  camera="follow"
                  followId={selected.member.id}
                  routeGeometry={selected.member.route?.geometry ?? null}
                  compact
                  className="map map--compact"
                />
                <CompanionDetail
                  view={selected}
                  now={now}
                  onClose={() => setSelectedId(null)}
                  onCycle={cycleSelection}
                  onWaitForMe={() => client.sendPing("wait-for-me")}
                />
              </section>
            </>
          ) : null}
        </div>

        <aside className="sidebar">
          <h2 className="sidebar__title">
            Convoy order
            <span className="sidebar__hint">closest to the destination first</span>
          </h2>
          <CompanionList views={views} selectedId={selectedId} onSelect={setSelectedId} now={now} />
          {companions.length === 0 ? (
            <p className="sidebar__empty">
              Nobody else has joined yet. Share the code <strong>{convoy.code}</strong> and they will
              appear here.
            </p>
          ) : (
            <p className="sidebar__empty sidebar__empty--quiet">
              Tap anyone to open their map beside yours.
            </p>
          )}
        </aside>
      </main>

      <footer className="dock">
        <DestinationBar
          destination={destination}
          near={you?.position ?? null}
          onPick={client.setDestination}
          onClear={client.clearDestination}
        />
        <PingBar
          onPing={client.sendPing}
          pings={convoy.pings}
          members={convoy.members}
          youId={youId}
          now={now}
        />
      </footer>
    </div>
  );
}
