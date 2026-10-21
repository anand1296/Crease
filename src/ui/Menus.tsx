import { useState } from 'react';
import { TEAMS, type Team } from '../game/data/teams.ts';
import { PITCHES, type PitchId } from '../game/data/pitches.ts';
import { DIFFICULTIES, type DifficultyId } from '../game/model/difficulty.ts';
import { checkXi } from '../game/match/squad.ts';
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
        </nav>
      </div>
      {help ? <HowToPlay onClose={() => setHelp(false)} /> : null}
    </div>
  );
}

const OVERS = [2, 5, 10, 20, 50];

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

export function SquadPicker() {
  const setup = useGame((s) => s.setup);
  const update = useGame((s) => s.updateSetup);
  const goTo = useGame((s) => s.goTo);
  const [side, setSide] = useState<'user' | 'opponent'>('user');
  const team = findTeam(side === 'user' ? setup.userTeamId : setup.opponentId);
  const xiIds = side === 'user' ? setup.userXi : setup.opponentXi;
  const xi = xiIds.map((id) => team.players.find((p) => p.id === id)).filter((p): p is Player => p !== undefined);
  const check = checkXi(team, xi);
  const setXi = (ids: string[]) => update(side === 'user' ? { userXi: ids } : { opponentXi: ids });
  const toggle = (p: Player) => {
    if (xiIds.includes(p.id)) setXi(xiIds.filter((id) => id !== p.id));
    else if (xiIds.length < 11) setXi([...xiIds, p.id]);
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= xiIds.length) return;
    const next = xiIds.slice();
    const a = next[i];
    const b = next[j];
    if (a === undefined || b === undefined) return;
    next[i] = b;
    next[j] = a;
    setXi(next);
  };
  return (
    <div className="menu-shell">
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

        <div className="squad-grid">
          <div>
            <h3>Squad · {team.players.length} players</h3>
            <table className="squad">
              <thead>
                <tr>
                  <th scope="col">Pick</th>
                  <th scope="col">Player</th>
                  <th scope="col">Bowling</th>
                  <th scope="col">Batting</th>
                  <th scope="col">Bowling skill</th>
                  <th scope="col">Fielding</th>
                </tr>
              </thead>
              <tbody>
                {team.players.map((p) => {
                  const picked = xiIds.includes(p.id);
                  const bat = Math.round((p.batting.technique + p.batting.timing + p.batting.power) / 3);
                  const bowl =
                    p.bowlingStyle === 'none'
                      ? 0
                      : Math.round((p.bowling.accuracy + (p.bowlingStyle === 'offSpin' || p.bowlingStyle === 'legSpin' ? p.bowling.spin : p.bowling.pace)) / 2);
                  const fld = Math.round((p.fielding.fielding + p.fielding.catching) / 2);
                  return (
                    <tr key={p.id} className={picked ? 'picked' : ''}>
                      <td>
                        <input
                          type="checkbox"
                          checked={picked}
                          disabled={!picked && xiIds.length >= 11}
                          onChange={() => toggle(p)}
                          aria-label={`Pick ${p.name}`}
                        />
                      </td>
                      <td>
                        {p.name}
                        {team.keeperIds.includes(p.id) ? <span className="tag">wk</span> : null}
                        <span className="hand">{p.battingHand === 'left' ? 'LHB' : 'RHB'}</span>
                      </td>
                      <td className="dim">{styleName(p)}</td>
                      <td>
                        <Rating value={bat} />
                      </td>
                      <td>{bowl ? <Rating value={bowl} /> : <span className="dim">—</span>}</td>
                      <td>
                        <Rating value={fld} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div>
            <h3>Batting order · {xi.length}/11</h3>
            <ol className="order">
              {xi.map((p, i) => (
                <li key={p.id}>
                  <span className="pos">{i + 1}</span>
                  <span className="who">{p.name}</span>
                  <button type="button" className="icon" aria-label={`Move ${p.name} up`} onClick={() => move(i, -1)} disabled={i === 0}>
                    ↑
                  </button>
                  <button type="button" className="icon" aria-label={`Move ${p.name} down`} onClick={() => move(i, 1)} disabled={i === xi.length - 1}>
                    ↓
                  </button>
                </li>
              ))}
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
    </div>
  );
}

export function HowToPlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" role="dialog" aria-label="How to play">
      <div className="panel wide">
        <h2>Batting</h2>
        <p>
          Hold an arrow key for where you want to hit it — directions are as you see them on screen — then press a stroke key just
          before the ball reaches the batter. The moment you press is when the batter commits. Early or late changes where the ball
          goes and how cleanly it comes off the bat.
        </p>
        <table className="keys">
          <tbody>
            <tr>
              <td><kbd>D</kbd></td>
              <td>Ground stroke. ↑ straight drive, ← / → cover drive or flick, ↖ ↗ off and on drives, ↙ late cut, ↘ glance. With Shift: cut and pull.</td>
            </tr>
            <tr>
              <td><kbd>A</kbd></td>
              <td>Lofted stroke in the direction held. Shift with the leg side: hook.</td>
            </tr>
            <tr>
              <td><kbd>S</kbd></td>
              <td>Defend. With an arrow: push it into a gap for a single.</td>
            </tr>
            <tr>
              <td><kbd>W</kbd></td>
              <td>Sweep; with the off-side arrow, reverse sweep.</td>
            </tr>
            <tr>
              <td><kbd>X</kbd></td>
              <td>Leave the ball.</td>
            </tr>
            <tr>
              <td><kbd>Shift</kbd></td>
              <td>Hold for back-foot strokes.</td>
            </tr>
            <tr>
              <td><kbd>Space</kbd></td>
              <td>Run. Press again to go for the next one. Get caught short and you are run out.</td>
            </tr>
          </tbody>
        </table>
        <h2>Bowling</h2>
        <p>
          At the start of each over pick your bowler with the number keys (Enter takes the suggestion). <kbd>Q</kbd>/<kbd>E</kbd>{' '}
          choose the delivery, arrows move the target on the pitch, <kbd>Space</kbd> runs in, and <kbd>Space</kbd> again while the
          needle is in the gold gives an accurate release.
        </p>
        <p className="dim">
          <kbd>P</kbd> pause · <kbd>C</kbd> camera · <kbd>M</kbd> sound · <kbd>H</kbd> help
        </p>
        <button type="button" onClick={onClose} autoFocus>
          Close
        </button>
      </div>
    </div>
  );
}
