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
  { id: 'wk', name: 'Wicketkeeper', angleDeg: 180, distance: 2.6 },
  { id: 'slip1', name: 'First slip', angleDeg: 160, distance: 4.2 },
  { id: 'gully', name: 'Gully', angleDeg: 122, distance: 12 },
  { id: 'point', name: 'Point', angleDeg: 90, distance: 24 },
  { id: 'cover', name: 'Cover', angleDeg: 55, distance: 28 },
  { id: 'midoff', name: 'Mid-off', angleDeg: 14, distance: 27 },
  { id: 'midon', name: 'Mid-on', angleDeg: -14, distance: 27 },
  { id: 'midwicket', name: 'Midwicket', angleDeg: -60, distance: 28 },
  { id: 'squareleg', name: 'Square leg', angleDeg: -95, distance: 25 },
  { id: 'fineleg', name: 'Fine leg', angleDeg: -160, distance: 52 },
];

/** World x/z for a field position, mirrored for a left-handed striker. */
export function fieldPositionXZ(pos: FieldPosition, leftHanded = false): { x: number; z: number } {
  const a = (pos.angleDeg * Math.PI) / 180;
  const x = pos.distance * Math.sin(a);
  return { x: leftHanded ? -x : x, z: STRIKER_STUMPS_Z - pos.distance * Math.cos(a) };
}
