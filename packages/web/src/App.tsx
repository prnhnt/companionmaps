import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  deriveCompanionViews,
  deriveHeadline,
  estimateProgress,
  formatDistance,
} from "@companionmaps/shared";

import { ActionRail } from "./components/ActionRail.js";
import { CarPanel } from "./components/CarPanel.js";
import { CompanionFocus } from "./components/CompanionFocus.js";
import { CompanionStrip } from "./components/CompanionStrip.js";
import { DestinationSheet } from "./components/DestinationSheet.js";
import { InviteSheet } from "./components/InviteSheet.js";
import { JoinScreen } from "./components/JoinScreen.js";
import { LocationSheet } from "./components/LocationSheet.js";
import { PingSheet } from "./components/PingSheet.js";
import { RosterSheet } from "./components/RosterSheet.js";
import { TripHero } from "./components/TripHero.js";
import { IconSteering } from "./components/icons.js";
import { ConvoyMap, type CameraMode } from "./map/ConvoyMap.js";
import { useConvoy } from "./useConvoy.js";
import { useDriveMode } from "./useDriveMode.js";
import { useGeolocation } from "./useGeolocation.js";
import { useNow } from "./useNow.js";
import { useViewport } from "./useViewport.js";
import { useWakeLock } from "./useWakeLock.js";

type SheetName = "ping" | "destination" | "invite" | "roster" | "car" | "location";

export function App(): JSX.Element {
  const client = useConvoy();
  const now = useNow(1000);
  const viewport = useViewport();

  const convoy = client.convoy;
  const youId = client.youId;
  const you = convoy?.members.find((member) => member.id === youId) ?? null;
  const destination = convoy?.destination ?? null;

  const geo = useGeolocation(client.sendLocation, destination, you?.position ?? null);
  const drive = useDriveMode(geo.fix?.speedMps ?? null, geo.mode !== "off");
  const driving = drive.mode === "drive";

  useWakeLock(driving && geo.mode !== "off");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [fitNonce, setFitNonce] = useState(0);
  const [cameraOverride, setCameraOverride] = useState<CameraMode | null>(null);

  const askedForLocationRef = useRef(false);

  const views = useMemo(
    () => (convoy && youId ? deriveCompanionViews(convoy, youId, now) : []),
    [convoy, youId, now],
  );
  const companions = useMemo(() => views.filter((view) => !view.isYou), [views]);
  const selected = companions.find((view) => view.member.id === selectedId) ?? null;

  const headline = useMemo(
    () => (convoy && youId ? deriveHeadline(convoy, youId, now) : null),
    [convoy, youId, now],
  );
  const yourProgress = useMemo(
    () => (you ? estimateProgress(you, destination, now) : null),
    [you, destination, now],
  );

  /* ---------------------------------------------------------------- */
  /* behaviour                                                         */
  /* ---------------------------------------------------------------- */

  // Ask about location once, on arrival, and never again in this session.
  useEffect(() => {
    if (!convoy || askedForLocationRef.current) return;
    askedForLocationRef.current = true;
    if (geo.mode === "off") setSheet("location");
  }, [convoy, geo.mode]);

  // Someone you were watching can leave the convoy.
  useEffect(() => {
    if (selectedId && !companions.some((view) => view.member.id === selectedId)) {
      setSelectedId(null);
    }
  }, [companions, selectedId]);

  // Each mode has its own natural camera; a manual choice lasts until the
  // mode changes, at which point the natural one takes over again.
  useEffect(() => setCameraOverride(null), [driving]);

  // Following yourself needs a position to follow; without one, the useful
  // thing is still everyone else.
  const canFollowSelf = you?.position != null;
  const camera: CameraMode = cameraOverride ?? (driving && canFollowSelf ? "follow" : "fit-all");

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
        if (sheet) setSheet(null);
        else setSelectedId(null);
        return;
      }
      if (!selectedId || sheet) return;
      if (event.key === "ArrowLeft") cycleSelection(-1);
      if (event.key === "ArrowRight") cycleSelection(1);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, sheet, cycleSelection]);

  const fitAll = useCallback(() => {
    setCameraOverride("fit-all");
    setFitNonce((value) => value + 1);
  }, []);

  /* ---------------------------------------------------------------- */
  /* render                                                            */
  /* ---------------------------------------------------------------- */

  if (!convoy || !youId || !headline) {
    return (
      <JoinScreen
        onJoin={client.join}
        onResume={client.resume}
        error={client.error}
        connecting={client.state === "connecting" || client.state === "reconnecting"}
      />
    );
  }

  const sideBySide = selected != null && viewport.canSplitHorizontally;
  const stacked = selected != null && !viewport.canSplitHorizontally;

  const companionMap = selected ? (
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
      className="map map--companion"
    />
  ) : null;

  const focusPanel =
    selected && companionMap ? (
      <CompanionFocus
        view={selected}
        driving={driving}
        now={now}
        map={companionMap}
        onClose={() => setSelectedId(null)}
        onCycle={cycleSelection}
        onWaitForMe={() => client.sendPing("wait-for-me")}
      />
    ) : null;

  return (
    <div className="screen" data-mode={driving ? "drive" : "plan"}>
      <div className={`maps ${sideBySide ? "maps--split" : ""}`}>
        <ConvoyMap
          members={convoy.members}
          youId={youId}
          destination={destination}
          selectedId={selectedId}
          onSelect={setSelectedId}
          camera={camera}
          followId={youId}
          routeGeometry={you?.route?.geometry ?? null}
          fitNonce={fitNonce}
          className="map map--main"
        />

        {sideBySide ? <aside className="maps__side">{focusPanel}</aside> : null}
      </div>

      <div className="overlay">
        <div className="overlay__top">
          <TripHero
            destination={destination}
            progress={yourProgress}
            headline={headline}
            driving={driving}
            onFocusMember={setSelectedId}
            onSetDestination={() => setSheet("destination")}
          />

          {/* Nothing up here while driving: the rail already carries the only
              control that matters, and a second copy is a second thing to
              read past. */}
          {driving ? null : (
            <div className="toprail">
              <button type="button" className="pill pill--code" onClick={() => setSheet("invite")}>
                {convoy.code}
              </button>
              <button type="button" className="pill" onClick={() => drive.setMode("drive")}>
                <IconSteering size={18} />
                Driving
              </button>
              <button type="button" className="pill pill--quiet" onClick={client.leave}>
                Leave
              </button>
            </div>
          )}
        </div>

        {client.state === "reconnecting" ? (
          <p className="floatnotice">Connection lost — retrying. Positions may be out of date.</p>
        ) : geo.error ? (
          <p className="floatnotice">Location unavailable: {geo.error}</p>
        ) : geo.mode === "off" ? (
          <button type="button" className="floatnotice floatnotice--action" onClick={() => setSheet("location")}>
            They can't see you — tap to share your location
          </button>
        ) : null}

        <div className="overlay__fill" />

        <div className="overlay__bottom">
          {stacked && focusPanel ? (
            <div className="dock">{focusPanel}</div>
          ) : companions.length > 0 ? (
            <CompanionStrip views={companions} selectedId={selectedId} onSelect={setSelectedId} now={now} />
          ) : (
            <button type="button" className="emptystrip" onClick={() => setSheet("invite")}>
              Nobody else yet — tap to share <strong>{convoy.code}</strong>
            </button>
          )}

          <ActionRail
            driving={driving}
            onPing={() => setSheet("ping")}
            onFitAll={fitAll}
            onToggleMode={() => drive.setMode(driving ? "plan" : "drive")}
            onDestination={() => setSheet("destination")}
            onRoster={() => setSheet("roster")}
            onInvite={() => setSheet("invite")}
            onCarView={() => setSheet("car")}
          />
          <p className="attrib">
            Map data ©{" "}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
              OpenStreetMap
            </a>{" "}
            contributors
          </p>
        </div>
      </div>

      {sheet === "ping" ? (
        <PingSheet onSend={client.sendPing} onClose={() => setSheet(null)} />
      ) : null}

      {sheet === "destination" ? (
        <DestinationSheet
          destination={destination}
          near={you?.position ?? null}
          driving={driving}
          onPick={client.setDestination}
          onClear={client.clearDestination}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet === "invite" ? (
        <InviteSheet
          code={convoy.code}
          convoyName={convoy.name}
          memberNames={convoy.members.filter((m) => m.id !== youId).map((m) => m.name)}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet === "roster" ? (
        <RosterSheet
          views={views}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onClose={() => setSheet(null)}
          now={now}
        />
      ) : null}

      {sheet === "car" ? (
        <CarPanel convoy={convoy} youId={youId} now={now} onClose={() => setSheet(null)} />
      ) : null}

      {sheet === "location" ? (
        <LocationSheet
          supported={geo.supported}
          onShare={() => {
            geo.setMode("live");
            setSheet(null);
          }}
          onSimulate={() => {
            geo.setMode("simulated");
            setSheet(null);
          }}
          onSkip={() => setSheet(null)}
        />
      ) : null}

      {/* Screen-reader summary of the one thing that matters, updated on change. */}
      <p className="visually-hidden" aria-live="polite">
        {headline.text}
        {yourProgress ? `. ${formatDistance(yourProgress.distanceM)} remaining.` : ""}
      </p>
    </div>
  );
}
