/**
 * Achievements: small goals across every match, practice and net session,
 * kept in this browser. Each is checked after every ball the player takes
 * part in; a new one is announced on screen once.
 */
import type { BallOutcome } from './session/deliveryCycle.ts';

export type AchievementId =
  | 'firstFour'
  | 'firstSix'
  | 'perfect'
  | 'fifty'
  | 'hundred'
  | 'diveHome'
  | 'sprintThree'
  | 'firstWicket'
  | 'bowledHim'
  | 'yorkerWicket'
  | 'hatTrick'
  | 'maiden'
  | 'win'
  | 'chase'
  | 'superOver'
  | 'groove';

export interface Achievement {
  readonly id: AchievementId;
  readonly title: string;
  readonly how: string;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'firstFour', title: 'Find the rope', how: 'Hit a four.' },
  { id: 'firstSix', title: 'Into the stands', how: 'Hit a six.' },
  { id: 'perfect', title: 'Sweet as you like', how: 'Middle a stroke timed to within 10 ms.' },
  { id: 'fifty', title: 'Raise the bat', how: 'Score fifty with one batter.' },
  { id: 'hundred', title: 'Centurion', how: 'Score a hundred with one batter.' },
  { id: 'diveHome', title: 'Made his ground', how: 'Dive for the crease and make it.' },
  { id: 'sprintThree', title: 'Hard yards', how: 'Run three on one ball.' },
  { id: 'firstWicket', title: 'First blood', how: 'Take a wicket bowling.' },
  { id: 'bowledHim', title: 'Timber!', how: 'Bowl a batter.' },
  { id: 'yorkerWicket', title: 'Toe crusher', how: 'Take a wicket with a yorker.' },
  { id: 'hatTrick', title: 'Hat-trick', how: 'Three wickets in three balls.' },
  { id: 'maiden', title: 'Nothing doing', how: 'Bowl a maiden over.' },
  { id: 'win', title: 'Winners', how: 'Win a match.' },
  { id: 'chase', title: 'Chased it down', how: 'Win a match batting second.' },
  { id: 'superOver', title: 'Nerves of steel', how: 'Win a super over.' },
  { id: 'groove', title: 'In the groove', how: 'Middle five in a row in the nets.' },
];

/** What happened on a ball, from the player's side. */
export interface BallFacts {
  readonly outcome: BallOutcome;
  /** The player was batting (else bowling). */
  readonly batting: boolean;
  /** The striker's runs after the ball (batting). */
  readonly batterRuns: number;
  /** Timing of the stroke, ms (batting, when one was played). */
  readonly timingMs?: number | undefined;
  /** The over just finished, as the bowler's maiden (bowling). */
  readonly maiden?: boolean;
  /** The bowler has just completed a hat-trick. */
  readonly hatTrick?: boolean;
  /** The delivery type id. */
  readonly deliveryType?: string | undefined;
  /** Dives that made the crease on this ball. */
  readonly dived?: boolean;
  /** Middled strokes in a row in the nets. */
  readonly netsStreak?: number;
}

/** The achievements a ball earns. */
export function earned(f: BallFacts): AchievementId[] {
  const o = f.outcome;
  const out: AchievementId[] = [];
  if (f.batting) {
    if (o.boundary === 4) out.push('firstFour');
    if (o.boundary === 6) out.push('firstSix');
    if (o.contact?.kind === 'middled' && f.timingMs !== undefined && Math.abs(f.timingMs) <= 10) out.push('perfect');
    if (f.batterRuns >= 50) out.push('fifty');
    if (f.batterRuns >= 100) out.push('hundred');
    if (f.dived && !o.wicket) out.push('diveHome');
    if (!o.boundary && o.runs >= 3) out.push('sprintThree');
    if ((f.netsStreak ?? 0) >= 5) out.push('groove');
  } else {
    const w = o.wicket;
    if (w && w.kind !== 'runOut') out.push('firstWicket');
    if (w?.kind === 'bowled') out.push('bowledHim');
    if (w && w.kind !== 'runOut' && f.deliveryType === 'yorker') out.push('yorkerWicket');
    if (f.hatTrick) out.push('hatTrick');
    if (f.maiden) out.push('maiden');
  }
  return out;
}

/** The result of a match the player was in. */
export function earnedByResult(r: { won: boolean; battedSecond: boolean; superOver: boolean }): AchievementId[] {
  if (!r.won) return [];
  return ['win', ...(r.battedSecond ? (['chase'] as const) : []), ...(r.superOver ? (['superOver'] as const) : [])];
}

const KEY = 'crease.achievements';

/** Unlocked achievements and when (ISO date). */
export function readAchievements(): Partial<Record<AchievementId, string>> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<AchievementId, string>>) : {};
  } catch {
    return {};
  }
}

/** Records new ones; returns those that were new. */
export function unlock(ids: readonly AchievementId[], when = new Date().toISOString()): AchievementId[] {
  const have = readAchievements();
  const fresh = [...new Set(ids)].filter((id) => !have[id]);
  if (!fresh.length) return [];
  for (const id of fresh) have[id] = when;
  try {
    localStorage.setItem(KEY, JSON.stringify(have));
  } catch {
    // Not persisted: still announced.
  }
  return fresh;
}

export const achievement = (id: AchievementId): Achievement => ACHIEVEMENTS.find((a) => a.id === id) ?? (ACHIEVEMENTS[0] as Achievement);
