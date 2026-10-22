import { FixedStepClock } from '../core/fixedStep.ts';
import { type WeatherId, pitchInConditions } from '../data/weather.ts';
import { decodeInto, encodeSnapshot, playersOf, snapshotMatch } from './save.ts';
import { type ChallengeId, type ChallengeStatus, challenge, markCompleted } from '../practice/challenges.ts';
import type { VenueId } from '../data/venues.ts';
import { Rng } from '../core/rng.ts';
import { BOWLER_FOLLOW_THROUGH, type FieldPosition, STANDARD_FIELD } from '../data/fieldPositions.ts';
import { STRIKER_STUMPS_Z } from '../data/field.ts';
import { AdaptiveBowling, ballReward } from '../ai/adaptiveBowling.ts';
import { fieldingPhase, maxOutside, setField, type WagonShot } from '../ai/captain.ts';
import { type BallRecord, type CoachNote, battingNotes, bowlingNotes } from '../ai/coach.ts';
import { Commentator, type CommentaryLine } from '../ai/commentary.ts';
import { SHOTS, type ShotAttempt } from '../batting/shots.ts';
import { type BatterState, confidenceAfter, fatigueAfter, rested, startingConfidence } from '../batting/form.ts';
import type { ContactResult } from '../batting/contact.ts';
import { PITCHES, type PitchId } from '../data/pitches.ts';
import type { Team } from '../data/teams.ts';
import { chooseDelivery } from '../ai/bowlingAi.ts';
import { DELIVERY_TYPES, type DeliveryTypeId, LENGTHS, humanDeliveries } from '../bowling/deliveryTypes.ts';
import type { DeliveryPlan } from '../bowling/execute.ts';
import type { BowlingSide } from '../bowling/runUp.ts';
import { type FieldPreset, checkField, customPosition, findPreset, legalPresets } from '../fielding/presets.ts';
import { fatigueAfterBall, fatigueAfterRest } from '../bowling/fatigue.ts';
import { type Fielder, buildField, rebuildField } from '../fielding/plan.ts';
import { DIFFICULTIES, type DifficultyId } from '../model/difficulty.ts';
import { type Player, isSpinner, offSideSign } from '../model/player.ts';
import { type BallOutcome, DeliveryCycle, type WicketKind } from '../session/deliveryCycle.ts';
import { type Decision, type LbwTracking, REVIEWS_PER_INNINGS, REVIEW_WINDOW, type ReviewResult, review, reviewConfidence } from '../simulation/tracking.ts';

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
  /** Conditions (default sunny): swing, seam and grip, and dew in the second innings under lights. */
  readonly weather?: WeatherId;
  /** The ground (only how it looks). */
  readonly venue?: VenueId;
  /** A practice challenge: one innings of one over, ending as soon as it is won or lost. */
  readonly practice?: ChallengeId;
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
  /** Balls faced that scored nothing. */
  readonly dots: number;
  readonly batted: boolean;
  readonly dismissal?: Dismissal;
}

export interface BowlingCard {
  readonly player: Player;
  readonly balls: number;
  readonly runs: number;
  readonly wickets: number;
  readonly maidens: number;
  /** Legal balls that cost nothing. */
  readonly dots: number;
  readonly wides: number;
  readonly noBalls: number;
  readonly fours: number;
  readonly sixes: number;
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
  /** Byes and leg byes (runs). */
  readonly byes?: number;
  readonly legByes?: number;
  readonly fours: number;
  readonly sixes: number;
  readonly battingCards: readonly BattingCard[];
  readonly bowlingCards: readonly BowlingCard[];
  readonly fallOfWickets: readonly FallOfWicket[];
  /** Runs and wickets in each over so far (the current over last). */
  readonly overs: readonly { readonly runs: number; readonly wickets: number }[];
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

/**
 * The human bowler's choices for the next ball: the delivery, where it
 * should land (the marker: metres from middle stump towards the batter's off
 * side, and metres in front of the striker's stumps), the side of the
 * wicket, and how much swing / cut / spin.
 */
export interface BowlingSetup {
  readonly type: DeliveryTypeId;
  readonly line: number;
  readonly length: number;
  readonly side: BowlingSide;
  readonly amount: number;
}

/**
 * Steps of bowling a ball as a human: pick the delivery, then place and
 * lock the landing marker; the run-up follows, where the pace is locked on
 * the meter and the amount can still be changed.
 */
export type AimStep = 'type' | 'target';

/** The ball's outcome after a review: the decision as the third umpire left it, with a headline to match. */
export function reviewedOutcome(o: BallOutcome, r: ReviewResult, by: string): BallOutcome {
  const { wicket: _old, review: _r, ...rest } = o;
  void _old;
  void _r;
  const why = r.umpiresCall ? "umpire's call" : r.overturned ? 'overturned' : 'the decision stands';
  const kept = r.retained ? `${by} keep their review.` : `${by} lose a review.`;
  if (r.decision === 'out') {
    // Out: any leg byes run off the pad don't count.
    const { legByes: lb, overthrows: _ov, ...noRuns } = rest;
    void _ov;
    return {
      ...noRuns,
      extras: rest.extras - (lb ?? 0),
      wicket: { kind: 'lbw', batter: 'striker' },
      headline: r.overturned ? 'OUT! Overturned on review' : 'OUT — the decision stands',
      detail: `${r.overturned ? 'Ball tracking has it hitting the stumps.' : r.umpiresCall ? "Umpire's call: out stands." : 'Hitting the stumps.'} ${kept}`,
      review: { by, overturned: r.overturned, umpiresCall: r.umpiresCall, why },
    };
  }
  return {
    ...rest,
    headline: r.overturned ? 'NOT OUT! Overturned on review' : 'NOT OUT — the decision stands',
    detail: `${r.overturned ? 'Ball tracking has it missing.' : r.umpiresCall ? "Umpire's call: not out stands." : 'Missing the stumps.'} ${kept}`,
    review: { by, overturned: r.overturned, umpiresCall: r.umpiresCall, why },
  };
}

/** The innings' runs and wickets by over, with a ball added to over `index`. */
function addToOver(overs: InningsState['overs'], index: number, runs: number, wickets: number): InningsState['overs'] {
  const next = overs.slice();
  while (next.length <= index) next.push({ runs: 0, wickets: 0 });
  const o = next[index] ?? { runs: 0, wickets: 0 };
  next[index] = { runs: o.runs + runs, wickets: o.wickets + wickets };
  return next;
}

/** Autoplay: off, the rest of the over, or the rest of the innings. */
export type Autoplay = 'off' | 'over' | 'innings';

/**
 * 'appeal': an lbw decision the losing side may review (15 s); 'drs': the
 * third umpire looking at the ball tracking.
 */
export type MatchPhase = 'between' | 'review' | 'chooseBowler' | 'aiming' | 'delivery' | 'appeal' | 'drs' | 'inningsBreak' | 'complete';

/** An lbw decision open to review. */
export interface PendingAppeal {
  readonly outcome: BallOutcome;
  readonly onField: Decision;
  readonly tracking: LbwTracking;
  /** The side that can review: the batting side if given out, the fielding side if not. */
  readonly reviewer: SideId;
  /** Seconds since the decision. */
  waited: number;
}

/** A review in progress, and how it came out. */
export interface DrsReview {
  readonly appeal: PendingAppeal;
  readonly result: ReviewResult;
  /** Seconds into the third umpire's review (the graphic plays through). */
  t: number;
}

/** How long the third umpire's review is shown, seconds, and when each verdict appears. */
export const DRS_SHOW = 9.5;
export const DRS_TIMES = { pitching: 2.6, impact: 3.6, wickets: 6.2, decision: 7.2 } as const;
/** The tracking replay: the ball to the impact, then the projection to the stumps (seconds into the review). */
export const DRS_PATH = { start: 0.6, impact: 3.4, stumps: 6.0 } as const;
/** How long a computer side takes to decide whether to review, seconds. */
const AI_REVIEW_THINK = 1.4;

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

export const LINE_RANGE = { min: -0.75, max: 1.1 } as const;
export const LENGTH_RANGE = { min: 0.3, max: 12.5 } as const;
const BETWEEN_BALLS = 0.9;
const AUTO_BREAK = 3;

/** Runs the batters actually ran (or hit) on a ball: off the bat, byes and leg byes (wides and no-balls aside). */
export function ranRuns(o: BallOutcome): number {
  return o.runs + (o.byes ?? 0) + (o.legByes ?? 0) + (o.wide ? Math.max(0, o.extras - 1) : 0);
}

/** Super overs played before a tie is left a tie. */
const MAX_SUPER_OVERS = 3;

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
  /** Which step of setting up the ball the human bowler is on (phase 'aiming'). */
  aimStep: AimStep = 'type';
  /** The human captain's field: a preset id, or 'auto' for the AI captain's field. */
  fieldPreset = 'auto';
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
  /** The next ball is a free hit (after a no-ball). */
  freeHit = false;
  /** Each bowler's wickets with his last consecutive deliveries (two: the next is a hat-trick ball). */
  private readonly wicketStreak = new Map<string, number>();

  /** The current bowler is on a hat-trick. */
  get hatTrickBall(): boolean {
    return (this.wicketStreak.get(this.bowler.id) ?? 0) === 2;
  }
  private bouncersThisOver = 0;
  private readonly fatigue = new Map<string, number>();
  /** Each batter's confidence and tiredness this innings (see batting/form.ts). */
  private readonly form = new Map<string, BatterState>();
  /** Bowlers' current spells: overs in a row (every other over) and the last over they bowled. */
  private readonly spells = new Map<string, { overs: number; last: number }>();
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

  /** A human is batting (and not handing the controls to the computer on autoplay). */
  get humanBatting(): boolean {
    return !this.autoplayActive && this.battingSide.controller === 'human';
  }

  /** A human is bowling (and not handing the controls to the computer on autoplay). */
  get humanBowling(): boolean {
    return !this.autoplayActive && this.bowlingSide.controller === 'human';
  }

  /** The human's side is batting or bowling in this innings (whether or not on autoplay). */
  get userSide(): 'batting' | 'bowling' | undefined {
    if (this.battingSide.controller === 'human') return 'batting';
    if (this.bowlingSide.controller === 'human') return 'bowling';
    return undefined;
  }

  // --- Autoplay ------------------------------------------------------------------------

  private autoplayMode: Autoplay = 'off';
  /** The computer is playing the human's side for the current ball. */
  private autoplayActive = false;
  /** Autoplay of an over stops when this many legal balls of the innings have been bowled. */
  private autoplayUntil = 0;
  private autoplayInnings = 0;

  /** What the computer has been asked to play for the human: nothing, the rest of the over, or the innings. */
  get autoplay(): Autoplay {
    return this.autoplayMode;
  }

  /** Whether the computer is playing the current ball for the human. */
  get autoplaying(): boolean {
    return this.autoplayActive;
  }

  // --- Moments ---------------------------------------------------------------------------

  /** A batter reached fifty or a hundred on the last ball (cleared when the next ball starts). */
  milestone: { readonly batterId: string; readonly name: string; readonly runs: 50 | 100; readonly balls: number; readonly ball: number } | undefined;
  /** The batter out on the last ball, walking off (until the next ball starts). */
  departing: { readonly id: string; readonly ball: number } | undefined;

  // --- Reviews (DRS) ---------------------------------------------------------------------

  /** The lbw decision open to review, if any. */
  appeal: PendingAppeal | undefined;
  /** The review in progress, if any. */
  drs: DrsReview | undefined;
  /** Unsuccessful reviews each side has left this innings. */
  reviewsLeft: Record<SideId, number> = { home: REVIEWS_PER_INNINGS, away: REVIEWS_PER_INNINGS };

  /** Whether the human decides on this review (not the computer, not on autoplay). */
  humanReviews(a: PendingAppeal): boolean {
    const side = this.side(a.reviewer);
    return side.controller === 'human' && !this.autoplayActive;
  }

  /** A ball is over: an lbw appeal the losing side can still review waits for them; anything else is scored. */
  private ballDead(o: BallOutcome): void {
    const a = o.appeal;
    if (a) {
      const reviewer: SideId = a.onField === 'out' ? this.current.batting : this.current.bowling;
      if (this.reviewsLeft[reviewer] > 0) {
        this.appeal = { outcome: o, onField: a.onField, tracking: a.tracking, reviewer, waited: 0 };
        this.phase = 'appeal';
        this.emit();
        return;
      }
    }
    this.record(o);
  }

  /** Take it upstairs: the third umpire reviews the decision. */
  requestReview(): boolean {
    const a = this.appeal;
    if (this.phase !== 'appeal' || !a || this.paused) return false;
    const result = review(a.onField, a.tracking);
    if (!result.retained) this.reviewsLeft[a.reviewer] = Math.max(0, this.reviewsLeft[a.reviewer] - 1);
    this.drs = { appeal: a, result, t: 0 };
    this.appeal = undefined;
    this.phase = 'drs';
    this.emit();
    return true;
  }

  /** Accept the umpire's decision (or let the review window run out). */
  acceptDecision(): boolean {
    const a = this.appeal;
    if (this.phase !== 'appeal' || !a) return false;
    this.appeal = undefined;
    this.phase = 'delivery';
    this.record(a.outcome);
    return true;
  }

  /** The third umpire's decision is in: the ball is scored with it. */
  private finishReview(): void {
    const r = this.drs;
    if (!r) return;
    this.drs = undefined;
    this.phase = 'delivery';
    this.record(reviewedOutcome(r.appeal.outcome, r.result, this.side(r.appeal.reviewer).team.shortName));
  }

  /**
   * Hand the human's side to the computer for the rest of this over (or the
   * next over, between overs) or for the rest of the innings. It takes over
   * from the next ball; one in progress is finished by the player.
   */
  startAutoplay(mode: Exclude<Autoplay, 'off'>): boolean {
    if (!this.userSide || this.phase === 'inningsBreak' || this.phase === 'complete') return false;
    const balls = this.current.balls;
    // Mid-over: to the end of it. Between overs (or before the first ball): the whole next over.
    const midOver = this.ballsThisOver > 0;
    this.autoplayMode = mode;
    this.autoplayInnings = this.inningsIndex;
    this.autoplayUntil = mode === 'over' ? balls + (midOver ? 6 - this.ballsThisOver : 6) : Number.POSITIVE_INFINITY;
    if (this.phase === 'review') {
      this.review = undefined;
      this.enterBetween();
    } else if (this.phase === 'aiming' || this.phase === 'chooseBowler') {
      // The human was setting up a ball: the computer bowls it instead.
      this.beginBall();
    } else {
      this.emit();
    }
    return true;
  }

  /** Take the controls back: the computer finishes the ball in progress, the player has the next. */
  stopAutoplay(): void {
    if (this.autoplayMode === 'off') return;
    this.autoplayMode = 'off';
    this.emit();
  }

  /** At the start of each ball: whether the computer plays it for the human. */
  private updateAutoplay(): void {
    const wasActive = this.autoplayActive;
    if (this.autoplayMode !== 'off' && (this.inningsIndex !== this.autoplayInnings || this.current.balls >= this.autoplayUntil)) this.autoplayMode = 'off';
    this.autoplayActive = this.autoplayMode !== 'off';
    // Back in control of the ball: start from the current bowler's stock ball.
    if (wasActive && !this.autoplayActive && this.humanBowling) this.setup = defaultSetup(this.bowler);
  }

  private endAutoplay(): void {
    this.autoplayMode = 'off';
    this.autoplayActive = false;
  }

  /** Runs still needed and balls left, in the chase. */
  get chase(): { needed: number; ballsLeft: number } | undefined {
    const t = this.current.target;
    if (t === undefined) return undefined;
    return { needed: Math.max(0, t - this.current.runs), ballsLeft: this.inningsOvers * 6 - this.current.balls };
  }

  /**
   * The human bowler's pace meter during the run-up, 0–1: rises and falls
   * (a triangle wave) until Space locks it. Higher is faster; above 0.9 is
   * flat out, which costs control.
   */
  get meter(): number {
    const c = this.cycle;
    if (!c || c.phase !== 'runUp') return 0;
    const period = 1.15;
    const x = (c.time % period) / period;
    return x < 0.5 ? x * 2 : 2 - x * 2;
  }

  /** The deliveries the human can choose from for the current bowler (keys 1–6). */
  get availableDeliveries(): DeliveryTypeId[] {
    return humanDeliveries(this.bowler.bowlingStyle);
  }

  /** Field presets allowed now (the powerplay allows only two outside the circle). */
  get availablePresets(): FieldPreset[] {
    return legalPresets(maxOutside(fieldingPhase(this.config.overs, this.phaseBalls), this.config.overs));
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
    // On autoplay the game moves along at twice the pace.
    const steps = this.clock.advance(frameSeconds * this.speed * (this.autoplayActive ? 2 : 1));
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
        const waiting = c.awaitingThrowSince !== undefined;
        c.step(dt);
        if (before !== 'dead' && c.phase === 'dead' && c.outcome) this.ballDead(c.outcome);
        else if (before !== c.phase || waiting !== (c.awaitingThrowSince !== undefined)) this.emit();
        if (c.finished) this.afterBall();
        break;
      }
      case 'appeal': {
        const a = this.appeal;
        if (!a) break;
        a.waited += dt;
        if (this.humanReviews(a)) {
          if (a.waited >= REVIEW_WINDOW) this.acceptDecision();
        } else if (a.waited >= AI_REVIEW_THINK) {
          // The computer side asks for a review if its players think it is worth it.
          const sure = reviewConfidence(a.onField, a.tracking, this.rng.fork(`review-${this.ballNumber}`));
          if (sure > 0.55) this.requestReview();
          else this.acceptDecision();
        }
        break;
      }
      case 'drs': {
        const r = this.drs;
        if (!r) break;
        r.t += dt;
        if (r.t >= DRS_SHOW) this.finishReview();
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

  /** Changes the direction of the shot just played, within a moment of the key press. */
  reaimShot(shot: ShotAttempt): boolean {
    if (!this.humanBatting || this.paused) return false;
    return this.cycle?.reaimShot(shot) ?? false;
  }

  /** Human batter: call off the run under way ("No! Go back!"). */
  sendBack(): boolean {
    if (!this.humanBatting || this.paused) return false;
    return this.cycle?.sendBack() ?? false;
  }

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

  /**
   * Space / Enter while bowling: confirm the delivery, then lock the marker
   * (the bowler starts his run-up), then lock the pace on the meter.
   */
  bowlButton(): void {
    if (!this.humanBowling || this.paused) return;
    if (this.phase === 'aiming') {
      this.confirmAim();
      return;
    }
    this.lockPace();
  }

  /** Delivery chosen → place the marker; marker placed → run in. */
  confirmAim(): void {
    if (!this.humanBowling || this.paused || this.phase !== 'aiming') return;
    if (this.aimStep === 'type') {
      this.aimStep = 'target';
      this.emit();
      return;
    }
    const s = this.setup;
    this.startCycle({ type: s.type, line: s.line, length: s.length, pitchLine: s.line, side: s.side, amount: s.amount });
  }

  /** Back from placing the marker to choosing the delivery. */
  aimBack(): void {
    if (!this.humanBowling || this.phase !== 'aiming' || this.aimStep !== 'target') return;
    this.aimStep = 'type';
    this.emit();
  }

  /** During the run-up: lock the pace where the meter is now. */
  lockPace(): boolean {
    const c = this.cycle;
    if (!this.humanBowling || this.paused || this.phase !== 'delivery' || !c || c.phase !== 'runUp') return false;
    const ok = c.lockPace(this.meter);
    if (ok) this.emit();
    return ok;
  }

  /** The pace locked for this ball (0–1), if it has been. */
  get lockedPace(): number | undefined {
    const c = this.cycle;
    return c?.releaseLocked ? c.plan.effort : undefined;
  }

  /** Fielding: the ball is in a fielder's hands with the batters running, waiting for the human's throw. */
  get awaitingThrow(): boolean {
    return this.humanBowling && this.phase === 'delivery' && this.cycle?.awaitingThrowSince !== undefined;
  }

  /** Fielding: throw the ball in to the keeper's ('striker') or bowler's end, power 0–1.2. */
  throwBall(end: 'striker' | 'bowler', power: number): boolean {
    if (!this.awaitingThrow || this.paused) return false;
    const ok = this.cycle?.throwBall(end, power) ?? false;
    if (ok) this.emit();
    return ok;
  }

  /** Human captain picks the bowler for the next over. */
  chooseBowler(playerId: string): boolean {
    if (this.phase !== 'chooseBowler') return false;
    const p = this.eligibleBowlers().find((b) => b.id === playerId);
    if (!p) return false;
    this.bowlerId = p.id;
    this.setup = defaultSetup(p);
    this.aimStep = 'type';
    this.phase = 'aiming';
    this.emit();
    return true;
  }

  /** Moves the landing marker (only while placing it). */
  adjustTarget(dLine: number, dLength: number): void {
    if (!this.humanBowling || this.phase !== 'aiming' || this.aimStep !== 'target') return;
    const s = this.setup;
    this.setup = {
      ...s,
      line: clamp(s.line + dLine, LINE_RANGE.min, LINE_RANGE.max),
      length: clamp(s.length + dLength, LENGTH_RANGE.min, LENGTH_RANGE.max),
    };
    this.emit();
  }

  /** Picks a delivery by menu position or id (while choosing it). */
  selectDelivery(type: DeliveryTypeId): boolean {
    if (!this.humanBowling || this.phase !== 'aiming' || !this.availableDeliveries.includes(type)) return false;
    this.setup = { ...this.setup, type };
    this.aimStep = 'type';
    this.emit();
    return true;
  }

  cycleDelivery(direction: 1 | -1): void {
    if (!this.humanBowling || this.phase !== 'aiming') return;
    const options = this.availableDeliveries;
    const i = options.indexOf(this.setup.type);
    const next = options[(i + direction + options.length) % options.length] ?? options[0];
    if (!next) return;
    this.setup = { ...this.setup, type: next };
    this.emit();
  }

  /** Over or around the wicket (before the run-up). */
  toggleSide(): void {
    if (!this.humanBowling || this.phase !== 'aiming') return;
    this.setup = { ...this.setup, side: this.setup.side === 'over' ? 'around' : 'over' };
    this.emit();
  }

  /** More or less swing / cut / spin: while setting up the ball or during the run-up. */
  adjustAmount(delta: number): void {
    if (!this.humanBowling || this.paused) return;
    const c = this.cycle;
    const running = this.phase === 'delivery' && c?.phase === 'runUp';
    if (this.phase !== 'aiming' && !running) return;
    if (DELIVERY_TYPES[this.setup.type].variable === 'none') return;
    const amount = clamp(Math.round((this.setup.amount + delta) * 20) / 20, 0, 1);
    if (amount === this.setup.amount) return;
    this.setup = { ...this.setup, amount };
    if (running) c?.setAmount(amount);
    this.emit();
  }

  /** The human captain's field: a preset, or 'auto' for the AI captain. Cycles through the legal ones. */
  cycleFieldPreset(direction: 1 | -1): void {
    if (!this.humanBowling || (this.phase !== 'aiming' && this.phase !== 'chooseBowler')) return;
    const ids = ['auto', ...this.availablePresets.map((p) => p.id)];
    const i = Math.max(0, ids.indexOf(this.fieldPreset));
    this.fieldPreset = ids[(i + direction + ids.length) % ids.length] ?? 'auto';
    this.emit();
  }

  /** The human captain's own field (nine positions; the keeper and bowler are where they always are). */
  customField: FieldPosition[] | undefined;

  /** Fielders allowed outside the circle at this point of the innings. */
  get maxOutsideNow(): number {
    return maxOutside(fieldingPhase(this.config.overs, this.phaseBalls), this.config.overs);
  }

  /** The nine fielders as they stand now (not the keeper or bowler), as positions for the batter on strike. */
  currentPositions(): FieldPosition[] {
    const left = this.striker.battingHand === 'left';
    return this.field
      .filter((f) => !f.keeper && f.position.id !== 'bowler')
      .map((f, i) => {
        const x = left ? -f.start.x : f.start.x;
        const dz = STRIKER_STUMPS_Z - f.start.z;
        return customPosition(i, (Math.atan2(x, dz) * 180) / Math.PI, Math.hypot(x, dz));
      });
  }

  /** Sets the human captain's own field. Returns what is wrong with it, if it is not allowed. */
  setCustomField(positions: readonly FieldPosition[]): string | undefined {
    if (!this.humanBowling) return 'You are not the fielding captain.';
    if (positions.length !== 9) return 'A field has nine fielders besides the keeper and the bowler.';
    const problem = checkField(positions, this.maxOutsideNow);
    if (problem) return problem;
    this.customField = positions.map((p, i) => customPosition(i, p.angleDeg, p.distance));
    this.fieldPreset = 'custom';
    this.fieldCache = undefined;
    this.emit();
    return undefined;
  }

  setFieldPreset(id: string): boolean {
    if (!this.humanBowling || (this.phase !== 'aiming' && this.phase !== 'chooseBowler')) return false;
    if (id !== 'auto' && !this.availablePresets.some((p) => p.id === id)) return false;
    this.fieldPreset = id;
    this.emit();
    return true;
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
    // Skip the rest of the review graphic.
    if (this.phase === 'drs' && this.drs && this.drs.t > 1) {
      this.finishReview();
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
    const last = this.current;
    // A super over: the side that batted second goes first (no target); otherwise the chase.
    if (this.superOverNext) {
      this.superOverNext = false;
      this.startInnings(last.batting);
    } else this.startInnings(last.bowling, last.runs + 1);
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
      battingCards: xi.map((player, i) => ({ player, runs: 0, balls: 0, fours: 0, sixes: 0, dots: 0, batted: i < 2 })),
      bowlingCards: [],
      fallOfWickets: [],
      overs: [],
      ...(target !== undefined ? { target } : {}),
    });
    this.strikerIndex = 0;
    this.nonStrikerIndex = 1;
    this.nextIndex = 2;
    this.ballsThisOver = 0;
    this.runsThisOver = 0;
    this.lastOverBowlerId = '';
    this.fatigue.clear();
    this.form.clear();
    this.spells.clear();
    xi.slice(0, 2).forEach((p, i) => this.form.set(p.id, { confidence: startingConfidence(p, i), fatigue: 0 }));
    this.recent = [];
    this.fieldPreset = 'auto';
    this.bowlerId = this.suggestedBowler().id;
    // Practice against the quicks: the fastest bowler in the side opens.
    if (this.config.practice === 'survive') {
      const pace = this.bowlingSide.xi.filter((p) => p.bowlingStyle === 'fast' || p.bowlingStyle === 'fastMedium').sort((a, b) => b.bowling.pace - a.bowling.pace)[0];
      if (pace) this.bowlerId = pace.id;
    }
    this.reviewsLeft = { home: REVIEWS_PER_INNINGS, away: REVIEWS_PER_INNINGS };
    this.appeal = undefined;
    this.drs = undefined;
  }

  private enterBetween(): void {
    this.phase = 'between';
    this.phaseTimer = BETWEEN_BALLS;
    this.emit();
  }

  /** The state at the start of the current ball, for a save made during it. */
  private checkpoint: Record<string, unknown> | undefined;

  /**
   * The match as it can be saved: as it is now between balls, or as it stood
   * at the start of the ball in play (which is then bowled again on loading).
   */
  saveState(): ReturnType<typeof encodeSnapshot> {
    // The ball is over and scored: finish with it (strike, the next batter, the end of the over) and save after it.
    if (this.phase === 'delivery' && this.cycle?.phase === 'dead' && this.cycle.outcome && this.lastOutcome === this.cycle.outcome) this.afterBall();
    const mid = this.phase === 'delivery' || this.phase === 'appeal' || this.phase === 'drs';
    return encodeSnapshot(mid && this.checkpoint ? this.checkpoint : snapshotMatch(this));
  }

  /** Restores a saved state (into a match built from the same configuration); play resumes before the next ball. */
  restoreState(state: ReturnType<typeof encodeSnapshot>): void {
    decodeInto(this, state, playersOf(this.config.home.team, this.config.away.team));
    this.cycle = undefined;
    this.appeal = undefined;
    this.drs = undefined;
    this.clock.reset();
    // A saved ball in play starts again; a human gets a moment to get ready.
    if (this.phase === 'delivery' || this.phase === 'appeal' || this.phase === 'drs') this.phase = 'between';
    if (this.phase === 'between' && this.humanInvolved) this.waitForStart();
    this.emit();
  }

  private beginBall(): void {
    this.checkpoint = snapshotMatch(this);
    this.updateAutoplay();
    if (this.humanBowling) {
      // A new over (or innings): the human captain chooses the bowler. Each ball starts by choosing
      // the delivery (the last one is kept, so the same again is Space, Space).
      this.aimStep = 'type';
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
      const phase = fieldingPhase(this.config.overs, this.phaseBalls);
      const d = this.brain.choose(this.bowler, this.striker, phase === 'powerplay' ? 0 : phase === 'middle' ? 1 : 2, difficulty, rng);
      this.pendingPlan = { batterId: this.striker.id, planId: d.planId, insight: d.insight };
      this.startCycle(d.plan, d.releaseQuality);
      return;
    }
    const d = chooseDelivery(this.bowler, difficulty, rng);
    this.startCycle(d.plan, d.releaseQuality);
  }

  private needsBowlerChoice = true;

  private startCycle(plan: DeliveryPlan, releaseQuality?: number): void {
    const bowler = this.bowler;
    const overNumber = this.innings.length * 1000 + Math.floor(this.current.balls / 6);
    if (this.ballsThisOver === 0 && this.announcedOver !== overNumber) {
      this.announcedOver = overNumber;
      const bowled = (this.card(bowler)?.balls ?? 0) > 0;
      if (!bowled) this.say(this.commentator.newBowler(bowler.name, this.current.balls === 0));
    }
    this.milestone = undefined;
    this.departing = undefined;
    this.cycle = new DeliveryCycle({
      bowler,
      striker: this.striker,
      nonStriker: this.nonStriker,
      field: this.buildField(bowler),
      pitch: pitchInConditions(PITCHES[this.config.pitch], this.config.weather ?? 'sunny', this.innings.length - 1),
      plan,
      fatigue: this.bowlerFatigue,
      rng: this.rng.fork(`ball-${this.ballNumber}`),
      manualRunning: this.humanBatting,
      humanFielding: this.humanBowling,
      ...(this.freeHit ? { freeHit: true } : {}),
      bouncersThisOver: this.bouncersThisOver,
      form: {
        confidence: this.formOf(this.striker).confidence,
        strikerFatigue: this.formOf(this.striker).fatigue,
        nonStrikerFatigue: this.formOf(this.nonStriker).fatigue,
      },
      ...(releaseQuality !== undefined ? { releaseQuality } : {}),
      ...(!this.humanBatting ? { battingAi: { difficulty: DIFFICULTIES[this.config.difficulty], intent: this.battingIntent() + (this.freeHit ? 0.4 : 0) } } : {}),
    });
    this.ballNumber += 1;
    this.phase = 'delivery';
    this.emit();
  }

  /** How positive the computer batters should be, from the match situation. */
  battingIntent(): number {
    // A super over: six balls, everything goes.
    if (this.superOver) return 1.4;
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
    // Byes and leg byes are not the bowler's fault.
    const conceded = runsTotal - (o.byes ?? 0) - (o.legByes ?? 0);
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
          dots: next.dots + (!o.wide && o.runs === 0 ? 1 : 0),
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
    const card: BowlingCard = existing ?? { player: bowler, balls: 0, runs: 0, wickets: 0, maidens: 0, dots: 0, wides: 0, noBalls: 0, fours: 0, sixes: 0 };
    const updatedCard: BowlingCard = {
      ...card,
      dots: card.dots + (legal && conceded === 0 ? 1 : 0),
      wides: card.wides + (o.wide ? 1 : 0),
      noBalls: card.noBalls + (o.noBall ? 1 : 0),
      fours: card.fours + (o.boundary === 4 ? 1 : 0),
      sixes: card.sixes + (o.boundary === 6 ? 1 : 0),
      balls: card.balls + (legal ? 1 : 0),
      runs: card.runs + conceded,
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
      byes: (inn.byes ?? 0) + (o.byes ?? 0),
      legByes: (inn.legByes ?? 0) + (o.legByes ?? 0),
      fours: inn.fours + (o.boundary === 4 ? 1 : 0),
      sixes: inn.sixes + (o.boundary === 6 ? 1 : 0),
      battingCards,
      bowlingCards,
      fallOfWickets: outPlayer ? [...inn.fallOfWickets, { wicket: wickets, runs, balls, batter: outPlayer.name }] : inn.fallOfWickets,
      overs: addToOver(inn.overs, Math.floor(inn.balls / 6), runsTotal, o.wicket ? 1 : 0),
    };
    // A fifty or a hundred on this ball.
    const before = inn.battingCards.find((c) => c.player.id === striker.id)?.runs ?? 0;
    const after = before + o.runs;
    const reached = [100, 50].find((n) => before < n && after >= n);
    this.milestone = reached
      ? { batterId: striker.id, name: striker.name, runs: reached as 50 | 100, balls: (inn.battingCards.find((c) => c.player.id === striker.id)?.balls ?? 0) + (o.wide ? 0 : 1), ball: this.history.length + 1 }
      : undefined;
    // A fifty or hundred: a moment longer before the next ball, to raise the bat.
    if (this.milestone) this.cycle?.holdDead(2);
    this.departing = outPlayer ? { id: outPlayer.id, ball: this.history.length + 1 } : undefined;
    this.history.push(o);
    this.strikerAt.push(striker.id);
    this.lastOutcome = o;
    const def = this.cycle?.delivery?.type;
    const spell = this.spells.get(bowler.id);
    const overIndex = Math.floor(inn.balls / 6);
    const spellOvers = spell && spell.last === overIndex - 2 ? spell.overs + 1 : spell && spell.last === overIndex ? spell.overs : 1;
    if (def) this.fatigue.set(bowler.id, fatigueAfterBall(this.bowlerFatigue, bowler.bowling.stamina, def, this.cycle?.plan.effort ?? 0.75, spellOvers));
    this.updateForm(o, striker, this.cycle?.play?.contact);
    if (legal) this.ballsThisOver += 1;
    this.runsThisOver += runsTotal;
    const mark = o.wicket
      ? 'W'
      : o.wide
        ? `${o.extras}wd`
        : o.noBall
          ? `${o.runs + o.extras}nb`
          : o.byes
            ? `${o.byes}b`
            : o.legByes
              ? `${o.legByes}lb`
              : o.runs === 0
                ? '•'
                : String(o.runs);
    // Wickets with consecutive deliveries by the same bowler: on a hat-trick after two, a hat-trick at three.
    const bowlerWicket = o.wicket !== undefined && o.wicket.kind !== 'runOut';
    const streak = bowlerWicket ? (this.wicketStreak.get(bowler.id) ?? 0) + 1 : 0;
    this.wicketStreak.set(bowler.id, streak);
    if (streak === 3) this.history[this.history.length - 1] = { ...o, headline: 'HAT-TRICK!', detail: `${bowler.name} takes three in three! ${o.detail}` };
    if (streak === 3) this.lastOutcome = this.history[this.history.length - 1];
    // A no-ball: the next ball is a free hit (it carries over a wide). A bouncer counts towards the over's one.
    if (o.noBall) this.freeHit = true;
    else if (!o.wide) this.freeHit = false;
    if (o.bouncer && !o.noBall) this.bouncersThisOver += 1;
    this.recent = [...this.recent, mark].slice(-8);
    this.learnAndDescribe(o, striker, bowler, updatedCard, legal);
    this.emit();
  }

  /** A batter's confidence and tiredness (created on first use, for safety). */
  formOf(p: Player): BatterState {
    let f = this.form.get(p.id);
    if (!f) {
      const i = this.battingSide.xi.findIndex((x) => x.id === p.id);
      f = { confidence: startingConfidence(p, Math.max(0, i)), fatigue: 0 };
      this.form.set(p.id, f);
    }
    return f;
  }

  /** How many overs in a row (from one end) the bowler has bowled in his current spell. */
  spellOf(p: Player): number {
    const s = this.spells.get(p.id);
    const now = Math.floor(this.current.balls / 6);
    return s && now - s.last <= 2 ? s.overs : 0;
  }

  /** After a ball: the striker's confidence, and both batters' tiredness from the running. */
  private updateForm(o: BallOutcome, striker: Player, contact: ContactResult | undefined): void {
    const ran = o.boundary ? 0 : o.runs;
    const total = this.config.overs * 6;
    const s = this.formOf(striker);
    const card = this.current.battingCards.find((c) => c.player.id === striker.id);
    s.confidence = confidenceAfter(s.confidence, {
      contact: contact === undefined ? undefined : contact.kind === 'miss' ? 'miss' : contact.kind === 'edge' ? 'edge' : contact.kind === 'leave' ? 'leave' : 'clean',
      timing: contact?.timing,
      boundary: o.boundary,
      ranRuns: ran,
    });
    s.fatigue = fatigueAfter(s.fatigue, ran, card?.balls ?? 0, total, striker.batting.footwork);
    const partner = this.nonStriker;
    if (partner.id !== striker.id) {
      const n = this.formOf(partner);
      n.fatigue = fatigueAfter(n.fatigue, ran, 0, total, partner.batting.footwork);
    }
    if (o.boundary) for (const f of this.form.values()) f.fatigue = rested(f.fatigue, 0.01);
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
        milestone: this.milestone?.batterId === striker.id ? this.milestone.runs : undefined,
        reviewed: o.review ? { by: o.review.by, out: o.wicket !== undefined, overturned: o.review.overturned, umpiresCall: o.review.umpiresCall } : undefined,
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
    const phase = fieldingPhase(this.config.overs, this.phaseBalls);
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
      if (ranRuns(o) % 2 === 1 && !o.boundary) this.swapStrike();
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
    // Autoplay done (or called off): the player is back in control, and the game waits for him.
    if (this.autoplayActive && (this.autoplayMode === 'off' || this.current.balls >= this.autoplayUntil)) {
      this.endAutoplay();
      if (this.humanBowling) this.setup = defaultSetup(this.bowler);
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
    const outIsStriker = (w.batter === 'striker') === (ranRuns(o) % 2 === 0);
    const incoming = this.nextIndex;
    this.nextIndex += 1;
    const newcomer = xi[incoming];
    if (newcomer) this.form.set(newcomer.id, { confidence: startingConfidence(newcomer, incoming), fatigue: 0 });
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

  /** The practice challenge's progress (practice matches only). */
  get challengeStatus(): ChallengeStatus | undefined {
    const id = this.config.practice;
    if (!id) return undefined;
    const inn = this.current;
    const balls = this.history.slice(this.history.length - this.inningsBallCount());
    const over = inn.balls >= this.config.overs * 6;
    return challenge(id).check(balls, over, offSideSign(this.striker.battingHand) > 0 ? 1 : -1);
  }

  /** How many entries of the history (extras included) belong to this innings. */
  private inningsBallCount(): number {
    const inn = this.current;
    return inn.balls + inn.wides + inn.noBalls;
  }

  private inningsOver(): boolean {
    const inn = this.current;
    const total = this.config.overs * 6;
    // Practice: over as soon as the challenge is decided.
    const status = this.challengeStatus;
    if (status && (status.state !== 'on' || inn.balls >= total || inn.wickets >= 10)) {
      this.innings[this.innings.length - 1] = { ...inn, endReason: inn.balls >= total ? 'overs' : 'target' };
      this.endAutoplay();
      const won = status.state === 'won';
      this.result = { tie: false, margin: '', summary: won ? 'Challenge complete!' : 'Challenge failed' };
      this.phase = 'complete';
      if (won && this.config.practice) markCompleted(this.config.practice);
      this.emit();
      return true;
    }
    let reason: InningsState['endReason'];
    const overs = this.inningsOvers * 6;
    if (inn.target !== undefined && inn.runs >= inn.target) reason = 'target';
    else if (inn.wickets >= this.wicketLimit || this.nextIndex > this.battingSide.xi.length) reason = 'allOut';
    else if (inn.balls >= overs) reason = 'overs';
    if (!reason) return false;
    this.innings[this.innings.length - 1] = { ...inn, endReason: reason };
    // Autoplay stops with the innings: the player takes the break and the next innings.
    this.endAutoplay();
    const done = this.current;
    const prev = this.innings[this.innings.length - 2];
    if (this.innings.length % 2 === 1) {
      this.phase = 'inningsBreak';
      this.phaseTimer = AUTO_BREAK;
      this.needsBowlerChoice = true;
      this.superOverNext = false;
      this.say(this.commentator.inningsBreak(this.side(done.batting).team.name, done.runs, done.wickets, done.runs + 1, this.side(done.bowling).team.name));
    } else if (prev && prev.runs === done.runs && this.innings.length < 2 + 2 * MAX_SUPER_OVERS && !this.config.practice) {
      // Scores level: a super over (again, if the last one was tied too).
      this.phase = 'inningsBreak';
      this.phaseTimer = AUTO_BREAK;
      this.needsBowlerChoice = true;
      this.superOverNext = true;
      this.say({ text: `Scores level! ${done.runs} apiece — we're going to a super over.`, excitement: 2 });
    } else {
      this.result = this.decide();
      this.phase = 'complete';
      this.say(this.commentator.result(this.result.summary));
    }
    this.emit();
    return true;
  }

  /** This innings is a super over. */
  get superOver(): boolean {
    return this.innings.length > 2;
  }

  /** Overs in this innings: the match's, or one in a super over. */
  get inningsOvers(): number {
    return this.superOver ? 1 : this.config.overs;
  }

  /** Two wickets end a super over. */
  get wicketLimit(): number {
    return this.superOver ? 2 : 10;
  }

  /** Balls into the innings for the fielding restrictions (a super over is played as the last over). */
  get phaseBalls(): number {
    return this.superOver ? (this.config.overs - 1) * 6 + this.current.balls : this.current.balls;
  }

  /** At the innings break: the next innings is a super over. */
  superOverNext = false;

  private decide(): MatchResult {
    const n = this.innings.length;
    const first = this.innings[n - 2];
    const second = this.innings[n - 1];
    if (!first || !second) throw new Error('match incomplete');
    const name = (s: SideId) => this.side(s).team.name;
    if (n > 2) {
      // Decided by a super over.
      if (second.runs === first.runs) return { tie: true, margin: '', summary: 'Match tied — even after the super over' };
      const winner = second.runs > first.runs ? second.batting : first.batting;
      return { winner, tie: false, margin: 'in the super over', summary: `${name(winner)} won the super over` };
    }
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
    this.bouncersThisOver = 0;
    this.swapStrike();
    this.lastOverBowlerId = this.bowlerId;
    // The bowler's spell: another over in a row from his end, or the start of a new one.
    const overIndex = Math.floor(inn.balls / 6) - 1;
    const spell = this.spells.get(this.bowlerId);
    this.spells.set(this.bowlerId, { overs: spell && spell.last === overIndex - 2 ? spell.overs + 1 : 1, last: overIndex });
    // The batters get their breath back while the field changes over.
    for (const f of this.form.values()) f.fatigue = rested(f.fatigue, 0.015);
    for (const p of this.bowlingSide.xi) {
      if (p.id !== this.bowlerId) this.fatigue.set(p.id, fatigueAfterRest(this.fatigue.get(p.id) ?? 0));
    }
    this.recent = [];
    // The human captain picks the next bowler (when he is back in control); on autoplay, the computer's pick stands meanwhile.
    if (this.bowlingSide.controller === 'human') this.needsBowlerChoice = true;
    if (!this.humanBowling) this.bowlerId = this.suggestedBowler().id;
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
    // The human captain's preset, if one is set and allowed now.
    // The human captain's own field, if it is legal at this stage of the innings.
    if (this.humanBowling && this.fieldPreset === 'custom' && this.customField && !checkField(this.customField, this.maxOutsideNow)) {
      const [wk] = buildField([keeper], STANDARD_FIELD.filter((p) => p.id === 'wk'), hand);
      const ring = this.place(others, this.customField, hand);
      const [bowlerSpot] = buildField([bowler], [BOWLER_FOLLOW_THROUGH], hand);
      return [...(wk ? [wk] : []), ...ring, ...(bowlerSpot ? [bowlerSpot] : [])];
    }
    const preset = this.humanBowling && this.fieldPreset !== 'auto' ? findPreset(this.fieldPreset) : undefined;
    if (preset && this.availablePresets.includes(preset)) {
      const [wk] = buildField([keeper], STANDARD_FIELD.filter((p) => p.id === 'wk'), hand);
      const ring = this.place(others, preset.positions, hand);
      const [bowlerSpot] = buildField([bowler], [BOWLER_FOLLOW_THROUGH], hand);
      return [...(wk ? [wk] : []), ...ring, ...(bowlerSpot ? [bowlerSpot] : [])];
    }
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
    const ring = this.place(others, decision.positions, hand);
    const [bowlerSpot] = buildField([bowler], [BOWLER_FOLLOW_THROUGH], hand);
    return [...(wk ? [wk] : []), ...ring, ...(bowlerSpot ? [bowlerSpot] : [])];
  }

  /** Where each fielder stood in the last field set, so a new field moves people as little as possible. */
  private readonly lastSpots = new Map<string, { x: number; z: number }>();

  private place(players: readonly Player[], positions: Parameters<typeof buildField>[1], hand: Player['battingHand']): Fielder[] {
    const field = rebuildField(players, positions, hand, this.lastSpots);
    for (const f of field) this.lastSpots.set(f.player.id, f.start);
    return field;
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

/** A new bowler starts with his stock ball, over the wicket, on a good length just outside off. */
function defaultSetup(bowler: Player): BowlingSetup {
  const spinner = isSpinner(bowler.bowlingStyle);
  const type: DeliveryTypeId = humanDeliveries(bowler.bowlingStyle)[0] ?? 'fast';
  return { type, line: 0.15, length: spinner ? 4.3 : LENGTHS.good, side: 'over', amount: 0.5 };
}

export const oversText = (balls: number): string => `${Math.floor(balls / 6)}.${balls % 6}`;

function at(xi: readonly Player[], i: number): Player {
  const p = xi[i];
  if (!p) throw new Error(`No player at ${i}`);
  return p;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
