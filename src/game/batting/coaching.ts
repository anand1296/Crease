/**
 * The batting coach, ball by ball: what the delivery was, what the batter
 * did with it, what went wrong (timing, foot, line, height) and which keys
 * play it — several ways, ranked — next time.
 *
 * Everything is worked out from the real delivery and the game's own stroke
 * model: for each key combination the stroke it plays is found
 * (shotFromInput), where the ball would be when that stroke meets it
 * (predictArrival at its contact plane) and how far that is from the
 * stroke's slot (strokeReach). So "play the cut: W + →" is advice the game
 * itself would reward.
 */
import { STRIKER_STUMPS_Z } from '../data/field.ts';
import type { ExecutedDelivery } from '../bowling/execute.ts';
import { type ArrowScheme, type BatAction, type ScreenDirection, fieldRegion, shotFromInput } from '../input/battingControls.ts';
import { type Player, offSideSign } from '../model/player.ts';
import type { GroundModel } from '../physics/ball.ts';
import { predictArrival } from '../simulation/ballInPlay.ts';
import { contactPlaneZ } from './body.ts';
import { type ContactResult, strokeReach } from './contact.ts';
import { SHOTS, type ShotAttempt, type ShotId } from './shots.ts';

export type LengthKind = 'yorker' | 'full' | 'good' | 'back' | 'short' | 'bouncer' | 'fullToss';
export type LineKind = 'wide' | 'outsideOff' | 'stumps' | 'pads' | 'wideLeg';

export interface BallRead {
  readonly length: LengthKind;
  readonly line: LineKind;
  /** Plain words: "full, outside off stump". */
  readonly words: string;
  /** Would it have hit the stumps? */
  readonly hitting: boolean;
}

export interface KeyCombo {
  readonly action: BatAction | 'leave';
  readonly dir: ScreenDirection;
  readonly lofted: boolean;
}

export interface ShotOption {
  readonly combo: KeyCombo;
  readonly attempt: ShotAttempt;
  readonly name: string;
  readonly region: string;
  /** 0–1: how cleanly it can be middled, well timed. */
  readonly fit: number;
  /** 0–1: how much can go wrong (the stumps, a catch). */
  readonly risk: number;
  readonly score: number;
}

const LENGTH_WORDS: Record<LengthKind, string> = {
  yorker: 'a yorker',
  full: 'full',
  good: 'a good length',
  back: 'short of a length',
  short: 'short',
  bouncer: 'a bouncer',
  fullToss: 'a full toss',
};
const LINE_WORDS: Record<LineKind, string> = {
  wide: 'wide outside off',
  outsideOff: 'outside off stump',
  stumps: 'on the stumps',
  pads: 'on the pads',
  wideLeg: 'down the leg side',
};

/** Length and line, as a batter would call them (line from where he stands). */
export function readBall(d: ExecutedDelivery, hand: Player['battingHand'], guard = 0): BallRead {
  const off = offSideSign(hand);
  const pitch = d.actual.pitch;
  const at = d.actual.atStumps;
  const fromStumps = pitch ? STRIKER_STUMPS_Z - pitch.z : undefined;
  const high = (at?.y ?? 0) > 1.25;
  const length: LengthKind =
    fromStumps === undefined || fromStumps < 0.3
      ? 'fullToss'
      : fromStumps < 1.6
        ? 'yorker'
        : fromStumps < 4.2
          ? 'full'
          : fromStumps < 6.8
            ? 'good'
            : fromStumps < 8.5 && !high
              ? 'back'
              : high
                ? 'bouncer'
                : 'short';
  const x = (at?.x ?? pitch?.x ?? 0) * off - guard;
  const line: LineKind = x > 0.55 ? 'wide' : x > 0.13 ? 'outsideOff' : x >= -0.13 ? 'stumps' : x > -0.45 ? 'pads' : 'wideLeg';
  const hitting = !!at && Math.abs(at.x) < 0.13 && at.y < 0.75;
  const words = length === 'fullToss' ? `a full toss, ${LINE_WORDS[line]}` : `${LENGTH_WORDS[length]}, ${LINE_WORDS[line]}`;
  return { length, line, words: words.charAt(0).toUpperCase() + words.slice(1), hitting };
}

const DIRS: readonly ScreenDirection[] = [
  { x: 0, y: 0 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
];

type Book = readonly (readonly [ShotId, ShotAttempt['footwork'] | undefined, number])[];

/**
 * The textbook: which strokes a coach would have you play to a ball of this
 * length and line (weights 0–1). Pace and spin differ: you sweep and use
 * your feet to spin, not to pace.
 */
export function textbook(read: BallRead, spin: boolean): Book {
  const { length: L, line } = read;
  const wide = line === 'wide';
  const off = line === 'outsideOff';
  const straight = line === 'stumps';
  const pads = line === 'pads' || line === 'wideLeg';
  if (L === 'yorker') return pads ? [['flick', 'front', 1], ['block', 'front', 0.8]] : [['block', 'front', 1], ['straightDrive', 'front', 0.7]];
  if (L === 'fullToss' || L === 'full') {
    const book: [ShotId, ShotAttempt['footwork'] | undefined, number][] = wide
      ? [['coverDrive', 'front', 1], ['leave', undefined, 0.6], ['squareCut', 'back', 0.4]]
      : off
        ? [['coverDrive', 'front', 1], ['offDrive', 'front', 0.85], ['loftedAttack', 'front', 0.6], ['loftedDrive', 'front', 0.5]]
        : straight
          ? [['straightDrive', 'front', 1], ['onDrive', 'front', 0.85], ['loftedDrive', 'front', 0.7]]
          : [['flick', 'front', 1], ['onDrive', 'front', 0.7], ['legGlance', undefined, 0.7]];
    if (spin) {
      if (straight || pads) book.push(['sweep', 'front', 0.8], ['slogSweep', 'front', 0.6]);
      if (off) book.push(['reverseSweep', 'front', 0.45]);
      book.push(['straightDrive', 'out', 0.75], ['loftedAttack', 'out', 0.6]);
    }
    return book;
  }
  if (L === 'good') {
    const book: [ShotId, ShotAttempt['footwork'] | undefined, number][] = wide
      ? [['leave', undefined, 1], ['squareCut', 'back', 0.55]]
      : off
        ? [['leave', undefined, 0.9], ['block', 'front', 0.8], ['offDrive', 'back', 0.6]]
        : straight
          ? [['block', 'front', 1], ['block', 'back', 0.8], ['straightDrive', 'back', 0.55]]
          : [['flick', undefined, 1], ['legGlance', undefined, 0.75]];
    if (spin) {
      if (straight || pads) book.push(['sweep', 'front', 0.85]);
      if (off) book.push(['reverseSweep', 'front', 0.5]);
      book.push(['straightDrive', 'out', 0.8], ['coverDrive', 'out', 0.65]);
    }
    return book;
  }
  if (L === 'back')
    return wide
      ? [['squareCut', 'back', 1], ['lateCut', 'back', 0.8]]
      : off
        ? [['offDrive', 'back', 0.85], ['block', 'back', 0.8], ['squareCut', 'back', 0.7], ['lateCut', 'back', 0.6], ['leave', undefined, 0.6]]
        : straight
          ? [['block', 'back', 1], ['straightDrive', 'back', 0.6], ['pull', 'back', spin ? 0.8 : 0.45]]
          : [['flick', 'back', 0.9], ['pull', 'back', 0.85], ['legGlance', 'back', 0.8]];
  if (L === 'short')
    return wide || off
      ? [['squareCut', 'back', 1], ['lateCut', 'back', 0.8], ['pull', 'back', off ? 0.5 : 0.2]]
      : [['pull', 'back', 1], ['hook', 'back', 0.6], ['block', 'back', 0.55], ['legGlance', 'back', 0.6]];
  // Bouncer.
  return wide || off
    ? [['leave', undefined, 1], ['loftedAttack', 'back', 0.6], ['squareCut', 'back', 0.35]]
    : [['leave', undefined, 0.9], ['hook', 'back', 0.8], ['pull', 'back', 0.65]];
}

function bookWeight(book: Book, a: ShotAttempt): number {
  let w = 0.12;
  for (const [shot, fw, weight] of book) if (shot === a.shot && (fw === undefined || fw === a.footwork)) w = Math.max(w, weight);
  // The right stroke on the other foot still counts for something.
  for (const [shot, , weight] of book) if (shot === a.shot) w = Math.max(w, weight * 0.4);
  return w;
}

const CROSS_BAT = new Set<ShotId>(['squareCut', 'lateCut', 'pull', 'hook', 'sweep', 'slogSweep', 'reverseSweep']);

/**
 * Every stroke the keys can play to this ball, best first. Defence and the
 * leave are included (they score little but are safe), so the list says
 * when the right answer is to keep it out.
 */
export function shotOptions(d: ExecutedDelivery, batter: Player, ground: GroundModel | undefined, guard: number, scheme: ArrowScheme, reachScale = 1): ShotOption[] {
  const off = offSideSign(batter.battingHand);
  const read = readBall(d, batter.battingHand, guard);
  const book = textbook(read, d.releaseSpeedKph < 105);
  const seen = new Map<string, ShotOption>();
  for (const action of ['front', 'back', 'feet'] as const) {
    for (const dir of DIRS) {
      for (const lofted of [false, true]) {
        const attempt = shotFromInput(action, dir, lofted, batter.battingHand, scheme);
        const def = SHOTS[attempt.shot];
        const planeZ = contactPlaneZ(attempt, batter.batting.footwork, d.actual.pitch?.z);
        const arr = predictArrival(d, planeZ, ground);
        if (!arr) continue;
        const pitched = d.actual.pitch !== undefined && d.actual.pitch.z < planeZ;
        const { reach } = strokeReach(def, batter, arr.x * off - guard, arr.y, pitched ? 1 : -5, reachScale);
        const fit = Math.exp(-0.5 * reach * reach);
        let risk = 0;
        if (CROSS_BAT.has(attempt.shot) && read.hitting) risk += 0.45;
        if (def.kind === 'loft' || attempt.shot === 'slogSweep') risk += 0.25;
        if (attempt.footwork === 'out') risk += 0.15;
        const score = fit * bookWeight(book, attempt) - risk * 0.3;
        // One entry per stroke (its simplest keys).
        const key = attempt.shot;
        const prev = seen.get(key);
        const combo: KeyCombo = { action, dir, lofted };
        // On a tie: the stroke aimed where it naturally goes, then the fewest keys.
        const offAim = (o: ShotAttempt) => Math.abs((o.aimDeg ?? SHOTS[o.shot].direction) - SHOTS[o.shot].direction);
        const tie = prev && Math.abs(score - prev.score) <= 0.02;
        const better =
          !prev ||
          score > prev.score + 0.02 ||
          (tie && (offAim(attempt) < offAim(prev.attempt) - 1 || (Math.abs(offAim(attempt) - offAim(prev.attempt)) <= 1 && comboCost(combo) < comboCost(prev.combo))));
        if (better) seen.set(key, { combo, attempt, name: def.name, region: fieldRegion(attempt), fit, risk, score });
      }
    }
  }
  // The leave: worth something only when it is missing the stumps.
  const leave: ShotOption = {
    combo: { action: 'leave', dir: { x: 0, y: 0 }, lofted: false },
    attempt: { shot: 'leave', footwork: 'front' },
    name: 'Leave',
    region: 'left alone',
    fit: 1,
    risk: read.hitting ? 1 : 0,
    score: read.hitting ? -1 : bookWeight(book, { shot: 'leave', footwork: 'front' }),
  };
  return [...seen.values(), leave].sort((a, b) => b.score - a.score);
}

const comboCost = (c: KeyCombo) => (c.lofted ? 2 : 0) + Math.abs(c.dir.x) + Math.abs(c.dir.y);

/** "W + ↑→", "Shift + S + ↓", "A". */
export function comboLabel(c: KeyCombo, pad = false): string {
  const key = pad
    ? { front: 'A', back: 'X', feet: 'Y', leave: 'B' }[c.action]
    : { front: 'S', back: 'W', feet: 'D', leave: 'A' }[c.action];
  const arrows = `${c.dir.y === 1 ? '↑' : c.dir.y === -1 ? '↓' : ''}${c.dir.x === 1 ? '→' : c.dir.x === -1 ? '←' : ''}`;
  return [c.lofted ? (pad ? 'RT' : 'Shift') : '', key, arrows].filter(Boolean).join(' + ');
}

export interface Coaching {
  readonly ball: BallRead;
  /** What was played, by name ("Cover drive", "No shot"). */
  readonly played: string;
  /** Press timing before any help: + late, − early, ms; undefined when no stroke. */
  readonly pressMs: number | undefined;
  readonly timingWord: 'Perfect' | 'Early' | 'Late' | 'Too late' | 'No shot' | 'Left';
  /** Contact quality 0–100 (the sweet spot), when the bat met it. */
  readonly sweetSpot: number | undefined;
  readonly whereOnBat: string | undefined;
  readonly verdict: 'good' | 'ok' | 'bad';
  /** What went wrong (or right), most important first. */
  readonly points: readonly string[];
  /** Ways to play this ball, best first. */
  readonly options: readonly ShotOption[];
}

export interface CoachInput {
  readonly delivery: ExecutedDelivery;
  readonly batter: Player;
  readonly ground: GroundModel | undefined;
  readonly guard: number;
  readonly scheme: ArrowScheme;
  readonly pad?: boolean;
  readonly attempt: ShotAttempt | undefined;
  /** Raw press error, seconds (+ late). */
  readonly pressError: number | undefined;
  readonly contact: ContactResult | undefined;
  readonly runs: number;
  readonly out: string | undefined;
  readonly reachScale?: number;
  /** A shot key was pressed, but only after the ball had gone by. */
  readonly tooLate?: boolean;
}

/** The coach's read of one ball. */
export function coachBall(i: CoachInput): Coaching {
  const ball = readBall(i.delivery, i.batter.battingHand, i.guard);
  const options = shotOptions(i.delivery, i.batter, i.ground, i.guard, i.scheme, i.reachScale);
  const best = options.slice(0, 3);
  const label = (o: ShotOption) => `${o.name} (${comboLabel(o.combo, i.pad)})`;
  const points: string[] = [];
  const a = i.attempt;
  const c = i.contact;
  const pressMs = i.pressError === undefined ? undefined : Math.round(i.pressError * 1000);

  if (!a && i.tooLate) {
    points.push('Far too late: the ball was past you before you pressed. Start the stroke as the ball pitches — the bat takes a moment to come down.');
    return { ball, played: 'Too late', pressMs: undefined, timingWord: 'Too late', sweetSpot: undefined, whereOnBat: undefined, verdict: 'bad', points, options: best };
  }
  if (!a || a.shot === 'leave') {
    const word = a ? 'Left' : 'No shot';
    if (ball.hitting) points.push(`${ball.words} — it was hitting the stumps. You have to play at that one.`);
    else if (a) points.push(`${ball.words}, and missing: a good leave.`);
    else points.push(`${ball.words}. You didn't play a shot — press a shot key as it arrives.`);
    return {
      ball,
      played: a ? 'Leave' : 'No shot',
      pressMs: undefined,
      timingWord: word,
      sweetSpot: undefined,
      whereOnBat: undefined,
      verdict: ball.hitting ? 'bad' : a ? 'good' : 'ok',
      points,
      options: best,
    };
  }

  const def = SHOTS[a.shot];
  const mine = options.find((o) => o.attempt.shot === a.shot && o.attempt.footwork === a.footwork);
  const tooLate = !c;
  const timingWord: Coaching['timingWord'] = tooLate ? 'Too late' : pressMs === undefined || Math.abs(pressMs) <= 25 ? 'Perfect' : pressMs < 0 ? 'Early' : 'Late';

  // 1. Timing.
  if (tooLate) points.push('Far too late: the ball was past you before the bat came down. Start the stroke as the ball pitches.');
  else if (pressMs !== undefined && pressMs > 25)
    points.push(`Late by ${pressMs} ms. Press earlier${i.delivery.releaseSpeedKph > 130 ? ' — against pace, as the ball lands' : ''}: the bat takes a moment to come down.`);
  else if (pressMs !== undefined && pressMs < -25) points.push(`Early by ${-pressMs} ms. Wait for it a fraction longer${i.delivery.type.id === 'slower' ? ' — it was the slower ball' : ''}.`);

  // 2. Foot: front to full, back to short.
  const short = ball.length === 'short' || ball.length === 'bouncer' || ball.length === 'back';
  const full = ball.length === 'full' || ball.length === 'yorker' || ball.length === 'fullToss';
  if (a.footwork === 'front' && short && def.kind !== 'defence') points.push(`It was ${LENGTH_WORDS[ball.length]}: go back (W) to it, don't lunge forward.`);
  else if (a.footwork === 'back' && full) points.push(`It was ${LENGTH_WORDS[ball.length]}: get forward (S) to it.`);

  // 3. Line and height for the stroke chosen.
  const off = offSideSign(i.batter.battingHand);
  const planeZ = contactPlaneZ(a, i.batter.batting.footwork, i.delivery.actual.pitch?.z);
  const arr = predictArrival(i.delivery, planeZ, i.ground);
  if (arr) {
    const pitched = i.delivery.actual.pitch !== undefined && i.delivery.actual.pitch.z < planeZ;
    const r = strokeReach(def, i.batter, arr.x * off - i.guard, arr.y, pitched ? 1 : -5, i.reachScale);
    if (r.reach > 1.4) {
      if (r.dHeight > 0.05) points.push(`Too high for the ${def.name.toLowerCase()}: it was ${arr.y.toFixed(1)} m up when it reached you.`);
      else if (r.dHeight < -0.05) points.push(`Too full and low for the ${def.name.toLowerCase()}: it wanted the ball higher.`);
      if (r.dLine > 0.05) points.push(`Too wide for the ${def.name.toLowerCase()}: ${CROSS_BAT.has(a.shot) ? 'reach for it and you nick it' : 'it wants the ball closer to you'}.`);
      else if (r.dLine < -0.05) points.push(`Too straight for the ${def.name.toLowerCase()}: you were playing across the line${ball.hitting ? ', with the stumps behind you' : ''}.`);
    }
  }
  if (CROSS_BAT.has(a.shot) && ball.hitting && (i.out === 'bowled' || i.out === 'lbw')) points.push('A cross-bat stroke to a straight ball brings the stumps into play.');

  // 4. The contact itself.
  const sweetSpot = c && c.kind !== 'miss' ? Math.round(c.quality * 100) : undefined;
  const whereOnBat = !c || c.kind === 'miss' ? undefined : c.kind === 'edge' ? `${c.edge} edge` : c.along < -0.11 ? 'off the toe' : c.along > 0.12 ? 'high on the bat' : 'the middle';
  if (c?.kind === 'middled' && points.length === 0) points.push(`Middled — ${sweetSpot}% of the sweet spot${i.runs >= 4 ? '. Shot!' : '.'}`);

  const good = c?.kind === 'middled' && (mine?.fit ?? 0) > 0.4;
  const verdict: Coaching['verdict'] = i.out ? 'bad' : good ? 'good' : c && c.kind !== 'miss' && c.kind !== 'edge' ? 'ok' : 'bad';
  // Suggest the ball's best strokes when this one was not among them.
  const inTop = best.some((o) => o.attempt.shot === a.shot);
  if (!inTop && best[0]) points.push(`For this ball try the ${label(best[0])}.`);
  return {
    ball,
    played: def.name,
    pressMs,
    timingWord,
    sweetSpot,
    whereOnBat,
    verdict,
    points: points.slice(0, 4),
    options: best,
  };
}
