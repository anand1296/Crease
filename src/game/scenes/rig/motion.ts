import type { LimbPose, Pose } from './Humanoid.tsx';

/**
 * Procedural motion. Each function writes joint angles into a Pose for a
 * given phase/time; the views blend between them. Angles in radians.
 */
const setLimb = (l: LimbPose, pitch: number, roll: number, bend: number) => {
  l.pitch = pitch;
  l.roll = roll;
  l.bend = bend;
};

export function resetPose(p: Pose): void {
  p.drop = 0;
  p.bob = 0;
  p.lean = 0;
  p.twist = 0;
  p.tilt = 0;
  setLimb(p.armL, 0, 0.08, 0.15);
  setLimb(p.armR, 0, 0.08, 0.15);
  setLimb(p.legL, 0, 0, 0);
  setLimb(p.legR, 0, 0, 0);
  p.handL = undefined;
  p.handR = undefined;
  p.clip = undefined;
  p.look = undefined;
  p.grip = undefined;
}

/**
 * Running / walking gait. `phase` advances one full stride per 2π;
 * `intensity` 0 (standing) … 1 (sprint).
 */
export function gait(p: Pose, phase: number, intensity: number): void {
  const k = Math.min(1, Math.max(0, intensity));
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  const stride = 0.15 + 0.65 * k;
  setLimb(p.legL, s * stride, 0.02, Math.max(0, -c) * (0.3 + 1.1 * k) + 0.1);
  setLimb(p.legR, -s * stride, 0.02, Math.max(0, c) * (0.3 + 1.1 * k) + 0.1);
  setLimb(p.armL, -s * (0.25 + 0.7 * k), 0.1, 0.3 + 0.9 * k);
  setLimb(p.armR, s * (0.25 + 0.7 * k), 0.1, 0.3 + 0.9 * k);
  p.lean = 0.05 + 0.3 * k;
  p.bob = Math.abs(Math.sin(phase)) * 0.06 * k;
  p.drop = 0.02 + 0.05 * k;
}

/** Fielder walking in / ready, weight forward, hands low. */
export function readyStance(p: Pose, t: number): void {
  resetPose(p);
  p.drop = 0.12;
  p.lean = 0.35;
  setLimb(p.legL, 0.25, 0.12, 0.45);
  setLimb(p.legR, 0.15, 0.12, 0.35);
  setLimb(p.armL, 0.5, 0.15, 0.6);
  setLimb(p.armR, 0.5, 0.15, 0.6);
  p.bob = Math.sin(t * 3) * 0.008;
}

/** Wicketkeeper squatting behind the stumps; rises as the ball is bowled. */
export function keeperStance(p: Pose, rise: number): void {
  resetPose(p);
  const r = Math.min(1, Math.max(0, rise));
  p.drop = 0.45 - 0.3 * r;
  p.lean = 0.45 - 0.15 * r;
  setLimb(p.legL, 1.3 - 0.8 * r, 0.35, 2.0 - 1.3 * r);
  setLimb(p.legR, 1.3 - 0.8 * r, 0.35, 2.0 - 1.3 * r);
  setLimb(p.armL, 0.9 + 0.4 * r, 0.1, 0.3);
  setLimb(p.armR, 0.9 + 0.4 * r, 0.1, 0.3);
}

/** Arms up: catch taken, wicket, or a celebration. */
export function celebrate(p: Pose, t: number): void {
  resetPose(p);
  const wave = Math.sin(t * 7) * 0.2;
  setLimb(p.armL, 2.6 + wave, 0.35, 0.2);
  setLimb(p.armR, 2.6 - wave, 0.35, 0.2);
  p.bob = Math.abs(Math.sin(t * 6)) * 0.12;
}

/** Hands together at chest height: taking a catch or gathering the ball. */
export function gather(p: Pose): void {
  p.clip = undefined;
  setLimb(p.armL, 1.2, -0.15, 0.9);
  setLimb(p.armR, 1.2, -0.15, 0.9);
  p.lean = Math.max(p.lean, 0.3);
}

/** Throwing arm cocked (u 0→0.5) and released (0.5→1). */
export function throwing(p: Pose, u: number, rightArmed: boolean): void {
  p.clip = undefined;
  const arm = rightArmed ? p.armR : p.armL;
  const other = rightArmed ? p.armL : p.armR;
  const k = Math.min(1, Math.max(0, u));
  if (k < 0.5) setLimb(arm, -0.6 - k * 2.2, 0.6, 1.2);
  else setLimb(arm, -1.7 + (k - 0.5) * 6, 0.3, 0.3);
  setLimb(other, 1.4, 0.4, 0.2);
  p.twist = (rightArmed ? -1 : 1) * (0.5 - k) * 0.8;
}

/**
 * Bowling action in the delivery stride. `u` runs 0 → 1 over the stride;
 * release happens at u ≈ 0.75 with the bowling arm vertical.
 */
export function bowlingAction(p: Pose, u: number, rightArmed: boolean): void {
  const k = Math.min(1, Math.max(0, u));
  const arm = rightArmed ? p.armR : p.armL;
  const lead = rightArmed ? p.armL : p.armR;
  const frontLeg = rightArmed ? p.legL : p.legR;
  const backLeg = rightArmed ? p.legR : p.legL;
  // Bowling arm: from down-and-back, over the top (π at release), and through.
  const armAngle = -0.6 + k * 4.6;
  setLimb(arm, armAngle, 0.05, 0.05);
  // Leading arm reaches up then pulls down.
  setLimb(lead, k < 0.55 ? 2.6 : 2.6 - (k - 0.55) * 5, 0.25, 0.2);
  // Gather (back leg plants), then front leg braces.
  setLimb(frontLeg, 0.55 - k * 0.3, 0.05, k < 0.5 ? 0.9 - k : 0.15);
  setLimb(backLeg, -0.35 - k * 0.2, 0.05, 0.6 + k * 0.4);
  p.lean = -0.25 + k * 0.85;
  p.twist = (rightArmed ? 1 : -1) * (0.9 - k * 1.3);
  p.drop = 0.04;
  p.bob = Math.sin(k * Math.PI) * 0.12;
}

/** Batter's stance: side-on, knees flexed, slight crouch. */
export function battingStance(p: Pose): void {
  resetPose(p);
  p.drop = 0.1;
  p.lean = 0.35;
  setLimb(p.legL, 0.15, 0.22, 0.35);
  setLimb(p.legR, -0.05, 0.22, 0.3);
}
