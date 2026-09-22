import { PING_LABELS, URGENT_PINGS, type Member, type Ping, type PingKind, formatAge } from "@companionmaps/shared";

export interface PingBarProps {
  onPing: (kind: PingKind) => void;
  pings: Ping[];
  members: Member[];
  youId: string | null;
  now: number;
}

/** The set worth a one-tap button; the rest stay in the protocol for later. */
const QUICK_PINGS: PingKind[] = ["wait-for-me", "rest-stop", "fuel", "on-my-way", "lost-you"];

/** Pings older than this stop being news. */
const FEED_WINDOW_MS = 180_000;

export function PingBar({ onPing, pings, members, youId, now }: PingBarProps): JSX.Element {
  const recent = pings.filter((ping) => now - ping.at <= FEED_WINDOW_MS).slice(-3).reverse();

  return (
    <div className="pings">
      <div className="pings__buttons">
        {QUICK_PINGS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={`chip ${URGENT_PINGS.has(kind) ? "chip--urgent" : ""}`}
            onClick={() => onPing(kind)}
          >
            {PING_LABELS[kind]}
          </button>
        ))}
      </div>

      <ul className="pings__feed" aria-live="polite">
        {recent.map((ping) => {
          const sender = members.find((member) => member.id === ping.from);
          const mine = ping.from === youId;

          return (
            <li key={ping.id} className={`pings__item ${URGENT_PINGS.has(ping.kind) ? "pings__item--urgent" : ""}`}>
              <strong style={{ color: sender?.color }}>{mine ? "You" : (sender?.name ?? "Someone")}</strong>
              {" · "}
              {PING_LABELS[ping.kind]}
              <span className="pings__age">{formatAge(now - ping.at)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
