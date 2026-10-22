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
        else if (action === 'field') m.cycleFieldPreset(keyboard.isHeld('lofted') ? -1 : 1);
        return;
      }
      if (m.humanBatting) {
        // Once the ball has been hit, D (as in Cricket 07) or Space calls a run.
        const struck = m.cycle?.phase === 'struck';
        if (action === 'run' || (struck && action === 'shotFeet')) {
          m.callRun();
          return;
        }
        if (action === 'shotFront' || action === 'shotBack' || action === 'shotFeet' || action === 'leave') {
          const kind = action === 'shotFront' ? 'front' : action === 'shotBack' ? 'back' : action === 'shotFeet' ? 'feet' : 'leave';
          m.playShot(shotFromInput(kind, keyboard.direction(), keyboard.isHeld('lofted'), m.striker.battingHand));
        }
        return;
      }
      if (m.humanBowling) {
        // 1 choose the delivery → 2 place the landing marker → 3 run in: lock the pace, vary the amount.
        const placing = m.phase === 'aiming' && m.aimStep === 'target';
        const pick = PICKS.indexOf(action);
        if (action === 'bowl' || action === 'confirm') m.bowlButton();
        else if (action === 'nextDelivery') m.cycleDelivery(1);
        else if (action === 'prevDelivery') m.cycleDelivery(-1);
        else if (pick >= 0) {
          const type = m.availableDeliveries[pick];
          if (type) m.selectDelivery(type);
        } else if (action === 'field') m.cycleFieldPreset(keyboard.isHeld('lofted') ? -1 : 1);
        else if (action === 'side') m.toggleSide();
        else if (action === 'back') m.aimBack();
        else if ((action === 'up' || action === 'down') && !placing) m.adjustAmount(action === 'up' ? 0.1 : -0.1);
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
