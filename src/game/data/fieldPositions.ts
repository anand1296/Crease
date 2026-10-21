import { STRIKER_STUMPS_Z } from './field.ts';

/**
 * Named fielding positions for a right-handed striker, described relative to
 * the striker's stumps: `angleDeg` 0 points straight down the pitch at the
 * bowler, positive angles swing towards the off side (+x), ±180 is directly
 * behind the stumps. Left-handers mirror x.
 */
export interface FieldPosition {
  readonly id: string;
  readonly name: string;
  readonly angleDeg: number;
  readonly distance: number;
}

export const STANDARD_FIELD: readonly FieldPosition[] = [
  // A one-day field: keeper, a slip and gully for the edges, a ring saving
  // the single, fine leg back. Gaps are where gaps are in real fields — the
  // cover drive and the pull have somewhere to go if they beat the fielder.
  { id: 'wk', name: 'Wicketkeeper', angleDeg: 180, distance: 2.6 },
  { id: 'slip1', name: 'First slip', angleDeg: 160, distance: 4.2 },
  { id: 'gully', name: 'Gully', angleDeg: 125, distance: 12 },
  { id: 'point', name: 'Point', angleDeg: 104, distance: 25 },
  { id: 'cover', name: 'Cover', angleDeg: 70, distance: 27 },
  { id: 'midoff', name: 'Mid-off', angleDeg: 24, distance: 26 },
  { id: 'midon', name: 'Mid-on', angleDeg: -24, distance: 26 },
  { id: 'midwicket', name: 'Midwicket', angleDeg: -66, distance: 27 },
  { id: 'squareleg', name: 'Square leg', angleDeg: -102, distance: 25 },
  { id: 'fineleg', name: 'Fine leg', angleDeg: -160, distance: 52 },
];

/** Where the bowler ends up after the follow-through: fields the ball back down the pitch. */
export const BOWLER_FOLLOW_THROUGH: FieldPosition = { id: 'bowler', name: 'Bowler', angleDeg: 9, distance: 15.5 };

/** World x/z for a field position, mirrored for a left-handed striker. */
export function fieldPositionXZ(pos: FieldPosition, leftHanded = false): { x: number; z: number } {
  const a = (pos.angleDeg * Math.PI) / 180;
  const x = pos.distance * Math.sin(a);
  return { x: leftHanded ? -x : x, z: STRIKER_STUMPS_Z - pos.distance * Math.cos(a) };
}
