import { useEffect, useState } from "react";

import { createConvoy, lookupConvoy, type ConvoySummary } from "../api.js";
import { loadIdentity } from "../identity.js";
import { IconCar, IconPeople } from "./icons.js";

export interface JoinScreenProps {
  onJoin: (code: string, name: string, vehicle: string | null) => void;
  onResume: () => boolean;
  error: string | null;
  connecting: boolean;
}

const CODE_PATTERN = /^[A-Z0-9]{3}-?[A-Z0-9]{3}$/;

const normaliseCode = (raw: string): string => {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  return cleaned.length > 3 ? `${cleaned.slice(0, 3)}-${cleaned.slice(3)}` : cleaned;
};

/**
 * Getting in.
 *
 * The path that matters is "someone sent me a link while I'm sitting in a
 * car park": code already filled from the URL, name remembered from last
 * time, one big button. Everything else — making a convoy, naming your car —
 * is available but never in the way.
 */
export function JoinScreen({ onJoin, onResume, error, connecting }: JoinScreenProps): JSX.Element {
  const stored = loadIdentity();

  const [code, setCode] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("code");
    return fromUrl ? normaliseCode(fromUrl) : "";
  });
  const [name, setName] = useState(() => stored?.name ?? "");
  const [vehicle, setVehicle] = useState(() => stored?.vehicle ?? "");
  const [showVehicle, setShowVehicle] = useState(() => Boolean(stored?.vehicle));
  const [summary, setSummary] = useState<ConvoySummary | null>(null);
  const [creating, setCreating] = useState(false);

  const codeLooksRight = CODE_PATTERN.test(code);
  const ready = codeLooksRight && name.trim().length > 0;

  // Peek at the convoy the moment the code is complete, so a typo is caught
  // before the rest of the form is filled in.
  useEffect(() => {
    if (!codeLooksRight) {
      setSummary(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const found = await lookupConvoy(code);
      if (!cancelled) setSummary(found);
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [code, codeLooksRight]);

  const create = async (): Promise<void> => {
    setCreating(true);
    try {
      const trimmed = name.trim();
      const convoy = await createConvoy(trimmed ? `${trimmed}'s trip` : "Road trip");
      onJoin(convoy.code, trimmed || "Driver", vehicle.trim() || null);
    } catch {
      setCreating(false);
    }
  };

  return (
    <div className="welcome">
      <div className="welcome__card">
        <div className="welcome__brand">
          <IconCar size={30} />
          <h1 className="welcome__title">
            Companion<span>Maps</span>
          </h1>
        </div>

        <p className="welcome__tagline">
          Driving somewhere together in different cars? Everyone sees everyone. No more following
          too close, no more “where did you get to?”.
        </p>

        {stored ? (
          <button type="button" className="tap tap--wide" onClick={onResume} disabled={connecting}>
            Rejoin {stored.code} as {stored.name}
          </button>
        ) : null}

        <label className="bigfield bigfield--stacked">
          <span className="bigfield__label">Your name</span>
          <input
            className="bigfield__input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Mira"
            maxLength={40}
            autoComplete="nickname"
            enterKeyHint="next"
          />
        </label>

        <label className="bigfield bigfield--stacked">
          <span className="bigfield__label">Convoy code</span>
          <input
            className="bigfield__input bigfield__input--code"
            value={code}
            onChange={(event) => setCode(normaliseCode(event.target.value))}
            placeholder="TRK-4H2"
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="go"
            onKeyDown={(event) => {
              if (event.key === "Enter" && ready) onJoin(code, name.trim(), vehicle.trim() || null);
            }}
          />
        </label>

        {showVehicle ? (
          <label className="bigfield bigfield--stacked">
            <span className="bigfield__label">
              Your car <span className="bigfield__hint">so people can spot you</span>
            </span>
            <input
              className="bigfield__input"
              value={vehicle}
              onChange={(event) => setVehicle(event.target.value)}
              placeholder="blue Golf"
              maxLength={40}
            />
          </label>
        ) : (
          <button type="button" className="linkish" onClick={() => setShowVehicle(true)}>
            + Add your car (optional)
          </button>
        )}

        {summary ? (
          <p className="welcome__found">
            <IconPeople size={18} />
            <span>
              <strong>{summary.name}</strong> · {summary.memberCount}{" "}
              {summary.memberCount === 1 ? "car" : "cars"}
              {summary.memberNames.length > 0 ? ` · ${summary.memberNames.join(", ")}` : ""}
              {summary.destinationLabel ? ` · heading to ${summary.destinationLabel}` : ""}
            </span>
          </p>
        ) : codeLooksRight ? (
          <p className="welcome__found welcome__found--warn">No convoy with that code.</p>
        ) : null}

        {error ? <p className="notice notice--bad">{error}</p> : null}

        <button
          type="button"
          className="tap tap--wide tap--primary"
          disabled={!ready || connecting}
          onClick={() => onJoin(code, name.trim(), vehicle.trim() || null)}
        >
          {connecting ? "Joining…" : "Join the convoy"}
        </button>

        <div className="welcome__or">
          <span>or</span>
        </div>

        <button
          type="button"
          className="tap tap--wide"
          disabled={creating || connecting || name.trim().length === 0}
          onClick={() => void create()}
        >
          {creating ? "Creating…" : "Start a new convoy"}
        </button>
      </div>
    </div>
  );
}
