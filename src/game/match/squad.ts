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
