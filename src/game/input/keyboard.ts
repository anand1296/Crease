/**
 * Keyboard input. Uses `KeyboardEvent.code` (physical keys) so layouts do
 * not matter, ignores auto-repeat for actions, prevents the browser's own
 * handling of game keys (arrow scrolling, Tab focus, Space clicks), and
 * forgets held keys when the window loses focus so nothing gets stuck.
 */
export const GAME_ACTIONS = [
  'left',
  'right',
  'up',
  'down',
  'backFoot',
  'ground',
  'loft',
  'defend',
  'sweep',
  'leave',
  'bowl',
  'nextDelivery',
  'prevDelivery',
  'run',
  'pause',
  'confirm',
  'camera',
  'help',
  'mute',
  'commentary',
  'pick1',
  'pick2',
  'pick3',
  'pick4',
  'pick5',
  'pick6',
  'pick7',
  'pick8',
  'pick9',
] as const;

export type GameAction = (typeof GAME_ACTIONS)[number];

export type Bindings = Readonly<Record<GameAction, readonly string[]>>;

export const DEFAULT_BINDINGS: Bindings = {
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  backFoot: ['ShiftLeft', 'ShiftRight'],
  ground: ['KeyD'],
  loft: ['KeyA'],
  defend: ['KeyS'],
  sweep: ['KeyW'],
  leave: ['KeyX'],
  bowl: ['Space'],
  nextDelivery: ['KeyE'],
  prevDelivery: ['KeyQ'],
  run: ['Space', 'KeyR'],
  pause: ['KeyP', 'Escape'],
  confirm: ['Enter'],
  camera: ['KeyC'],
  help: ['KeyH'],
  mute: ['KeyM'],
  commentary: ['KeyV'],
  pick1: ['Digit1'],
  pick2: ['Digit2'],
  pick3: ['Digit3'],
  pick4: ['Digit4'],
  pick5: ['Digit5'],
  pick6: ['Digit6'],
  pick7: ['Digit7'],
  pick8: ['Digit8'],
  pick9: ['Digit9'],
};

/** Human-readable key names for the controls panel. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const names: Record<string, string> = {
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', ShiftLeft: 'Shift', ShiftRight: 'Shift',
    Space: 'Space', Escape: 'Esc', Tab: 'Tab', Enter: 'Enter',
  };
  return names[code] ?? code;
}

export class KeyboardInput {
  private readonly held = new Set<string>();
  private readonly bindings: Bindings;
  private readonly codes: Set<string>;
  private target: Window | null = null;
  onPress: (action: GameAction, event: KeyboardEvent) => void = () => undefined;
  /** When false (menus), keys pass through to the page untouched. */
  enabled = true;

  constructor(bindings: Bindings = DEFAULT_BINDINGS) {
    this.bindings = bindings;
    this.codes = new Set(Object.values(bindings).flat());
  }

  attach(target: Window): () => void {
    this.target = target;
    target.addEventListener('keydown', this.handleDown);
    target.addEventListener('keyup', this.handleUp);
    target.addEventListener('blur', this.clear);
    return () => this.detach();
  }

  detach(): void {
    const t = this.target;
    if (!t) return;
    t.removeEventListener('keydown', this.handleDown);
    t.removeEventListener('keyup', this.handleUp);
    t.removeEventListener('blur', this.clear);
    this.target = null;
    this.held.clear();
  }

  isHeld(action: GameAction): boolean {
    return this.bindings[action].some((code) => this.held.has(code));
  }

  /** Screen direction from the arrow keys currently held. */
  direction(): { x: -1 | 0 | 1; y: -1 | 0 | 1 } {
    const x = (this.isHeld('right') ? 1 : 0) - (this.isHeld('left') ? 1 : 0);
    const y = (this.isHeld('up') ? 1 : 0) - (this.isHeld('down') ? 1 : 0);
    return { x: sign(x), y: sign(y) };
  }

  readonly clear = (): void => {
    this.held.clear();
  };

  private readonly handleDown = (e: KeyboardEvent): void => {
    if (!this.enabled || !this.codes.has(e.code)) return;
    // Do not steal keys from form controls.
    if (e.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(e.target.tagName) && e.code !== 'Escape') {
      if (e.code === 'Enter' || e.code === 'Space') return;
    }
    // Leave browser shortcuts (Ctrl/Cmd+R, etc.) alone.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    this.held.add(e.code);
    if (e.repeat) return;
    for (const action of GAME_ACTIONS) {
      if (this.bindings[action].includes(e.code)) this.onPress(action, e);
    }
  };

  private readonly handleUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
  };
}

const sign = (v: number): -1 | 0 | 1 => (v > 0 ? 1 : v < 0 ? -1 : 0);
