import type { Team } from '../data/teams.ts';
import { type Player, isSpinner } from '../model/player.ts';

/**
 * Squad selection: choose 11 from the squad, in batting order, with a keeper.
 */
export interface XiCheck {
  readonly ok: boolean;
  /** Blocking problems. */
  readonly errors: readonly string[];
  /** Advice that does not block selection. */
  readonly warnings: readonly string[];
}

export function defaultXi(team: Team): Player[] {
  return team.players.slice(0, 11);
}

/** The keeper for an XI: a specialist if one is picked, otherwise the best catcher. */
export function keeperFor(team: Team, xi: readonly Player[]): Player | undefined {
  return xi.find((p) => team.keeperIds.includes(p.id)) ?? xi.slice().sort((a, b) => b.fielding.catching - a.fielding.catching)[0];
}

export function checkXi(team: Team, xi: readonly Player[]): XiCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (xi.length !== 11) errors.push(`Pick exactly 11 players (${xi.length} selected).`);
  if (new Set(xi.map((p) => p.id)).size !== xi.length) errors.push('A player is selected twice.');
  if (xi.some((p) => !team.players.includes(p))) errors.push('Every player must come from the squad.');
  const bowlers = xi.filter((p) => p.bowlingStyle !== 'none' && !team.keeperIds.includes(p.id));
  if (bowlers.length < 5) warnings.push(`Only ${bowlers.length} bowling options — five are needed to bowl the full allocation.`);
  if (!xi.some((p) => team.keeperIds.includes(p.id))) warnings.push('No specialist keeper: the best catcher will keep wicket.');
  if (!xi.some((p) => isSpinner(p.bowlingStyle))) warnings.push('No spinner in the side.');
  return { ok: errors.length === 0, errors, warnings };
}

/** Where a dragged player is dropped: before a place in the batting order (or at its end), or on the bench. */
export type XiDrop = { zone: 'xi'; index: number } | { zone: 'bench' } | undefined;

/** What a drop does to the XI (ids in batting order). */
export function applyDrop(xi: readonly string[], id: string, from: 'xi' | 'bench', drop: XiDrop): string[] {
  const next = xi.slice();
  if (!drop) return next;
  if (drop.zone === 'bench') return from === 'xi' ? next.filter((x) => x !== id) : next;
  const to = Math.max(0, Math.min(drop.index, next.length));
  if (from === 'xi') {
    const i = next.indexOf(id);
    if (i < 0) return next;
    next.splice(i, 1);
    next.splice(i < to ? to - 1 : to, 0, id);
    return next;
  }
  // From the bench: in at that place, or (with eleven already) in place of the player there.
  if (next.length < 11) next.splice(to, 0, id);
  else if (to < next.length) next[to] = id;
  return next;
}

