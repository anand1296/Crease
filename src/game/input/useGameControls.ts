import { useEffect } from 'react';
import { sound } from '../audio/sound.ts';
import { useGame } from '../../state/game.ts';
import { shotFromInput } from './battingControls.ts';
import type { GameAction } from './keyboard.ts';
import { keyboard } from './keyboardInstance.ts';

export { keyboard };

const PICKS: readonly GameAction[] = ['pick1', 'pick2', 'pick3', 'pick4', 'pick5', 'pick6', 'pick7', 'pick8', 'pick9'];

/**
 * Wires the keyboard to the current match and UI. Attached once; every key
 * press reads the latest store state, so new matches need no re-subscription.
 */
export function useGameControls(): void {
  useEffect(() => {
    keyboard.onPress = (action) => {
      sound.unlock();
      const g = useGame.getState();
      const m = g.match;
      if (!m || g.screen !== 'match' || g.warming) return;
      switch (action) {
        case 'pause':
          if (m.phase !== 'complete') g.setPaused(!g.paused);
          return;
        case 'camera':
          g.cycleCamera();
          return;
        case 'help':
          g.toggleHelp();
          return;
        case 'mute':
          g.toggleMute();
          return;
        case 'commentary':
          g.toggleCommentary();
          return;
        default:
          break;
      }
      if (g.paused) return;
      // A replay is playing: Enter or Space skips it.
      if (g.replaying) {
        if (action === 'confirm' || action === 'bowl' || action === 'run') g.skipReplay();
        return;
      }
      // Between balls the game waits for the player: Enter or Space moves on.
      if (m.phase === 'review') {
        if (action === 'confirm' || action === 'bowl' || action === 'run') m.next();
        return;
      }
      // Enter skips the rest of a dead ball.
      if (action === 'confirm' && m.phase === 'delivery' && m.cycle?.phase === 'dead') {
        m.next();
        return;
      }
      if (m.phase === 'inningsBreak' && (action === 'confirm' || action === 'bowl')) {
        m.continueAfterBreak();
        return;
      }
      if (m.phase === 'chooseBowler') {
        const i = PICKS.indexOf(action);
        const eligible = m.eligibleBowlers();
        if (i >= 0 && eligible[i]) m.chooseBowler(eligible[i].id);
        else if (action === 'confirm' || action === 'bowl') m.chooseBowler(m.suggestedBowler().id);
        return;
      }
      if (m.humanBatting) {
        if (action === 'ground' || action === 'loft' || action === 'defend' || action === 'sweep' || action === 'leave') {
          m.playShot(shotFromInput(action, keyboard.direction(), keyboard.isHeld('backFoot'), m.striker.battingHand));
        } else if (action === 'run') {
          m.callRun();
        }
        return;
      }
      if (m.humanBowling) {
        if (action === 'bowl') m.bowlButton();
        else if (action === 'nextDelivery') m.cycleDelivery(1);
        else if (action === 'prevDelivery') m.cycleDelivery(-1);
      }
    };
    const detach = keyboard.attach(window);
    // Losing focus (tab switch, alt-tab) pauses rather than letting the ball fly unattended.
    const pause = () => {
      const g = useGame.getState();
      if (g.screen === 'match' && g.match?.phase !== 'complete') g.setPaused(true);
    };
    const onVisibility = () => {
      if (document.hidden) pause();
    };
    window.addEventListener('blur', pause);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      detach();
      window.removeEventListener('blur', pause);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
}
