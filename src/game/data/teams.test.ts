import { describe, expect, it } from 'vitest';
import { TEAMS, findTeam, kitColors } from './teams.ts';
import { checkXi, defaultXi } from '../match/squad.ts';

describe('national squads', () => {
  it('has India, Pakistan, Australia and England', () => {
    expect(TEAMS.map((t) => t.name)).toEqual(['India', 'Pakistan', 'Australia', 'England']);
  });

  it.each(TEAMS.map((t) => [t.name, t] as const))('%s: a full squad with a captain, a keeper and a valid default XI', (_, team) => {
    expect(team.players.length).toBeGreaterThanOrEqual(15);
    expect(new Set(team.players.map((p) => p.name)).size).toBe(team.players.length);
    expect(team.captainId).toBeDefined();
    expect(team.keeperIds.length).toBeGreaterThanOrEqual(1);
    const xi = defaultXi(team);
    const check = checkXi(team, xi);
    expect(check.errors).toEqual([]);
    expect(check.warnings).toEqual([]);
    // The captain and a keeper are in the default XI.
    expect(xi.some((p) => p.id === team.captainId)).toBe(true);
    expect(xi.some((p) => team.keeperIds.includes(p.id))).toBe(true);
  });

  it('the away side changes strip when the colours clash', () => {
    const india = findTeam('india');
    const england = findTeam('england');
    const pakistan = findTeam('pakistan');
    expect(kitColors(england, india, false).primary).toBe(england.colors.alt?.primary);
    expect(kitColors(india, england, false).primary).toBe(india.colors.alt?.primary);
    // The home side keeps its colours, and sides that do not clash keep theirs.
    expect(kitColors(india, england, true).primary).toBe(india.colors.primary);
    expect(kitColors(pakistan, india, false).primary).toBe(pakistan.colors.primary);
  });
});
