import { useEffect, useRef, useState } from "react";

import type { Destination, LatLng } from "@companionmaps/shared";

import { searchPlaces, type PlaceResult } from "../api.js";
import { Sheet } from "./Sheet.js";
import { IconSearch } from "./icons.js";

export interface DestinationSheetProps {
  destination: Destination | null;
  near: LatLng | null;
  driving: boolean;
  onPick: (label: string, lat: number, lng: number) => void;
  onClear: () => void;
  onClose: () => void;
}

/** Nominatim allows one request a second; typing is a lot faster than that. */
const DEBOUNCE_MS = 450;

/** OSM display names run to six or seven parts; the first three carry it. */
const shortLabel = (label: string): string => label.split(",").slice(0, 3).join(", ").trim();

export function DestinationSheet({
  destination,
  near,
  driving,
  onPick,
  onClear,
  onClose,
}: DestinationSheetProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Only steal focus when stopped. Popping a keyboard up at 70mph is exactly
  // the behaviour the driving layout exists to prevent.
  useEffect(() => {
    if (!driving) inputRef.current?.focus();
  }, [driving]);

  useEffect(() => {
    if (query.trim().length < 3) {
      setResults([]);
      setSearching(false);
      setSearched(false);
      return;
    }

    let cancelled = false;
    setSearching(true);

    const timer = window.setTimeout(async () => {
      const found = await searchPlaces(query, near);
      if (cancelled) return;
      setResults(found);
      setSearching(false);
      setSearched(true);
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, near]);

  const choose = (place: PlaceResult): void => {
    onPick(shortLabel(place.label), place.lat, place.lng);
    onClose();
  };

  return (
    <Sheet
      title="Where are you going?"
      subtitle="Everyone in the convoy gets the same destination."
      onClose={onClose}
      size="tall"
    >
      {driving ? (
        <p className="notice notice--warn">
          You appear to be moving. Pull over before typing, or ask a passenger.
        </p>
      ) : null}

      {destination ? (
        <div className="current-destination">
          <div>
            <span className="current-destination__label">Currently heading to</span>
            <span className="current-destination__value">{destination.label}</span>
          </div>
          <button
            type="button"
            className="tap"
            onClick={() => {
              onClear();
              onClose();
            }}
          >
            Clear
          </button>
        </div>
      ) : null}

      <label className="bigfield">
        <IconSearch size={24} className="bigfield__icon" />
        <input
          ref={inputRef}
          className="bigfield__input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Town, address or place"
          aria-label="Search for a destination"
          enterKeyHint="search"
        />
      </label>

      <div className="results">
        {searching ? <p className="results__status">Searching…</p> : null}
        {!searching && searched && results.length === 0 ? (
          <p className="results__status">Nothing found for “{query.trim()}”.</p>
        ) : null}

        {results.map((place) => (
          <button
            key={`${place.lat},${place.lng},${place.label}`}
            type="button"
            className="result"
            onClick={() => choose(place)}
          >
            <span className="result__name">{shortLabel(place.label)}</span>
            <span className="result__kind">{place.kind.replace(/_/g, " ")}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
