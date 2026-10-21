import { FixedStepClock } from '../core/fixedStep.ts';
import { Rng } from '../core/rng.ts';
import { BOWLER_FOLLOW_THROUGH, STANDARD_FIELD } from '../data/fieldPositions.ts';
import { PITCHES, type PitchId } from '../data/pitches.ts';
import type { Team } from '../data/teams.ts';
import { chooseDelivery } from '../ai/bowlingAi.ts';
import type { ShotAttempt } from '../batting/shots.ts';
import { DELIVERY_TYPES, type DeliveryTypeId, LENGTHS, deliveriesFor } from '../bowling/deliveryTypes.ts';
import { fatigueAfterBall, fatigueAfterRest } from '../bowling/fatigue.ts';
import { type Fielder, buildField } from '../fielding/plan.ts';
import { DIFFICULTIES, type DifficultyId } from '../model/difficulty.ts';
import { type Player, isSpinner } from '../model/player.ts';
import { type BallOutcome, DeliveryCycle, type WicketKind } from '../session/deliveryCycle.ts';

/**
 * A limited-overs match: toss decided, two innings, a target, a result.
 *
 * Rules implemented: overs of six legal balls; wides and no-balls (one
 * extra, re-bowled); bowled, caught, LBW and run out; strike rotation on odd
 * runs and at the end of each over; the new batter takes strike after a
 * catch; a bowler may not bowl consecutive overs or more than a fifth of the
 * innings' overs; an innings ends when all out, the overs are used or the
 * target is passed. The match engine knows nothing about rendering.
 */
export type SideId = 'home' | 'away';
export type Controller = 'human' | 'ai';

export interface MatchSide {
  readonly team: Team;
  /** The playing XI in batting order. */
  readonly xi: readonly Player[];
  readonly keeperId: string;
  readonly controller: Controller;
}

export interface MatchConfig {
  readonly home: MatchSide;
  readonly away: MatchSide;
  readonly overs: number;
  readonly battingFirst: SideId;
  readonly pitch: PitchId;
  readonly difficulty: DifficultyId;
  readonly seed: string;
}

export interface Dismissal {
  readonly kind: WicketKind;
  readonly bowler?: string;
  readonly fielder?: string;
}

export interface BattingCard {
  readonly player: Player;
  readonly runs: number;
  readonly balls: number;
  readonly fours: number;
  readonly sixes: number;
  readonly batted: boolean;
  readonly dismissal?: Dismissal;
}

export interface BowlingCard {
  readonly player: Player;
  readonly balls: number;
  readonly runs: number;
  readonly wickets: number;
  readonly maidens: number;
}

export interface FallOfWicket {
  readonly wicket: number;
  readonly runs: number;
  readonly balls: number;
  readonly batter: string;
}

export interface InningsState {
  readonly batting: SideId;
  readonly bowling: SideId;
  readonly runs: number;
  readonly wickets: number;
  readonly balls: number;
  readonly wides: number;
  readonly noBalls: number;
  readonly fours: number;
  readonly sixes: number;
  readonly battingCards: readonly BattingCard[];
  readonly bowlingCards: readonly BowlingCard[];
  readonly fallOfWickets: readonly FallOfWicket[];
  /** Runs needed to win (second innings only). */
  readonly target?: number;
  readonly endReason?: 'allOut' | 'overs' | 'target';
}

export interface MatchResult {
  readonly winner?: SideId;
  readonly tie: boolean;
  /** e.g. "by 24 runs", "by 4 wickets (7 balls left)". */
  readonly margin: string;
  readonly summary: string;
}

export interface BowlingSetup {
  readonly type: DeliveryTypeId;
  readonly line: number;
  readonly length: number;
}

export type MatchPhase = 'between' | 'chooseBowler' | 'aiming' | 'delivery' | 'inningsBreak' | 'complete';

export const LINE_RANGE = { min: -0.6, max: 1.0 } as const;
export const LENGTH_RANGE = { min: 0.3, max: 12.5 } as const;
const BETWEEN_BALLS = 0.9;
const AUTO_BREAK = 3;

export const maxOversPerBowler = (overs: number): number => Math.max(1, Math.ceil(overs / 5));

export class Match {
  readonly config: MatchConfig;
  readonly clock = new FixedStepClock();
  phase: MatchPhase = 'between';
  paused = false;
  time = 0;
  readonly innings: InningsState[] = [];
  cycle: DeliveryCycle | undefined;
  lastOutcome: BallOutcome | undefined;
  result: MatchResult | undefined;
  recent: string[] = [];
  readonly history: BallOutcome[] = [];
  setup: BowlingSetup;
  strikerIndex = 0;
  nonStrikerIndex = 1;
  private nextIndex = 2;
  private bowlerId = '';
  private lastOverBowlerId = '';
  private ballsThisOver = 0;
  private runsThisOver = 0;
  private readonly fatigue = new Map<string, number>();
  private phaseTimer = 0;
  private ballNumber = 0;
  private readonly rng: Rng;
  private readonly listeners = new Set<() => void>();

  constructor(config: MatchConfig) {
    if (config.home.xi.length !== 11 || config.away.xi.length !== 11) throw new Error('Each side needs exactly 11 players');
    this.config = config;
    this.rng = new Rng(config.seed);
    this.startInnings(config.battingFirst);
    this.setup = defaultSetup(this.bowler);
  }

  // --- Accessors -------------------------------------------------------------------

  get inningsIndex(): number {
    return this.innings.length - 1;
  }

  get current(): InningsState {
    const i = this.innings[this.innings.length - 1];
    if (!i) throw new Error('no innings');
    return i;
  }

  side(id: SideId): MatchSide {
    return id === 'home' ? this.config.home : this.config.away;
  }

  get battingSide(): MatchSide {
    return this.side(this.current.batting);
  }

  get bowlingSide(): MatchSide {
    return this.side(this.current.bowling);
  }

  get striker(): Player {
    return at(this.battingSide.xi, this.strikerIndex);
  }

  get nonStriker(): Player {
    return at(this.battingSide.xi, this.nonStrikerIndex);
  }

  get bowler(): Player {
    return this.bowlingSide.xi.find((p) => p.id === this.bowlerId) ?? at(this.bowlingSide.xi, 0);
  }

  get overs(): string {
    return oversText(this.current.balls);
  }

  get bowlerFatigue(): number {
    return this.fatigue.get(this.bowler.id) ?? 0;
  }

  get humanBatting(): boolean {
    return this.battingSide.controller === 'human';
  }

  get humanBowling(): boolean {
    return this.bowlingSide.controller === 'human';
  }

  /** Runs still needed and balls left, in the chase. */
  get chase(): { needed: number; ballsLeft: number } | undefined {
    const t = this.current.target;
    if (t === undefined) return undefined;
    return { needed: Math.max(0, t - this.current.runs), ballsLeft: this.config.overs * 6 - this.current.balls };
  }

  /** The human bowler's accuracy meter, 0–1 (0.5 perfect), a triangle wave during the run-up. */
  get meter(): number {
    const c = this.cycle;
    if (!c || c.phase !== 'runUp') return 0.5;
    const period = 0.9;
    const x = (c.time % period) / period;
    return x < 0.5 ? x * 2 : 2 - x * 2;
  }

  get availableDeliveries(): DeliveryTypeId[] {
    return deliveriesFor(this.bowler.bowlingStyle)
      .map((d) => d.id)
      .filter((id) => id !== 'fullToss');
  }

  /** Bowlers allowed to bowl the next over: not the last over's bowler, under the limit. */
  eligibleBowlers(): Player[] {
    const max = maxOversPerBowler(this.config.overs);
    const overs = (p: Player) => Math.floor((this.card(p)?.balls ?? 0) / 6);
    const bowlers = this.bowlingSide.xi.filter((p) => p.bowlingStyle !== 'none' && p.id !== this.keeperOf(this.current.bowling).id);
    const fresh = bowlers.filter((p) => p.id !== this.lastOverBowlerId && overs(p) < max);
    if (fresh.length) return fresh;
    // Quotas exhausted (tiny matches with few bowlers): anyone but the last over's bowler.
    const any = bowlers.filter((p) => p.id !== this.lastOverBowlerId);
    return any.length ? any : bowlers;
  }

  /** The bowler the computer would pick: the best-rated eligible bowler, adjusted for fatigue. */
  suggestedBowler(): Player {
    const rating = (p: Player) =>
      p.bowling.accuracy + (isSpinner(p.bowlingStyle) ? p.bowling.spin : p.bowling.pace) * 0.9 + p.bowling.swing * 0.2 - (this.fatigue.get(p.id) ?? 0) * 60;
    const eligible = this.eligibleBowlers();
    const best = eligible.slice().sort((a, b) => rating(b) - rating(a))[0];
    return best ?? this.bowler;
  }

  oversBowledBy(p: Player): string {
    return oversText(this.card(p)?.balls ?? 0);
  }

  keeperOf(side: SideId): Player {
    const s = this.side(side);
    return s.xi.find((p) => p.id === s.keeperId) ?? at(s.xi, 0);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- Time ----------------------------------------------------------------------------

  advance(frameSeconds: number): number {
    if (this.paused) return 0;
    const steps = this.clock.advance(frameSeconds);
    for (let i = 0; i < steps; i++) this.step(this.clock.stepSeconds);
    return steps;
  }

  step(dt: number): void {
    this.time += dt;
    switch (this.phase) {
      case 'between':
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) this.beginBall();
        break;
      case 'delivery': {
        const c = this.cycle;
        if (!c) break;
        const before = c.phase;
        c.step(dt);
        if (before !== 'dead' && c.phase === 'dead' && c.outcome) this.record(c.outcome);
        else if (before !== c.phase) this.emit();
        if (c.finished) this.afterBall();
        break;
      }
      case 'inningsBreak':
        if (!this.humanBatting && !this.humanBowling) {
          this.phaseTimer -= dt;
          if (this.phaseTimer <= 0) this.continueAfterBreak();
        }
        break;
      case 'chooseBowler':
      case 'aiming':
      case 'complete':
        break;
    }
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.clock.reset();
    this.emit();
  }

  // --- Human input -------------------------------------------------------------------

  playShot(shot: ShotAttempt): boolean {
    if (!this.humanBatting || this.paused) return false;
    return this.cycle?.playShot(shot) ?? false;
  }

  callRun(): boolean {
    if (!this.humanBatting || this.paused) return false;
    const ok = this.cycle?.callRun() ?? false;
    if (ok) this.emit();
    return ok;
  }

  bowlButton(): void {
    if (!this.humanBowling || this.paused) return;
    if (this.phase === 'aiming') {
      this.startCycle({ type: this.setup.type, line: this.setup.line, length: this.setup.length });
      return;
    }
    const c = this.cycle;
    if (this.phase === 'delivery' && c && c.phase === 'runUp' && !c.releaseLocked) {
      c.setReleaseQuality(1 - Math.abs(this.meter - 0.5) * 2);
    }
  }

  /** Human captain picks the bowler for the next over. */
  chooseBowler(playerId: string): boolean {
    if (this.phase !== 'chooseBowler') return false;
    const p = this.eligibleBowlers().find((b) => b.id === playerId);
    if (!p) return false;
    this.bowlerId = p.id;
    this.setup = defaultSetup(p);
    this.phase = 'aiming';
    this.emit();
    return true;
  }

  adjustTarget(dLine: number, dLength: number): void {
    if (!this.humanBowling) return;
    const s = this.setup;
    this.setup = {
      ...s,
      line: clamp(s.line + dLine, LINE_RANGE.min, LINE_RANGE.max),
      length: clamp(s.length + dLength, LENGTH_RANGE.min, LENGTH_RANGE.max),
    };
    this.emit();
  }

  cycleDelivery(direction: 1 | -1): void {
    if (!this.humanBowling) return;
    const options = this.availableDeliveries;
    const i = options.indexOf(this.setup.type);
    const next = options[(i + direction + options.length) % options.length] ?? options[0];
    if (!next) return;
    const def = DELIVERY_TYPES[next];
    const length = def.lengths ? clamp(this.setup.length, def.lengths.min, def.lengths.max) : this.setup.length;
    this.setup = { ...this.setup, type: next, length };
    this.emit();
  }

  /** Start the second innings after the break. */
  continueAfterBreak(): void {
    if (this.phase !== 'inningsBreak') return;
    const first = this.current;
    this.startInnings(first.bowling, first.runs + 1);
    this.enterBetween();
  }

  // --- Lifecycle ----------------------------------------------------------------------

  private startInnings(batting: SideId, target?: number): void {
    const bowling: SideId = batting === 'home' ? 'away' : 'home';
    const xi = this.side(batting).xi;
    this.innings.push({
      batting,
      bowling,
      runs: 0,
      wickets: 0,
      balls: 0,
      wides: 0,
      noBalls: 0,
      fours: 0,
      sixes: 0,
      battingCards: xi.map((player, i) => ({ player, runs: 0, balls: 0, fours: 0, sixes: 0, batted: i < 2 })),
      bowlingCards: [],
      fallOfWickets: [],
      ...(target !== undefined ? { target } : {}),
    });
    this.strikerIndex = 0;
    this.nonStrikerIndex = 1;
    this.nextIndex = 2;
    this.ballsThisOver = 0;
    this.runsThisOver = 0;
    this.lastOverBowlerId = '';
    this.fatigue.clear();
    this.recent = [];
    this.bowlerId = this.suggestedBowler().id;
  }

  private enterBetween(): void {
    this.phase = 'between';
    this.phaseTimer = BETWEEN_BALLS;
    this.emit();
  }

  private beginBall(): void {
    if (this.humanBowling) {
      // A new over (or innings): the human captain chooses the bowler.
      this.phase = this.ballsThisOver === 0 && this.needsBowlerChoice ? 'chooseBowler' : 'aiming';
      this.needsBowlerChoice = false;
      this.cycle = undefined;
      this.emit();
      return;
    }
    const d = chooseDelivery(this.bowler, DIFFICULTIES[this.config.difficulty], this.rng.fork(`bowl-ai-${this.ballNumber}`));
    this.startCycle(d.plan, d.releaseQuality);
  }

  private needsBowlerChoice = true;

  private startCycle(plan: BowlingSetup, releaseQuality?: number): void {
    const bowler = this.bowler;
    this.cycle = new DeliveryCycle({
      bowler,
      striker: this.striker,
      nonStriker: this.nonStriker,
      field: this.buildField(bowler),
      pitch: PITCHES[this.config.pitch],
      plan,
      fatigue: this.bowlerFatigue,
      rng: this.rng.fork(`ball-${this.ballNumber}`),
      manualRunning: this.humanBatting,
      ...(releaseQuality !== undefined ? { releaseQuality } : {}),
      ...(!this.humanBatting ? { battingAi: { difficulty: DIFFICULTIES[this.config.difficulty], intent: this.battingIntent() } } : {}),
    });
    this.ballNumber += 1;
    this.phase = 'delivery';
    this.emit();
  }

  /** How positive the computer batters should be, from the match situation. */
  battingIntent(): number {
    const inn = this.current;
    const total = this.config.overs * 6;
    const progress = inn.balls / total;
    const wicketsLeft = 10 - inn.wickets;
    const caution = wicketsLeft <= 3 ? 0.35 : wicketsLeft <= 5 ? 0.15 : 0;
    if (inn.target === undefined) return clamp(-0.05 + 0.85 * progress - caution, -0.5, 1);
    const ballsLeft = Math.max(1, total - inn.balls);
    const required = ((inn.target - inn.runs) / ballsLeft) * 6;
    return clamp((required - 5) / 5 - caution * 0.5, -0.5, 1);
  }

  private record(o: BallOutcome): void {
    const inn = this.current;
    const legal = !o.noBall && !o.wide;
    const bowler = this.bowler;
    const striker = this.striker;
    const outPlayer = o.wicket ? (o.wicket.batter === 'nonStriker' ? this.nonStriker : striker) : undefined;
    const runsTotal = o.runs + o.extras;
    const balls = inn.balls + (legal ? 1 : 0);
    const wickets = inn.wickets + (o.wicket ? 1 : 0);
    const battingCards = inn.battingCards.map((c) => {
      let next = c;
      if (c.player.id === striker.id) {
        next = {
          ...next,
          runs: next.runs + o.runs,
          balls: next.balls + (o.wide ? 0 : 1),
          fours: next.fours + (o.boundary === 4 ? 1 : 0),
          sixes: next.sixes + (o.boundary === 6 ? 1 : 0),
        };
      }
      if (outPlayer && c.player.id === outPlayer.id && o.wicket) {
        const credited = o.wicket.kind !== 'runOut';
        next = {
          ...next,
          dismissal: {
            kind: o.wicket.kind,
            ...(credited ? { bowler: bowler.name } : {}),
            ...(o.wicket.fielder ? { fielder: o.wicket.fielder } : {}),
          },
        };
      }
      return next;
    });
    const existing = inn.bowlingCards.find((c) => c.player.id === bowler.id);
    const card: BowlingCard = existing ?? { player: bowler, balls: 0, runs: 0, wickets: 0, maidens: 0 };
    const updatedCard: BowlingCard = {
      ...card,
      balls: card.balls + (legal ? 1 : 0),
      runs: card.runs + runsTotal,
      wickets: card.wickets + (o.wicket && o.wicket.kind !== 'runOut' ? 1 : 0),
    };
    const bowlingCards = existing ? inn.bowlingCards.map((c) => (c.player.id === bowler.id ? updatedCard : c)) : [...inn.bowlingCards, updatedCard];
    const runs = inn.runs + runsTotal;
    this.innings[this.innings.length - 1] = {
      ...inn,
      runs,
      wickets,
      balls,
      wides: inn.wides + (o.wide ? 1 : 0),
      noBalls: inn.noBalls + (o.noBall ? 1 : 0),
      fours: inn.fours + (o.boundary === 4 ? 1 : 0),
      sixes: inn.sixes + (o.boundary === 6 ? 1 : 0),
      battingCards,
      bowlingCards,
      fallOfWickets: outPlayer ? [...inn.fallOfWickets, { wicket: wickets, runs, balls, batter: outPlayer.name }] : inn.fallOfWickets,
    };
    this.history.push(o);
    this.lastOutcome = o;
    const def = this.cycle?.delivery?.type;
    if (def) this.fatigue.set(bowler.id, fatigueAfterBall(this.bowlerFatigue, bowler.bowling.stamina, def));
    if (legal) this.ballsThisOver += 1;
    this.runsThisOver += runsTotal;
    const mark = o.wicket ? 'W' : o.wide ? `${o.extras}wd` : o.noBall ? `${o.runs + o.extras}nb` : o.runs === 0 ? '•' : String(o.runs);
    this.recent = [...this.recent, mark].slice(-8);
    this.emit();
  }

  private afterBall(): void {
    const o = this.lastOutcome;
    this.cycle = undefined;
    if (o) {
      // Odd completed runs (not boundaries) mean the batters changed ends.
      if (o.runs % 2 === 1 && !o.boundary) this.swapStrike();
      if (o.wicket) this.replaceBatter(o);
    }
    if (this.inningsOver()) return;
    if (this.ballsThisOver >= 6) this.endOver();
    this.enterBetween();
  }

  private replaceBatter(o: BallOutcome): void {
    const w = o.wicket;
    if (!w) return;
    const xi = this.battingSide.xi;
    if (this.nextIndex >= xi.length) return; // all out; handled by inningsOver
    // Strike has already been swapped for odd completed runs, so the batter who
    // started the ball as striker is now at the striker's index only if the runs were even.
    const outIsStriker = (w.batter === 'striker') === (o.runs % 2 === 0);
    const incoming = this.nextIndex;
    this.nextIndex += 1;
    const inn = this.current;
    this.innings[this.innings.length - 1] = {
      ...inn,
      battingCards: inn.battingCards.map((c, i) => (i === incoming ? { ...c, batted: true } : c)),
    };
    if (w.kind === 'caught') {
      // Law 18.11: the incoming batter takes strike after a catch.
      const survivor = outIsStriker ? this.nonStrikerIndex : this.strikerIndex;
      this.strikerIndex = incoming;
      this.nonStrikerIndex = survivor;
      return;
    }
    if (outIsStriker) this.strikerIndex = incoming;
    else this.nonStrikerIndex = incoming;
  }

  private inningsOver(): boolean {
    const inn = this.current;
    const total = this.config.overs * 6;
    let reason: InningsState['endReason'];
    if (inn.target !== undefined && inn.runs >= inn.target) reason = 'target';
    else if (inn.wickets >= 10 || this.nextIndex > this.battingSide.xi.length) reason = 'allOut';
    else if (inn.balls >= total) reason = 'overs';
    if (!reason) return false;
    this.innings[this.innings.length - 1] = { ...inn, endReason: reason };
    if (this.innings.length === 1) {
      this.phase = 'inningsBreak';
      this.phaseTimer = AUTO_BREAK;
      this.needsBowlerChoice = true;
    } else {
      this.result = this.decide();
      this.phase = 'complete';
    }
    this.emit();
    return true;
  }

  private decide(): MatchResult {
    const [first, second] = this.innings;
    if (!first || !second) throw new Error('match incomplete');
    const name = (s: SideId) => this.side(s).team.name;
    if (second.runs > first.runs) {
      const wkts = 10 - second.wickets;
      const left = this.config.overs * 6 - second.balls;
      const margin = `by ${wkts} wicket${wkts === 1 ? '' : 's'}${left > 0 ? ` (${left} ball${left === 1 ? '' : 's'} left)` : ''}`;
      return { winner: second.batting, tie: false, margin, summary: `${name(second.batting)} won ${margin}` };
    }
    if (second.runs === first.runs) return { tie: true, margin: '', summary: 'Match tied' };
    const by = first.runs - second.runs;
    const margin = `by ${by} run${by === 1 ? '' : 's'}`;
    return { winner: first.batting, tie: false, margin, summary: `${name(first.batting)} won ${margin}` };
  }

  private endOver(): void {
    const inn = this.current;
    if (this.runsThisOver === 0) {
      this.innings[this.innings.length - 1] = {
        ...inn,
        bowlingCards: inn.bowlingCards.map((c) => (c.player.id === this.bowlerId ? { ...c, maidens: c.maidens + 1 } : c)),
      };
    }
    this.ballsThisOver = 0;
    this.runsThisOver = 0;
    this.swapStrike();
    this.lastOverBowlerId = this.bowlerId;
    for (const p of this.bowlingSide.xi) {
      if (p.id !== this.bowlerId) this.fatigue.set(p.id, fatigueAfterRest(this.fatigue.get(p.id) ?? 0));
    }
    this.recent = [];
    if (this.humanBowling) {
      this.needsBowlerChoice = true;
    } else {
      this.bowlerId = this.suggestedBowler().id;
    }
  }

  private swapStrike(): void {
    const s = this.strikerIndex;
    this.strikerIndex = this.nonStrikerIndex;
    this.nonStrikerIndex = s;
  }

  private card(p: Player): BowlingCard | undefined {
    return this.current.bowlingCards.find((c) => c.player.id === p.id);
  }

  /** The fielding side: designated keeper behind the stumps, bowler following through, the rest by catching ability. */
  get field(): Fielder[] {
    return this.cycle?.opts.field.slice() ?? this.buildField(this.bowler);
  }

  private buildField(bowler: Player): Fielder[] {
    const keeper = this.keeperOf(this.current.bowling);
    const others = this.bowlingSide.xi
      .filter((p) => p.id !== bowler.id && p.id !== keeper.id)
      .slice()
      .sort((a, b) => b.fielding.catching - a.fielding.catching);
    const hand = this.striker.battingHand;
    const [wk] = buildField([keeper], STANDARD_FIELD.filter((p) => p.id === 'wk'), hand);
    const ring = buildField(others, STANDARD_FIELD.filter((p) => p.id !== 'wk'), hand);
    const [bowlerSpot] = buildField([bowler], [BOWLER_FOLLOW_THROUGH], hand);
    return [...(wk ? [wk] : []), ...ring, ...(bowlerSpot ? [bowlerSpot] : [])];
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

function defaultSetup(bowler: Player): BowlingSetup {
  const spinner = isSpinner(bowler.bowlingStyle);
  const type: DeliveryTypeId = spinner ? (bowler.bowlingStyle === 'offSpin' ? 'offBreak' : 'legBreak') : 'fast';
  return { type, line: 0.12, length: spinner ? 4.3 : LENGTHS.good };
}

export const oversText = (balls: number): string => `${Math.floor(balls / 6)}.${balls % 6}`;

function at(xi: readonly Player[], i: number): Player {
  const p = xi[i];
  if (!p) throw new Error(`No player at ${i}`);
  return p;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
