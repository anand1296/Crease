/**
 * Coaching nets: the player bats against a chosen delivery, as often as he
 * likes. The same ball (exactly: the same release, line, length, swing and
 * bounce) comes down every time until he asks for another, so he can find
 * out what the timing has to be and try different strokes to it; the coach
 * explains each attempt (batting/coaching.ts) and the attempts are listed so
 * he can see himself improve. Nothing is scored.
 */
import type { DeliveryPlan } from '../bowling/execute.ts';
import type { Player } from '../model/player.ts';

export type NetsBallId =
  | 'driveOff'
  | 'halfVolley'
  | 'goodLength'
  | 'shortWide'
  | 'shortBody'
  | 'bouncer'
  | 'pads'
  | 'yorker'
  | 'outswinger'
  | 'slower'
  | 'spinFlighted'
  | 'spinShort';

export interface NetsBall {
  readonly id: NetsBallId;
  readonly name: string;
  /** What a coach would hope you do with it. */
  readonly lesson: string;
  readonly spin: boolean;
  readonly plan: (bowler: Player) => DeliveryPlan;
}

const pace = (type: DeliveryPlan['type'], line: number, length: number) => (): DeliveryPlan => ({ type, line, length });
const spinPlan = (line: number, length: number) => (b: Player): DeliveryPlan => ({ type: b.bowlingStyle === 'legSpin' ? 'legBreak' : 'offBreak', line, length });

export const NETS_BALLS: readonly NetsBall[] = [
  { id: 'driveOff', name: 'Full, outside off', lesson: 'Front foot, drive through the covers.', spin: false, plan: pace('fast', 0.3, 3.2) },
  { id: 'halfVolley', name: 'Half-volley on the stumps', lesson: 'Front foot, straight drive past the bowler.', spin: false, plan: pace('fast', 0.03, 2.8) },
  { id: 'goodLength', name: 'Good length, off stump', lesson: 'The hardest ball: defend it, or leave it if it is going past.', spin: false, plan: pace('fast', 0.12, 6) },
  { id: 'shortWide', name: 'Short and wide', lesson: 'Back foot, cut it square or late.', spin: false, plan: pace('fast', 0.7, 9) },
  { id: 'shortBody', name: 'Short, at the body', lesson: 'Back foot, pull it in front of square.', spin: false, plan: pace('fast', -0.05, 9) },
  { id: 'bouncer', name: 'Bouncer', lesson: 'Duck under it (leave), or hook it fine with Shift.', spin: false, plan: pace('bouncer', 0, 11) },
  { id: 'pads', name: 'On the pads', lesson: 'Work it off the pads: the flick or the glance.', spin: false, plan: pace('fast', -0.22, 4.2) },
  { id: 'yorker', name: 'Yorker', lesson: 'Get the bat down in time: block it, or squeeze it straight.', spin: false, plan: pace('yorker', 0, 0.9) },
  { id: 'outswinger', name: 'Outswinger', lesson: 'Play late and straight, or leave it: it moves away towards the slips.', spin: false, plan: pace('outswinger', 0.2, 4.5) },
  { id: 'slower', name: 'Slower ball', lesson: 'It comes later than the run-up says: wait for it.', spin: false, plan: pace('slower', 0.1, 4.5) },
  { id: 'spinFlighted', name: 'Spinner, flighted', lesson: 'Sweep it, or get down the pitch (D) and drive.', spin: true, plan: spinPlan(0.05, 3.6) },
  { id: 'spinShort', name: 'Spinner, dragged short', lesson: 'Rock back and pull or cut.', spin: true, plan: spinPlan(0.15, 7.6) },
];

export function netsBall(id: NetsBallId): NetsBall {
  return NETS_BALLS.find((b) => b.id === id) ?? (NETS_BALLS[0] as NetsBall);
}

export interface NetsConfig {
  /** The first ball. */
  readonly ball: NetsBallId;
}

/** Who bowls it: the quickest seamer for pace, the side's best spinner for spin. */
export function netsBowler(xi: readonly Player[], spin: boolean): Player | undefined {
  const quick = (p: Player) => p.bowlingStyle === 'fast' || p.bowlingStyle === 'fastMedium';
  const turner = (p: Player) => p.bowlingStyle === 'offSpin' || p.bowlingStyle === 'legSpin';
  const pool = xi.filter(spin ? turner : quick);
  return pool.sort((a, b) => (spin ? b.bowling.spin - a.bowling.spin : b.bowling.pace - a.bowling.pace))[0] ?? xi.find(quick) ?? xi[xi.length - 1];
}
