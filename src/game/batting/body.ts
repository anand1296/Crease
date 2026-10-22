import { STRIKER_POPPING_Z } from '../data/field.ts';
import { type Hand, offSideSign } from '../model/player.ts';
import { SHOTS, type ShotAttempt } from './shots.ts';

/**
 * The striker's pads and body as axis-aligned boxes, positioned by stance
 * and footwork. The ball collides with these if it gets past (or is missed
 * by) the bat. Simplified on purpose: two pads and a torso.
 */
export interface Box {
  readonly part: 'pad' | 'body';
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

const PAD_HALF_WIDTH = 0.075;
const PAD_HALF_DEPTH = 0.08;
const PAD_HEIGHT = 0.55;

function box(part: Box['part'], x: number, z: number, halfW: number, halfD: number, minY: number, maxY: number): Box {
  return { part, minX: x - halfW, maxX: x + halfW, minY, maxY, minZ: z - halfD, maxZ: z + halfD };
}

/** Where the bat meets the ball for an attempt: z of the contact plane. */
export function contactPlaneZ(attempt: ShotAttempt, footworkSkill: number, pitchZ?: number): number {
  const def = SHOTS[attempt.shot];
  const depth = def.depth[attempt.footwork] ?? def.depth[def.footwork[0]] ?? 0;
  // Good footwork gets further forward to the pitch of the ball (or deeper back).
  const reach = 0.25 * (footworkSkill / 100);
  if (attempt.footwork === 'back') return STRIKER_POPPING_Z + depth + reach * 0.5;
  const furthest = STRIKER_POPPING_Z + depth - reach;
  // Forward strokes go to the pitch of the ball when it is within reach, meeting
  // it just after it lands. A ball pitching right up at the crease (a yorker)
  // cannot be reached on the half-volley and must be met at the batter's toes.
  if (pitchZ === undefined) return furthest;
  return Math.min(STRIKER_POPPING_Z - 0.05, Math.max(furthest, pitchZ + 0.25));
}

/**
 * Pads and body for the stroke being played. `lineAtContact` is the ball's
 * world x at the contact plane — the front pad goes to the line of the ball
 * on a front-foot stroke, just on the leg side of the bat.
 */
export function batterBoxes(
  hand: Hand,
  attempt: ShotAttempt | null,
  lineAtContact: number,
  footworkSkill: number,
  pitchZ?: number,
): Box[] {
  const off = offSideSign(hand);
  if (!attempt || attempt.shot === 'leave') {
    const fw = attempt?.footwork ?? 'front';
    // Stance: legs on the leg side of middle stump. A leave on the front foot
    // still plants the pad forward, in line with middle/leg.
    const frontZ = fw === 'front' ? STRIKER_POPPING_Z - 0.3 : STRIKER_POPPING_Z + 0.2;
    const backZ = STRIKER_POPPING_Z + 0.35;
    const frontX = -off * 0.1;
    const backX = fw === 'back' ? off * 0.02 : -off * 0.2;
    return [
      box('pad', frontX, frontZ, PAD_HALF_WIDTH, PAD_HALF_DEPTH, 0, PAD_HEIGHT),
      box('pad', backX, backZ, PAD_HALF_WIDTH, PAD_HALF_DEPTH, 0, PAD_HEIGHT),
      box('body', (frontX + backX) / 2, (frontZ + backZ) / 2, 0.18, 0.2, PAD_HEIGHT, 1.55),
    ];
  }
  const zc = contactPlaneZ(attempt, footworkSkill, pitchZ);
  // Pads are always behind the bat's contact point, so the bat gets first go.
  if (attempt.footwork === 'front' || attempt.footwork === 'out') {
    // Front pad to the line of the ball, leg side of the bat, just behind it. Out of the crease,
    // the back foot has come down the pitch too.
    const frontX = clamp(lineAtContact - off * 0.2, -0.5, 0.5);
    const frontZ = zc + 0.18;
    const backX = -off * 0.2;
    const backZ = attempt.footwork === 'out' ? zc + 0.6 : STRIKER_POPPING_Z + 0.35;
    return [
      box('pad', frontX, frontZ, PAD_HALF_WIDTH, PAD_HALF_DEPTH, 0, PAD_HEIGHT),
      box('pad', backX, backZ, PAD_HALF_WIDTH, PAD_HALF_DEPTH, 0, PAD_HEIGHT),
      box('body', (frontX + backX) / 2, (frontZ + backZ) / 2, 0.18, 0.3, PAD_HEIGHT, 1.5),
    ];
  }
  // Back foot: back pad goes back and across towards off stump.
  const backX = off * 0.02;
  const backZ = zc + 0.3;
  const frontX = -off * 0.15;
  const frontZ = zc + 0.15;
  return [
    box('pad', frontX, frontZ, PAD_HALF_WIDTH, PAD_HALF_DEPTH, 0, PAD_HEIGHT),
    box('pad', backX, backZ, PAD_HALF_WIDTH, PAD_HALF_DEPTH, 0, PAD_HEIGHT),
    box('body', (frontX + backX) / 2, backZ, 0.18, 0.15, PAD_HEIGHT, 1.6),
  ];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
