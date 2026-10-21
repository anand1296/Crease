# Architecture

## Layers

```
React UI (src/ui, src/app)        HUD, overlays, loading/error states — reads a store snapshot
   │
State (src/state)                 zustand store: screen, match setup, UI flags + snapshot of the match, refreshed on match events
   │
Renderer (src/game/scenes)        react-three-fiber; reads the match every frame, never writes game state
   │
Match (src/game/match)            toss, innings, bowler quotas, scorecards, results; owns the fixed-step clock
   │
Session (src/game/session)        one ball's lifecycle: run-up → release → flight → struck → runs → dead
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
| `game/data/` | Ground dimensions, pitch presets, fielding positions, four fictional squads of sixteen |
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
| `game/session/deliveryCycle.ts` | Run-up → release → flight → struck → dead, with fielder movement, called runs, run-outs, wides and the outcome |
| `game/match/match.ts` | The match: toss, innings, strike, bowler eligibility and quotas, maidens, fall of wickets, scorecards, result, match-situation AI intent |
| `game/match/squad.ts` | Default XI, keeper choice, XI validation (errors and warnings) |
| `game/input/` | Keyboard (bindings as data, one shared instance), input → stroke mapping, wiring to the match |
| `game/audio/sound.ts` | Web Audio synthesis: bat, pads, stumps, bounce, catch, boundary, crowd ambience; mute persisted |
| `game/scenes/rig/Humanoid.tsx`, `motion.ts` | Control skeleton (posed procedurally; two-bone arm IK; also drawable from primitives) and the procedural motion library |
| `game/scenes/rig/Cricketer.tsx` | Skinned player model: loads the avatar, paints the kit through its mask (shader patch on `MeshStandardMaterial`), attaches helmet/cap/hat, pads and keeper's mitts to bones |
| `game/scenes/rig/avatarRig.ts` | Drives the model's skeleton from a motion-capture clip or by retargeting the control skeleton (bind-pose corrections, spine distribution, head look-at, model-side arm IK, finger grip), cross-fading between sources |
| `game/scenes/rig/avatarAssets.ts` | Asset URLs and the clip library loader |
| `game/scenes/camera/director.ts` | The broadcast director: which shot is on air and its framing, as a pure function of the ball's state (unit-tested) |
| `game/scenes/Effects.tsx` | High-quality post-processing chain |
| `scripts/avatars/` | Offline conversion of Rocketbox FBX avatars and clips to the runtime assets in `public/players/` |
| `game/scenes/MatchView.tsx` | Per-frame driver, players posed from the simulation, bat, ball, markers, camera rig; orbiting menu camera when no match is on |
| `game/scenes/Ground.tsx`, `Stadium.tsx`, `Stumps.tsx` | Field and pitch textures, stands, instanced crowd, instanced sponsor boards, floodlights, live scoreboard |
| `game/quality.ts` | Graphics quality: detection (software renderer → Low) and persistence |
| `state/game.ts` | zustand store: screens, match setup, match lifecycle (start, rematch, quit), pause, camera, sound, quality |
| `ui/Menus.tsx` | Main menu, match setup, squad board, how to play |
| `ui/Hud.tsx`, `ui/Scorecard.tsx` | Scoreboard strip, delivery panel, outcome banner, run prompt, bowler choice, bowling panel and meter, innings break, result, pause, help |
| `game/debug.ts` | Read-only `window.__crease` handles for browser tests |

## Frame loop

There is exactly one animation loop: react-three-fiber's. Each frame:

1. `Driver` hands the frame delta to `Match.advance`. The session's `FixedStepClock` runs a whole number of 1/240 s steps, each stepping the current `DeliveryCycle` → `BallInPlay` → physics.
2. The other views read the session in their own `useFrame` callbacks:
   - the bowler's run-up position;
   - the striker's body and bat, posed from the stroke's press/contact times so the sweet spot meets the ball at the simulated contact moment;
   - fielders, moving towards their simulated positions at a capped speed;
   - the ball, interpolated between the last two steps;
   - the camera.

   Meshes are positioned imperatively; nothing re-renders React per frame.
3. The match notifies subscribers on events (phase changes, ball outcomes, innings changes). The store converts that into a snapshot for the HUD, and the driver turns the same events into sounds.

Starting, restarting or quitting a match replaces the `Match` in the store. The players are keyed by innings, so every view resets with it, and the keyboard handler always reads the current match from the store. The canvas stays mounted throughout: the stadium is the backdrop to the menus.

## Determinism

- A match seed drives everything. Each ball gets its own forked RNG, and inside it the delivery, contact, fielding and AI decisions each get their own fork. Adding a draw in one system therefore does not perturb another.
- Tests check identical results for identical seeds at every level: delivery, stroke, fielding plan and whole matches.

## Testing

- **Unit and simulation (Vitest)**: `src/**/*.test.ts`, colocated. Covers physics, deliveries, batting acceptance behaviours, fielding, AI v AI sessions (scoring rates, invariants, determinism), whole AI matches (scorecards add up, quotas, no consecutive overs, chases stop at the target), squads and XI validation, input mapping, and human input rules (bowler choice, called running).
- **Browser (Playwright)**: `e2e/`, against the production build. Plays the game through the keyboard and observes state via `window.__crease`.
- **CI**: GitHub Actions runs both on every push and pull request.

## Deployment

A static Vite build in `dist/`. `vercel.json` configures Vercel's Git integration: production from `main`, previews for pull requests. Hashed assets are cached for a year, `index.html` is never cached, and a strict CSP allows only same-origin scripts.
