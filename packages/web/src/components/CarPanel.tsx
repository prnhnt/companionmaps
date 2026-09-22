import { type Convoy, buildCarView } from "@companionmaps/shared";

export interface CarPanelProps {
  convoy: Convoy;
  youId: string;
  now: number;
  onClose: () => void;
}

/**
 * Preview of exactly what a CarPlay or Android Auto head unit would render.
 *
 * It calls the same buildCarView the server exposes at /car-view, under the
 * same row and character caps, so this is a faithful preview rather than a
 * mock-up — if it fits here, it fits in the car.
 */
export function CarPanel({ convoy, youId, now, onClose }: CarPanelProps): JSX.Element {
  const view = buildCarView(convoy, youId, now);

  return (
    <div className="car-preview" role="dialog" aria-label="Car display preview">
      <div className="car-preview__frame">
        <header className="car-preview__header">
          <div>
            <h2 className="car-preview__title">{view.title}</h2>
            <p className="car-preview__subtitle">{view.subtitle}</p>
          </div>
          <div className="car-preview__estimate">
            <span className="car-preview__eta">{view.arrivalText}</span>
            <span className="car-preview__remaining">
              {view.etaText} · {view.distanceText}
            </span>
          </div>
        </header>

        {view.alerts.length > 0 ? (
          <ul className="car-preview__alerts">
            {view.alerts.map((alert) => (
              <li key={alert.text} className={`car-preview__alert car-preview__alert--${alert.level}`}>
                {alert.text}
              </li>
            ))}
          </ul>
        ) : null}

        <ul className="car-preview__rows">
          {view.rows.map((row) => (
            <li key={row.id} className="car-preview__row">
              <span className="car-preview__tint" style={{ background: row.tint }} aria-hidden="true" />
              <span className="car-preview__row-text">
                <span className="car-preview__row-title">{row.title}</span>
                <span className="car-preview__row-subtitle">{row.subtitle}</span>
              </span>
              {row.badge ? <span className={`car-preview__badge car-preview__badge--${row.badge}`}>{row.badge}</span> : null}
            </li>
          ))}
          {view.rows.length === 0 ? <li className="car-preview__empty">No companions yet.</li> : null}
        </ul>

        {view.truncatedCount > 0 ? (
          <p className="car-preview__truncated">
            +{view.truncatedCount} more — hidden because the platform caps the list at six rows while
            driving.
          </p>
        ) : null}

        <footer className="car-preview__actions">
          {view.actions.map((action) => (
            <span key={action.id} className="car-preview__action">
              {action.title}
            </span>
          ))}
        </footer>
      </div>

      <div className="car-preview__note">
        <p>
          This is the driving-safe projection the car app would draw: six rows maximum, four actions,
          every string rendered server-side, no free-text entry. See <code>docs/CAR-PROJECTION.md</code>{" "}
          for the CarPlay and Android Auto mapping.
        </p>
        <button type="button" className="button" onClick={onClose}>
          Back to the map
        </button>
      </div>
    </div>
  );
}
