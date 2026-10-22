import { describe, expect, it } from 'vitest';
import { CHASE_CAMERAS, MAIN_CAMERA, STROKE_HOLD, TIGHT, WIDE, chaseCamera, direct, frameBetween, type DirectorInput, type Shot, type Vec } from './director.ts';
import { BOWLER_STUMPS_Z, STRIKER_STUMPS_Z } from '../../data/field.ts';

/** Where `p` appears in the shot, vertically: 0 the foot of the frame, 1 the top (outside 0–1: out of frame). */
function screenY(s: Shot, p: Vec): number {
  const dip = (q: Vec) => Math.atan2(s.pos.y - q.y, Math.hypot(q.x - s.pos.x, q.z - s.pos.z));
  const half = (s.fov * Math.PI) / 360;
  return 0.5 + (dip(s.look) - dip(p)) / (2 * half);
}

const base: DirectorInput = {
  phase: 'runUp',
  time: 0,
  releaseTime: 1.7,
  contactTime: undefined,
  stumpsTime: undefined,
  ball: undefined,
  chaser: undefined,
  previous: undefined,
};

describe('camera director', () => {
  it('between balls, holds the wide shot from behind the bowler', () => {
    const s = direct({ ...base, phase: undefined });
    expect(s.name).toBe('wide');
    expect(s.fov).toBe(WIDE.fov);
  });

  it('frames the bowler from the top of his mark: he stays in the picture, with the batter, all the way in', () => {
    const batter = { x: 0, y: 1.8, z: STRIKER_STUMPS_Z };
    let prev: Shot | undefined;
    for (let t = 0; t <= 2.35; t += 0.05) {
      const z = BOWLER_STUMPS_Z - 18 + (19 * t) / 2.35;
      const bowler = { x: -1.4, y: 0, z };
      const s = direct({ ...base, time: t, releaseTime: 2.35, bowler, previous: prev ? 'runUp' : 'closeUp' });
      expect(s.name).toBe('runUp');
      expect(s.cut).toBe(prev === undefined);
      expect(s.pos).toEqual(MAIN_CAMERA);
      // Feet and head of the bowler, and the batter, all in frame.
      for (const y of [0, 1.9]) {
        const v = screenY(s, { ...bowler, y });
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThan(1);
      }
      expect(screenY(s, bowler)).toBeLessThan(0.25);
      expect(screenY(s, batter)).toBeGreaterThan(0.6);
      expect(screenY(s, batter)).toBeLessThan(1);
      // The zoom only tightens as he comes in.
      if (prev) expect(s.fov).toBeLessThanOrEqual(prev.fov + 1e-9);
      prev = s;
    }
    // A broadcast long lens: wide-ish at the top of the mark, tight by release.
    expect(direct({ ...base, time: 0, bowler: { x: 0, y: 0, z: BOWLER_STUMPS_Z - 18 } }).fov).toBeGreaterThan(9);
    expect(prev?.fov ?? 99).toBeLessThan(7);
    expect(TIGHT.fov).toBeLessThan(7);
  });

  it('frameBetween puts the low point at the foot of the frame and the high point at the top', () => {
    const cam = { x: 0, y: 10, z: -50 };
    const low = { x: 0, y: 0, z: -20 };
    const high = { x: 0, y: 2, z: 10 };
    const f = frameBetween(cam, low, high, { bottom: 0.1, top: 0.1 });
    const s: Shot = { name: 'runUp', pos: cam, look: f.look, fov: f.fov, cut: false, ease: 1 };
    expect(screenY(s, low)).toBeCloseTo(0.1, 5);
    expect(screenY(s, high)).toBeCloseTo(0.9, 5);
  });

  it('a human bowler: from the aiming view, a cut to the main camera as he runs in', () => {
    const s = direct({ ...base, time: 0, humanBowling: true, previous: 'aim', bowler: { x: 1, y: 0, z: BOWLER_STUMPS_Z - 15 } });
    expect(s.cut).toBe(true);
    expect(s.pos).toEqual(MAIN_CAMERA);
  });

  it('shows the stroke, then cuts to a chase camera that frames the ball and fielder', () => {
    const ball = { x: 18, y: 0.5, z: -10 };
    const stroke = direct({ ...base, phase: 'struck', time: 3, contactTime: 3 - STROKE_HOLD / 2, ball, previous: 'delivery' });
    expect(stroke.name).toBe('stroke');
    const chase = direct({ ...base, phase: 'struck', time: 4, contactTime: 3, ball, chaser: { x: 25, y: 0, z: -14 }, previous: 'stroke' });
    expect(chase.name).toBe('chase');
    expect(chase.cut).toBe(true);
    // Camera on the opposite side of the ground to the ball, looking between ball and fielder.
    expect(Math.sign(chase.pos.x)).toBe(-1);
    expect(chase.look.x).toBeCloseTo(21.5, 5);
    const steady = direct({ ...base, phase: 'struck', time: 4.1, contactTime: 3, ball, chaser: { x: 25, y: 0, z: -14 }, previous: 'chase' });
    expect(steady.cut).toBe(false);
  });

  it('cuts to the stumps when the wicket is broken', () => {
    const s = direct({ ...base, phase: 'dead', time: 3, stumpsTime: 2.5, ball: { x: 0, y: 0.3, z: STRIKER_STUMPS_Z }, previous: 'delivery' });
    expect(s.name).toBe('stumps');
    expect(s.cut).toBe(true);
    expect(s.look.z).toBeCloseTo(STRIKER_STUMPS_Z, 5);
  });

  it('stays tight on a ball that is left, missed or padded', () => {
    const s = direct({ ...base, phase: 'dead', time: 2.6, ball: { x: 0.2, y: 0.8, z: STRIKER_STUMPS_Z + 1 } });
    expect(s.name).toBe('delivery');
  });

  it('television: a long-lens close-up of the batter between balls, then a cut to the main camera as the bowler runs in', () => {
    const close = direct({ ...base, phase: undefined, subject: { x: -0.45, y: 0, z: 9.3 }, previous: 'chase' });
    expect(close.name).toBe('closeUp');
    expect(close.cut).toBe(true);
    expect(close.fov).toBeLessThan(5);
    const run = direct({ ...base, time: 0, previous: 'closeUp' });
    expect(run.name).toBe('runUp');
    expect(run.cut).toBe(true);
    // The main camera is far back and high: a broadcast long lens.
    expect(WIDE.pos.z).toBeLessThan(-70);
    expect(TIGHT.fov).toBeLessThan(7);
  });

  it('chases from the fixed camera looking across at the ball, and stays on it', () => {
    expect(chaseCamera({ x: 30, y: 0, z: -5 })).toBe('squareMinus');
    expect(chaseCamera({ x: -30, y: 0, z: -5 })).toBe('squarePlus');
    expect(chaseCamera({ x: 2, y: 0, z: -40 })).toBe('reverse');
    expect(chaseCamera({ x: 20, y: 0, z: 20 })).toBe('main');
    const first = direct({ ...base, phase: 'struck', time: 4, contactTime: 3, ball: { x: 30, y: 1, z: -5 }, previous: 'stroke' });
    expect(first.cam).toBe('squareMinus');
    expect(first.pos).toEqual(CHASE_CAMERAS.squareMinus);
    // The ball runs on behind square: the director stays on the same camera.
    const later = direct({ ...base, phase: 'struck', time: 5, contactTime: 3, ball: { x: 30, y: 0.1, z: 15 }, previous: 'chase', previousCam: first.cam });
    expect(later.cam).toBe('squareMinus');
  });
});
