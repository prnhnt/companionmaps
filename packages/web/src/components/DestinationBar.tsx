import { useEffect, useRef, useState } from "react";

import type { Destination, LatLng } from "@companionmaps/shared";

import { searchPlaces, type PlaceResult } from "../api.js";

export interface DestinationBarProps {
  destination: Destination | null;
  near: LatLng | null;
  onPick: (label: string, lat: number, lng: number) => void;
  onClear: () => void;
}

/** Nominatim's policy is one request per second; typing is much faster. */
const SEARCH_DEBOUNCE_MS = 450;

/** Display names from OSM are long; the leading parts carry the meaning. */
const shortLabel = (label: string): string => label.split(",").slice(0, 3).join(", ");

export function DestinationBar({ destination, near, onPick, onClear }: DestinationBarProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (query.trim().length < 3) {
      setResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);

    const timer = window.setTimeout(async () => {
      const found = await searchPlaces(query, near);
      if (cancelled) return;
      setResults(found);
      setSearching(false);
      setOpen(true);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, near]);

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, []);

  const choose = (place: PlaceResult): void => {
    onPick(shortLabel(place.label), place.lat, place.lng);
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="destination" ref={containerRef}>
      {destination ? (
        <div className="destination__current">
          <span className="destination__icon" aria-hidden="true">
            ◎
          </span>
          <span className="destination__label" title={destination.label}>
            {destination.label}
          </span>
          <button type="button" className="icon-button" onClick={onClear} aria-label="Clear destination">
            ✕
          </button>
        </div>
      ) : null}

      <div className="destination__search">
        <input
          className="field__input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={destination ? "Change destination…" : "Where is everyone heading?"}
          aria-label="Search for a destination"
        />
        {searching ? <span className="destination__spinner" aria-hidden="true" /> : null}

        {open && results.length > 0 ? (
          <ul className="destination__results">
            {results.map((place) => (
              <li key={`${place.lat},${place.lng},${place.label}`}>
                <button type="button" className="destination__result" onClick={() => choose(place)}>
                  <span className="destination__result-name">{shortLabel(place.label)}</span>
                  <span className="destination__result-kind">{place.kind}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
