/**
 * When to show the driving layout.
 *
 * Kept as a pure state machine rather than a tangle of timers inside the hook,
 * because the interesting cases — a red light, a motorway services stop, a
 * driver who pinned the wrong mode an hour ago — all involve minutes of
 * elapsed time, and none of them are worth discovering in a real car.
 */

export type DriveMode = "plan" | "drive";

/** ~15 km/h: fast enough that you are certainly not on foot. */
export const ENTER_DRIVE_MPS = 4.2;

/** ~5 km/h. The gap between the two is deliberate hysteresis. */
export const EXIT_DRIVE_MPS = 1.4;

/**
 * How long the car must stay slow before the full UI returns.
 *
 * Long on purpose: lights, queues and toll booths are not the end of a
 * journey, and a layout that reshuffles at every red light is worse than one
 * that never changes.
 */
export const EXIT_DELAY_MS = 90_000;

/**
 * How long real driving must contradict a manual "I'm parked" before the app
 * believes the road instead.
 *
 * Without this, one tap disables the driving layout for the rest of the
 * journey: you stop at services, switch to the full UI to change the
 * destination, drive off, and never get the safe layout back. A pin means
 * "not right now", not "never again".
 */
export const PIN_RELEASE_MS = 60_000;

export interface DriveState {
  mode: DriveMode;
  /** The driver chose this mode by hand. */
  pinned: boolean;
  /** When the road first contradicted the pin. */
  disagreedSince: number | null;
  /** When the car first dropped below the exit threshold. */
  slowSince: number | null;
}

export interface DriveInput {
  /** The driver's own ground speed, or null when it is unknown. */
  speedMps: number | null;
  /** False when no location is being shared; nothing can be inferred then. */
  enabled: boolean;
  now: number;
}

export const initialDriveState: DriveState = {
  mode: "plan",
  pinned: false,
  disagreedSince: null,
  slowSince: null,
};

export function nextDriveState(state: DriveState, input: DriveInput): DriveState {
  const { speedMps, enabled, now } = input;

  // No speed, no opinion. Whatever mode is showing stays.
  if (!enabled || speedMps == null) {
    return state.disagreedSince == null && state.slowSince == null
      ? state
      : { ...state, disagreedSince: null, slowSince: null };
  }

  if (state.pinned) {
    // Exactly one disagreement overrides a pin: the car is demonstrably being
    // driven while the driver has said it is parked. Pinning the driving
    // layout while stopped is always respected, because that costs nothing.
    const drivingAnyway = speedMps >= ENTER_DRIVE_MPS && state.mode === "plan";

    if (!drivingAnyway) {
      return state.disagreedSince == null ? state : { ...state, disagreedSince: null };
    }

    const since = state.disagreedSince ?? now;
    if (now - since >= PIN_RELEASE_MS) {
      return { mode: "drive", pinned: false, disagreedSince: null, slowSince: null };
    }
    return state.disagreedSince == null ? { ...state, disagreedSince: since } : state;
  }

  if (speedMps >= ENTER_DRIVE_MPS) {
    return state.mode === "drive" && state.slowSince == null
      ? state
      : { ...state, mode: "drive", slowSince: null };
  }

  if (speedMps <= EXIT_DRIVE_MPS && state.mode === "drive") {
    const since = state.slowSince ?? now;
    if (now - since >= EXIT_DELAY_MS) {
      return { ...state, mode: "plan", slowSince: null };
    }
    return state.slowSince == null ? { ...state, slowSince: since } : state;
  }

  // Between the thresholds, or already parked: hold, and forget any timer.
  return state.slowSince == null ? state : { ...state, slowSince: null };
}

export function pinDriveMode(state: DriveState, mode: DriveMode): DriveState {
  return { mode, pinned: true, disagreedSince: null, slowSince: null };
}

export function unpinDriveMode(state: DriveState): DriveState {
  return { ...state, pinned: false, disagreedSince: null };
}
