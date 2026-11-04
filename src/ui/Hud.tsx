import { TouchControls } from './TouchControls.tsx';
import { achievement } from '../game/achievements.ts';
import { useGame } from '../state/game.ts';
import { challenge } from '../game/practice/challenges.ts';
import { CIRCLE, checkField, customPosition } from '../game/fielding/presets.ts';
import { type FieldPosition, fieldPositionXZ } from '../game/data/fieldPositions.ts';
import { STRIKER_STUMPS_Z } from '../game/data/field.ts';
import { DELIVERY_TYPES } from '../game/bowling/deliveryTypes.ts';
import { effortSpeed } from '../game/bowling/execute.ts';
import type { BallOutcome } from '../game/session/deliveryCycle.ts';
import type { InningsState } from '../game/match/match.ts';
import { Scorecard } from './Scorecard.tsx';
import { MatchStats } from './MatchStats.tsx';
import { HowToPlay } from './Menus.tsx';
import { useEffect, useRef, useState } from 'react';
import type { GameAction } from '../game/input/keyboard.ts';
import { keyboard } from '../game/input/keyboardInstance.ts';
import { type ArrowScheme, type BatAction, fieldRegion, shotAngle, shotFromInput } from '../game/input/battingControls.ts';
import { type Coaching, comboLabel } from '../game/batting/coaching.ts';
import { NETS_BALLS } from '../game/practice/nets.ts';
import { SHOTS, type ShotAttempt } from '../game/batting/shots.ts';
import type { Hand } from '../game/model/player.ts';
import { howOut } from './Scorecard.tsx';
import { oversText } from '../game/match/match.ts';
import { REVIEW_WINDOW } from '../game/simulation/tracking.ts';
import { DRS_TIMES } from '../game/match/match.ts';
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
      <StrokeCard />
      <AutoplayControl />
      <ChallengeCard />
      <NetsPanel />
      <FieldEditor />
      <AppealPrompt />
      <DrsPanel />
      <NextPrompt />
      <ReviewCard />
      <ReplayBadge />
      <InningsBreak />
      <Result />
      <HelpOverlay />
      <PauseOverlay />
      <AchievementToast />
      <TouchControls />
    </>
  );
}

/** A thin bar: confidence (gold) or stamina (green, amber, red as it runs out). */
function Meter({ kind, value, label }: { kind: 'confidence' | 'stamina'; value: number; label: string }) {
  const v = Math.max(0, Math.min(1, value));
  const tone = kind === 'confidence' ? 'conf' : v > 0.6 ? 'good' : v > 0.3 ? 'ok' : 'bad';
  return (
    <span className={`meter ${kind}`} title={label} aria-label={label} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
      <span className={tone} style={{ width: `${v * 100}%` }} />
    </span>
  );
}

function FormBars({ form }: { form: { confidence: number; fatigue: number } }) {
  return (
    <span className="form-bars">
      <Meter kind="confidence" value={form.confidence} label={`Confidence ${Math.round(form.confidence * 100)}%`} />
      <Meter kind="stamina" value={1 - form.fatigue} label={`Stamina ${Math.round((1 - form.fatigue) * 100)}%`} />
    </span>
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
          <FormBars form={striker.form} />
        </span>
        <span>
          <i aria-hidden="true" />
          {nonStriker.name} <b>{fig(nonStriker.card)}</b>
          <FormBars form={nonStriker.form} />
        </span>
      </div>
      <div className="sb-bowler">
        <span>
          {bowler.name} <b>{bowler.card ? `${bowler.card.wickets}-${bowler.card.runs}` : '0-0'}</b> <small>{bowlerOvers}</small>
          <Meter kind="stamina" value={1 - bowler.fatigue} label={`Stamina ${Math.round((1 - bowler.fatigue) * 100)}%${bowler.spell > 1 ? `, ${bowler.spell} overs in this spell` : ''}`} />
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
          <span className="drs-tag" title="Unsuccessful reviews left this innings" data-testid="reviews-left">
            DRS {snap.userSide === 'bowling' ? snap.reviews.bowling : snap.reviews.batting}
          </span>
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
  const freeHit = useGame((s) => s.snap?.freeHit ?? false);
  const superOver = useGame((s) => s.snap?.superOver ?? false);
  const hatTrick = useGame((s) => s.snap?.hatTrickBall ?? false);
  return (
    <section className="hud-card delivery" aria-label="Last delivery">
      {superOver ? (
        <div className="badge super-over" data-testid="super-over">
          Super over
        </div>
      ) : null}
      {freeHit ? (
        <div className="badge free-hit" data-testid="free-hit">
          Free hit
        </div>
      ) : null}
      {hatTrick ? (
        <div className="badge hat-trick" data-testid="hat-trick">
          On a hat-trick
        </div>
      ) : null}
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
  // The stroke card on the right has the timing; in the nets it has everything.
  const coached = useGame((s) => s.snap?.coaching !== undefined);
  const nets = useGame((s) => s.snap?.nets !== undefined);
  const visible = !nets && o && phase !== 'appeal' && phase !== 'drs' && (phase === 'between' || phase === 'aiming' || ballPhase === 'dead' || (phase === 'review' && reviewKind === 'ball'));
  if (!o || !visible) return null;
  const t = coached ? null : timingText(o);
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
  const touch = useGame((s) => s.touchActive);
  if (!snap || !snap.userBatting || snap.ballPhase !== 'struck') return null;
  return (
    <div className="run-prompt" role="status" data-testid="run-prompt">
      {snap.runsCalled === 0 ? (
        touch ? (
          <>Tap Run to run</>
        ) : (
          <>
            <kbd>Space</kbd> run
          </>
        )
      ) : touch ? (
        <>Running {snap.runsCalled} · Run again for another</>
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
                {snap.fieldPreset === 'custom' ? 'Your own field' : preset ? preset.name : "Captain's field (auto)"}
              </button>
              <span className="dim small">
                {snap.fieldPreset === 'custom'
                  ? 'Placed by you'
                  : preset
                    ? `${MOOD_NAME[preset.mood]} · ${preset.blurb}`
                    : 'Set ball by ball for this batter and phase'}
              </span>
              <span className="bp-keys">
                <Key label="F" on={lit('field')} /> <span className="dim small">next · Shift+F back ·</span>{' '}
                <button type="button" className="bp-edit" onClick={() => useGame.getState().setFieldEditor(true)} data-testid="edit-field">
                  <Key label="G" on={lit('editField')} /> edit
                </button>
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
        Field: <strong>{snap.fieldPreset === 'custom' ? 'Your own field' : (snap.presets.find((p) => p.id === snap.fieldPreset)?.name ?? "Captain's field (auto)")}</strong>{' '}
        <span className="dim">· F to change, G to place it yourself</span>
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
  const first = snap.innings[snap.innings.length - 1];
  if (!first) return null;
  const batting = match.side(first.batting).team;
  const bowling = match.side(first.bowling).team;
  const chaser = bowling;
  const tied = match.superOverNext;
  const superOver = snap.innings.length > 2;
  return (
    <div className="overlay" role="dialog" aria-label="Innings break" data-testid="innings-break">
      <div className="panel wide">
        <h2>{tied ? 'Scores level — super over!' : superOver ? 'Super over: the chase' : 'Innings break'}</h2>
        <p>
          {tied ? (
            <>
              {first.runs} apiece. One over each, two wickets: <strong>{batting.name}</strong> bat first.
            </>
          ) : (
            <>
              {chaser.name} need <strong>{first.runs + 1}</strong> to win from {superOver ? 'one over' : `${snap.maxOvers} overs`}.
            </>
          )}
        </p>
        <Scorecard innings={first} batting={batting} bowling={bowling} />
        {superOver || tied ? null : <Coach notes={snap.coach} />}
        <button type="button" onClick={() => match.continueAfterBreak()} autoFocus data-testid="continue">
          {tied ? 'On to the super over (Enter)' : 'Start the chase (Enter)'}
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
  if (snap.challenge) return <PracticeResult />;
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
  const match = useGame((s) => s.match);
  const [tab, setTab] = useState<'menu' | 'scorecard' | 'stats'>('menu');
  if (!paused) return null;
  const tabs = [
    ['menu', 'Paused'],
    ['scorecard', 'Scorecard'],
    ['stats', 'Stats'],
  ] as const;
  return (
    <div className="overlay" role="dialog" aria-label="Paused" data-testid="pause">
      <div className={`panel${tab === 'menu' ? '' : ' wide pause-wide'}`}>
        <div className="pause-tabs" role="tablist">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)} data-testid={`pause-${id}`}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'menu' ? (
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
            <SaveButton />
            <button type="button" className="secondary" onClick={rematch}>
              Restart match
            </button>
            <button type="button" className="secondary" onClick={quit}>
              Quit to main menu
            </button>
          </div>
        ) : match && tab === 'scorecard' ? (
          <div className="cards pause-scroll" data-testid="pause-scorecards">
            {match.innings
              .map((inn, i) => <Scorecard key={i} innings={inn} batting={match.side(inn.batting).team} bowling={match.side(inn.bowling).team} />)
              .reverse()}
          </div>
        ) : match ? (
          <div className="pause-scroll">
            <MatchStats match={match} />
          </div>
        ) : null}
        {tab !== 'menu' ? (
          <div className="buttons row">
            <button type="button" onClick={() => setPaused(false)}>
              Resume (P)
            </button>
          </div>
        ) : null}
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
export function useKeys(): { held: ReadonlySet<GameAction>; flash: GameAction | undefined; dir: { x: -1 | 0 | 1; y: -1 | 0 | 1 }; back: boolean } {
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
  const scale = useGame((s) => s.snap?.timingScale ?? 1);
  const confidence = useGame((s) => s.snap?.striker.form.confidence ?? 0.5);
  // How wide the batter's sweet spot is just now (confidence and tiredness): the timing itself is on the stroke card.
  const RANGE = 2.5;
  const perfect = 0.3 * scale;
  const ok = 0.8 * scale;
  const zone = (half: number) => ({ left: `${50 - (half / RANGE) * 50}%`, width: `${(half / RANGE) * 100}%` });
  const feel = confidence > 0.7 ? 'Seeing it well' : confidence > 0.45 ? 'Settled' : confidence > 0.3 ? 'Uncertain' : 'Nervous';
  return (
    <div className="timing" data-testid="timing-gauge" aria-label={`Timing window: ${feel}`}>
      <div className="timing-head">
        <span className="dim">Timing window</span>
        <strong>{feel}</strong>
      </div>
      <div className="timing-bar">
        <span className="zone ok" style={zone(ok)} />
        <span className="zone good" style={zone(perfect)} />
      </div>
      <div className="timing-scale dim">
        <span>early</span>
        <span>sweet spot {scale >= 1 ? `+${Math.round((scale - 1) * 100)}` : `−${Math.round((1 - scale) * 100)}`}%</span>
        <span>late</span>
      </div>
    </div>
  );
}

/**
 * Where the front-foot (filled) and back-foot (ring) strokes will go, on a
 * small plan of the ground as the camera sees it: the batter in the middle,
 * straight down the ground towards the bottom, his off side on the left
 * for a right-hander.
 */
function FieldRadar({ hand, front, back, scheme }: { hand: Hand; front: ShotAttempt; back: ShotAttempt; scheme: ArrowScheme }) {
  // Drawn the way the arrows read: batter arrows put his right on the right (a left-hander's off side on the left),
  // screen arrows the picture from behind the bowler (a right-hander's off side on the left).
  const offLeft = scheme === 'screen' ? hand === 'right' : hand === 'left';
  const at = (a: ShotAttempt) => {
    const kind = SHOTS[a.shot].kind;
    if (kind === 'leave' || (kind === 'defence' && !a.push)) return undefined;
    const rad = (shotAngle(a) * Math.PI) / 180;
    const r = kind === 'loft' || a.shot === 'slogSweep' ? 26 : 19;
    return { x: 30 + (offLeft ? -1 : 1) * Math.sin(rad) * r, y: 30 + Math.cos(rad) * r };
  };
  const f = at(front);
  const b = at(back);
  return (
    <svg className="radar" viewBox="0 0 60 60" width="60" height="60" aria-hidden="true">
      <circle cx="30" cy="30" r="28" className="radar-ground" />
      <circle cx="30" cy="30" r="14" className="radar-ring" />
      <rect x="28.6" y="22" width="2.8" height="16" className="radar-pitch" />
      {b ? <line x1="30" y1="30" x2={b.x} y2={b.y} className="radar-back" /> : null}
      {b ? <circle cx={b.x} cy={b.y} r="3" className="radar-back-dot" /> : null}
      {f ? <line x1="30" y1="30" x2={f.x} y2={f.y} className="radar-front" /> : null}
      {f ? <circle cx={f.x} cy={f.y} r="3.2" className="radar-front-dot" /> : null}
    </svg>
  );
}

/** Controller buttons for the keys the panels show (see input/gamepad.ts). */
const PAD_LABEL: Readonly<Record<string, string>> = { S: 'A', W: 'X', D: 'Y', A: 'B', Shift: 'RT', Space: 'LT', Q: 'LB', E: 'RB' };

const TIMING_RANGE = 160;

/**
 * The batter's clipboard, on the right: the moment the bat comes down, how
 * early or late the press was on a big meter; then the sweet spot, the ball
 * as the coach saw it, what went wrong and the keys for it next time.
 */
function StrokeCard() {
  const snap = useGame((s) => s.snap);
  const tips = useGame((s) => s.coachTips);
  const toggleTips = useGame((s) => s.toggleCoachTips);
  const replaying = useGame((s) => s.replaying);
  const nets = useGame((s) => s.match?.config.nets !== undefined);
  const pad = useGame((s) => s.padActive);
  if (!snap || replaying) return null;
  const c = snap.coaching;
  const live = snap.stroke;
  if (!c && !live) return null;
  const ms = c ? c.pressMs : live?.pressMs;
  const word = c ? c.timingWord : ms === undefined ? 'Perfect' : Math.abs(ms) <= 25 ? 'Perfect' : ms < 0 ? 'Early' : 'Late';
  const tone = word === 'Perfect' || word === 'Left' ? 'good' : word === 'No shot' ? 'ok' : Math.abs(ms ?? 0) <= 60 && word !== 'Too late' ? 'ok' : 'bad';
  const at = ms === undefined ? 50 : 50 + (Math.max(-TIMING_RANGE, Math.min(TIMING_RANGE, ms)) / TIMING_RANGE) * 50;
  const zone = (half: number) => ({ left: `${50 - (half / TIMING_RANGE) * 50}%`, width: `${(half / TIMING_RANGE) * 100}%` });
  const showTips = tips || nets;
  return (
    <section className={`stroke-card ${c?.verdict ?? ''}`} aria-label="Your stroke" data-testid="stroke-card">
      <div className="sc-head">
        <strong className={`sc-word ${tone}`}>{word}</strong>
        <span className="sc-ms">{ms === undefined || word === 'No shot' || word === 'Left' ? '' : ms === 0 ? 'spot on' : `${Math.abs(ms)} ms ${ms < 0 ? 'early' : 'late'}`}</span>
      </div>
      {word !== 'No shot' && word !== 'Left' ? (
        <div className="sc-meter" aria-hidden="true">
          <span className="zone ok" style={zone(60)} />
          <span className="zone good" style={zone(25)} />
          <span className="sc-centre" />
          {ms !== undefined ? <span className={`sc-needle ${tone}`} style={{ left: `${at}%` }} /> : null}
          <span className="sc-end left">early</span>
          <span className="sc-end right">late</span>
        </div>
      ) : null}
      {c ? (
        <>
          <div className="sc-facts">
            <span>{c.played}</span>
            {c.sweetSpot !== undefined ? (
              <span>
                sweet spot <b className={c.sweetSpot >= 70 ? 'good' : c.sweetSpot >= 40 ? 'ok' : 'bad'}>{c.sweetSpot}%</b>
                {c.whereOnBat && c.whereOnBat !== 'the middle' ? ` · ${c.whereOnBat}` : ''}
              </span>
            ) : c.timingWord !== 'No shot' && c.timingWord !== 'Left' ? (
              <span className="bad">missed</span>
            ) : null}
          </div>
          <div className="sc-ball">{c.ball.words}</div>
          {showTips ? (
            <>
              <ul className="sc-points">
                {c.points.slice(0, nets ? 4 : 2).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              <div className="sc-try">
                <span className="dim">To this ball:</span>
                {c.options.map((o) => (
                  <span key={o.name} className="sc-option" title={`to ${o.region}`}>
                    {o.name} <kbd>{comboLabel(o.combo, pad)}</kbd>
                  </span>
                ))}
              </div>
            </>
          ) : null}
          {nets ? null : (
            <button type="button" className="sc-toggle" onClick={toggleTips} data-testid="coach-tips">
              {tips ? 'Hide coaching' : 'Coaching tips'}
            </button>
          )}
        </>
      ) : null}
    </section>
  );
}

function ControlsPanel() {
  const snap = useGame((s) => s.snap);
  const help = useGame((s) => s.showHelp);
  const { held, flash, dir, back } = useKeys();
  const scheme = useGame((s) => s.arrows);
  const toggleArrows = useGame((s) => s.toggleArrows);
  const pad = useGame((s) => s.padActive);
  // With a controller in hand, its buttons instead of the keys.
  const K = (key: string) => (pad ? (PAD_LABEL[key] ?? key) : key);
  if (help || !snap || snap.phase === 'inningsBreak' || snap.phase === 'complete' || snap.phase === 'chooseBowler' || snap.phase === 'appeal' || snap.phase === 'drs') return null;
  if (snap.review && snap.review.kind !== 'ball' && snap.review.kind !== 'ready') return null;
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
    const shot = (a: BatAction) => shotFromInput(a, dir, back, hand, scheme);
    const name = (a: BatAction) => SHOTS[shot(a).shot].name;
    const where = (a: BatAction) => fieldRegion(shot(a));
    const struck = snap.ballPhase === 'struck';
    const rows: { a: GameAction; k: string; label: string; what: string; to?: string }[] = [
      struck
        ? { a: 'shotFront', k: K('S'), what: 'Dive', label: 'for the crease, near the end of a run' }
        : { a: 'shotFront', k: K('S'), what: 'Front foot', label: name('front'), to: where('front') },
      { a: 'shotBack', k: K('W'), what: 'Back foot', label: struck ? '' : name('back'), ...(struck ? {} : { to: where('back') }) },
      struck
        ? { a: 'shotFeet', k: K('D'), what: 'Run', label: snap.runsCalled > 0 ? `${snap.runsCalled} called` : 'call a run' }
        : { a: 'shotFeet', k: K('D'), what: 'Use your feet', label: name('feet'), to: where('feet') },
      { a: 'leave', k: K('A'), what: struck ? 'Send back' : 'Leave', label: struck ? '“No!” — call off the run' : '' },
    ];
    const shuffling = snap.ballPhase === 'runUp';
    return (
      <section className="keys" aria-label="Batting controls" data-testid="controls-panel">
        <div className="keys-head">
          <span>Batting</span>
          <span className="dim">{pad ? 'aim with the stick, press a shot as the ball arrives' : 'aim with the arrows, press a shot as the ball arrives'}</span>
        </div>
        <div className="keys-body">
          <div className="keys-aim">
            {arrows}
            <FieldRadar hand={hand} front={shot('front')} back={shot('back')} scheme={scheme} />
            <div className="aim-label">{dir.x === 0 && dir.y === 0 ? 'No arrow: defend' : '↓ is straight'}</div>
            <button type="button" className="aim-scheme" onClick={toggleArrows} title="Switch how the arrows aim" data-testid="arrow-scheme">
              {scheme === 'batter' ? '→ his right' : '← screen-left'}
            </button>
            <Key label={K('Shift')} on={lit('lofted')} wide />
            <div className="aim-label">{struck ? (back ? 'Sprinting' : 'Hold to sprint') : back ? 'Lofted' : 'Along the ground'}</div>
          </div>
          <ul>
            {rows.map((r) => (
              <li key={r.a} className={lit(r.a) ? 'on' : ''}>
                <Key label={r.k} on={lit(r.a)} />
                <span className="what">{r.what}</span>
                <span>
                  {r.label}
                  {r.to ? <span className="where"> to {r.to}</span> : null}
                </span>
              </li>
            ))}
            <li className={lit('run') ? 'on' : ''}>
              <Key label={K('Space')} on={lit('run')} wide />
              <span className="what">Run</span>
              <span>{snap.runsCalled > 0 ? `${snap.runsCalled} called` : ''}</span>
            </li>
            <li className={`${lit('prevDelivery') || lit('nextDelivery') ? 'on' : ''} ${shuffling ? '' : 'dim'}`}>
              <Key label={K('Q')} on={lit('prevDelivery')} />
              <Key label={K('E')} on={lit('nextDelivery')} />
              <span className="what">Shuffle</span>
              <span>{shuffling ? 'across the crease, to leg / to off' : 'before the ball is bowled'}</span>
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

/** Re-renders every `ms` while `on` (for countdowns that run on the match clock). */
function useTicker(on: boolean, ms = 200): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => setTick((n) => n + 1), ms);
    return () => window.clearInterval(id);
  }, [on, ms]);
}

/**
 * An lbw decision: given or not, and — for the side that lost it — the
 * chance to review it within 15 seconds (T), or accept it (Enter).
 */
function AppealPrompt() {
  const snap = useGame((s) => s.snap);
  const match = useGame((s) => s.match);
  const a = snap?.appeal;
  useTicker(a !== undefined);
  if (!snap || !match || !a || snap.phase !== 'appeal') return null;
  const left = Math.max(0, Math.ceil(REVIEW_WINDOW - (match.appeal?.waited ?? 0)));
  const out = a.onField === 'out';
  return (
    <div className={`appeal ${out ? 'given' : 'not-given'}`} role="alertdialog" aria-label="LBW decision" data-testid="appeal">
      <div className="appeal-head">
        <span className="dim">LBW appeal</span>
        <strong>{out ? 'OUT' : 'NOT OUT'}</strong>
      </div>
      {a.yours ? (
        <>
          <p>
            {out ? 'Given out. Do you want to review it?' : 'Not given. Do you want to review it?'} {a.reviewsLeft} review{a.reviewsLeft === 1 ? '' : 's'} left.
          </p>
          <div className="appeal-actions">
            <button type="button" className="primary" onClick={() => match.requestReview()} data-testid="review-yes">
              Review <kbd>T</kbd>
            </button>
            <button type="button" onClick={() => match.acceptDecision()} data-testid="review-no">
              {out ? 'Walk off' : 'Accept'} <kbd>Enter</kbd>
            </button>
            <span className="appeal-clock" aria-label={`${left} seconds to decide`}>
              {left}s
            </span>
          </div>
        </>
      ) : (
        <p className="dim">{a.reviewer} are thinking about a review…</p>
      )}
    </div>
  );
}

const PITCHING_LABEL: Record<string, string> = { inLine: 'In line', outsideOff: 'Outside off', outsideLeg: 'Outside leg', full: 'Full toss' };
const IMPACT_LABEL: Record<string, string> = { inLine: 'In line', umpiresCall: "Umpire's call", outsideOff: 'Outside off', outsideLeg: 'Outside leg' };
const WICKETS_LABEL: Record<string, string> = { hitting: 'Hitting', umpiresCall: "Umpire's call", missing: 'Missing' };
const zoneTone = (v: string) => (v === 'inLine' || v === 'hitting' || v === 'full' ? 'good' : v === 'umpiresCall' ? 'ok' : 'bad');

/**
 * The third umpire's review, as television shows it: the tracking replays
 * on the field while the verdicts appear one by one — pitching, impact,
 * wickets — then the decision.
 */
function DrsPanel() {
  const phase = useGame((s) => s.snap?.phase);
  const match = useGame((s) => s.match);
  useTicker(phase === 'drs', 150);
  const r = match?.drs;
  if (phase !== 'drs' || !match || !r) return null;
  const t = r.appeal.tracking;
  const steps = [
    { at: DRS_TIMES.pitching, label: 'Pitching', value: PITCHING_LABEL[t.pitching] ?? t.pitching, tone: zoneTone(t.pitching) },
    { at: DRS_TIMES.impact, label: 'Impact', value: !t.shotOffered && t.impactZone === 'outsideOff' ? 'Outside off, no shot' : (IMPACT_LABEL[t.impactZone] ?? t.impactZone), tone: !t.shotOffered && t.impactZone === 'outsideOff' ? 'good' : zoneTone(t.impactZone) },
    { at: DRS_TIMES.wickets, label: 'Wickets', value: WICKETS_LABEL[t.wickets] ?? t.wickets, tone: zoneTone(t.wickets) },
  ];
  const decided = r.t >= DRS_TIMES.decision;
  const res = r.result;
  return (
    <div className="drs" data-testid="drs" aria-live="polite">
      <div className="drs-head">
        <span>Decision review</span>
        <span className="dim">{match.side(r.appeal.reviewer).team.shortName} review</span>
      </div>
      <ul>
        {steps.map((st) => (
          <li key={st.label} className={r.t >= st.at ? `shown ${st.tone}` : ''}>
            <span className="dim">{st.label}</span>
            <strong>{r.t >= st.at ? st.value : '…'}</strong>
          </li>
        ))}
      </ul>
      {decided ? (
        <div className={`drs-decision ${res.decision === 'out' ? 'out' : 'not-out'}`} data-testid="drs-decision">
          <strong>{res.decision === 'out' ? 'OUT' : 'NOT OUT'}</strong>
          <span>
            {res.umpiresCall ? "Umpire's call. " : res.overturned ? 'Decision overturned. ' : 'Original decision stands. '}
            {res.retained ? 'Review retained.' : 'Review lost.'}
          </span>
        </div>
      ) : null}
      {r.t > 1 ? (
        <span className="drs-skip dim">
          <kbd>Enter</kbd> skip
        </span>
      ) : null}
    </div>
  );
}

/**
 * Autoplay: hand your side to the computer for the rest of the over or the
 * innings, and take it back. Top left, out of the way of play.
 */
function AutoplayControl() {
  const inNets = useGame((s) => s.nets !== undefined && s.match?.config.nets !== undefined);
  if (inNets) return null;
  return <AutoplayButtons />;
}

function AutoplayButtons() {
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

/**
 * The captain's own field: drag any of the nine fielders (the keeper and
 * the bowler stay put) anywhere on the ground. The restrictions are checked
 * as you go: fielders outside the circle (two in the powerplay, five after),
 * and no more than two behind square on the leg side.
 */
function FieldEditor() {
  const open = useGame((s) => s.fieldEditor);
  const match = useGame((s) => s.match);
  const close = useGame((s) => s.setFieldEditor);
  const [spots, setSpots] = useState<FieldPosition[]>([]);
  const [drag, setDrag] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (open && match) {
      setSpots(match.currentPositions());
      setError(undefined);
    }
  }, [open, match]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') close(false);
      else if (e.code === 'Enter') apply();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  if (!open || !match) return null;
  const left = match.striker.battingHand === 'left';
  const R = 190;
  const k = R / 70;
  const maxOut = match.maxOutsideNow;
  const problem = checkField(spots, maxOut);
  const out = spots.filter((p) => p.distance > CIRCLE).length;
  const legBehind = spots.filter((p) => p.angleDeg < -90).length;
  // Screen: as the broadcast camera sees it, the striker at the top, the off side of a right-hander on the left.
  const toScreen = (p: FieldPosition) => {
    const { x, z } = fieldPositionXZ(p, left);
    return { cx: -x * k, cy: -(z - 0) * k };
  };
  const fromScreen = (sx: number, sy: number, i: number): FieldPosition => {
    const x = -sx / k;
    const z = -sy / k;
    const bx = left ? -x : x;
    const dz = STRIKER_STUMPS_Z - z;
    return customPosition(i, (Math.atan2(bx, dz) * 180) / Math.PI, Math.hypot(bx, dz));
  };
  const point = (e: React.PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const r = svg.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * (2 * R + 20) - (R + 10), y: ((e.clientY - r.top) / r.height) * (2 * R + 20) - (R + 10) };
  };
  const move = (i: number, p: FieldPosition) => setSpots((s) => s.map((q, j) => (j === i ? p : q)));
  function apply() {
    if (!match) return;
    const why = match.setCustomField(spots);
    if (why) setError(why);
    else close(false);
  }
  const wk = toScreen({ id: 'wk', name: '', angleDeg: 180, distance: 2.5 });
  const bowlerSpot = toScreen({ id: 'b', name: '', angleDeg: 0, distance: 20 });
  return (
    <div className="overlay" role="dialog" aria-label="Set your field" data-testid="field-editor">
      <div className="panel wide field-editor">
        <h2>Set your field</h2>
        <p className="dim small">
          Drag the fielders where you want them (or focus one and use the arrows). The keeper and the bowler stay where they are. Seen from behind the bowler, the batter at the top.
        </p>
        <div className="fe-body">
          <svg
            ref={svgRef}
            viewBox={`${-R - 10} ${-R - 10} ${2 * R + 20} ${2 * R + 20}`}
            className="fe-field"
            onPointerMove={(e) => {
              if (drag === undefined) return;
              const p = point(e);
              if (p) move(drag, fromScreen(p.x, p.y, drag));
            }}
            onPointerUp={() => setDrag(undefined)}
            onPointerLeave={() => setDrag(undefined)}
          >
            <circle r={R} className="fm-ground" />
            <circle r={CIRCLE * k} className="fe-circle" />
            <rect x={-1.6 * k} y={-10.06 * k} width={3.2 * k} height={20.12 * k} className="fm-pitch" />
            <circle cx={wk.cx} cy={wk.cy} r={6} className="fm-keeper" />
            <circle cx={bowlerSpot.cx} cy={bowlerSpot.cy} r={6} className="fm-bowler" />
            {spots.map((p, i) => {
              const s = toScreen(p);
              return (
                <g
                  key={i}
                  role="button"
                  tabIndex={0}
                  aria-label={`${p.name}: drag, or use the arrows`}
                  className={`fe-dot${drag === i ? ' dragging' : ''}`}
                  transform={`translate(${s.cx} ${s.cy})`}
                  onPointerDown={(e) => {
                    (e.target as Element).setPointerCapture?.(e.pointerId);
                    setDrag(i);
                  }}
                  onKeyDown={(e) => {
                    const step = 2 * k;
                    const d = e.key === 'ArrowLeft' ? [-step, 0] : e.key === 'ArrowRight' ? [step, 0] : e.key === 'ArrowUp' ? [0, -step] : e.key === 'ArrowDown' ? [0, step] : undefined;
                    if (!d) return;
                    e.preventDefault();
                    move(i, fromScreen(s.cx + (d[0] ?? 0), s.cy + (d[1] ?? 0), i));
                  }}
                  data-testid="fe-fielder"
                >
                  <circle r={9} />
                  <text y={-13}>{p.name}</text>
                </g>
              );
            })}
          </svg>
          <div className="fe-side">
            <p className={out > maxOut ? 'bad' : ''}>
              Outside the circle: <strong>{out}</strong> of {maxOut}
            </p>
            <p className={legBehind > 2 ? 'bad' : ''}>
              Behind square on the leg side: <strong>{legBehind}</strong> of 2
            </p>
            {error || problem ? <p className="bad" role="alert">{error ?? problem}</p> : null}
            <div className="buttons">
              <button type="button" onClick={apply} disabled={!!problem} data-testid="fe-done">
                Set this field (Enter)
              </button>
              <button type="button" className="secondary" onClick={() => setSpots(match.currentPositions())}>
                Start again
              </button>
              <button type="button" className="secondary" onClick={() => close(false)}>
                Cancel (Esc)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Practice: the challenge and how it is going, top centre. */
/** Mean of a list, or undefined. */
const avg = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

/**
 * The nets, top of the screen: the ball being bowled and its lesson, the
 * attempts so far (timing and sweet spot, latest last), how the first few
 * compare with the last few, and the choice of ball.
 */
function NetsPanel() {
  const snap = useGame((s) => s.snap);
  const match = useGame((s) => s.match);
  const [choosing, setChoosing] = useState(false);
  const n = snap?.nets;
  if (!snap || !match || !n) return null;
  const log = n.log.filter((c) => c.timingWord !== 'Left');
  const off = (c: Coaching) => (c.pressMs === undefined ? undefined : Math.abs(c.pressMs));
  const first = log.slice(0, 3);
  const last = log.slice(-3);
  const t0 = avg(first.map(off).filter((x): x is number => x !== undefined));
  const t1 = avg(last.map(off).filter((x): x is number => x !== undefined));
  const q0 = avg(first.map((c) => c.sweetSpot ?? 0));
  const q1 = avg(last.map((c) => c.sweetSpot ?? 0));
  const between = snap.phase === 'review' || snap.phase === 'between';
  return (
    <section className="nets-panel" aria-label="Coaching nets" data-testid="nets-panel">
      <div className="nets-head">
        <div>
          <strong>{n.ball.name}</strong>
          {n.variant ? <span className="dim"> · ball {n.variant + 1}</span> : null}
          <div className="dim small">{n.ball.lesson}</div>
        </div>
        <span className="nets-count">{n.attempts} faced</span>
      </div>
      {log.length ? (
        <ol className="nets-log" aria-label="Your attempts at this ball">
          {log.slice(-10).map((c, i) => (
            <li key={i} className={c.verdict} title={`${c.played}: ${c.points[0] ?? ''}`}>
              <span className="nl-shot">{c.played}</span>
              <span className="nl-ms">{c.pressMs === undefined ? '—' : c.pressMs === 0 ? '0' : `${c.pressMs > 0 ? '+' : '−'}${Math.abs(c.pressMs)}`}</span>
              <span className="nl-q">{c.sweetSpot === undefined ? '—' : `${c.sweetSpot}%`}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="dim small">Your attempts at this ball will be listed here: timing in ms (+ late) and how much of the sweet spot you found.</p>
      )}
      {log.length >= 4 && t0 !== undefined && t1 !== undefined ? (
        <p className="nets-trend" data-testid="nets-trend">
          Timing {Math.round(t0)} → <b className={t1 < t0 ? 'good' : 'bad'}>{Math.round(t1)} ms off</b> · sweet spot {Math.round(q0 ?? 0)}% → <b className={(q1 ?? 0) > (q0 ?? 0) ? 'good' : 'bad'}>{Math.round(q1 ?? 0)}%</b>
        </p>
      ) : null}
      <div className="nets-actions">
        <button type="button" disabled={!between} onClick={() => match.next()} data-testid="nets-same">
          Same ball <kbd>Enter</kbd>
        </button>
        <button
          type="button"
          disabled={!between}
          onClick={() => {
            match.newNetsVariant();
            match.next();
          }}
          data-testid="nets-another"
        >
          Another like it <kbd>N</kbd>
        </button>
        <button type="button" disabled={!between} onClick={() => setChoosing((v) => !v)} aria-expanded={choosing}>
          Change ball
        </button>
      </div>
      {choosing && between ? (
        <ul className="nets-choose">
          {NETS_BALLS.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                className={b.id === n.ball.id ? 'on' : ''}
                onClick={() => {
                  match.setNetsBall(b.id);
                  setChoosing(false);
                }}
              >
                {b.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ChallengeCard() {
  const snap = useGame((s) => s.snap);
  const c = snap?.challenge;
  if (!snap || !c || snap.phase === 'complete') return null;
  const def = challenge(c.id);
  return (
    <div className={`challenge-card ${c.status.state}`} data-testid="challenge" data-state={c.status.state} role="status">
      <strong>{def.name}</strong>
      <span>{c.status.progress}</span>
    </div>
  );
}

function PracticeResult() {
  const snap = useGame((s) => s.snap);
  const rematch = useGame((s) => s.rematch);
  const quit = useGame((s) => s.quitToMenu);
  const c = snap?.challenge;
  if (!snap || !c) return null;
  const def = challenge(c.id);
  const won = c.status.state === 'won';
  return (
    <div className="overlay" role="dialog" aria-label="Practice result" data-testid="practice-result">
      <div className="panel">
        <h2 className={`result-title ${won ? 'won' : 'lost'}`}>{won ? 'Challenge complete!' : 'Not this time'}</h2>
        <p>
          <strong>{def.name}.</strong> {def.goal}
        </p>
        <p className="dim">{c.status.progress}</p>
        <div className="buttons row">
          <button type="button" onClick={rematch} autoFocus data-testid="practice-again">
            {won ? 'Play it again' : 'Try again'}
          </button>
          <button type="button" className="secondary" onClick={quit}>
            Main menu
          </button>
        </div>
      </div>
    </div>
  );
}

/** Save the match from the pause menu (as it stood before the ball in play, if one is). */
function SaveButton() {
  const save = useGame((s) => s.saveMatch);
  const midBall = useGame((s) => s.snap?.phase === 'delivery' || s.snap?.phase === 'appeal' || s.snap?.phase === 'drs');
  const [state, setState] = useState<'idle' | 'saved' | 'failed'>('idle');
  return (
    <button type="button" className="secondary" onClick={() => setState(save() ? 'saved' : 'failed')} data-testid="save-match" aria-live="polite">
      {state === 'saved'
        ? 'Saved — continue it from the main menu'
        : state === 'failed'
          ? 'Could not save (browser storage unavailable)'
          : midBall
            ? 'Save match (from the start of this ball)'
            : 'Save match'}
    </button>
  );
}

/** "Next ball" prompt while the game waits after an ordinary ball. */
function NextPrompt() {
  const snap = useGame((s) => s.snap);
  const pad = useGame((s) => s.padActive);
  const touch = useGame((s) => s.touchActive);
  const match = useGame((s) => s.match);
  const replaying = useGame((s) => s.replaying);
  if (!snap || !match || replaying) return null;
  const waiting = snap.phase === 'review' && snap.review?.kind === 'ball';
  const dead = snap.phase === 'delivery' && snap.ballPhase === 'dead';
  if (snap.phase === 'review' && snap.review?.kind === 'ready') {
    return (
      <button type="button" className="next-prompt ready first-ball" onClick={() => match.next()} data-testid="ready-prompt">
        Ready? {touch ? <span className="dim">Tap to start</span> : pad ? <kbd>A</kbd> : <><kbd>Space</kbd> <span className="dim">or</span> <kbd>Enter</kbd></>}
      </button>
    );
  }
  if (!waiting && !dead) return null;
  return (
    <button type="button" className={`next-prompt ${waiting ? 'ready' : ''}`} onClick={() => match.next()} data-testid="next-ball">
      {waiting ? (
        touch ? (
          <>Next ball</>
        ) : (
          <>
            Next ball <kbd>Space</kbd> <span className="dim">or</span> <kbd>Enter</kbd>
          </>
        )
      ) : touch ? (
        <span className="dim">Skip</span>
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
  const touch = useGame((s) => s.touchActive);
  const review = snap?.review;
  if (!snap || !match || !review || review.kind === 'ball' || review.kind === 'ready' || replaying) return null;
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
            {touch ? (
              snap.userBatting ? (
                <ol className="howto">
                  <li>Hold the stick on the left where you want to hit it: up is fine, down is straight, right is the batter&apos;s right.</li>
                  <li>As the ball arrives tap Front, Back or Feet (or Leave); hold Loft with it to hit it in the air. The stroke names show on the buttons.</li>
                  <li>Once it is hit: Run (again for each run), hold Sprint, and Dive near the end of a run.</li>
                </ol>
              ) : (
                <ol className="howto">
                  <li>Tap a bowler, then choose the delivery with ◀ ▶ and Side, and the amount with the stick (up and down).</li>
                  <li>Bowl, move the marker with the stick, and Bowl again to run in; Bowl once more to lock the pace on the meter.</li>
                  <li>In the field, hold the stick up or down to throw to the keeper or the bowler.</li>
                </ol>
              )
            ) : snap.userBatting ? (
              <ol className="howto">
                <li>
                  Hold an <kbd>arrow</kbd> for where to hit it, as the batter sees it: <kbd>↓</kbd> straight, <kbd>↑</kbd> fine, <kbd>→</kbd>{' '}
                  his right (a right-hander&apos;s off side), <kbd>←</kbd> his left. Hold <kbd>Shift</kbd> to loft it. As the bowler runs in, <kbd>Q</kbd>/<kbd>E</kbd> shuffle across the crease.
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
              {touch ? (
                <>After every ball the game waits for you to tap Next ball — or let the computer play the over or the innings with the Autoplay buttons, top left.</>
              ) : (
                <>
                  The controls stay on screen at the bottom left. After every ball the game waits for you — or let the computer play the over (<kbd>Y</kbd>) or the
                  innings (<kbd>U</kbd>).
                </>
              )}
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

/** A new achievement: a card at the top of the screen for a few seconds. */
function AchievementToast() {
  const toast = useGame((s) => s.toast);
  const dismiss = useGame((s) => s.dismissToast);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(dismiss, 4500);
    return () => window.clearTimeout(id);
  }, [toast, dismiss]);
  if (!toast) return null;
  return (
    <div className="achievement-toast" role="status" data-testid="achievement-toast">
      {toast.ids.map((id) => {
        const a = achievement(id);
        return (
          <div key={id} className="at-row">
            <span className="at-star" aria-hidden="true">
              ★
            </span>
            <span>
              <strong>{a.title}</strong>
              <span className="dim"> {a.how}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
