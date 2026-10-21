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
import type { Player } from '../model/player.ts';
import { type BallOutcome, DeliveryCycle } from './deliveryCycle.ts';

/**
 * Practice session: an open-ended innings in the nets-to-middle style used
 * for phase 1. One side bats, the other bowls; either can be the human or
 * the computer. Handles strike rotation, overs, bowler changes, fatigue,
 * wickets and the next batter. The full match engine (innings, targets,
 * extras, results) arrives in P3 and reuses DeliveryCycle unchanged.
 */
export type Controller = 'human' | 'ai';

export interface PracticeConfig {
  readonly battingTeam: Team;
  readonly bowlingTeam: Team;
  readonly batting: Controller;
  readonly bowling: Controller;
  readonly pitch: PitchId;
  readonly difficulty: DifficultyId;
  readonly seed: string;
}

export interface Score {
  readonly runs: number;
  readonly wickets: number;
  readonly balls: number;
  readonly extras: number;
  readonly fours: number;
  readonly sixes: number;
}

export interface BowlingSetup {
  readonly type: DeliveryTypeId;
  /** Batter-relative line at the stumps, metres (+ off side). */
  readonly line: number;
  /** Metres in front of the striker's stumps. */
  readonly length: number;
}

export type SessionPhase = 'aiming' | 'between' | 'delivery' | 'allOut';

export interface BattingFigures {
  readonly runs: number;
  readonly balls: number;
  readonly fours: number;
  readonly sixes: number;
  readonly out: boolean;
}

export interface BowlingFigures {
  readonly balls: number;
  readonly runs: number;
  readonly wickets: number;
}

const NO_BATTING: BattingFigures = { runs: 0, balls: 0, fours: 0, sixes: 0, out: false };
const NO_BOWLING: BowlingFigures = { balls: 0, runs: 0, wickets: 0 };

const BETWEEN_BALLS = 0.9;
const ALL_OUT_PAUSE = 4;
export const LINE_RANGE = { min: -0.6, max: 1.0 } as const;
export const LENGTH_RANGE = { min: 0.3, max: 12.5 } as const;

const EMPTY_SCORE: Score = { runs: 0, wickets: 0, balls: 0, extras: 0, fours: 0, sixes: 0 };

export class PracticeSession {
  readonly config: PracticeConfig;
  readonly clock = new FixedStepClock();
  readonly bowlers: readonly Player[];
  phase: SessionPhase = 'between';
  paused = false;
  time = 0;
  score: Score = EMPTY_SCORE;
  readonly history: BallOutcome[] = [];
  cycle: DeliveryCycle | undefined;
  lastOutcome?: BallOutcome;
  setup: BowlingSetup;
  /** Batting order indices. */
  strikerIndex = 0;
  nonStrikerIndex = 1;
  private nextIndex = 2;
  private outBatters = new Set<number>();
  private bowlerIndex = 0;
  private ballsThisOver = 0;
  private readonly fatigue = new Map<string, number>();
  private batting = new Map<string, BattingFigures>();
  private bowling = new Map<string, BowlingFigures>();
  /** Last six legal-or-not balls for the over summary. */
  recent: string[] = [];
  private phaseTimer = 0;
  private aimingSince = 0;
  private ballNumber = 0;
  private readonly rng: Rng;
  private readonly listeners = new Set<() => void>();

  constructor(config: PracticeConfig) {
    this.config = config;
    this.rng = new Rng(config.seed);
    this.bowlers = pickBowlers(config.bowlingTeam);
    const first = this.bowler;
    this.setup = defaultSetup(first);
    this.enterBetween();
  }

  // --- Accessors -------------------------------------------------------------

  get striker(): Player {
    return playerAt(this.config.battingTeam, this.strikerIndex);
  }

  get nonStriker(): Player {
    return playerAt(this.config.battingTeam, this.nonStrikerIndex);
  }

  get bowler(): Player {
    const b = this.bowlers[this.bowlerIndex % this.bowlers.length];
    if (!b) throw new Error('no bowlers');
    return b;
  }

  get overs(): string {
    return `${Math.floor(this.score.balls / 6)}.${this.score.balls % 6}`;
  }

  get bowlerFatigue(): number {
    return this.fatigue.get(this.bowler.id) ?? 0;
  }

  /** The human bowler's accuracy meter, 0–1, a triangle wave during the run-up. 0.5 is perfect. */
  get meter(): number {
    const c = this.cycle;
    if (!c || c.phase !== 'runUp') return 0.5;
    const period = 0.9;
    const x = (c.time % period) / period;
    return x < 0.5 ? x * 2 : 2 - x * 2;
  }

  battingFigures(p: Player): BattingFigures {
    return this.batting.get(p.id) ?? NO_BATTING;
  }

  bowlingFigures(p: Player): BowlingFigures {
    return this.bowling.get(p.id) ?? NO_BOWLING;
  }

  get availableDeliveries(): DeliveryTypeId[] {
    return deliveriesFor(this.bowler.bowlingStyle)
      .map((d) => d.id)
      .filter((id) => id !== 'fullToss');
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- Time ------------------------------------------------------------------

  /** Advances by a frame delta in fixed steps. Returns the steps taken. */
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
      case 'aiming':
        // Waits for the human bowler to press bowl.
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
      case 'allOut':
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) this.newInnings();
        break;
    }
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.clock.reset();
    this.emit();
  }

  // --- Human input -------------------------------------------------------------

  playShot(shot: ShotAttempt): boolean {
    if (this.config.batting !== 'human' || this.paused) return false;
    return this.cycle?.playShot(shot) ?? false;
  }

  /** Human bowler: start the run-up (when aiming) or lock the release (during the run-up). */
  bowlButton(): void {
    if (this.config.bowling !== 'human' || this.paused) return;
    if (this.phase === 'aiming') {
      this.startCycle({ type: this.setup.type, line: this.setup.line, length: this.setup.length });
      return;
    }
    const c = this.cycle;
    if (this.phase === 'delivery' && c && c.phase === 'runUp' && !c.releaseLocked) {
      c.setReleaseQuality(1 - Math.abs(this.meter - 0.5) * 2);
    }
  }

  adjustTarget(dLine: number, dLength: number): void {
    if (this.config.bowling !== 'human') return;
    const s = this.setup;
    this.setup = {
      ...s,
      line: clamp(s.line + dLine, LINE_RANGE.min, LINE_RANGE.max),
      length: clamp(s.length + dLength, LENGTH_RANGE.min, LENGTH_RANGE.max),
    };
    this.emit();
  }

  cycleDelivery(direction: 1 | -1): void {
    if (this.config.bowling !== 'human') return;
    const options = this.availableDeliveries;
    const i = options.indexOf(this.setup.type);
    const next = options[(i + direction + options.length) % options.length] ?? options[0];
    if (!next) return;
    const def = DELIVERY_TYPES[next];
    const length = def.lengths ? clamp(this.setup.length, def.lengths.min, def.lengths.max) : this.setup.length;
    this.setup = { ...this.setup, type: next, length };
    this.emit();
  }

  // --- Ball lifecycle -----------------------------------------------------------

  private enterBetween(): void {
    this.phase = 'between';
    this.phaseTimer = BETWEEN_BALLS;
    this.emit();
  }

  private beginBall(): void {
    if (this.config.bowling === 'human') {
      this.phase = 'aiming';
      this.aimingSince = this.time;
      this.cycle = undefined;
      this.emit();
      return;
    }
    const d = chooseDelivery(this.bowler, DIFFICULTIES[this.config.difficulty], this.rng.fork(`bowl-ai-${this.ballNumber}`));
    this.startCycle(d.plan, d.releaseQuality);
  }

  private startCycle(plan: BowlingSetup, releaseQuality?: number): void {
    const bowler = this.bowler;
    const field = this.buildField(bowler);
    this.cycle = new DeliveryCycle({
      bowler,
      striker: this.striker,
      field,
      pitch: PITCHES[this.config.pitch],
      plan,
      fatigue: this.bowlerFatigue,
      rng: this.rng.fork(`ball-${this.ballNumber}`),
      ...(releaseQuality !== undefined ? { releaseQuality } : {}),
      ...(this.config.batting === 'ai'
        ? { battingAi: { difficulty: DIFFICULTIES[this.config.difficulty], intent: 0.4 } }
        : {}),
    });
    this.ballNumber += 1;
    this.phase = 'delivery';
    this.emit();
  }

  private record(o: BallOutcome): void {
    const legal = !o.noBall;
    const s = this.score;
    this.score = {
      runs: s.runs + o.runs + o.extras,
      wickets: s.wickets + (o.wicket ? 1 : 0),
      balls: s.balls + (legal ? 1 : 0),
      extras: s.extras + o.extras,
      fours: s.fours + (o.boundary === 4 ? 1 : 0),
      sixes: s.sixes + (o.boundary === 6 ? 1 : 0),
    };
    this.history.push(o);
    this.lastOutcome = o;
    const striker = this.striker;
    const bat = this.battingFigures(striker);
    this.batting.set(striker.id, {
      runs: bat.runs + o.runs,
      balls: bat.balls + (legal ? 1 : 0),
      fours: bat.fours + (o.boundary === 4 ? 1 : 0),
      sixes: bat.sixes + (o.boundary === 6 ? 1 : 0),
      out: bat.out || o.wicket !== undefined,
    });
    const bowl = this.bowlingFigures(this.bowler);
    this.bowling.set(this.bowler.id, {
      balls: bowl.balls + (legal ? 1 : 0),
      runs: bowl.runs + o.runs + o.extras,
      wickets: bowl.wickets + (o.wicket ? 1 : 0),
    });
    const mark = o.wicket ? 'W' : o.noBall ? `${o.runs + o.extras}nb` : o.runs === 0 ? '•' : String(o.runs);
    this.recent = [...this.recent, mark].slice(-6);
    const def = this.cycle?.delivery?.type;
    if (def) this.fatigue.set(this.bowler.id, fatigueAfterBall(this.bowlerFatigue, this.bowler.bowling.stamina, def));
    if (legal) this.ballsThisOver += 1;
    this.emit();
  }

  private afterBall(): void {
    const o = this.lastOutcome;
    if (o?.wicket) {
      this.outBatters.add(this.strikerIndex);
      if (this.score.wickets >= 10 || this.nextIndex >= this.config.battingTeam.players.length) {
        this.phase = 'allOut';
        this.phaseTimer = ALL_OUT_PAUSE;
        this.cycle = undefined;
        this.emit();
        return;
      }
      this.strikerIndex = this.nextIndex;
      this.nextIndex += 1;
    } else if (o && o.runs % 2 === 1 && !o.boundary) {
      this.swapStrike();
    }
    if (this.ballsThisOver >= 6) this.endOver();
    this.cycle = undefined;
    this.enterBetween();
  }

  private endOver(): void {
    this.ballsThisOver = 0;
    this.swapStrike();
    // Rest every bowler who did not bowl this over, then bring on the next one.
    const current = this.bowler.id;
    for (const b of this.bowlers) {
      if (b.id !== current) this.fatigue.set(b.id, fatigueAfterRest(this.fatigue.get(b.id) ?? 0));
    }
    this.bowlerIndex = (this.bowlerIndex + 1) % this.bowlers.length;
    this.setup = defaultSetup(this.bowler);
  }

  private swapStrike(): void {
    const s = this.strikerIndex;
    this.strikerIndex = this.nonStrikerIndex;
    this.nonStrikerIndex = s;
  }

  private newInnings(): void {
    this.score = EMPTY_SCORE;
    this.batting = new Map();
    this.bowling = new Map();
    this.recent = [];
    this.strikerIndex = 0;
    this.nonStrikerIndex = 1;
    this.nextIndex = 2;
    this.outBatters = new Set();
    this.ballsThisOver = 0;
    this.bowlerIndex = 0;
    this.fatigue.clear();
    this.setup = defaultSetup(this.bowler);
    this.enterBetween();
  }

  /** The field for the current bowler and striker (what the view shows between balls). */
  get field(): Fielder[] {
    return this.cycle?.opts.field.slice() ?? this.buildField(this.bowler);
  }

  /** Fielding side: the bowler follows through; the best catcher keeps wicket; the rest fill the standard field. */
  private buildField(bowler: Player): Fielder[] {
    const others = this.config.bowlingTeam.players
      .filter((p) => p.id !== bowler.id)
      .slice()
      .sort((a, b) => b.fielding.catching - a.fielding.catching);
    const field = buildField(others, STANDARD_FIELD, this.striker.battingHand);
    const [bowlerSpot] = buildField([bowler], [BOWLER_FOLLOW_THROUGH], this.striker.battingHand);
    return bowlerSpot ? [...field, bowlerSpot] : field;
  }

  /** Seconds the human bowler has been aiming (for UI hints). */
  get aimingFor(): number {
    return this.phase === 'aiming' ? this.time - this.aimingSince : 0;
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

function pickBowlers(team: Team): Player[] {
  const bowlers = team.players.filter((p) => p.bowlingStyle !== 'none');
  const rating = (p: Player) => p.bowling.accuracy + (p.bowlingStyle === 'offSpin' || p.bowlingStyle === 'legSpin' ? p.bowling.spin : p.bowling.pace);
  return bowlers.sort((a, b) => rating(b) - rating(a)).slice(0, 5);
}

function defaultSetup(bowler: Player): BowlingSetup {
  const spinner = bowler.bowlingStyle === 'offSpin' || bowler.bowlingStyle === 'legSpin';
  const type: DeliveryTypeId = spinner ? (bowler.bowlingStyle === 'offSpin' ? 'offBreak' : 'legBreak') : 'fast';
  return { type, line: 0.12, length: spinner ? 4.3 : LENGTHS.good };
}

function playerAt(team: Team, i: number): Player {
  const p = team.players[i];
  if (!p) throw new Error(`No player at ${i} in ${team.name}`);
  return p;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
