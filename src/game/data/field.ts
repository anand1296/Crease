/**
 * Ground and pitch dimensions in metres, from the Laws of Cricket.
 * Shared by the simulation (collisions, crease checks) and the renderer.
 */
export const FIELD = {
  /** Stumps to stumps: 22 yards. */
  pitchLength: 20.12,
  pitchWidth: 3.05,
  /** Popping crease distance in front of the stumps. */
  poppingCreaseOffset: 1.22,
  /** Return creases sit this far either side of the middle stump. */
  returnCreaseHalfSpacing: 1.32,
  stumpHeight: 0.711,
  /** Outside edge to outside edge of the three stumps. */
  wicketWidth: 0.2286,
  stumpRadius: 0.0175,
  bailLength: 0.1096,
  /** Boundary radius measured from the pitch centre. */
  boundaryRadius: 65,
  ballRadius: 0.036,
  ballMass: 0.16,
} as const;

/** z coordinate of the striker's stumps (the batting end). */
export const STRIKER_STUMPS_Z = FIELD.pitchLength / 2;
/** z coordinate of the bowler's-end stumps. */
export const BOWLER_STUMPS_Z = -FIELD.pitchLength / 2;
