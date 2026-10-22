import { useEffect } from 'react';
import type { Team } from '../game/data/teams.ts';
import type { CoinFace, TossChoice } from '../game/match/toss.ts';
import { findTeam, useGame } from '../state/game.ts';

/**
 * The toss graphic: a broadcast lower third over the scene in the middle.
 * Call it (H / T), watch the coin, then — if you won — bat or bowl (B / L).
 */
const captainName = (team: Team) => (team.players.find((p) => p.id === team.captainId) ?? team.players[0])?.name ?? team.name;

function Chip({ team }: { team: Team }) {
  return (
    <span className="toss-chip" style={{ background: team.colors.primary, color: team.colors.secondary }}>
      {team.shortName}
    </span>
  );
}

export function TossPanel() {
  const toss = useGame((s) => s.toss);
  const setup = useGame((s) => s.setup);
  const callToss = useGame((s) => s.callToss);
  const choose = useGame((s) => s.chooseAtToss);
  const goTo = useGame((s) => s.goTo);
  const stage = toss?.stage;
  const userWins = toss?.userWins;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
      if (stage === 'call') {
        if (e.code === 'KeyH') callToss('heads');
        else if (e.code === 'KeyT') callToss('tails');
        else if (e.code === 'Escape') goTo('setup');
      } else if (stage === 'result') {
        if (userWins && e.code === 'KeyB') choose('bat');
        else if (userWins && e.code === 'KeyL') choose('bowl');
        else if (!userWins && (e.code === 'Enter' || e.code === 'Space')) choose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage, userWins, callToss, choose, goTo]);

  if (!toss) return null;
  const user = findTeam(setup.userTeamId);
  const opp = findTeam(setup.opponentId);
  const face = (f: CoinFace) => (f === 'heads' ? 'Heads' : 'Tails');
  const winner = toss.userWins ? user : opp;
  const chosen: TossChoice = toss.computerChoice;

  return (
    <section className="toss" aria-label="The toss" data-testid="toss" data-stage={toss.stage}>
      <header className="toss-head">
        <Chip team={user} />
        <span className="toss-title">The toss</span>
        <Chip team={opp} />
      </header>
      {toss.stage === 'call' ? (
        <>
          <p className="toss-line">
            {captainName(opp)} spins the coin. {captainName(user)}, your call.
          </p>
          <div className="toss-actions">
            <button type="button" className="primary" onClick={() => callToss('heads')} data-testid="call-heads" autoFocus>
              Heads <kbd>H</kbd>
            </button>
            <button type="button" className="primary" onClick={() => callToss('tails')} data-testid="call-tails">
              Tails <kbd>T</kbd>
            </button>
            <button type="button" className="secondary" onClick={() => goTo('setup')}>
              Back
            </button>
          </div>
        </>
      ) : toss.stage === 'flip' ? (
        <p className="toss-line" aria-live="polite">
          {captainName(user)} calls {toss.call === 'heads' ? 'heads' : 'tails'}…
        </p>
      ) : (
        <>
          <p className="toss-result" aria-live="polite" data-testid="toss-result">
            {face(toss.face)}. {toss.userWins ? 'You won the toss.' : `${winner.name} won the toss and chose to ${chosen}.`}
          </p>
          <div className="toss-actions">
            {toss.userWins ? (
              <>
                <button type="button" className="primary" onClick={() => choose('bat')} data-testid="toss-bat" autoFocus>
                  Bat first <kbd>B</kbd>
                </button>
                <button type="button" className="primary" onClick={() => choose('bowl')} data-testid="toss-bowl">
                  Bowl first <kbd>L</kbd>
                </button>
              </>
            ) : (
              <button type="button" className="primary" onClick={() => choose()} data-testid="toss-continue" autoFocus>
                {chosen === 'bat' ? 'Take the field' : 'Walk out to bat'} <kbd>Enter</kbd>
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
