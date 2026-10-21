# Architecture

## Layers

```
React UI (src/ui, src/app)        HUD, overlays, loading/error states — reads a store snapshot
   │
State (src/state)                 zustand store: UI flags + snapshot of the session, refreshed on session events
   │
Renderer (src/game/scenes)        react-three-fiber; reads the session every frame, never writes game state
   │
Session (src/game/session)        ball lifecycle and innings bookkeeping; owns the fixed-step clock
   │
Simulation (core, physics,        deterministic TypeScript — no React or three.js imports;
  bowling, batting, fielding,     unit-tested headless in Node
  ai, simulation, data, model)
```

**Dependency rule: simulation code never imports React or three.js.** It stays deterministic, fast to test, and reusable for AI look-ahead. The AI and the tests run the same physics the game does.

## Modules

| Path | Responsibility |
| --- | --- |
| `game/core/rng.ts` | Seeded sfc32 RNG: serialisable, bounded normal draws, forked child streams (one per ball, per decision) |
| `game/core/fixedStep.ts` | Fixed-timestep accumulator with frame clamping and interpolation factor |
| `game/core/vec3.ts` | Allocation-free vector helpers |
| `game/physics/ball.ts` | Ball flight, drag, swing, spin, Coulomb bounce, seam/turn, rolling, rest |
| `game/data/` | Ground dimensions, pitch presets, fielding positions, sample teams (fictional) |
| `game/model/` | Player and difficulty types |
| `game/bowling/deliveryTypes.ts` | The 12 delivery recipes |
| `game/bowling/solver.ts` | Shooting-method launch solver; flight sampling |
| `game/bowling/execute.ts` | Plan → executed delivery (intended vs actual movement, error, no-balls) |
| `game/bowling/fatigue.ts` | Fatigue build-up and recovery |
| `game/batting/shots.ts` | The 16 strokes (+ push) as physical intentions |
| `game/batting/body.ts` | Contact plane by footwork and length; pads and body boxes |
| `game/batting/contact.ts` | Contact quality, bat contact point, impulse collision, edges |
| `game/batting/harness.ts` | Headless stroke simulation for tests and the report |
| `game/simulation/ballInPlay.ts` | One delivery from release to dead ball: stroke timing, the batter's perception, bat/pads/body/stumps/boundary |
| `game/fielding/plan.ts` | Interception planning, catches, fumbles, boundaries, safe runs |
| `game/ai/bowlingAi.ts`, `battingAi.ts` | Computer bowler and batter (perception-limited) |
| `game/session/deliveryCycle.ts` | Run-up → release → flight → struck → dead, with fielder movement and outcome |
| `game/session/practice.ts` | Innings bookkeeping: score, strike, overs, bowler changes, fatigue, figures |
| `game/input/` | Keyboard (bindings as data), input → stroke mapping, wiring to the session |
| `game/scenes/` | Ground, stumps, players, bat animation, ball, markers, camera rig |
| `state/game.ts` | zustand store, session lifecycle (restart, switch role) |
| `ui/Hud.tsx` | Scoreboard, delivery panel, outcome banner with timing feedback, bowling panel and meter, controls, help, pause |
| `game/debug.ts` | Read-only `window.__crease` handles for browser tests |

## Frame loop

There is exactly one animation loop: react-three-fiber's. Each frame:

1. `Driver` hands the frame delta to `PracticeSession.advance`. The session's `FixedStepClock` runs a whole number of 1/240 s steps, each stepping the current `DeliveryCycle` → `BallInPlay` → physics.
2. The other views read the session in their own `useFrame` callbacks:
   - the bowler's run-up position;
   - the striker's body and bat, posed from the stroke's press/contact times so the sweet spot meets the ball at the simulated contact moment;
   - fielders, moving towards their simulated positions at a capped speed;
   - the ball, interpolated between the last two steps;
   - the camera.

   Meshes are positioned imperatively; nothing re-renders React per frame.
3. The session notifies subscribers on events (phase changes, ball outcomes, setup changes). The store converts that into a snapshot for the HUD.

Restart and role switch create a new session. The scene is keyed by the session, so every view resets with it, and the keyboard handler always reads the current session from the store.

## Determinism

- A session seed drives everything. Each ball gets its own forked RNG, and inside it the delivery, contact, fielding and AI decisions each get their own fork. Adding a draw in one system therefore does not perturb another.
- Tests check identical results for identical seeds at every level: delivery, stroke, fielding plan and whole sessions.

## Testing

- **Unit and simulation (Vitest)**: `src/**/*.test.ts`, colocated. Covers physics, deliveries, batting acceptance behaviours, fielding, AI v AI sessions (scoring rates, invariants, determinism), input mapping, and human input rules.
- **Browser (Playwright)**: `e2e/`, against the production build. Plays the game through the keyboard and observes state via `window.__crease`.
- **CI**: GitHub Actions runs both on every push and pull request.

## Deployment

A static Vite build in `dist/`. `vercel.json` configures Vercel's Git integration: production from `main`, previews for pull requests. Hashed assets are cached for a year, `index.html` is never cached, and a strict CSP allows only same-origin scripts.
