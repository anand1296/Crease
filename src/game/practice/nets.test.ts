import { describe, expect, it } from 'vitest';
import { TEAMS, type Team } from '../data/teams.ts';
import { Match } from '../match/match.ts';
import { defaultXi, keeperFor } from '../match/squad.ts';
import { attempt } from '../batting/shots.ts';
import { NETS_BALLS } from './nets.ts';

const team = (i: number): Team => {
  const t = TEAMS[i];
  if (!t) throw new Error('team');
  return t;
};
const side = (t: Team, controller: 'human' | 'ai') => {
  const xi = defaultXi(t);
  return { team: t, xi, keeperId: keeperFor(t, xi)?.id ?? '', controller };
};
const dt = 1 / 240;

function nets(ball = NETS_BALLS[3]?.id ?? 'shortWide') {
  return new Match({
    home: side(team(0), 'human'),
    away: side(team(1), 'ai'),
    overs: 20,
    battingFirst: 'home',
    pitch: 'balanced',
    difficulty: 'normal',
    seed: 'nets',
    nets: { ball },
  });
}

/** Bowls one ball, pressing `shot` this many seconds after release (or not at all). */
function face(m: Match, shotAt?: number, shot = attempt('squareCut', 'back')) {
  while (m.phase === 'review') m.next();
  const waiting = () => (m.phase as string) === 'review' && m.review?.kind === 'ball';
  for (let i = 0; i < 240 * 40 && !waiting(); i++) {
    m.step(dt);
    const c = m.cycle;
    if (shotAt !== undefined && c?.phase === 'inFlight' && c.flightTime >= shotAt) m.playShot(shot);
  }
  return m.coaching('batter');
}

describe('coaching nets', () => {
  it('bowls exactly the same ball again, scores nothing, and the coach reads every attempt', () => {
    const m = nets('shortWide');
    const a = face(m, 0.2);
    const first = m.lastOutcome?.delivery;
    const b = face(m, 0.35);
    expect(m.lastOutcome?.delivery).toEqual(first);
    expect(m.current.runs).toBe(0);
    expect(m.current.balls).toBe(0);
    expect(m.netsAttempts).toBe(2);
    expect(a?.ball.words).toMatch(/short/i);
    expect(b?.options[0]?.name).toBe('Square cut');
    expect(m.strokeLog.length).toBe(2);
  });

  it('another ball of the kind, or a different kind, on request', () => {
    const m = nets('shortWide');
    face(m, 0.3);
    const first = m.lastOutcome?.delivery;
    m.newNetsVariant();
    face(m, 0.3);
    expect(m.lastOutcome?.delivery).not.toEqual(first);
    m.setNetsBall('halfVolley');
    const c = face(m, 0.3, attempt('straightDrive', 'front'));
    expect(c?.ball.words).toMatch(/full/i);
    expect(m.nets?.ball.id).toBe('halfVolley');
  });

  it('tells a late batter he is late, and an early one he is early', () => {
    const late = face(nets('halfVolley'), 0.4, attempt('straightDrive', 'front'));
    const early = face(nets('halfVolley'), 0.05, attempt('straightDrive', 'front'));
    expect(late?.timingWord === 'Late' || late?.timingWord === 'Too late').toBe(true);
    expect(early?.timingWord).toBe('Early');
    expect(early?.points[0]).toMatch(/Early by \d+ ms/);
  });
});
