import { useEffect, useRef } from "react";

import { IconClose } from "./icons.js";

export interface SheetProps {
  title: string;
  subtitle?: string | null;
  onClose: () => void;
  children: React.ReactNode;
  /** Sheets that are one tap and gone do not need a scroll region. */
  size?: "auto" | "tall";
}

/**
 * Full-screen panel for anything that is not the map.
 *
 * Deliberately not a half-height bottom sheet: a partial overlay invites you
 * to keep watching the map while operating a control, which is the behaviour
 * this app should not reward. Whatever is on screen gets full attention, and
 * closing is one large target away.
 */
export function Sheet({ title, subtitle, onClose, children, size = "auto" }: SheetProps): JSX.Element {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`sheet__panel sheet__panel--${size}`} ref={panelRef} tabIndex={-1}>
        <header className="sheet__header">
          <div className="sheet__titles">
            <h2 className="sheet__title">{title}</h2>
            {subtitle ? <p className="sheet__subtitle">{subtitle}</p> : null}
          </div>
          <button type="button" className="tap tap--round" onClick={onClose} aria-label="Close">
            <IconClose size={26} />
          </button>
        </header>

        <div className="sheet__body">{children}</div>
      </div>
    </div>
  );
}
