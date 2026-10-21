# Architecture

## Layers

```
React UI (src/app)            menus, HUD, error and loading states
   │
Renderer (src/game/scenes)    react-three-fiber scene; reads simulation state, never writes it
   │
Simulation (src/game/core,    deterministic TypeScript, no React or three.js imports;
  physics, simulation, data)  unit-tested in Node
```

The dependency rule: **simulation code never imports React or three.js.** That keeps it deterministic, fast to test, and reusable for AI look-ahead (the AI can run the same physics to predict where a ball will go).

## Modules (as built)

| Path | Responsibility |
| --- | --- |
| `src/main.tsx` | Mounts the app |
| `src/app/App.tsx` | Shell: WebGL detection, lazy-loads the 3D canvas, loading / error / unsupported states, HUD chrome |
| `src/app/ErrorBoundary.tsx` | Catches render errors and offers a reset |
| `src/game/core/rng.ts` | Seeded sfc32 RNG with serialisable state, bounded normal samples and forked child streams |
| `src/game/core/fixedStep.ts` | Fixed-timestep accumulator with frame clamping and an interpolation factor |
| `src/game/core/vec3.ts` | Allocation-free vector helpers for the simulation |
| `src/game/data/field.ts` | Ground dimensions shared by simulation and renderer |
| `src/game/data/fieldPositions.ts` | Named fielding positions as data |
| `src/game/physics/ball.ts` | Ball flight, drag, bounce, rolling, rest detection |
| `src/game/simulation/demoBowling.ts` | P0 attract-mode delivery loop (temporary) |
| `src/game/scenes/*` | Ground, stumps, placeholder figures, ball view, canvas setup |
| `src/game/camera/presets.ts` | Camera positions as data |
| `src/game/debug.ts` | Read-only `window.__crease` handles for browser tests |

Directories are created when there is code to put in them; the remaining structure (batting, bowling, match, ai, input, audio, ui, state, persistence) arrives with the phases that need it.

## Frame loop

There is exactly one animation loop: react-three-fiber's. Each frame:

1. `useFrame` hands the frame delta to the simulation's `FixedStepClock`.
2. The clock returns a whole number of 1/240 s steps; the simulation runs them.
3. The view interpolates between the previous and current state using the clock's leftover fraction, and writes the result directly to the mesh (no React state, no re-render).

## Testing

- **Unit (Vitest):** `src/**/*.test.ts`, colocated with the code. Runs in Node with no browser or WebGL.
- **Browser (Playwright):** `e2e/`, against the production build. Uses `window.__crease` to observe simulation state rather than comparing pixels.
- **CI:** GitHub Actions runs both on every push and pull request.

## Deployment

A static Vite build in `dist/`. `vercel.json` configures Vercel's Git integration: production deploys from `main`, previews for pull requests. Hashed assets are cached for a year, `index.html` is never cached, and a strict CSP allows only same-origin scripts.
