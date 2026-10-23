import { describe, expect, it } from 'vitest';
import { ALL_SHOTS, SHOTS, type ShotId } from '../batting/shots.ts';
import { type BatAction, type ScreenDirection, directionOf, fieldRegion, shotFromInput, sideOf } from './battingControls.ts';

const D = (x: -1 | 0 | 1, y: -1 | 0 | 1): ScreenDirection => ({ x, y });
const DOWN = -1;
const UP = 1;

describe('batting controls (Cricket 07 scheme)', () => {
  it('batter arrows: → is the off side and ← the leg side, for both hands', () => {
    expect(sideOf(1, 'right')).toBe('off');
    expect(sideOf(1, 'left')).toBe('off');
    expect(sideOf(-1, 'right')).toBe('leg');
    expect(sideOf(-1, 'left')).toBe('leg');
    expect(directionOf(D(0, DOWN), 'right')).toBe(0);
    expect(directionOf(D(1, 0), 'left')).toBe(90);
    expect(directionOf(D(1, UP), 'right')).toBe(135);
    expect(directionOf(D(-1, UP), 'left')).toBe(-135);
  });

  it('screen arrows: screen-left is the off side for a right-hander and the leg side for a left-hander', () => {
    expect(sideOf(-1, 'right', 'screen')).toBe('off');
    expect(sideOf(-1, 'left', 'screen')).toBe('leg');
    expect(sideOf(1, 'right', 'screen')).toBe('leg');
    expect(directionOf(D(0, DOWN), 'right', 'screen')).toBe(0);
    expect(directionOf(D(-1, 0), 'right', 'screen')).toBe(90);
    expect(directionOf(D(-1, DOWN), 'right', 'screen')).toBe(45);
    expect(directionOf(D(-1, UP), 'right', 'screen')).toBe(135);
    expect(directionOf(D(1, 0), 'right', 'screen')).toBe(-90);
    expect(directionOf(D(-1, 0), 'left', 'screen')).toBe(-90);
    expect(directionOf(D(0, 0), 'right', 'screen')).toBeUndefined();
  });

  it('↑→ on the back foot is the late cut to third man; ↑← is the pull (hook lofted); ↑← on the front foot the slog sweep — either hand', () => {
    for (const hand of ['right', 'left'] as const) {
      const cut = shotFromInput('back', D(1, UP), false, hand);
      expect(cut.shot).toBe('lateCut');
      expect(fieldRegion(cut)).toBe('third man');
      const pull = shotFromInput('back', D(-1, UP), false, hand);
      expect(pull.shot).toBe('pull');
      expect(['backward square leg', 'square leg', 'fine leg']).toContain(fieldRegion(pull));
      expect(shotFromInput('back', D(-1, UP), true, hand).shot).toBe('hook');
      expect(shotFromInput('back', D(-1, 0), false, hand).shot).toBe('pull');
      const slog = shotFromInput('front', D(-1, UP), false, hand);
      expect(slog.shot).toBe('slogSweep');
      expect(shotFromInput('front', D(-1, UP), true, hand).shot).toBe('slogSweep');
      expect(shotFromInput('front', D(1, DOWN), false, hand).shot).toBe('coverDrive');
    }
  });

  it('S front foot, W back foot, D use your feet, A leave; alone they defend', () => {
    expect(shotFromInput('front', D(0, 0), false, 'right')).toEqual({ shot: 'block', footwork: 'front' });
    expect(shotFromInput('back', D(0, 0), false, 'right')).toEqual({ shot: 'block', footwork: 'back' });
    expect(shotFromInput('feet', D(0, 0), false, 'right')).toEqual({ shot: 'block', footwork: 'out' });
    expect(shotFromInput('leave', D(1, 0), false, 'right').shot).toBe('leave');
    expect(shotFromInput('front', D(0, DOWN), false, 'right').shot).toBe('straightDrive');
    expect(shotFromInput('front', D(1, DOWN), false, 'right').shot).toBe('coverDrive');
    expect(shotFromInput('back', D(1, 0), false, 'right').shot).toBe('squareCut');
    expect(shotFromInput('back', D(1, UP), false, 'right').shot).toBe('lateCut');
    expect(shotFromInput('back', D(-1, 0), false, 'right').shot).toBe('pull');
    expect(shotFromInput('front', D(-1, 0), false, 'right').shot).toBe('flick');
    expect(shotFromInput('front', D(0, UP), false, 'right').shot).toBe('sweep');
    expect(shotFromInput('back', D(0, UP), false, 'right').shot).toBe('legGlance');
    expect(shotFromInput('feet', D(0, DOWN), false, 'right')).toEqual({ shot: 'straightDrive', footwork: 'out' });
    // The screen scheme mirrors for a right-hander.
    expect(shotFromInput('front', D(-1, DOWN), false, 'right', 'screen').shot).toBe('coverDrive');
  });

  it('Shift lofts the shot: lofted drive, slog sweep, reverse sweep, hook, and lofted shots aimed where pressed', () => {
    expect(shotFromInput('front', D(0, DOWN), true, 'right').shot).toBe('loftedDrive');
    expect(shotFromInput('front', D(-1, UP), true, 'right').shot).toBe('slogSweep');
    expect(shotFromInput('front', D(1, UP), true, 'right').shot).toBe('reverseSweep');
    expect(shotFromInput('back', D(-1, UP), true, 'right').shot).toBe('hook');
    const rh = shotFromInput('front', D(1, DOWN), true, 'right');
    const lh = shotFromInput('front', D(1, DOWN), true, 'left');
    expect(rh.shot).toBe('loftedAttack');
    // → is the off side for both.
    expect(rh.aimDeg ?? 0).toBeGreaterThan(0);
    expect(lh.aimDeg ?? 0).toBeGreaterThan(0);
    const screen = shotFromInput('front', D(-1, DOWN), true, 'left', 'screen');
    expect(screen.aimDeg ?? 0).toBeLessThan(0);
  });

  const all = (f: (a: BatAction, d: ScreenDirection, lofted: boolean) => void) => {
    for (const action of ['front', 'back', 'feet', 'leave'] as const) {
      for (const x of [-1, 0, 1] as const) {
        for (const y of [-1, 0, 1] as const) {
          for (const lofted of [false, true]) f(action, D(x, y), lofted);
        }
      }
    }
  };

  it('every stroke is reachable from the keyboard', () => {
    const reached = new Set<ShotId>();
    all((a, d, l) => reached.add(shotFromInput(a, d, l, 'right').shot));
    expect([...reached].sort()).toEqual([...ALL_SHOTS].sort());
  });

  it('never asks for footwork a stroke does not have', () => {
    all((a, d, l) => {
      const s = shotFromInput(a, d, l, 'right');
      expect(SHOTS[s.shot].footwork.includes(s.footwork)).toBe(true);
    });
  });
});

describe('where the shot goes', () => {
  it('names a region all round the ground, and every region is reachable from the keys', () => {
    expect(fieldRegion(shotFromInput('front', D(1, DOWN), false, 'right'))).toBe('cover');
    expect(fieldRegion(shotFromInput('front', D(1, DOWN), false, 'left'))).toBe('cover');
    expect(fieldRegion(shotFromInput('front', D(-1, DOWN), false, 'left', 'screen'))).toBe('mid-on');
    expect(fieldRegion(shotFromInput('back', D(1, UP), false, 'right'))).toBe('third man');
    expect(fieldRegion(shotFromInput('front', D(0, UP), false, 'right'))).toBe('fine leg');
    expect(fieldRegion(shotFromInput('front', D(-1, DOWN), false, 'right'))).toBe('mid-on');
    expect(fieldRegion(shotFromInput('front', D(0, DOWN), true, 'right'))).toBe('straight, over the bowler');
    const reached = new Set<string>();
    for (const a of ['front', 'back', 'feet'] as const)
      for (const x of [-1, 0, 1] as const)
        for (const y of [-1, 0, 1] as const) for (const l of [false, true]) reached.add(fieldRegion(shotFromInput(a, D(x, y), l, 'right')));
    for (const r of ['straight', 'mid-off', 'cover', 'point', 'third man', 'fine leg', 'square leg', 'midwicket', 'mid-on', 'long-off', 'long-on', 'deep cover', 'deep midwicket'])
      expect(reached.has(r), r).toBe(true);
  });
});
