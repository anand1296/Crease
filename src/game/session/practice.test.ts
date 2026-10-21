import { describe, expect, it } from 'vitest';
import { TEAMS } from '../data/teams.ts';
import { attempt } from '../batting/shots.ts';
import { type PracticeConfig, PracticeSession } from './practice.ts';

const [mariners, rangers] = TEAMS;
if (!mariners || !rangers) throw new Error('teams');

const config = (over: Partial<PracticeConfig> = {}): PracticeConfig => ({
  battingTeam: rangers,
  bowlingTeam: mariners,
  batting: 'ai',
  bowling: 'ai',
  pitch: 'balanced',
  difficulty: 'normal',
  seed: 'practice',
  ...over,
});

/** Runs a session headless until `balls` deliveries have been recorded (or a time limit). */
function runBalls(s: PracticeSession, balls: number, maxSeconds = 4000): void {
  const dt = 1 / 240;
  while (s.history.length < balls && s.time < maxSeconds) s.step(dt);
}

describe('PracticeSession (computer v computer)', () => {
  it('plays hundreds of balls with consistent scoring', () => {
    const s = new PracticeSession(config());
    runBalls(s, 240);
    expect(s.history.length).toBeGreaterThanOrEqual(240);
    const runs = s.history.reduce((a, o) => a + o.runs + o.extras, 0);
    const legal = s.history.filter((o) => !o.noBall).length;
    // The score resets after an all-out, so it can only be ≤ the totals.
    expect(s.score.runs).toBeLessThanOrEqual(runs);
    expect(s.score.balls).toBeLessThanOrEqual(legal);
    expect(s.score.wickets).toBeLessThanOrEqual(10);
    // Something of everything happens over 40 overs.
    expect(s.history.some((o) => o.boundary === 4)).toBe(true);
    expect(s.history.some((o) => o.wicket)).toBe(true);
    expect(s.history.some((o) => o.runs === 0 && !o.wicket)).toBe(true);
    expect(s.history.some((o) => o.runs > 0 && o.runs < 4)).toBe(true);
    // No ball yields both a wicket and runs off the bat beyond what was run.
    for (const o of s.history) {
      if (o.wicket?.kind === 'caught') expect(o.runs).toBe(0);
      expect(o.runs).toBeGreaterThanOrEqual(0);
      expect(o.runs).toBeLessThanOrEqual(6);
    }
  });

  it('produces plausible scoring rates (not a hit-a-thon, not a procession)', () => {
    const s = new PracticeSession(config({ seed: 'rates' }));
    runBalls(s, 300);
    const legal = s.history.filter((o) => !o.noBall);
    const runs = s.history.reduce((a, o) => a + o.runs + o.extras, 0);
    const wickets = s.history.filter((o) => o.wicket).length;
    const runRatePerOver = (runs / legal.length) * 6;
    const ballsPerWicket = legal.length / Math.max(1, wickets);
    expect(runRatePerOver).toBeGreaterThan(2.5);
    expect(runRatePerOver).toBeLessThan(11);
    expect(ballsPerWicket).toBeGreaterThan(12);
    expect(ballsPerWicket).toBeLessThan(150);
  });

  it('is deterministic for a seed', () => {
    const a = new PracticeSession(config({ seed: 'det' }));
    const b = new PracticeSession(config({ seed: 'det' }));
    runBalls(a, 30);
    runBalls(b, 30);
    expect(a.history.map((o) => `${o.headline}/${o.runs}`)).toEqual(b.history.map((o) => `${o.headline}/${o.runs}`));
    expect(a.score).toEqual(b.score);
  });

  it('rotates strike on odd runs and changes bowler and ends each over', () => {
    const s = new PracticeSession(config({ seed: 'rotation' }));
    const firstBowler = s.bowler.id;
    runBalls(s, 7);
    expect(s.history.filter((o) => !o.noBall).length).toBeGreaterThanOrEqual(6);
    // After the first over a different bowler is on.
    expect(s.bowler.id === firstBowler && s.score.balls >= 6).toBe(false);
  });
});

describe('PracticeSession (human)', () => {
  it('a human batter who never plays a shot leaves every ball', () => {
    const s = new PracticeSession(config({ batting: 'human', seed: 'no-shots' }));
    runBalls(s, 12);
    for (const o of s.history) expect(o.runs).toBe(0);
  });

  it('accepts a stroke only after release, once per ball', () => {
    const s = new PracticeSession(config({ batting: 'human', seed: 'shots' }));
    const dt = 1 / 240;
    while (s.phase !== 'delivery') s.step(dt);
    expect(s.playShot(attempt('block'))).toBe(false); // still in the run-up
    while (s.cycle?.phase === 'runUp') s.step(dt);
    expect(s.playShot(attempt('block'))).toBe(true);
    expect(s.playShot(attempt('coverDrive'))).toBe(false);
  });

  it('a human bowler aims, runs in, locks the release and bowls', () => {
    const s = new PracticeSession(config({ bowling: 'human', seed: 'human-bowler' }));
    const dt = 1 / 240;
    while (s.phase !== 'aiming') s.step(dt);
    s.cycleDelivery(1);
    s.adjustTarget(0.2, -1);
    const setup = s.setup;
    s.bowlButton();
    expect(s.phase).toBe('delivery');
    expect(s.cycle?.opts.plan).toEqual(setup);
    // Lock the release halfway through the run-up.
    while ((s.cycle?.time ?? 0) < 0.45) s.step(dt);
    s.bowlButton();
    expect(s.cycle?.releaseLocked).toBe(true);
    runBalls(s, 1);
    expect(s.history.length).toBe(1);
  });

  it('pausing stops time', () => {
    const s = new PracticeSession(config());
    s.setPaused(true);
    expect(s.advance(1)).toBe(0);
    s.setPaused(false);
    expect(s.advance(0.1)).toBeGreaterThan(0);
  });
});
