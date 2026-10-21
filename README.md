# Crease

A browser-based 3D cricket game, built with React, TypeScript and Three.js. Inspired by the depth and replayability of classic cricket games: batting that rewards timing and shot selection, bowling with real variation, and an opponent that plays the ball rather than the dice.

> **Status: alpha (0.6.0).** Play a full limited-overs match against the computer: pick India, Pakistan, Australia or England with their current T20I squads, choose your playing XI and batting order, set the overs (2–50), difficulty and pitch, toss, bat and bowl both innings, and finish with a result and full scorecards. Real ball physics, sixteen strokes, twelve delivery types, LBW, wides, run-outs and bowler quotas; motion-captured, skinned player models in team kits; umpires who signal; a broadcast-style camera; post-processed graphics; and synthesised sound, including a physically modelled bat-on-ball crack. Game AI throughout: a bowling attack that learns your weaknesses, an AI captain that sets fields to where you score (within powerplay restrictions), T20-minded computer batters that read the field, spoken ball-by-ball commentary, and a coach that reviews your innings. See [Roadmap](#roadmap).

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

**Main menu → Play a match.** Choose your team and the opposition (India, Pakistan, Australia, England — each board's most recently announced men's T20I squad, 15–16 players), the number of overs, difficulty, pitch and who bats first (or toss for it). **Choose playing XI** opens the squad board: tick eleven players, reorder the batting order with ↑/↓, and the board warns you if the side has no keeper, fewer than five bowlers or no spinner. Then **Start match**.

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

<kbd>P</kbd> / <kbd>Esc</kbd> pause (resume, sound, commentary, restart, quit to menu) · <kbd>Enter</kbd> continue after the innings break · <kbd>C</kbd> camera · <kbd>M</kbd> sound on/off · <kbd>V</kbd> commentary on/off · <kbd>H</kbd> help. The game pauses itself when the window loses focus.

**Graphics** (main menu): *High* adds soft shadows, image-based lighting, the crowd, ambient occlusion, bloom, filmic tone mapping and up to 1.5× resolution; *Low* drops them for machines without a capable GPU. Low is chosen automatically when the browser reports a software renderer; your choice is remembered.

**Camera**: the default broadcast camera sits wide behind the bowler between balls, pushes in slowly through the run-up, holds tight on the striker at release, then cuts to a high side-on camera that follows the ball and the chase (or to the stumps when they are hit). <kbd>C</kbd> switches to the view from behind the striker or a high wide view.

## The AI opposition

- **It learns you.** When you bat, the computer's attack treats each delivery plan (yorker at the stumps, wide yorker, bouncer, slower ball, the corridor, the googly …) as an experiment and learns, ball by ball, which ones keep you quiet or get you out — and bowls more of them (Thompson sampling, pooled across your batting line-up). It starts from cricket sense (yorkers at the death, swing and slips with the new ball) and adapts within the match. Difficulty sets how ruthlessly it exploits what it has learned.
- **AI captain.** Fields are set every ball for the bowler, the phase of the innings and the batter's scoring areas, within the fielding restrictions: two men outside the circle in the powerplay, four in the middle overs, five at the death. Score heavily through midwicket and a man goes back there.
- **T20 batting.** In games of 20 overs or fewer the computer batters bat like a T20 side, and read the field — lofted shots go into the gaps between the boundary riders, pushes into the gaps in the ring.
- **Commentary.** Ball-by-ball commentary written from what happened (the delivery and its pace, the stroke and where it went, the fielder, milestones, the chase, what the bowlers' plan was), shown on screen and spoken by the browser's built-in voice. <kbd>V</kbd> toggles it.
- **Coach.** At the innings break and the end of the match the coach reviews your play: timing bias in milliseconds, the delivery that troubles you most and how to play it, shot selection, your best scoring stroke — and for your bowling, which balls worked and which were punished.

See [docs/TECHNICAL_ARCHITECTURE.md](docs/TECHNICAL_ARCHITECTURE.md) for how all of this is built.

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
- [docs/TECHNICAL_ARCHITECTURE.md](docs/TECHNICAL_ARCHITECTURE.md): the complete technical architecture — how the project was built, decisions, AI, testing, deployment and future scope

## Known limitations

- Controls follow the Cricket 07 scheme in spirit (direction + stroke-type keys, a timing-based release meter), not key for key.
- Running, walking, idling and celebrating use motion capture; batting strokes, the bowling action, keeping, fielding and throwing are procedural and retargeted onto the models, so they are believable rather than broadcast-perfect. Four body models are shared across all players.
- No byes, leg byes or overthrows; no DRS; the computer sets one standard field and does not change it.
- Running is all-or-nothing per run: you cannot send the non-striker back once a run is called.
- Audio is synthesised in the browser (bat, pads, stumps, bounce, catch, boundary, crowd reactions); there is no commentary and no continuous crowd bed.
- On software-rendered browsers (no GPU) even Low graphics runs slowly. Frame rate on real GPUs has not been measured yet.

## Assets and licensing

- **Players**: four Microsoft Rocketbox avatars (MIT licence, © 2020 Microsoft; [repository](https://github.com/microsoft/Microsoft-Rocketbox), notice in `public/players/LICENSE-Rocketbox.md`) with Rocketbox motion-capture clips (run, jog, walk, idle, cheer). They are converted offline by `scripts/avatars/` (FBX → glTF, 1024² textures, a baked kit mask so any team colours can be painted on, compact clip data) and the results are committed under `public/players/`.
- Everything else — the ground, stadium, crowd, ball, equipment, textures and all sounds — is generated procedurally in code.
- Teams and players are real: each board's most recently announced men's T20I squad as of October 2026 (sources in `src/game/data/teams.ts`). Names, batting hands and bowling styles are factual; the numeric ratings are the game's own approximations. Kits use national colours only, with no badges, logos or kit-maker marks, and the sponsors on the boards are fictional. Player names are used for a non-commercial fan project; a commercial release would need the relevant player and board licences. The UI typeface is Barlow Condensed (SIL Open Font License 1.1), bundled via `@fontsource/barlow-condensed`.
