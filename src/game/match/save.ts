import type { Team } from '../data/teams.ts';
import type { Player } from '../model/player.ts';
import type { Match } from './match.ts';

/**
 * Saving and loading a match. The match is saved as it stood between balls:
 * either now (if no ball is in play) or at the start of the ball being
 * bowled, which is then bowled again on loading. Everything that shapes what
 * happens next is kept — scores, cards, strike, the bowlers' overs and
 * tiredness, the batters' form, the computer's learning, the commentator,
 * and the random-number state — so a loaded match carries on exactly as it
 * would have.
 *
 * The state is written generically: players by id, Maps as entry lists,
 * class instances (the random-number generator, the learning attack, the
 * commentator) as their fields, poured back into fresh instances on load.
 */

/** Match fields that are rebuilt rather than saved. */
const SKIP = new Set(['config', 'clock', 'cycle', 'listeners', 'checkpoint', 'paused', 'appeal', 'drs', 'autoplayMode', 'autoplayActive', 'autoplayUntil', 'autoplayInnings']);

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const isPlayer = (v: object): v is Player => 'id' in v && 'battingHand' in v && 'bowlingStyle' in v;

function encode(v: unknown): Json {
  if (v === undefined) return { $u: 1 };
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : { $n: String(v) };
  if (typeof v === 'function') return null;
  if (Array.isArray(v)) return v.map(encode);
  if (v instanceof Map) return { $map: [...v.entries()].map(([k, x]) => [encode(k), encode(x)]) };
  if (v instanceof Set) return { $set: [...v].map(encode) };
  if (typeof v === 'object') {
    if (isPlayer(v)) return { $player: v.id };
    const out: { [k: string]: Json } = {};
    for (const [k, x] of Object.entries(v)) if (typeof x !== 'function') out[k] = encode(x);
    return out;
  }
  return null;
}

function decode(v: Json, players: ReadonlyMap<string, Player>): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => decode(x, players));
  if ('$u' in v) return undefined;
  if ('$n' in v) return Number(v.$n);
  if ('$player' in v) return players.get(String(v.$player));
  if ('$map' in v && Array.isArray(v.$map)) return new Map(v.$map.map((e) => (Array.isArray(e) ? [decode(e[0] ?? null, players), decode(e[1] ?? null, players)] : [undefined, undefined])));
  if ('$set' in v && Array.isArray(v.$set)) return new Set(v.$set.map((x) => decode(x, players)));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) out[k] = decode(x, players);
  return out;
}

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Map) && !(v instanceof Set) && Object.getPrototypeOf(v) === Object.prototype;

/** Pours saved fields into an object: class instances keep their class and get their fields back. */
function pour(target: Record<string, unknown>, saved: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(saved)) {
    const cur = target[k];
    const instance = typeof cur === 'object' && cur !== null && !Array.isArray(cur) && !(cur instanceof Map) && !(cur instanceof Set) && Object.getPrototypeOf(cur) !== Object.prototype;
    if (instance && isPlain(v)) pour(cur as Record<string, unknown>, v);
    else target[k] = v;
  }
}

/**
 * A cheap copy of the match's state, taken at the start of every ball so a
 * save made during the ball can go back to it: containers are copied, the
 * records in them (ball outcomes, cards) are shared — they are never changed
 * once made.
 */
export function snapshotMatch(match: Match): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(match)) if (!SKIP.has(k) && typeof v !== 'function') out[k] = copy(v, 0);
  return out;
}

function copy(v: unknown, depth: number): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.slice();
  if (v instanceof Map) return new Map([...v.entries()].map(([k, x]) => [k, copy(x, depth + 1)]));
  if (v instanceof Set) return new Set(v);
  if (isPlayer(v) || depth > 4) return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) if (typeof x !== 'function') out[k] = copy(x, depth + 1);
  return out;
}

/** A snapshot (or the match itself) as saved state. */
export function encodeSnapshot(snapshot: Record<string, unknown>): Json {
  return encode(snapshot);
}

/** The match's own fields, as saved state (JSON-safe). */
export function encodeMatch(match: Match): Json {
  const out: { [k: string]: Json } = {};
  for (const [k, v] of Object.entries(match)) if (!SKIP.has(k) && typeof v !== 'function') out[k] = encode(v);
  return out;
}

export function playersOf(...teams: readonly Team[]): Map<string, Player> {
  return new Map(teams.flatMap((t) => t.players.map((p) => [p.id, p] as const)));
}

/** Restores saved state into a match freshly built from the same configuration. */
export function decodeInto(match: Match, saved: Json, players: ReadonlyMap<string, Player>): void {
  const data = decode(saved, players);
  if (!isPlain(data)) throw new Error('Not a saved match');
  pour(match as unknown as Record<string, unknown>, data);
}

// --- Save slots in the browser ------------------------------------------------------------

export interface SavedMatch {
  /** The match seed: one slot per match. */
  readonly id: string;
  readonly savedAt: string;
  /** "India v Pakistan — IND 45/2 (6.3 ov)". */
  readonly label: string;
  /** Whatever the app needs to rebuild the match (its setup, the toss line, who bats first). */
  readonly meta: Json;
  readonly state: Json;
}

const KEY = 'crease.saves';
const MAX_SAVES = 6;

export function listSaves(): SavedMatch[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as SavedMatch[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Saves (replacing this match's earlier save); the oldest go when there are too many. Returns false if storage is unavailable or full. */
export function writeSave(save: SavedMatch): boolean {
  try {
    const list = [save, ...listSaves().filter((s) => s.id !== save.id)].slice(0, MAX_SAVES);
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function deleteSave(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(listSaves().filter((s) => s.id !== id)));
  } catch {
    // Nothing to do.
  }
}
