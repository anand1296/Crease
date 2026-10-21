import { create } from 'zustand';
import { TEAMS, type Team } from '../game/data/teams.ts';
import type { PitchId } from '../game/data/pitches.ts';
import type { DifficultyId } from '../game/model/difficulty.ts';
import type { BallOutcome } from '../game/session/deliveryCycle.ts';
import {
  type BattingFigures,
  type BowlingFigures,
  type BowlingSetup,
  type Controller,
  PracticeSession,
  type Score,
  type SessionPhase,
} from '../game/session/practice.ts';
import type { DeliveryTypeId } from '../game/bowling/deliveryTypes.ts';
import type { Hand } from '../game/model/player.ts';

/**
 * UI state. The simulation lives in PracticeSession (outside React); this
 * store holds a snapshot of what the HUD shows, refreshed whenever the
 * session reports a change, plus UI-only flags. 3D components read the
 * session directly every frame instead of going through React state.
 */
export type UserRole = 'batting' | 'bowling';
export type CameraMode = 'broadcast' | 'batter' | 'high';

export interface SessionSnapshot {
  readonly phase: SessionPhase;
  readonly ballPhase: 'runUp' | 'inFlight' | 'struck' | 'dead' | null;
  readonly score: Score;
  readonly overs: string;
  readonly battingTeam: string;
  readonly bowlingTeam: string;
  readonly striker: { readonly name: string; readonly hand: Hand; readonly figures: BattingFigures };
  readonly nonStriker: { readonly name: string; readonly figures: BattingFigures };
  readonly bowler: { readonly name: string; readonly style: string; readonly figures: BowlingFigures; readonly fatigue: number };
  readonly lastOutcome: BallOutcome | undefined;
  /** Increments with every ball, so the HUD can re-trigger animations. */
  readonly ballCount: number;
  readonly recent: readonly string[];
  readonly setup: BowlingSetup;
  readonly deliveries: readonly DeliveryTypeId[];
  readonly releaseLocked: boolean;
}

export interface GameState {
  readonly session: PracticeSession;
  readonly role: UserRole;
  readonly pitch: PitchId;
  readonly difficulty: DifficultyId;
  readonly snap: SessionSnapshot;
  readonly paused: boolean;
  readonly showHelp: boolean;
  readonly camera: CameraMode;
  /** Bowling accuracy meter, 0–1, updated every frame during a human run-up. */
  readonly meter: number;
  restart: () => void;
  switchRole: () => void;
  setPaused: (paused: boolean) => void;
  toggleHelp: () => void;
  cycleCamera: () => void;
  setMeter: (m: number) => void;
}

const STYLE_NAMES: Record<string, string> = {
  fast: 'Right-arm fast', fastMedium: 'Fast-medium', medium: 'Medium', offSpin: 'Off-spin', legSpin: 'Leg-spin', none: '',
};

function snapshot(s: PracticeSession): SessionSnapshot {
  const striker = s.striker;
  const nonStriker = s.nonStriker;
  const bowler = s.bowler;
  const style = STYLE_NAMES[bowler.bowlingStyle] ?? bowler.bowlingStyle;
  return {
    phase: s.phase,
    ballPhase: s.cycle?.phase ?? null,
    score: s.score,
    overs: s.overs,
    battingTeam: s.config.battingTeam.shortName,
    bowlingTeam: s.config.bowlingTeam.shortName,
    striker: { name: striker.name, hand: striker.battingHand, figures: s.battingFigures(striker) },
    nonStriker: { name: nonStriker.name, figures: s.battingFigures(nonStriker) },
    bowler: {
      name: bowler.name,
      style: bowler.bowlingArm === 'left' ? style.replace('Right-arm', 'Left-arm') : style,
      figures: s.bowlingFigures(bowler),
      fatigue: s.bowlerFatigue,
    },
    lastOutcome: s.lastOutcome,
    ballCount: s.history.length,
    recent: s.recent,
    setup: s.setup,
    deliveries: s.availableDeliveries,
    releaseLocked: s.cycle?.releaseLocked ?? false,
  };
}

function requireTeam(i: number): Team {
  const t = TEAMS[i];
  if (!t) throw new Error('Sample teams are missing');
  return t;
}
const USER_TEAM = requireTeam(0);
const OPPONENT = requireTeam(1);

function createSession(role: UserRole, pitch: PitchId, difficulty: DifficultyId, seed: string): PracticeSession {
  const human: Controller = 'human';
  const ai: Controller = 'ai';
  return new PracticeSession(
    role === 'batting'
      ? { battingTeam: USER_TEAM, bowlingTeam: OPPONENT, batting: human, bowling: ai, pitch, difficulty, seed }
      : { battingTeam: OPPONENT, bowlingTeam: USER_TEAM, batting: ai, bowling: human, pitch, difficulty, seed },
  );
}

let unsubscribe: (() => void) | undefined;

function attach(session: PracticeSession, set: (partial: Partial<GameState>) => void): void {
  unsubscribe?.();
  unsubscribe = session.subscribe(() => set({ snap: snapshot(session) }));
}

let seedCounter = 0;
const newSeed = () => `crease-${Date.now().toString(36)}-${seedCounter++}`;

export const useGame = create<GameState>()((set, get) => {
  const role: UserRole = 'batting';
  const pitch: PitchId = 'balanced';
  const difficulty: DifficultyId = 'normal';
  const session = createSession(role, pitch, difficulty, newSeed());
  attach(session, set);

  const replace = (next: PracticeSession, extra: Partial<GameState> = {}) => {
    attach(next, set);
    set({ session: next, snap: snapshot(next), paused: false, meter: 0.5, ...extra });
  };

  return {
    session,
    role,
    pitch,
    difficulty,
    snap: snapshot(session),
    paused: false,
    showHelp: false,
    camera: 'broadcast',
    meter: 0.5,
    restart: () => {
      const s = get();
      replace(createSession(s.role, s.pitch, s.difficulty, newSeed()));
    },
    switchRole: () => {
      const s = get();
      const next: UserRole = s.role === 'batting' ? 'bowling' : 'batting';
      replace(createSession(next, s.pitch, s.difficulty, newSeed()), { role: next });
    },
    setPaused: (paused) => {
      get().session.setPaused(paused);
      set({ paused });
    },
    toggleHelp: () => set({ showHelp: !get().showHelp }),
    cycleCamera: () => {
      const order: CameraMode[] = ['broadcast', 'batter', 'high'];
      const i = order.indexOf(get().camera);
      set({ camera: order[(i + 1) % order.length] ?? 'broadcast' });
    },
    setMeter: (meter) => {
      if (Math.abs(meter - get().meter) > 0.004) set({ meter });
    },
  };
});
