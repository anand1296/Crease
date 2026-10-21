import { Color } from 'three';
import type { BowlingStyle, Hand, Player } from '../model/player.ts';

/**
 * The four sides: India, Pakistan, Australia and England, with each board's
 * most recently announced men's T20I squad (as of October 2026):
 *
 *  - India: the squad for the T20Is in New Zealand (named 6 October 2026)
 *  - Pakistan: the squad for the home T20Is against Sri Lanka (named 6 October 2026)
 *  - England: the squad for the T20Is in Australia (named 13 October 2026)
 *  - Australia: the squad for the T20Is in Bangladesh in June 2026 (the most
 *    recent Australia has announced; Head and Green later withdrew from that tour)
 *
 * Names, batting hands and bowling styles are real; the numeric ratings are
 * this game's own approximations of each player's strengths, not data from
 * any official source. Kits use national colours only — no badges or logos.
 *
 * Add a team by adding an entry to TEAMS: the engine reads only this data.
 *
 * Attribute order in the compact rows below:
 *   bat:  technique, timing, power, footwork, defence
 *   bowl: pace, swing, spin, accuracy, stamina
 *   fld:  fielding, catching, throwing
 * Left-arm "offSpin" is left-arm orthodox; left-arm "legSpin" is left-arm wrist spin.
 */
export interface Kit {
  readonly primary: string;
  readonly secondary: string;
  readonly trousers?: string;
}

export interface Team {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly colors: Kit & { readonly alt?: Kit };
  /** Full squad. The first eleven, in order, are the default XI and batting order. */
  readonly players: readonly Player[];
  /** The squad's specialist wicketkeeper(s). */
  readonly keeperIds: readonly string[];
  readonly captainId?: string;
}

type Flag = 'wk' | 'c' | 'c+wk';

type Row = [
  name: string,
  bat: Hand,
  arm: Hand,
  style: BowlingStyle,
  bat5: [number, number, number, number, number],
  bowl5: [number, number, number, number, number],
  fld3: [number, number, number],
  flag?: Flag,
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

export function team(id: string, name: string, shortName: string, colors: Team['colors'], rows: Row[]): Team {
  const players = rows.map((r, i) => player(id, i, r));
  const keeperIds = rows.flatMap((r, i) => (r[7] === 'wk' || r[7] === 'c+wk' ? [players[i]?.id ?? ''] : []));
  const captain = rows.findIndex((r) => r[7] === 'c' || r[7] === 'c+wk');
  const captainId = captain >= 0 ? players[captain]?.id : undefined;
  return { id, name, shortName, colors, players, keeperIds, ...(captainId ? { captainId } : {}) };
}

const NB: [number, number, number, number, number] = [10, 10, 10, 20, 50];

export const TEAMS: readonly Team[] = [
  team('india', 'India', 'IND', { primary: '#1e5bc6', secondary: '#f58220', trousers: '#173f8a', alt: { primary: '#f58220', secondary: '#1e5bc6', trousers: '#173f8a' } }, [
    ['Abhishek Sharma', 'left', 'left', 'offSpin', [76, 86, 92, 78, 62], [40, 10, 62, 64, 60], [82, 80, 76]],
    ['Vaibhav Sooryavanshi', 'left', 'left', 'none', [72, 84, 90, 74, 58], NB, [76, 74, 72]],
    ['Shreyas Iyer', 'right', 'right', 'legSpin', [84, 84, 80, 80, 78], [36, 10, 48, 50, 50], [80, 82, 78], 'c'],
    ['Tilak Varma', 'left', 'right', 'offSpin', [84, 84, 80, 82, 78], [40, 10, 56, 58, 55], [84, 84, 80]],
    ['Sanju Samson', 'right', 'right', 'none', [80, 84, 86, 76, 70], NB, [80, 84, 72], 'wk'],
    ['Shivam Dube', 'left', 'right', 'medium', [72, 76, 90, 66, 62], [62, 52, 10, 58, 62], [70, 72, 72]],
    ['Axar Patel', 'left', 'left', 'offSpin', [72, 74, 78, 70, 70], [44, 10, 78, 86, 84], [82, 82, 80]],
    ['Kuldeep Yadav', 'left', 'left', 'legSpin', [42, 44, 40, 42, 48], [42, 10, 88, 80, 84], [72, 72, 70]],
    ['Varun Chakaravarthy', 'right', 'right', 'legSpin', [28, 30, 30, 30, 32], [44, 10, 86, 84, 84], [66, 66, 66]],
    ['Arshdeep Singh', 'left', 'left', 'fastMedium', [30, 34, 36, 32, 34], [80, 84, 10, 84, 84], [74, 76, 74]],
    ['Mayank Yadav', 'right', 'right', 'fast', [26, 30, 34, 28, 30], [95, 70, 10, 72, 70], [70, 70, 80]],
    ['Ishan Kishan', 'left', 'right', 'none', [76, 80, 84, 74, 64], NB, [80, 82, 74], 'wk'],
    ['Nitish Kumar Reddy', 'right', 'right', 'fastMedium', [72, 74, 80, 70, 70], [74, 66, 10, 68, 76], [80, 80, 80]],
    ['Naman Dhir', 'right', 'right', 'offSpin', [68, 72, 80, 66, 62], [40, 10, 64, 62, 62], [80, 78, 78]],
    ['Prince Yadav', 'right', 'right', 'fastMedium', [28, 30, 34, 30, 30], [80, 72, 10, 74, 78], [72, 72, 76]],
    ['Bhuvneshwar Kumar', 'right', 'right', 'fastMedium', [44, 48, 46, 44, 52], [74, 90, 10, 88, 82], [72, 74, 72]],
  ]),
  team('pakistan', 'Pakistan', 'PAK', { primary: '#0d6b3b', secondary: '#a3d65c', trousers: '#0a4a2a' }, [
    ['Sahibzada Farhan', 'right', 'right', 'none', [76, 80, 84, 74, 68], NB, [74, 74, 72], 'c'],
    ['Saim Ayub', 'left', 'right', 'offSpin', [76, 82, 84, 78, 66], [42, 10, 64, 64, 64], [80, 80, 78]],
    ['Fakhar Zaman', 'left', 'left', 'offSpin', [74, 78, 88, 70, 64], [36, 10, 40, 46, 50], [72, 74, 74]],
    ['Hasan Nawaz', 'right', 'right', 'none', [72, 78, 86, 72, 62], NB, [76, 76, 76]],
    ['Khawaja Nafay', 'right', 'right', 'none', [70, 74, 80, 70, 64], NB, [76, 82, 72], 'wk'],
    ['Abdul Samad', 'right', 'right', 'offSpin', [66, 70, 88, 64, 58], [36, 10, 44, 48, 50], [74, 74, 76]],
    ['Shadab Khan', 'right', 'right', 'legSpin', [68, 70, 74, 66, 64], [44, 10, 80, 78, 80], [86, 84, 82]],
    ['Mohammad Imran Randhawa', 'right', 'right', 'medium', [62, 64, 72, 60, 58], [64, 62, 10, 66, 72], [74, 74, 74]],
    ['Naseem Shah', 'right', 'right', 'fast', [34, 36, 46, 34, 36], [88, 82, 10, 80, 78], [70, 70, 78]],
    ['Abrar Ahmed', 'right', 'right', 'legSpin', [24, 26, 28, 26, 28], [42, 10, 86, 80, 82], [64, 64, 64]],
    ['Mohammad Salman Mirza', 'right', 'left', 'fastMedium', [26, 28, 30, 28, 30], [82, 80, 10, 76, 78], [70, 70, 76]],
    ['Arafat Minhas', 'left', 'left', 'offSpin', [62, 64, 66, 60, 60], [42, 10, 70, 72, 74], [76, 74, 74]],
    ['Maaz Sadaqat', 'left', 'left', 'offSpin', [66, 72, 78, 66, 60], [40, 10, 62, 62, 64], [76, 76, 74]],
    ['Razaullah', 'right', 'right', 'fast', [24, 26, 30, 26, 28], [86, 72, 10, 72, 76], [70, 70, 78]],
    ['Sufiyan Moqim', 'right', 'left', 'legSpin', [26, 28, 28, 28, 30], [40, 10, 82, 78, 80], [68, 68, 66]],
  ]),
  team('australia', 'Australia', 'AUS', { primary: '#f6c400', secondary: '#0b5e3c', trousers: '#0b5e3c' }, [
    ['Travis Head', 'left', 'right', 'offSpin', [78, 84, 90, 74, 66], [40, 10, 56, 56, 56], [80, 80, 76]],
    ['Mitchell Marsh', 'right', 'right', 'fastMedium', [78, 80, 90, 72, 70], [76, 64, 10, 66, 68], [78, 80, 78], 'c'],
    ['Josh Inglis', 'right', 'right', 'none', [80, 82, 84, 78, 70], NB, [80, 84, 74], 'wk'],
    ['Cameron Green', 'right', 'right', 'fastMedium', [78, 78, 84, 74, 74], [80, 70, 10, 70, 74], [82, 84, 80]],
    ['Tim David', 'right', 'right', 'offSpin', [72, 78, 94, 66, 60], [38, 10, 44, 46, 50], [80, 82, 82]],
    ['Cooper Connolly', 'left', 'left', 'offSpin', [72, 76, 80, 72, 64], [42, 10, 68, 68, 68], [82, 82, 80]],
    ['Aaron Hardie', 'right', 'right', 'fastMedium', [68, 70, 76, 66, 64], [76, 70, 10, 72, 76], [80, 80, 80]],
    ['Xavier Bartlett', 'right', 'right', 'fastMedium', [40, 44, 56, 40, 42], [82, 86, 10, 78, 80], [74, 74, 78]],
    ['Nathan Ellis', 'right', 'right', 'fastMedium', [38, 40, 50, 38, 40], [80, 74, 10, 84, 82], [76, 78, 76]],
    ['Adam Zampa', 'right', 'right', 'legSpin', [32, 34, 36, 32, 36], [42, 10, 86, 86, 86], [72, 74, 70]],
    ['Spencer Johnson', 'left', 'left', 'fast', [26, 28, 34, 26, 28], [90, 78, 10, 72, 74], [72, 72, 80]],
    ['Josh Philippe', 'right', 'right', 'none', [72, 76, 80, 70, 64], NB, [78, 82, 72], 'wk'],
    ['Matthew Renshaw', 'left', 'right', 'offSpin', [78, 76, 72, 74, 78], [38, 10, 52, 54, 54], [76, 78, 72]],
    ['Matthew Kuhnemann', 'left', 'left', 'offSpin', [30, 32, 30, 30, 34], [42, 10, 78, 80, 82], [72, 72, 70]],
    ['Riley Meredith', 'right', 'right', 'fast', [26, 28, 34, 26, 28], [90, 70, 10, 68, 72], [70, 70, 78]],
    ['Joel Davies', 'left', 'left', 'offSpin', [32, 34, 34, 32, 34], [40, 10, 72, 72, 74], [72, 72, 70]],
  ]),
  team(
    'england',
    'England',
    'ENG',
    { primary: '#1b2c63', secondary: '#e0283d', trousers: '#141f45', alt: { primary: '#c8102e', secondary: '#1b2c63', trousers: '#1b2c63' } },
    [
      ['Phil Salt', 'right', 'right', 'none', [76, 84, 90, 76, 64], NB, [80, 84, 76], 'wk'],
      ['Will Jacks', 'right', 'right', 'offSpin', [74, 80, 86, 72, 66], [42, 10, 70, 70, 70], [80, 80, 78]],
      ['Jacob Bethell', 'left', 'left', 'offSpin', [80, 82, 84, 78, 72], [42, 10, 66, 66, 66], [82, 82, 78]],
      ['Harry Brook', 'right', 'right', 'medium', [84, 86, 88, 80, 74], [55, 50, 10, 45, 50], [80, 82, 80], 'c'],
      ['Tom Banton', 'right', 'right', 'none', [72, 78, 84, 70, 62], NB, [78, 78, 74]],
      ['Sam Curran', 'left', 'left', 'fastMedium', [70, 72, 76, 68, 68], [74, 82, 10, 78, 82], [80, 80, 78]],
      ['Jamie Overton', 'right', 'right', 'fast', [64, 66, 82, 60, 56], [88, 70, 10, 72, 76], [80, 80, 84]],
      ['Liam Dawson', 'right', 'left', 'offSpin', [64, 66, 62, 64, 68], [42, 10, 76, 84, 82], [78, 78, 74]],
      ['Adil Rashid', 'right', 'right', 'legSpin', [42, 46, 44, 44, 46], [42, 10, 88, 82, 84], [68, 70, 66]],
      ['Luke Wood', 'left', 'left', 'fast', [30, 32, 38, 30, 32], [86, 80, 10, 74, 76], [72, 72, 78]],
      ['Eddie Jack', 'right', 'right', 'fastMedium', [30, 32, 36, 30, 34], [82, 74, 10, 74, 78], [72, 72, 76]],
      ['Jordan Cox', 'right', 'right', 'none', [70, 74, 82, 68, 62], NB, [78, 82, 72], 'wk'],
      ['Thomas Rew', 'right', 'right', 'none', [72, 74, 74, 70, 70], NB, [76, 82, 72], 'wk'],
      ['James Coles', 'right', 'left', 'offSpin', [66, 70, 74, 66, 62], [40, 10, 66, 66, 66], [78, 78, 76]],
      ['Aneurin Donald', 'right', 'right', 'none', [70, 74, 82, 68, 60], NB, [76, 76, 74]],
      ['Henry Crocombe', 'right', 'right', 'fastMedium', [32, 34, 38, 32, 34], [82, 74, 10, 74, 80], [70, 70, 74]],
    ],
  ),
];

/** True when two kit colours would be hard to tell apart on the field. */
function clash(a: string, b: string): boolean {
  const ha = new Color(a).getHSL({ h: 0, s: 0, l: 0 });
  const hb = new Color(b).getHSL({ h: 0, s: 0, l: 0 });
  const dh = Math.min(Math.abs(ha.h - hb.h), 1 - Math.abs(ha.h - hb.h));
  return dh < 0.07 && ha.s > 0.3 && hb.s > 0.3;
}

/** The kit a team wears against `opponent`: its alternate strip when the colours clash (the away side changes). */
export function kitColors(team: Team, opponent: Team, home: boolean): Kit {
  if (!home && team.colors.alt && clash(team.colors.primary, opponent.colors.primary)) return team.colors.alt;
  return team.colors;
}

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
