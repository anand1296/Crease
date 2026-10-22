# Changelog

## 0.7.1 — Smoothness and responsiveness (2026-10-22)

Profiled in the browser (CPU profiles, long-animation-frame and event-timing entries) and fixed what was stalling the game:

- **No more freezes mid-play from shader compilation.** Every shader is compiled, and every texture uploaded, behind a short "Taking the field…" screen when a match starts, using parallel shader compilation where the browser supports it. Before, shaders compiled the first time something appeared — the first ball in flight, the first broken wicket, the first replay — freezing the game each time (on Windows a single shader can take hundreds of milliseconds). Synchronous shader-error checks are off in production. A browser test now fails if any shader compiles during play.
- **No hitch on boundaries and wickets.** The crowd roar was synthesised on the spot (≈165 ms of main-thread work); the reactions are now pre-rendered in idle time and reused, pitched slightly differently each time.
- **Instant buttons.** Start shows the loading screen at once and builds the match after that has painted; the first click no longer builds the audio engine inside the click (≈115 ms); setting up the audio happens in idle slices. Click and key handlers now take under 20 ms (was up to 127 ms).
- **Menus and pause cost nothing.** The 3D view stops redrawing behind the match setup, squad and pause screens (it keeps its last frame), so the GPU and main thread are free for the menus.
- **Adaptive quality.** When frames run slower than ≈45 fps the resolution steps down (and, on High, ambient occlusion is switched off), and it tries a step back up after a smooth spell. Occasional hitches don't count.
- **Key indicator** lights in the same frame as the key press (it was polled a frame late); the bowling needle no longer re-renders the bowling panel sixty times a second.

## 0.7.0 — Match flow, replays and the classic camera (2026-10-22)

- **A paced match**: after every ball the game waits for you — *Next ball* (Enter or Space). Every over ends with an over summary and the scorecard; every wicket with a dismissal card (how out, fall of wicket, partnership, who's in next) and the scorecard. The match opens with a how-to-play card.
- **Controls on screen**: a live controls panel shows the batting (or bowling) keys all the time, lights up the keys you hold or press, and names the stroke your current direction + key combination will play.
- **Game speed**: Relaxed (0.65×), Normal (0.8×, the new default) or Real time, chosen in match setup. Slowing the game doesn't change what happens — the same seed gives the same match.
- **Calm, purposeful fielding**: only the fielders who should move do — the chaser, one fielder backing up, the keeper and bowler going to the stumps for the return. Fields are set per over and batter instead of every ball, and players are placed at their positions on the camera cut between balls rather than walking across the ground.
- **Action replays** of wickets and boundaries, slowed down with their own cameras (square-on for bowled and LBW, behind the striker following the ball for the rest). Enter skips; switch them off in the menus.
- **Classic camera** (new default): lower and closer behind the bowler's arm, after Cricket 07; C still cycles to the long-lens broadcast camera, the batter's view and the high view.
- **Ground and stadium**: worn strips on the square around the pitch, inner-circle markers, a thicker rope, seat rows in the stands (blue lower tier, red upper); a larger, easier-to-follow ball.
- A new scoreboard bar along the bottom of the screen.

## 0.6.0 — Game AI (2026-10-22)

- **Learning attack**: against a human batter the computer's bowlers learn, ball by ball, which plans work (Thompson sampling over delivery plans, phase-aware priors, pooled across the line-up).
- **AI captain**: fields set per ball from the bowler, the phase and the batter's scoring areas; powerplay / middle / death fielding restrictions; powerplay shown on the scoreboard.
- **Field-aware T20 batting**: the computer aims lofted shots and pushes into the gaps in the field. AI v AI T20s average ≈185 at ≈9.3 an over.
- **Defensive batting fixed**: blocks are presented early and adjust to movement off the pitch better, so a fractionally late block is no longer an LBW. One-day games were scoring under 3 an over with a wicket every 19 balls; with a new one-day intent curve they now score ≈4.3 an over with a wicket every ≈31 balls, held by a new test.
- **Commentary**: ball-by-ball, written from the facts of each ball, spoken by the browser's voice; toggle with V or in the menus.
- **Coach**: notes on timing, troublesome deliveries, shot selection and bowling at the innings break and the result.
- docs/TECHNICAL_ARCHITECTURE.md: the complete technical architecture document.


## 0.5.0 — Real T20 squads (2026-10-22)

- **Teams**: India, Pakistan, Australia and England with each board's most recently announced men's T20I squad (India and Pakistan named 6 Oct 2026, England 13 Oct 2026, Australia's Bangladesh squad of June 2026); real batting hands and bowling styles, captains and keepers marked; ratings are the game's own approximations.
- **Kits** in national colours; alternate strips when colours clash (India v England).
- **T20 batting AI**: in games of 20 overs or fewer the computer bats like a T20 side (≈170 a side at 8–9 an over).
- The old fictional sides remain only as test fixtures for the physics tests.


## 0.4.0 — Realistic players, broadcast camera, graphics and sound (2026-10-22)

- **Players**: skinned, motion-captured human models (Microsoft Rocketbox, MIT) replace the primitive figures; team kits painted through a baked kit mask; helmets, caps, sun hats, pads, keeper's mitts; varied skin tones; running, idling and celebrations from motion capture; strokes and bowling retargeted from the procedural rig with IK hands on the bat; heads follow the ball; fielders walk in.
- **Umpires** at both ends with signals (out, four, six, wide, no-ball, run-out).
- **Wickets** break — stumps knocked back, bails flying.
- **Camera**: broadcast director — wide between balls, slow push-in through the run-up, tight at release, cut to a chase camera after the stroke, stump camera when bowled.
- **Graphics**: physical sky, image-based lighting, late-afternoon sun with soft shadows; High adds ambient occlusion, bloom, filmic tone mapping and vignette; detailed outfield and pitch; stitched ball; sprite crowd.
- **Sound**: no more background noise; physically modelled bat-on-ball sound (crack and woody ring when middled, dull hum off the toe, tick off the edge); stadium reverb; crowd reactions of voices and applause.
- Tests for the bat-sound model and the camera director.


## 0.3.0 — Matches, squads, players and sound (2026-10-21)

- **Matches**: toss, two innings, targets and results ("won by N runs / N wickets (M balls left)" / tie), innings break and result screens with full scorecards (batting, extras, fall of wickets, bowling with maidens and economy) and top performers; rematch.
- **Menus**: main menu over the live stadium; match setup (teams, overs 2–50, difficulty, pitch, toss / bat / bowl first); squad board to pick the XI and batting order with validation.
- **Squads**: four fictional teams of sixteen with keepers, ratings, batting hands and bowling styles.
- **Rules**: LBW (pitched outside leg, impact outside the line, projected path), wides, bowler quotas, no consecutive overs, keeper cannot bowl.
- **Running**: the human batter calls each run (Space/R); run-outs. Leave moves to X.
- **Bowling**: pick the bowler at the start of each over (number keys, Enter for the suggestion).
- **Players**: articulated humanoids with IK hands on the bat, bowling action, batting strokes, keeper and fielder motion, throws and celebrations; team kits, helmets, pads, gloves.
- **Stadium**: two-tier stands, instanced crowd that reacts, sponsor boards, floodlights, live scoreboard, pitch texture with footmarks, broadcast camera.
- **Sound**: synthesised bat-on-ball (by timing and edge), pads, stumps, bounce, catch, boundary and crowd; M to mute.
- **Graphics quality** setting (Low auto-selected on software renderers).
- Removed the open-ended practice mode.


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
