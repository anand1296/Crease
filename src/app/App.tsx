import { lazy, type ReactNode, Suspense, useState } from 'react';
import { ErrorBoundary } from './ErrorBoundary.tsx';

// three.js is ~600 kB; load it after the shell paints so there is a loading state.
const GameCanvas = lazy(() =>
  import('../game/scenes/GameCanvas.tsx').then((m) => ({ default: m.GameCanvas })),
);

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
    <div className="panel" role="alert">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function App() {
  const [status, setStatus] = useState<Status>('loading');
  const [webgl] = useState(hasWebGL);

  return (
    <div className="app" data-testid="app" data-status={webgl ? status : 'unsupported'}>
      {webgl ? (
        <ErrorBoundary
          fallback={(error, reset) => (
            <Panel title="Something went wrong">
              <p>{error.message}</p>
              <button type="button" onClick={reset}>
                Try again
              </button>
            </Panel>
          )}
        >
          <div className="stage" data-testid="game-canvas">
            <Suspense fallback={null}>
              <GameCanvas seed="p0-demo" onReady={() => setStatus('ready')} />
            </Suspense>
          </div>
        </ErrorBoundary>
      ) : (
        <Panel title="WebGL is not available">
          <p>Crease needs WebGL to draw the ground. Try a current version of Chrome, Edge, Firefox or Safari.</p>
        </Panel>
      )}

      <header className="hud-top">
        <span className="wordmark">CREASE</span>
        <span className="build-tag">pre-alpha · P0</span>
      </header>

      {webgl && status === 'loading' && (
        <div className="loading" aria-live="polite">
          Rolling the pitch…
        </div>
      )}

      <footer className="hud-bottom">Demo deliveries on the fixed-step simulation — batting arrives in P1.</footer>
    </div>
  );
}
