# Changelog

## 0.2.0 — P1: playable practice innings (2026-10-21)

**Gameplay**
- Bat against a computer bowler, or bowl at a computer batter (Tab switches), in an open-ended practice innings with scoring, strike rotation, overs, bowler changes, wickets and the next batter.
- Keyboard batting: 16 strokes plus a directional push, chosen by direction, stroke key and back-foot modifier, timed by when you commit.
- Keyboard bowling: choose from the bowler's own repertoire, aim line and length with a target on the pitch, run in, and time the release on an accuracy meter.
- HUD: scoreboard with batter and bowler figures, this over, bowler fatigue, delivery name and speed, outcome banner with timing feedback (early/late in ms; middled/mistimed/edged), bowling panel, controls bar, help and pause overlays. The game pauses itself when the window loses focus.

**Simulation**
- Delivery engine: 12 delivery types as physical recipes. Intended vs executed delivery: the bowler aims using intended movement, the ball gets actual swing, random seam, spin variation and uneven bounce, plus error from accuracy, fatigue, difficulty and release quality. A shooting-method solver handles aiming.
- Ball physics: swing; spin drift, dip and turn; seam; Coulomb bounce friction; speed-dependent rolling; exact sub-step bounce points; four pitch presets.
- Batting model:
  - impulse-based bat–ball collision against the real ball;
  - timing tolerance as a distance along the path, so pace is harder than spin;
  - the bat's line set from what the batter could see when committing: late seam, unread spin and uneven bounce cause edges and misses;
  - footwork to the pitch of the ball, so yorkers are dug out at the toes;
  - pads, body and stumps.
- Fielding: interception planning with reaction, acceleration and dives; catches by skill and difficulty; fumbles; boundaries; runs completed safely before the return throw.
- Computer opposition: a bowling AI using the corridor plus variations, and a perception-limited batting AI.
- Three difficulty levels changing AI execution and judgement only.

**Quality**
- 82 unit and simulation tests, including the ten batting acceptance behaviours and computer-v-computer sessions.
- Browser tests that play the game through the keyboard.
- `npm run report:batting` writes a batting outcome distribution report.

**Calibration fixes found along the way**
- Bouncers were finishing down the leg side: the aim correction ignored the release angle.
- Skimming drives lost 40% of their pace in a few hops: bounce friction is now Coulomb.
- Seam movement was about three times real-world size.
- The field stood exactly on the shot directions, and fielders had no acceleration, so no ground drive ever reached the rope.

## 0.1.0 — P0: project foundation (2026-10-21)

- Vite, React 19 and strict TypeScript, with react-three-fiber, ESLint, Vitest and Playwright.
- GitHub Actions CI and Vercel configuration with caching and security headers.
- Seeded RNG, fixed-timestep clock and ball physics core.
- Procedural 3D ground, with loading, error and WebGL-unsupported states.
