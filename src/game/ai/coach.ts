import type { DeliveryTypeId } from '../bowling/deliveryTypes.ts';

/**
 * The coach: reads the human player's ball-by-ball record and turns the
 * patterns in it into specific advice, the way a batting or bowling coach
 * would after watching an innings:
 *
 *  - timing: are strokes consistently early or late (overall, and against
 *    the slower ball or real pace)?
 *  - the delivery that troubles you most (wickets, plays-and-misses, dots)
 *    and how to play it with this game's controls;
 *  - shot selection against the length (front-foot drives to short balls,
 *    leaving balls that hit the stumps);
 *  - what is working (the stroke bringing the most runs);
 *  - bowling: which deliveries were expensive and which took wickets, wides.
 *
 * Pure and deterministic: it only reads the log.
 */
export interface BallRecord {
  readonly innings: number;
  readonly humanBatting: boolean;
  readonly humanBowling: boolean;
  readonly deliveryType: DeliveryTypeId;
  readonly deliveryName: string;
  readonly speedKph: number;
  /** Metres in front of the stumps where it pitched (undefined for a full toss). */
  readonly length: number | undefined;
  readonly shot: string | undefined;
  readonly shotName: string | undefined;
  readonly footwork: 'front' | 'back' | 'out' | undefined;
  readonly contact: 'middled' | 'mistimed' | 'edge' | 'miss' | 'leave' | undefined;
  readonly timingMs: number | undefined;
  readonly runs: number;
  readonly extras: number;
  readonly wide: boolean;
  readonly noBall: boolean;
  readonly wicket: 'bowled' | 'caught' | 'lbw' | 'runOut' | 'stumped' | undefined;
  readonly legal: boolean;
}

export interface CoachNote {
  readonly title: string;
  readonly detail: string;
  readonly tone: 'work-on' | 'strength';
}

const HOW_TO_PLAY: Partial<Record<DeliveryTypeId, string>> = {
  yorker: 'Against the yorker, block it (S) or drive straight (D with ↑) — trying to hit it square brings the stumps into play.',
  bouncer: 'Against the bouncer, leave it (X), or hold Shift for the pull or hook (D or A with →) — front-foot strokes to it go in the air.',
  slower: 'Watch for the slower ball: it arrives later than the run-up suggests, so wait before pressing.',
  outswinger: 'The outswinger draws edges: leave it (X) when it starts outside off, and drive only when it is full.',
  inswinger: 'Against the inswinger, play straight or flick it (D with →) — the cover drive leaves the gate open.',
  googly: 'The googly turns into the right-hander: play it later and straighter.',
  doosra: 'The doosra turns away: play it later, with a straight bat.',
  legBreak: 'Against the leg-break, use the sweep (W) to balls on the stumps, or wait and cut the short one.',
  offBreak: 'Against the off-break, play with the turn — the flick and the sweep (W) are the safe scoring shots.',
  topSpinner: 'The top-spinner bounces more: get on top of it on the back foot (Shift).',
  fast: 'Against the stock ball, pick your length: front-foot drives to full balls, back-foot strokes (Shift) to short ones.',
};

const FRONT_FOOT_ATTACK = new Set(['coverDrive', 'offDrive', 'straightDrive', 'onDrive', 'loftedDrive']);

export function battingNotes(log: readonly BallRecord[]): CoachNote[] {
  const balls = log.filter((b) => b.humanBatting && !b.wide);
  if (balls.length < 6) return [];
  const notes: CoachNote[] = [];

  // Timing.
  const timed = balls.filter((b) => b.timingMs !== undefined && b.contact !== 'leave');
  if (timed.length >= 4) {
    const mean = timed.reduce((s, b) => s + (b.timingMs ?? 0), 0) / timed.length;
    const slower = timed.filter((b) => b.deliveryType === 'slower');
    const slowerMean = slower.length ? slower.reduce((s, b) => s + (b.timingMs ?? 0), 0) / slower.length : 0;
    if (mean < -18) {
      notes.push({
        title: `You are early — by about ${Math.round(-mean)} ms`,
        detail: `Most of your strokes are started too soon, which sends the ball squarer and in the air. Wait a fraction longer before pressing${slower.length >= 2 && slowerMean < -25 ? `, especially against the slower ball (${Math.round(-slowerMean)} ms early)` : ''}.`,
        tone: 'work-on',
      });
    } else if (mean > 18) {
      const quick = timed.filter((b) => b.speedKph >= 140);
      notes.push({
        title: `You are late — by about ${Math.round(mean)} ms`,
        detail: `Start the stroke a touch earlier${quick.length >= 2 ? ' — against 140 km/h+ press as the ball passes the halfway mark' : ''}. Late strokes drag the ball fine and find the edge.`,
        tone: 'work-on',
      });
    } else {
      notes.push({ title: 'Your timing is sound', detail: `On average you are within ${Math.max(1, Math.round(Math.abs(mean)))} ms of perfect. Now pick the gaps.`, tone: 'strength' });
    }
  }

  // The delivery that troubles you most.
  const byType = new Map<DeliveryTypeId, BallRecord[]>();
  for (const b of balls) byType.set(b.deliveryType, [...(byType.get(b.deliveryType) ?? []), b]);
  let worst: { type: DeliveryTypeId; name: string; trouble: number; runs: number; n: number; outs: number } | undefined;
  for (const [type, list] of byType) {
    if (list.length < 3) continue;
    const outs = list.filter((b) => b.wicket && b.wicket !== 'runOut').length;
    const beaten = list.filter((b) => b.contact === 'miss' || b.contact === 'edge').length;
    const runs = list.reduce((s, b) => s + b.runs, 0);
    const trouble = (outs * 4 + beaten) / list.length - runs / list.length / 3;
    if (!worst || trouble > worst.trouble) worst = { type, name: list[0]?.deliveryName ?? type, trouble, runs, n: list.length, outs };
  }
  if (worst && worst.trouble > 0.2) {
    notes.push({
      title: `Your nemesis: the ${worst.name.toLowerCase()}`,
      detail: `${worst.runs} run${worst.runs === 1 ? '' : 's'} from ${worst.n} balls${worst.outs ? `, out ${worst.outs === 1 ? 'once' : `${worst.outs} times`}` : ''}. ${HOW_TO_PLAY[worst.type] ?? ''} The bowlers notice, too — they will keep bowling it.`,
      tone: 'work-on',
    });
  }

  // Shot selection against the length.
  const drivesToShort = balls.filter((b) => b.shot && FRONT_FOOT_ATTACK.has(b.shot) && (b.length ?? 0) > 7.5).length;
  const leftAndHit = balls.filter((b) => b.contact === 'leave' && (b.wicket === 'bowled' || b.wicket === 'lbw')).length;
  if (leftAndHit > 0) {
    notes.push({ title: 'Know where your off stump is', detail: `You were out leaving a ball that hit the stumps${leftAndHit > 1 ? ` ${leftAndHit} times` : ''}. Only leave (X) what is clearly missing.`, tone: 'work-on' });
  } else if (drivesToShort >= 2) {
    notes.push({
      title: 'Back foot to the short ball',
      detail: `You drove off the front foot at ${drivesToShort} short balls. Hold Shift for the pull (→) or the cut (←) — the drive needs a full length.`,
      tone: 'work-on',
    });
  }

  // What is working.
  const byShot = new Map<string, { runs: number; n: number }>();
  for (const b of balls) {
    if (!b.shotName || b.contact === 'leave') continue;
    const s = byShot.get(b.shotName) ?? { runs: 0, n: 0 };
    byShot.set(b.shotName, { runs: s.runs + b.runs, n: s.n + 1 });
  }
  const best = [...byShot.entries()].filter(([, s]) => s.n >= 2).sort((a, b) => b[1].runs - a[1].runs)[0];
  if (best && best[1].runs >= 8) {
    notes.push({ title: `The ${best[0].toLowerCase()} is your scoring shot`, detail: `${best[1].runs} runs from ${best[1].n} balls with it. Expect the captain to put a fielder there.`, tone: 'strength' });
  }
  return notes.slice(0, 4);
}

export function bowlingNotes(log: readonly BallRecord[]): CoachNote[] {
  const balls = log.filter((b) => b.humanBowling);
  if (balls.length < 6) return [];
  const notes: CoachNote[] = [];
  const legalOf = (l: readonly BallRecord[]) => l.filter((b) => b.legal).length;
  const byType = new Map<string, BallRecord[]>();
  for (const b of balls) byType.set(b.deliveryName, [...(byType.get(b.deliveryName) ?? []), b]);
  const stats = [...byType.entries()]
    .filter(([, l]) => legalOf(l) >= 3)
    .map(([name, l]) => {
      const runs = l.reduce((s, b) => s + b.runs + b.extras, 0);
      const legal = Math.max(1, legalOf(l));
      return { name, econ: (runs / legal) * 6, wickets: l.filter((b) => b.wicket && b.wicket !== 'runOut').length, n: legal };
    });
  const best = stats.slice().sort((a, b) => b.wickets - a.wickets || a.econ - b.econ)[0];
  const worst = stats.slice().sort((a, b) => b.econ - a.econ)[0];
  if (best) notes.push({ title: `Your best ball: the ${best.name.toLowerCase()}`, detail: `${best.econ.toFixed(1)} an over${best.wickets ? ` and ${best.wickets} wicket${best.wickets === 1 ? '' : 's'}` : ''} from ${best.n} balls.`, tone: 'strength' });
  if (worst && best && worst.name !== best.name && worst.econ > 9) {
    notes.push({ title: `The ${worst.name.toLowerCase()} is being punished`, detail: `${worst.econ.toFixed(1)} an over. Change the length or bowl it less — the batters are waiting for it.`, tone: 'work-on' });
  }
  const wides = balls.filter((b) => b.wide).length;
  if (wides >= 2) notes.push({ title: `${wides} wides`, detail: 'Keep the target inside the tramlines: more than about 0.8 m outside off, or down the leg side, is called wide.', tone: 'work-on' });
  return notes.slice(0, 3);
}
