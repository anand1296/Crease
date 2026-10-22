import type { FieldPosition } from '../data/fieldPositions.ts';

/**
 * Field presets a captain can set when bowling: the ten fields most often
 * seen in T20 cricket, from attacking (catchers in) to defensive (boundary
 * riders). Positions are for a right-handed batter (angle 0 = straight back
 * past the bowler, positive = off side) and mirror for a left-hander.
 *
 * The fielding restriction decides which can be used: in the powerplay at
 * most two fielders may be outside the 30-yard (27.43 m) circle, so only
 * presets with two out are available then.
 */
export type FieldMood = 'aggressive' | 'moderate' | 'defensive';

export interface FieldPreset {
  readonly id: string;
  readonly name: string;
  readonly mood: FieldMood;
  /** Who it suits. */
  readonly bowler: 'pace' | 'spin' | 'any';
  readonly blurb: string;
  /** Nine positions: everyone but the keeper and the bowler. */
  readonly positions: readonly FieldPosition[];
}

export const CIRCLE = 27.43;

const P = (id: string, name: string, angleDeg: number, distance: number): FieldPosition => ({ id, name, angleDeg, distance });

const SLIP1 = P('slip1', 'First slip', 160, 4.2);
const SLIP2 = P('slip2', 'Second slip', 149, 4.9);
const GULLY = P('gully', 'Gully', 125, 12);
const SHORT_LEG = P('shortleg', 'Short leg', -95, 5.5);
const SILLY_POINT = P('sillypoint', 'Silly point', 92, 5.5);
const POINT = P('point', 'Point', 100, 24);
const COVER = P('cover', 'Cover', 70, 26);
const EXTRA_COVER = P('extracover', 'Extra cover', 45, 26);
const MID_OFF = P('midoff', 'Mid-off', 22, 25);
const MID_ON = P('midon', 'Mid-on', -22, 25);
const MIDWICKET = P('midwicket', 'Midwicket', -62, 26);
const SQUARE_LEG = P('squareleg', 'Square leg', -100, 24);
const SHORT_FINE = P('shortfine', 'Short fine leg', -145, 20);
const THIRD_MAN = P('thirdman', 'Third man', 140, 58);
const DEEP_POINT = P('deeppoint', 'Deep point', 100, 61);
const DEEP_COVER = P('deepcover', 'Deep cover', 64, 61);
const LONG_OFF = P('longoff', 'Long-off', 14, 63);
const LONG_ON = P('longon', 'Long-on', -14, 63);
const COW_CORNER = P('cowcorner', 'Cow corner', -38, 62);
const DEEP_MID = P('deepmid', 'Deep midwicket', -62, 61);
const DEEP_SQUARE = P('deepsquare', 'Deep square leg', -100, 61);
const FINE_LEG = P('fineleg', 'Fine leg', -155, 58);

export const FIELD_PRESETS: readonly FieldPreset[] = [
  {
    id: 'pp-slips', name: 'Powerplay: two slips', mood: 'aggressive', bowler: 'pace',
    blurb: 'New ball: two slips for the edge, ring saving one, third man and fine leg back',
    positions: [SLIP1, SLIP2, POINT, COVER, MID_OFF, MID_ON, MIDWICKET, THIRD_MAN, FINE_LEG],
  },
  {
    id: 'pp-standard', name: 'Powerplay: standard', mood: 'moderate', bowler: 'pace',
    blurb: 'One slip, a full ring, third man and fine leg',
    positions: [SLIP1, POINT, COVER, MID_OFF, MID_ON, MIDWICKET, SQUARE_LEG, THIRD_MAN, FINE_LEG],
  },
  {
    id: 'pp-ring', name: 'Powerplay: save the boundary', mood: 'defensive', bowler: 'any',
    blurb: 'No slip; a tight ring and two back square',
    positions: [POINT, COVER, EXTRA_COVER, MID_OFF, MID_ON, MIDWICKET, SQUARE_LEG, THIRD_MAN, DEEP_SQUARE],
  },
  {
    id: 'catchers', name: 'Catchers in', mood: 'aggressive', bowler: 'any',
    blurb: 'Slip, gully and short leg waiting for the mistake',
    positions: [SLIP1, GULLY, SHORT_LEG, POINT, COVER, MID_OFF, MID_ON, FINE_LEG, LONG_ON],
  },
  {
    id: 'spin-bat-pad', name: 'Spin: bat-pad', mood: 'aggressive', bowler: 'spin',
    blurb: 'Slip, short leg and silly point round the bat; long-off and deep midwicket',
    positions: [SLIP1, SHORT_LEG, SILLY_POINT, POINT, COVER, MID_ON, MIDWICKET, LONG_OFF, DEEP_MID],
  },
  {
    id: 'balanced', name: 'Middle overs: balanced', mood: 'moderate', bowler: 'pace',
    blurb: 'Ring of five, four back: third man, deep cover, long-on, deep square',
    positions: [POINT, COVER, MID_OFF, MID_ON, MIDWICKET, THIRD_MAN, DEEP_COVER, LONG_ON, DEEP_SQUARE],
  },
  {
    id: 'spin-squeeze', name: 'Spin: squeeze the singles', mood: 'moderate', bowler: 'spin',
    blurb: 'Ring cutting off the single, long-off, long-on and the sweepers back',
    positions: [POINT, COVER, MID_OFF, MID_ON, SQUARE_LEG, LONG_OFF, LONG_ON, DEEP_MID, DEEP_COVER],
  },
  {
    id: 'riders', name: 'Boundary riders', mood: 'defensive', bowler: 'spin',
    blurb: 'Five on the rope in front of square: make them hit it along the ground',
    positions: [POINT, MID_OFF, MID_ON, SHORT_FINE, DEEP_COVER, LONG_OFF, LONG_ON, COW_CORNER, DEEP_MID],
  },
  {
    id: 'death-yorkers', name: 'Death: yorkers', mood: 'defensive', bowler: 'pace',
    blurb: 'Full and straight: long-off, long-on, deep midwicket, third man and fine leg back',
    positions: [POINT, COVER, MID_OFF, MIDWICKET, THIRD_MAN, LONG_OFF, LONG_ON, DEEP_MID, FINE_LEG],
  },
  {
    id: 'death-short', name: 'Death: short and leg side', mood: 'defensive', bowler: 'pace',
    blurb: 'Bouncers and slower balls into the pitch: the leg side guarded deep',
    positions: [POINT, COVER, MID_OFF, MID_ON, THIRD_MAN, DEEP_POINT, DEEP_SQUARE, DEEP_MID, FINE_LEG],
  },
];

export const outsideCircle = (preset: FieldPreset): number => preset.positions.filter((p) => p.distance > CIRCLE).length;

/** Presets allowed with at most `maxOutside` fielders outside the circle. */
export const legalPresets = (maxOutside: number): FieldPreset[] => FIELD_PRESETS.filter((p) => outsideCircle(p) <= maxOutside);

export const findPreset = (id: string): FieldPreset | undefined => FIELD_PRESETS.find((p) => p.id === id);

// --- The captain's own field ------------------------------------------------------------

/** The usual name for a spot on the field (angle from straight, + off side; distance from the striker's stumps, m). */
export function positionName(angleDeg: number, distance: number): string {
  const off = angleDeg >= 0;
  const a = Math.abs(angleDeg);
  if (distance < 10) {
    if (off) return a > 150 ? 'Slip' : a > 115 ? 'Gully' : a > 70 ? 'Silly point' : 'Silly mid-off';
    return a > 150 ? 'Leg slip' : a > 115 ? 'Leg gully' : a > 70 ? 'Short leg' : 'Silly mid-on';
  }
  const deep = distance > CIRCLE;
  if (a < 12) return deep ? 'Long-off' : 'Mid-off';
  if (off) {
    if (a < 35) return deep ? 'Long-off' : 'Mid-off';
    if (a < 58) return deep ? 'Deep extra cover' : 'Extra cover';
    if (a < 80) return deep ? 'Deep cover' : 'Cover';
    if (a < 105) return deep ? 'Deep point' : 'Point';
    if (a < 130) return deep ? 'Deep backward point' : 'Backward point';
    return deep ? 'Third man' : 'Short third man';
  }
  if (a < 35) return deep ? 'Long-on' : 'Mid-on';
  if (a < 55) return deep ? 'Cow corner' : 'Mid-on';
  if (a < 80) return deep ? 'Deep midwicket' : 'Midwicket';
  if (a < 105) return deep ? 'Deep square leg' : 'Square leg';
  if (a < 135) return deep ? 'Deep backward square' : 'Backward square leg';
  return deep ? 'Fine leg' : 'Short fine leg';
}

/** A field position from a spot on the ground (from the striker's stumps; angles + off side). */
export function customPosition(i: number, angleDeg: number, distance: number): FieldPosition {
  const d = Math.min(66, Math.max(4, distance));
  return { id: `custom${i}`, name: positionName(angleDeg, d), angleDeg, distance: d };
}

/**
 * Whether a field is legal: at most `maxOut` outside the circle (the
 * powerplay allows two, after it five), and — Law 28.4 — no more than two
 * fielders behind square on the leg side. Returns what is wrong, if anything.
 */
export function checkField(positions: readonly FieldPosition[], maxOut: number): string | undefined {
  const out = positions.filter((p) => p.distance > CIRCLE).length;
  if (out > maxOut) return `Only ${maxOut} fielders may be outside the circle now (you have ${out}).`;
  const legBehind = positions.filter((p) => p.angleDeg < -90).length;
  if (legBehind > 2) return `No more than two fielders behind square on the leg side (you have ${legBehind}).`;
  return undefined;
}
