# Crease

A browser-based 3D cricket game, built with React, TypeScript and Three.js. Inspired by the depth and replayability of classic cricket games: batting that rewards timing and shot selection, bowling with real variation, and an opponent that plays the ball rather than the dice.

> **Status: alpha (0.9.0).** Play a full limited-overs match against the computer: pick India, Pakistan, Australia or England with their current T20I squads, choose your playing XI and batting order, set the overs (2–20), difficulty and pitch, toss, bat and bowl both innings, and finish with a result and full scorecards. The game waits for you between balls, sums up every over and wicket with the scorecard, replays wickets and boundaries, and runs at a speed you choose. Real ball physics, sixteen strokes, sixteen delivery types with swing, cut and spin you control, ten T20 field presets, over or around the wicket, realistic bowling actions, LBW, wides, run-outs and bowler quotas; motion-captured, skinned player models in team kits; umpires who signal; a broadcast-style camera; post-processed graphics; and synthesised sound, including a physically modelled bat-on-ball crack. Game AI throughout: a bowling attack that learns your weaknesses, an AI captain that sets fields to where you score (within powerplay restrictions), T20-minded computer batters that read the field, spoken ball-by-ball commentary, and a coach that reviews your innings. See [Roadmap](#roadmap).

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

**The toss** (with *Toss for it*): the two captains meet the match referee on the pitch. Call <kbd>H</kbd> heads or <kbd>T</kbd> tails, watch the coin come down, and if you win choose <kbd>B</kbd> bat or <kbd>L</kbd> bowl; if you lose, the other captain decides.

**Pace of play**: after each ball the game waits for <kbd>Enter</kbd> / <kbd>Space</kbd> (*Next ball*). At the end of every over you get an over summary with the scorecard, and after every wicket a dismissal card (how out, fall of wicket, partnership, next batter) with the scorecard. Wickets and boundaries are replayed in slow motion first (<kbd>Enter</kbd> skips; *Replays* can be switched off in the menus). **Game speed** in match setup: Relaxed, Normal (default, 0.8×) or Real time. The controls panel on the left of the screen shows the keys at all times, lights them as you press them, and names the stroke you are about to play.

Each bowler may bowl at most a fifth of the overs (rounded up) and never two overs in a row. Out of overs, all out, or the target reached ends an innings; the result screen shows the margin, top performers and both scorecards. <kbd>H</kbd> shows the controls in the game.

### Batting

The controls follow EA Sports Cricket 07's keyboard scheme. Hold an arrow for direction, then press a shot key **as the ball arrives**: the key press is when you commit, and the bat reaches the ball a fraction of a second later (each stroke has its own swing time). Arrows are screen directions from behind the bowler, whichever hand the batter uses: <kbd>↓</kbd> straight back past the bowler, <kbd>←</kbd>/<kbd>→</kbd> square, <kbd>↙</kbd><kbd>↘</kbd> in front of square, <kbd>↖</kbd><kbd>↗</kbd> behind square. A white marker shows where the bowler is aiming to pitch it from the start of his run-up; the timing gauge shows how early or late you were.

| Key | Shot |
| --- | --- |
| <kbd>S</kbd> | Front-foot shot: ↓ straight drive, ↙ cover drive, ← square drive, ↖ late cut, ↘ on drive, → flick, ↗ sweep. Alone: forward defence |
| <kbd>W</kbd> | Back-foot shot: ↓ punch, ↙ back-foot drive, ← square cut, ↖ late cut, ↘ on drive, → pull, ↗ fine pull. Alone: back-foot defence |
| <kbd>D</kbd> | Use your feet: step down the pitch and drive or work it to leg (miss it and you may be stumped). Alone: smother it |
| <kbd>A</kbd> | Leave |
| <kbd>Shift</kbd> (hold) | Lofted version: lofted drive, over cover or midwicket, slog sweep (S+↗), reverse sweep (S+↖), hook (W+↗), upper cut (W+↖) |
| <kbd>Space</kbd> / <kbd>D</kbd> after the hit | Run. Press again for each further run. Boundaries need no running; anything else only counts if you run it, and if the throw beats you, you are run out. Byes, leg byes (if you offered a stroke) and overthrows are run the same way |
| <kbd>A</kbd> after the hit | "No!" — send your partner back, calling off the run under way (in its first half; if the ball beats you back, it's a run-out) |

### Bowling

| Key | Action |
| --- | --- |
| <kbd>1</kbd>–<kbd>9</kbd> / <kbd>Enter</kbd> | At the start of each over: pick the bowler from the eligible list, or take the suggestion |
| **1. Delivery** | |
| <kbd>1</kbd>–<kbd>6</kbd> (or <kbd>Q</kbd>/<kbd>E</kbd>) | Pace: stock, inswinger, outswinger, in-cutter, out-cutter, slower ball. Spin: stock ball and the bowler's variations |
| <kbd>↑</kbd> / <kbd>↓</kbd> | How much it swings, cuts or spins |
| <kbd>O</kbd> | Over or around the wicket |
| <kbd>F</kbd> (<kbd>Shift</kbd>+<kbd>F</kbd> back) | Field: the captain's own, or one of ten T20 presets (only powerplay-legal ones in the powerplay) |
| <kbd>G</kbd> | Place your own field: drag any fielder anywhere (the restrictions are checked: two outside the circle in the powerplay, five after; no more than two behind square on the leg side) |
| <kbd>Space</kbd> | Next: the landing spot |
| **2. Landing spot** | |
| Arrows | Move the marker to where the ball should pitch (↑ fuller, ↓ shorter) |
| <kbd>Space</kbd> / <kbd>Backspace</kbd> | Lock it and run in / back to the delivery |
| **3. Run-up** | |
| <kbd>Space</kbd> | Lock the pace on the meter: further right is quicker; the red zone is flat out and costs control |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Still change the swing, cut or spin until he lets go |

The same ball again is <kbd>Space</kbd>, <kbd>Space</kbd>, <kbd>Space</kbd>.

**Fielding**: when the ball is gathered and the batters are running, hold <kbd>↑</kbd> to throw to the keeper's end or <kbd>↓</kbd> to the bowler's end; let go to throw. The longer you hold, the harder the throw: the green part of the meter is quick and accurate, the red is forced and wild. A direct hit can run a batter out; if you don't throw within about a second, the fielder throws himself.

### Laws you will meet

A no-ball is followed by a **free hit** (the batter can only be run out); a second **bouncer** in an over is a no-ball; **leg byes** count only if a stroke was offered; a tied match goes to a **super over** (one over each, two wickets).

### Grounds, conditions, practice and saving

**Ground** and **Conditions** are chosen in the match setup (the ground behind the menu shows them): Crease Park, Lord's, the MCG, Eden Gardens or Wankhede; sunny, overcast (more swing and seam), under lights (dew in the second innings: the ball skids on and spinners can't grip it) or hot and humid.

**Practice challenges** (main menu) are a single over against the computer, batting or bowling: survive the over, fifteen off it, two boundaries, a six, middle four balls; take a wicket, a tight over, two yorkers, two bouncers, two slower balls, or hit the markers on the pitch.

**Saving**: *Save match* in the pause menu; *Continue a saved match* on the main menu. A save made during a ball goes back to the start of that ball.

### General

**Reviews (DRS)**: when an lbw decision goes against you, press <kbd>T</kbd> within 15 seconds to review it (or <kbd>Enter</kbd> to accept it). The third umpire's ball tracking shows where the ball pitched, where it hit the pad and whether it was going on to hit the stumps; less than half the ball in line or hitting is *umpire's call*, which keeps the on-field decision (and your review). Each side has two unsuccessful reviews per innings; the scoreboard shows how many you have left.

**Confidence and stamina** (the bars under each batter's name, and next to the bowler's): confidence widens the timing gauge's sweet spot — boundaries and well-timed shots build it, plays-and-misses cost it; tired batters run and hit less well; bowlers tire faster bowling flat out or in long spells.

**Autoplay**: <kbd>Y</kbd> lets the computer play your side (batting or bowling) for the rest of the over — or the next over, between overs — and <kbd>U</kbd> for the rest of the innings, at twice the pace and without stopping between balls. Press the key again, or *Take over*, and you have the controls back from the next ball. The buttons are at the top left of the screen.

<kbd>P</kbd> / <kbd>Esc</kbd> pause (resume, sound, commentary, restart, quit to menu) · <kbd>Enter</kbd> / <kbd>Space</kbd> next ball, continue past a card, skip a replay · <kbd>C</kbd> camera · <kbd>M</kbd> sound on/off · <kbd>V</kbd> commentary on/off · <kbd>H</kbd> help. The game pauses itself when the window loses focus.

**Graphics** (main menu): *High* adds soft shadows, image-based lighting, the crowd, ambient occlusion, bloom, filmic tone mapping and up to 1.5× resolution; *Low* drops them for machines without a capable GPU. Low is chosen automatically when the browser reports a software renderer; your choice is remembered. On top of that the game watches its own frame rate: below ≈45 fps it lowers the resolution step by step (and on High turns off ambient occlusion), and raises it again when there is headroom.

**Camera**: the default *broadcast* coverage works like television: the main camera is high in the stand behind the bowler on a long lens; as the bowler sets off it is framed with him at the foot of the picture and the batter at the top, and it tilts and zooms in with him so that by release the two fill the frame; after the stroke it pans and zooms out with the ball, then the director cuts to fixed cameras at the front of the stands (square on either side, or at the keeper's end for straight hits) framed on ball and fielder; between balls, a long-lens close-up of the batter. <kbd>C</kbd> cycles to the *classic* Cricket 07-style camera (low and close behind the bowler), the view from behind the striker and a high wide view.

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
| 0.4.0–0.6.0 | Motion-captured players, broadcast camera, post-processing, physically modelled bat sound; current T20I squads; game AI (learning attack, AI captain, field-aware batting, commentary, coach) | ✅ Done |
| 0.7.0 | Paced match flow (next-ball prompt, over and wicket cards with scorecards), on-screen controls, game speed, calm fielding, action replays, classic camera | ✅ Done |
| Next | Stroke animation detail, more teams and tournaments | — |
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
- No byes, leg byes or overthrows; no DRS.
- Ball physics is unchanged in 0.7.0; the ball is drawn slightly larger than life so it can be followed.
- Running is all-or-nothing per run: you cannot send the non-striker back once a run is called.
- Audio is synthesised in the browser; commentary uses the browser's own voice; there is no continuous crowd bed.
- Keyboard only: no gamepad or touch controls yet.
- On software-rendered browsers (no GPU) even Low graphics runs slowly. Frame rate on real GPUs has not been measured systematically; adaptive resolution keeps it up on modest ones.

## Assets and licensing

- **Players**: four Microsoft Rocketbox avatars (MIT licence, © 2020 Microsoft; [repository](https://github.com/microsoft/Microsoft-Rocketbox), notice in `public/players/LICENSE-Rocketbox.md`) with Rocketbox motion-capture clips (run, jog, walk, idle, cheer). They are converted offline by `scripts/avatars/` (FBX → glTF, 1024² textures, a baked kit mask so any team colours can be painted on, compact clip data) and the results are committed under `public/players/`.
- Everything else — the ground, stadium, crowd, ball, equipment, textures and all sounds — is generated procedurally in code.
- Teams and players are real: each board's most recently announced men's T20I squad as of October 2026 (sources in `src/game/data/teams.ts`). Names, batting hands and bowling styles are factual; the numeric ratings are the game's own approximations. Kits use national colours only, with no badges, logos or kit-maker marks, and the sponsors on the boards are fictional. Player names are used for a non-commercial fan project; a commercial release would need the relevant player and board licences. The UI typeface is Barlow Condensed (SIL Open Font License 1.1), bundled via `@fontsource/barlow-condensed`.
