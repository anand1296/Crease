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
import { type AchievementId, earned, earnedByResult, unlock } from '../game/achievements.ts';
import { type ArrowScheme, readArrowScheme, saveArrowScheme } from '../game/input/battingControls.ts';
import { type AimStep, type Autoplay, type BowlingSetup, GAME_SPEEDS, type GameSpeed, Match, type MatchPhase, type Review, type MatchResult, type InningsState, type BattingCard, type BowlingCard, type SideId } from '../game/match/match.ts';
import { DELIVERY_TYPES } from '../game/bowling/deliveryTypes.ts';
import { stockSpeed } from '../game/bowling/execute.ts';
import type { FieldPreset } from '../game/fielding/presets.ts';
import { defaultXi, keeperFor } from '../game/match/squad.ts';
import type { DifficultyId } from '../game/model/difficulty.ts';
import type { Hand, Player } from '../game/model/player.ts';
import type { BallOutcome } from '../game/session/deliveryCycle.ts';
import type { ContactResult } from '../game/batting/contact.ts';
import type { Coaching } from '../game/batting/coaching.ts';
import type { VenueId } from '../game/data/venues.ts';
import type { WeatherId } from '../game/data/weather.ts';
import { type BatterState, timingScale } from '../game/batting/form.ts';
import { type SavedMatch, deleteSave, listSaves, writeSave } from '../game/match/save.ts';
import { type ChallengeId, type ChallengeStatus, challenge } from '../game/practice/challenges.ts';
import type { NetsBall, NetsBallId } from '../game/practice/nets.ts';
import { COIN_SETTLED, type CoinFace, type TossChoice, coinFor, computerChoice, flightTime, tossLine } from '../game/match/toss.ts';

/**
 * App state. The match itself lives in a Match instance (outside React);
 * this store holds which screen is showing, the match setup, a snapshot of
 * the match for the HUD (refreshed on match events), and UI flags. 3D
 * components read the Match directly every frame.
 */
export type Screen = 'menu' | 'setup' | 'squad' | 'toss' | 'match';

/**
 * The toss, before the match: the player calls, the opposing captain spins
 * the coin, and the winner chooses. The coin's face comes from the match
 * seed; the scene shows it land.
 */
export interface TossState {
  readonly seed: string;
  /** call: waiting for heads or tails; flip: the coin is in the air; result: the winner chooses (or has chosen). */
  readonly stage: 'call' | 'flip' | 'result';
  readonly call: CoinFace | undefined;
  readonly face: CoinFace;
  readonly userWins: boolean | undefined;
  /** The computer captain's choice when he wins. */
  readonly computerChoice: TossChoice;
  /** performance.now() of the flick (the coin leaves the hand), once called. */
  readonly flickAt: number | undefined;
}

/** Height of the captain's hand when he flicks the coin, m. */
export const TOSS_HAND_HEIGHT = 1.25;
/** From the call to the flick (the captain sets himself), ms. */
export const TOSS_WIND_UP = 450;
/** From the flick to the result: the flight, the coin settling, and a look at it on the pitch, ms. */
export const TOSS_REVEAL = (flightTime(TOSS_HAND_HEIGHT) + COIN_SETTLED + 1.6) * 1000;
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
  readonly venue: VenueId;
  readonly weather: WeatherId;
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
  /** Which side the human has in this innings (batting or bowling), on autoplay or not. */
  readonly userSide: 'batting' | 'bowling' | undefined;
  /** Autoplay asked for (the rest of the over or the innings), and whether the computer is playing this ball. */
  readonly autoplay: Autoplay;
  readonly autoplaying: boolean;
  /** The next ball is a free hit; this innings is a super over. */
  readonly freeHit: boolean;
  readonly superOver: boolean;
  readonly hatTrickBall: boolean;
  /** Practice: the challenge and how it is going. */
  readonly challenge: { readonly id: ChallengeId; readonly status: ChallengeStatus } | undefined;
  readonly striker: { readonly id: string; readonly name: string; readonly hand: Hand; readonly card: BattingCard | undefined; readonly form: BatterState };
  readonly nonStriker: { readonly id: string; readonly name: string; readonly card: BattingCard | undefined; readonly form: BatterState };
  readonly bowler: { readonly name: string; readonly style: string; readonly card: BowlingCard | undefined; readonly fatigue: number; readonly spell: number };
  /** An lbw decision open to review: who may review (you or the computer side), and reviews left. */
  readonly appeal:
    | { readonly onField: 'out' | 'notOut'; readonly yours: boolean; readonly reviewer: string; readonly reviewsLeft: number }
    | undefined;
  /** Unsuccessful reviews left this innings, batting side and bowling side. */
  readonly reviews: { readonly batting: number; readonly bowling: number };
  /** The striker's timing window relative to normal (confidence and tiredness), for the gauge's sweet spot. */
  readonly timingScale: number;
  readonly lastOutcome: BallOutcome | undefined;
  /** The stroke's contact (timing, quality) for the timing gauge: this ball's once it is hit, else the last ball's. */
  readonly contact: ContactResult | undefined;
  /** The coach on the human batter's last ball, once it is over (until the next one is bowled). */
  readonly coaching: Coaching | undefined;
  /** Coaching nets: the ball, how many faced, and the coach's read of each (latest last). */
  readonly nets: { readonly ball: NetsBall; readonly variant: number; readonly attempts: number; readonly log: readonly Coaching[] } | undefined;
  /** This ball's stroke, as soon as the bat has come down: how early (−) or late (+) the press was, ms. */
  readonly stroke: { readonly pressMs: number | undefined; readonly shot: string } | undefined;
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
  /** Human bowling: the step of setting up the ball, the field, and the pace locked in the run-up. */
  readonly aimStep: AimStep;
  readonly fieldPreset: string;
  readonly presets: readonly FieldPreset[];
  readonly lockedPace: number | undefined;
  /** Fielding: the ball is in hand and the batters are running — throw it in. */
  readonly awaitingThrow: boolean;
  /** Stock speed of the chosen delivery at 75% effort, km/h (the HUD scales it by the locked pace). */
  readonly deliveryKph: number;
  /** Where the fielders stand (world x/z) and which is the keeper, for the field map. */
  readonly fieldMap: readonly { readonly x: number; readonly z: number; readonly role: 'keeper' | 'bowler' | 'fielder' }[];
  readonly eligibleBowlers: readonly { readonly player: Player; readonly overs: string }[];
  readonly suggestedBowlerId: string;
  readonly runsCalled: number;
  readonly result: MatchResult | undefined;
  readonly toss: string;
}

export interface GameState {
  readonly screen: Screen;
  readonly setup: MatchSetup;
  readonly toss: TossState | undefined;
  readonly match: Match | undefined;
  readonly snap: MatchSnapshot | undefined;
  readonly paused: boolean;
  readonly showHelp: boolean;
  readonly camera: CameraMode;
  readonly meter: number;
  readonly muted: boolean;
  readonly quality: Quality;
  readonly commentaryOn: boolean;
  /** How the arrows aim a stroke: by the batter's sides (→ off side) or by the screen. */
  readonly arrows: ArrowScheme;
  /** A game controller is connected (its name), and whether it is the device in use (the panels show its buttons). */
  readonly padName: string | undefined;
  readonly padActive: boolean;
  /** Playing by touch (a phone or tablet): on-screen controls instead of the keyboard panel. */
  readonly touchActive: boolean;
  setTouchActive: (on: boolean) => void;
  /** Achievements just unlocked, announced on screen. */
  readonly toast: { readonly ids: readonly AchievementId[]; readonly at: number } | undefined;
  dismissToast: () => void;
  /** The coach's points and the keys for each ball, under the timing (on by default). */
  readonly coachTips: boolean;
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
  /** The practice challenge being played (or last played), if any. */
  readonly practice: ChallengeId | undefined;
  /** Coaching nets being played (the first ball chosen), if any. */
  readonly nets: NetsBallId | undefined;
  startNets: (ball: NetsBallId) => void;
  startPractice: (id: ChallengeId) => void;
  /** Saves the match in this browser (as it stood before the ball in play, if one is). */
  saveMatch: () => boolean;
  /** Loads a saved match and carries on from where it was saved. */
  loadMatch: (id: string) => boolean;
  deleteSavedMatch: (id: string) => void;
  /** The saved matches (newest first). */
  readonly saves: readonly SavedMatch[];
  /** At the toss: the player's call, then (if he won) his choice. */
  callToss: (call: CoinFace) => void;
  chooseAtToss: (choice?: TossChoice) => void;
  rematch: () => void;
  quitToMenu: () => void;
  setPaused: (paused: boolean) => void;
  toggleHelp: () => void;
  /** The field editor (the human captain placing his own field) is open. */
  readonly fieldEditor: boolean;
  setFieldEditor: (open: boolean) => void;
  cycleCamera: () => void;
  setMeter: (m: number) => void;
  toggleMute: () => void;
  toggleQuality: () => void;
  toggleCommentary: () => void;
  toggleArrows: () => void;
  setPadName: (name: string | undefined) => void;
  setPadActive: (on: boolean) => void;
  toggleCoachTips: () => void;
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

function readCoachTips(): boolean {
  try {
    return localStorage.getItem('crease.coachTips') !== '0';
  } catch {
    return true;
  }
}

export function findTeam(id: string): Team {
  const t = TEAMS.find((x) => x.id === id) ?? TEAMS[0];
  if (!t) throw new Error('No teams');
  return t;
}

const ids = (players: readonly Player[]) => players.map((p) => p.id);

function snapshot(m: Match, toss: string): MatchSnapshot {
  const inn = m.current;
  // (Computed first: reading it also adds it to the nets history.)
  const coaching =
    (m.phase === 'delivery' && m.cycle?.phase === 'dead') || m.phase === 'review' || m.phase === 'between' || m.phase === 'appeal'
      ? m.coaching(useGame.getState().arrows, useGame.getState().padActive)
      : undefined;
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
    userSide: m.userSide,
    autoplay: m.autoplay,
    autoplaying: m.autoplaying,
    freeHit: m.freeHit,
    superOver: m.superOver,
    hatTrickBall: m.hatTrickBall,
    challenge: m.config.practice ? { id: m.config.practice, status: m.challengeStatus ?? { state: 'on', progress: '' } } : undefined,
    striker: { id: m.striker.id, name: m.striker.name, hand: m.striker.battingHand, card: card(m.striker), form: { ...m.formOf(m.striker) } },
    nonStriker: { id: m.nonStriker.id, name: m.nonStriker.name, card: card(m.nonStriker), form: { ...m.formOf(m.nonStriker) } },
    timingScale: timingScale(m.formOf(m.striker)),
    appeal: m.appeal
      ? {
          onField: m.appeal.onField,
          yours: m.humanReviews(m.appeal),
          reviewer: m.side(m.appeal.reviewer).team.name,
          reviewsLeft: m.reviewsLeft[m.appeal.reviewer],
        }
      : undefined,
    reviews: { batting: m.reviewsLeft[inn.batting], bowling: m.reviewsLeft[inn.bowling] },
    bowler: {
      name: bowler.name,
      style: styleName(bowler),
      card: inn.bowlingCards.find((c) => c.player.id === bowler.id),
      fatigue: m.bowlerFatigue,
      spell: m.spellOf(bowler),
    },
    lastOutcome: m.lastOutcome,
    contact: m.humanBatting ? (m.cycle?.play?.contact ?? (m.phase === 'review' ? m.lastOutcome?.contact : undefined)) : undefined,
    nets: m.nets ? { ...m.nets, log: m.strokeLog.slice() } : undefined,
    stroke: (() => {
      const info = m.humanBatting && m.cycle?.play?.contact ? m.cycle.play.strokeInfo : undefined;
      return info ? { pressMs: info.pressError === undefined ? undefined : Math.round(info.pressError * 1000), shot: info.attempt.shot } : undefined;
    })(),
    coaching,
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
    aimStep: m.aimStep,
    fieldPreset: m.fieldPreset,
    presets: m.humanBowling ? m.availablePresets : [],
    lockedPace: m.lockedPace,
    awaitingThrow: m.awaitingThrow,
    deliveryKph: stockSpeed(bowler.bowlingStyle, bowler.bowling.pace) * DELIVERY_TYPES[m.setup.type].speedFactor * 3.6,
    fieldMap: m.humanBowling
      ? m.field.map((f) => ({ x: f.start.x, z: f.start.z, role: f.keeper ? ('keeper' as const) : f.position.id === 'bowler' ? ('bowler' as const) : ('fielder' as const) }))
      : [],
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
  venue: 'crease',
  weather: 'sunny',
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
/** A fresh match seed; a `?seed=` in the address fixes it (to replay a match, and for tests). */
const newSeed = () => {
  const fixed = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('seed');
  return fixed ? `${fixed}${seedCounter++ ? `-${seedCounter}` : ''}` : `crease-${Date.now().toString(36)}-${seedCounter++}`;
};

function pick(team: Team, xiIds: readonly string[]): Player[] {
  const chosen = xiIds.map((id) => team.players.find((p) => p.id === id)).filter((p): p is Player => p !== undefined);
  return chosen.length === 11 ? chosen : defaultXi(team);
}

function createMatch(setup: MatchSetup, seed: string, decided?: { battingFirst: SideId; toss: string }, practice?: ChallengeId, nets?: NetsBallId): { match: Match; toss: string } {
  const user = findTeam(setup.userTeamId);
  const opp = findTeam(setup.opponentId);
  const userXi = pick(user, setup.userXi);
  const oppXi = pick(opp, setup.opponentXi);
  let battingFirst: SideId;
  let toss: string;
  if (nets) {
    battingFirst = 'home';
    toss = 'Coaching nets: the same ball until you ask for another. Nothing is scored.';
  } else if (practice) {
    const c = challenge(practice);
    battingFirst = c.role === 'bat' ? 'home' : 'away';
    toss = `Practice: ${c.name}. ${c.goal}`;
  } else if (decided) {
    battingFirst = decided.battingFirst;
    toss = decided.toss;
  } else if (setup.batFirst === 'toss') {
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
    overs: practice ? 1 : setup.overs,
    battingFirst,
    pitch: setup.pitch,
    difficulty: setup.difficulty,
    seed,
    weather: setup.weather,
    venue: setup.venue,
    ...(practice ? { practice } : {}),
    ...(nets ? { nets: { ball: nets } } : {}),
  });
  match.speed = GAME_SPEEDS[setup.speed];
  return { match, toss };
}

let tossTimer: ReturnType<typeof setTimeout> | undefined;
const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now());

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
    let seen = match.history.length;
    let seenNets = 0;
    let resultSeen = match.phase === 'complete';
    unsubscribe = match.subscribe(() => {
      set({ snap: snapshot(match, toss) });
      // Achievements: every new ball the player took part in, and the result.
      const fresh: AchievementId[] = [];
      const nets = match.config.nets !== undefined;
      if (nets && match.strokeLog.length > seenNets) {
        seenNets = match.strokeLog.length;
        let streak = 0;
        for (let i = match.strokeLog.length - 1; i >= 0 && match.strokeLog[i]?.verdict === 'good'; i--) streak += 1;
        const o = match.lastOutcome;
        if (o) fresh.push(...earned({ outcome: o, batting: true, batterRuns: 0, timingMs: o.timingMs, netsStreak: streak }));
      }
      while (!nets && match.history.length > seen) {
        const o = match.history[seen];
        seen += 1;
        const side = match.userSide;
        if (!o || !side) continue;
        const batting = side === 'batting';
        const card = match.current.battingCards.find((c) => c.player.id === match.striker.id);
        const overDone = !batting && match.current.overs.at(-1);
        fresh.push(
          ...earned({
            outcome: o,
            batting,
            batterRuns: Math.max(card?.runs ?? 0, ...match.current.battingCards.map((c) => c.runs)),
            timingMs: o.timingMs,
            maiden: !!overDone && match.current.balls % 6 === 0 && match.current.balls > 0 && overDone.runs === 0,
            hatTrick: o.headline === 'HAT-TRICK!',
            deliveryType: match.cycle?.delivery?.type.id,
            dived: (match.cycle?.dives.length ?? 0) > 0,
          }),
        );
      }
      if (!resultSeen && match.phase === 'complete' && match.result && !match.config.practice && !nets) {
        resultSeen = true;
        const mine = match.config.home.controller === 'human' ? 'home' : match.config.away.controller === 'human' ? 'away' : undefined;
        const secondBat = match.innings[1]?.batting;
        fresh.push(
          ...earnedByResult({ won: mine !== undefined && match.result.winner === mine, battedSecond: secondBat === mine, superOver: match.innings.length > 2 }),
        );
      }
      const added = unlock(fresh);
      if (added.length) set({ toast: { ids: added, at: performance.now() } });
    });
    set({ match, snap: snapshot(match, toss), paused: false, meter: 0.5, screen: 'match', warming: true, toss: undefined });
    keyboard.enabled = true;
  };
  // Building a match (squads, AI, 24 skinned players) takes a moment: show the
  // loading screen first, then build it once that has been painted.
  const begin = (seed: string, decided?: { battingFirst: SideId; toss: string }, restore?: SavedMatch['state']) => {
    const ticket = ++pendingStart;
    set({ warming: true });
    afterPaint(() => {
      if (ticket !== pendingStart) return;
      const { match, toss } = createMatch(get().setup, seed, decided, restore ? undefined : get().practice, restore ? undefined : get().nets);
      if (restore) match.restoreState(restore);
      attach(match, toss);
    });
  };

  return {
    screen: 'menu',
    setup: DEFAULT_SETUP,
    toss: undefined,
    match: undefined,
    snap: undefined,
    paused: false,
    showHelp: false,
    camera: 'broadcast',
    meter: 0.5,
    muted: sound.muted,
    quality: detectQuality(),
    commentaryOn: readCommentaryEnabled(),
    arrows: readArrowScheme(),
    padName: undefined,
    padActive: false,
    touchActive: typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches,
    setTouchActive: (touchActive) => {
      if (get().touchActive !== touchActive) set({ touchActive });
    },
    toast: undefined,
    dismissToast: () => set({ toast: undefined }),
    coachTips: readCoachTips(),
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
      if (screen !== 'toss') clearTimeout(tossTimer);
      set({ screen, ...(screen !== 'toss' ? { toss: undefined } : {}) });
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
    // With "Toss for it", to the middle for the toss; otherwise straight to the match.
    startMatch: () => {
      sound.unlock();
      set({ practice: undefined, nets: undefined });
      const setup = get().setup;
      if (setup.batFirst === 'toss') {
        // To the middle for the toss first.
        const seed = newSeed();
        clearTimeout(tossTimer);
        keyboard.enabled = false;
        set({
          screen: 'toss',
          toss: { seed, stage: 'call', call: undefined, face: coinFor(seed), userWins: undefined, computerChoice: computerChoice(setup.pitch, seed), flickAt: undefined },
        });
        return;
      }
      begin(newSeed());
    },
    callToss: (call) => {
      const t = get().toss;
      if (!t || t.stage !== 'call') return;
      sound.unlock();
      set({ toss: { ...t, stage: 'flip', call, userWins: call === t.face, flickAt: now() + TOSS_WIND_UP } });
      clearTimeout(tossTimer);
      tossTimer = setTimeout(() => {
        const cur = get().toss;
        if (cur && cur.seed === t.seed && cur.stage === 'flip') set({ toss: { ...cur, stage: 'result' } });
      }, TOSS_WIND_UP + TOSS_REVEAL);
    },
    chooseAtToss: (choice) => {
      const t = get().toss;
      if (!t || t.stage !== 'result') return;
      const user = findTeam(get().setup.userTeamId);
      const opp = findTeam(get().setup.opponentId);
      const pick = t.userWins ? choice : t.computerChoice;
      if (!pick) return;
      // The user's side is 'home'.
      const userBats = t.userWins ? pick === 'bat' : pick === 'bowl';
      begin(t.seed, { battingFirst: userBats ? 'home' : 'away', toss: tossLine(t.userWins ? user.name : opp.name, pick) });
    },
    saves: listSaves(),
    practice: undefined,
    nets: undefined,
    startPractice: (id) => {
      sound.unlock();
      set({ practice: id, nets: undefined });
      begin(newSeed());
    },
    startNets: (ball) => {
      sound.unlock();
      set({ nets: ball, practice: undefined });
      begin(newSeed());
    },
    saveMatch: () => {
      const m = get().match;
      const snap = get().snap;
      if (!m || !snap || m.phase === 'complete') return false;
      const home = m.config.home.team;
      const away = m.config.away.team;
      const inn = m.current;
      const ok = writeSave({
        id: m.config.seed,
        savedAt: new Date().toISOString(),
        label: `${home.name} v ${away.name} — ${m.battingSide.team.shortName} ${inn.runs}/${inn.wickets} (${m.overs} ov)`,
        meta: { setup: { ...get().setup }, toss: snap.toss, battingFirst: m.config.battingFirst } as unknown as SavedMatch['meta'],
        state: m.saveState(),
      });
      set({ saves: listSaves() });
      return ok;
    },
    loadMatch: (id) => {
      const save = listSaves().find((s) => s.id === id);
      if (!save) return false;
      const meta = save.meta as unknown as { setup: MatchSetup; toss: string; battingFirst: SideId };
      sound.unlock();
      set({ setup: { ...DEFAULT_SETUP, ...meta.setup }, practice: undefined, nets: undefined });
      begin(save.id, { battingFirst: meta.battingFirst, toss: meta.toss }, save.state);
      return true;
    },
    deleteSavedMatch: (id) => {
      deleteSave(id);
      set({ saves: listSaves() });
    },
    rematch: () => {
      hush();
      // A practice challenge: the same one again.
      const id = get().practice;
      const nets = get().nets;
      if (id) get().startPractice(id);
      else if (nets) get().startNets(nets);
      else get().startMatch();
    },
    quitToMenu: () => {
      pendingStart++;
      unsubscribe?.();
      unsubscribe = undefined;
      keyboard.enabled = false;
      hush();
      clearTimeout(tossTimer);
      set({ screen: 'menu', match: undefined, snap: undefined, toss: undefined, paused: false, replaying: false, replayIds: [], warming: false });
    },
    setPaused: (paused) => {
      get().match?.setPaused(paused);
      if (paused) hush();
      set({ paused });
    },
    toggleHelp: () => set({ showHelp: !get().showHelp }),
    fieldEditor: false,
    setFieldEditor: (open) => {
      // While it is open the game's keys are off (the editor uses the arrows and Enter itself).
      keyboard.enabled = !open && get().screen === 'match';
      if (open) keyboard.clear();
      set({ fieldEditor: open });
    },
    cycleCamera: () => {
      const order: CameraMode[] = ['broadcast', 'classic', 'batter', 'high'];
      const i = order.indexOf(get().camera);
      set({ camera: order[(i + 1) % order.length] ?? 'broadcast' });
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
    setPadName: (padName) => set({ padName, ...(padName ? {} : { padActive: false }) }),
    setPadActive: (padActive) => set({ padActive }),
    toggleCoachTips: () => {
      const coachTips = !get().coachTips;
      try {
        localStorage.setItem('crease.coachTips', coachTips ? '1' : '0');
      } catch {
        // Not persisted.
      }
      set({ coachTips });
    },
    toggleArrows: () => {
      const arrows: ArrowScheme = get().arrows === 'batter' ? 'screen' : 'batter';
      saveArrowScheme(arrows);
      set({ arrows });
    },
    toggleCommentary: () => {
      const commentaryOn = !get().commentaryOn;
      saveCommentaryEnabled(commentaryOn);
      if (!commentaryOn) hush();
      set({ commentaryOn });
    },
  };
});
