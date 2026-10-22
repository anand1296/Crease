import { useGame } from '../state/game.ts';
import { DELIVERY_TYPES } from '../game/bowling/deliveryTypes.ts';
import { effortSpeed } from '../game/bowling/execute.ts';
import type { BallOutcome } from '../game/session/deliveryCycle.ts';
import type { InningsState } from '../game/match/match.ts';
import { Scorecard } from './Scorecard.tsx';
import { HowToPlay } from './Menus.tsx';
import { useEffect, useRef, useState } from 'react';
import type { GameAction } from '../game/input/keyboard.ts';
import { keyboard } from '../game/input/keyboardInstance.ts';
import { type BatAction, shotFromInput } from '../game/input/battingControls.ts';
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
      <ThrowPrompt />
      <ScoreStrip />
      <DeliveryPanel />
      <OutcomeBanner />
      <RunPrompt />
      <BowlingPanel />
      <BowlerChoice />
      <Commentary />
      <ControlsPanel />
      <AutoplayControl />
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
          {snap.userSide === 'batting' ? 'You are batting' : 'You are bowling'}
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

/** Pitching length (metres in front of the striker's stumps) in a captain's words. */
export function lengthName(m: number): string {
  if (m <= 1.3) return 'Yorker';
  if (m <= 3.2) return 'Full';
  if (m <= 6.5) return 'Good length';
  if (m <= 8.8) return 'Back of a length';
  return m >= 9.8 ? 'Bouncer' : 'Short';
}

/** Where on the pitch it lands, across: metres from middle stump towards the batter's off side. */
export function lineName(m: number): string {
  if (m > 0.75) return 'wide outside off';
  if (m > 0.32) return 'outside off';
  if (m > 0.12) return 'just outside off';
  if (m > -0.12) return 'at the stumps';
  if (m > -0.4) return 'on the pads';
  return 'down the leg side';
}

const AMOUNT_NAME = { swing: 'Swing', cut: 'Cut', spin: 'Spin', none: '' } as const;
const STEPS = ['Delivery', 'Landing spot', 'Run-up'] as const;
const MOOD_NAME = { aggressive: 'Attacking', moderate: 'Balanced', defensive: 'Defensive' } as const;

/**
 * Bowling, one ball at a time: (1) choose the delivery, the side of the
 * wicket, the field and how much it should move; (2) place the landing
 * marker; (3) in the run-up, lock the pace on the meter (and still change
 * the amount). Every control is also shown as a key that lights when pressed.
 */
function BowlingPanel() {
  const snap = useGame((s) => s.snap);
  const match = useGame((s) => s.match);
  const help = useGame((s) => s.showHelp);
  const { held, flash } = useKeys();
  if (help || !snap || !match || !snap.userBowling) return null;
  const runningIn = snap.phase === 'delivery' && snap.ballPhase === 'runUp';
  if (snap.phase !== 'aiming' && !runningIn) return null;
  const lit = (a: GameAction) => held.has(a) || flash === a;
  const { setup, deliveries } = snap;
  const def = DELIVERY_TYPES[setup.type];
  const step = snap.phase === 'aiming' ? (snap.aimStep === 'type' ? 0 : 1) : 2;
  const preset = snap.presets.find((p) => p.id === snap.fieldPreset);
  const amount =
    def.variable === 'none' ? null : (
      <div className="bp-row">
        <span className="bp-label">{AMOUNT_NAME[def.variable]}</span>
        <span className="bp-amount" aria-label={`${AMOUNT_NAME[def.variable]} ${Math.round(setup.amount * 100)}%`}>
          {Array.from({ length: 10 }, (_, i) => (
            <i key={i} className={i < Math.round(setup.amount * 10) ? 'on' : ''} />
          ))}
        </span>
        <Key label="↑" on={lit('up')} />
        <Key label="↓" on={lit('down')} />
      </div>
    );
  return (
    <section className="keys bowl-panel" aria-label="Bowling controls" data-testid="bowling-panel" data-step={STEPS[step]}>
      <div className="keys-head">
        <span>Bowling</span>
        <button type="button" className="bp-side" onClick={() => match.toggleSide()} disabled={step === 2} data-testid="bowl-side">
          {setup.side === 'over' ? 'Over the wicket' : 'Around the wicket'} <Key label="O" on={lit('side')} />
        </button>
      </div>
      <ol className="bp-steps" aria-label="Steps">
        {STEPS.map((name, i) => (
          <li key={name} className={i === step ? 'now' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
            {name}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <>
          <div className="bp-deliveries" role="listbox" aria-label="Delivery">
            {deliveries.map((d, i) => (
              <button
                type="button"
                key={d}
                role="option"
                aria-selected={d === setup.type}
                className={d === setup.type ? 'chip on' : 'chip'}
                onClick={() => match.selectDelivery(d)}
              >
                <kbd>{i + 1}</kbd> {DELIVERY_TYPES[d].name}
              </button>
            ))}
          </div>
          <p className="bp-blurb">{def.blurb}</p>
          {amount}
          <div className="bp-row bp-field">
            <FieldMap dots={snap.fieldMap} />
            <div>
              <span className="bp-label">Field</span>
              <button type="button" className="bp-preset" onClick={() => match.cycleFieldPreset(1)} data-testid="field-preset">
                {preset ? preset.name : "Captain's field (auto)"}
              </button>
              <span className="dim small">
                {preset ? `${MOOD_NAME[preset.mood]} · ${preset.blurb}` : 'Set ball by ball for this batter and phase'}
              </span>
              <span className="bp-keys">
                <Key label="F" on={lit('field')} /> <span className="dim small">next · Shift+F back</span>
              </span>
            </div>
          </div>
          <div className="bp-go">
            <Key label="Space" on={lit('bowl')} wide /> <span>Choose where it lands</span>
          </div>
        </>
      ) : step === 1 ? (
        <>
          <div className="bp-target">
            <strong>{lengthName(setup.length)}</strong>, {lineName(setup.line)}
            <span className="dim small"> · {setup.length.toFixed(1)} m from the stumps</span>
          </div>
          <div className="bp-row">
            <div className="arrows" aria-hidden="true">
              <span />
              <Key label="↑" on={lit('up')} />
              <span />
              <Key label="←" on={lit('left')} />
              <Key label="↓" on={lit('down')} />
              <Key label="→" on={lit('right')} />
            </div>
            <span className="dim">Move the marker to where it should pitch: ↑ fuller, ↓ shorter.</span>
          </div>
          <div className="bp-go">
            <Key label="Space" on={lit('bowl')} wide /> <span>Lock it and run in</span>
          </div>
          <div className="bp-back">
            <Key label="Backspace" on={lit('back')} wide /> <span className="dim">{def.name}: change delivery</span>
          </div>
        </>
      ) : (
        <>
          <div className="bp-row">
            <span className="bp-label">Pace</span>
            <div className="pace-meter" aria-label="Pace">
              <span className="zone-red" />
              {snap.lockedPace === undefined ? <PaceNeedle /> : <span className="needle locked" style={{ left: `${snap.lockedPace * 100}%` }} />}
            </div>
          </div>
          <div className="bp-target">
            {snap.lockedPace === undefined ? (
              <span className="dim">Lock the pace: further right is quicker; the red is flat out and costs control.</span>
            ) : (
              <span>
                Locked at <strong>{Math.round(snap.lockedPace * 100)}%</strong> · about{' '}
                <strong>{Math.round(snap.deliveryKph * effortSpeed(snap.lockedPace) * (def.variable === 'spin' ? 1.04 - 0.08 * setup.amount : 1))} km/h</strong>
                {snap.lockedPace > 0.9 ? ' · flat out' : ''}
              </span>
            )}
          </div>
          {amount}
          <div className="bp-go">
            <Key label="Space" on={lit('bowl')} wide /> <span>{snap.lockedPace === undefined ? 'Lock the pace' : `${def.name}, ${lengthName(setup.length).toLowerCase()}`}</span>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Fielding: the ball is in hand and the batters are running. Hold ↑ to
 * throw to the keeper or ↓ to the bowler; the longer the hold, the harder
 * the throw — the green is quick and accurate, the red is forced and wild.
 */
function ThrowPrompt() {
  const waiting = useGame((s) => s.snap?.awaitingThrow ?? false);
  const { held } = useKeys();
  if (!waiting) return null;
  const end = held.has('up') ? 'keeper' : held.has('down') ? 'bowler' : undefined;
  return (
    <div className="throw-prompt" role="status" data-testid="throw-prompt">
      <strong>Throw it in!</strong>
      <div className="throw-ends">
        <span className={end === 'keeper' ? 'on' : ''}>
          <Key label="↑" on={end === 'keeper'} /> keeper&apos;s end
        </span>
        <span className={end === 'bowler' ? 'on' : ''}>
          <Key label="↓" on={end === 'bowler'} /> bowler&apos;s end
        </span>
      </div>
      <div className="throw-meter" aria-label="Throw power">
        <span className="zone-good" />
        <span className="zone-wild" />
        <ThrowNeedle />
      </div>
      <span className="dim small">Hold for power, let go to throw</span>
    </div>
  );
}

function ThrowNeedle() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const place = (m: number) => {
      if (ref.current) ref.current.style.left = `${(Math.min(1.2, m) / 1.2) * 100}%`;
    };
    place(0);
    return useGame.subscribe((st, prev) => {
      if (st.meter !== prev.meter) place(st.meter);
    });
  }, []);
  return <span ref={ref} className="needle" />;
}

/**
 * The pace needle sweeps every frame during the run-up: it is moved directly
 * rather than re-rendering the panel sixty times a second.
 */
function PaceNeedle() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const place = (m: number) => {
      if (ref.current) ref.current.style.left = `${m * 100}%`;
    };
    place(useGame.getState().meter);
    return useGame.subscribe((st, prev) => {
      if (st.meter !== prev.meter) place(st.meter);
    });
  }, []);
  return <span ref={ref} className="needle" />;
}

/** The field from above, as seen from behind the bowler: striker's end at the top. */
function FieldMap({ dots }: { dots: readonly { x: number; z: number; role: 'keeper' | 'bowler' | 'fielder' }[] }) {
  const r = 46;
  const k = r / 66;
  return (
    <svg className="field-map" viewBox="-50 -50 100 100" width="96" height="96" aria-label="Field placings" role="img">
      <circle r={r} className="fm-ground" />
      <circle r={27.43 * k} className="fm-circle" />
      <rect x={-1.5} y={-10.1 * k} width={3} height={20.2 * k} className="fm-pitch" />
      {dots.map((d, i) => (
        <circle key={i} cx={-d.x * k} cy={-d.z * k} r={d.role === 'fielder' ? 2.6 : 2.2} className={`fm-${d.role}`} />
      ))}
    </svg>
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
      <p className="small chooser-field">
        Field: <strong>{snap.presets.find((p) => p.id === snap.fieldPreset)?.name ?? "Captain's field (auto)"}</strong>{' '}
        <span className="dim">· F to change</span>
      </p>
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
    const watched: GameAction[] = ['left', 'right', 'up', 'down', 'lofted', 'shotFront', 'shotBack', 'shotFeet', 'leave', 'run', 'bowl', 'nextDelivery', 'prevDelivery', 'field', 'side', 'back'];
    let last = '';
    let fade: ReturnType<typeof setTimeout> | undefined;
    // Runs inside the key event, so the key lights up in the very next paint.
    const update = () => {
      const held = watched.filter((a) => keyboard.isHeld(a));
      const lp = keyboard.lastPress;
      const age = lp ? performance.now() - lp.at : Infinity;
      const flash = lp && age < 450 ? lp.action : undefined;
      if (flash) {
        clearTimeout(fade);
        fade = setTimeout(update, 450 - age + 10);
      }
      const key = `${held.join(',')}|${flash ?? ''}`;
      if (key !== last) {
        last = key;
        setState({ held: new Set(held), flash, dir: keyboard.direction(), back: keyboard.isHeld('lofted') });
      }
    };
    const unsubscribe = keyboard.subscribe(update);
    update();
    return () => {
      unsubscribe();
      clearTimeout(fade);
    };
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
/**
 * How well the stroke was timed: a gauge from early to late with the
 * perfect zone in the middle, shown from the moment of contact until the
 * next ball. Positions are in units of the stroke's timing window, so a
 * fast ball's narrower window shows up as a bigger error.
 */
function TimingGauge() {
  const contact = useGame((s) => s.snap?.contact);
  if (!contact || contact.kind === 'leave') return null;
  const t = Math.max(-2.5, Math.min(2.5, contact.timing));
  const ms = Math.round(contact.timingSeconds * 1000);
  const word =
    contact.kind === 'miss'
      ? 'Missed'
      : Math.abs(t) < 0.3
        ? 'Perfect'
        : Math.abs(t) < 0.8
          ? t < 0 ? 'A touch early' : 'A touch late'
          : t < 0 ? 'Early' : 'Late';
  const tone = contact.kind === 'miss' ? 'bad' : Math.abs(t) < 0.3 ? 'good' : Math.abs(t) < 0.8 ? 'ok' : 'bad';
  return (
    <div className="timing" data-testid="timing-gauge" aria-label={`Timing: ${word}, ${ms} ms`}>
      <div className="timing-head">
        <span className="dim">Timing</span>
        <strong className={tone}>{word}</strong>
        <span className="dim">{ms === 0 ? '0 ms' : ms < 0 ? `${-ms} ms early` : `${ms} ms late`}</span>
      </div>
      <div className="timing-bar">
        <span className="zone ok" />
        <span className="zone good" />
        <span className={`mark ${tone}`} style={{ left: `${50 + (t / 2.5) * 50}%` }} />
      </div>
      <div className="timing-scale dim">
        <span>early</span>
        <span>late</span>
      </div>
    </div>
  );
}

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
    const name = (a: BatAction) => {
      const shot = shotFromInput(a, dir, back, hand);
      return SHOTS[shot.shot].name;
    };
    const struck = snap.ballPhase === 'struck';
    const rows: { a: GameAction; k: string; label: string; what: string }[] = [
      { a: 'shotFront', k: 'S', what: 'Front foot', label: name('front') },
      { a: 'shotBack', k: 'W', what: 'Back foot', label: name('back') },
      { a: 'shotFeet', k: 'D', what: struck ? 'Run' : 'Use your feet', label: struck ? (snap.runsCalled > 0 ? `${snap.runsCalled} called` : 'call a run') : `${name('feet')}` },
      { a: 'leave', k: 'A', what: 'Leave', label: '' },
    ];
    return (
      <section className="keys" aria-label="Batting controls" data-testid="controls-panel">
        <div className="keys-head">
          <span>Batting</span>
          <span className="dim">aim with the arrows, press a shot as the ball arrives</span>
        </div>
        <div className="keys-body">
          <div className="keys-aim">
            {arrows}
            <div className="aim-label">{dir.x === 0 && dir.y === 0 ? 'No arrow: defend' : '↓ is straight'}</div>
            <Key label="Shift" on={lit('lofted')} wide />
            <div className="aim-label">{back ? 'Lofted' : 'Along the ground'}</div>
          </div>
          <ul>
            {rows.map((r) => (
              <li key={r.a} className={lit(r.a) ? 'on' : ''}>
                <Key label={r.k} on={lit(r.a)} />
                <span className="what">{r.what}</span>
                <span>{r.label}</span>
              </li>
            ))}
            <li className={lit('run') ? 'on' : ''}>
              <Key label="Space" on={lit('run')} wide />
              <span className="what">Run</span>
              <span>{snap.runsCalled > 0 ? `${snap.runsCalled} called` : ''}</span>
            </li>
          </ul>
        </div>
        <TimingGauge />
      </section>
    );
  }
  // Bowling has its own panel (BowlingPanel), which shows its keys.
  return null;
}

/**
 * Autoplay: hand your side to the computer for the rest of the over or the
 * innings, and take it back. Top left, out of the way of play.
 */
function AutoplayControl() {
  const snap = useGame((s) => s.snap);
  const match = useGame((s) => s.match);
  const replaying = useGame((s) => s.replaying);
  if (!snap || !match || !snap.userSide || replaying) return null;
  if (snap.phase === 'inningsBreak' || snap.phase === 'complete') return null;
  const role = snap.userSide === 'batting' ? 'batting' : 'bowling';
  if (snap.autoplay !== 'off') {
    return (
      <div className="autoplay on" data-testid="autoplay" data-mode={snap.autoplay} role="status">
        <span className="autoplay-dot" aria-hidden="true" />
        <span>
          Autoplay: the computer is {role} for you {snap.autoplay === 'over' ? 'to the end of the over' : 'for the rest of the innings'}
        </span>
        <button type="button" onClick={() => match.stopAutoplay()} data-testid="autoplay-stop">
          Take over <kbd>{snap.autoplay === 'over' ? 'Y' : 'U'}</kbd>
        </button>
      </div>
    );
  }
  if (snap.autoplaying) {
    return (
      <div className="autoplay on" data-testid="autoplay" data-mode="ending" role="status">
        <span>You take over from the next ball</span>
      </div>
    );
  }
  return (
    <div className="autoplay" data-testid="autoplay" data-mode="off">
      <span className="dim">Autoplay</span>
      <button type="button" onClick={() => match.startAutoplay('over')} data-testid="autoplay-over">
        {snap.balls % 6 === 0 ? 'Next over' : 'Rest of over'} <kbd>Y</kbd>
      </button>
      <button type="button" onClick={() => match.startAutoplay('innings')} data-testid="autoplay-innings">
        Innings <kbd>U</kbd>
      </button>
    </div>
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
                  Hold an <kbd>arrow</kbd> for where to hit it, as you see it on screen: <kbd>↓</kbd> straight, <kbd>←</kbd>/<kbd>→</kbd> square.
                  Hold <kbd>Shift</kbd> to loft it.
                </li>
                <li>
                  As the ball arrives press <kbd>S</kbd> front foot, <kbd>W</kbd> back foot, <kbd>D</kbd> to come down the pitch, or{' '}
                  <kbd>A</kbd> to leave (a shot key alone defends). Press slightly early — the bat takes a moment to come down.
                </li>
                <li>
                  If you hit it, <kbd>Space</kbd> (or <kbd>D</kbd>) to run — again for each extra run.
                </li>
              </ol>
            ) : (
              <ol className="howto">
                <li>Choose the bowler with the number keys, then the delivery (<kbd>1</kbd>–<kbd>6</kbd>), how much it moves (<kbd>↑</kbd>/<kbd>↓</kbd>), the side (<kbd>O</kbd>) and the field (<kbd>F</kbd>).</li>
                <li>
                  <kbd>Space</kbd>, then the <kbd>arrows</kbd> place the marker where it should pitch; <kbd>Space</kbd> runs in.
                </li>
                <li>
                  <kbd>Space</kbd> again to lock the pace on the meter. In the field, hold <kbd>↑</kbd>/<kbd>↓</kbd> to throw to the keeper or bowler.
                </li>
              </ol>
            )}
            <p className="dim small">
              The controls stay on screen at the bottom left. After every ball the game waits for you — or let the computer play the
              over (<kbd>Y</kbd>) or the innings (<kbd>U</kbd>).
            </p>
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
