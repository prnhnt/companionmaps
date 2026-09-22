import { defaultStyleDescription, type BasemapKind } from "../map/style.js";

export interface TileTroubleProps {
  basemap: BasemapKind;
  onUseFallback: () => void;
  onRetryDefault: () => void;
  onDismiss: () => void;
}

/**
 * Shown when the basemap will not load.
 *
 * A map app whose tiles fail renders the background colour and nothing else,
 * which is indistinguishable from a correctly drawn map of open sea at night.
 * Saying so is the whole point of this component: the convoy still works —
 * positions, distances, ETAs and trails are all ours — and it is only the
 * streets underneath that are missing.
 */
export function TileTrouble({ basemap, onUseFallback, onRetryDefault, onDismiss }: TileTroubleProps): JSX.Element {
  const onFallback = basemap === "fallback";

  return (
    <div className="trouble" role="status">
      <div className="trouble__body">
        <strong className="trouble__title">
          {onFallback ? "Still no map tiles" : "Map tiles aren't loading"}
        </strong>
        <p className="trouble__text">
          Everyone's positions, distances and ETAs are fine — it's the streets underneath that are
          missing. Usually that's no internet, a privacy or ad blocker, or the tile server turning
          the request away.
        </p>
        <p className="trouble__detail">
          Trying: <code>{defaultStyleDescription}</code>
          <br />
          Set <code>VITE_MAP_STYLE</code> to use your own tiles.
        </p>
      </div>

      <div className="trouble__actions">
        {onFallback ? (
          <button type="button" className="tap" onClick={onRetryDefault}>
            Try the normal map again
          </button>
        ) : (
          <button type="button" className="tap tap--primary" onClick={onUseFallback}>
            Use the low-detail map
          </button>
        )}
        <button type="button" className="tap tap--ghostish" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
