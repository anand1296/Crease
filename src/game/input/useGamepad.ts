import { useEffect } from 'react';
import { useGame } from '../../state/game.ts';
import { GamepadInput, type PadContext } from './gamepad.ts';
import { keyboard } from './keyboardInstance.ts';

/** What the pad's buttons should do right now (see gamepad.ts). */
export function padContext(): PadContext {
  const g = useGame.getState();
  const m = g.match;
  if (g.screen !== 'match' || !m || g.paused || g.showHelp || g.fieldEditor || g.warming) return 'menu';
  if (g.replaying) return 'wait';
  switch (m.phase) {
    case 'complete':
    case 'chooseBowler':
      return 'menu';
    case 'review':
    case 'inningsBreak':
    case 'appeal':
    case 'drs':
      return 'wait';
    default:
      break;
  }
  if (m.phase === 'delivery' && m.cycle?.phase === 'dead') return 'wait';
  if (m.humanBatting) return 'bat';
  if (m.humanBowling) return 'bowl';
  return 'wait';
}

/** Game controllers: polled every frame while the app is open. */
export function useGamepad(): void {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const pad = new GamepadInput(keyboard, padContext);
    pad.onActive = (on) => useGame.getState().setPadActive(on);
    const connected = (e: GamepadEvent) => useGame.getState().setPadName(e.gamepad.id);
    const gone = () => {
      const any = [...navigator.getGamepads()].some((p) => p?.connected);
      if (!any) useGame.getState().setPadName(undefined);
    };
    window.addEventListener('gamepadconnected', connected);
    window.addEventListener('gamepaddisconnected', gone);
    const stop = pad.start();
    return () => {
      stop();
      window.removeEventListener('gamepadconnected', connected);
      window.removeEventListener('gamepaddisconnected', gone);
    };
  }, []);
}
