import { useCallback, useEffect, useRef, useState } from 'react';
import { TEAMS, type Team } from '../game/data/teams.ts';
import { PITCHES, type PitchId } from '../game/data/pitches.ts';
import { DIFFICULTIES, type DifficultyId } from '../game/model/difficulty.ts';
import type { GameSpeed } from '../game/match/match.ts';
import { type XiDrop as Drop, applyDrop, checkXi } from '../game/match/squad.ts';
import type { Player } from '../game/model/player.ts';
import { type BatFirst, findTeam, styleName, useGame } from '../state/game.ts';

/**
 * Menus: main menu, match setup, squad selection. Rendered over the live
 * stadium; all plain DOM so keyboard and screen-reader users can drive them.
 */
export function MainMenu() {
  const goTo = useGame((s) => s.goTo);
  const muted = useGame((s) => s.muted);
  const toggleMute = useGame((s) => s.toggleMute);
  const quality = useGame((s) => s.quality);
  const toggleQuality = useGame((s) => s.toggleQuality);
  const commentaryOn = useGame((s) => s.commentaryOn);
  const toggleCommentary = useGame((s) => s.toggleCommentary);
  const replaysOn = useGame((s) => s.replaysOn);
  const toggleReplays = useGame((s) => s.toggleReplays);
  const [help, setHelp] = useState(false);
  return (
    <div className="menu-shell">
      <div className="menu-column">
        <h1 className="title">Crease</h1>
        <p className="tagline">Limited-overs cricket, played ball by ball.</p>
        <nav className="menu-actions" aria-label="Main menu">
          <button type="button" className="primary" onClick={() => goTo('setup')} autoFocus data-testid="menu-play">
            Play a match
          </button>
          <button type="button" onClick={() => setHelp(true)}>
            How to play
          </button>
          <button type="button" onClick={toggleMute}>
            Sound: {muted ? 'off' : 'on'}
          </button>
          <button type="button" onClick={toggleQuality}>
            Graphics: {quality === 'high' ? 'high' : 'low'}
          </button>
          <button type="button" onClick={toggleCommentary}>
            Commentary: {commentaryOn ? 'on' : 'off'}
          </button>
          <button type="button" onClick={toggleReplays}>
            Replays: {replaysOn ? 'on' : 'off'}
          </button>
        </nav>
      </div>
      {help ? <HowToPlay onClose={() => setHelp(false)} /> : null}
    </div>
  );
}

/** T20 and shorter: twenty overs a side at most. */
const OVERS = [2, 5, 10, 15, 20];

function TeamTile({ team, selected, disabled, onSelect }: { team: Team; selected: boolean; disabled: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      className={`team-tile${selected ? ' selected' : ''}`}
      disabled={disabled}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="kit-swatch" aria-hidden style={{ background: team.colors.primary, borderColor: team.colors.secondary }} />
      <span className="team-name">{team.name}</span>
      <span className="team-short">{team.shortName}</span>
    </button>
  );
}

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  render,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  render?: (v: T) => string;
}) {
  return (
    <fieldset className="segmented">
      <legend>{label}</legend>
      <div className="segments">
        {options.map((o) => (
          <button key={String(o)} type="button" aria-pressed={o === value} className={o === value ? 'on' : ''} onClick={() => onChange(o)}>
            {render ? render(o) : String(o)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function MatchSetup() {
  const setup = useGame((s) => s.setup);
  const update = useGame((s) => s.updateSetup);
  const goTo = useGame((s) => s.goTo);
  const start = useGame((s) => s.startMatch);
  const user = findTeam(setup.userTeamId);
  const opp = findTeam(setup.opponentId);
  const userCheck = checkXi(user, setup.userXi.map((id) => user.players.find((p) => p.id === id)).filter((p): p is Player => p !== undefined));
  const batOptions: readonly BatFirst[] = ['toss', 'user', 'opponent'];
  return (
    <div className="menu-shell">
      <section className="board" aria-label="Match setup" data-testid="setup">
        <header className="board-head">
          <h2>New match</h2>
          <button type="button" className="link" onClick={() => goTo('menu')}>
            Back
          </button>
        </header>

        <div className="teams">
          <div className="team-pick">
            <h3>Your team</h3>
            <div className="tiles">
              {TEAMS.map((t) => (
                <TeamTile key={t.id} team={t} selected={t.id === user.id} disabled={t.id === opp.id} onSelect={() => update({ userTeamId: t.id })} />
              ))}
            </div>
          </div>
          <div className="versus" aria-hidden>
            v
          </div>
          <div className="team-pick">
            <h3>Opponent</h3>
            <div className="tiles">
              {TEAMS.map((t) => (
                <TeamTile key={t.id} team={t} selected={t.id === opp.id} disabled={t.id === user.id} onSelect={() => update({ opponentId: t.id })} />
              ))}
            </div>
          </div>
        </div>

        <div className="options">
          <Segmented label="Overs per side" value={setup.overs} options={OVERS} onChange={(overs) => update({ overs })} />
          <Segmented<DifficultyId>
            label="Difficulty"
            value={setup.difficulty}
            options={['easy', 'normal', 'hard']}
            onChange={(difficulty) => update({ difficulty })}
            render={(d) => DIFFICULTIES[d].name}
          />
          <Segmented<PitchId>
            label="Pitch"
            value={setup.pitch}
            options={['balanced', 'green', 'dry', 'flat']}
            onChange={(pitch) => update({ pitch })}
            render={(p) => PITCHES[p].name}
          />
          <Segmented<BatFirst>
            label="First innings"
            value={setup.batFirst}
            options={batOptions}
            onChange={(batFirst) => update({ batFirst })}
            render={(b) => (b === 'toss' ? 'Toss for it' : b === 'user' ? 'We bat' : 'We bowl')}
          />
          <Segmented<GameSpeed>
            label="Game speed"
            value={setup.speed}
            options={['relaxed', 'normal', 'real']}
            onChange={(speed) => update({ speed })}
            render={(v) => (v === 'relaxed' ? 'Relaxed' : v === 'normal' ? 'Normal' : 'Real time')}
          />
        </div>
        <p className="pitch-note">{PITCHES[setup.pitch].description}</p>

        <footer className="board-foot">
          <button type="button" onClick={() => goTo('squad')} data-testid="choose-xi">
            Choose playing XI
          </button>
          {userCheck.warnings.length ? <span className="warn">{userCheck.warnings[0]}</span> : null}
          <button type="button" className="primary" onClick={start} disabled={!userCheck.ok} data-testid="start-match">
            Start match
          </button>
        </footer>
      </section>
    </div>
  );
}

function Rating({ value }: { value: number }) {
  return (
    <span className="rating" title={String(value)}>
      <span style={{ width: `${value}%` }} />
    </span>
  );
}

type Drag = { id: string; from: 'xi' | 'bench'; x: number; y: number; started: boolean; ox: number; oy: number };


/** The drop target under the pointer: a batting-order slot (or the end of the list), or the bench. */
function dropAt(x: number, y: number): Drop {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]');
  if (!el) return undefined;
  if (el.dataset.drop === 'bench') return { zone: 'bench' };
  const index = Number(el.dataset.index ?? 'NaN');
  return Number.isFinite(index) ? { zone: 'xi', index } : undefined;
}

export function SquadPicker() {
  const setup = useGame((s) => s.setup);
  const update = useGame((s) => s.updateSetup);
  const goTo = useGame((s) => s.goTo);
  const [side, setSide] = useState<'user' | 'opponent'>('user');
  const [drag, setDrag] = useState<Drag | undefined>(undefined);
  const [hover, setHover] = useState<Drop>(undefined);
  const team = findTeam(side === 'user' ? setup.userTeamId : setup.opponentId);
  const xiIds = side === 'user' ? setup.userXi : setup.opponentXi;
  const xi = xiIds.map((id) => team.players.find((p) => p.id === id)).filter((p): p is Player => p !== undefined);
  const bench = team.players.filter((p) => !xiIds.includes(p.id));
  const check = checkXi(team, xi);
  const xiIdsRef = useRef(xiIds);
  xiIdsRef.current = xiIds;
  const setXi = useCallback((ids: string[]) => update(side === 'user' ? { userXi: ids } : { opponentXi: ids }), [update, side]);
  const move = (i: number, d: -1 | 1) => {
    const p = xiIds[i];
    if (p !== undefined && i + d >= 0 && i + d < xiIds.length) setXi(applyDrop(xiIds, p, 'xi', { zone: 'xi', index: d > 0 ? i + 2 : i - 1 }));
  };

  // Dragging with the pointer (mouse, pen or touch): a card follows it; the slot under it lights up.
  const begin = (e: React.PointerEvent, id: string, from: 'xi' | 'bench') => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const d = { id, from, x: e.clientX, y: e.clientY, started: false, ox: e.clientX - r.left, oy: e.clientY - r.top };
    live.current = d;
    setDrag(d);
  };
  // The live drag lives in a ref, so a release straight after a move (a quick flick) still sees it.
  const live = useRef<Drag | undefined>(undefined);
  live.current = drag;
  const dragging = drag !== undefined;
  useEffect(() => {
    if (!dragging) return;
    const moveTo = (e: PointerEvent) => {
      const d = live.current;
      if (!d) return;
      const started = d.started || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4;
      const next = { ...d, x: e.clientX, y: e.clientY, started };
      live.current = next;
      setDrag(next);
      if (started) setHover(dropAt(e.clientX, e.clientY));
    };
    const end = (e: PointerEvent) => {
      const d = live.current;
      live.current = undefined;
      if (d && (d.started || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4)) setXi(applyDrop(xiIdsRef.current, d.id, d.from, dropAt(e.clientX, e.clientY)));
      setDrag(undefined);
      setHover(undefined);
    };
    const cancel = () => {
      live.current = undefined;
      setDrag(undefined);
      setHover(undefined);
    };
    window.addEventListener('pointermove', moveTo);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', moveTo);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
    };
  }, [dragging, setXi]);

  const ratings = (p: Player) => {
    const bat = Math.round((p.batting.technique + p.batting.timing + p.batting.power) / 3);
    const bowl =
      p.bowlingStyle === 'none' ? 0 : Math.round((p.bowling.accuracy + (p.bowlingStyle === 'offSpin' || p.bowlingStyle === 'legSpin' ? p.bowling.spin : p.bowling.pace)) / 2);
    const fld = Math.round((p.fielding.fielding + p.fielding.catching) / 2);
    return (
      <span className="ratings">
        <span title={`Batting ${bat}`}>
          <small>Bat</small> <Rating value={bat} />
        </span>
        <span title={bowl ? `Bowling ${bowl}` : 'Does not bowl'}>
          <small>Bowl</small> {bowl ? <Rating value={bowl} /> : <span className="dim rating-none">—</span>}
        </span>
        <span title={`Fielding ${fld}`}>
          <small>Field</small> <Rating value={fld} />
        </span>
      </span>
    );
  };
  const who = (p: Player) => (
    <span className="who">
      <span className="who-name">
        {p.name}
        {team.captainId === p.id ? <span className="tag">c</span> : null}
        {team.keeperIds.includes(p.id) ? <span className="tag">wk</span> : null}
      </span>
      <span className="dim small">
        {p.battingHand === 'left' ? 'LHB' : 'RHB'}
        {p.bowlingStyle !== 'none' ? `, ${styleName(p)}` : ''}
      </span>
    </span>
  );
  const dragged = drag?.started ? team.players.find((p) => p.id === drag.id) : undefined;
  const hoverIndex = hover?.zone === 'xi' ? hover.index : -1;

  return (
    <div className={`menu-shell${dragged ? ' dragging' : ''}`}>
      <section className="board wide" aria-label="Choose playing XI" data-testid="squad">
        <header className="board-head">
          <h2>Playing XI</h2>
          <div className="segments small">
            <button type="button" className={side === 'user' ? 'on' : ''} aria-pressed={side === 'user'} onClick={() => setSide('user')}>
              {findTeam(setup.userTeamId).name}
            </button>
            <button type="button" className={side === 'opponent' ? 'on' : ''} aria-pressed={side === 'opponent'} onClick={() => setSide('opponent')}>
              {findTeam(setup.opponentId).name}
            </button>
          </div>
        </header>
        <p className="dim small squad-hint">Drag players to set the batting order, bring someone in from the bench, or drop him back on it.</p>

        <div className="squad-grid">
          <div>
            <h3>Batting order, {xi.length} of 11</h3>
            <ol className="order" data-testid="xi">
              {xi.map((p, i) => (
                <li
                  key={p.id}
                  className={`${hoverIndex === i ? 'drop-before' : ''}${drag?.started && drag.id === p.id ? ' lifted' : ''}`}
                  data-drop="xi"
                  data-index={i}
                  data-testid="xi-row"
                  onPointerDown={(e) => begin(e, p.id, 'xi')}
                >
                  <span className="grip" aria-hidden="true" />
                  <span className="pos">{i + 1}</span>
                  {who(p)}
                  {ratings(p)}
                  <span className="row-actions">
                    <button type="button" className="icon" aria-label={`Move ${p.name} up`} onClick={() => move(i, -1)} disabled={i === 0}>
                      ↑
                    </button>
                    <button type="button" className="icon" aria-label={`Move ${p.name} down`} onClick={() => move(i, 1)} disabled={i === xi.length - 1}>
                      ↓
                    </button>
                    <button type="button" className="icon" aria-label={`Leave out ${p.name}`} onClick={() => setXi(xiIds.filter((id) => id !== p.id))}>
                      ×
                    </button>
                  </span>
                </li>
              ))}
              {xi.length < 11 ? (
                <li className={`slot-empty${hoverIndex === xi.length ? ' drop-before' : ''}`} data-drop="xi" data-index={xi.length} data-testid="xi-empty">
                  Drop a player here ({11 - xi.length} to pick)
                </li>
              ) : null}
            </ol>
            {check.errors.map((e) => (
              <p key={e} className="error">
                {e}
              </p>
            ))}
            {check.warnings.map((w) => (
              <p key={w} className="warn">
                {w}
              </p>
            ))}
          </div>
          <div className={`bench${hover?.zone === 'bench' ? ' drop-on' : ''}`} data-drop="bench" data-testid="bench">
            <h3>Bench, {bench.length}</h3>
            <ul className="order">
              {bench.map((p) => (
                <li key={p.id} data-testid="bench-row" className={drag?.started && drag.id === p.id ? 'lifted' : ''} onPointerDown={(e) => begin(e, p.id, 'bench')}>
                  <span className="grip" aria-hidden="true" />
                  {who(p)}
                  {ratings(p)}
                  <span className="row-actions">
                    <button type="button" className="icon" aria-label={`Pick ${p.name}`} onClick={() => setXi([...xiIds, p.id])} disabled={xiIds.length >= 11}>
                      +
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <footer className="board-foot">
          <button type="button" onClick={() => setXi(team.players.slice(0, 11).map((p) => p.id))}>
            Reset to default XI
          </button>
          <button type="button" className="primary" onClick={() => goTo('setup')} disabled={!check.ok} data-testid="squad-done">
            Done
          </button>
        </footer>
      </section>
      {dragged && drag ? (
        <div className="drag-card" style={{ left: drag.x - drag.ox, top: drag.y - drag.oy }} aria-hidden="true">
          {dragged.name}
        </div>
      ) : null}
    </div>
  );
}

export function HowToPlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" role="dialog" aria-label="How to play">
      <div className="panel wide">
        <h2>Batting</h2>
        <p>
          The Cricket 07 keys. Hold an arrow for where you want to hit it — <kbd>↓</kbd> is straight back past the bowler, <kbd>←</kbd>/
          <kbd>→</kbd> square, the diagonals in front of or behind square, as you see it on screen — then press a shot key just before
          the ball reaches the batter. Too early or too late changes where it goes and how cleanly it comes off the bat: the timing
          gauge shows you which. The white marker is where the bowler is aiming to pitch it.
        </p>
        <table className="keys">
          <tbody>
            <tr>
              <td><kbd>S</kbd></td>
              <td>Front-foot shot: drives, flick, sweep (↗). Alone: forward defence.</td>
            </tr>
            <tr>
              <td><kbd>W</kbd></td>
              <td>Back-foot shot: square cut (off side), late cut, pull (leg side), punch. Alone: back-foot defence.</td>
            </tr>
            <tr>
              <td><kbd>D</kbd></td>
              <td>Use your feet: down the pitch to drive. Miss it and you may be stumped. After the hit, D runs.</td>
            </tr>
            <tr>
              <td><kbd>A</kbd></td>
              <td>Leave the ball.</td>
            </tr>
            <tr>
              <td><kbd>Shift</kbd></td>
              <td>Hold to loft it: lofted drives, slog sweep, reverse sweep, hook, upper cut.</td>
            </tr>
            <tr>
              <td><kbd>Space</kbd></td>
              <td>Run. Press again to go for the next one. Get caught short and you are run out.</td>
            </tr>
          </tbody>
        </table>
        <h2>Bowling</h2>
        <p>
          At the start of each over pick your bowler with the number keys (Enter takes the suggestion). Then every ball has three steps:
        </p>
        <table className="keys">
          <tbody>
            <tr>
              <td><kbd>1</kbd>–<kbd>6</kbd></td>
              <td>
                <strong>Delivery.</strong> Pace: stock, inswinger, outswinger, in-cutter, out-cutter, slower ball. Spin: stock, the variations, the
                wrong&apos;un. <kbd>↑</kbd>/<kbd>↓</kbd> how much it swings, cuts or spins. <kbd>O</kbd> over or around the wicket.{' '}
                <kbd>F</kbd> field (Shift+F back). <kbd>Space</kbd> next.
              </td>
            </tr>
            <tr>
              <td><kbd>Arrows</kbd></td>
              <td>
                <strong>Landing spot.</strong> Move the marker to where the ball should pitch. <kbd>Space</kbd> locks it and the bowler runs in;{' '}
                <kbd>Backspace</kbd> goes back.
              </td>
            </tr>
            <tr>
              <td><kbd>Space</kbd></td>
              <td>
                <strong>Run-up.</strong> Lock the pace on the meter: higher is quicker, the red zone is flat out and costs control (and risks a
                no-ball). <kbd>↑</kbd>/<kbd>↓</kbd> still change the swing, cut or spin until he lets go.
              </td>
            </tr>
          </tbody>
        </table>
        <h2>Fielding</h2>
        <p>
          When your fielder has the ball and the batters are running, hold <kbd>↑</kbd> to throw to the keeper or <kbd>↓</kbd> to the
          bowler, and let go to throw. Green is quick and accurate; red is forced and wild. Hit the stumps and they may be run out.
        </p>
        <h2>Autoplay and the toss</h2>
        <p>
          <kbd>Y</kbd> lets the computer play your side for the rest of the over, <kbd>U</kbd> for the rest of the innings; press it again to
          take over from the next ball. At the toss, call <kbd>H</kbd> heads or <kbd>T</kbd> tails; win it and choose <kbd>B</kbd> bat or{' '}
          <kbd>L</kbd> bowl.
        </p>
        <p className="dim">
          <kbd>P</kbd> pause · <kbd>C</kbd> camera · <kbd>M</kbd> sound · <kbd>V</kbd> commentary · <kbd>H</kbd> help
        </p>
        <button type="button" onClick={onClose} autoFocus>
          Close
        </button>
      </div>
    </div>
  );
}
