import { useState } from "react";

import { Sheet } from "./Sheet.js";
import { IconShare } from "./icons.js";

export interface InviteSheetProps {
  code: string;
  convoyName: string;
  memberNames: string[];
  onClose: () => void;
}

export function InviteSheet({ code, convoyName, memberNames, onClose }: InviteSheetProps): JSX.Element {
  const [copied, setCopied] = useState(false);

  const link = `${window.location.origin}${window.location.pathname}?code=${code}`;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const share = async (): Promise<void> => {
    // The OS share sheet is the shortest path to the group chat where these
    // people are already talking, so it is offered first where it exists.
    if (canShare) {
      try {
        await navigator.share({ title: convoyName, text: `Join my convoy: ${code}`, url: link });
        return;
      } catch {
        // Dismissed, or unsupported target — fall through to the clipboard.
      }
    }

    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Sheet title="Bring someone in" subtitle="They open the link, type a name, and they're on the map." onClose={onClose}>
      <div className="invite">
        <span className="invite__caption">Convoy code</span>
        <span className="invite__code">{code}</span>

        <button type="button" className="tap tap--wide tap--primary" onClick={() => void share()}>
          <IconShare size={24} />
          {canShare ? "Share the link" : copied ? "Link copied" : "Copy the link"}
        </button>

        <p className="invite__hint">
          No app to install and no account to make. Anyone with the code can join, so share it the
          way you would share a table booking.
        </p>

        {memberNames.length > 0 ? (
          <p className="invite__members">
            Already in: {memberNames.join(", ")}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
