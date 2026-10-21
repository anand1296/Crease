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
  /** Full squad. The first eleven, in order, are the default XI and batting order. */
  readonly players: readonly Player[];
  /** The squad's specialist wicketkeeper(s). */
  readonly keeperIds: readonly string[];
}

type Row = [
  name: string,
  bat: Hand,
  arm: Hand,
  style: BowlingStyle,
  bat5: [number, number, number, number, number],
  bowl5: [number, number, number, number, number],
  fld3: [number, number, number],
  keeper?: 'wk',
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
  const players = rows.map((r, i) => player(id, i, r));
  const keeperIds = rows.flatMap((r, i) => (r[7] === 'wk' ? [players[i]?.id ?? ''] : []));
  return { id, name, shortName, colors, players, keeperIds };
}

export const TEAMS: readonly Team[] = [
  team('mariners', 'Harbour City Mariners', 'HCM', { primary: '#1f4e8c', secondary: '#f2c14e' }, [
    ['Arjun Mehta', 'right', 'right', 'medium', [82, 80, 62, 78, 84], [30, 30, 10, 45, 60], [78, 80, 70]],
    ['Tom Whitfield', 'left', 'right', 'none', [78, 76, 70, 74, 72], [10, 10, 10, 20, 50], [74, 76, 72]],
    ['Kavi Raman', 'right', 'right', 'offSpin', [86, 84, 68, 82, 80], [40, 10, 55, 60, 60], [80, 84, 74]],
    ['Daniel Osei', 'right', 'right', 'fastMedium', [74, 78, 88, 70, 62], [62, 58, 10, 62, 70], [76, 72, 82]],
    ['Liam Carver', 'left', 'left', 'legSpin', [70, 72, 80, 68, 60], [45, 10, 72, 64, 66], [72, 70, 74]],
    ['Ravi Kulkarni', 'right', 'right', 'none', [76, 70, 74, 72, 68], [10, 10, 10, 20, 50], [84, 86, 70], 'wk'],
    ['Sam Adeyemi', 'right', 'right', 'fast', [58, 62, 78, 56, 50], [86, 74, 10, 70, 72], [70, 68, 84]],
    ['Ben Hollis', 'right', 'left', 'fastMedium', [52, 56, 66, 52, 50], [74, 82, 10, 76, 80], [66, 70, 78]],
    ['Imran Qadir', 'right', 'right', 'offSpin', [46, 52, 60, 50, 46], [42, 10, 80, 82, 82], [68, 72, 66]],
    ['Owen Price', 'left', 'right', 'fast', [34, 40, 58, 38, 36], [90, 66, 10, 64, 64], [64, 62, 86]],
    ['Nikhil Rao', 'right', 'left', 'legSpin', [30, 36, 50, 34, 34], [40, 10, 84, 74, 76], [62, 64, 64]],
    ['Callum Fraser', 'right', 'right', 'none', [74, 72, 66, 70, 78], [10, 10, 10, 20, 50], [76, 78, 72]],
    ['Dev Patil', 'left', 'left', 'medium', [66, 70, 76, 64, 58], [58, 64, 10, 66, 70], [74, 72, 76]],
    ['Ethan Moore', 'right', 'right', 'fast', [40, 44, 60, 42, 38], [84, 70, 10, 68, 70], [66, 64, 82]],
    ['Zaid Hussain', 'right', 'right', 'offSpin', [54, 58, 62, 56, 52], [38, 10, 74, 76, 78], [70, 70, 66]],
    ['Ollie Grant', 'right', 'right', 'none', [68, 64, 70, 66, 64], [10, 10, 10, 20, 50], [80, 84, 70], 'wk'],
  ]),
  team('rangers', 'Highland Rangers', 'HLR', { primary: '#8c1f2e', secondary: '#e8e3d6' }, [
    ['Callum Reid', 'right', 'right', 'none', [84, 78, 66, 80, 86], [10, 10, 10, 20, 50], [76, 82, 72]],
    ['Aaron Bakshi', 'left', 'left', 'medium', [76, 82, 78, 76, 66], [36, 44, 10, 50, 60], [80, 78, 74]],
    ['Marcus Lyle', 'right', 'right', 'none', [88, 86, 72, 84, 82], [10, 10, 10, 20, 50], [74, 80, 70]],
    ['Faisal Noor', 'right', 'right', 'legSpin', [72, 74, 82, 74, 62], [44, 10, 74, 66, 64], [78, 76, 72]],
    ['Ethan Burke', 'left', 'right', 'fastMedium', [74, 72, 84, 70, 64], [70, 66, 10, 68, 76], [82, 80, 84]],
    ['Josh Tan', 'right', 'right', 'none', [70, 74, 72, 76, 66], [10, 10, 10, 20, 50], [86, 88, 72], 'wk'],
    ['Ricky Dunn', 'right', 'right', 'offSpin', [62, 64, 66, 60, 58], [40, 10, 78, 78, 78], [70, 72, 68]],
    ['Viktor Hale', 'right', 'right', 'fast', [48, 52, 70, 50, 44], [92, 70, 10, 66, 70], [68, 66, 86]],
    ['Pete Morrow', 'left', 'left', 'fastMedium', [44, 48, 62, 46, 44], [76, 86, 10, 78, 78], [66, 68, 76]],
    ['Dev Sharma', 'right', 'right', 'fast', [36, 40, 56, 40, 38], [84, 76, 10, 74, 74], [64, 66, 80]],
    ['Tariq Aziz', 'right', 'left', 'offSpin', [28, 34, 44, 32, 30], [38, 10, 82, 80, 80], [62, 64, 62]],
    ['Angus Laird', 'right', 'right', 'medium', [72, 70, 68, 70, 74], [56, 60, 10, 70, 74], [76, 74, 74]],
    ['Rory McLeish', 'left', 'right', 'none', [76, 74, 68, 72, 76], [10, 10, 10, 20, 50], [72, 74, 70]],
    ['Hamish Doyle', 'right', 'right', 'fast', [38, 42, 58, 40, 36], [88, 72, 10, 66, 68], [66, 66, 84]],
    ['Kabir Sethi', 'right', 'right', 'legSpin', [50, 54, 60, 52, 48], [40, 10, 80, 72, 74], [68, 70, 66]],
    ['Neil Ferguson', 'right', 'right', 'none', [64, 62, 66, 64, 66], [10, 10, 10, 20, 50], [82, 86, 70], 'wk'],
  ]),
  team('strikers', 'Sunrise Strikers', 'SRS', { primary: '#e2701d', secondary: '#1b2b4b' }, [
    ['Rohan Iyer', 'right', 'right', 'none', [80, 84, 76, 80, 74], [10, 10, 10, 20, 50], [78, 80, 72]],
    ['Jake Brennan', 'left', 'right', 'none', [76, 78, 82, 74, 66], [10, 10, 10, 20, 50], [76, 74, 76]],
    ['Siddharth Nair', 'right', 'right', 'offSpin', [84, 82, 70, 82, 82], [38, 10, 62, 64, 64], [80, 82, 72]],
    ['Marlon Clarke', 'right', 'right', 'fastMedium', [70, 72, 90, 66, 56], [68, 60, 10, 62, 72], [78, 74, 84]],
    ['Aditya Bose', 'right', 'right', 'none', [74, 76, 72, 74, 70], [10, 10, 10, 20, 50], [84, 86, 72], 'wk'],
    ['Kieran Walsh', 'left', 'left', 'medium', [66, 68, 74, 66, 62], [60, 74, 10, 70, 76], [74, 72, 74]],
    ['Yusuf Malik', 'right', 'right', 'legSpin', [56, 60, 70, 58, 50], [44, 10, 82, 70, 72], [72, 72, 70]],
    ['Chris Ndlovu', 'right', 'right', 'fast', [46, 50, 66, 46, 42], [90, 72, 10, 68, 74], [70, 68, 86]],
    ['Arnav Joshi', 'right', 'left', 'offSpin', [42, 46, 54, 44, 40], [40, 10, 78, 80, 80], [66, 68, 64]],
    ['Luke Fenwick', 'right', 'left', 'fastMedium', [36, 40, 52, 38, 34], [78, 84, 10, 78, 78], [64, 66, 78]],
    ['Tendai Moyo', 'right', 'right', 'fast', [30, 34, 50, 32, 30], [88, 68, 10, 66, 66], [62, 62, 84]],
    ['Prateek Rao', 'right', 'right', 'none', [72, 70, 66, 70, 72], [10, 10, 10, 20, 50], [76, 78, 70]],
    ['Sean Duffy', 'left', 'right', 'fastMedium', [58, 60, 70, 56, 50], [72, 70, 10, 68, 72], [72, 70, 78]],
    ['Harsh Vyas', 'right', 'right', 'offSpin', [52, 54, 56, 54, 50], [36, 10, 76, 78, 80], [68, 70, 66]],
    ['Ben Tully', 'right', 'right', 'fast', [34, 38, 54, 36, 32], [86, 74, 10, 70, 70], [66, 64, 82]],
    ['Mohit Kapoor', 'right', 'right', 'none', [62, 64, 60, 62, 64], [10, 10, 10, 20, 50], [80, 84, 70], 'wk'],
  ]),
  team('royals', 'Riverside Royals', 'RVR', { primary: '#5b2a86', secondary: '#c9c9d6' }, [
    ['Hugo Bennett', 'right', 'right', 'none', [82, 76, 68, 76, 84], [10, 10, 10, 20, 50], [74, 78, 70]],
    ['Imtiaz Khan', 'left', 'left', 'none', [78, 80, 80, 78, 68], [10, 10, 10, 20, 50], [78, 76, 74]],
    ['Andre Baptiste', 'right', 'right', 'medium', [80, 78, 86, 74, 70], [56, 58, 10, 64, 70], [80, 78, 80]],
    ['Vikram Sood', 'right', 'right', 'none', [86, 84, 70, 82, 84], [10, 10, 10, 20, 50], [76, 80, 70]],
    ['Matt Corrigan', 'left', 'left', 'legSpin', [68, 70, 74, 66, 62], [42, 10, 76, 68, 70], [74, 72, 70]],
    ['Danny Wu', 'right', 'right', 'none', [72, 72, 70, 74, 70], [10, 10, 10, 20, 50], [84, 88, 72], 'wk'],
    ['Farhan Ali', 'right', 'right', 'fastMedium', [58, 60, 72, 56, 52], [74, 72, 10, 70, 74], [72, 70, 80]],
    ['George Abbott', 'right', 'right', 'fast', [48, 50, 66, 48, 44], [90, 76, 10, 70, 72], [68, 66, 86]],
    ['Ravindra Pillai', 'left', 'left', 'offSpin', [44, 48, 56, 46, 42], [38, 10, 82, 82, 82], [66, 70, 64]],
    ['Toby Marsh', 'right', 'right', 'fast', [36, 40, 54, 38, 34], [92, 70, 10, 64, 66], [64, 62, 86]],
    ['Ankit Saxena', 'right', 'right', 'legSpin', [30, 34, 46, 32, 30], [40, 10, 80, 76, 76], [62, 64, 62]],
    ['Will Hartley', 'right', 'right', 'medium', [70, 68, 64, 68, 72], [54, 62, 10, 70, 72], [76, 74, 72]],
    ['Naveen Reddy', 'left', 'right', 'none', [74, 72, 70, 72, 70], [10, 10, 10, 20, 50], [74, 76, 70]],
    ['Jordan Pike', 'right', 'left', 'fastMedium', [40, 44, 58, 42, 38], [78, 84, 10, 76, 78], [66, 68, 76]],
    ['Ashwin Menon', 'right', 'right', 'offSpin', [50, 52, 56, 52, 48], [36, 10, 76, 78, 80], [68, 70, 64]],
    ['Callan Shaw', 'right', 'right', 'none', [60, 62, 62, 62, 64], [10, 10, 10, 20, 50], [80, 84, 70], 'wk'],
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
