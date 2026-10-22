import type { Team } from '../../data/teams.ts';
import { kitColors } from '../../data/teams.ts';
import { AVATARS, type AvatarId } from './avatarAssets.ts';
import type { Kit } from './Humanoid.tsx';
import type { Grooming } from './Cricketer.tsx';

/** How each player looks: kit from his team's colours, and a model and skin tone fixed by his id. */

const SKIN = ['#8d5a3b', '#c58c64', '#e3b48f', '#6b4128', '#b07a55', '#f1c9a5', '#5a3622', '#d9a07a'];

export function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export const skinFor = (id: string): string => SKIN[Math.abs(hash(id)) % SKIN.length] ?? '#c58c64';

export const darken = (hex: string, k: number): string => {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
};

export const avatarFor = (id: string): AvatarId => AVATARS[Math.abs(hash(id)) % AVATARS.length] ?? 'p1';
export const toneFor = (id: string): number => (avatarFor(id) === 'p3' ? 0 : (Math.abs(hash(`${id}tone`)) % 5) / 5);

export type KitRole = 'batter' | 'keeper' | 'fielder' | 'captain';

/** A player's kit: the team's colours (the away side's change kit on a clash), and what he wears for his role. */
export function teamKit(team: Team, opponent: Team, home: boolean, playerId: string, role: KitRole): Kit {
  const colors = kitColors(team, opponent, home);
  return {
    shirt: colors.primary,
    trim: colors.secondary,
    trousers: colors.trousers ?? darken(colors.primary, 0.55),
    skin: skinFor(playerId),
    headwear: role === 'batter' ? 'helmet' : role === 'keeper' || role === 'captain' ? 'cap' : hash(playerId) % 4 === 0 ? 'hat' : 'cap',
    pads: role === 'batter' || role === 'keeper',
    gloves: role === 'batter' ? 'batting' : role === 'keeper' ? 'keeping' : 'none',
  };
}

/** Facial hair, fixed per player: most clean-shaven or stubbled, some with a moustache or a beard. */
export function groomingFor(id: string): Grooming {
  const k = Math.abs(hash(`${id}:face`)) % 20;
  return k < 8 ? 'clean' : k < 13 ? 'stubble' : k < 16 ? 'moustache' : 'beard';
}
