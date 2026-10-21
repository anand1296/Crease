import { useGame } from '../state/game.ts';
import { DELIVERY_TYPES } from '../game/bowling/deliveryTypes.ts';
import type { BallOutcome } from '../game/session/deliveryCycle.ts';
import type { InningsState } from '../game/match/match.ts';
import { Scorecard } from './Scorecard.tsx';
import { HowToPlay } from './Menus.tsx';

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
      <ControlsBar />
      <InningsBreak />
      <Result />
      <HelpOverlay />
      <PauseOverlay />
    </>
  );
}

function ScoreStrip() {
  const snap = useGame((s) => s.snap);
  if (!snap) return null;
  const { striker, nonStriker, bowler } = snap;
  const fig = (c: { runs: number; balls: number } | undefined) => (c ? `${c.runs} (${c.balls})` : '0 (0)');
  const rate = snap.balls ? ((snap.runs / snap.balls) * 6).toFixed(2) : '0.00';
  const required = snap.needed !== undefined && snap.ballsLeft ? ((snap.needed / snap.ballsLeft) * 6).toFixed(2) : undefined;
  return (
    <section className="strip" aria-label="Scoreboard" data-testid="scoreboard">
      <div className="strip-main" style={{ borderColor: snap.battingTeam.colors.primary }}>
        <span className="strip-team" style={{ background: snap.battingTeam.colors.primary, color: snap.battingTeam.colors.secondary }}>
          {snap.battingTeam.shortName}
        </span>
        <span className="strip-score" data-testid="score">
          {snap.runs}/{snap.wickets}
        </span>
        <span className="strip-overs" data-testid="overs">
          {snap.overs} <small>of {snap.maxOvers}</small>
        </span>
        <span className="strip-rate">RR {rate}</span>
      </div>
      {snap.target !== undefined ? (
        <div className="strip-chase" data-testid="chase">
          Need {snap.needed} from {snap.ballsLeft} balls{required ? ` · required ${required}` : ''}
        </div>
      ) : null}
      <div className="strip-players">
        <span className="striker">
          {striker.name}* <b>{fig(striker.card)}</b>
        </span>
        <span>
          {nonStriker.name} <b>{fig(nonStriker.card)}</b>
        </span>
        <span className="bowler">
          {bowler.name}{' '}
          <b>
            {bowler.card ? `${bowler.card.wickets}-${bowler.card.runs}` : '0-0'}
          </b>
          <span className="fatigue" title={`Fatigue ${Math.round(bowler.fatigue * 100)}%`}>
            <span style={{ width: `${Math.round(bowler.fatigue * 100)}%` }} />
          </span>
        </span>
      </div>
      <div className="recent" aria-label="This over">
        {snap.recent.map((r, i) => (
          <span key={i} className={r === 'W' ? 'ball w' : r === '4' || r === '6' ? 'ball b' : 'ball'}>
            {r}
          </span>
        ))}
      </div>
      <div className="role" data-testid="role">
        {snap.userBatting ? 'You are batting' : 'You are bowling'}
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
  const visible = o && (phase === 'between' || phase === 'aiming' || phase === 'chooseBowler' || ballPhase === 'dead');
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

function ControlsBar() {
  const snap = useGame((s) => s.snap);
  const help = useGame((s) => s.showHelp);
  // Only between balls: never over the action.
  if (help || !snap || snap.phase === 'complete' || snap.phase === 'delivery' || snap.phase === 'inningsBreak') return null;
  return (
    <footer className="controls" aria-label="Controls">
      {snap.userBatting ? (
        <>
          <span><kbd>↑↓←→</kbd> direction</span>
          <span><kbd>D</kbd> drive</span>
          <span><kbd>A</kbd> loft</span>
          <span><kbd>S</kbd> defend</span>
          <span><kbd>W</kbd> sweep</span>
          <span><kbd>X</kbd> leave</span>
          <span><kbd>Shift</kbd> back foot</span>
          <span><kbd>Space</kbd> run</span>
        </>
      ) : (
        <>
          <span><kbd>↑↓←→</kbd> target</span>
          <span><kbd>Q</kbd><kbd>E</kbd> delivery</span>
          <span><kbd>Space</kbd> run in / release</span>
        </>
      )}
      <span><kbd>H</kbd> help</span>
      <span><kbd>P</kbd> pause</span>
    </footer>
  );
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
