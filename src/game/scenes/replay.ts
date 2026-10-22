import { Vector3 } from 'three';
import type { LimbPose, Pose } from './rig/Humanoid.tsx';

/**
 * Action replays. While a ball is live, every view writes what it drew into
 * the current frame: the ball, every player's pose (by id), the two bats and
 * the two sets of stumps. After a wicket or a boundary the same views read
 * frames back instead of the live match, slowed down, with a replay camera.
 * Recording is cheap (a few hundred numbers per frame) and needs no
 * re-simulation, so a replay always shows exactly what happened.
 */
export interface PoseSnap {
  readonly n: readonly number[];
  readonly handL: readonly number[] | undefined;
  readonly handR: readonly number[] | undefined;
  readonly look: readonly number[] | undefined;
  readonly clip: { readonly name: NonNullable<Pose['clip']>['name']; readonly time: number } | undefined;
  readonly grip: number | undefined;
}

export interface ReplayFrame {
  /** Simulation time of the ball (seconds since the start of the run-up). */
  readonly t: number;
  ball: readonly number[];
  ballVisible: boolean;
  readonly poses: Map<string, PoseSnap>;
  bats: (readonly number[] | undefined)[];
  wickets: (readonly number[] | undefined)[];
}

const limb = (l: LimbPose) => [l.pitch, l.roll, l.bend];

export function snapPose(p: Pose): PoseSnap {
  return {
    n: [p.x, p.z, p.facing, p.drop, p.bob, p.lean, p.twist, p.tilt, ...limb(p.armL), ...limb(p.armR), ...limb(p.legL), ...limb(p.legR)],
    handL: p.handL ? p.handL.toArray() : undefined,
    handR: p.handR ? p.handR.toArray() : undefined,
    look: p.look ? p.look.toArray() : undefined,
    clip: p.clip ? { name: p.clip.name, time: p.clip.time } : undefined,
    grip: p.grip,
  };
}

const setLimb = (l: LimbPose, n: readonly number[], i: number) => {
  l.pitch = n[i] ?? 0;
  l.roll = n[i + 1] ?? 0;
  l.bend = n[i + 2] ?? 0;
};

/** Writes a snapshot back into a pose (reusing its vectors). */
export function restorePose(s: PoseSnap, p: Pose, vectors: { handL: Vector3; handR: Vector3; look: Vector3 }): Pose {
  const n = s.n;
  p.x = n[0] ?? 0;
  p.z = n[1] ?? 0;
  p.facing = n[2] ?? 0;
  p.drop = n[3] ?? 0;
  p.bob = n[4] ?? 0;
  p.lean = n[5] ?? 0;
  p.twist = n[6] ?? 0;
  p.tilt = n[7] ?? 0;
  setLimb(p.armL, n, 8);
  setLimb(p.armR, n, 11);
  setLimb(p.legL, n, 14);
  setLimb(p.legR, n, 17);
  p.handL = s.handL ? vectors.handL.fromArray(s.handL) : undefined;
  p.handR = s.handR ? vectors.handR.fromArray(s.handR) : undefined;
  p.look = s.look ? vectors.look.fromArray(s.look) : undefined;
  p.clip = s.clip ? { name: s.clip.name, time: s.clip.time } : undefined;
  p.grip = s.grip;
  return p;
}

export type ReplayKind = 'bowled' | 'lbw' | 'caught' | 'runOut' | 'stumped' | 'boundary';

export class ReplayRecorder {
  frames: ReplayFrame[] = [];
  /** The frame being written this render frame (undefined when not recording). */
  current: ReplayFrame | undefined;
  playing = false;
  playT = 0;
  startT = 0;
  endT = 0;
  kind: ReplayKind = 'boundary';
  /** The striker's off side (+1 right-hander), for camera placement. */
  off: 1 | -1 = 1;
  /** Cycle time of contact (if any), for the camera. */
  contactT: number | undefined;
  private cycle: unknown;
  /** Ids of everyone recorded (so the right players are drawn). */
  readonly ids = new Set<string>();

  /** Called first each render frame. */
  beginFrame(cycle: unknown, t: number | undefined): void {
    if (this.playing) {
      this.current = undefined;
      return;
    }
    if (cycle && cycle !== this.cycle) {
      this.cycle = cycle;
      this.frames = [];
      this.ids.clear();
    }
    if (!cycle || t === undefined) {
      this.current = undefined;
      return;
    }
    const last = this.frames[this.frames.length - 1];
    if (last && Math.abs(last.t - t) < 1e-6) {
      // Paused or no progress: keep writing into the same frame.
      this.current = last;
      return;
    }
    this.current = { t, ball: [0, 0, 0], ballVisible: false, poses: new Map(), bats: [undefined, undefined], wickets: [undefined, undefined] };
    this.frames.push(this.current);
    if (this.frames.length > 2400) this.frames.shift();
  }

  pose(id: string, p: Pose): void {
    if (!this.current) return;
    this.current.poses.set(id, snapPose(p));
    this.ids.add(id);
  }

  start(kind: ReplayKind, startT: number, endT: number, off: 1 | -1, contactT: number | undefined): boolean {
    const first = this.frames[0];
    const last = this.frames[this.frames.length - 1];
    if (!first || !last) return false;
    this.kind = kind;
    this.startT = Math.max(first.t, startT);
    this.endT = Math.min(last.t, endT);
    if (this.endT - this.startT < 0.3) return false;
    this.playT = this.startT;
    this.off = off;
    this.contactT = contactT;
    this.playing = true;
    return true;
  }

  stop(): void {
    this.playing = false;
  }

  /** The recorded frame nearest to (at or before) time t. */
  frameAt(t: number): ReplayFrame | undefined {
    const f = this.frames;
    let lo = 0;
    let hi = f.length - 1;
    if (hi < 0) return undefined;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((f[mid]?.t ?? 0) <= t) lo = mid;
      else hi = mid - 1;
    }
    return f[lo];
  }
}

export const replayVectors = () => ({ handL: new Vector3(), handR: new Vector3(), look: new Vector3() });
