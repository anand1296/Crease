# Crease

A browser-based 3D cricket game, built with React, TypeScript and Three.js. Inspired by the depth and replayability of classic cricket games: the aim is batting that rewards timing and shot selection, bowling with real variation, and an opponent that thinks about the match situation.

> **Status: pre-alpha (phase P0).** The project boots into a 3D ground with a seeded, fixed-step ball simulation bowling demo deliveries. You cannot bat or bowl yet — that is phase P1. See [Roadmap](#roadmap).

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
| `npm test` | Vitest unit tests (simulation, no browser needed) |
| `npm run test:e2e` | Playwright smoke test against the production build (run `npm run build` first) |
| `npm run check` | Type check, lint and unit tests together |

To run the browser test against a deployed build instead: `E2E_BASE_URL=https://your-preview.vercel.app npm run test:e2e`.

## Controls

None yet — the P0 build is a non-interactive demo. Keyboard batting and bowling controls arrive in P1 and will be documented here.

## Deployment

The game is a fully static site (no backend, no API keys).

**Vercel (primary).** Import the GitHub repository in Vercel. `vercel.json` already sets the framework, build command and output directory, plus long-lived caching for hashed assets and security headers (CSP, HSTS, frame denial). Every push to `main` deploys to production and every pull request gets a preview URL.

**Any static host.** Run `npm run build` and upload `dist/`. The app has a single route, so no rewrite rules are needed.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request:

1. **checks** — install, type check, lint, unit tests, production build
2. **e2e** — Playwright (Chromium with software WebGL) loads the built game, waits for the first rendered frame, confirms the canvas is visible, that the simulation is advancing, and that the console is error-free

`.github/workflows/lockfile.yml` regenerates `package-lock.json` when `package.json` changes on `main`. It exists only because the sandbox where much of this code is written cannot reach the npm registry; delete it once lockfile changes are committed directly.

## Roadmap

Built in phases; each phase ships a verified vertical slice.

| Phase | Scope | Status |
| --- | --- | --- |
| P0 | Project boots, 3D ground renders, seeded RNG, fixed-step loop, ball physics core, CI + deploy | ✅ Done |
| P1 | Bowling a delivery, batting input, bat–ball contact, scoring a ball | Next |
| P2 | Stroke variety, timing windows, contact quality, edges and misses — the batting model | — |
| P3 | Match engine (overs, innings, wickets, extras), fielding, opposition AI, difficulty | — |
| P4 | Menus, match setup, rosters, HUD, animation, audio, cameras | — |
| P5 | Performance, polish, production hardening | — |

## Documentation

- [GAME_DESIGN.md](GAME_DESIGN.md) — rules, simulation model and tuning decisions
- [ARCHITECTURE.md](ARCHITECTURE.md) — modules and how they fit together
- [CHANGELOG.md](CHANGELOG.md) — milestones

## Assets and licensing

All geometry and textures are generated procedurally in code. No third-party game assets, player likenesses or roster data are bundled.
