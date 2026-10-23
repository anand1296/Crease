import { afterEach, describe, expect, it, vi } from 'vitest';
import { GamepadInput, PAD, PAD_KEYS, type PadContext, arrowsOf, nearestInDirection } from './gamepad.ts';
import { type GameAction, KeyboardInput } from './keyboard.ts';

const pad = (pressed: number[] = [], axes: number[] = [0, 0]) => ({
  connected: true,
  axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
});

function rig(context: PadContext) {
  const kb = new KeyboardInput();
  const actions: GameAction[] = [];
  kb.onPress = (a) => actions.push(a);
  let ctx = context;
  const input = new GamepadInput(kb, () => ctx);
  let state = pad();
  vi.stubGlobal('navigator', { getGamepads: () => [state] });
  return {
    kb,
    actions,
    input,
    set: (p: ReturnType<typeof pad>) => {
      state = p;
      input.poll(0);
    },
    context: (c: PadContext) => {
      ctx = c;
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('game controller', () => {
  it('reads the stick and the d-pad as arrows, diagonals included', () => {
    expect([...arrowsOf(pad([], [0.9, -0.8]))].sort()).toEqual(['ArrowRight', 'ArrowUp']);
    expect([...arrowsOf(pad([PAD.left, PAD.down]))].sort()).toEqual(['ArrowDown', 'ArrowLeft']);
    expect(arrowsOf(pad([], [0.3, 0.2])).size).toBe(0);
  });

  it('batting: A front foot, X back foot, Y feet, B leave, RT lofted, LB / RB shuffle', () => {
    const r = rig('bat');
    r.set(pad([PAD.rt], [0.9, -0.9]));
    expect(r.kb.isHeld('lofted')).toBe(true);
    expect(r.kb.direction()).toEqual({ x: 1, y: 1 });
    r.set(pad([PAD.rt, PAD.a], [0.9, -0.9]));
    expect(r.actions).toContain('shotFront');
    r.set(pad([PAD.x]));
    r.set(pad([PAD.y]));
    r.set(pad([PAD.b]));
    r.set(pad([PAD.lb]));
    r.set(pad([PAD.rb]));
    expect(r.actions).toEqual(expect.arrayContaining(['shotBack', 'shotFeet', 'leave', 'prevDelivery', 'nextDelivery']));
    r.set(pad());
    expect(r.kb.isHeld('lofted')).toBe(false);
    expect(r.kb.direction()).toEqual({ x: 0, y: 0 });
  });

  it('a held button lets go of the key it pressed, even if the context changed meanwhile', () => {
    const r = rig('bat');
    r.set(pad([PAD.a]));
    expect(r.kb.isHeld('shotFront')).toBe(true);
    r.context('wait');
    r.set(pad([PAD.a]));
    // Still the same press: nothing new fires.
    expect(r.actions.filter((a) => a === 'confirm')).toHaveLength(0);
    r.set(pad());
    expect(r.kb.isHeld('shotFront')).toBe(false);
    r.set(pad([PAD.a]));
    expect(r.actions).toContain('confirm');
  });

  it('every in-game context can pause and change the camera, and A always does something', () => {
    for (const ctx of ['bat', 'bowl', 'wait'] as const) {
      expect(PAD_KEYS[ctx][PAD.start]).toBe('Escape');
      expect(PAD_KEYS[ctx][PAD.select]).toBe('KeyC');
      expect(PAD_KEYS[ctx][PAD.a]).toBeDefined();
    }
  });

  it('menus: the nearest control in the direction pressed', () => {
    const from = { x: 100, y: 100 };
    const c = [
      { x: 100, y: 40 },
      { x: 220, y: 100 },
      { x: 104, y: 160 },
      { x: 300, y: 170 },
    ];
    expect(nearestInDirection(from, { x: 0, y: 1 }, c)).toBe(2);
    expect(nearestInDirection(from, { x: 1, y: 0 }, c)).toBe(1);
    expect(nearestInDirection(from, { x: 0, y: -1 }, c)).toBe(0);
    expect(nearestInDirection(from, { x: -1, y: 0 }, c)).toBe(-1);
  });
});
