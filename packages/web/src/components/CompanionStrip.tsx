import { type CompanionView, formatAge, formatClock, formatDistance } from "@companionmaps/shared";

export interface CompanionStripProps {
  views: CompanionView[];
  selectedId: string | null;
  onSelect: (memberId: string | null) => void;
  now: number;
}

interface Gap {
  value: string;
  label: string;
  /** Words need a smaller size than figures to fit the same box. */
  isWord: boolean;
}

function gapLine(view: CompanionView, now: number): Gap {
  const { member } = view;

  if (member.status === "arrived") {
    return {
      value: "Arrived",
      label: member.arrivedAt ? formatClock(member.arrivedAt) : "at the destination",
      isWord: true,
    };
  }
  if (member.status === "offline" || view.isStale) {
    return { value: "No signal", label: formatAge(now - member.lastSeenAt), isWord: true };
  }
  if (!member.position) return { value: "No fix", label: "not sharing yet", isWord: true };

  // We have no position of our own, so a gap cannot be computed. Their own
  // distance to the destination is the next most useful thing, and beats
  // four identical cards reading "you have no fix".
  if (view.distanceFromYouM == null) {
    return view.progress
      ? { value: formatDistance(view.progress.distanceM), label: "to go", isWord: false }
      : { value: "On map", label: "position known", isWord: true };
  }

  return {
    value: formatDistance(view.distanceFromYouM),
    label:
      view.standing === "ahead" ? "ahead" : view.standing === "behind" ? "behind" : "with you",
    isWord: false,
  };
}

/**
 * The row of companions along the bottom, one tap from anywhere.
 *
 * Three facts per card and no more: who, how far, which way. Anything else is
 * a thing to read rather than recognise, and reading is what a driver cannot
 * spare — the arrival delta is genuinely useful, which is why it lives one tap
 * away in the focus panel rather than shrinking these three to fit it.
 *
 * The whole card is the target, comfortably past the 44pt minimum, and the
 * row scrolls rather than compressing: four unreadable cards are worse than
 * three readable ones and a swipe.
 */
export function CompanionStrip({ views, selectedId, onSelect, now }: CompanionStripProps): JSX.Element {
  // Four cards is where a 390px phone runs out of room; past that the row
  // scrolls and the trailing fade says so.
  const fits = views.length <= 3;

  return (
    <div className={`strip ${fits ? "strip--fits" : ""}`} role="list">
      {views.map((view) => {
        const { value, label, isWord } = gapLine(view, now);
        const selected = view.member.id === selectedId;
        const lost = view.member.status === "offline" || view.isStale;

        return (
          <button
            key={view.member.id}
            type="button"
            role="listitem"
            className={[
              "ccard",
              selected ? "ccard--selected" : "",
              lost ? "ccard--lost" : "",
              view.member.status === "arrived" ? "ccard--arrived" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{ "--accent": view.member.color } as React.CSSProperties}
            onClick={() => onSelect(selected ? null : view.member.id)}
            aria-pressed={selected}
            aria-label={`${view.member.name}, ${value} ${label}`}
          >
            <span className="ccard__name">{view.member.name}</span>
            <span className={`ccard__value ${isWord ? "ccard__value--word" : ""}`}>{value}</span>
            <span className="ccard__label">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
