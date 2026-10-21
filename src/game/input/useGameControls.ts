import { useEffect } from 'react';
import { useGame } from '../../state/game.ts';
import { shotFromInput } from './battingControls.ts';
import { KeyboardInput } from './keyboard.ts';

/** Shared keyboard instance; the frame loop reads held keys from it (for aiming). */
export const keyboard = new KeyboardInput();

/**
 * Wires the keyboard to the current session and UI. Attached once; reads
 * the latest store state on every key press, so restarts and role switches
 * need no re-subscription.
 */
export function useGameControls(): void {
  useEffect(() => {
    keyboard.onPress = (action) => {
      const g = useGame.getState();
      const s = g.session;
      switch (action) {
        case 'pause':
          g.setPaused(!g.paused);
          return;
        case 'restart':
          g.restart();
          return;
        case 'switchRole':
          g.switchRole();
          return;
        case 'camera':
          g.cycleCamera();
          return;
        case 'help':
          g.toggleHelp();
          return;
        default:
          break;
      }
      if (g.paused) return;
      if (g.role === 'batting') {
        if (action === 'ground' || action === 'loft' || action === 'defend' || action === 'sweep' || action === 'leave') {
          s.playShot(shotFromInput(action, keyboard.direction(), keyboard.isHeld('backFoot'), s.striker.battingHand));
        }
        return;
      }
      if (g.role === 'bowling') {
        if (action === 'bowl') s.bowlButton();
        else if (action === 'nextDelivery') s.cycleDelivery(1);
        else if (action === 'prevDelivery') s.cycleDelivery(-1);
      }
    };
    const detach = keyboard.attach(window);
    // Losing focus (tab switch, alt-tab) pauses rather than letting the ball fly unattended.
    const onBlur = () => useGame.getState().setPaused(true);
    const onVisibility = () => {
      if (document.hidden) useGame.getState().setPaused(true);
    };
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      detach();
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
}
