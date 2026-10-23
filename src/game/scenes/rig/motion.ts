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
  p.poleL = undefined;
  p.poleR = undefined;
  p.clip = undefined;
  p.armLayer = undefined;
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
 * Bowling actions, keyframed against the moment of release (τ = seconds
 * from release, negative before). The sequence is the real one: a bound off
 * the last running stride with the ball at the chin and the front arm
 * reaching up; back foot lands side-on; the bowling arm swings down, back
 * and up behind, comes OVER THE TOP and releases just past vertical as the
 * front leg braces and the front arm pulls down; then the arm sweeps down
 * across the body, the back leg drives through and the trunk bends over in
 * the follow-through.
 *
 * Arm pitch: 0 hanging, π/2 forward, π straight up, −π/2 behind. The bowling
 * arm turns backwards-over (pitch decreasing): down → behind → up → front →
 * down, a full circle, which is what makes a bowling action read as one.
 *
 * Values are for a right-armer; a left-armer mirrors limbs, twist and tilt.
 */
export type ActionKind = 'pace' | 'medium' | 'offSpin' | 'legSpin';

type Key = readonly [tau: number, value: number];
type Track = readonly Key[];
interface LimbTracks {
  readonly pitch: Track;
  readonly roll: Track;
  readonly bend: Track;
}
interface ActionTracks {
  readonly arm: LimbTracks;
  readonly lead: LimbTracks;
  readonly front: LimbTracks;
  readonly back: LimbTracks;
  readonly lean: Track;
  readonly twist: Track;
  readonly tilt: Track;
  readonly bob: Track;
  readonly drop: Track;
}

/** Piecewise interpolation with eased segments (smoothstep), held at the ends. */
export function sampleTrack(track: Track, tau: number): number {
  const first = track[0];
  if (!first) return 0;
  if (tau <= first[0]) return first[1];
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1];
    const b = track[i];
    if (!a || !b) break;
    if (tau <= b[0]) {
      const u = (tau - a[0]) / Math.max(1e-6, b[0] - a[0]);
      const k = u * u * (3 - 2 * u);
      return a[1] + (b[1] - a[1]) * k;
    }
  }
  return track[track.length - 1]?.[1] ?? 0;
}

const PACE: ActionTracks = {
  arm: {
    pitch: [[-0.55, 1.1], [-0.38, 1.3], [-0.24, -0.4], [-0.12, -1.6], [-0.04, -2.6], [0, -3.3], [0.08, -4.3], [0.2, -5.6], [0.45, -6.0], [0.75, -6.2]],
    roll: [[-0.55, 0.2], [-0.38, 0.15], [-0.12, 0.12], [0, 0.0], [0.2, -0.55], [0.45, -0.4], [0.75, 0.08]],
    bend: [[-0.55, 1.9], [-0.38, 1.6], [-0.24, 0.3], [-0.12, 0.08], [0.08, 0.08], [0.2, 0.3], [0.45, 0.5], [0.75, 0.3]],
  },
  lead: {
    pitch: [[-0.55, 1.6], [-0.38, 2.6], [-0.12, 2.5], [0, 0.9], [0.15, -0.4], [0.45, 0.1], [0.75, 0.2]],
    roll: [[-0.55, 0.2], [-0.38, 0.1], [0, 0.3], [0.15, 0.4], [0.75, 0.15]],
    bend: [[-0.55, 1.2], [-0.38, 0.3], [-0.12, 0.2], [0, 0.8], [0.15, 1.2], [0.45, 0.8], [0.75, 0.5]],
  },
  front: {
    pitch: [[-0.55, 0.9], [-0.38, 0.8], [-0.24, 0.7], [-0.1, 0.55], [0, 0.35], [0.15, 0.1], [0.35, -0.3], [0.6, -0.1], [0.75, 0.1]],
    roll: [[-0.55, 0.05], [0.75, 0.05]],
    bend: [[-0.55, 1.3], [-0.38, 1.1], [-0.24, 0.9], [-0.1, 0.3], [0, 0.12], [0.15, 0.4], [0.35, 0.6], [0.75, 0.3]],
  },
  back: {
    pitch: [[-0.55, -0.3], [-0.38, -0.1], [-0.24, 0.15], [-0.1, -0.25], [0, -0.55], [0.15, 0.5], [0.35, 0.6], [0.6, 0.2], [0.75, 0.0]],
    roll: [[-0.55, 0.05], [0.75, 0.05]],
    bend: [[-0.55, 0.4], [-0.38, 1.2], [-0.24, 0.45], [-0.1, 0.5], [0, 0.5], [0.15, 1.0], [0.35, 0.4], [0.75, 0.3]],
  },
  lean: [[-0.55, 0.15], [-0.38, 0.0], [-0.24, -0.15], [-0.1, -0.05], [0, 0.12], [0.15, 0.8], [0.35, 0.6], [0.75, 0.3]],
  twist: [[-0.55, -0.3], [-0.38, -0.8], [-0.24, -1.2], [-0.1, -0.9], [0, -0.15], [0.15, 0.5], [0.35, 0.7], [0.75, 0.3]],
  tilt: [[-0.55, 0], [-0.24, 0.1], [-0.1, -0.08], [0, -0.18], [0.15, -0.12], [0.4, 0], [0.75, 0]],
  bob: [[-0.55, 0.04], [-0.38, 0.28], [-0.24, 0.0], [0, 0.0], [0.75, 0.0]],
  drop: [[-0.55, 0.04], [-0.24, 0.08], [-0.1, 0.02], [0, 0.0], [0.15, 0.16], [0.35, 0.1], [0.75, 0.04]],
};

const scaleTrack = (t: Track, k: number): Track => t.map(([tau, v]) => [tau, v * k] as const);
const timeTrack = (t: Track, k: number): Track => t.map(([tau, v]) => [tau * k, v] as const);
const timeLimb = (l: LimbTracks, k: number): LimbTracks => ({ pitch: timeTrack(l.pitch, k), roll: timeTrack(l.roll, k), bend: timeTrack(l.bend, k) });

/** Medium pace: the same shape, a smaller bound and a slightly slower arm. */
const MEDIUM: ActionTracks = {
  ...PACE,
  arm: timeLimb(PACE.arm, 1.08),
  lead: timeLimb(PACE.lead, 1.08),
  bob: scaleTrack(PACE.bob, 0.65),
  twist: scaleTrack(PACE.twist, 0.9),
};

/** Off-spin: a short hop, very upright, a high arm, and a big pivot round the front leg. */
const OFF_SPIN: ActionTracks = {
  arm: {
    pitch: [[-0.48, 1.2], [-0.32, 1.5], [-0.2, -0.3], [-0.1, -1.6], [-0.03, -2.7], [0, -3.22], [0.1, -4.2], [0.25, -5.5], [0.5, -6.0], [0.7, -6.2]],
    roll: [[-0.48, 0.2], [-0.32, 0.15], [-0.1, 0.1], [0, 0.0], [0.25, -0.6], [0.5, -0.3], [0.7, 0.08]],
    bend: [[-0.48, 1.7], [-0.32, 1.4], [-0.2, 0.3], [-0.1, 0.1], [0.1, 0.12], [0.25, 0.4], [0.5, 0.6], [0.7, 0.3]],
  },
  lead: {
    pitch: [[-0.48, 1.5], [-0.32, 2.4], [-0.1, 2.3], [0, 1.0], [0.2, -0.2], [0.5, 0.2], [0.7, 0.2]],
    roll: [[-0.48, 0.2], [0, 0.35], [0.2, 0.4], [0.7, 0.15]],
    bend: [[-0.48, 1.0], [-0.32, 0.3], [0, 0.9], [0.2, 1.1], [0.7, 0.5]],
  },
  front: {
    pitch: [[-0.48, 0.7], [-0.32, 0.6], [-0.2, 0.55], [-0.08, 0.45], [0, 0.3], [0.2, 0.1], [0.45, -0.15], [0.7, 0.05]],
    roll: [[-0.48, 0.05], [0.7, 0.05]],
    bend: [[-0.48, 1.0], [-0.32, 0.9], [-0.2, 0.6], [-0.08, 0.2], [0, 0.15], [0.2, 0.35], [0.45, 0.5], [0.7, 0.3]],
  },
  back: {
    pitch: [[-0.48, -0.2], [-0.32, -0.05], [-0.2, 0.1], [-0.08, -0.2], [0, -0.45], [0.2, 0.45], [0.45, 0.35], [0.7, 0.05]],
    roll: [[-0.48, 0.05], [0.7, 0.05]],
    bend: [[-0.48, 0.4], [-0.32, 0.9], [-0.2, 0.4], [0, 0.45], [0.2, 0.9], [0.45, 0.4], [0.7, 0.3]],
  },
  lean: [[-0.48, 0.1], [-0.32, 0.0], [-0.2, -0.05], [0, 0.1], [0.2, 0.55], [0.45, 0.45], [0.7, 0.2]],
  twist: [[-0.48, -0.3], [-0.32, -0.9], [-0.2, -1.3], [-0.08, -0.9], [0, 0.0], [0.2, 0.9], [0.45, 0.6], [0.7, 0.2]],
  tilt: [[-0.48, 0], [-0.2, 0.1], [0, -0.16], [0.2, -0.08], [0.45, 0], [0.7, 0]],
  bob: [[-0.48, 0.03], [-0.32, 0.13], [-0.2, 0.0], [0.7, 0.0]],
  drop: [[-0.48, 0.03], [-0.2, 0.06], [0, 0.0], [0.2, 0.12], [0.45, 0.08], [0.7, 0.03]],
};

/** Leg-spin: like the off-spinner but more shoulder: a bigger coil and a bigger rotation through. */
const LEG_SPIN: ActionTracks = {
  ...OFF_SPIN,
  twist: scaleTrack(OFF_SPIN.twist, 1.2),
  tilt: scaleTrack(OFF_SPIN.tilt, 0.7),
  bob: scaleTrack(OFF_SPIN.bob, 1.2),
};

const ACTIONS: Readonly<Record<ActionKind, ActionTracks>> = { pace: PACE, medium: MEDIUM, offSpin: OFF_SPIN, legSpin: LEG_SPIN };

/** When the action starts and finishes, seconds from release. */
export function actionSpan(kind: ActionKind): { start: number; end: number } {
  const t = ACTIONS[kind].arm.pitch;
  return { start: t[0]?.[0] ?? -0.5, end: t[t.length - 1]?.[0] ?? 0.7 };
}

/** Bowling arm pitch at τ (for the ball in hand and tests). */
export const armPitchAt = (kind: ActionKind, tau: number): number => sampleTrack(ACTIONS[kind].arm.pitch, tau);

const setTracks = (l: LimbPose, t: LimbTracks, tau: number) => setLimb(l, sampleTrack(t.pitch, tau), sampleTrack(t.roll, tau), sampleTrack(t.bend, tau));

/** Poses the delivery stride at τ seconds from release. */
export function bowlingAction(p: Pose, tau: number, kind: ActionKind, rightArmed: boolean): void {
  const a = ACTIONS[kind];
  p.clip = undefined;
  setTracks(rightArmed ? p.armR : p.armL, a.arm, tau);
  setTracks(rightArmed ? p.armL : p.armR, a.lead, tau);
  setTracks(rightArmed ? p.legL : p.legR, a.front, tau);
  setTracks(rightArmed ? p.legR : p.legL, a.back, tau);
  const m = rightArmed ? 1 : -1;
  p.lean = sampleTrack(a.lean, tau);
  p.twist = m * sampleTrack(a.twist, tau);
  p.tilt = m * sampleTrack(a.tilt, tau);
  p.bob = sampleTrack(a.bob, tau);
  p.drop = sampleTrack(a.drop, tau);
  p.handL = undefined;
  p.handR = undefined;
  p.grip = 0.5;
}

/** Batter's stance: side-on, knees flexed, slight crouch. */
export function battingStance(p: Pose): void {
  resetPose(p);
  // Knees flexed, feet a little wider than the shoulders, weight on the balls of the feet.
  p.drop = 0.13;
  p.lean = 0.38;
  setLimb(p.legL, 0.2, 0.26, 0.5);
  setLimb(p.legR, -0.08, 0.26, 0.42);
}

/**
 * Picking the ball up off the ground: down low, knees bent, weight forward,
 * both hands reaching to the ball in front of the feet. `u` 0 → 1 going
 * down, staying down at 1.
 */
export function pickUp(p: Pose, u: number): void {
  const k = Math.min(1, Math.max(0, u));
  p.clip = undefined;
  p.handL = undefined;
  p.handR = undefined;
  p.lean = 0.35 + 0.75 * k;
  p.drop = 0.05 + 0.3 * k;
  p.twist = 0;
  p.tilt = 0;
  setLimb(p.legL, 0.2 + 0.7 * k, 0.12, 0.3 + 0.9 * k);
  setLimb(p.legR, -0.1 - 0.3 * k, 0.12, 0.3 + 0.7 * k);
  setLimb(p.armL, 0.3 + 0.5 * k, 0.12, 0.3);
  setLimb(p.armR, 0.3 + 0.5 * k, 0.12, 0.3);
  p.grip = 0.4;
}

/**
 * An overarm throw, keyed to the release (τ seconds, negative before):
 * gather at the chest, turn side-on with the front arm pointing at the
 * target and the ball cocked behind the head, stride, whip the arm over the
 * top, release in front, and follow through across the body.
 */
const THROW: { arm: LimbTracks; lead: LimbTracks; front: LimbTracks; back: LimbTracks; lean: Track; twist: Track } = {
  arm: {
    pitch: [[-0.45, 1.2], [-0.3, -1.0], [-0.12, -2.2], [-0.04, -3.2], [0, -3.9], [0.2, -5.0], [0.45, -5.9]],
    roll: [[-0.45, 0.1], [-0.3, 0.9], [-0.12, 0.6], [0, 0.3], [0.2, -0.4], [0.45, 0]],
    bend: [[-0.45, 1.5], [-0.3, 1.3], [-0.12, 1.4], [-0.04, 0.9], [0, 0.4], [0.2, 0.4], [0.45, 0.3]],
  },
  lead: {
    pitch: [[-0.45, 1.2], [-0.3, 1.6], [-0.08, 1.5], [0, 0.4], [0.2, -0.2], [0.45, 0.1]],
    roll: [[-0.45, 0.1], [-0.3, 0.2], [0, 0.4], [0.45, 0.15]],
    bend: [[-0.45, 1.2], [-0.3, 0.3], [0, 1.0], [0.45, 0.5]],
  },
  front: {
    pitch: [[-0.45, 0.1], [-0.3, 0.45], [-0.08, 0.5], [0, 0.35], [0.2, 0.1], [0.45, 0]],
    roll: [[-0.45, 0.05], [0.45, 0.05]],
    bend: [[-0.45, 0.3], [-0.3, 0.5], [-0.08, 0.3], [0, 0.2], [0.45, 0.25]],
  },
  back: {
    pitch: [[-0.45, -0.1], [-0.3, -0.3], [-0.08, -0.35], [0, -0.3], [0.2, 0.4], [0.45, 0.1]],
    roll: [[-0.45, 0.05], [0.45, 0.05]],
    bend: [[-0.45, 0.3], [-0.3, 0.4], [0, 0.5], [0.2, 0.8], [0.45, 0.3]],
  },
  lean: [[-0.45, 0.3], [-0.3, -0.1], [-0.08, 0.0], [0, 0.4], [0.2, 0.6], [0.45, 0.3]],
  twist: [[-0.45, 0], [-0.3, -0.9], [-0.08, -0.6], [0, 0.4], [0.2, 0.6], [0.45, 0.2]],
};

/** Span of the throwing action around release, seconds. */
export const THROW_SPAN = { start: -0.45, end: 0.45 } as const;

export function throwAction(p: Pose, tau: number, rightArmed: boolean): void {
  p.clip = undefined;
  p.handL = undefined;
  p.handR = undefined;
  setTracks(rightArmed ? p.armR : p.armL, THROW.arm, tau);
  setTracks(rightArmed ? p.armL : p.armR, THROW.lead, tau);
  setTracks(rightArmed ? p.legL : p.legR, THROW.front, tau);
  setTracks(rightArmed ? p.legR : p.legL, THROW.back, tau);
  const m = rightArmed ? 1 : -1;
  p.lean = sampleTrack(THROW.lean, tau);
  p.twist = m * sampleTrack(THROW.twist, tau);
  p.tilt = 0;
  p.drop = 0.06;
  p.bob = 0;
  p.grip = tau < 0 ? 0.6 : 0.1;
}

// --- Moments between balls --------------------------------------------------------------------

/** Polishing the ball on the trousers, walking back to the mark (layered on the walk clip). */
export function polishBall(p: Pose, rightArmed: boolean, t: number): void {
  const arm = rightArmed ? p.armR : p.armL;
  setLimb(arm, 0.12 + Math.sin(t * 9) * 0.1, 0.06, 1.2 + Math.sin(t * 9) * 0.15);
  p.armLayer = rightArmed ? 'R' : 'L';
  p.grip = 0.6;
}

/** Directing a fielder: the arm out to the side pointing, with a wave to move him on. */
export function pointField(p: Pose, rightArmed: boolean, t: number): void {
  const arm = rightArmed ? p.armR : p.armL;
  setLimb(arm, 1.05 + Math.sin(t * 5) * 0.12, 0.85, 0.15 + Math.max(0, Math.sin(t * 5)) * 0.35);
  p.armLayer = rightArmed ? 'R' : 'L';
}

/** An appeal: both arms flung up, leaning back towards the umpire. */
export function appeal(p: Pose, t: number): void {
  resetPose(p);
  p.lean = -0.12;
  setLimb(p.armL, 2.75 + Math.sin(t * 6) * 0.08, 0.35, 0.15);
  setLimb(p.armR, 2.75 + Math.sin(t * 6 + 1) * 0.08, 0.35, 0.15);
  setLimb(p.legL, 0.1, 0.05, 0.1);
}

/** Raising the bat to the crowd (and, for a hundred, the other arm wide). */
export function raiseBat(p: Pose, batInRight: boolean, t: number, hundred: boolean): void {
  resetPose(p);
  const bat = batInRight ? p.armR : p.armL;
  const other = batInRight ? p.armL : p.armR;
  setLimb(bat, 2.8 + Math.sin(t * 2.4) * 0.06, 0.25, 0.3);
  if (hundred) setLimb(other, 1.9, 1.1, 0.2);
  else setLimb(other, 0.3, 0.12, 0.5);
  p.lean = -0.05;
  p.grip = 1;
}

/**
 * Taking guard: bat held upright on the crease in front of him, a couple of
 * taps to mark it. `tap` 0–1 through the routine.
 */
export function takeGuard(p: Pose, tap: number): void {
  resetPose(p);
  p.lean = 0.28;
  p.drop = 0.05;
  setLimb(p.armL, 0.55, 0.05, 0.75 + Math.abs(Math.sin(tap * Math.PI * 4)) * 0.12);
  setLimb(p.armR, 0.55, 0.05, 0.75 + Math.abs(Math.sin(tap * Math.PI * 4)) * 0.12);
  setLimb(p.legL, 0.05, 0.08, 0.1);
  setLimb(p.legR, 0.05, 0.08, 0.1);
  p.grip = 1;
}
