import { bearingDelta, type LatLng } from "@companionmaps/shared";

/**
 * Per-marker animation state.
 *
 * Positions land once a second at best. Snapping a marker to each one looks
 * broken, so every marker keeps a rendered position that chases its reported
 * one each frame. The same applies to heading, where the shortest rotation has
 * to be taken explicitly or a car crossing north spins 350° the wrong way.
 */
export interface MarkerMotion {
  rendered: LatLng;
  target: LatLng;
  renderedHeading: number;
  targetHeading: number;
}

/** Fraction of the remaining gap closed per frame. */
const EASE = 0.14;

/** Below this the marker has arrived; keep easing and it jitters forever. */
const SNAP_DEGREES = 1e-7;
const SNAP_HEADING = 0.5;

/** Past this the fix is a jump, not a drive — teleport rather than glide. */
const TELEPORT_DEGREES = 0.5;

export function createMotion(position: LatLng, headingDeg: number | null): MarkerMotion {
  return {
    rendered: { ...position },
    target: { ...position },
    renderedHeading: headingDeg ?? 0,
    targetHeading: headingDeg ?? 0,
  };
}

export function retarget(motion: MarkerMotion, position: LatLng, headingDeg: number | null): void {
  motion.target = { ...position };
  if (headingDeg != null) motion.targetHeading = headingDeg;

  const jumped =
    Math.abs(motion.target.lat - motion.rendered.lat) > TELEPORT_DEGREES ||
    Math.abs(motion.target.lng - motion.rendered.lng) > TELEPORT_DEGREES;

  if (jumped) {
    motion.rendered = { ...motion.target };
    motion.renderedHeading = motion.targetHeading;
  }
}

/** Advances one frame. Returns true while there is still movement to render. */
export function stepMotion(motion: MarkerMotion): boolean {
  const dLat = motion.target.lat - motion.rendered.lat;
  const dLng = motion.target.lng - motion.rendered.lng;
  const dHeading = bearingDelta(motion.renderedHeading, motion.targetHeading);

  const settled =
    Math.abs(dLat) < SNAP_DEGREES &&
    Math.abs(dLng) < SNAP_DEGREES &&
    Math.abs(dHeading) < SNAP_HEADING;

  if (settled) {
    motion.rendered = { ...motion.target };
    motion.renderedHeading = motion.targetHeading;
    return false;
  }

  motion.rendered = {
    lat: motion.rendered.lat + dLat * EASE,
    lng: motion.rendered.lng + dLng * EASE,
  };
  motion.renderedHeading = (motion.renderedHeading + dHeading * EASE + 360) % 360;
  return true;
}
