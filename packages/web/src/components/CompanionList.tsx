import {
  type CompanionView,
  formatAge,
  formatClock,
  formatDistance,
  formatSignedDuration,
} from "@companionmaps/shared";

export interface CompanionListProps {
  views: CompanionView[];
  selectedId: string | null;
  onSelect: (memberId: string | null) => void;
  now: number;
}

const STANDING_LABEL: Record<CompanionView["standing"], string> = {
  ahead: "ahead of you",
  behind: "behind you",
  alongside: "with you",
  unknown: "",
};

function statusNote(view: CompanionView, now: number): string {
  const { member } = view;

  if (member.status === "arrived") {
    return member.arrivedAt ? `Arrived ${formatClock(member.arrivedAt)}` : "Arrived";
  }
  if (member.status === "offline") return `No signal · ${formatAge(now - member.lastSeenAt)}`;
  if (!member.position) return "Not sharing a location yet";
  if (view.isStale) return `Last fix ${formatAge(view.fixAgeMs)}`;
  if (member.status === "stopped") return "Stopped";
  if (!view.progress) return "Waiting for a destination";

  return `ETA ${formatClock(view.progress.arrivalAt)}`;
}

export function CompanionList({ views, selectedId, onSelect, now }: CompanionListProps): JSX.Element {
  return (
    <ul className="companions">
      {views.map((view, index) => {
        const { member } = view;
        const selected = member.id === selectedId;

        return (
          <li key={member.id}>
            <button
              type="button"
              className={[
                "companion",
                selected ? "companion--selected" : "",
                view.isYou ? "companion--you" : "",
                view.isStale || member.status === "offline" ? "companion--lost" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ "--accent": member.color } as React.CSSProperties}
              onClick={() => onSelect(view.isYou ? null : selected ? null : member.id)}
              aria-pressed={selected}
            >
              <span className="companion__order">{index + 1}</span>

              <span className="companion__body">
                <span className="companion__name">
                  {member.name}
                  {view.isYou ? <span className="companion__tag">you</span> : null}
                  {member.isLead ? <span className="companion__tag companion__tag--lead">lead</span> : null}
                </span>

                <span className="companion__meta">
                  {member.vehicle ? <span>{member.vehicle}</span> : null}
                  <span>{statusNote(view, now)}</span>
                </span>
              </span>

              {view.isYou ? null : (
                <span className="companion__gap">
                  <span className="companion__distance">{formatDistance(view.distanceFromYouM)}</span>
                  <span className="companion__standing">{STANDING_LABEL[view.standing]}</span>
                  {view.etaDeltaS != null ? (
                    <span
                      className={`companion__delta companion__delta--${
                        view.etaDeltaS > 60 ? "late" : view.etaDeltaS < -60 ? "early" : "level"
                      }`}
                    >
                      {formatSignedDuration(view.etaDeltaS)}
                    </span>
                  ) : null}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
