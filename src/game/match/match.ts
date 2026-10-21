import { FixedStepClock } from '../core/fixedStep.ts';
import { Rng } from '../core/rng.ts';
import { BOWLER_FOLLOW_THROUGH, STANDARD_FIELD } from '../data/fieldPositions.ts';
import { AdaptiveBowling, ballReward } from '../ai/adaptiveBowling.ts';
import { fieldingPhase, setField, type WagonShot } from '../ai/captain.ts';
import { type BallRecord, type CoachNote, battingNotes, bowlingNotes } from '../ai/coach.ts';
import { Commentator, type CommentaryLine } from '../ai/commentary.ts';
import { SHOTS, type ShotAttempt } from '../batting/shots.ts';
import { PITCHES, type PitchId } from '../data/pitches.ts';
import type { Team } from '../data/teams.ts';
import { chooseDelivery } from '../ai/bowlingAi.ts';
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

export type MatchPhase = 'between' | 'review' | 'chooseBowler' | 'aiming' | 'delivery' | 'inningsBreak' | 'complete';

/**
 * The pause after a ball when a human is playing: the game waits for a key
 * press before the next delivery, and after a wicket or the end of an over
 * shows what happened (the dismissal, the over) with the scorecard.
 */
export type Review =
  | { readonly kind: 'start' }
  | { readonly kind: 'ball' }
  | {
      readonly kind: 'wicket';
      readonly batter: BattingCard;
      readonly fall: FallOfWicket;
      readonly partnership: { readonly runs: number; readonly balls: number };
      readonly next: string | undefined;
      /** The over also ended with this ball. */
      readonly over?: OverSummary;
    }
  | { readonly kind: 'over'; readonly over: OverSummary };

export interface OverSummary {
  /** Overs completed in the innings (1-based number of the over just bowled). */
  readonly number: number;
  readonly bowler: string;
  readonly figures: BowlingCard | undefined;
  readonly balls: readonly string[];
  readonly runs: number;
}

/** How fast the game runs relative to real time (the simulation itself is unchanged). */
export const GAME_SPEEDS = { relaxed: 0.65, normal: 0.8, real: 1 } as const;
export type GameSpeed = keyof typeof GAME_SPEEDS;

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
  /** Set while phase is 'review'. */
  review: Review | undefined;
  /** Real-time multiplier (see GAME_SPEEDS). */
  speed = 1;
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
  /** Ball-by-ball record for the coach. */
  readonly log: BallRecord[] = [];
  /** Commentary, newest last (the last 60 lines). */
  readonly commentary: CommentaryLine[] = [];
  private readonly commentator: Commentator;
  /** The computer's attack, learning the human batters. */
  private readonly brain = new AdaptiveBowling();
  private pendingPlan: { batterId: string; planId: string; insight?: string | undefined } | undefined;
  /** What the captain was protecting for each batter, to notice field changes. */
  private readonly protecting = new Map<string, string>();
  private fieldChange: string | undefined;
  /** The batter who came in after the last wicket. */
  private incoming: string | undefined;
  private fieldCache: { key: string; decision: ReturnType<typeof setField> } | undefined;
  private announcedOver = -1;

  constructor(config: MatchConfig) {
    if (config.home.xi.length !== 11 || config.away.xi.length !== 11) throw new Error('Each side needs exactly 11 players');
    this.config = config;
    this.rng = new Rng(config.seed);
    this.commentator = new Commentator(config.seed);
    this.startInnings(config.battingFirst);
    this.setup = defaultSetup(this.bowler);
    if (this.humanInvolved) this.waitForStart();
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
    const steps = this.clock.advance(frameSeconds * this.speed);
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
      case 'review':
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

  /**
   * Move on: from the review to the next ball, or skip the rest of a dead
   * ball's pause. Returns whether anything happened.
   */
  next(): boolean {
    if (this.paused) return false;
    if (this.phase === 'review') {
      this.review = undefined;
      this.enterBetween();
      return true;
    }
    if (this.phase === 'delivery' && this.cycle?.phase === 'dead' && this.cycle.outcome) {
      this.afterBall();
      return true;
    }
    return false;
  }

  private waitForStart(): void {
    this.review = { kind: 'start' };
    this.phase = 'review';
    this.emit();
  }

  /** A human is playing (so the game waits for them between balls). */
  get humanInvolved(): boolean {
    return this.humanBatting || this.humanBowling;
  }

  /** Start the second innings after the break. */
  continueAfterBreak(): void {
    if (this.phase !== 'inningsBreak') return;
    const first = this.current;
    this.startInnings(first.bowling, first.runs + 1);
    if (this.humanInvolved) this.waitForStart();
    else this.enterBetween();
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
    const rng = this.rng.fork(`bowl-ai-${this.ballNumber}`);
    const difficulty = DIFFICULTIES[this.config.difficulty];
    if (this.humanBatting) {
      // Against the human: an attack that learns what works against each batter.
      const phase = fieldingPhase(this.config.overs, this.current.balls);
      const d = this.brain.choose(this.bowler, this.striker, phase === 'powerplay' ? 0 : phase === 'middle' ? 1 : 2, difficulty, rng);
      this.pendingPlan = { batterId: this.striker.id, planId: d.planId, insight: d.insight };
      this.startCycle(d.plan, d.releaseQuality);
      return;
    }
    const d = chooseDelivery(this.bowler, difficulty, rng);
    this.startCycle(d.plan, d.releaseQuality);
  }

  private needsBowlerChoice = true;

  private startCycle(plan: BowlingSetup, releaseQuality?: number): void {
    const bowler = this.bowler;
    const overNumber = this.innings.length * 1000 + Math.floor(this.current.balls / 6);
    if (this.ballsThisOver === 0 && this.announcedOver !== overNumber) {
      this.announcedOver = overNumber;
      const bowled = (this.card(bowler)?.balls ?? 0) > 0;
      if (!bowled) this.say(this.commentator.newBowler(bowler.name, this.current.balls === 0));
    }
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
    const ballsLeft = Math.max(1, total - inn.balls);
    const required = inn.target === undefined ? 0 : ((inn.target - inn.runs) / ballsLeft) * 6;
    if (this.config.overs <= 20) {
      // T20 (or shorter): positive from the start, all-out attack at the death.
      if (inn.target === undefined) return clamp(1.05 + 0.5 * progress - caution, -0.2, 1.6);
      return clamp(0.75 + (required - 7.5) / 4 - caution * 0.5, -0.3, 1.6);
    }
    // One-day: build, then accelerate.
    if (inn.target === undefined) return clamp(0.75 + 0.65 * progress - caution, -0.3, 1.4);
    return clamp(0.75 + (required - 5.8) / 3.5 - caution * 0.5, -0.3, 1.4);
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
    this.strikerAt.push(striker.id);
    this.lastOutcome = o;
    const def = this.cycle?.delivery?.type;
    if (def) this.fatigue.set(bowler.id, fatigueAfterBall(this.bowlerFatigue, bowler.bowling.stamina, def));
    if (legal) this.ballsThisOver += 1;
    this.runsThisOver += runsTotal;
    const mark = o.wicket ? 'W' : o.wide ? `${o.extras}wd` : o.noBall ? `${o.runs + o.extras}nb` : o.runs === 0 ? '•' : String(o.runs);
    this.recent = [...this.recent, mark].slice(-8);
    this.learnAndDescribe(o, striker, bowler, updatedCard, legal);
    this.emit();
  }

  /** Feeds the ball to the coach's log and the learning attack, and commentates it. */
  private learnAndDescribe(o: BallOutcome, striker: Player, bowler: Player, bowlerCard: BowlingCard, legal: boolean): void {
    const c = this.cycle;
    const typeId = c?.delivery?.type.id ?? 'fast';
    const events = c?.events ?? [];
    const pad = events.find((e) => e.type === 'pad' || e.type === 'body');
    const beaten = o.contact?.kind === 'miss' || events.some((e) => e.type === 'beaten');
    this.log.push({
      innings: this.innings.length - 1,
      humanBatting: this.humanBatting,
      humanBowling: this.humanBowling,
      deliveryType: typeId,
      deliveryName: o.delivery.name,
      speedKph: o.delivery.speedKph,
      length: o.delivery.length,
      shot: o.shot?.shot,
      shotName: o.shot ? SHOTS[o.shot.shot].name : undefined,
      footwork: o.shot?.footwork,
      contact: o.contact?.kind,
      timingMs: o.timingMs,
      runs: o.runs,
      extras: o.extras,
      wide: o.wide,
      noBall: o.noBall,
      wicket: o.wicket?.kind,
      legal,
    });
    const plan = this.pendingPlan;
    this.pendingPlan = undefined;
    if (plan) this.brain.learn(plan.batterId, plan.planId, ballReward({ runs: o.runs, extras: o.extras, wicket: o.wicket !== undefined && o.wicket.kind !== 'runOut', beaten }));

    const inn = this.current;
    const card = (p: Player) => inn.battingCards.find((b) => b.player.id === p.id);
    const outName = o.wicket ? (o.wicket.batter === 'nonStriker' ? this.nonStriker.name : striker.name) : undefined;
    const outCard = o.wicket ? inn.battingCards.find((b) => b.player.name === outName) : undefined;
    const overComplete = legal && this.ballsThisOver >= 6;
    const chase = this.chase;
    const fieldChange = this.fieldChange;
    this.fieldChange = undefined;
    this.say(
      this.commentator.ball({
        bowler: bowler.name,
        batter: striker.name,
        delivery: o.delivery,
        pace: !isSpinner(bowler.bowlingStyle),
        shot: o.shot ? SHOTS[o.shot.shot].name : undefined,
        contact: o.contact?.kind,
        directionDeg: o.contact && o.contact.kind !== 'miss' && o.contact.kind !== 'leave' ? o.contact.directionDeg : undefined,
        elevationDeg: o.contact?.elevationDeg,
        runs: o.runs,
        extras: o.extras,
        wide: o.wide,
        noBall: o.noBall,
        boundary: o.boundary,
        wicket: o.wicket && outName ? { kind: o.wicket.kind, fielder: o.wicket.fielder, out: outName } : undefined,
        notOutLbw: pad && pad.type !== 'pad' ? undefined : pad && !pad.lbw.out && !o.wicket && o.runs === 0 ? pad.lbw.reason : undefined,
        padded: pad !== undefined,
        batterRuns: card(striker)?.runs ?? 0,
        batterBalls: card(striker)?.balls ?? 0,
        outBatterRuns: outCard?.runs,
        bowlerWickets: bowlerCard.wickets,
        total: { runs: inn.runs, wickets: inn.wickets },
        overComplete,
        overRuns: this.runsThisOver,
        chase: chase && overComplete ? { team: this.battingSide.team.name, needed: chase.needed, balls: chase.ballsLeft } : undefined,
        insight: plan?.insight,
        fieldChange,
      }),
    );
  }

  private say(line: CommentaryLine): void {
    this.commentary.push(line);
    if (this.commentary.length > 60) this.commentary.splice(0, this.commentary.length - 60);
  }

  /** The coach's notes for the human side, from this match so far. */
  coachNotes(): { batting: CoachNote[]; bowling: CoachNote[] } {
    return { batting: battingNotes(this.log), bowling: bowlingNotes(this.log) };
  }

  /** What the computer's attack has learned about a batter (best plans first). */
  scoutingReport(batter: Player): { label: string; mean: number; n: number }[] {
    const bowler = this.bowlingSide.xi.find((p) => !isSpinner(p.bowlingStyle) && p.bowlingStyle !== 'none') ?? this.bowler;
    const phase = fieldingPhase(this.config.overs, this.current.balls);
    return this.brain.report(batter, bowler, phase === 'powerplay' ? 0 : phase === 'middle' ? 1 : 2).map((r) => ({ label: r.plan.label, mean: r.mean, n: r.n }));
  }

  /** The striker's scoring shots this match, batter-relative (for the captain). */
  private wagon(batter: Player): WagonShot[] {
    const out: WagonShot[] = [];
    this.history.forEach((o, i) => {
      if (this.strikerAt[i] !== batter.id || o.runs === 0 || !o.contact || o.contact.kind === 'miss' || o.contact.kind === 'leave') return;
      out.push({ directionDeg: o.contact.directionDeg, runs: o.runs });
    });
    return out;
  }

  /** Who was on strike for each ball in `history`. */
  private readonly strikerAt: string[] = [];

  private afterBall(): void {
    const o = this.lastOutcome;
    this.cycle = undefined;
    this.incoming = undefined;
    if (o) {
      // Odd completed runs (not boundaries) mean the batters changed ends.
      if (o.runs % 2 === 1 && !o.boundary) this.swapStrike();
      if (o.wicket) this.replaceBatter(o);
    }
    if (this.inningsOver()) return;
    let over: OverSummary | undefined;
    if (this.ballsThisOver >= 6) {
      const bowler = this.bowler;
      const balls = this.recent.slice();
      const runs = this.runsThisOver;
      this.endOver();
      // Figures after the over is closed, so a maiden is counted.
      over = { number: Math.floor(this.current.balls / 6), bowler: bowler.name, figures: this.card(bowler), balls, runs };
    }
    if (!this.humanInvolved) {
      this.enterBetween();
      return;
    }
    // Wait for the player: show the wicket or the over, or just prompt for the next ball.
    const inn = this.current;
    const fall = inn.fallOfWickets[inn.fallOfWickets.length - 1];
    if (o?.wicket && fall && fall.wicket === inn.wickets && fall.balls === inn.balls) {
      const batter = inn.battingCards.find((c) => c.player.name === fall.batter);
      const prev = inn.fallOfWickets[inn.fallOfWickets.length - 2];
      this.review = batter
        ? {
            kind: 'wicket',
            batter,
            fall,
            partnership: { runs: fall.runs - (prev?.runs ?? 0), balls: fall.balls - (prev?.balls ?? 0) },
            next: this.incoming,
            ...(over ? { over } : {}),
          }
        : { kind: 'ball' };
    } else if (over) {
      this.review = { kind: 'over', over };
    } else {
      this.review = { kind: 'ball' };
    }
    this.phase = 'review';
    this.emit();
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
    this.incoming = xi[incoming]?.name;
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
      const done = this.current;
      this.say(this.commentator.inningsBreak(this.side(done.batting).team.name, done.runs, done.wickets, done.runs + 1, this.side(done.bowling).team.name));
    } else {
      this.result = this.decide();
      this.phase = 'complete';
      this.say(this.commentator.result(this.result.summary));
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
    // The AI captain sets the field for this batter and bowler, reviewing it at the start of each
    // over and when a new batter comes in — not every ball, so fielders are not forever moving.
    const key = `${this.innings.length}-${Math.floor(this.current.balls / 6)}-${this.striker.id}-${bowler.id}`;
    let decision = this.fieldCache?.key === key ? this.fieldCache.decision : undefined;
    if (!decision) {
      decision = setField({
        overs: this.config.overs,
        ballsBowled: this.current.balls,
        spinner: isSpinner(bowler.bowlingStyle),
        wagon: this.wagon(this.striker),
      });
      this.fieldCache = { key, decision };
    }
    if (decision.protecting && this.protecting.get(this.striker.id) !== decision.protecting) {
      this.protecting.set(this.striker.id, decision.protecting);
      this.fieldChange = decision.protecting;
    }
    const [wk] = buildField([keeper], STANDARD_FIELD.filter((p) => p.id === 'wk'), hand);
    const ring = buildField(others, decision.positions, hand);
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
