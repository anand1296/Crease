import type { Rng } from '../core/rng.ts';
import type { Vec3 } from '../core/vec3.ts';
import { BOWLER_STUMPS_Z } from '../data/field.ts';
import { type PitchPreset, groundFor } from '../data/pitches.ts';
import { type BattingAiOptions, decideStroke } from '../ai/battingAi.ts';
import type { ContactResult } from '../batting/contact.ts';
import { SHOTS, type ShotAttempt } from '../batting/shots.ts';
import { type DeliveryPlan, type ExecutedDelivery, executeDelivery } from '../bowling/execute.ts';
import { type Fielder, type FieldingPlan, fielderReaction, fielderSpeed, planFielding } from '../fielding/plan.ts';
import { type Player, isSpinner } from '../model/player.ts';
import type { GroundModel } from '../physics/ball.ts';
import { type BallEvent, BallInPlay } from '../simulation/ballInPlay.ts';

/**
 * One ball, end to end: run-up → release → flight (stroke) → struck ball and
 * fielding → dead ball with an outcome. Independent of React and the
 * renderer; the view reads its state each frame.
 */
export type CyclePhase = 'runUp' | 'inFlight' | 'struck' | 'dead';

export type WicketKind = 'bowled' | 'caught';

export interface BallOutcome {
  /** Runs credited to the batter (including boundaries). */
  readonly runs: number;
  readonly extras: number;
  readonly noBall: boolean;
  readonly boundary?: 4 | 6;
  readonly wicket?: { readonly kind: WicketKind; readonly fielder?: string };
  /** Short headline for the HUD. */
  readonly headline: string;
  /** One line of detail (shot, contact, fielder). */
  readonly detail: string;
  readonly shot?: ShotAttempt;
  readonly contact?: ContactResult;
  /** Timing of the stroke in milliseconds (positive = late), if a stroke was played. */
  readonly timingMs?: number;
  readonly delivery: { readonly name: string; readonly speedKph: number; readonly line: number; readonly length?: number };
}

export interface CycleOptions {
  readonly bowler: Player;
  readonly striker: Player;
  readonly field: readonly Fielder[];
  readonly pitch: PitchPreset;
  readonly plan: DeliveryPlan;
  readonly fatigue: number;
  readonly rng: Rng;
  /** Release quality if the bowler is computer-controlled; a human sets it during the run-up. */
  readonly releaseQuality?: number;
  /** Present when the striker is computer-controlled. */
  readonly battingAi?: Omit<BattingAiOptions, 'batter' | 'rng' | 'ground'>;
}

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
  readonly events: BallEvent[] = [];
  private releaseQuality: number | undefined;
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
    this.releaseTime = isSpinner(opts.bowler.bowlingStyle) ? 1.1 : 1.7;
    this.fielderPos = opts.field.map((f) => ({ ...f.start }));
  }

  get finished(): boolean {
    return this.phase === 'dead' && this.deadAt !== undefined && this.time - this.deadAt >= DEAD_SECONDS;
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

  /** Human batter commits to a stroke now. Ignored before release or once committed. */
  playShot(shot: ShotAttempt): boolean {
    if (this.phase !== 'inFlight' || !this.play?.canPlayShot) return false;
    const ok = this.play.playShot(shot);
    if (ok) this.shotTime = this.time;
    return ok;
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
    const delivery = executeDelivery(o.plan, {
      bowler: o.bowler,
      batterHand: o.striker.battingHand,
      pitch: o.pitch,
      fatigue: o.fatigue,
      // A human who never pressed gets a poorly timed release.
      releaseQuality: this.releaseQuality ?? 0.25,
      rng: this.rng.fork('delivery'),
    });
    this.delivery = delivery;
    this.play = new BallInPlay({ delivery, striker: o.striker, ground: this.ground, rng: this.rng.fork('contact') });
    this.phase = 'inFlight';
    if (o.battingAi) {
      const decision = decideStroke(delivery, { ...o.battingAi, batter: o.striker, rng: this.rng.fork('batting-ai'), ground: this.ground });
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
        this.fieldingPlan = planFielding(play.ball, this.opts.field, this.rng.fork('fielding'), this.ground);
        break;
      }
      case 'stumps':
        this.finish({ wicket: { kind: 'bowled' }, headline: 'BOWLED!', detail: ev.afterContact ? 'Dragged on.' : 'Through the gate.' });
        break;
      case 'pad':
        this.finish({ headline: 'Struck on the pad', detail: 'LBW reviews arrive in the next phase — not out for now.' });
        break;
      case 'body':
        this.finish({ headline: 'Hit on the body', detail: 'Dot ball.' });
        break;
      case 'passedBatter': {
        const shot = play.shot;
        const c = play.contact;
        const headline = !shot || shot.shot === 'leave' ? 'Left alone' : c?.kind === 'miss' ? 'Beaten!' : 'Dot ball';
        this.finish({ headline, detail: 'Taken by the keeper.' });
        this.carrier = this.opts.field.findIndex((f) => f.keeper);
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
      this.finish({ wicket: { kind: 'caught', fielder: name }, headline: 'CAUGHT!', detail: `Caught by ${name}${plan.difficulty > 0.5 ? ' — a fine catch' : ''}.` });
      return;
    }
    const runs = plan.runs;
    const dropped = plan.kind === 'dropped' ? `Dropped by ${name}! ` : '';
    const headline = runs === 0 ? (dropped ? 'Dropped!' : 'Fielded') : `${runs} run${runs > 1 ? 's' : ''}`;
    this.finish({ runs, headline, detail: `${dropped}${runs === 0 ? `Stopped by ${name}.` : `Fielded by ${name}.`}` });
  }

  private finish(r: {
    runs?: number;
    boundary?: 4 | 6;
    wicket?: { kind: WicketKind; fielder?: string };
    headline: string;
    detail: string;
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
      extras: noBall ? 1 : 0,
      noBall,
      ...(r.boundary ? { boundary: r.boundary } : {}),
      ...(wicket ? { wicket } : {}),
      headline: noBall && r.wicket ? 'NO BALL — not out!' : r.headline,
      detail: `${stroke}${r.detail}`.trim(),
      ...(shot ? { shot } : {}),
      ...(contact ? { contact } : {}),
      ...(timingMs !== undefined ? { timingMs } : {}),
      delivery: {
        name: d.type.name,
        speedKph: d.releaseSpeedKph,
        line: d.actual.atStumps?.x ?? 0,
        ...(d.actual.pitch ? { length: d.actual.pitch.z } : {}),
      },
    };
    this.phase = 'dead';
    this.deadAt = this.time;
  }

  /** Fielders: the one going for the ball runs to the interception point; the rest drift towards the ball. */
  private moveFielders(dt: number): void {
    const plan = this.fieldingPlan;
    const contact = this.contactTime;
    const ball = this.play?.ball.position;
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
      // Everyone else: a few steps towards the ball while it is live.
      if (this.phase === 'struck' && ball && since < 2.5 && !f.keeper) {
        const dx = ball.x - p.x;
        const dz = ball.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d > 3) {
          p.x += (dx / d) * 2.2 * dt;
          p.z += (dz / d) * 2.2 * dt;
        }
      }
    });
  }

  /** Where the ball should be drawn: in flight, or in a fielder's hands. */
  ballPosition(out: Vec3): Vec3 {
    if (this.carrier !== undefined) {
      const p = this.fielderPos[this.carrier];
      if (p) {
        out.x = p.x;
        out.y = 1.0;
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
