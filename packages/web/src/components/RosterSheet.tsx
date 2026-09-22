import {
  type CompanionView,
  formatAge,
  formatClock,
  formatDistance,
  formatSignedDuration,
} from "@companionmaps/shared";

import { Sheet } from "./Sheet.js";

export interface RosterSheetProps {
  views: CompanionView[];
  selectedId: string | null;
  onSelect: (memberId: string) => void;
  onClose: () => void;
  now: number;
}

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

export function RosterSheet({ views, selectedId, onSelect, onClose, now }: RosterSheetProps): JSX.Element {
  return (
    <Sheet
      title="Everyone"
      subtitle="In convoy order — closest to the destination first."
      onClose={onClose}
      size="tall"
    >
      <ul className="roster">
        {views.map((view, index) => {
          const { member } = view;
          const lost = member.status === "offline" || view.isStale;

          return (
            <li key={member.id}>
              <button
                type="button"
                className={[
                  "rosteritem",
                  member.id === selectedId ? "rosteritem--selected" : "",
                  view.isYou ? "rosteritem--you" : "",
                  lost ? "rosteritem--lost" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ "--accent": member.color } as React.CSSProperties}
                onClick={() => {
                  if (view.isYou) return;
                  onSelect(member.id);
                  onClose();
                }}
                disabled={view.isYou}
              >
                <span className="rosteritem__order">{index + 1}</span>

                <span className="rosteritem__body">
                  <span className="rosteritem__name">
                    {member.name}
                    {view.isYou ? <span className="tagpill">you</span> : null}
                    {member.isLead ? <span className="tagpill tagpill--lead">lead</span> : null}
                  </span>
                  <span className="rosteritem__meta">
                    {member.vehicle ? `${member.vehicle} · ` : ""}
                    {statusNote(view, now)}
                  </span>
                </span>

                {view.isYou ? null : (
                  <span className="rosteritem__gap">
                    <span className="rosteritem__distance">{formatDistance(view.distanceFromYouM)}</span>
                    {view.etaDeltaS != null ? (
                      <span
                        className={`rosteritem__delta rosteritem__delta--${
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
    </Sheet>
  );
}
