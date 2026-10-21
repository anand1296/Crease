# Crease

A browser-based 3D cricket game, built with React, TypeScript and Three.js. Inspired by the depth and replayability of classic cricket games: batting that rewards timing and shot selection, bowling with real variation, and an opponent that plays the ball rather than the dice.

> **Status: pre-alpha (phase P1 complete).** You can bat against a computer bowler or bowl at a computer batter in an open-ended practice innings, with real ball physics, sixteen strokes, twelve delivery types, fielding, catches, runs and wickets. Full matches (innings, targets, results) arrive in P3. See [Roadmap](#roadmap).

## Running locally

Requires Node 22+.

```bash
npm install
npm run dev          # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Type check, then production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | ESLint (typescript-eslint strict + React hooks) |
| `npm test` | Vitest unit and simulation tests (no browser needed) |
| `npm run test:e2e` | Playwright browser tests against the production build (run `npm run build` first) |
| `npm run report:batting` | Regenerates [docs/batting-report.md](docs/batting-report.md), outcome distributions from the batting model |
| `npm run check` | Type check, lint and unit tests together |

Browser tests: to test a deployed build use `E2E_BASE_URL=https://… npm run test:e2e`; to use an already-installed Chromium instead of Playwright's download use `PW_CHROMIUM_PATH=/path/to/chrome npm run test:e2e`.

## How to play

The game starts with you **batting**. Press <kbd>Tab</kbd> at any time to switch to **bowling** (this starts a new innings). <kbd>H</kbd> shows the in-game help.

### Batting

Hold an arrow for direction, then press a stroke key **as the ball arrives**. The key press is when you commit: the bat reaches the ball a fraction of a second later (each stroke has its own swing time), so press slightly before the ball reaches the batter. Directions are screen-relative: left is the left of the screen, whichever hand the batter uses.

| Key | Stroke |
| --- | --- |
| <kbd>D</kbd> | Ground stroke. ↑ straight drive · ↖ off drive · ← cover drive · ↗ on drive · → flick · ↙ late cut · ↘ / ↓ leg glance. Hold <kbd>Shift</kbd>: ← square cut, → pull, back-foot drives |
| <kbd>A</kbd> | Lofted stroke. ↑ lofted drive; any other direction lofts the ball that way; <kbd>Shift</kbd> + leg side or ↓ = hook |
| <kbd>S</kbd> | Defend. No arrow = dead bat; with an arrow = push into that gap for a single |
| <kbd>W</kbd> | Sweep (leg side); with the off-side arrow = reverse sweep |
| <kbd>Space</kbd> | Leave |
| <kbd>Shift</kbd> | Hold for back-foot versions |

### Bowling

| Key | Action |
| --- | --- |
| <kbd>Q</kbd> / <kbd>E</kbd> | Previous / next delivery type (the bowler's own repertoire) |
| Arrows | Move the gold target: line (left/right) and length (up/down) |
| <kbd>Space</kbd> | Run in; press again while the accuracy needle is in the gold for a clean release |

### General

<kbd>P</kbd> / <kbd>Esc</kbd> pause · <kbd>R</kbd> restart · <kbd>Tab</kbd> switch batting/bowling · <kbd>C</kbd> camera · <kbd>H</kbd> help. The game pauses itself when the window loses focus.

## Deployment

The game is a fully static site (no backend, no API keys).

**Vercel (primary).** The GitHub repository is connected to Vercel. `vercel.json` sets the framework, install/build commands and output directory, long-lived caching for hashed assets and security headers (CSP, HSTS, frame denial). Every push to `main` deploys to production and every pull request gets a preview URL.

**Any static host.** Run `npm run build` and upload `dist/`. The app has a single route, so no rewrite rules are needed.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request:

1. **checks**: install, type check, lint, unit tests, production build
2. **e2e**: Playwright (Chromium with software WebGL) loads the built game and plays it through the keyboard: strokes timed to the live ball, scoring and HUD updates, pause, bowling a ball, restart; fails on any console error

## Roadmap

Built in phases; each phase ships a verified vertical slice.

| Phase | Scope | Status |
| --- | --- | --- |
| P0 | Project boots, 3D ground renders, seeded RNG, fixed-step loop, ball physics core, CI + deploy | ✅ Done |
| P1 | Delivery engine, batting input and contact model, fielding, scoring, playable practice innings (bat or bowl) | ✅ Done |
| P2 | Batting depth: LBW, running between the wickets under your control, stroke tuning, richer feedback | Next |
| P3 | Match engine (innings, targets, extras, results, scorecards), match-situation AI, difficulty, field settings | — |
| P4 | Menus, match setup, rosters, animation, audio, cameras | — |
| P5 | Performance, polish, production hardening | — |

## Documentation

- [GAME_DESIGN.md](GAME_DESIGN.md): rules, simulation model and tuning decisions
- [ARCHITECTURE.md](ARCHITECTURE.md): modules and how they fit together
- [CHANGELOG.md](CHANGELOG.md): milestones
- [docs/batting-report.md](docs/batting-report.md): batting outcome distributions

## Known limitations (P1)

- No LBW yet: a ball hitting the pad is a dot ball. Wides are not called.
- Running is automatic: the batters take the runs that are safe; no run-outs yet.
- Practice innings only: no targets, results or full scorecards until P3.
- One standard field; the computer does not yet set fields or adapt tactics to the match situation.
- Stylised placeholder players (primitives, no skeletal animation); no audio yet.

## Assets and licensing

All geometry and textures are generated procedurally in code. No third-party game assets, player likenesses or roster data are bundled; all players are fictional.
