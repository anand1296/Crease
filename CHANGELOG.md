# Changelog

## 0.1.0 — P0: project foundation (2026-10-21)

- Vite + React 19 + strict TypeScript project with react-three-fiber, ESLint, Vitest and Playwright.
- GitHub Actions CI (type check, lint, unit tests, build, browser smoke test) and Vercel configuration with caching and security headers.
- Seeded, serialisable RNG; fixed-timestep simulation clock; ball physics with drag, bounce, rolling and rest detection.
- 3D ground built from procedural geometry: outfield, pitch, creases, stumps and bails, boundary rope, 30-yard circle, sight screens and stands, with placeholder players in a standard field.
- Attract-mode demo deliveries driven by the real simulation.
- Loading, error and WebGL-unsupported states.
- 24 unit tests covering RNG determinism, frame-rate independence, ball flight, bounce, tunnelling, rest and numerical safety.
