import { Rng } from '../core/rng.ts';

/**
 * Ball-by-ball commentary, written from what actually happened: who bowled
 * to whom, the delivery and its pace, the stroke and where it went, the
 * fielder, the batter's and bowler's figures, milestones, the over and the
 * state of a chase — plus what the AI captain and the learning bowlers are
 * doing. Lines are chosen from varied phrasings (never the same phrasing
 * twice running) by a seeded RNG, so a match's commentary is reproducible.
 */
export type Excitement = 0 | 1 | 2;

export interface CommentaryLine {
  readonly text: string;
  /** 0 routine, 1 notable (boundary, appeal), 2 big moment (six, wicket, milestone). */
  readonly excitement: Excitement;
}

export interface BallCall {
  readonly bowler: string;
  readonly batter: string;
  readonly delivery: { readonly name: string; readonly speedKph: number; readonly line: number; readonly length?: number | undefined };
  readonly pace: boolean;
  readonly shot?: string | undefined;
  readonly contact?: 'middled' | 'mistimed' | 'edge' | 'miss' | 'leave' | undefined;
  readonly directionDeg?: number | undefined;
  readonly elevationDeg?: number | undefined;
  readonly runs: number;
  readonly extras: number;
  readonly wide: boolean;
  readonly noBall: boolean;
  readonly boundary?: 4 | 6 | undefined;
  readonly wicket?: { readonly kind: 'bowled' | 'caught' | 'lbw' | 'runOut'; readonly fielder?: string | undefined; readonly out: string } | undefined;
  /** An lbw appeal turned down, and why. */
  readonly notOutLbw?: string | undefined;
  readonly padded?: boolean | undefined;
  /** The striker's score after the ball. */
  readonly batterRuns: number;
  readonly batterBalls: number;
  readonly outBatterRuns?: number | undefined;
  readonly bowlerWickets: number;
  readonly total: { readonly runs: number; readonly wickets: number };
  readonly overComplete: boolean;
  readonly overRuns: number;
  readonly chase?: { readonly team: string; readonly needed: number; readonly balls: number } | undefined;
  /** Why the bowler chose this plan, when the learning attack is exploiting a weakness. */
  readonly insight?: string | undefined;
  /** The field has just been moved to protect this region. */
  readonly fieldChange?: string | undefined;
}

const surname = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
};

/** Where a shot went, in commentary language. */
export function region(directionDeg: number, lofted: boolean): string {
  const d = directionDeg;
  const a = Math.abs(d);
  const off = d >= 0;
  if (a < 12) return lofted ? 'straight back over the bowler' : 'straight down the ground';
  if (a < 40) return off ? (lofted ? 'over long-off' : 'past mid-off') : lofted ? 'over long-on' : 'past mid-on';
  if (a < 85) return off ? (lofted ? 'over extra cover' : 'through the covers') : lofted ? 'over deep midwicket' : 'through midwicket';
  if (a < 120) return off ? (lofted ? 'over point' : 'square on the off side') : lofted ? 'over square leg' : 'square on the leg side';
  if (a < 165) return off ? (lofted ? 'over the slips' : 'down to third man') : lofted ? 'over fine leg' : 'fine down the leg side';
  return off ? 'fine past the keeper' : 'fine, past the keeper down the leg side';
}

type Fill = Record<string, string>;

const fill = (template: string, f: Fill) => template.replace(/\{(\w+)\}/g, (_, k: string) => f[k] ?? '');

const LINES = {
  six: [
    'SIX! {bat} launches it {where}.',
    'That is huge — {where}, and into the crowd. Six!',
    '{bat} picks the length early and deposits it {where}. Six more.',
    'Gone! Cleared the rope {where} with plenty to spare — six.',
  ],
  four: [
    'FOUR! {shot} {where}, and nobody is stopping that.',
    'Cracking shot from {bat} — {where} for four.',
    'That races away {where}. Four runs.',
    'Beautifully timed, {where}. The fielder gives up the chase.',
  ],
  edgeFour: ['Thick edge… and it flies down to third man for four. Not where he meant it.', 'Off the edge, past the slips, four. {bowl} cannot believe it.'],
  bowled: ['Bowled him! Through the gate, and {bat} has to go.', 'Timber! {bowl} knocks the stumps over.', 'Clean bowled! The bails are on the floor.'],
  yorked: ['Yorked him! Full, fast, and the stumps are splattered.', 'Right in the blockhole — {bat} is bowled.'],
  caughtBehind: ['Edged… and taken behind! {bat} feathers it through to {field}.', 'Nick and gone — {field} takes it cleanly.'],
  caught: ['Caught! {bat} picks out {field}.', 'In the air… and taken by {field}! {bat} goes.', 'Straight down {field}’s throat. A soft dismissal.'],
  caughtBig: ['Up, up… and {field} holds on at the rope! What a catch.', 'Went for the big one and found {field}. Caught.'],
  lbw: ['Big appeal… given! Plumb in front — {bat} is out lbw.', 'Trapped in front! The finger goes up.'],
  runOut: ['Run out! {field}’s throw beats {bat} to the crease.', 'Direct hit… and {bat} is short of his ground. Run out!'],
  notOut: ['Loud appeal for lbw… not out. {reason}.', 'They go up for lbw, but the umpire shakes his head — {reason}.'],
  beaten: ['Beaten! Lovely delivery from {bowl}.', 'Past the outside edge. {bat} had no idea.', 'Played and missed. That {ball} did just enough.'],
  left: ['Left alone outside off.', '{bat} shoulders arms. Good judgement.', 'No stroke offered — well left.'],
  defended: ['Defended solidly.', 'Watchful defence from {bat}.', 'Blocked back towards {bowl}.'],
  dot: ['No run.', 'Straight to the fielder, no run.', 'Well stopped in the ring — dot ball.'],
  padded: ['Struck on the pad, going down leg. No appeal.', 'Off the pad, no run.'],
  one: ['{shot} {where} for a single.', 'Worked {where}, and they take one.', 'Pushed {where} — quick single.'],
  two: ['Two runs, {where}. Good running.', 'Into the gap {where} — they come back for the second.'],
  three: ['Three! They hustle back for the third, {where}.', 'Excellent running — three, {where}.'],
  wide: ['Wide called — too far {side}.', 'That one’s strayed {side}. Wide.'],
  noBall: ['No-ball! {bowl} has overstepped.', 'He’s over the line — no-ball.'],
  pace: ['{kph} km/h — that was rapid.', 'Clocked at {kph} km/h.'],
} as const;

type Category = keyof typeof LINES;

export class Commentator {
  private readonly rng: Rng;
  private readonly last = new Map<Category, number>();

  constructor(seed: string) {
    this.rng = new Rng(`commentary-${seed}`);
  }

  private say(category: Category, f: Fill): string {
    const options = LINES[category];
    let i = this.rng.int(0, options.length - 1);
    if (options.length > 1 && i === this.last.get(category)) i = (i + 1) % options.length;
    this.last.set(category, i);
    return fill(options[i] ?? options[0], f);
  }

  ball(c: BallCall): CommentaryLine {
    const bat = surname(c.batter);
    const bowl = surname(c.bowler);
    const lofted = (c.elevationDeg ?? 0) > 14;
    const where = c.directionDeg === undefined ? 'into the gap' : region(c.directionDeg, lofted);
    const f: Fill = {
      bat,
      bowl,
      where,
      shot: c.shot ?? 'Played',
      ball: c.delivery.name.toLowerCase(),
      kph: String(Math.round(c.delivery.speedKph)),
      field: c.wicket?.fielder ? surname(c.wicket.fielder) : 'the fielder',
      reason: c.notOutLbw ?? 'not out',
      side: c.delivery.line < 0 ? 'down the leg side' : 'outside off stump',
    };
    const parts: string[] = [`${bowl} to ${bat}.`];
    let excitement: Excitement = 0;

    if (c.wicket) {
      const out = surname(c.wicket.out);
      f.bat = out;
      excitement = 2;
      if (c.wicket.kind === 'bowled') parts.push(this.say(c.delivery.name === 'Yorker' ? 'yorked' : 'bowled', f));
      else if (c.wicket.kind === 'lbw') parts.push(this.say('lbw', f));
      else if (c.wicket.kind === 'runOut') parts.push(this.say('runOut', f));
      else if (c.contact === 'edge' && c.wicket.fielder && (c.directionDeg === undefined || Math.abs(c.directionDeg) > 150)) parts.push(this.say('caughtBehind', f));
      else parts.push(this.say(lofted ? 'caughtBig' : 'caught', f));
      if (c.outBatterRuns !== undefined) parts.push(`${out} goes for ${c.outBatterRuns}.`);
      if (c.wicket.kind !== 'runOut' && c.bowlerWickets >= 3) parts.push(`That's ${c.bowlerWickets} for ${bowl}.`);
      if (c.insight && c.wicket.kind !== 'runOut') parts.push(`The plan worked: ${c.insight}.`);
    } else if (c.wide) {
      parts.push(this.say('wide', f));
    } else if (c.noBall) {
      parts.push(this.say('noBall', f));
      if (c.runs > 0) parts.push(c.boundary ? `And ${c.runs} off it as well!` : `${c.runs} taken as well.`);
      excitement = 1;
    } else if (c.boundary === 6) {
      parts.push(this.say('six', f));
      excitement = 2;
    } else if (c.boundary === 4) {
      parts.push(this.say(c.contact === 'edge' ? 'edgeFour' : 'four', f));
      excitement = 1;
    } else if (c.runs === 0) {
      if (c.notOutLbw) {
        parts.push(this.say('notOut', f));
        excitement = 1;
      } else if (c.padded) parts.push(this.say('padded', f));
      else if (c.contact === 'leave' || c.contact === undefined) parts.push(this.say('left', f));
      else if (c.contact === 'miss' || c.contact === 'edge') parts.push(this.say('beaten', f));
      else if (c.shot === 'Defensive block') parts.push(this.say('defended', f));
      else parts.push(this.say('dot', f));
      if (c.pace && c.delivery.speedKph >= 147 && this.rng.chance(0.6)) parts.push(this.say('pace', f));
      if (c.insight && this.rng.chance(0.5)) parts.push(`${c.insight[0]?.toUpperCase() ?? ''}${c.insight.slice(1)}.`);
    } else {
      parts.push(this.say(c.runs === 1 ? 'one' : c.runs === 2 ? 'two' : 'three', f));
    }

    // Milestones.
    if (!c.wicket && c.runs > 0) {
      const before = c.batterRuns - c.runs;
      for (const m of [50, 100]) {
        if (before < m && c.batterRuns >= m) {
          parts.push(`That brings up ${m === 50 ? 'a fifty' : 'a hundred'} for ${bat}, off ${c.batterBalls} balls!`);
          excitement = 2;
        }
      }
    }
    if (c.fieldChange) parts.push(`The captain moves a fielder back — protecting ${c.fieldChange}.`);
    if (c.overComplete) {
      if (c.overRuns === 0) parts.push(`A maiden from ${bowl}.`);
      else parts.push(`${c.overRuns} from the over.`);
      if (c.chase && c.chase.needed > 0 && c.chase.balls > 0) parts.push(`${c.chase.team} need ${c.chase.needed} from ${c.chase.balls} ball${c.chase.balls === 1 ? '' : 's'}.`);
    }
    return { text: parts.join(' '), excitement };
  }

  newBowler(bowler: string, firstOver: boolean): CommentaryLine {
    return { text: firstOver ? `${surname(bowler)} to open the bowling.` : `${surname(bowler)} into the attack.`, excitement: 0 };
  }

  inningsBreak(team: string, runs: number, wickets: number, target: number, chasing: string): CommentaryLine {
    return { text: `${team} finish on ${runs} for ${wickets}. ${chasing} need ${target} to win.`, excitement: 1 };
  }

  result(summary: string): CommentaryLine {
    return { text: `${summary}!`, excitement: 2 };
  }
}
