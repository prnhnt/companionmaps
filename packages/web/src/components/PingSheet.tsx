import { PING_LABELS, URGENT_PINGS, type PingKind } from "@companionmaps/shared";

import { Sheet } from "./Sheet.js";

export interface PingSheetProps {
  onSend: (kind: PingKind) => void;
  onClose: () => void;
}

/**
 * The only way to say something, and it is six buttons.
 *
 * There is no text entry anywhere in this app by design: typing is the single
 * worst thing a driver can be asked to do, and every message a convoy
 * actually needs turns out to be one of these. Each button is one tap, sends
 * immediately and closes — no confirmation step, because a modal on top of a
 * modal in a moving car is worse than an occasional stray ping.
 */
const CHOICES: PingKind[] = ["wait-for-me", "rest-stop", "fuel", "on-my-way", "lost-you", "help"];

const BLURB: Record<PingKind, string> = {
  "wait-for-me": "Ease off, I'm dropping back",
  "rest-stop": "Pulling in at the next services",
  fuel: "I need to stop for fuel",
  "on-my-way": "Moving again, catching up",
  "lost-you": "I can't see you any more",
  help: "Something's wrong, I need you",
  "slow-down": "Too fast for me",
};

export function PingSheet({ onSend, onClose }: PingSheetProps): JSX.Element {
  return (
    <Sheet title="Tell the convoy" subtitle="One tap. Everyone sees it straight away." onClose={onClose}>
      <div className="pinggrid">
        {CHOICES.map((kind) => (
          <button
            key={kind}
            type="button"
            className={`pingbtn ${URGENT_PINGS.has(kind) ? "pingbtn--urgent" : ""}`}
            onClick={() => {
              onSend(kind);
              onClose();
            }}
          >
            <span className="pingbtn__label">{PING_LABELS[kind]}</span>
            <span className="pingbtn__blurb">{BLURB[kind]}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
