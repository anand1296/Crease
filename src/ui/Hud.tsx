import { useGame } from '../state/game.ts';
import { DELIVERY_TYPES } from '../game/bowling/deliveryTypes.ts';
import type { BallOutcome } from '../game/session/deliveryCycle.ts';
import type { InningsState } from '../game/match/match.ts';
import { Scorecard } from './Scorecard.tsx';
import { HowToPlay } from './Menus.tsx';
import { useEffect, useRef, useState } from 'react';
import type { GameAction } from '../game/input/keyboard.ts';
import { keyboard } from '../game/input/keyboardInstance.ts';
import { shotFromInput } from '../game/input/battingControls.ts';
import { SHOTS } from '../game/batting/shots.ts';
import { howOut } from './Scorecard.tsx';
import { oversText } from '../game/match/match.ts';
import type { CoachNote } from '../game/ai/coach.ts';
import { speak } from '../game/audio/voice.ts';

/**
 * In-match HUD. Kept to the screen edges so the batter, bowler and ball stay
 * clear. Centre-screen only for moments: the ball result, the bowler choice,
 * the innings break and the result.
 */
export function Hud() {
  return (
    <>
      <ScoreStrip />
      <DeliveryPanel />
      <OutcomeBanner />
      <RunPrompt />
      <BowlingPanel />
      <BowlerChoice />
      <Commentary />
      <ControlsPanel />
      <NextPrompt />
      <ReviewCard />
      <ReplayBadge />
      <InningsBreak />
      <Result />
      <HelpOverlay />
      <PauseOverlay />
    </>
  );
}

/** Broadcast-style score bar along the bottom of the screen. */
function ScoreStrip() {
  const snap = useGame((s) => s.snap);
  if (!snap) return null;
  const { striker, nonStriker, bowler } = snap;
  const fig = (c: { runs: number; balls: number } | undefined) => (c ? `${c.runs} (${c.balls})` : '0 (0)');
  const rate = snap.balls ? ((snap.runs / snap.balls) * 6).toFixed(2) : '0.00';
  const required = snap.needed !== undefined && snap.ballsLeft ? ((snap.needed / snap.ballsLeft) * 6).toFixed(2) : undefined;
  const bowlerOvers = bowler.card ? `${Math.floor(bowler.card.balls / 6)}.${bowler.card.balls % 6}` : '0.0';
  return (
    <section className="scorebar" aria-label="Scoreboard" data-testid="scoreboard">
      <div className="sb-team" style={{ background: snap.battingTeam.colors.primary, color: snap.battingTeam.colors.secondary }}>
        {snap.battingTeam.shortName}
      </div>
      <div className="sb-score">
        <span className="sb-runs" data-testid="score">
          {snap.runs}/{snap.wickets}
        </span>
        <span className="sb-overs" data-testid="overs">
          {snap.overs} <small>({snap.maxOvers})</small>
        </span>
      </div>
      <div className="sb-batters">
        <span className="on">
          <i aria-hidden="true">▸</i>
          {striker.name} <b>{fig(striker.card)}</b>
        </span>
        <span>
          <i aria-hidden="true" />
          {nonStriker.name} <b>{fig(nonStriker.card)}</b>
        </span>
      </div>
      <div className="sb-bowler">
        <span>
          {bowler.name} <b>{bowler.card ? `${bowler.card.wickets}-${bowler.card.runs}` : '0-0'}</b> <small>{bowlerOvers}</small>
        </span>
        <span className="sb-over" aria-label="This over">
          {snap.recent.map((r, i) => (
            <span key={i} className={r === 'W' ? 'ball w' : r === '4' || r === '6' ? 'ball b' : 'ball'}>
              {r}
            </span>
          ))}
        </span>
      </div>
      <div className="sb-info">
        {snap.target !== undefined ? (
          <span className="sb-chase" data-testid="chase">
            Need {snap.needed} from {snap.ballsLeft}
            {required ? <small> · RRR {required}</small> : null}
          </span>
        ) : (
          <span>RR {rate}</span>
        )}
        <span className="sb-role" data-testid="role">
          {snap.userBatting ? 'You are batting' : 'You are bowling'}
          {snap.fieldPhase === 'powerplay' ? (
            <span className="phase-tag" data-testid="powerplay">
              Powerplay
            </span>
          ) : null}
        </span>
      </div>
    </section>
  );
}

function DeliveryPanel() {
  const o = useGame((s) => s.snap?.lastOutcome);
  const style = useGame((s) => s.snap?.bowler.style);
  const toss = useGame((s) => s.snap?.toss);
  const balls = useGame((s) => s.snap?.ballCount ?? 0);
  return (
    <section className="hud-card delivery" aria-label="Last delivery">
      <div className="label">{style}</div>
      {o ? (
        <div className="value">
          {o.delivery.name}, {Math.round(o.delivery.speedKph)} km/h
        </div>
      ) : (
        <div className="value dim">{balls === 0 ? toss : ''}</div>
      )}
    </section>
  );
}

function timingText(o: BallOutcome): { text: string; tone: string } | null {
  const c = o.contact;
  if (o.timingMs === undefined || !c || c.kind === 'leave') return null;
  const ms = o.timingMs;
  const when = Math.abs(ms) <= 12 ? 'Perfect timing' : ms < 0 ? `Early by ${-ms} ms` : `Late by ${ms} ms`;
  const how = c.kind === 'middled' ? 'middled' : c.kind === 'mistimed' ? 'mistimed' : c.kind === 'edge' ? `${c.edge} edge` : 'missed';
  const tone = c.kind === 'middled' ? 'good' : c.kind === 'mistimed' ? 'ok' : 'bad';
  return { text: `${when}, ${how}`, tone };
}

function OutcomeBanner() {
  const o = useGame((s) => s.snap?.lastOutcome);
  const count = useGame((s) => s.snap?.ballCount ?? 0);
  const phase = useGame((s) => s.snap?.phase);
  const ballPhase = useGame((s) => s.snap?.ballPhase);
  const reviewKind = useGame((s) => s.snap?.review?.kind);
  const visible = o && (phase === 'between' || phase === 'aiming' || ballPhase === 'dead' || (phase === 'review' && reviewKind === 'ball'));
  if (!o || !visible) return null;
  const t = timingText(o);
  const big = o.boundary !== undefined || o.wicket !== undefined;
  return (
    <div key={count} className={`banner ${big ? 'big' : ''} ${o.wicket ? 'wicket' : o.boundary ? 'boundary' : ''}`} role="status" data-testid="banner">
      <div className="headline">{o.headline}</div>
      {o.detail ? <div className="detail">{o.detail}</div> : null}
      {t ? <div className={`timing ${t.tone}`}>{t.text}</div> : null}
    </div>
  );
}

function RunPrompt() {
  const snap = useGame((s) => s.snap);
  if (!snap || !snap.userBatting || snap.ballPhase !== 'struck') return null;
  return (
    <div className="run-prompt" role="status" data-testid="run-prompt">
      {snap.runsCalled === 0 ? (
        <>
          <kbd>Space</kbd> run
        </>
      ) : (
        <>
          Running {snap.runsCalled} · <kbd>Space</kbd> for another
        </>
      )}
    </div>
  );
}

function BowlingPanel() {
  const snap = useGame((s) => s.snap);
  const meter = useGame((s) => s.meter);
  if (!snap || !snap.userBowling || snap.phase === 'chooseBowler' || snap.phase === 'inningsBreak' || snap.phase === 'complete') return null;
  const { setup, deliveries } = snap;
  const runningIn = snap.phase === 'delivery' && snap.ballPhase === 'runUp';
  const length =
    setup.length < 1.4 ? 'Yorker' : setup.length < 3.5 ? 'Full' : setup.length < 6.5 ? 'Good length' : setup.length < 9 ? 'Back of a length' : 'Short';
  const line = setup.line > 0.5 ? 'Wide outside off' : setup.line > 0.2 ? 'Outside off' : setup.line > 0.05 ? 'Off stump' : setup.line > -0.08 ? 'Middle' : 'Leg side';
  return (
    <section className="hud-card bowling" aria-label="Bowling controls" data-testid="bowling-panel">
      <div className="label">Delivery (Q / E)</div>
      <div className="deliveries">
        {deliveries.map((d) => (
          <span key={d} className={d === setup.type ? 'chip on' : 'chip'}>
            {DELIVERY_TYPES[d].name}
          </span>
        ))}
      </div>
      <div className="label">Target (arrows)</div>
      <div className="value">
        {line}, {length.toLowerCase()}
      </div>
      {runningIn ? (
        <div className="meter" aria-label="Release accuracy">
          <span className="sweet" />
          <span className="needle" style={{ left: `${(snap.releaseLocked ? 0.5 : meter) * 100}%` }} />
        </div>
      ) : null}
      <div className="hint">
        {snap.phase === 'aiming' ? 'Space to run in' : runningIn ? (snap.releaseLocked ? 'Release locked' : 'Space when the needle is in the gold') : ''}
      </div>
    </section>
  );
}

function BowlerChoice() {
  const snap = useGame((s) => s.snap);
  const match = useGame((s) => s.match);
  if (!snap || snap.phase !== 'chooseBowler' || !match) return null;
  return (
    <div className="chooser" role="dialog" aria-label="Choose bowler" data-testid="bowler-choice">
      <h2>Who bowls the next over?</h2>
      <ol>
        {snap.eligibleBowlers.map(({ player, overs }, i) => (
          <li key={player.id}>
            <button type="button" className={player.id === snap.suggestedBowlerId ? 'suggested' : ''} onClick={() => match.chooseBowler(player.id)}>
              <kbd>{i + 1}</kbd>
              <span className="who">{player.name}</span>
              <span className="dim">{bowlingStyleShort(player.bowlingStyle, player.bowlingArm)}</span>
              <span className="num">{overs} ov</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="dim small">Enter picks the highlighted bowler.</p>
    </div>
  );
}

function bowlingStyleShort(style: string, arm: string): string {
  const a = arm === 'left' ? 'LA' : 'RA';
  const s: Record<string, string> = { fast: 'fast', fastMedium: 'fast-med', medium: 'medium', offSpin: arm === 'left' ? 'orthodox' : 'off-spin', legSpin: 'wrist spin' };
  return `${a} ${s[style] ?? style}`;
}

function InningsBreak() {
  const snap = useGame((s) => s.snap);
  const match = useGame((s) => s.match);
  if (!snap || snap.phase !== 'inningsBreak' || !match) return null;
  const first = snap.innings[0];
  if (!first) return null;
  const batting = match.side(first.batting).team;
  const bowling = match.side(first.bowling).team;
  const chaser = bowling;
  return (
    <div className="overlay" role="dialog" aria-label="Innings break" data-testid="innings-break">
      <div className="panel wide">
        <h2>Innings break</h2>
        <p>
          {chaser.name} need <strong>{first.runs + 1}</strong> to win from {snap.maxOvers} overs.
        </p>
        <Scorecard innings={first} batting={batting} bowling={bowling} />
        <Coach notes={snap.coach} />
        <button type="button" onClick={() => match.continueAfterBreak()} autoFocus data-testid="continue">
          Start the chase (Enter)
        </button>
      </div>
    </div>
  );
}

function Result() {
  const snap = useGame((s) => s.snap);
  const match = useGame((s) => s.match);
  const rematch = useGame((s) => s.rematch);
  const quit = useGame((s) => s.quitToMenu);
  if (!snap || snap.phase !== 'complete' || !match || !snap.result) return null;
  const userWon = snap.result.winner === 'home';
  const best = bestPerformers(match.innings);
  return (
    <div className="overlay" role="dialog" aria-label="Match result" data-testid="result">
      <div className="panel wide">
        <h2 className={`result-title ${snap.result.tie ? '' : userWon ? 'won' : 'lost'}`}>{snap.result.summary}</h2>
        {best ? (
          <p className="dim">
            Top score: {best.bat}. Best bowling: {best.bowl}.
          </p>
        ) : null}
        <Coach notes={snap.coach} />
        <div className="cards">
          {match.innings.map((inn, i) => (
            <Scorecard key={i} innings={inn} batting={match.side(inn.batting).team} bowling={match.side(inn.bowling).team} />
          ))}
        </div>
        <div className="buttons row">
          <button type="button" onClick={rematch} autoFocus data-testid="rematch">
            Rematch
          </button>
          <button type="button" className="secondary" onClick={quit}>
            Main menu
          </button>
        </div>
      </div>
    </div>
  );
}

function bestPerformers(innings: readonly InningsState[]): { bat: string; bowl: string } | undefined {
  const bats = innings.flatMap((i) => i.battingCards).filter((c) => c.batted);
  const bowls = innings.flatMap((i) => i.bowlingCards);
  const topBat = bats.slice().sort((a, b) => b.runs - a.runs || a.balls - b.balls)[0];
  const topBowl = bowls.slice().sort((a, b) => b.wickets - a.wickets || a.runs - b.runs)[0];
  if (!topBat || !topBowl) return undefined;
  return { bat: `${topBat.player.name} ${topBat.runs} (${topBat.balls})`, bowl: `${topBowl.player.name} ${topBowl.wickets}/${topBowl.runs}` };
}

function HelpOverlay() {
  const help = useGame((s) => s.showHelp);
  const toggle = useGame((s) => s.toggleHelp);
  if (!help) return null;
  return <HowToPlay onClose={toggle} />;
}

function PauseOverlay() {
  const paused = useGame((s) => s.paused);
  const setPaused = useGame((s) => s.setPaused);
  const rematch = useGame((s) => s.rematch);
  const quit = useGame((s) => s.quitToMenu);
  const muted = useGame((s) => s.muted);
  const toggleMute = useGame((s) => s.toggleMute);
  const commentaryOn = useGame((s) => s.commentaryOn);
  const toggleCommentary = useGame((s) => s.toggleCommentary);
  const replaysOn = useGame((s) => s.replaysOn);
  const toggleReplays = useGame((s) => s.toggleReplays);
  if (!paused) return null;
  return (
    <div className="overlay" role="dialog" aria-label="Paused" data-testid="pause">
      <div className="panel">
        <h2>Paused</h2>
        <div className="buttons">
          <button type="button" onClick={() => setPaused(false)} autoFocus>
            Resume (P)
          </button>
          <button type="button" className="secondary" onClick={toggleMute}>
            Sound: {muted ? 'off' : 'on'} (M)
          </button>
          <button type="button" className="secondary" onClick={toggleCommentary}>
            Commentary: {commentaryOn ? 'on' : 'off'} (V)
          </button>
          <button type="button" className="secondary" onClick={toggleReplays}>
            Replays: {replaysOn ? 'on' : 'off'}
          </button>
          <button type="button" className="secondary" onClick={rematch}>
            Restart match
          </button>
          <button type="button" className="secondary" onClick={quit}>
            Quit to main menu
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Ball-by-ball commentary: the latest line along the bottom of the screen,
 * and spoken by the commentator's voice when commentary is on (and sound is
 * not muted).
 */
function Commentary() {
  const line = useGame((s) => s.snap?.commentary);
  const count = useGame((s) => s.snap?.commentaryCount ?? 0);
  const on = useGame((s) => s.commentaryOn);
  const muted = useGame((s) => s.muted);
  const heard = useRef(count);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (count === heard.current || !line) return;
    heard.current = count;
    setVisible(true);
    if (on && !muted) speak(line);
    const t = window.setTimeout(() => setVisible(false), 6500);
    return () => window.clearTimeout(t);
  }, [count, line, on, muted]);
  if (!on || !line || !visible) return null;
  return (
    <div className={`commentary ${line.excitement === 2 ? 'big' : ''}`} role="log" aria-live="polite" data-testid="commentary">
      <span className="mic" aria-hidden="true" />
      {line.text}
    </div>
  );
}

/** The coach's notes for the human side. */
function Coach({ notes }: { notes: { batting: readonly CoachNote[]; bowling: readonly CoachNote[] } | undefined }) {
  if (!notes) return null;
  const all = [...notes.batting.map((n) => ({ ...n, kind: 'Batting' })), ...notes.bowling.map((n) => ({ ...n, kind: 'Bowling' }))];
  if (all.length === 0) return null;
  return (
    <section className="coach" aria-label="Coach's notes" data-testid="coach">
      <h3>Coach&rsquo;s notes</h3>
      <ul>
        {all.map((n) => (
          <li key={`${n.kind}-${n.title}`} className={n.tone}>
            <strong>{n.title}</strong>
            <span>{n.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// --- Controls panel -----------------------------------------------------------------------

/** Keys currently held, plus the last one pressed (lit briefly), polled each animation frame. */
function useKeys(): { held: ReadonlySet<GameAction>; flash: GameAction | undefined; dir: { x: -1 | 0 | 1; y: -1 | 0 | 1 }; back: boolean } {
  const [state, setState] = useState<{ held: ReadonlySet<GameAction>; flash: GameAction | undefined; dir: { x: -1 | 0 | 1; y: -1 | 0 | 1 }; back: boolean }>({
    held: new Set(),
    flash: undefined,
    dir: { x: 0, y: 0 },
    back: false,
  });
  useEffect(() => {
    const watched: GameAction[] = ['left', 'right', 'up', 'down', 'backFoot', 'ground', 'loft', 'defend', 'sweep', 'leave', 'run', 'bowl', 'nextDelivery', 'prevDelivery'];
    let raf = 0;
    let last = '';
    const loop = () => {
      const held = watched.filter((a) => keyboard.isHeld(a));
      const lp = keyboard.lastPress;
      const flash = lp && performance.now() - lp.at < 450 ? lp.action : undefined;
      const key = `${held.join(',')}|${flash ?? ''}`;
      if (key !== last) {
        last = key;
        setState({ held: new Set(held), flash, dir: keyboard.direction(), back: keyboard.isHeld('backFoot') });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return state;
}

function Key({ label, on, wide }: { label: string; on: boolean; wide?: boolean }) {
  return <kbd className={`k ${on ? 'on' : ''} ${wide ? 'wide' : ''}`}>{label}</kbd>;
}

/**
 * The controls, always on screen while you bat or bowl: every key lights up
 * as you press it, and the stroke keys show which shot they will play with
 * the direction you are holding.
 */
function ControlsPanel() {
  const snap = useGame((s) => s.snap);
  const help = useGame((s) => s.showHelp);
  const { held, flash, dir, back } = useKeys();
  if (help || !snap || snap.phase === 'inningsBreak' || snap.phase === 'complete' || snap.phase === 'chooseBowler') return null;
  if (snap.review && snap.review.kind !== 'ball') return null;
  const lit = (a: GameAction) => held.has(a) || flash === a;
  const arrows = (
    <div className="arrows" aria-hidden="true">
      <span />
      <Key label="↑" on={lit('up')} />
      <span />
      <Key label="←" on={lit('left')} />
      <Key label="↓" on={lit('down')} />
      <Key label="→" on={lit('right')} />
    </div>
  );
  if (snap.userBatting) {
    const hand = snap.striker.hand;
    const name = (a: 'ground' | 'loft' | 'defend' | 'sweep') => {
      const shot = shotFromInput(a, dir, back, hand);
      return shot.push ? 'Push into the gap' : SHOTS[shot.shot].name;
    };
    const rows: { a: GameAction; k: string; label: string }[] = [
      { a: 'ground', k: 'D', label: name('ground') },
      { a: 'loft', k: 'A', label: name('loft') },
      { a: 'defend', k: 'S', label: name('defend') },
      { a: 'sweep', k: 'W', label: name('sweep') },
      { a: 'leave', k: 'X', label: 'Leave' },
      { a: 'run', k: 'Space', label: snap.runsCalled > 0 ? `Run (${snap.runsCalled} called)` : 'Run' },
    ];
    return (
      <section className="keys" aria-label="Batting controls" data-testid="controls-panel">
        <div className="keys-head">
          <span>Batting</span>
          <span className="dim">aim, then press a stroke as the ball arrives</span>
        </div>
        <div className="keys-body">
          <div className="keys-aim">
            {arrows}
            <div className="aim-label">{dir.x === 0 && dir.y === 0 ? 'Direction' : 'Aiming'}</div>
            <Key label="Shift" on={lit('backFoot')} wide />
            <div className="aim-label">{back ? 'Back foot' : 'Front foot'}</div>
          </div>
          <ul>
            {rows.map((r) => (
              <li key={r.a} className={lit(r.a) ? 'on' : ''}>
                <Key label={r.k} on={lit(r.a)} wide={r.k.length > 1} />
                <span>{r.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    );
  }
  return (
    <section className="keys" aria-label="Bowling controls" data-testid="controls-panel">
      <div className="keys-head">
        <span>Bowling</span>
      </div>
      <div className="keys-body">
        <div className="keys-aim">
          {arrows}
          <div className="aim-label">Move the target</div>
        </div>
        <ul>
          <li className={lit('prevDelivery') || lit('nextDelivery') ? 'on' : ''}>
            <Key label="Q" on={lit('prevDelivery')} />
            <Key label="E" on={lit('nextDelivery')} />
            <span>Change delivery</span>
          </li>
          <li className={lit('bowl') ? 'on' : ''}>
            <Key label="Space" on={lit('bowl')} wide />
            <span>Run in, then release on the gold</span>
          </li>
        </ul>
      </div>
    </section>
  );
}

// --- Between balls ------------------------------------------------------------------------

/** "Next ball" prompt while the game waits after an ordinary ball. */
function NextPrompt() {
  const snap = useGame((s) => s.snap);
  const match = useGame((s) => s.match);
  const replaying = useGame((s) => s.replaying);
  if (!snap || !match || replaying) return null;
  const waiting = snap.phase === 'review' && snap.review?.kind === 'ball';
  const dead = snap.phase === 'delivery' && snap.ballPhase === 'dead';
  if (!waiting && !dead) return null;
  return (
    <button type="button" className={`next-prompt ${waiting ? 'ready' : ''}`} onClick={() => match.next()} data-testid="next-ball">
      {waiting ? (
        <>
          Next ball <kbd>Space</kbd> <span className="dim">or</span> <kbd>Enter</kbd>
        </>
      ) : (
        <>
          <kbd>Enter</kbd> <span className="dim">skip</span>
        </>
      )}
    </button>
  );
}

/** Start of an innings, end of an over, a wicket: what happened, the scorecard, and a key to carry on. */
function ReviewCard() {
  const snap = useGame((s) => s.snap);
  const match = useGame((s) => s.match);
  const replaying = useGame((s) => s.replaying);
  const review = snap?.review;
  if (!snap || !match || !review || review.kind === 'ball' || replaying) return null;
  const inn = match.current;
  const batting = match.side(inn.batting).team;
  const bowling = match.side(inn.bowling).team;
  const keeper = match.keeperOf(inn.bowling).name;
  const rate = inn.balls ? ((inn.runs / inn.balls) * 6).toFixed(2) : '0.00';
  const chase = snap.needed !== undefined && snap.ballsLeft !== undefined ? `${batting.name} need ${snap.needed} from ${snap.ballsLeft} balls` : undefined;
  const overLine = (o: { number: number; bowler: string; figures: { balls: number; maidens: number; runs: number; wickets: number } | undefined; balls: readonly string[]; runs: number }) => (
    <div className="over-line">
      <span className="over-title">End of over {o.number}</span>
      <span className="over-balls">
        {o.balls.map((b, i) => (
          <span key={i} className={b === 'W' ? 'ball w' : b === '4' || b === '6' ? 'ball b' : 'ball'}>
            {b}
          </span>
        ))}
      </span>
      <span>
        {o.runs} run{o.runs === 1 ? '' : 's'} · {o.bowler}{' '}
        {o.figures ? `${oversText(o.figures.balls)}-${o.figures.maidens}-${o.figures.runs}-${o.figures.wickets}` : ''}
      </span>
    </div>
  );
  return (
    <div className="overlay review" role="dialog" aria-label="Between balls" data-testid="review">
      <div className="panel wide">
        {review.kind === 'start' ? (
          <>
            <h2>{inn.target === undefined ? `${match.config.home.team.name} v ${match.config.away.team.name}` : 'Second innings'}</h2>
            <p className="lead">
              {inn.target === undefined ? snap.toss : `${batting.name} need ${inn.target} to win from ${match.config.overs} overs.`}{' '}
              <strong>{snap.userBatting ? 'You are batting.' : 'You are bowling.'}</strong>
            </p>
            {snap.userBatting ? (
              <ol className="howto">
                <li>
                  Hold an <kbd>arrow</kbd> for where to hit it (as you see it on screen); <kbd>Shift</kbd> for the back foot.
                </li>
                <li>
                  As the ball arrives press <kbd>D</kbd> ground shot, <kbd>A</kbd> lofted, <kbd>S</kbd> defend, <kbd>W</kbd> sweep, or <kbd>X</kbd> to leave. Press slightly early — the bat takes a moment to come down.
                </li>
                <li>
                  If you hit it, <kbd>Space</kbd> to run — again for each extra run.
                </li>
              </ol>
            ) : (
              <ol className="howto">
                <li>Choose the bowler with the number keys.</li>
                <li>
                  <kbd>Q</kbd>/<kbd>E</kbd> choose the delivery; the <kbd>arrows</kbd> move the target on the pitch.
                </li>
                <li>
                  <kbd>Space</kbd> to run in, <kbd>Space</kbd> again when the needle is in the gold.
                </li>
              </ol>
            )}
            <p className="dim small">The controls stay on screen at the bottom left. After every ball the game waits for you.</p>
          </>
        ) : review.kind === 'over' ? (
          <>
            {overLine(review.over)}
            <p className="lead">
              {batting.name} {inn.runs}/{inn.wickets} after {oversText(inn.balls)} overs · run rate {rate}
              {chase ? <> · {chase}</> : null}
            </p>
            <Scorecard innings={inn} batting={batting} bowling={bowling} />
          </>
        ) : (
          <>
            <div className="wicket-title">Wicket</div>
            <h2 className="dismissal">
              {review.batter.player.name} <span className="dim">{howOut(review.batter, keeper)}</span>{' '}
              <span className="figs">
                {review.batter.runs} ({review.batter.balls})
              </span>
            </h2>
            <p className="lead">
              {review.batter.fours} four{review.batter.fours === 1 ? '' : 's'}, {review.batter.sixes} six{review.batter.sixes === 1 ? '' : 'es'} · fall of wicket {review.fall.wicket}-{review.fall.runs} ({oversText(review.fall.balls)} ov) · partnership{' '}
              {review.partnership.runs} ({review.partnership.balls}){review.next ? <> · next in: <strong>{review.next}</strong></> : null}
            </p>
            {review.over ? overLine(review.over) : null}
            <Scorecard innings={inn} batting={batting} bowling={bowling} />
          </>
        )}
        <button type="button" className="continue" onClick={() => match.next()} autoFocus data-testid="continue-review">
          {review.kind === 'start' ? 'Start' : 'Continue'} <kbd>Enter</kbd>
        </button>
      </div>
    </div>
  );
}

/** While an action replay plays: a broadcast-style tag and how to skip it. */
function ReplayBadge() {
  const replaying = useGame((s) => s.replaying);
  const skip = useGame((s) => s.skipReplay);
  if (!replaying) return null;
  return (
    <>
      <div className="replay-tag" data-testid="replay">
        <span className="dot" aria-hidden="true" />
        Replay
      </div>
      <button type="button" className="next-prompt" onClick={skip}>
        <kbd>Enter</kbd> <span className="dim">skip replay</span>
      </button>
    </>
  );
}
