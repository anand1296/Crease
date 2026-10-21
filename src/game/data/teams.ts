import type { BowlingStyle, Hand, Player } from '../model/player.ts';

/**
 * Sample teams. All players are fictional. Add a team by adding an entry to
 * TEAMS — the engine reads only this data, so no engine changes are needed.
 *
 * Attribute order in the compact rows below:
 *   bat:  technique, timing, power, footwork, defence
 *   bowl: pace, swing, spin, accuracy, stamina
 *   fld:  fielding, catching, throwing
 */
export interface Team {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly colors: { readonly primary: string; readonly secondary: string };
  /** Batting order. */
  readonly players: readonly Player[];
}

type Row = [
  name: string,
  bat: Hand,
  arm: Hand,
  style: BowlingStyle,
  bat5: [number, number, number, number, number],
  bowl5: [number, number, number, number, number],
  fld3: [number, number, number],
];

function player(teamId: string, i: number, [name, bat, arm, style, b, w, f]: Row): Player {
  return {
    id: `${teamId}-${i + 1}`,
    name,
    battingHand: bat,
    bowlingArm: arm,
    bowlingStyle: style,
    batting: { technique: b[0], timing: b[1], power: b[2], footwork: b[3], defence: b[4] },
    bowling: { pace: w[0], swing: w[1], spin: w[2], accuracy: w[3], stamina: w[4] },
    fielding: { fielding: f[0], catching: f[1], throwing: f[2] },
  };
}

function team(id: string, name: string, shortName: string, colors: Team['colors'], rows: Row[]): Team {
  return { id, name, shortName, colors, players: rows.map((r, i) => player(id, i, r)) };
}

export const TEAMS: readonly Team[] = [
  team('mariners', 'Harbour City Mariners', 'HCM', { primary: '#1f4e8c', secondary: '#f2c14e' }, [
    ['Arjun Mehta', 'right', 'right', 'medium', [82, 80, 62, 78, 84], [30, 30, 10, 45, 60], [78, 80, 70]],
    ['Tom Whitfield', 'left', 'right', 'none', [78, 76, 70, 74, 72], [10, 10, 10, 20, 50], [74, 76, 72]],
    ['Kavi Raman', 'right', 'right', 'offSpin', [86, 84, 68, 82, 80], [40, 10, 55, 60, 60], [80, 84, 74]],
    ['Daniel Osei', 'right', 'right', 'fastMedium', [74, 78, 88, 70, 62], [62, 58, 10, 62, 70], [76, 72, 82]],
    ['Liam Carver', 'left', 'left', 'legSpin', [70, 72, 80, 68, 60], [45, 10, 72, 64, 66], [72, 70, 74]],
    ['Ravi Kulkarni', 'right', 'right', 'none', [76, 70, 74, 72, 68], [10, 10, 10, 20, 50], [84, 86, 70]],
    ['Sam Adeyemi', 'right', 'right', 'fast', [58, 62, 78, 56, 50], [86, 74, 10, 70, 72], [70, 68, 84]],
    ['Ben Hollis', 'right', 'left', 'fastMedium', [52, 56, 66, 52, 50], [74, 82, 10, 76, 80], [66, 70, 78]],
    ['Imran Qadir', 'right', 'right', 'offSpin', [46, 52, 60, 50, 46], [42, 10, 80, 82, 82], [68, 72, 66]],
    ['Owen Price', 'left', 'right', 'fast', [34, 40, 58, 38, 36], [90, 66, 10, 64, 64], [64, 62, 86]],
    ['Nikhil Rao', 'right', 'left', 'legSpin', [30, 36, 50, 34, 34], [40, 10, 84, 74, 76], [62, 64, 64]],
  ]),
  team('rangers', 'Highland Rangers', 'HLR', { primary: '#8c1f2e', secondary: '#e8e3d6' }, [
    ['Callum Reid', 'right', 'right', 'none', [84, 78, 66, 80, 86], [10, 10, 10, 20, 50], [76, 82, 72]],
    ['Aaron Bakshi', 'left', 'left', 'medium', [76, 82, 78, 76, 66], [36, 44, 10, 50, 60], [80, 78, 74]],
    ['Marcus Lyle', 'right', 'right', 'none', [88, 86, 72, 84, 82], [10, 10, 10, 20, 50], [74, 80, 70]],
    ['Faisal Noor', 'right', 'right', 'legSpin', [72, 74, 82, 74, 62], [44, 10, 74, 66, 64], [78, 76, 72]],
    ['Ethan Burke', 'left', 'right', 'fastMedium', [74, 72, 84, 70, 64], [70, 66, 10, 68, 76], [82, 80, 84]],
    ['Josh Tan', 'right', 'right', 'none', [70, 74, 72, 76, 66], [10, 10, 10, 20, 50], [86, 88, 72]],
    ['Ricky Dunn', 'right', 'right', 'offSpin', [62, 64, 66, 60, 58], [40, 10, 78, 78, 78], [70, 72, 68]],
    ['Viktor Hale', 'right', 'right', 'fast', [48, 52, 70, 50, 44], [92, 70, 10, 66, 70], [68, 66, 86]],
    ['Pete Morrow', 'left', 'left', 'fastMedium', [44, 48, 62, 46, 44], [76, 86, 10, 78, 78], [66, 68, 76]],
    ['Dev Sharma', 'right', 'right', 'fast', [36, 40, 56, 40, 38], [84, 76, 10, 74, 74], [64, 66, 80]],
    ['Tariq Aziz', 'right', 'left', 'offSpin', [28, 34, 44, 32, 30], [38, 10, 82, 80, 80], [62, 64, 62]],
  ]),
];

export function findTeam(id: string): Team {
  const t = TEAMS.find((team) => team.id === id);
  if (!t) throw new Error(`Unknown team ${id}`);
  return t;
}

export function findPlayer(team: Team, predicate: (p: Player) => boolean): Player {
  const p = team.players.find(predicate);
  if (!p) throw new Error(`No matching player in ${team.name}`);
  return p;
}
