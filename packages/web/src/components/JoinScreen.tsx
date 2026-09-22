import { useEffect, useState } from "react";

import { createConvoy, lookupConvoy, type ConvoySummary } from "../api.js";
import { loadIdentity } from "../identity.js";

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

export function JoinScreen({ onJoin, onResume, error, connecting }: JoinScreenProps): JSX.Element {
  const [code, setCode] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("code");
    return fromUrl ? normaliseCode(fromUrl) : "";
  });
  const [name, setName] = useState(() => loadIdentity()?.name ?? "");
  const [vehicle, setVehicle] = useState(() => loadIdentity()?.vehicle ?? "");
  const [summary, setSummary] = useState<ConvoySummary | null>(null);
  const [creating, setCreating] = useState(false);

  const stored = loadIdentity();
  const valid = CODE_PATTERN.test(code) && name.trim().length > 0;

  // Peek at the convoy as soon as the code looks complete, so people find out
  // they mistyped it before they fill in the rest of the form.
  useEffect(() => {
    if (!CODE_PATTERN.test(code)) {
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
  }, [code]);

  const handleCreate = async (): Promise<void> => {
    setCreating(true);
    try {
      const convoy = await createConvoy(name.trim() ? `${name.trim()}'s trip` : "Road trip");
      setCode(convoy.code);
      onJoin(convoy.code, name.trim() || "Driver", vehicle.trim() || null);
    } catch {
      setCreating(false);
    }
  };

  return (
    <div className="join">
      <div className="join__card">
        <h1 className="join__title">
          Companion<span>Maps</span>
        </h1>
        <p className="join__tagline">
          Same destination, different cars. Everyone sees everyone — so nobody has to tailgate to
          keep up.
        </p>

        {stored ? (
          <button type="button" className="button button--ghost join__resume" onClick={onResume}>
            Rejoin {stored.code} as {stored.name}
          </button>
        ) : null}

        <label className="field">
          <span className="field__label">Your name</span>
          <input
            className="field__input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Mira"
            maxLength={40}
            autoComplete="nickname"
          />
        </label>

        <label className="field">
          <span className="field__label">
            Your car <span className="field__hint">optional, helps people spot you</span>
          </span>
          <input
            className="field__input"
            value={vehicle}
            onChange={(event) => setVehicle(event.target.value)}
            placeholder="blue Golf"
            maxLength={40}
          />
        </label>

        <label className="field">
          <span className="field__label">Convoy code</span>
          <input
            className="field__input field__input--code"
            value={code}
            onChange={(event) => setCode(normaliseCode(event.target.value))}
            placeholder="TRK-4H2"
            inputMode="text"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </label>

        {summary ? (
          <p className="join__summary">
            <strong>{summary.name}</strong> · {summary.memberCount}{" "}
            {summary.memberCount === 1 ? "car" : "cars"}
            {summary.memberNames.length > 0 ? ` · ${summary.memberNames.join(", ")}` : ""}
            {summary.destinationLabel ? (
              <>
                <br />
                heading to {summary.destinationLabel}
              </>
            ) : null}
          </p>
        ) : CODE_PATTERN.test(code) ? (
          <p className="join__summary join__summary--warn">No convoy with that code.</p>
        ) : null}

        {error ? <p className="join__error">{error}</p> : null}

        <div className="join__actions">
          <button
            type="button"
            className="button button--primary"
            disabled={!valid || connecting}
            onClick={() => onJoin(code, name.trim(), vehicle.trim() || null)}
          >
            {connecting ? "Joining…" : "Join convoy"}
          </button>
          <button
            type="button"
            className="button"
            disabled={creating || connecting || name.trim().length === 0}
            onClick={() => void handleCreate()}
          >
            {creating ? "Creating…" : "Start a new convoy"}
          </button>
        </div>
      </div>
    </div>
  );
}
