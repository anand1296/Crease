import { describe, expect, it } from 'vitest';
import { TEAMS } from '../data/teams.ts';
import type { Team } from '../data/teams.ts';
import { type MatchConfig, Match } from './match.ts';
import { defaultXi, keeperFor } from './squad.ts';

const team = (i: number): Team => {
  const t = TEAMS[i];
  if (!t) throw new Error('team');
  return t;
};
const side = (t: Team, controller: 'human' | 'ai') => {
  const xi = defaultXi(t);
  return { team: t, xi, keeperId: keeperFor(t, xi)?.id ?? '', controller };
};
const config = (over: Partial<MatchConfig> = {}): MatchConfig => ({
  home: side(team(0), 'ai'),
  away: side(team(1), 'ai'),
  overs: 4,
  battingFirst: 'home',
  pitch: 'balanced',
  difficulty: 'normal',
  seed: 'save',
  weather: 'overcast',
  ...over,
});
const dt = 1 / 240;

function playUntil(m: Match, done: () => boolean, max = 20000): void {
  while (!done() && m.phase !== 'complete' && m.time < max) {
    if (m.phase === 'review') m.next();
    else if (m.phase === 'inningsBreak') m.continueAfterBreak();
    else m.step(dt);
  }
}

describe('saving and loading a match', () => {
  it('a match saved between balls and loaded carries on exactly as it would have', () => {
    const original = new Match(config());
    playUntil(original, () => original.history.length >= 17 && original.phase === 'between');
    const state = JSON.parse(JSON.stringify(original.saveState()));
    const loaded = new Match(config());
    loaded.restoreState(state);
    expect(loaded.current.runs).toBe(original.current.runs);
    expect(loaded.current.wickets).toBe(original.current.wickets);
    expect(loaded.history.length).toBe(original.history.length);
    expect(loaded.bowler.id).toBe(original.bowler.id);
    expect(loaded.striker.id).toBe(original.striker.id);
    playUntil(original, () => false);
    playUntil(loaded, () => false);
    expect(loaded.result?.summary).toBe(original.result?.summary);
    expect(loaded.innings.map((i) => [i.runs, i.wickets, i.balls])).toEqual(original.innings.map((i) => [i.runs, i.wickets, i.balls]));
    // Cards keep their players (restored as the same squad objects).
    expect(loaded.innings[0]?.battingCards[0]?.player).toBe(original.innings[0]?.battingCards[0]?.player);
  });

  it('saved during a ball, it goes back to the start of that ball', () => {
    const m = new Match(config({ home: side(team(0), 'human'), seed: 'save-mid' }));
    playUntil(m, () => m.history.length >= 5 && m.phase === 'delivery' && m.cycle?.phase === 'inFlight');
    const balls = m.history.length;
    const state = JSON.parse(JSON.stringify(m.saveState()));
    const loaded = new Match(config({ home: side(team(0), 'human'), seed: 'save-mid' }));
    loaded.restoreState(state);
    expect(loaded.history.length).toBe(balls);
    // A human is playing: the loaded match waits for him to be ready.
    expect(loaded.phase).toBe('review');
    expect(loaded.review?.kind).toBe('start');
    loaded.next();
    playUntil(loaded, () => loaded.history.length > balls);
    expect(loaded.history.length).toBe(balls + 1);
  });

  it('the state survives JSON (what is stored in the browser) in a modest size', () => {
    const m = new Match(config({ overs: 5 }));
    playUntil(m, () => m.innings.length === 2 && m.history.length > 40);
    const json = JSON.stringify(m.saveState());
    expect(json.length).toBeLessThan(2_000_000);
  });

  it('saved just after a ball (dead, already scored), it keeps that ball and finishes it first', () => {
    const m = new Match(config({ seed: 'save-dead' }));
    playUntil(m, () => m.history.length >= 3 && m.phase === 'delivery' && m.cycle?.phase === 'dead');
    const balls = m.history.length;
    const state = JSON.parse(JSON.stringify(m.saveState()));
    const loaded = new Match(config({ seed: 'save-dead' }));
    loaded.restoreState(state);
    expect(loaded.history.length).toBe(balls);
    expect(loaded.striker.id).toBe(m.striker.id);
  });

  it('saved while waiting for "next ball", it loads on the card to start again from', () => {
    const m = new Match(config({ home: side(team(0), 'human'), seed: 'save-review' }));
    m.next();
    playUntil(m, () => m.phase === 'review' && m.review?.kind === 'ball' && m.history.length >= 2);
    const state = JSON.parse(JSON.stringify(m.saveState()));
    const loaded = new Match(config({ home: side(team(0), 'human'), seed: 'save-review' }));
    loaded.restoreState(state);
    expect(loaded.phase).toBe('review');
    expect(loaded.review?.kind).toBe('start');
    expect(loaded.history.length).toBe(m.history.length);
  });
});
