import type { Rng } from '../core/rng.ts';
import type { Vec3 } from '../core/vec3.ts';
import { BOWLER_STUMPS_Z, STRIKER_STUMPS_Z } from '../data/field.ts';
import { type PitchPreset, groundFor } from '../data/pitches.ts';
import { type BattingAiOptions, decideStroke, deepGaps } from '../ai/battingAi.ts';
import type { ContactResult } from '../batting/contact.ts';
import { powerScale, timingScale } from '../batting/form.ts';
import { SHOTS, type ShotAttempt } from '../batting/shots.ts';
import { type DeliveryPlan, type ExecutedDelivery, executeDelivery } from '../bowling/execute.ts';
import { runUpFor } from '../bowling/runUp.ts';
import { type Fielder, type FieldingPlan, RUN, fielderReaction, fielderSpeed, planFielding } from '../fielding/plan.ts';
import { type Player, offSideSign } from '../model/player.ts';
import type { GroundModel } from '../physics/ball.ts';
import { type BallEvent, BallInPlay } from '../simulation/ballInPlay.ts';
import type { Decision, LbwTracking } from '../simulation/tracking.ts';

/**
 * One ball, end to end: run-up → release → flight (stroke) → struck ball and
 * fielding → dead ball with an outcome. Independent of React and the
 * renderer; the view reads its state each frame.
 */
export type CyclePhase = 'runUp' | 'inFlight' | 'struck' | 'dead';

export type WicketKind = 'bowled' | 'caught' | 'lbw' | 'runOut' | 'stumped';

export interface BallOutcome {
  /** Runs credited to the batter (including boundaries). */
  readonly runs: number;
  readonly extras: number;
  readonly noBall: boolean;
  readonly wide: boolean;
  readonly boundary?: 4 | 6;
  readonly wicket?: {
    readonly kind: WicketKind;
    readonly fielder?: string;
    /** Who is out, by their role at the start of the ball (run-outs can claim the non-striker). */
    readonly batter: 'striker' | 'nonStriker';
  };
  /** Short headline for the HUD. */
  readonly headline: string;
  /** One line of detail (shot, contact, fielder). */
  readonly detail: string;
  readonly shot?: ShotAttempt;
  readonly contact?: ContactResult;
  /** Timing of the stroke in milliseconds (positive = late), if a stroke was played. */
  readonly timingMs?: number;
  readonly delivery: { readonly name: string; readonly speedKph: number; readonly line: number; readonly length?: number };
  /** An lbw appeal: the on-field decision and the ball tracking, for a review. */
  readonly appeal?: { readonly onField: Decision; readonly tracking: LbwTracking };
  /** Set when the decision was reviewed: by whom (team short name) and how it came out. */
  readonly review?: { readonly by: string; readonly overturned: boolean; readonly umpiresCall: boolean; readonly why: string };
}

export interface BatterForm {
  readonly confidence: number;
  readonly strikerFatigue: number;
  readonly nonStrikerFatigue: number;
}

export interface CycleOptions {
  readonly bowler: Player;
  readonly striker: Player;
  readonly nonStriker?: Player;
  readonly field: readonly Fielder[];
  readonly pitch: PitchPreset;
  readonly plan: DeliveryPlan;
  readonly fatigue: number;
  readonly rng: Rng;
  /** Release quality if the bowler is computer-controlled; a human sets it during the run-up. */
  readonly releaseQuality?: number;
  /** Present when the striker is computer-controlled. */
  readonly battingAi?: Omit<BattingAiOptions, 'batter' | 'rng' | 'ground'>;
  /** Human batters call their own runs; otherwise the batters take the safe runs automatically. */
  readonly manualRunning?: boolean;
  /** The human is fielding: after a pick-up with the batters running, they choose where to throw it and how hard. */
  readonly humanFielding?: boolean;
  /** The batters' state: the striker's confidence (0–1), and how tired each is (0 fresh – 1 spent). */
  readonly form?: BatterForm;
}

/** Which end a throw goes to: the keeper (striker's end) or the bowler. */
export type ThrowEnd = 'striker' | 'bowler';

/**
 * A throw from the field. Released after the pick-up and a wind-up; the
 * ball arrives after its flight. A direct hit breaks the stumps on arrival;
 * otherwise the keeper or bowler gathers it first (longer if the throw was
 * wild).
 */
export interface ThrowPlan {
  readonly end: ThrowEnd;
  readonly power: number;
  readonly releaseAt: number;
  readonly arriveAt: number;
  readonly direct: boolean;
  /** How far the throw missed the stumps, metres (sideways). */
  readonly miss: number;
  readonly human: boolean;
}

/** How long the game waits for a human's throw after the pick-up before the fielder throws anyway. */
export const THROW_WAIT = 1.1;

/**
 * The physics of a throw: power 0–1.2 (the meter), the fielder's arm 0–1.
 * Speed grows with power and arm; accuracy is best in the middle of the
 * range (0.45–0.85) and falls away when the throw is forced; a lob (low
 * power) takes longer as it drops and bounces in. Pick-up and wind-up come
 * first. A direct hit breaks the stumps on arrival; otherwise whoever is at
 * the stumps gathers it first — longer if it was wild.
 */
export function planThrow(i: {
  from: { x: number; z: number };
  end: ThrowEnd;
  power: number;
  arm: number;
  now: number;
  collectedAt: number;
  rng: Rng;
}): { plan: Omit<ThrowPlan, 'human'>; breakAt: number } {
  const pw = Math.min(1.2, Math.max(0.1, i.power));
  const target = i.end === 'striker' ? STRIKER_STUMPS_Z : BOWLER_STUMPS_Z;
  const dist = Math.hypot(i.from.x, i.from.z - target);
  const speed = (12 + 20 * Math.min(1, pw)) * (0.78 + 0.35 * i.arm);
  const releaseAt = Math.max(i.now, i.collectedAt + 0.4) + 0.12;
  const arriveAt = releaseAt + dist / speed + (pw < 0.35 ? 0.25 : 0);
  const forcing = Math.max(0, pw - 0.85) * 4 + Math.max(0, 0.45 - pw) * 0.5;
  const spread = (0.12 + 0.02 * dist) * (1.35 - 0.6 * i.arm) * (1 + forcing);
  const miss = Math.abs(i.rng.boundedNormal(spread));
  const direct = miss < 0.14;
  const breakAt = direct ? arriveAt : arriveAt + 0.25 + Math.min(1.2, Math.max(0, miss - 0.6) * 0.6);
  return { plan: { end: i.end, power: pw, releaseAt, arriveAt, direct, miss }, breakAt };
}

/** Seconds for run `i` (0-based): the first from a standing start, later ones including the turn. */
export const runDuration = (i: number): number => (i === 0 ? RUN.first : RUN.subsequent);
/** Batters cannot be called for more than this many runs on one ball. */
const MAX_RUNS = 5;

/** Seconds the outcome stays on screen (ball in the fielder's hands) before the next ball. */
const DEAD_SECONDS = 2.4;

export class DeliveryCycle {
  phase: CyclePhase = 'runUp';
  /** Seconds since the start of the run-up. */
  time = 0;
  readonly releaseTime: number;
  readonly opts: CycleOptions;
  readonly ground: GroundModel;
  delivery?: ExecutedDelivery;
  play?: BallInPlay;
  fieldingPlan?: FieldingPlan;
  outcome?: BallOutcome;
  /** Animated fielder positions (x, z), same order as `opts.field`. */
  readonly fielderPos: { x: number; z: number }[];
  /** Index of the fielder holding the ball, if any. */
  carrier?: number;
  /** Time the stroke was committed, cycle time. */
  shotTime?: number;
  /** Cycle times at which each run was started. */
  readonly runStarts: number[] = [];
  /** Ball in a fielder's hands: when it was gathered, and when the return reaches the stumps. */
  collectedAt: number | undefined;
  returnAt: number | undefined;
  /** Which set of stumps the return is thrown to. */
  throwTo: 'striker' | 'bowler' = 'striker';
  /** The throw, once made (human fielding, or the computer's). */
  throwPlan: ThrowPlan | undefined;
  /** Human fielding: waiting for the throw since this time. */
  awaitingThrowSince: number | undefined;
  readonly events: BallEvent[] = [];
  private releaseQuality: number | undefined;
  /** Changes a human bowler makes during the run-up (amount of swing/spin/cut, the pace they lock). */
  private planChanges: { amount?: number; effort?: number } = {};
  /** Cycle time of bat contact, if the ball was struck. */
  contact: number | undefined;
  private contactTime?: number;
  private deadAt?: number;
  private aiCommitAt?: number;
  private aiShot?: ShotAttempt;
  private readonly rng: Rng;

  constructor(opts: CycleOptions) {
    this.opts = opts;
    this.ground = groundFor(opts.pitch);
    this.rng = opts.rng;
    this.releaseQuality = opts.releaseQuality;
    this.releaseTime = runUpFor(opts.bowler.bowlingStyle).duration;
    this.fielderPos = opts.field.map((f) => ({ ...f.start }));
  }

  /** How long the ball stays dead before the next: longer after a wicket, or a fifty or hundred, to celebrate. */
  private deadHold = DEAD_SECONDS;

  /** Seconds since the ball became dead (undefined while it is live). */
  get deadFor(): number | undefined {
    return this.phase === 'dead' && this.deadAt !== undefined ? this.time - this.deadAt : undefined;
  }

  /** Keep the ball dead a little longer (a milestone to celebrate). */
  holdDead(extra: number): void {
    this.deadHold = Math.max(this.deadHold, DEAD_SECONDS + extra);
  }

  get finished(): boolean {
    return this.phase === 'dead' && this.deadAt !== undefined && this.time - this.deadAt >= this.deadHold;
  }

  /** Seconds since release (negative during the run-up). */
  get flightTime(): number {
    return this.time - this.releaseTime;
  }

  /** Human bowler: lock the release quality (from the accuracy meter) before release. */
  setReleaseQuality(q: number): void {
    if (this.phase === 'runUp' && this.releaseQuality === undefined) this.releaseQuality = Math.min(1, Math.max(0, q));
  }

  get releaseLocked(): boolean {
    return this.releaseQuality !== undefined;
  }

  /** The plan as it will be bowled, including changes made during the run-up. */
  get plan(): DeliveryPlan {
    return { ...this.opts.plan, ...this.planChanges };
  }

  /** Human bowler, during the run-up: more or less swing / spin / cut. */
  setAmount(amount: number): void {
    if (this.phase === 'runUp') this.planChanges = { ...this.planChanges, amount: Math.min(1, Math.max(0, amount)) };
  }

  /** Human bowler, during the run-up: lock the pace (effort 0–1) and with it the release quality. */
  lockPace(effort: number): boolean {
    if (this.phase !== 'runUp' || this.releaseQuality !== undefined) return false;
    const e = Math.min(1, Math.max(0, effort));
    this.planChanges = { ...this.planChanges, effort: e };
    // Anything up to 90% effort is controlled; flat out costs accuracy.
    this.releaseQuality = e <= 0.9 ? 1 : 1 - (e - 0.9) * 5;
    return true;
  }

  /** Human batter commits to a stroke now. Ignored before release or once committed. */
  playShot(shot: ShotAttempt): boolean {
    if (this.phase !== 'inFlight' || !this.play?.canPlayShot) return false;
    const ok = this.play.playShot(shot);
    if (ok) this.shotTime = this.time;
    return ok;
  }

  /** How slowly the batters run: the more tired of the two sets the pace (1 = fresh). */
  get runPace(): number {
    return 1 + 0.14 * Math.max(this.opts.form?.strikerFatigue ?? 0, this.opts.form?.nonStrikerFatigue ?? 0);
  }

  /** Seconds for run `i` at the batters' pace. */
  private runLen(i: number): number {
    return runDuration(i) * this.runPace;
  }

  /** Re-aims the stroke just played (arrows pressed a moment after the shot key). */
  reaimShot(shot: ShotAttempt): boolean {
    if (this.phase !== 'inFlight' || !this.play) return false;
    return this.play.reaim(shot);
  }

  step(dt: number): void {
    this.time += dt;
    switch (this.phase) {
      case 'runUp':
        if (this.time >= this.releaseTime) this.release();
        break;
      case 'inFlight':
      case 'struck':
        this.stepBall(dt);
        break;
      case 'dead':
        break;
    }
    this.moveFielders(dt);
  }

  private release(): void {
    const o = this.opts;
    // A human who never locked the pace gets a half-hearted, poorly timed release.
    const unlocked = this.releaseQuality === undefined;
    const plan = unlocked ? { ...this.plan, effort: this.plan.effort ?? 0.55 } : this.plan;
    const delivery = executeDelivery(plan, {
      bowler: o.bowler,
      batterHand: o.striker.battingHand,
      pitch: o.pitch,
      fatigue: o.fatigue,
      // A human who never pressed gets a poorly timed release.
      releaseQuality: this.releaseQuality ?? 0.25,
      rng: this.rng.fork('delivery'),
    });
    this.delivery = delivery;
    const form = o.form ? { confidence: o.form.confidence, fatigue: o.form.strikerFatigue } : undefined;
    this.play = new BallInPlay({
      delivery,
      striker: o.striker,
      ground: this.ground,
      rng: this.rng.fork('contact'),
      ...(form ? { timingScale: timingScale(form), powerScale: powerScale(form) } : {}),
    });
    this.phase = 'inFlight';
    if (o.battingAi) {
      // The batter reads the field: where are the gaps in the deep?
      const off = offSideSign(o.striker.battingHand);
      const fielders = o.field.map((f) => ({ d: Math.hypot(f.start.x, f.start.z - STRIKER_STUMPS_Z), a: (Math.atan2(f.start.x * off, STRIKER_STUMPS_Z - f.start.z) * 180) / Math.PI }));
      const deep = fielders.filter((f) => f.d > 35).map((f) => f.a);
      const ring = fielders.filter((f) => f.d > 14 && f.d <= 35).map((f) => f.a);
      const decision = decideStroke(delivery, { ...o.battingAi, batter: o.striker, rng: this.rng.fork('batting-ai'), ground: this.ground, gaps: deepGaps(deep, ring) });
      if (decision) {
        this.aiShot = decision.attempt;
        this.aiCommitAt = this.releaseTime + decision.commitAt;
      }
    }
  }

  private stepBall(dt: number): void {
    const play = this.play;
    if (!play) return;
    if (this.aiShot && this.aiCommitAt !== undefined && this.time >= this.aiCommitAt && play.canPlayShot) {
      play.playShot(this.aiShot);
      this.shotTime = this.time;
    }
    // Once a fielder has the ball, the physics stops; the plan says when.
    if (this.collectedAt !== undefined) {
      // Waiting too long for the human's throw: the fielder throws it himself.
      if (this.awaitingThrowSince !== undefined && this.time - this.awaitingThrowSince >= THROW_WAIT) this.throwBall(this.dangerEnd(), 0.7, false);
      if (this.returnAt !== undefined && this.time >= this.returnAt) this.resolveRuns();
      return;
    }
    if (this.phase === 'struck' && this.fieldingPlan && this.contactTime !== undefined && this.fieldingPlan.kind !== 'boundary') {
      if (this.time - this.contactTime >= this.fieldingPlan.interceptT) {
        this.collect(this.fieldingPlan);
        return;
      }
    }
    const raised = play.step(dt);
    for (const ev of raised) {
      this.events.push(ev);
      this.handle(ev, play);
      if (this.phase === 'dead') break;
    }
  }

  private handle(ev: BallEvent, play: BallInPlay): void {
    switch (ev.type) {
      case 'contact': {
        this.phase = 'struck';
        this.contactTime = this.time;
        this.contact = this.time;
        this.fieldingPlan = planFielding(play.ball, this.opts.field, this.rng.fork('fielding'), this.ground, this.runPace);
        if (!this.opts.manualRunning && (this.fieldingPlan.kind === 'fielded' || this.fieldingPlan.kind === 'dropped')) {
          // Computer batters take exactly the runs that are safe.
          let start = this.time + RUN.start;
          for (let i = 0; i < this.fieldingPlan.runs; i++) {
            this.runStarts.push(start);
            start += this.runLen(i);
          }
        }
        break;
      }
      case 'stumps':
        this.finish({ wicket: { kind: 'bowled', batter: 'striker' }, headline: 'BOWLED!', detail: ev.afterContact ? 'Dragged on.' : 'Through the gate.' });
        break;
      case 'pad':
      case 'body':
        {
          const t = ev.lbw.tracking;
          // Worth an appeal (and so a review): given, or close enough that the fielders go up.
          const close = ev.lbw.out || (t.pitching !== 'outsideLeg' && t.impactZone !== 'outsideLeg' && Math.abs(t.atStumps.x) < 0.27 && t.atStumps.y < 0.95);
          const appeal = close ? { appeal: { onField: ev.lbw.out ? ('out' as const) : ('notOut' as const), tracking: t } } : {};
          if (ev.lbw.out) {
            this.finish({ wicket: { kind: 'lbw', batter: 'striker' }, headline: 'LBW!', detail: 'Given out lbw — the finger goes up.', ...appeal });
          } else {
            const why = ev.lbw.reason === 'out' ? '' : ` — ${ev.lbw.reason}.`;
            this.finish({ headline: close ? 'Appeal… not out' : ev.type === 'pad' ? 'Off the pad' : 'Hit on the body', detail: `Not out${why}`, ...appeal });
          }
        }
        break;
      case 'passedBatter': {
        const shot = play.shot;
        const c = play.contact;
        const off = this.opts.striker.battingHand === 'right' ? 1 : -1;
        const line = ev.position.x * off;
        // Limited-overs wide: well outside off, down the leg side, or over head height.
        const wide = line > 0.85 || line < -0.45 || ev.position.y > 1.95;
        const headline = wide ? 'Wide' : !shot || shot.shot === 'leave' ? 'Left alone' : c?.kind === 'miss' ? 'Beaten!' : 'Dot ball';
        this.carrier = this.opts.field.findIndex((f) => f.keeper);
        // Down the pitch and beaten: the keeper has the bails off before he can get back.
        const keeper = this.opts.field[this.carrier];
        if (shot?.footwork === 'out' && keeper && this.rng.fork('stumping').chance(0.72 + 0.25 * (keeper.player.fielding.catching / 100))) {
          this.finish({
            wicket: { kind: 'stumped', fielder: keeper.player.name, batter: 'striker' },
            headline: 'STUMPED!',
            detail: `Down the pitch, beaten, and ${keeper.player.name} whips the bails off.${wide ? ' (Wide as well.)' : ''}`,
            wide,
          });
          break;
        }
        this.finish({ headline, detail: wide ? 'Signalled wide: one extra.' : 'Taken by the keeper.', wide });
        break;
      }
      case 'boundary':
        this.finish({ runs: ev.six ? 6 : 4, boundary: ev.six ? 6 : 4, headline: ev.six ? 'SIX!' : 'FOUR!', detail: '' });
        break;
      case 'stopped':
        // Only reachable if the fielding plan had no interception (rare).
        this.finish({ headline: 'Dot ball', detail: '' });
        break;
      case 'bounce':
      case 'beaten':
        break;
    }
  }

  private collect(plan: FieldingPlan): void {
    const play = this.play;
    if (!play) return;
    if (plan.fielder !== undefined) this.carrier = plan.fielder;
    const fielder = plan.fielder !== undefined ? this.opts.field[plan.fielder] : undefined;
    const name = fielder?.player.name ?? 'the fielder';
    play.ball.velocity.x = 0;
    play.ball.velocity.y = 0;
    play.ball.velocity.z = 0;
    if (plan.kind === 'caught') {
      this.finish({
        wicket: { kind: 'caught', fielder: name, batter: 'striker' },
        headline: 'CAUGHT!',
        detail: `Caught by ${name}${plan.difficulty > 0.5 ? ' — a fine catch' : ''}.`,
      });
      return;
    }
    this.collectedAt = this.time;
    const contact = this.contactTime ?? this.time;
    this.returnAt = contact + (plan.returnT ?? plan.interceptT + 1.5);
    const p = plan.interceptPos;
    this.throwTo = Math.hypot(p.x, p.z - STRIKER_STUMPS_Z) <= Math.hypot(p.x, p.z - BOWLER_STUMPS_Z) ? 'striker' : 'bowler';
    // Nobody set off: the ball is dead as soon as it is in the fielder's hands.
    if (this.runStarts.length === 0) {
      this.resolveRuns();
      return;
    }
    if (this.opts.humanFielding) {
      // The human throws it: where, and how hard, decide whether anyone is run out.
      this.returnAt = undefined;
      this.awaitingThrowSince = this.time;
    } else if (this.returnAt !== undefined) {
      // The computer's throw comes in when the fielding plan says (its runs were judged on that).
      const arriveAt = this.returnAt;
      this.throwPlan = {
        end: this.throwTo,
        power: 0.65,
        releaseAt: Math.min(arriveAt - 0.15, this.time + 0.55),
        arriveAt,
        direct: true,
        miss: 0,
        human: false,
      };
    }
  }

  /** The end a batter is heading for and most likely to be short of. */
  dangerEnd(): ThrowEnd {
    const p = this.runProgress(this.time);
    const n = p.current !== undefined ? p.completed : Math.max(0, p.completed - 1);
    // Run n: the original striker runs towards the bowler's end on even runs; both batters are
    // equally far through it, so the end the throw is nearer to is the better bet.
    const pos = this.carrier !== undefined ? this.fielderPos[this.carrier] : undefined;
    if (!pos) return n % 2 === 0 ? 'bowler' : 'striker';
    return Math.hypot(pos.x, pos.z - STRIKER_STUMPS_Z) <= Math.hypot(pos.x, pos.z - BOWLER_STUMPS_Z) ? 'striker' : 'bowler';
  }

  /**
   * Throws the ball in, to one end, with a power 0–1.2. Speed grows with
   * power and the fielder's arm; accuracy is best in the middle of the
   * range and falls away when the throw is forced. A direct hit breaks the
   * stumps on arrival; otherwise whoever is at the stumps gathers first.
   */
  throwBall(end: ThrowEnd, power: number, human = true): boolean {
    if (this.collectedAt === undefined || this.throwPlan || this.phase === 'dead' || this.carrier === undefined) return false;
    const fielder = this.opts.field[this.carrier];
    const from = this.fielderPos[this.carrier];
    if (!fielder || !from) return false;
    const t = planThrow({
      from,
      end,
      power,
      arm: fielder.player.fielding.throwing / 100,
      now: this.time,
      collectedAt: this.collectedAt,
      rng: this.rng.fork(`throw-${this.time.toFixed(3)}`),
    });
    this.throwTo = end;
    this.throwPlan = { ...t.plan, human };
    this.awaitingThrowSince = undefined;
    this.returnAt = t.breakAt;
    return true;
  }

  /** Human batter calls a run (or the next one). */
  callRun(): boolean {
    if (this.phase !== 'struck' || !this.opts.manualRunning) return false;
    if (this.fieldingPlan?.kind === 'boundary' || this.fieldingPlan?.kind === 'caught') {
      // Running is allowed but pointless; keep it visual only for the first run.
      if (this.runStarts.length > 0) return false;
    }
    if (this.runStarts.length >= MAX_RUNS) return false;
    if (this.returnAt !== undefined && this.time >= this.returnAt) return false;
    const n = this.runStarts.length;
    if (n === 0) {
      this.runStarts.push(Math.max(this.time, (this.contactTime ?? this.time) + 0.1) + 0.15);
      return true;
    }
    const finishLast = (this.runStarts[n - 1] ?? this.time) + this.runLen(n - 1);
    // Called before the batters reach the other end: they turn and go. Afterwards: from standing.
    this.runStarts.push(this.time < finishLast ? finishLast : this.time + 0.2);
    return true;
  }

  /** Runs completed so far, and progress (0–1) of the run under way, at cycle time `t`. */
  runProgress(t: number = this.time): { completed: number; current: number | undefined } {
    let completed = 0;
    let current: number | undefined;
    this.runStarts.forEach((start, i) => {
      const end = start + this.runLen(i);
      if (t >= end) completed = i + 1;
      else if (t >= start) current = (t - start) / this.runLen(i);
    });
    return { completed, current };
  }

  /** The return has arrived (or nobody ran): count completed runs; anyone short of their ground is run out. */
  private resolveRuns(): void {
    const plan = this.fieldingPlan;
    if (!plan) return;
    const fielder = plan.fielder !== undefined ? this.opts.field[plan.fielder] : undefined;
    const name = fielder?.player.name ?? 'the fielder';
    const back = this.returnAt ?? this.time;
    // Runs started after the ball came back are not attempted.
    const attempted = this.runStarts.filter((s) => s < back);
    let completed = 0;
    let shortRun: number | undefined;
    attempted.forEach((start, i) => {
      const end = start + this.runLen(i);
      if (end <= back + 0.05) completed = i + 1;
      else if (shortRun === undefined) shortRun = i;
    });
    const dropped = plan.kind === 'dropped' ? `Dropped by ${name}! ` : '';
    if (shortRun !== undefined) {
      // Run `k`: the original striker runs towards the bowler's end on even runs.
      const towardsBowler = shortRun % 2 === 0;
      const strikerAtDangerEnd = (this.throwTo === 'bowler') === towardsBowler;
      const batter = strikerAtDangerEnd ? 'striker' : 'nonStriker';
      const who = batter === 'striker' ? this.opts.striker.name : (this.opts.nonStriker?.name ?? 'The non-striker');
      this.finish({
        runs: completed,
        wicket: { kind: 'runOut', fielder: name, batter },
        headline: 'RUN OUT!',
        detail: `${dropped}${who} short of his ground — throw from ${name}.${completed ? ` ${completed} run${completed > 1 ? 's' : ''} completed.` : ''}`,
      });
      return;
    }
    const runs = completed;
    const headline = runs === 0 ? (dropped ? 'Dropped!' : 'Fielded') : `${runs} run${runs > 1 ? 's' : ''}`;
    this.finish({ runs, headline, detail: `${dropped}${runs === 0 ? `Stopped by ${name}.` : `Fielded by ${name}.`}` });
  }

  private finish(r: {
    runs?: number;
    boundary?: 4 | 6;
    wicket?: { kind: WicketKind; fielder?: string; batter: 'striker' | 'nonStriker' };
    headline: string;
    detail: string;
    wide?: boolean;
    appeal?: { onField: Decision; tracking: LbwTracking };
  }): void {
    const d = this.delivery;
    const play = this.play;
    if (!d || !play) return;
    const noBall = d.noBall;
    // No wicket off a no-ball (bowled or caught), but runs off the bat count.
    const wicket = noBall ? undefined : r.wicket;
    const contact = play.contact;
    const shot = play.shot;
    const stroke = shot && contact && contact.kind !== 'leave' ? `${SHOTS[shot.shot].name}${contact.kind === 'edge' ? `, ${contact.edge} edge` : contact.kind === 'mistimed' ? ', mistimed' : ''}. ` : '';
    const timingMs = contact && shot && shot.shot !== 'leave' ? Math.round(contact.timingSeconds * 1000) : undefined;
    this.outcome = {
      runs: r.runs ?? 0,
      extras: noBall || r.wide ? 1 : 0,
      noBall,
      wide: r.wide === true && !noBall,
      ...(r.boundary ? { boundary: r.boundary } : {}),
      ...(wicket ? { wicket } : {}),
      headline: noBall && r.wicket ? 'NO BALL — not out!' : r.headline,
      detail: `${stroke}${r.detail}`.trim(),
      ...(shot ? { shot } : {}),
      ...(contact ? { contact } : {}),
      ...(timingMs !== undefined ? { timingMs } : {}),
      ...(r.appeal && !noBall ? { appeal: r.appeal } : {}),
      delivery: {
        name: d.type.name,
        speedKph: d.releaseSpeedKph,
        line: d.actual.atStumps?.x ?? 0,
        ...(d.actual.pitch ? { length: d.actual.pitch.z } : {}),
      },
    };
    this.phase = 'dead';
    this.deadAt = this.time;
    // A wicket that stands (not an lbw still to be decided): time for the fielders to get together.
    if (this.outcome?.wicket && !this.outcome.appeal) this.holdDead(1.8);
  }

  /** Fielders: the one going for the ball runs to the interception point; the rest drift towards the ball. */
  private moveFielders(dt: number): void {
    const plan = this.fieldingPlan;
    const contact = this.contactTime;
    this.opts.field.forEach((f, i) => {
      const p = this.fielderPos[i];
      if (!p) return;
      if (this.phase === 'runUp' || this.phase === 'inFlight') return;
      if (this.carrier === i) return;
      const since = contact !== undefined ? this.time - contact : 0;
      if (plan && contact !== undefined && plan.fielder === i && this.phase === 'struck') {
        const reaction = fielderReaction(f.player.fielding, false);
        if (since < reaction) return;
        const remaining = Math.max(1e-3, plan.interceptT - since);
        const dx = plan.interceptPos.x - p.x;
        const dz = plan.interceptPos.z - p.z;
        const d = Math.hypot(dx, dz);
        const step = Math.min(d, Math.max(d / remaining, 1) * dt, fielderSpeed(f.player.fielding) * dt);
        if (d > 1e-6) {
          p.x += (dx / d) * step;
          p.z += (dz / d) * step;
        }
        return;
      }
      if (this.phase !== 'struck' || !plan || contact === undefined || since < 0.4) return;
      const target = this.supportTarget(i, f.keeper, f.position.id === 'bowler');
      if (!target) return;
      const dx = target.x - p.x;
      const dz = target.z - p.z;
      const d = Math.hypot(dx, dz);
      const speed = target.urgent ? fielderSpeed(f.player.fielding) * 0.8 : 3;
      if (d > 0.3) {
        const step = Math.min(d, speed * dt);
        p.x += (dx / d) * step;
        p.z += (dz / d) * step;
      }
    });
  }

  /**
   * Where a fielder who is not chasing goes once the ball is hit — or
   * nowhere. As in a real field: the keeper comes up to the stumps for the
   * return, the bowler goes to the stumps at his end, and the nearest other
   * fielder backs up the chaser; everyone else stays where they are.
   */
  private supportTarget(i: number, keeper: boolean, bowler: boolean): { x: number; z: number; urgent: boolean } | undefined {
    const plan = this.fieldingPlan;
    if (!plan) return undefined;
    const far = Math.hypot(plan.interceptPos.x, plan.interceptPos.z - STRIKER_STUMPS_Z) > 12;
    if (keeper) return far ? { x: 0, z: STRIKER_STUMPS_Z + 0.7, urgent: true } : undefined;
    if (bowler) return far ? { x: 0.4, z: BOWLER_STUMPS_Z - 0.7, urgent: true } : undefined;
    if (!far) return undefined;
    // The backer-up: the nearest other outfielder to the interception, going behind it.
    if (this.backer === undefined) {
      let best = -1;
      let bestD = Infinity;
      this.opts.field.forEach((f, k) => {
        if (k === plan.fielder || f.keeper || f.position.id === 'bowler') return;
        const q = this.fielderPos[k];
        if (!q) return;
        const dd = Math.hypot(q.x - plan.interceptPos.x, q.z - plan.interceptPos.z);
        if (dd < bestD) {
          bestD = dd;
          best = k;
        }
      });
      this.backer = best;
    }
    if (i !== this.backer) return undefined;
    // A boundary: nobody can stop it, but the nearest fielder still chases it to the rope.
    if (plan.kind === 'boundary') return { x: plan.interceptPos.x * 0.97, z: plan.interceptPos.z * 0.97, urgent: true };
    const ix = plan.interceptPos.x;
    const iz = plan.interceptPos.z;
    const out = Math.hypot(ix, iz - STRIKER_STUMPS_Z) || 1;
    return { x: ix + (ix / out) * 8, z: iz + ((iz - STRIKER_STUMPS_Z) / out) * 8, urgent: false };
  }

  private backer: number | undefined;

  /** Where the ball should be drawn: in flight, or in a fielder's hands. */
  ballPosition(out: Vec3): Vec3 {
    if (this.carrier !== undefined) {
      const p = this.fielderPos[this.carrier];
      if (p) {
        // Gathered, then (if the batters are running) thrown in: a flat throw, or a lob that bounces in.
        const t = this.throwPlan;
        if (t && this.time > t.releaseAt) {
          const u = Math.min(1, (this.time - t.releaseAt) / Math.max(0.05, t.arriveAt - t.releaseAt));
          const tz = t.end === 'striker' ? STRIKER_STUMPS_Z : BOWLER_STUMPS_Z;
          // Where it arrives: on the stumps, or wide of them by the miss.
          const side = p.x >= 0 ? -1 : 1;
          const ax = t.direct ? 0 : side * Math.min(2.5, t.miss);
          out.x = p.x + (ax - p.x) * u;
          out.z = p.z + (tz - p.z) * u;
          const d = Math.hypot(p.x, p.z - tz);
          const loft = t.power < 0.35 ? Math.min(9, d * 0.18) : Math.min(4, d * 0.05);
          out.y = 1.9 + (0.45 - 1.9) * u + Math.sin(Math.PI * u) * loft;
          if (u >= 1 && !t.direct) {
            // Taken at the stumps.
            out.x = ax * 0.3;
            out.y = 0.8;
            out.z = tz + (t.end === 'striker' ? 0.6 : -0.6);
          }
          return out;
        }
        out.x = p.x;
        out.y = t || (this.collectedAt !== undefined && this.time - this.collectedAt > 0.3) ? 1.7 : 0.4;
        out.z = p.z;
        return out;
      }
    }
    const b = this.play?.ball.position;
    if (b) {
      out.x = b.x;
      out.y = b.y;
      out.z = b.z;
    } else {
      out.x = this.opts.bowler.bowlingArm === 'right' ? 0.25 : -0.25;
      out.y = 1.2;
      out.z = BOWLER_STUMPS_Z - 3;
    }
    return out;
  }
}
