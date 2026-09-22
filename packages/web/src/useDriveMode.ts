import { useCallback, useEffect, useRef, useState } from "react";

import {
  type DriveMode,
  type DriveState,
  initialDriveState,
  nextDriveState,
  pinDriveMode,
  unpinDriveMode,
} from "./driveModePolicy.js";

export type { DriveMode };

export interface DriveModeState {
  mode: DriveMode;
  /** True once the driver has overridden the automatic choice. */
  pinned: boolean;
  setMode: (mode: DriveMode) => void;
  resumeAuto: () => void;
}

/**
 * How often the policy is re-evaluated when no new fix has arrived.
 *
 * Transitions are elapsed-time based, so they cannot wait on the next
 * location update: a phone that has stopped moving may also have stopped
 * producing fixes.
 */
const TICK_MS = 5000;

/**
 * Chooses between the planning UI and the driving UI.
 *
 * Asking the driver to pick is the wrong default — they are holding a wheel.
 * Speed answers the question well enough, and the manual override exists for
 * passengers, for demos, and for whoever the heuristic gets wrong.
 */
export function useDriveMode(speedMps: number | null, enabled: boolean): DriveModeState {
  const [state, setState] = useState<DriveState>(initialDriveState);

  // The policy reads these; re-running the timer whenever they change would
  // reset it, which is precisely what the elapsed-time rules must not do.
  const speedRef = useRef(speedMps);
  speedRef.current = speedMps;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const evaluate = useCallback(() => {
    setState((current) =>
      nextDriveState(current, {
        speedMps: speedRef.current,
        enabled: enabledRef.current,
        now: Date.now(),
      }),
    );
  }, []);

  useEffect(() => evaluate(), [speedMps, enabled, evaluate]);

  useEffect(() => {
    const timer = window.setInterval(evaluate, TICK_MS);
    return () => window.clearInterval(timer);
  }, [evaluate]);

  return {
    mode: state.mode,
    pinned: state.pinned,
    setMode: useCallback((mode: DriveMode) => setState((current) => pinDriveMode(current, mode)), []),
    resumeAuto: useCallback(() => setState(unpinDriveMode), []),
  };
}
