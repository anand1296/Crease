import { useGame } from '../state/game.ts';
import { DELIVERY_TYPES } from '../game/bowling/deliveryTypes.ts';
import { DEFAULT_BINDINGS, type GameAction, keyLabel } from '../game/input/keyboard.ts';
import type { BallOutcome } from '../game/session/deliveryCycle.ts';

/**
 * Heads-up display. Kept to the edges of the screen so the batter, bowler
 * and ball stay clear; nothing here is interactive by mouse except the
 * pause menu buttons.
 */
export function Hud() {
  return (
    <>
      <Scoreboard />
      <DeliveryPanel />
      <OutcomeBanner />
      <BowlingPanel />
      <ControlsBar />
      <HelpOverlay />
      <PauseOverlay />
    </>
  );
}

const key = (a: GameAction) => (DEFAULT_BINDINGS[a][0] ? keyLabel(DEFAULT_BINDINGS[a][0]) : '?');

function Scoreboard() {
  const snap = useGame((s) => s.snap);
  const role = useGame((s) => s.role);
  const { score, striker, nonStriker, bowler } = snap;
  const fig = (r: number, b: number) => `${r} (${b})`;
  return (
    <section className="hud-card scoreboard" aria-label="Scoreboard" data-testid="scoreboard">
      <div className="score-line">
        <span className="team">{snap.battingTeam}</span>
        <span className="score" data-testid="score">
          {score.runs}/{score.wickets}
        </span>
        <span className="overs" data-testid="overs">
          {snap.overs} ov
        </span>
      </div>
      <div className="batters">
        <span className="striker">
          {striker.name}* <b>{fig(striker.figures.runs, striker.figures.balls)}</b>
        </span>
        <span>
          {nonStriker.name} <b>{fig(nonStriker.figures.runs, nonStriker.figures.balls)}</b>
        </span>
      </div>
      <div className="bowler-line">
        <span>
          {bowler.name} <b>{bowler.figures.wickets}-{bowler.figures.runs}</b> ({Math.floor(bowler.figures.balls / 6)}.{bowler.figures.balls % 6})
        </span>
        <span className="fatigue" title="Bowler fatigue">
          <span style={{ width: `${Math.round(bowler.fatigue * 100)}%` }} />
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
        You are {role === 'batting' ? 'batting' : 'bowling'} · {snap.bowlingTeam} {role === 'batting' ? 'bowling' : 'batting'}
      </div>
    </section>
  );
}

function DeliveryPanel() {
  const o = useGame((s) => s.snap.lastOutcome);
  const style = useGame((s) => s.snap.bowler.style);
  const phase = useGame((s) => s.snap.phase);
  if (phase === 'allOut') return null;
  return (
    <section className="hud-card delivery" aria-label="Last delivery">
      <div className="label">{style}</div>
      {o ? (
        <div className="value">
          {o.delivery.name} · {Math.round(o.delivery.speedKph)} km/h
        </div>
      ) : (
        <div className="value dim">First ball coming up</div>
      )}
    </section>
  );
}

function timingText(o: BallOutcome): { text: string; tone: string } | null {
  const c = o.contact;
  if (o.timingMs === undefined || !c || c.kind === 'leave') return null;
  const ms = o.timingMs;
  const when = Math.abs(ms) <= 12 ? 'Perfect timing' : ms < 0 ? `Early ${-ms} ms` : `Late ${ms} ms`;
  const how = c.kind === 'middled' ? 'middled' : c.kind === 'mistimed' ? 'mistimed' : c.kind === 'edge' ? `${c.edge} edge` : 'missed';
  const tone = c.kind === 'middled' ? 'good' : c.kind === 'mistimed' ? 'ok' : 'bad';
  return { text: `${when} · ${how}`, tone };
}

function OutcomeBanner() {
  const o = useGame((s) => s.snap.lastOutcome);
  const count = useGame((s) => s.snap.ballCount);
  const phase = useGame((s) => s.snap.phase);
  const ballPhase = useGame((s) => s.snap.ballPhase);
  const score = useGame((s) => s.snap.score);
  if (phase === 'allOut') {
    return (
      <div className="banner big" role="status" data-testid="banner">
        <div className="headline">ALL OUT</div>
        <div className="detail">
          {score.runs} in {Math.floor(score.balls / 6)}.{score.balls % 6} overs — new innings starting
        </div>
      </div>
    );
  }
  // Show the result once the ball is dead, until the next delivery is on its way.
  const visible = o && (phase === 'between' || phase === 'aiming' || ballPhase === 'dead');
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

function BowlingPanel() {
  const role = useGame((s) => s.role);
  const setup = useGame((s) => s.snap.setup);
  const deliveries = useGame((s) => s.snap.deliveries);
  const phase = useGame((s) => s.snap.phase);
  const ballPhase = useGame((s) => s.snap.ballPhase);
  const locked = useGame((s) => s.snap.releaseLocked);
  const meter = useGame((s) => s.meter);
  if (role !== 'bowling') return null;
  const runningIn = phase === 'delivery' && ballPhase === 'runUp';
  const length =
    setup.length < 1.4 ? 'Yorker' : setup.length < 3.5 ? 'Full' : setup.length < 6.5 ? 'Good length' : setup.length < 9 ? 'Back of a length' : 'Short';
  const line = setup.line > 0.5 ? 'Wide outside off' : setup.line > 0.2 ? 'Outside off' : setup.line > 0.05 ? 'Off stump' : setup.line > -0.08 ? 'Middle' : 'Leg side';
  return (
    <section className="hud-card bowling" aria-label="Bowling controls" data-testid="bowling-panel">
      <div className="label">
        Delivery ({key('prevDelivery')}/{key('nextDelivery')})
      </div>
      <div className="deliveries">
        {deliveries.map((d) => (
          <span key={d} className={d === setup.type ? 'chip on' : 'chip'}>
            {DELIVERY_TYPES[d].name}
          </span>
        ))}
      </div>
      <div className="label">Target (arrows)</div>
      <div className="value">
        {line} · {length}
      </div>
      {runningIn ? (
        <div className="meter" aria-label="Release accuracy">
          <span className="sweet" />
          <span className="needle" style={{ left: `${(locked ? 0.5 : meter) * 100}%` }} />
        </div>
      ) : null}
      <div className="hint">
        {phase === 'aiming'
          ? `${key('bowl')} to run in`
          : runningIn
            ? locked
              ? 'Release locked'
              : `${key('bowl')} when the needle is in the gold`
            : ''}
      </div>
    </section>
  );
}

function ControlsBar() {
  const role = useGame((s) => s.role);
  const help = useGame((s) => s.showHelp);
  if (help) return null;
  return (
    <footer className="controls" aria-label="Controls">
      {role === 'batting' ? (
        <>
          <span>
            <kbd>↑↓←→</kbd> aim
          </span>
          <span>
            <kbd>{key('ground')}</kbd> drive
          </span>
          <span>
            <kbd>{key('loft')}</kbd> loft
          </span>
          <span>
            <kbd>{key('defend')}</kbd> defend/push
          </span>
          <span>
            <kbd>{key('sweep')}</kbd> sweep
          </span>
          <span>
            <kbd>{key('leave')}</kbd> leave
          </span>
          <span>
            <kbd>Shift</kbd> back foot
          </span>
        </>
      ) : (
        <>
          <span>
            <kbd>↑↓←→</kbd> target
          </span>
          <span>
            <kbd>{key('prevDelivery')}</kbd>
            <kbd>{key('nextDelivery')}</kbd> delivery
          </span>
          <span>
            <kbd>{key('bowl')}</kbd> run in / release
          </span>
        </>
      )}
      <span>
        <kbd>{key('switchRole')}</kbd> {role === 'batting' ? 'bowl' : 'bat'}
      </span>
      <span>
        <kbd>{key('help')}</kbd> help
      </span>
      <span>
        <kbd>{key('pause')}</kbd> pause
      </span>
    </footer>
  );
}

const SHOT_TABLE: [string, string][] = [
  ['D', 'Ground stroke: ↑ straight drive · ↖/↗ off/on drive · ←/→ cover drive / flick (Shift: cut / pull) · ↙ late cut · ↘ or ↓ glance'],
  ['A', 'Lofted: ↑ lofted drive · any direction lofts that way · Shift+leg side or ↓ = hook'],
  ['S', 'Defend: no arrow = dead bat · with an arrow = push into that gap for a single'],
  ['W', 'Sweep (leg side) · with the off-side arrow = reverse sweep'],
  ['Space', 'Leave the ball'],
  ['Shift', 'Hold for back-foot versions of strokes'],
];

function HelpOverlay() {
  const help = useGame((s) => s.showHelp);
  const toggle = useGame((s) => s.toggleHelp);
  if (!help) return null;
  return (
    <div className="overlay" role="dialog" aria-label="How to play">
      <div className="panel wide">
        <h2>How to bat</h2>
        <p>
          Hold an arrow for direction (screen-relative — left is the left of the screen), then press a stroke key{' '}
          <em>as the ball arrives</em>. The moment you press is when you commit: the bat reaches the ball a fraction of a second
          later, so press slightly before the ball reaches the batter. Early or late timing turns the ball off line, costs power
          or finds the edge. Choose strokes that suit the ball: drive the full ones, cut and pull the short ones, defend the good
          ones.
        </p>
        <table className="keys">
          <tbody>
            {SHOT_TABLE.map(([k, d]) => (
              <tr key={k}>
                <td>
                  <kbd>{k}</kbd>
                </td>
                <td>{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2>How to bowl</h2>
        <p>
          Pick a delivery with <kbd>Q</kbd>/<kbd>E</kbd>, move the gold target with the arrows, press <kbd>Space</kbd> to run in,
          then <kbd>Space</kbd> again while the needle is in the gold for an accurate release.
        </p>
        <p className="dim">
          <kbd>Tab</kbd> switch between batting and bowling · <kbd>C</kbd> camera · <kbd>P</kbd> pause · <kbd>R</kbd> restart
        </p>
        <button type="button" onClick={toggle}>
          Close (H)
        </button>
      </div>
    </div>
  );
}

function PauseOverlay() {
  const paused = useGame((s) => s.paused);
  const setPaused = useGame((s) => s.setPaused);
  const restart = useGame((s) => s.restart);
  const switchRole = useGame((s) => s.switchRole);
  const role = useGame((s) => s.role);
  if (!paused) return null;
  return (
    <div className="overlay" role="dialog" aria-label="Paused" data-testid="pause">
      <div className="panel">
        <h2>Paused</h2>
        <div className="buttons">
          <button type="button" onClick={() => setPaused(false)}>
            Resume (P)
          </button>
          <button type="button" className="secondary" onClick={restart}>
            Restart (R)
          </button>
          <button type="button" className="secondary" onClick={switchRole}>
            Switch to {role === 'batting' ? 'bowling' : 'batting'} (Tab)
          </button>
        </div>
      </div>
    </div>
  );
}
