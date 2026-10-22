# Changelog

## 0.13.1 — A saved match always resumes on the start card (2026-10-23)

- A match saved while the game was waiting for "Next ball" now loads on the card to start again from, like any other save (it used to come back to the bare prompt).

## 0.13.0 — Byes, leg byes, overthrows, sending a batter back, spin off the bat, your own field, free hits, super overs (2026-10-23)

- **Leg byes**: a ball that hits the pad (or body) and isn't out now runs on — glancing fine down the leg side with some pace, or dropping at his feet — and the batters can run. Leg byes count only if a stroke was offered or he was hit getting out of the way; otherwise the runs don't count. They go to the extras, not the batter or the bowler. If a review then gives it out, the leg byes are wiped.
- **Byes**: the keeper can miss it — more often wide down the leg side, very low, very quick, or from a poorer keeper — and the ball runs on behind for byes (a wide that beats him: the runs are all wides).
- **Overthrows**: a throw wide of the stumps with nobody backing up runs away past them; the batters can take more runs while a fielder chases it down (the ball is seen rolling away and coming back in). Headlines show them: "3 runs (2 overthrows)".
- **Sending a batter back**: once the ball is hit, **A** calls off the run under way ("No!"). Only in the first half of the run; turning round costs a moment, and if the ball beats them back, it's a run-out.
- **Spin off the bat**: cuts are sliced and run away finer towards third man (more when played late); flicks, glances and sweeps hook finer on the leg side; drives roll on with topspin; lofted hits carry backspin and check up; edges spin any way. It is in the ball physics, so the fielders' reading of the ball allows for it.
- **Inside edges on to the pad**: the ball runs on off the pad, or occasionally loops up — a bat-pad catch for the close fielders.
- **Your own field**: press **G** (or *edit* in the bowling panel) and drag any of the nine fielders anywhere; the editor names each spot the way commentators do and enforces the restrictions as you go — two outside the circle in the powerplay, five after it, and no more than two behind square on the leg side.
- **Free hit** after a no-ball (the batter can only be run out; the computer batter swings harder), and the **one-bouncer-an-over** rule: a second bouncer is a no-ball.
- **Super over**: a tie goes to a super over — one over each, two wickets, the side that batted second batting first — repeated if that is tied too (up to three).
- **Hat-tricks**: two wickets in two balls and the bowler is "on a hat-trick" (a badge on the next ball, whenever it comes); a third is the HAT-TRICK.
- Scorecards show byes and leg byes in the extras; the over summary marks them (2b, 1lb).

## 0.12.0 — Famous grounds, weather, practice challenges, saved matches, real helmets (2026-10-23)

- **Grounds**: Crease Park, **Lord's** (the red-brick Pavilion with its two towers behind the bowler's end, the Media Centre pod on its two legs above the Nursery End — behind the batter on the broadcast camera, as on television — the tented Mound Stand, low white stands, plane trees, slim light masts), the **MCG** (a vast three-tier bowl under a ring roof, six tall light towers), **Eden Gardens** (blocks of coloured seats under a long cantilevered roof) and **Wankhede** (steep stands under a crown of white fabric canopies, lights along the roof). They are impressions built from simple shapes, not survey models; the playing area is the same everywhere. The ground behind the menus shows the one you pick.
- **Conditions** change the cricket as well as the picture: *sunny* (little swing, the pitch grips for spin), *overcast* (grey skies, the ball swings and seams — about a third more), *under lights* (a night sky, glowing light towers; dew in the second innings, so the ball skids on and the spinners lose about a third of their grip) and *hot and humid* (hazy; some swing, the surface grips).
- **Practice challenges** (main menu): one over in the middle against the computer, with the field set. Batting — survive an over from the quickest bowler, fifteen off the over, two boundaries, clear the rope, middle four balls. Bowling — take a wicket, a tight over (five or fewer), two yorkers, two bouncers, two slower balls on a length, and hit the markers (a gold disc on the pitch for every ball; land three of six on it). The over stops as soon as the challenge is won or lost; completed challenges get a tick.
- **Save and carry on**: *Save match* in the pause menu keeps the match in this browser (as it stands between balls, or from the start of the ball in play); *Continue a saved match* on the main menu picks it up exactly where it was — scores, cards, the bowlers' overs and tiredness, the batters' form, what the computer has learnt, and the random-number state, so it plays on exactly as it would have.
- **Helmets**: a glossy shell in a deep shade of the team colour coming down over the ears and the back of the head, a sloping peak, a crest, a steel grille of two crossbars, a chin bar and uprights in front of the face, and stem guards at the back of the neck.
- **Faces**: skin with a soft sheen and more relief; facial hair varies by player — clean-shaven, stubble, a moustache or a beard — drawn from each face's own shape.
- Long hair hangs down under a cap or helmet rather than sticking out from under it.

## 0.11.0 — Shots all round the ground, form and stamina, ball tracking and DRS (2026-10-23)

- **Caps and hats fit**: the hair (and the top of the head) is tucked under the cap, helmet or hat instead of poking through its crown; when a bowler hands his cap to the umpire, his hair is back as it was.
- **The camera follows throws**: when a fielder throws, the director cuts to the camera that sees the ball go in — the main camera when it comes in towards the keeper from in front of square, the camera behind the keeper for throws from behind, or the camera across the ground from square — framing ball and stumps together and closing in on the stumps as it arrives.
- **Shots all round the ground**: every combination of arrows and S / W / D (and Shift) now goes to a named part of the field — straight, mid-off, cover, point, third man, fine leg, backward square, square leg, midwicket, mid-on, and long-off, long-on, deep cover, deep midwicket, cow corner lofted. Arrows pressed a fraction after the shot key (up to 0.15 s) still count, so keys pressed "together" always work. The controls panel names where each key will send it and shows it on a small field map.
- **Drag-and-drop squad picking**: the playing XI in batting order on one side, the bench on the other. Drag to reorder, drag a bench player onto someone to swap them, or onto the empty slot; drag a player to the bench to leave him out. The ↑/↓/×/+ buttons remain for keyboard users.
- **Scorecard and stats from the pause menu**: Paused / Scorecard / Stats tabs. Stats: run rate, required or projected score, partnership, last five overs, boundaries, dot-ball percentage, extras; runs per over (with the first innings alongside in the chase, and wickets marked; point at an over for its figures); batting with strike rates and dot-ball percentages; bowling with economy, dots, boundaries conceded and extras. Scorecards now show strike rates and dot balls.
- **Confidence**: every batter walks out with some — openers and the top order more, tailenders less — and it rises with fours, sixes and well-timed strokes and falls with plays-and-misses and edges. It widens or narrows the sweet spot on the timing gauge (from −28% to +28%), which is now on screen from the start of every ball.
- **Stamina**: batters tire from hard running (a three costs six times a single) and, after a fifth of the innings at the crease, from every ball; tired batters run slower (the computer's run calls allow for it) and time and hit the ball a little less well. Bowlers tire faster when they bowl flat out and in long spells (each over in a row after the second costs 12% more). The scoreboard shows each batter's confidence and stamina and the bowler's stamina.
- **Ball tracking and DRS**: an lbw is now judged the way it is in a real match. The on-field umpire decides by eye (and can be wrong when it is close or a long way down the pitch). The side that loses the decision can review it within 15 seconds — T, the review signal, or Enter to accept; the computer reviews when its players think it's worth it — with two unsuccessful reviews per side per innings, as in T20 internationals. The third umpire's review replays the ball's real path down the pitch and its projection on to the stumps (the players removed, as television does), and shows pitching (in line / outside off / outside leg), impact (in line / umpire's call / outside) and wickets (hitting / umpire's call / missing), then the decision; umpire's call keeps the on-field decision and the review.
- **Between the balls**: after a wicket the ball stays dead a little longer while the fielders run in to the bowler and celebrate, the dismissed batter walks off, and the camera cuts to a long lens on the huddle. A fifty or a hundred: the batter raises his bat (and, for a hundred, the other arm too) with the camera on him, his partner and some fielders applauding. After an ordinary ball the bowler walks back to his mark shining the ball on his trousers; a new batter, and everyone at the start of an over, takes guard — square on to the umpire, a few taps of the bat on the crease; when the field is changed, the bowler waves the fielders into place.
- The playing XI board's drag-and-drop no longer loses a quick drag (a release straight after the move).
- Matches can be started from a fixed seed with `?seed=…` in the address.

## 0.10.0 — The run-up on camera, autoplay, and the toss (2026-10-23)

- **The bowler is on screen through his run-up.** The broadcast camera used to ease along a fixed zoom from the wide frame, and a fast bowler at the top of an 18 m run-up was below the bottom of the picture until he was nearly at the crease. Now, as on television, the director cuts from the close-up of the batter to the main camera as the bowler sets off, and the operator frames the shot on the bowler: his feet at the foot of the picture, the batter and keeper at the top. As he runs in the camera tilts and zooms with him, so the shot tightens steadily (≈11° → ≈6° lens for a fast bowler) until, at release, bowler and batter fill the frame. The framing is computed from where the bowler actually is each frame (spinners, with their short run-ups, start tighter). When you are bowling, the aiming view cuts to the same broadcast shot as you run in. The classic camera follows a few metres behind the bowler and settles behind his arm for release.
- **Autoplay.** Let the computer play your side for the rest of the over (<kbd>Y</kbd>) or the rest of the innings (<kbd>U</kbd>) — batting or bowling, with its own bowler choices and fields — at twice the pace and without stopping between balls. Press the same key (or *Take over*) to have the controls back from the next ball. Between overs, <kbd>Y</kbd> plays the next whole over. When it ends you get the over card as usual; innings autoplay stops at the innings break. Buttons for both sit at the top left of the screen.
- **The toss.** With *Toss for it* (the default), Start takes you to the middle: your captain and the opposing captain either side of the match referee on the pitch. Call heads (<kbd>H</kbd>) or tails (<kbd>T</kbd>); the opposing captain flicks the coin, the camera follows it up and down, then looks down at it on the pitch (a gold coin with a bust on one side and a numeral on the other). Win it and choose to bat (<kbd>B</kbd>) or bowl (<kbd>L</kbd>); lose it and the other captain chooses (bat on a flat deck, bowl on a green one). The winning captain pumps a fist. The coin's face comes from the match seed. Rematch tosses again.

## 0.9.0 — Batting like Cricket 07, strokes that look right, fielding you control, broadcast cameras (2026-10-22)

- **Cricket 07 batting controls**: S front-foot shot, W back-foot shot, D use your feet (step out), A leave, hold Shift to loft; on their own S, W and D defend. Arrows are screen directions from behind the bowler: ↓ straight, ← / → square, ↙ ↘ in front of square, ↖ ↗ behind. D (or Space) runs once the ball is hit. The panel names the shot each key will play with the arrows you hold.
- **Stepping out**: down the pitch to meet the ball on the full, with a little extra power — and if you miss, you are likely to be **stumped**.
- **Timing gauge**: early ↔ late with the perfect zone in the middle, and the error in milliseconds. Timing now shapes the shot more: a cut timed perfectly goes square, played late it runs fine between gully and third man; a perfectly timed shot leaves the bat faster (up to +14%); too early on a drive and it goes up in the air. New slog sweep (Shift+S+↗).
- **Strokes that look like strokes**: every stroke family has its own shape — drive (bat comes down straight, finishes high over the front shoulder), cut (horizontal, across the body), pull and hook (wraps round the shoulder), flick and glance, sweep and reverse sweep (down on one knee), block (dead bat), leave (hands high) — with a backlift, an accelerating downswing on an arc, contact where the sweet spot meets the ball, and a follow-through.
- **The bat stays in the batter's hands**: it is placed where the model's palms actually are after the arms are solved, never where the arms were meant to reach.
- **Ball marker when batting**: from the start of the run-up, where the bowler is aiming to pitch it (his intention — the ball itself can stray).
- **A real-looking ball**: the bulging seam ring is gone; the seam is a narrow ridge in the leather with six rows of off-white stitching and faint quarter seams (colour and bump maps).
- **Fielding**: fielders get down low to pick the ball up, come up with it looking for the stumps, and throw with a proper overarm action. When you are fielding and the batters run, choose the end — hold ↑ for the keeper, ↓ for the bowler — and the power: the green is quick and accurate, the red forced and wild. Direct hits (more likely with a good arm and from closer in) break the stumps on arrival; otherwise the keeper or bowler gathers first. Run-outs follow. If you don't throw within about a second, the fielder throws himself.
- **Broadcast camera work** (now the default): the main camera high in the stand behind the bowler on a long lens (≈70 m back, 17 m up), zooming in through the run-up; after the stroke the operator pans and zooms out with the ball; then the director cuts to fixed cameras on gantries at the front of the stands — square on either side, or at the keeper's end for straight hits — framed tight on ball and fielder; long-lens close-ups of the batter between balls. No vignette. C still switches to the Cricket 07-style camera and the others.

## 0.8.0 — Bowling: a real action, a marker you can see, swing and spin you control (2026-10-22)

- **Bowling in three steps.** (1) *Delivery*: pace — stock, inswinger, outswinger, in-cutter, out-cutter, slower ball; spin — the stock ball and the bowler's variations (arm ball, top-spinner, doosra; googly, slider). Set how much it swings, cuts or spins (↑/↓), over or around the wicket (O), and the field (F). (2) *Landing spot*: move the marker to where the ball should pitch and lock it (Space). (3) *Run-up*: lock the pace on the meter (Space) — further right is quicker, the red zone is flat out and costs control and risks a no-ball — and still change the amount until he lets go. Same again is Space, Space, Space.
- **The landing marker** is large, drawn above the pitch, with a crosshair and length bands (yorker, full, good, back of a length, short) while placing it; it turns green when locked. A new aiming camera rises behind the bowler to frame the whole pitch while you set up the ball. The marker is now where the ball *pitches* (it used to be the line at the stumps).
- **Ten T20 field presets**: powerplay two slips / standard / save the boundary, catchers in, spin bat-pad, middle overs balanced, spin squeeze, boundary riders, death yorkers, death short-and-leg-side — attacking, balanced or defensive. Only presets with two outside the circle are offered in the powerplay; five may be out after it (T20 law). A field change moves each fielder to the nearest new position (an optimal assignment), and they jog there.
- **Real bowling actions.** Keyframed delivery strides for pace, medium pace, off-spin and leg-spin: the bound with the ball at the chin, back foot landing side-on, the arm turning backwards-over the top through a full circle and releasing just past vertical as the front leg braces, then the follow-through across the body and off the pitch. The hand is where the physics releases the ball (within a few centimetres). The previous action turned the arm the wrong way round.
- **Run-ups by style**: fast bowlers off ≈18 m, fast-medium 15 m, medium 11 m, spinners off ≈5 m (a few paces).
- **Over or around the wicket**: a different release point (≈0.25 m or ≈0.65 m from middle stump) and angle; the non-striker and umpire stand on the other side.
- **Physics**: swing amount (0.4×–1.2× the bowler's natural swing, capped at a realistic ≈0.7 m of curve); cutters deviate off the pitch in the chosen direction (≈10–25 cm); more revolutions mean more turn and a slower, loopier ball; effort changes pace (−10% to +3%) and control; release heights match the players' reach.
- **The seam**: a raised, stitched seam ring. Pace: upright and steady, angled towards slip or fine leg by the swing. Spin: turns about the real spin axis, so the seam visibly rotates. The ball sits in the bowler's hand until release.
- **Bowler changes are instant**: the new bowler is at his mark and the old one in his fielding position the moment you choose (he used to run in from the field while the old bowler stood at the mark). The bowler hands over his cap.
- **Overs**: 2, 5, 10, 15 or 20 a side (50 removed).
- The computer's pace bowlers use cutters too.

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
