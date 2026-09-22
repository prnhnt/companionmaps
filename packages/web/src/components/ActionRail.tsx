import {
  IconCar,
  IconFit,
  IconFlag,
  IconMegaphone,
  IconParked,
  IconPeople,
  IconShare,
  IconSteering,
} from "./icons.js";

export interface ActionRailProps {
  driving: boolean;
  onPing: () => void;
  onFitAll: () => void;
  onToggleMode: () => void;
  onDestination: () => void;
  onRoster: () => void;
  onInvite: () => void;
  onCarView: () => void;
}

/**
 * The bottom controls.
 *
 * Every aria-label here starts with the word that is printed on the button.
 * Voice control matches what a person can see, so an accessible name that
 * does not contain the visible one is a button they cannot ask for.
 *
 * Driving, this is three targets: say something, see everyone on the map, and
 * drop back to the full UI. Everything else a moving car does not need, and a
 * control you do not need is a control that makes the one you do need harder
 * to hit. Parked, the rest comes back.
 */
export function ActionRail({
  driving,
  onPing,
  onFitAll,
  onToggleMode,
  onDestination,
  onRoster,
  onInvite,
  onCarView,
}: ActionRailProps): JSX.Element {
  if (driving) {
    return (
      <div className="rail rail--drive">
        <button type="button" className="tap tap--big tap--primary rail__say" onClick={onPing}>
          <IconMegaphone size={28} />
          Say something
        </button>

        <button type="button" className="tap tap--big" onClick={onFitAll} aria-label="Show all — fit the whole convoy on the map">
          <IconFit size={28} />
          <span className="tap__caption">Show all</span>
        </button>

        <button type="button" className="tap tap--big" onClick={onToggleMode} aria-label="Parked — switch to the full layout">
          <IconParked size={28} />
          <span className="tap__caption">Parked</span>
        </button>
      </div>
    );
  }

  return (
    <div className="rail">
      <button type="button" className="tap tap--stack" onClick={onDestination}>
        <IconFlag size={22} />
        <span className="tap__caption">Destination</span>
      </button>

      <button type="button" className="tap tap--stack" onClick={onRoster}>
        <IconPeople size={22} />
        <span className="tap__caption">Everyone</span>
      </button>

      <button type="button" className="tap tap--stack" onClick={onInvite}>
        <IconShare size={22} />
        <span className="tap__caption">Invite</span>
      </button>

      <button type="button" className="tap tap--stack" onClick={onPing}>
        <IconMegaphone size={22} />
        <span className="tap__caption">Say</span>
      </button>

      <button type="button" className="tap tap--stack" onClick={onCarView}>
        <IconCar size={22} />
        <span className="tap__caption">Car view</span>
      </button>

      <button type="button" className="tap tap--stack tap--accent" onClick={onToggleMode}>
        <IconSteering size={22} />
        <span className="tap__caption">Driving</span>
      </button>
    </div>
  );
}
