import { useState } from 'react';
import type { InningsState, Match } from '../game/match/match.ts';
import { oversText } from '../game/match/match.ts';

/**
 * Match statistics for the pause screen: the state of the innings, runs per
 * over (a Manhattan, with the first innings alongside in the chase), and
 * batting and bowling figures beyond the scorecard's.
 */

const THIS_INNINGS = '#b38625';
const FIRST_INNINGS = '#3f9ad6';

const rate = (runs: number, balls: number) => (balls ? ((runs / balls) * 6).toFixed(2) : '0.00');
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '–');

function Tile({ label, value, note }: { label: string; value: string; note?: string | undefined }) {
  return (
    <div className="stat-tile">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {note ? <span className="stat-note">{note}</span> : null}
    </div>
  );
}

/** Runs per over as bars, wickets marked above them; in the chase, the first innings' overs beside them. */
function Manhattan({ current, first, maxOvers }: { current: InningsState; first: InningsState | undefined; maxOvers: number }) {
  const [hover, setHover] = useState<number | undefined>(undefined);
  const overs = Math.max(maxOvers, current.overs.length, first?.overs.length ?? 0);
  const top = Math.max(12, ...current.overs.map((o) => o.runs), ...(first?.overs.map((o) => o.runs) ?? []));
  const W = 560;
  const H = 150;
  const padL = 26;
  const padB = 20;
  const plotH = H - padB - 14;
  const slot = (W - padL) / overs;
  const pair = first !== undefined;
  const bar = Math.max(2, Math.min(18, (pair ? slot / 2 : slot) - 3));
  const y = (r: number) => H - padB - (r / top) * plotH;
  const ticks = [0, Math.round(top / 2), top];
  const hovered = hover !== undefined ? { now: current.overs[hover], then: first?.overs[hover] } : undefined;
  const bars = (inn: InningsState, color: string, offset: number) =>
    inn.overs.map((o, i) => {
      const x = padL + i * slot + offset;
      const h = Math.max(o.runs ? 2 : 0, (o.runs / top) * plotH);
      return (
        <g key={`${color}-${i}`}>
          {/* Rounded at the data end, square at the baseline. */}
          <path d={`M${x},${H - padB} v${-Math.max(0, h - 2)} q0,-2 2,-2 h${bar - 4} q2,0 2,2 v${Math.max(0, h - 2)} z`} fill={color} />
          {Array.from({ length: o.wickets }, (_, k) => (
            <circle key={k} cx={x + bar / 2} cy={y(o.runs) - 6 - k * 7} r={2.6} className="mh-wicket" />
          ))}
        </g>
      );
    });
  return (
    <figure className="manhattan">
      <figcaption>
        Runs per over
        {pair ? (
          <span className="legend">
            <span className="swatch" style={{ background: THIS_INNINGS }} /> This innings
            <span className="swatch" style={{ background: FIRST_INNINGS }} /> First innings
          </span>
        ) : null}
        <span className="legend">
          <span className="swatch wicket" /> Wicket
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Runs scored in each over" onMouseLeave={() => setHover(undefined)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} className="mh-grid" />
            <text x={padL - 6} y={y(t) + 3} className="mh-axis" textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {pair && first ? bars(first, FIRST_INNINGS, slot / 2) : null}
        {bars(current, THIS_INNINGS, pair ? 1 : (slot - bar) / 2)}
        {Array.from({ length: overs }, (_, i) =>
          overs <= 20 || (i + 1) % 5 === 0 ? (
            <text key={i} x={padL + i * slot + slot / 2} y={H - 5} className="mh-axis" textAnchor="middle">
              {i + 1}
            </text>
          ) : null,
        )}
        {/* Hover targets: the whole column of each over. */}
        {Array.from({ length: overs }, (_, i) => (
          <rect key={i} x={padL + i * slot} y={0} width={slot} height={H - padB} className={`mh-hit${hover === i ? ' on' : ''}`} onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      <p className="mh-readout" aria-live="polite">
        {hover !== undefined && hovered
          ? `Over ${hover + 1}: ${hovered.now ? `${hovered.now.runs} run${hovered.now.runs === 1 ? '' : 's'}${hovered.now.wickets ? `, ${hovered.now.wickets} wicket${hovered.now.wickets > 1 ? 's' : ''}` : ''}` : 'not bowled yet'}${
              pair ? ` (first innings ${hovered.then ? `${hovered.then.runs}${hovered.then.wickets ? `/${hovered.then.wickets}` : ''}` : '–'})` : ''
            }`
          : 'Point at an over for its runs.'}
      </p>
    </figure>
  );
}

export function MatchStats({ match }: { match: Match }) {
  const inn = match.current;
  const first = match.innings.length > 1 ? match.innings[0] : undefined;
  const total = match.config.overs * 6;
  const fall = inn.fallOfWickets[inn.fallOfWickets.length - 1];
  const partnership = { runs: inn.runs - (fall?.runs ?? 0), balls: inn.balls - (fall?.balls ?? 0) };
  const dots = inn.battingCards.reduce((n, c) => n + c.dots, 0);
  const faced = inn.battingCards.reduce((n, c) => n + c.balls, 0);
  const last = inn.overs.slice(-5);
  const lastRuns = last.reduce((n, o) => n + o.runs, 0);
  const chase = match.chase;
  const projected = inn.balls ? Math.round((inn.runs / inn.balls) * total) : 0;
  const batting = match.side(inn.batting).team;
  const bowling = match.side(inn.bowling).team;
  const atCrease = new Set([match.striker.id, match.nonStriker.id]);
  return (
    <div className="match-stats" data-testid="match-stats">
      <h3>
        {batting.name} {inn.runs}/{inn.wickets} <span className="dim">({oversText(inn.balls)} of {match.config.overs} overs)</span>
      </h3>
      <div className="stat-tiles">
        <Tile label="Run rate" value={rate(inn.runs, inn.balls)} />
        {chase ? (
          <Tile label="Required rate" value={rate(chase.needed, chase.ballsLeft)} note={`${chase.needed} from ${chase.ballsLeft}`} />
        ) : (
          <Tile label="Projected" value={String(projected)} note="at this rate" />
        )}
        <Tile label="Partnership" value={`${partnership.runs}`} note={`${partnership.balls} balls`} />
        <Tile label="Last 5 overs" value={`${lastRuns}`} note={`${last.reduce((n, o) => n + o.wickets, 0)} wkts`} />
        <Tile label="Boundaries" value={`${inn.fours} × 4, ${inn.sixes} × 6`} />
        <Tile label="Dot balls" value={pct(dots, faced)} note={`${dots} of ${faced}`} />
        <Tile label="Extras" value={String(inn.wides + inn.noBalls)} note={`${inn.wides} wd, ${inn.noBalls} nb`} />
      </div>
      <Manhattan current={inn} first={first} maxOvers={match.config.overs} />
      <div className="cards">
        <table className="stats-table">
          <caption>{batting.name} batting</caption>
          <thead>
            <tr>
              <th scope="col">Batter</th>
              <th scope="col" className="num">R</th>
              <th scope="col" className="num">B</th>
              <th scope="col" className="num">SR</th>
              <th scope="col" className="num">4s</th>
              <th scope="col" className="num">6s</th>
              <th scope="col" className="num">Dots</th>
            </tr>
          </thead>
          <tbody>
            {inn.battingCards
              .filter((c) => c.batted)
              .map((c) => (
                <tr key={c.player.id} className={atCrease.has(c.player.id) && !c.dismissal ? 'at-crease' : ''}>
                  <td>
                    {c.player.name}
                    {atCrease.has(c.player.id) && !c.dismissal ? (c.player.id === match.striker.id ? ' *' : '') : ''}
                  </td>
                  <td className="num strong">{c.runs}</td>
                  <td className="num">{c.balls}</td>
                  <td className="num">{c.balls ? ((c.runs / c.balls) * 100).toFixed(1) : '–'}</td>
                  <td className="num">{c.fours}</td>
                  <td className="num">{c.sixes}</td>
                  <td className="num">{pct(c.dots, c.balls)}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <table className="stats-table">
          <caption>{bowling.name} bowling</caption>
          <thead>
            <tr>
              <th scope="col">Bowler</th>
              <th scope="col" className="num">O</th>
              <th scope="col" className="num">R</th>
              <th scope="col" className="num">W</th>
              <th scope="col" className="num">Econ</th>
              <th scope="col" className="num">Dots</th>
              <th scope="col" className="num">4s/6s</th>
              <th scope="col" className="num">Ext</th>
            </tr>
          </thead>
          <tbody>
            {inn.bowlingCards.map((c) => (
              <tr key={c.player.id} className={c.player.id === match.bowler.id ? 'at-crease' : ''}>
                <td>{c.player.name}</td>
                <td className="num">{oversText(c.balls)}</td>
                <td className="num">{c.runs}</td>
                <td className="num strong">{c.wickets}</td>
                <td className="num">{rate(c.runs, c.balls)}</td>
                <td className="num">{c.dots}</td>
                <td className="num">
                  {c.fours}/{c.sixes}
                </td>
                <td className="num">{c.wides + c.noBalls}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
