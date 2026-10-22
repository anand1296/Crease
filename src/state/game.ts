import { create } from 'zustand';
import { sound } from '../game/audio/sound.ts';
import { type Quality, detectQuality, saveQuality } from '../game/quality.ts';
import { hush, readCommentaryEnabled, saveCommentaryEnabled } from '../game/audio/voice.ts';
import type { CommentaryLine } from '../game/ai/commentary.ts';
import type { CoachNote } from '../game/ai/coach.ts';
import { fieldingPhase } from '../game/ai/captain.ts';
import { Rng } from '../game/core/rng.ts';
import type { PitchId } from '../game/data/pitches.ts';
import { TEAMS, type Team } from '../game/data/teams.ts';
import type { DeliveryTypeId } from '../game/bowling/deliveryTypes.ts';
import { keyboard } from '../game/input/keyboardInstance.ts';
import { type BowlingSetup, GAME_SPEEDS, type GameSpeed, Match, type MatchPhase, type Review, type MatchResult, type InningsState, type BattingCard, type BowlingCard, type SideId } from '../game/match/match.ts';
import { defaultXi, keeperFor } from '../game/match/squad.ts';
import type { DifficultyId } from '../game/model/difficulty.ts';
import type { Hand, Player } from '../game/model/player.ts';
import type { BallOutcome } from '../game/session/deliveryCycle.ts';

/**
 * App state. The match itself lives in a Match instance (outside React);
 * this store holds which screen is showing, the match setup, a snapshot of
 * the match for the HUD (refreshed on match events), and UI flags. 3D
 * components read the Match directly every frame.
 */
export type Screen = 'menu' | 'setup' | 'squad' | 'match';
export type CameraMode = 'classic' | 'broadcast' | 'batter' | 'high';
export type BatFirst = 'toss' | 'user' | 'opponent';

export interface MatchSetup {
  readonly userTeamId: string;
  readonly opponentId: string;
  readonly overs: number;
  readonly difficulty: DifficultyId;
  readonly pitch: PitchId;
  readonly batFirst: BatFirst;
  readonly speed: GameSpeed;
  /** Selected XIs in batting order (player ids). */
  readonly userXi: readonly string[];
  readonly opponentXi: readonly string[];
}

export interface MatchSnapshot {
  readonly phase: MatchPhase;
  readonly ballPhase: 'runUp' | 'inFlight' | 'struck' | 'dead' | null;
  readonly inningsIndex: number;
  readonly innings: readonly InningsState[];
  readonly runs: number;
  readonly wickets: number;
  readonly balls: number;
  readonly overs: string;
  readonly maxOvers: number;
  readonly battingTeam: Team;
  readonly bowlingTeam: Team;
  readonly target: number | undefined;
  readonly needed: number | undefined;
  readonly ballsLeft: number | undefined;
  readonly userBatting: boolean;
  readonly userBowling: boolean;
  readonly striker: { readonly id: string; readonly name: string; readonly hand: Hand; readonly card: BattingCard | undefined };
  readonly nonStriker: { readonly id: string; readonly name: string; readonly card: BattingCard | undefined };
  readonly bowler: { readonly name: string; readonly style: string; readonly card: BowlingCard | undefined; readonly fatigue: number };
  readonly lastOutcome: BallOutcome | undefined;
  readonly ballCount: number;
  /** Set while the game waits for the player between balls. */
  readonly review: Review | undefined;
  /** Latest commentary line and how many there have been (to notice a new one). */
  readonly commentary: CommentaryLine | undefined;
  readonly commentaryCount: number;
  /** Powerplay / middle / death, from the fielding restrictions. */
  readonly fieldPhase: 'powerplay' | 'middle' | 'death';
  /** The coach's notes for the human side (at the innings break and the result). */
  readonly coach: { readonly batting: readonly CoachNote[]; readonly bowling: readonly CoachNote[] } | undefined;
  readonly recent: readonly string[];
  readonly setup: BowlingSetup;
  readonly deliveries: readonly DeliveryTypeId[];
  readonly releaseLocked: boolean;
  readonly eligibleBowlers: readonly { readonly player: Player; readonly overs: string }[];
  readonly suggestedBowlerId: string;
  readonly runsCalled: number;
  readonly result: MatchResult | undefined;
  readonly toss: string;
}

export interface GameState {
  readonly screen: Screen;
  readonly setup: MatchSetup;
  readonly match: Match | undefined;
  readonly snap: MatchSnapshot | undefined;
  readonly paused: boolean;
  readonly showHelp: boolean;
  readonly camera: CameraMode;
  readonly meter: number;
  readonly muted: boolean;
  readonly quality: Quality;
  readonly commentaryOn: boolean;
  /**
   * True from pressing Start until the new match's shaders are compiled and
   * its textures uploaded: a loading screen covers the game meanwhile, so
   * nothing stalls once play begins.
   */
  readonly warming: boolean;
  /** Adaptive graphics level, 0 (full) … 3 (lightest), lowered when frames run slow. */
  readonly perf: number;
  setWarming: (warming: boolean) => void;
  setPerf: (perf: number) => void;
  /** Action replays after wickets and boundaries (setting), and whether one is playing. */
  readonly replaysOn: boolean;
  readonly replaying: boolean;
  /** Who appears in the replay (so dismissed batters are drawn while it plays). */
  readonly replayIds: readonly string[];
  /** Skips a playing replay (set by the scene that owns the recorder). */
  skipReplay: () => void;
  setReplay: (playing: boolean, ids?: readonly string[], skip?: () => void) => void;
  toggleReplays: () => void;
  goTo: (screen: Screen) => void;
  updateSetup: (patch: Partial<MatchSetup>) => void;
  startMatch: () => void;
  rematch: () => void;
  quitToMenu: () => void;
  setPaused: (paused: boolean) => void;
  toggleHelp: () => void;
  cycleCamera: () => void;
  setMeter: (m: number) => void;
  toggleMute: () => void;
  toggleQuality: () => void;
  toggleCommentary: () => void;
}

const STYLE_NAMES: Record<string, string> = {
  fast: 'fast', fastMedium: 'fast-medium', medium: 'medium', offSpin: 'off-spin', legSpin: 'leg-spin', none: '',
};

export function styleName(p: Player): string {
  const s = STYLE_NAMES[p.bowlingStyle] ?? '';
  if (!s) return 'Does not bowl';
  const arm = p.bowlingArm === 'right' ? 'Right-arm' : 'Left-arm';
  const left = p.bowlingArm === 'left';
  if (p.bowlingStyle === 'offSpin') return left ? 'Left-arm orthodox' : 'Right-arm off-spin';
  if (p.bowlingStyle === 'legSpin') return left ? 'Left-arm wrist spin' : 'Right-arm leg-spin';
  return `${arm} ${s}`;
}

export function findTeam(id: string): Team {
  const t = TEAMS.find((x) => x.id === id) ?? TEAMS[0];
  if (!t) throw new Error('No teams');
  return t;
}

const ids = (players: readonly Player[]) => players.map((p) => p.id);

function snapshot(m: Match, toss: string): MatchSnapshot {
  const inn = m.current;
  const card = (p: Player) => inn.battingCards.find((c) => c.player.id === p.id);
  const bowler = m.bowler;
  const chase = m.chase;
  const humanBowlingChoice = m.phase === 'chooseBowler';
  return {
    phase: m.phase,
    ballPhase: m.cycle?.phase ?? null,
    inningsIndex: m.inningsIndex,
    innings: m.innings.slice(),
    runs: inn.runs,
    wickets: inn.wickets,
    balls: inn.balls,
    overs: m.overs,
    maxOvers: m.config.overs,
    battingTeam: m.battingSide.team,
    bowlingTeam: m.bowlingSide.team,
    target: inn.target,
    needed: chase?.needed,
    ballsLeft: chase?.ballsLeft,
    userBatting: m.humanBatting,
    userBowling: m.humanBowling,
    striker: { id: m.striker.id, name: m.striker.name, hand: m.striker.battingHand, card: card(m.striker) },
    nonStriker: { id: m.nonStriker.id, name: m.nonStriker.name, card: card(m.nonStriker) },
    bowler: {
      name: bowler.name,
      style: styleName(bowler),
      card: inn.bowlingCards.find((c) => c.player.id === bowler.id),
      fatigue: m.bowlerFatigue,
    },
    lastOutcome: m.lastOutcome,
    ballCount: m.history.length,
    review: m.phase === 'review' ? m.review : undefined,
    commentary: m.commentary[m.commentary.length - 1],
    commentaryCount: m.commentary.length,
    fieldPhase: fieldingPhase(m.config.overs, inn.balls),
    coach: m.phase === 'inningsBreak' || m.phase === 'complete' ? m.coachNotes() : undefined,
    recent: m.recent,
    setup: m.setup,
    deliveries: m.availableDeliveries,
    releaseLocked: m.cycle?.releaseLocked ?? false,
    eligibleBowlers: humanBowlingChoice ? m.eligibleBowlers().map((player) => ({ player, overs: m.oversBowledBy(player) })) : [],
    suggestedBowlerId: humanBowlingChoice ? m.suggestedBowler().id : '',
    runsCalled: m.cycle?.runStarts.length ?? 0,
    result: m.result,
    toss,
  };
}

const firstTeam = TEAMS[0];
const secondTeam = TEAMS[1];
if (!firstTeam || !secondTeam) throw new Error('Sample teams are missing');

const DEFAULT_SETUP: MatchSetup = {
  userTeamId: firstTeam.id,
  opponentId: secondTeam.id,
  overs: 5,
  difficulty: 'normal',
  pitch: 'balanced',
  batFirst: 'toss',
  speed: 'normal',
  userXi: ids(defaultXi(firstTeam)),
  opponentXi: ids(defaultXi(secondTeam)),
};

let unsubscribe: (() => void) | undefined;
let pendingStart = 0;

/** Runs `fn` after the browser has painted the current state (so a press shows at once). */
function afterPaint(fn: () => void): void {
  if (typeof requestAnimationFrame === 'undefined') {
    setTimeout(fn, 0);
    return;
  }
  requestAnimationFrame(() => setTimeout(fn, 0));
}
let seedCounter = 0;
const newSeed = () => `crease-${Date.now().toString(36)}-${seedCounter++}`;

function pick(team: Team, xiIds: readonly string[]): Player[] {
  const chosen = xiIds.map((id) => team.players.find((p) => p.id === id)).filter((p): p is Player => p !== undefined);
  return chosen.length === 11 ? chosen : defaultXi(team);
}

function createMatch(setup: MatchSetup, seed: string): { match: Match; toss: string } {
  const user = findTeam(setup.userTeamId);
  const opp = findTeam(setup.opponentId);
  const userXi = pick(user, setup.userXi);
  const oppXi = pick(opp, setup.opponentXi);
  let battingFirst: SideId;
  let toss: string;
  if (setup.batFirst === 'toss') {
    const userWins = new Rng(`${seed}:toss`).chance(0.5);
    const winner = userWins ? user : opp;
    // The toss winner chooses to bat on a flat deck, bowl on a green one, otherwise a coin flip of preference.
    const bat = setup.pitch === 'green' ? false : setup.pitch === 'flat' ? true : new Rng(`${seed}:choice`).chance(0.55);
    battingFirst = (userWins === bat) ? 'home' : 'away';
    toss = `${winner.name} won the toss and chose to ${bat ? 'bat' : 'bowl'}.`;
  } else {
    battingFirst = setup.batFirst === 'user' ? 'home' : 'away';
    toss = `${battingFirst === 'home' ? user.name : opp.name} bat first.`;
  }
  const match = new Match({
    home: { team: user, xi: userXi, keeperId: keeperFor(user, userXi)?.id ?? '', controller: 'human' },
    away: { team: opp, xi: oppXi, keeperId: keeperFor(opp, oppXi)?.id ?? '', controller: 'ai' },
    overs: setup.overs,
    battingFirst,
    pitch: setup.pitch,
    difficulty: setup.difficulty,
    seed,
  });
  match.speed = GAME_SPEEDS[setup.speed];
  return { match, toss };
}

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function saveFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // Not persisted.
  }
}

export const useGame = create<GameState>()((set, get) => {
  const attach = (match: Match, toss: string) => {
    unsubscribe?.();
    unsubscribe = match.subscribe(() => set({ snap: snapshot(match, toss) }));
    set({ match, snap: snapshot(match, toss), paused: false, meter: 0.5, screen: 'match', warming: true });
    keyboard.enabled = true;
  };

  return {
    screen: 'menu',
    setup: DEFAULT_SETUP,
    match: undefined,
    snap: undefined,
    paused: false,
    showHelp: false,
    camera: 'classic',
    meter: 0.5,
    muted: sound.muted,
    quality: detectQuality(),
    commentaryOn: readCommentaryEnabled(),
    warming: false,
    perf: 0,
    setWarming: (warming) => {
      if (get().warming !== warming) set({ warming });
    },
    setPerf: (perf) => {
      const p = Math.max(0, Math.min(3, Math.round(perf)));
      if (p !== get().perf) set({ perf: p });
    },
    replaysOn: readFlag('crease.replays', true),
    replaying: false,
    replayIds: [],
    skipReplay: () => undefined,
    setReplay: (replaying, ids = [], skip) => set({ replaying, replayIds: ids, ...(skip ? { skipReplay: skip } : {}) }),
    toggleReplays: () => {
      const replaysOn = !get().replaysOn;
      saveFlag('crease.replays', replaysOn);
      set({ replaysOn });
    },
    goTo: (screen) => {
      sound.unlock();
      keyboard.enabled = screen === 'match';
      set({ screen });
    },
    updateSetup: (patch) => {
      const s = get().setup;
      const next: MatchSetup = { ...s, ...patch };
      // Changing a team resets its XI to the default selection.
      const fixed: MatchSetup = {
        ...next,
        userXi: patch.userTeamId && patch.userTeamId !== s.userTeamId ? ids(defaultXi(findTeam(next.userTeamId))) : next.userXi,
        opponentXi: patch.opponentId && patch.opponentId !== s.opponentId ? ids(defaultXi(findTeam(next.opponentId))) : next.opponentXi,
      };
      set({ setup: fixed });
    },
    // Building a match (squads, AI, 24 skinned players) takes a moment: show the
    // loading screen first, then build it once that has been painted.
    startMatch: () => {
      sound.unlock();
      const ticket = ++pendingStart;
      set({ warming: true });
      afterPaint(() => {
        if (ticket !== pendingStart) return;
        const { match, toss } = createMatch(get().setup, newSeed());
        attach(match, toss);
      });
    },
    rematch: () => {
      const ticket = ++pendingStart;
      hush();
      set({ warming: true });
      afterPaint(() => {
        if (ticket !== pendingStart) return;
        const { match, toss } = createMatch(get().setup, newSeed());
        attach(match, toss);
      });
    },
    quitToMenu: () => {
      pendingStart++;
      unsubscribe?.();
      unsubscribe = undefined;
      keyboard.enabled = false;
      hush();
      set({ screen: 'menu', match: undefined, snap: undefined, paused: false, replaying: false, replayIds: [], warming: false });
    },
    setPaused: (paused) => {
      get().match?.setPaused(paused);
      if (paused) hush();
      set({ paused });
    },
    toggleHelp: () => set({ showHelp: !get().showHelp }),
    cycleCamera: () => {
      const order: CameraMode[] = ['classic', 'broadcast', 'batter', 'high'];
      const i = order.indexOf(get().camera);
      set({ camera: order[(i + 1) % order.length] ?? 'classic' });
    },
    setMeter: (meter) => {
      if (Math.abs(meter - get().meter) > 0.004) set({ meter });
    },
    toggleMute: () => {
      sound.unlock();
      const muted = !get().muted;
      sound.setMuted(muted);
      set({ muted });
    },
    toggleQuality: () => {
      const quality: Quality = get().quality === 'high' ? 'low' : 'high';
      saveQuality(quality);
      set({ quality });
    },
    toggleCommentary: () => {
      const commentaryOn = !get().commentaryOn;
      saveCommentaryEnabled(commentaryOn);
      if (!commentaryOn) hush();
      set({ commentaryOn });
    },
  };
});
