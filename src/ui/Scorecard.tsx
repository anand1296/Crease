import type { BattingCard, Dismissal, InningsState } from '../game/match/match.ts';
import { oversText } from '../game/match/match.ts';
import type { Team } from '../game/data/teams.ts';

/** How a batter got out, in scorecard shorthand. */
export function howOut(c: BattingCard, keeperName?: string): string {
  const d: Dismissal | undefined = c.dismissal;
  if (!d) return c.batted ? 'not out' : 'did not bat';
  switch (d.kind) {
    case 'bowled':
      return `b ${d.bowler ?? ''}`;
    case 'lbw':
      return `lbw b ${d.bowler ?? ''}`;
    case 'caught':
      if (d.fielder && d.fielder === d.bowler) return `c & b ${d.bowler}`;
      return `c ${d.fielder === keeperName ? '†' : ''}${d.fielder ?? ''} b ${d.bowler ?? ''}`;
    case 'runOut':
      return `run out (${d.fielder ?? ''})`;
    case 'stumped':
      return `st †${d.fielder ?? ''} b ${d.bowler ?? ''}`;
  }
}

export function Scorecard({ innings, batting, bowling }: { innings: InningsState; batting: Team; bowling: Team }) {
  const extras = innings.wides + innings.noBalls;
  const batted = innings.battingCards.filter((c) => c.batted);
  const yetToBat = innings.battingCards.filter((c) => !c.batted);
  return (
    <div className="scorecard">
      <h3>
        {batting.name}{' '}
        <span className="total">
          {innings.runs}/{innings.wickets}
        </span>{' '}
        <span className="dim">({oversText(innings.balls)} overs)</span>
      </h3>
      <table>
        <thead>
          <tr>
            <th scope="col">Batter</th>
            <th scope="col" />
            <th scope="col" className="num">R</th>
            <th scope="col" className="num">B</th>
            <th scope="col" className="num">4s</th>
            <th scope="col" className="num">6s</th>
          </tr>
        </thead>
        <tbody>
          {batted.map((c) => (
            <tr key={c.player.id}>
              <td>{c.player.name}</td>
              <td className="dim">{howOut(c)}</td>
              <td className="num strong">{c.runs}</td>
              <td className="num">{c.balls}</td>
              <td className="num">{c.fours}</td>
              <td className="num">{c.sixes}</td>
            </tr>
          ))}
          <tr>
            <td>Extras</td>
            <td className="dim">
              {innings.wides} wd, {innings.noBalls} nb
            </td>
            <td className="num strong">{extras}</td>
            <td colSpan={3} />
          </tr>
        </tbody>
      </table>
      {yetToBat.length ? <p className="dim small">Did not bat: {yetToBat.map((c) => c.player.name).join(', ')}</p> : null}
      {innings.fallOfWickets.length ? (
        <p className="dim small">
          Fall of wickets: {innings.fallOfWickets.map((f) => `${f.runs}-${f.wicket} (${f.batter}, ${oversText(f.balls)})`).join(', ')}
        </p>
      ) : null}
      <table>
        <thead>
          <tr>
            <th scope="col">{bowling.name} bowling</th>
            <th scope="col" className="num">O</th>
            <th scope="col" className="num">M</th>
            <th scope="col" className="num">R</th>
            <th scope="col" className="num">W</th>
            <th scope="col" className="num">Econ</th>
          </tr>
        </thead>
        <tbody>
          {innings.bowlingCards.map((c) => (
            <tr key={c.player.id}>
              <td>{c.player.name}</td>
              <td className="num">{oversText(c.balls)}</td>
              <td className="num">{c.maidens}</td>
              <td className="num">{c.runs}</td>
              <td className="num strong">{c.wickets}</td>
              <td className="num">{c.balls ? ((c.runs / c.balls) * 6).toFixed(1) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
