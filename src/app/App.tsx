import { lazy, type ReactNode, Suspense, useState } from 'react';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { Hud } from '../ui/Hud.tsx';
import { MainMenu, MatchSetup, SquadPicker } from '../ui/Menus.tsx';
import { useGameControls } from '../game/input/useGameControls.ts';
import { useGame } from '../state/game.ts';

// three.js is ~600 kB; load it after the shell paints so there is a loading state.
const GameCanvas = lazy(() => import('../game/scenes/GameCanvas.tsx').then((m) => ({ default: m.GameCanvas })));

type Status = 'loading' | 'ready';

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="overlay">
      <div className="panel" role="alert">
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function App() {
  const [status, setStatus] = useState<Status>('loading');
  const [webgl] = useState(hasWebGL);
  const screen = useGame((s) => s.screen);
  const quit = useGame((s) => s.quitToMenu);
  useGameControls();

  return (
    <div className="app" data-testid="app" data-status={webgl ? status : 'unsupported'} data-screen={screen}>
      {webgl ? (
        <ErrorBoundary
          fallback={(error, reset) => (
            <Panel title="Something went wrong">
              <p>{error.message}</p>
              <button
                type="button"
                onClick={() => {
                  quit();
                  reset();
                }}
              >
                Back to the main menu
              </button>
            </Panel>
          )}
        >
          {/* The stadium is always there: behind the menus as well as during play. */}
          <div className="stage" data-testid="game-canvas">
            <Suspense fallback={null}>
              <GameCanvas onReady={() => setStatus('ready')} />
            </Suspense>
          </div>
          {status === 'ready' ? (
            screen === 'menu' ? (
              <MainMenu />
            ) : screen === 'setup' ? (
              <MatchSetup />
            ) : screen === 'squad' ? (
              <SquadPicker />
            ) : (
              <Hud />
            )
          ) : null}
        </ErrorBoundary>
      ) : (
        <Panel title="WebGL is not available">
          <p>Crease needs WebGL to draw the ground. Try a current version of Chrome, Edge, Firefox or Safari.</p>
        </Panel>
      )}

      {webgl && status === 'loading' && (
        <div className="loading" aria-live="polite">
          Rolling the pitch…
        </div>
      )}
    </div>
  );
}
