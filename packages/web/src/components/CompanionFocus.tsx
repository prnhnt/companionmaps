import {
  type CompanionView,
  compassPoint,
  formatAge,
  formatClock,
  formatDistance,
  formatSignedDuration,
  formatSpeed,
} from "@companionmaps/shared";

import { IconChevronLeft, IconChevronRight, IconClose, IconMegaphone } from "./icons.js";

export interface CompanionFocusProps {
  view: CompanionView;
  driving: boolean;
  onClose: () => void;
  onCycle: (direction: -1 | 1) => void;
  onWaitForMe: () => void;
  /** The companion's own map, rendered by the parent. */
  map: React.ReactNode;
  now: number;
}

interface FigureProps {
  label: string;
  value: string;
  hint?: string | null;
  tone?: "default" | "late" | "early" | "warn";
}

/** A word needs less room per character than a figure, so it gets less. */
const isWord = (value: string): boolean => /[a-z]{4}/i.test(value);

function Figure({ label, value, hint, tone = "default" }: FigureProps): JSX.Element {
  return (
    <div className={`figure figure--${tone}`}>
      <span className="figure__label">{label}</span>
      <span className={`figure__value ${isWord(value) ? "figure__value--word" : ""}`}>{value}</span>
      {hint ? <span className="figure__hint">{hint}</span> : null}
    </div>
  );
}

const STANDING_WORD: Record<CompanionView["standing"], string> = {
  ahead: "Ahead",
  behind: "Behind",
  alongside: "Together",
  unknown: "Unknown",
};

/**
 * One companion, beside your own map.
 *
 * While driving this is three numbers and one button. Parked, it fills in the
 * rest. The split exists because the question changes: on the road it is
 * "where are they and should I do something", and in a car park it is "tell
 * me everything you know".
 */
export function CompanionFocus({
  view,
  driving,
  onClose,
  onCycle,
  onWaitForMe,
  map,
  now,
}: CompanionFocusProps): JSX.Element {
  const { member, progress } = view;
  const lost = member.status === "offline" || view.isStale;

  return (
    <section className="focus" aria-label={`${member.name}'s position`}>
      <div className="focus__map">{map}</div>

      <div className="focus__panel">
        <header className="focus__header">
          <span className="focus__swatch" style={{ background: member.color }} aria-hidden="true" />

          <div className="focus__identity">
            <h2 className="focus__name">{member.name}</h2>
            <p className="focus__sub">
              {member.vehicle ?? STANDING_WORD[view.standing]}
              {member.batteryPct != null && member.batteryPct <= 20
                ? ` · battery ${Math.round(member.batteryPct)}%`
                : ""}
            </p>
          </div>

          <div className="focus__nav">
            <button type="button" className="tap tap--round" onClick={() => onCycle(-1)} aria-label="Previous companion">
              <IconChevronLeft size={24} />
            </button>
            <button type="button" className="tap tap--round" onClick={() => onCycle(1)} aria-label="Next companion">
              <IconChevronRight size={24} />
            </button>
            <button type="button" className="tap tap--round" onClick={onClose} aria-label="Close">
              <IconClose size={24} />
            </button>
          </div>
        </header>

        {lost ? (
          <p className="focus__alert">
            No fix for {formatAge(Number.isFinite(view.fixAgeMs) ? view.fixAgeMs : now - member.lastSeenAt)} — last known
            position shown
          </p>
        ) : null}

        <div className="focus__figures">
          <Figure
            label="Gap"
            value={formatDistance(view.distanceFromYouM)}
            hint={
              view.bearingFromYouDeg != null
                ? `${compassPoint(view.bearingFromYouDeg)} of you`
                : view.distanceFromYouM == null
                  ? "needs your location"
                  : null
            }
          />
          <Figure
            label="Position"
            value={view.standing === "unknown" ? "—" : STANDING_WORD[view.standing]}
            hint={member.isLead ? "leading" : view.standing === "unknown" ? "needs your location" : null}
          />
          <Figure
            label="vs you"
            value={formatSignedDuration(view.etaDeltaS)}
            tone={view.etaDeltaS == null ? "default" : view.etaDeltaS > 60 ? "late" : view.etaDeltaS < -60 ? "early" : "default"}
            hint={progress ? `arrives ${formatClock(progress.arrivalAt)}` : null}
          />

          {driving ? null : (
            <>
              <Figure label="Speed" value={formatSpeed(member.position?.speedMps ?? null)} />
              <Figure
                label="Remaining"
                value={progress ? formatDistance(progress.distanceM) : "--"}
                hint={progress ? (progress.source === "estimate" ? "estimated" : "road route") : null}
              />
              <Figure
                label="Last fix"
                value={member.position ? formatAge(view.fixAgeMs) : "--"}
                hint={member.position?.accuracyM != null ? `±${Math.round(member.position.accuracyM)} m` : null}
              />
            </>
          )}
        </div>

        <button type="button" className="tap tap--wide tap--primary" onClick={onWaitForMe}>
          <IconMegaphone size={24} />
          Ask {member.name.split(/\s+/)[0]} to wait
        </button>
      </div>
    </section>
  );
}
