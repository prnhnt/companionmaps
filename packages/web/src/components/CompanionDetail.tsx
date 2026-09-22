import {
  type CompanionView,
  compassPoint,
  formatAge,
  formatClock,
  formatDistance,
  formatDuration,
  formatSignedDuration,
  formatSpeed,
} from "@companionmaps/shared";

export interface CompanionDetailProps {
  view: CompanionView;
  onClose: () => void;
  onWaitForMe: () => void;
  onCycle: (direction: -1 | 1) => void;
  now: number;
}

interface StatProps {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "late" | "early" | "warn";
}

function Stat({ label, value, hint, tone = "default" }: StatProps): JSX.Element {
  return (
    <div className={`stat stat--${tone}`}>
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
      {hint ? <span className="stat__hint">{hint}</span> : null}
    </div>
  );
}

/**
 * The panel beside the companion's own map. It answers the questions you would
 * otherwise ask over the phone: where are they, are they ahead or behind, how
 * far apart are we, and when will they get there relative to me.
 */
export function CompanionDetail({
  view,
  onClose,
  onWaitForMe,
  onCycle,
  now,
}: CompanionDetailProps): JSX.Element {
  const { member, progress } = view;
  const lost = member.status === "offline" || view.isStale;

  return (
    <div className="detail">
      <header className="detail__header">
        <span className="detail__swatch" style={{ background: member.color }} aria-hidden="true" />
        <div className="detail__identity">
          <h2 className="detail__name">{member.name}</h2>
          <p className="detail__vehicle">
            {member.vehicle ?? "—"}
            {member.batteryPct != null ? ` · battery ${Math.round(member.batteryPct)}%` : ""}
          </p>
        </div>

        <div className="detail__nav">
          <button type="button" className="icon-button" onClick={() => onCycle(-1)} aria-label="Previous companion">
            ‹
          </button>
          <button type="button" className="icon-button" onClick={() => onCycle(1)} aria-label="Next companion">
            ›
          </button>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close side-by-side view">
            ✕
          </button>
        </div>
      </header>

      {lost ? (
        <p className="detail__alert">
          No fix for {formatAge(view.fixAgeMs === Infinity ? now - member.lastSeenAt : view.fixAgeMs)}. Showing
          their last known position.
        </p>
      ) : null}

      <div className="detail__stats">
        <Stat
          label="Gap to you"
          value={formatDistance(view.distanceFromYouM)}
          hint={
            view.bearingFromYouDeg != null
              ? `${compassPoint(view.bearingFromYouDeg)} of you`
              : undefined
          }
        />
        <Stat
          label="Position"
          value={
            view.standing === "ahead"
              ? "Ahead"
              : view.standing === "behind"
                ? "Behind"
                : view.standing === "alongside"
                  ? "Together"
                  : "Unknown"
          }
          hint={member.isLead ? "leading the convoy" : undefined}
        />
        <Stat
          label="Their ETA"
          value={progress ? formatClock(progress.arrivalAt) : "--"}
          hint={progress ? `${formatDuration(progress.durationS)} to go` : undefined}
        />
        <Stat
          label="vs you"
          value={formatSignedDuration(view.etaDeltaS)}
          tone={view.etaDeltaS == null ? "default" : view.etaDeltaS > 60 ? "late" : view.etaDeltaS < -60 ? "early" : "default"}
        />
        <Stat label="Speed" value={formatSpeed(member.position?.speedMps ?? null)} />
        <Stat
          label="Remaining"
          value={progress ? formatDistance(progress.distanceM) : "--"}
          hint={progress?.source === "estimate" ? "estimated" : "road route"}
        />
      </div>

      <footer className="detail__footer">
        <button type="button" className="button button--primary" onClick={onWaitForMe}>
          Ask them to wait
        </button>
        <span className="detail__fix">
          {member.position
            ? `Fix ${formatAge(view.fixAgeMs)} · ±${Math.round(member.position.accuracyM ?? 0)} m`
            : "No position yet"}
        </span>
      </footer>
    </div>
  );
}
