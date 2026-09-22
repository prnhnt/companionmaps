import {
  type Destination,
  type Headline,
  type Progress,
  formatClock,
  formatDistance,
  formatDuration,
} from "@companionmaps/shared";

import { IconFlag } from "./icons.js";

export interface TripHeroProps {
  destination: Destination | null;
  /** The driver's own progress. */
  progress: Progress | null;
  headline: Headline;
  /** Called when the headline names someone worth looking at. */
  onFocusMember: (memberId: string) => void;
  onSetDestination: () => void;
  driving: boolean;
}

/**
 * The top card: arrival time, then one sentence about the convoy.
 *
 * Arrival time leads rather than time-remaining because it is the number
 * people actually exchange ("I'll be there about half four"), and it does not
 * require the reader to do arithmetic against a clock they cannot see.
 */
export function TripHero({
  destination,
  progress,
  headline,
  onFocusMember,
  onSetDestination,
  driving,
}: TripHeroProps): JSX.Element {
  const focusable = headline.memberId != null;

  return (
    <div className="hero">
      {destination && progress ? (
        <div className="hero__trip">
          <div className="hero__figures">
            <span className="hero__clock">{formatClock(progress.arrivalAt)}</span>
            <span className="hero__remaining">
              {formatDuration(progress.durationS)} · {formatDistance(progress.distanceM)}
            </span>
          </div>

          <button
            type="button"
            className="hero__destination"
            onClick={onSetDestination}
            title="Change destination"
          >
            <IconFlag size={driving ? 22 : 18} />
            <span className="hero__destination-label">{destination.label}</span>
          </button>
        </div>
      ) : destination ? (
        /* A destination but no position of our own: an empty clock face reads
           as broken, so lead with the thing we do know. */
        <button type="button" className="hero__trip hero__trip--waiting" onClick={onSetDestination}>
          <span className="hero__waiting-label">
            <IconFlag size={driving ? 22 : 18} />
            Heading to
          </span>
          <span className="hero__waiting-destination">{destination.label}</span>
          <span className="hero__waiting-note">Share your location to get an ETA</span>
        </button>
      ) : (
        <button type="button" className="hero__cta" onClick={onSetDestination}>
          <IconFlag size={26} />
          Set where you're going
        </button>
      )}

      <button
        type="button"
        className={`headline headline--${headline.tone}`}
        onClick={() => headline.memberId && onFocusMember(headline.memberId)}
        disabled={!focusable}
        aria-live="polite"
      >
        <span className="headline__dot" aria-hidden="true" />
        <span className="headline__text">{headline.text}</span>
        {headline.detail && !driving ? (
          <span className="headline__detail">{headline.detail}</span>
        ) : null}
      </button>
    </div>
  );
}
