/**
 * Game controller support (the browser's Gamepad API, "standard" layout:
 * Xbox / PlayStation / Switch Pro pads). The pad does not have controls of
 * its own: its buttons press keyboard keys on the player's behalf, chosen by
 * what is happening, so everything the keyboard does the pad does too.
 *
 * In the menus (and the pause screen, help, the field editor) the pad moves
 * the focus between the buttons on screen and presses them.
 *
 *   Batting           stick / d-pad aim, A front foot, X back foot,
 *                     Y use your feet (and run once it is hit), B leave
 *                     (and "No!" to send him back), RT lofted, LB / RB
 *                     shuffle across the crease towards leg / off, LT run
 *   Bowling           stick / d-pad aim and amount, A bowl (choose, place,
 *                     run in, lock the pace), B back, LB / RB the delivery,
 *                     X field, Y over / round the wicket, LT edit the field
 *   Waiting           A carries on (next ball, start, skip)
 *   Always            Start pauses, View / Select changes the camera
 */
import type { KeyboardInput } from './keyboard.ts';

/** Standard-layout button indices. */
export const PAD = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  lb: 4,
  rb: 5,
  lt: 6,
  rt: 7,
  select: 8,
  start: 9,
  ls: 10,
  rs: 11,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} as const;

export type PadContext = 'menu' | 'bat' | 'bowl' | 'wait';

/** Keys each button presses in each context (arrows come from the stick and d-pad). */
export const PAD_KEYS: Readonly<Record<Exclude<PadContext, 'menu'>, Readonly<Partial<Record<number, string>>>>> = {
  bat: {
    [PAD.a]: 'KeyS',
    [PAD.x]: 'KeyW',
    [PAD.y]: 'KeyD',
    [PAD.b]: 'KeyA',
    [PAD.rt]: 'ShiftLeft',
    [PAD.lb]: 'KeyQ',
    [PAD.rb]: 'KeyE',
    [PAD.lt]: 'Space',
    [PAD.start]: 'Escape',
    [PAD.select]: 'KeyC',
  },
  bowl: {
    [PAD.a]: 'Space',
    [PAD.b]: 'Backspace',
    [PAD.lb]: 'KeyQ',
    [PAD.rb]: 'KeyE',
    [PAD.x]: 'KeyF',
    [PAD.y]: 'KeyO',
    [PAD.lt]: 'KeyG',
    [PAD.rt]: 'ShiftLeft',
    [PAD.start]: 'Escape',
    [PAD.select]: 'KeyC',
  },
  wait: {
    [PAD.a]: 'Enter',
    [PAD.b]: 'Enter',
    [PAD.x]: 'KeyT',
    [PAD.y]: 'KeyY',
    [PAD.start]: 'Escape',
    [PAD.select]: 'KeyC',
  },
};

const STICK = 0.5;

/** The stick and d-pad as arrow keys (both at once is fine: either counts). */
export function arrowsOf(pad: { readonly axes: readonly number[]; readonly buttons: readonly { readonly pressed: boolean }[] }): Set<string> {
  const out = new Set<string>();
  const ax = pad.axes[0] ?? 0;
  const ay = pad.axes[1] ?? 0;
  const btn = (i: number) => pad.buttons[i]?.pressed === true;
  if (ax < -STICK || btn(PAD.left)) out.add('ArrowLeft');
  if (ax > STICK || btn(PAD.right)) out.add('ArrowRight');
  if (ay < -STICK || btn(PAD.up)) out.add('ArrowUp');
  if (ay > STICK || btn(PAD.down)) out.add('ArrowDown');
  return out;
}

/** Spatial focus movement for menus: the nearest control in the direction pressed. */
export function nearestInDirection(
  from: { x: number; y: number },
  dir: { x: number; y: number },
  candidates: readonly { x: number; y: number }[],
): number {
  let best = -1;
  let bestScore = Infinity;
  candidates.forEach((c, i) => {
    const dx = c.x - from.x;
    const dy = c.y - from.y;
    const along = dx * dir.x + dy * dir.y;
    if (along <= 4) return;
    const across = Math.abs(dx * dir.y - dy * dir.x);
    // Straight ahead first; off to the side costs more than distance.
    const score = along + across * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function visible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

/** The focusable controls on screen; inside an open dialog only its own. */
function focusables(): HTMLElement[] {
  const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')].filter(visible);
  const scope: ParentNode = dialogs[dialogs.length - 1] ?? document;
  return [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
}

function centre(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Moves the keyboard focus to the next control in a direction (or the first one, when nothing has focus). */
export function moveFocus(dir: { x: number; y: number }): void {
  const all = focusables();
  if (all.length === 0) return;
  const current = document.activeElement instanceof HTMLElement && all.includes(document.activeElement) ? document.activeElement : undefined;
  if (!current) {
    all[0]?.focus();
    return;
  }
  const others = all.filter((el) => el !== current);
  const i = nearestInDirection(centre(current), dir, others.map(centre));
  const next = others[i];
  if (next) {
    next.focus();
    next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

/** Presses the focused control (a range input steps instead, with left / right). */
function activate(): void {
  const el = document.activeElement;
  if (el instanceof HTMLElement && el !== document.body) el.click();
  else focusables()[0]?.focus();
}

const REPEAT_DELAY = 380;
const REPEAT_EVERY = 150;

/**
 * Polls the connected pads once a frame and turns them into key presses (or
 * menu focus moves), by context.
 */
export class GamepadInput {
  /** Key pressed for each button (so a button released after the context changed releases the right key). */
  private readonly down = new Map<number, string>();
  private arrows = new Set<string>();
  private menuHeld: { key: string; since: number; last: number } | undefined;
  private menuButtons = new Set<number>();
  private raf = 0;
  /** Whether a pad has been used since the last key on the keyboard (the panels show pad buttons then). */
  active = false;
  onActive: (active: boolean) => void = () => undefined;

  constructor(
    private readonly keyboard: KeyboardInput,
    private readonly context: () => PadContext,
  ) {}

  start(): () => void {
    const loop = (now: number) => {
      this.poll(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    const onKey = (e: KeyboardEvent) => {
      if (e.isTrusted) this.setActive(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(this.raf);
      window.removeEventListener('keydown', onKey);
      this.releaseAll();
    };
  }

  private setActive(on: boolean): void {
    if (this.active === on) return;
    this.active = on;
    this.onActive(on);
  }

  private releaseAll(): void {
    for (const code of this.down.values()) this.keyboard.release(code);
    this.down.clear();
    for (const code of this.arrows) this.keyboard.release(code);
    this.arrows.clear();
  }

  poll(now: number): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()].filter((p): p is Gamepad => p !== null && p.connected) : [];
    const pad = pads[0];
    if (!pad) {
      if (this.down.size || this.arrows.size) this.releaseAll();
      return;
    }
    const ctx = this.context();
    const arrows = arrowsOf(pad);
    const pressed = (i: number) => pad.buttons[i]?.pressed === true;
    if (arrows.size || pad.buttons.some((b) => b.pressed)) this.setActive(true);

    if (ctx === 'menu') {
      // Nothing held down as keys in the menus.
      if (this.down.size || this.arrows.size) this.releaseAll();
      this.menu(now, arrows, pressed);
      return;
    }
    this.menuHeld = undefined;
    this.menuButtons.clear();
    // Arrows: held as keys.
    for (const code of this.arrows) if (!arrows.has(code)) this.keyboard.release(code);
    for (const code of arrows) if (!this.arrows.has(code)) this.keyboard.press(code);
    this.arrows = arrows;
    // Buttons.
    const map = PAD_KEYS[ctx];
    pad.buttons.forEach((b, i) => {
      if (i >= PAD.up && i <= PAD.right) return;
      const was = this.down.get(i);
      if (b.pressed && was === undefined) {
        const code = map[i];
        if (code) {
          this.down.set(i, code);
          this.keyboard.press(code);
        }
      } else if (!b.pressed && was !== undefined) {
        this.down.delete(i);
        this.keyboard.release(was);
      }
    });
  }

  private menu(now: number, arrows: Set<string>, pressed: (i: number) => boolean): void {
    // Direction: first press moves at once, holding repeats.
    const key = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].find((k) => arrows.has(k));
    if (!key) this.menuHeld = undefined;
    else if (!this.menuHeld || this.menuHeld.key !== key) {
      this.menuHeld = { key, since: now, last: now };
      this.step(key);
    } else if (now - this.menuHeld.since > REPEAT_DELAY && now - this.menuHeld.last > REPEAT_EVERY) {
      this.menuHeld.last = now;
      this.step(key);
    }
    // A presses, B backs out (Escape), Start too.
    for (const i of [PAD.a, PAD.b, PAD.start]) {
      const on = pressed(i);
      if (on && !this.menuButtons.has(i)) {
        this.menuButtons.add(i);
        if (i === PAD.a) activate();
        else this.escape();
      } else if (!on) this.menuButtons.delete(i);
    }
  }

  private step(key: string): void {
    const el = document.activeElement;
    // Sliders and dropdowns take left / right themselves.
    if (el instanceof HTMLInputElement && el.type === 'range' && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      if (key === 'ArrowLeft') el.stepDown();
      else el.stepUp();
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    moveFocus({ x: key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0, y: key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0 });
  }

  private escape(): void {
    // As the Escape key: the game's own (unpause, close) and any dialog listening for it.
    const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }));
  }
}
