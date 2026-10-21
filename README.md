# Crease

A browser-based 3D cricket game, built with React, TypeScript and Three.js. Inspired by the depth and replayability of classic cricket games: batting that rewards timing and shot selection, bowling with real variation, and an opponent that plays the ball rather than the dice.

> **Status: alpha (0.3.0).** Play a full limited-overs match against the computer: pick from four fictional teams of sixteen, choose your playing XI and batting order, set the overs (2–50), difficulty and pitch, toss, bat and bowl both innings, and finish with a result and full scorecards. Real ball physics, sixteen strokes, twelve delivery types, LBW, wides, run-outs, bowler quotas, articulated players in a floodlit stadium, and synthesised sound. See [Roadmap](#roadmap).

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

**Main menu → Play a match.** Choose your team and the opposition (Harbour City Mariners, Highland Rangers, Sunrise Strikers, Riverside Royals; sixteen players each), the number of overs, difficulty, pitch and who bats first (or toss for it). **Choose playing XI** opens the squad board: tick eleven players, reorder the batting order with ↑/↓, and the board warns you if the side has no keeper, fewer than five bowlers or no spinner. Then **Start match**.

Each bowler may bowl at most a fifth of the overs (rounded up) and never two overs in a row. Out of overs, all out, or the target reached ends an innings; the result screen shows the margin, top performers and both scorecards. <kbd>H</kbd> shows the controls in the game.

### Batting

Hold an arrow for direction, then press a stroke key **as the ball arrives**. The key press is when you commit: the bat reaches the ball a fraction of a second later (each stroke has its own swing time), so press slightly before the ball reaches the batter. Directions are screen-relative: left is the left of the screen, whichever hand the batter uses.

| Key | Stroke |
| --- | --- |
| <kbd>D</kbd> | Ground stroke. ↑ straight drive · ↖ off drive · ← cover drive · ↗ on drive · → flick · ↙ late cut · ↘ / ↓ leg glance. Hold <kbd>Shift</kbd>: ← square cut, → pull, back-foot drives |
| <kbd>A</kbd> | Lofted stroke. ↑ lofted drive; any other direction lofts the ball that way; <kbd>Shift</kbd> + leg side or ↓ = hook |
| <kbd>S</kbd> | Defend. No arrow = dead bat; with an arrow = push into that gap for a single |
| <kbd>W</kbd> | Sweep (leg side); with the off-side arrow = reverse sweep |
| <kbd>X</kbd> | Leave |
| <kbd>Shift</kbd> | Hold for back-foot versions |
| <kbd>Space</kbd> / <kbd>R</kbd> | Run. Press again for each further run. Boundaries need no running; anything else only counts if you run it, and if the throw beats you, you are run out |

### Bowling

| Key | Action |
| --- | --- |
| <kbd>1</kbd>–<kbd>9</kbd> / <kbd>Enter</kbd> | At the start of each over: pick the bowler from the eligible list, or take the suggestion |
| <kbd>Q</kbd> / <kbd>E</kbd> | Previous / next delivery type (the bowler's own repertoire) |
| Arrows | Move the gold target: line (left/right) and length (up/down) |
| <kbd>Space</kbd> | Run in; press again while the accuracy needle is in the gold for a clean release |

### General

<kbd>P</kbd> / <kbd>Esc</kbd> pause (resume, sound, restart, quit to menu) · <kbd>Enter</kbd> continue after the innings break · <kbd>C</kbd> camera · <kbd>M</kbd> sound on/off · <kbd>H</kbd> help. The game pauses itself when the window loses focus.

**Graphics** (main menu): *High* draws shadows, the crowd and high-DPI frames; *Low* drops them for machines without a capable GPU. Low is chosen automatically when the browser reports a software renderer; your choice is remembered.

## Deployment

The game is a fully static site (no backend, no API keys).

**Vercel (primary).** The GitHub repository is connected to Vercel. `vercel.json` sets the framework, install/build commands and output directory, long-lived caching for hashed assets and security headers (CSP, HSTS, frame denial). Every push to `main` deploys to production and every pull request gets a preview URL.

**Any static host.** Run `npm run build` and upload `dist/`. The app has a single route, so no rewrite rules are needed.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request:

1. **checks**: install, type check, lint, unit tests, production build
2. **e2e**: Playwright (Chromium with software WebGL) loads the built game and plays it through the menus and keyboard: match setup, swapping players in the XI, strokes timed to the live ball and runs called, pause, quit to menu; choosing a bowler, a delivery and a target and bowling a ball; fails on any console error

## Roadmap

Built in phases; each phase ships a verified vertical slice.

| Phase | Scope | Status |
| --- | --- | --- |
| P0 | Project boots, 3D ground renders, seeded RNG, fixed-step loop, ball physics core, CI + deploy | ✅ Done |
| P1 | Delivery engine, batting input and contact model, fielding, scoring, playable practice innings (bat or bowl) | ✅ Done |
| P2–P4 (0.3.0) | LBW, wides, called running and run-outs; match engine (toss, innings, targets, quotas, results, scorecards); four squads of sixteen and XI selection; menus; articulated players, stadium, crowd; audio; graphics quality | ✅ Done |
| Next | Field settings and captaincy, stroke animation detail, replays, broadcast-style overlays, more teams and tournaments | — |
| Later | Performance on low-end devices, touch/gamepad controls, production hardening | — |

## Documentation

- [GAME_DESIGN.md](GAME_DESIGN.md): rules, simulation model and tuning decisions
- [ARCHITECTURE.md](ARCHITECTURE.md): modules and how they fit together
- [CHANGELOG.md](CHANGELOG.md): milestones
- [docs/batting-report.md](docs/batting-report.md): batting outcome distributions

## Known limitations

- Controls follow the Cricket 07 scheme in spirit (direction + stroke-type keys, a timing-based release meter), not key for key.
- Players are procedural, articulated figures with procedural motion, not motion-captured models; faces and kits are simple.
- No byes, leg byes or overthrows; no DRS; the computer sets one standard field and does not change it.
- Running is all-or-nothing per run: you cannot send the non-striker back once a run is called.
- Audio is synthesised in the browser (bat, pads, stumps, bounce, catch, boundary, crowd); there is no commentary.
- On software-rendered browsers (no GPU) even Low graphics runs slowly.

## Assets and licensing

All geometry, textures and sounds are generated procedurally in code. No third-party game assets, player likenesses or roster data are bundled; all teams, players and sponsors are fictional. The UI typeface is Barlow Condensed (SIL Open Font License 1.1), bundled via `@fontsource/barlow-condensed`.
