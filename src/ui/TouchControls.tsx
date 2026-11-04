import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useGame } from '../state/game.ts';
import { SHOTS } from '../game/batting/shots.ts';
import { type BatAction, fieldRegion, shotFromInput } from '../game/input/battingControls.ts';
import { keyboard } from '../game/input/keyboardInstance.ts';
import { padContext } from '../game/input/useGamepad.ts';
import { useKeys } from './Hud.tsx';

/**
 * Playing by touch. Like the game controller, the on-screen controls press
 * keyboard keys on the player's behalf, so they do exactly what the keys do:
 *
 *   left thumb   a stick for the arrows (where to hit it; the marker and
 *                the amount when bowling; hold ↑ / ↓ to throw)
 *   right thumb  batting: Front foot, Back foot, Feet, Leave, and Loft held
 *                with them; before the ball, ◀ ▶ to shuffle; once it is hit,
 *                Run, Sprint (held), Dive and No!
 *                bowling: Bowl (each step), Back, ◀ ▶ the delivery, Side,
 *                Field and Set field
 *   top          pause, camera, full screen
 *
 * Everything that waits for the player (next ball, the cards, reviews) is a
 * button on screen already, so a tap does it.
 */
export function TouchControls() {
  const touch = useGame((s) => s.touchActive);
  const snap = useGame((s) => s.snap);
  const paused = useGame((s) => s.paused);
  const replaying = useGame((s) => s.replaying);
  const help = useGame((s) => s.showHelp);
  if (!touch || !snap) return null;
  const rotate = (
    <div className="rotate-hint" aria-hidden="true">
      <span>⟳</span> Turn your phone sideways to play
    </div>
  );
  // A card on screen (the start, an over, a wicket, the break, the result, pause, help) has its own buttons.
  const card =
    paused || help || (snap.phase === 'review' && snap.review?.kind !== 'ball' && snap.review?.kind !== 'ready') || snap.phase === 'inningsBreak' || snap.phase === 'complete';
  if (card) return <div className="touch-layer">{rotate}</div>;
  const ctx = replaying ? 'wait' : padContext();
  return (
    <div className="touch-layer" data-testid="touch-controls">
      <TopButtons />
      {ctx === 'bat' ? <BattingPad struck={snap.ballPhase === 'struck'} runUp={snap.ballPhase === 'runUp'} hand={snap.striker.hand} /> : null}
      {ctx === 'bowl' ? <BowlingPad /> : null}
      {rotate}
    </div>
  );
}

/** A button held down as a key (pressed on touch, released on lift). */
function Hold({ code, children, className = '', label }: { code: string; children: ReactNode; className?: string; label: string }) {
  const down = useRef(false);
  const press = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (down.current) return;
    down.current = true;
    keyboard.press(code);
  };
  const lift = () => {
    if (!down.current) return;
    down.current = false;
    keyboard.release(code);
  };
  useEffect(() => () => {
    if (down.current) keyboard.release(code);
  }, [code]);
  return (
    <button
      type="button"
      className={`tbtn ${className}`}
      aria-label={label}
      onPointerDown={press}
      onPointerUp={lift}
      onPointerCancel={lift}
      onLostPointerCapture={lift}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

/** A thumbstick for the arrow keys: eight ways, with a dead zone in the middle. */
function Stick() {
  const pad = useRef<HTMLDivElement>(null);
  const held = useRef<Set<string>>(new Set());
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const apply = (codes: Set<string>) => {
    for (const c of held.current) if (!codes.has(c)) keyboard.release(c);
    for (const c of codes) if (!held.current.has(c)) keyboard.press(c);
    held.current = codes;
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = pad.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const radius = r.width / 2;
    let dx = (e.clientX - (r.left + radius)) / radius;
    let dy = (e.clientY - (r.top + radius)) / radius;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    setKnob({ x: dx, y: dy });
    const codes = new Set<string>();
    if (len > 0.3) {
      // A diagonal when the thumb is within about 22° of one.
      const nx = dx / Math.max(len, 1e-6);
      const ny = dy / Math.max(len, 1e-6);
      if (nx > 0.38) codes.add('ArrowRight');
      if (nx < -0.38) codes.add('ArrowLeft');
      if (ny > 0.38) codes.add('ArrowDown');
      if (ny < -0.38) codes.add('ArrowUp');
    }
    apply(codes);
  };
  const end = () => {
    setKnob({ x: 0, y: 0 });
    apply(new Set());
  };
  useEffect(
    () => () => {
      for (const c of held.current) keyboard.release(c);
    },
    [],
  );
  return (
    <div
      ref={pad}
      className="tstick"
      role="slider"
      aria-label="Direction"
      aria-valuetext={[...held.current].join(' ') || 'none'}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    >
      <span className="tstick-arrow up">↑</span>
      <span className="tstick-arrow down">↓</span>
      <span className="tstick-arrow left">←</span>
      <span className="tstick-arrow right">→</span>
      <span className="tstick-knob" style={{ transform: `translate(${knob.x * 34}px, ${knob.y * 34}px)` }} />
    </div>
  );
}

function BattingPad({ struck, runUp, hand }: { struck: boolean; runUp: boolean; hand: 'right' | 'left' }) {
  const { dir, back } = useKeys();
  const scheme = useGame((s) => s.arrows);
  const shot = (a: BatAction) => shotFromInput(a, dir, back, hand, scheme);
  const name = (a: BatAction) => SHOTS[shot(a).shot].name;
  const where = (a: BatAction) => {
    const r = fieldRegion(shot(a));
    return r === 'dead bat' ? 'defend' : r;
  };
  return (
    <>
      <div className="tpad-left">
        <Stick />
        <span className="tpad-note">{dir.x === 0 && dir.y === 0 ? 'no direction: defend' : '↓ straight · → his right'}</span>
      </div>
      <div className="tpad-right">
        {struck ? (
          <>
            <Hold code="Space" className="big run" label="Run">
              Run
            </Hold>
            <Hold code="ShiftLeft" className="sprint" label="Sprint (hold)">
              Sprint
              <small>hold</small>
            </Hold>
            <Hold code="KeyS" className="dive" label="Dive for the crease">
              Dive
            </Hold>
            <Hold code="KeyA" className="no" label="No! Send him back">
              No!
            </Hold>
          </>
        ) : (
          <>
            <Hold code="KeyS" className="big front" label={`Front foot: ${name('front')}`}>
              Front
              <small>{name('front')}</small>
              <small className="where">{where('front')}</small>
            </Hold>
            <Hold code="KeyW" className="back" label={`Back foot: ${name('back')}`}>
              Back
              <small>{name('back')}</small>
            </Hold>
            <Hold code="KeyD" className="feet" label={`Use your feet: ${name('feet')}`}>
              Feet
              <small>down the pitch</small>
            </Hold>
            <Hold code="KeyA" className="leave" label="Leave">
              Leave
            </Hold>
            <Hold code="ShiftLeft" className={`loft ${back ? 'on' : ''}`} label="Loft it (hold)">
              Loft
              <small>hold</small>
            </Hold>
            {runUp ? (
              <div className="tshuffle">
                <Hold code="KeyQ" className="small" label="Shuffle towards leg">
                  ◀
                </Hold>
                <span>shuffle</span>
                <Hold code="KeyE" className="small" label="Shuffle towards off">
                  ▶
                </Hold>
              </div>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

function BowlingPad() {
  return (
    <>
      <div className="tpad-left">
        <Stick />
        <span className="tpad-note">marker, amount · hold ↑ / ↓ to throw</span>
      </div>
      <div className="tpad-right bowl">
        <Hold code="Space" className="big bowl" label="Bowl: next step">
          Bowl
        </Hold>
        <Hold code="Backspace" className="back" label="Back a step">
          Back
        </Hold>
        <div className="tshuffle">
          <Hold code="KeyQ" className="small" label="Previous delivery">
            ◀
          </Hold>
          <span>ball</span>
          <Hold code="KeyE" className="small" label="Next delivery">
            ▶
          </Hold>
        </div>
        <Hold code="KeyO" className="side" label="Over or round the wicket">
          Side
        </Hold>
        <Hold code="KeyF" className="field" label="Change the field">
          Field
        </Hold>
        <Hold code="KeyG" className="setfield" label="Place your own field">
          Set
          <small>field</small>
        </Hold>
      </div>
    </>
  );
}

function TopButtons() {
  const [full, setFull] = useState(() => typeof document !== 'undefined' && document.fullscreenElement !== null);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const canFull = typeof document !== 'undefined' && typeof document.documentElement.requestFullscreen === 'function';
  return (
    <div className="ttop">
      <Hold code="Escape" className="small" label="Pause">
        ❚❚
      </Hold>
      <Hold code="KeyC" className="small" label="Change the camera">
        Cam
      </Hold>
      {canFull ? (
        <button
          type="button"
          className="tbtn small"
          aria-label={full ? 'Leave full screen' : 'Full screen'}
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
            else enterFullscreen();
          }}
        >
          {full ? '⤡' : '⤢'}
        </button>
      ) : null}
    </div>
  );
}

/** Full screen, turned sideways where the phone allows it (it must come from a tap). */
export function enterFullscreen(): void {
  const el = document.documentElement;
  if (typeof el.requestFullscreen !== 'function') return;
  void el
    .requestFullscreen({ navigationUI: 'hide' })
    .then(() => {
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      return o.lock?.('landscape');
    })
    .catch(() => undefined);
}

/** Watches for touch (on) and the keyboard (off), so the right controls show on a laptop with a touch screen too. */
export function useTouchDetection(): void {
  const set = useGame((s) => s.setTouchActive);
  useEffect(() => {
    const touched = (e: PointerEvent | TouchEvent) => {
      if ('pointerType' in e && e.pointerType !== 'touch') return;
      set(true);
    };
    const typed = (e: KeyboardEvent) => {
      if (e.isTrusted) set(false);
    };
    window.addEventListener('pointerdown', touched, { passive: true });
    window.addEventListener('touchstart', touched, { passive: true });
    window.addEventListener('keydown', typed);
    return () => {
      window.removeEventListener('pointerdown', touched);
      window.removeEventListener('touchstart', touched);
      window.removeEventListener('keydown', typed);
    };
  }, [set]);
}
