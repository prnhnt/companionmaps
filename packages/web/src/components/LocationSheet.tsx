import { Sheet } from "./Sheet.js";
import { IconLocate, IconSteering } from "./icons.js";

export interface LocationSheetProps {
  supported: boolean;
  onShare: () => void;
  onSimulate: () => void;
  onSkip: () => void;
}

/**
 * Asked once, right after joining.
 *
 * A convoy app where you are invisible is half an app, so this is worth one
 * interruption — but only one, and only while stopped, and "just watch" is a
 * real answer rather than a dark-patterned one.
 */
export function LocationSheet({ supported, onShare, onSimulate, onSkip }: LocationSheetProps): JSX.Element {
  return (
    <Sheet
      title="Let them see you"
      subtitle="Your position goes to this convoy only, and only while you're in it."
      onClose={onSkip}
    >
      <div className="choices">
        <button type="button" className="choice choice--primary" onClick={onShare} disabled={!supported}>
          <IconLocate size={26} />
          <span className="choice__body">
            <span className="choice__title">Share my location</span>
            <span className="choice__blurb">
              {supported
                ? "Your car appears on everyone's map. Nothing is kept after the drive."
                : "This browser can't provide a location."}
            </span>
          </span>
        </button>

        <button type="button" className="choice" onClick={onSimulate}>
          <IconSteering size={26} />
          <span className="choice__body">
            <span className="choice__title">Simulate a car</span>
            <span className="choice__blurb">Drives you toward the destination. For trying it at a desk.</span>
          </span>
        </button>

        <button type="button" className="choice choice--quiet" onClick={onSkip}>
          <span className="choice__body">
            <span className="choice__title">Just watch for now</span>
            <span className="choice__blurb">You'll see everyone else, but they won't see you.</span>
          </span>
        </button>
      </div>
    </Sheet>
  );
}
