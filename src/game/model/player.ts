/**
 * Player domain model. All attributes are 0–100 and each one is read by a
 * specific system (noted per field) — none is decorative.
 */
export type Hand = 'right' | 'left';

export type BowlingStyle = 'fast' | 'fastMedium' | 'medium' | 'offSpin' | 'legSpin' | 'none';

export interface BattingAttributes {
  /** Spatial tolerance of contact: how far from the ideal ball position a shot still finds the middle. */
  readonly technique: number;
  /** Timing tolerance: how early/late a shot can be and still be clean. */
  readonly timing: number;
  /** Bat speed, hence exit speed and carry. */
  readonly power: number;
  /** Reach to the pitch of the ball and getting back/across (contact-zone range). */
  readonly footwork: number;
  /** Control of defensive shots: deadening the ball and avoiding edges. */
  readonly defence: number;
}

export interface BowlingAttributes {
  /** Release speed for pace bowlers; flight speed for spinners. */
  readonly pace: number;
  /** Swing and seam movement for pace bowlers. */
  readonly swing: number;
  /** Revolutions on the ball for spinners. */
  readonly spin: number;
  /** Line and length error. */
  readonly accuracy: number;
  /** How quickly fatigue builds over a spell. */
  readonly stamina: number;
}

export interface FieldingAttributes {
  /** Reaction time and running speed. */
  readonly fielding: number;
  /** Probability of holding a chance. */
  readonly catching: number;
  /** Throw speed and accuracy. */
  readonly throwing: number;
}

export interface Player {
  readonly id: string;
  readonly name: string;
  readonly battingHand: Hand;
  readonly bowlingArm: Hand;
  readonly bowlingStyle: BowlingStyle;
  readonly batting: BattingAttributes;
  readonly bowling: BowlingAttributes;
  readonly fielding: FieldingAttributes;
}

/** +1 when the batter's off side is +x (right-hander), −1 for a left-hander. */
export const offSideSign = (hand: Hand): 1 | -1 => (hand === 'right' ? 1 : -1);

export const isSpinner = (style: BowlingStyle): boolean => style === 'offSpin' || style === 'legSpin';
