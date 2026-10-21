# Game design

This document records gameplay rules and simulation decisions as implemented. Systems that do not exist yet are listed under [Not yet implemented](#not-yet-implemented) rather than described speculatively.

## Principles

- Gameplay over graphics; skill over arbitrary randomness.
- One source of truth: the simulation decides what happened; the renderer only shows it.
- Every random draw comes from a seeded RNG, so any delivery or innings can be replayed exactly.
- Randomness is bounded (clamped normal draws) and scaled by skill, timing and contact quality. It is never added just to make results differ.
- Difficulty changes how well the computer executes and decides. It never changes physics, rules or results directly.

## World and units

- SI units: metres, seconds, kilograms. Origin at the centre of the pitch. **x** across the pitch (+x is the off side of a right-handed striker), **y** up, **z** towards the striker.
- Striker's stumps at z = +10.06, bowler's-end stumps at z = −10.06 (22 yards). Popping creases 1.22 m in front of the stumps.
- Laws of Cricket dimensions: stumps 71.1 cm × 22.86 cm, ball radius 3.6 cm and mass 160 g, bat width 10.8 cm. Boundary radius 65 m from the centre of the pitch.
- Batter-relative lateral values ("line") are positive towards that batter's off side; left-handers are mirrored.

## Simulation timing

- Fixed steps of 1/240 s, independent of frame rate; frame deltas over 0.1 s are clamped (the game pauses rather than fast-forwarding). Rendering interpolates between the last two steps.
- Tested: identical results at 30, 60 and 144 fps to within one step.

## Ball physics

`src/game/physics/ball.ts`, semi-implicit Euler.

| Effect | Model |
| --- | --- |
| Gravity | 9.81 m/s² |
| Air drag | a = −k·\|v\|·v with k = ½ρ·Cd·A/m, Cd 0.45 (≈6 m/s² at 30 m/s) |
| Swing | Constant lateral acceleration until the first bounce |
| Spin in the air | Sideways drift opposite to the turn (0.024 m/s² per rev/s); topspin dip (0.05 m/s² per rev/s) |
| Bounce | Vertical restitution × per-delivery bounce variation × topspin effect |
| Bounce friction | Coulomb: horizontal speed lost = μ·(1+e)·vertical impact speed. A steeply pitching delivery loses more pace than a ball skimming over the outfield. Topspin reduces μ (skids on), backspin increases it |
| Seam and turn | Lateral velocity change at the first bounce: seam × pitch seam factor; turn = 0.048 m/s per rev/s × pitch grip |
| Rolling | Deceleration 0.6 m/s² + 0.3/s × speed (grass resists a fast ball more) |

Bounces are resolved at the exact contact point within the step (sub-step interpolation), so pitching points are exact and the ball can never tunnel. Bounces below 0.35 m/s vertical become rolling (no infinite micro-bounces). Speed is capped at 70 m/s as a numerical guard. A clean 32 m/s drive reaches 60 m in about 3 s.

### Pitches

`src/game/data/pitches.ts`. Each preset is a set of physical multipliers.

| Pitch | Bounce | Pace (μ) | Seam | Turn | Uneven bounce | Swing |
| --- | --- | --- | --- | --- | --- | --- |
| Balanced | 0.55 | 0.40 | 1.0 | 1.0 | 3% | 1.0 |
| Green top | 0.60 | 0.34 | 1.6 | 0.7 | 4% | 1.25 |
| Dry turner | 0.50 | 0.52 | 0.7 | 1.6 | 7% | 0.8 |
| Flat deck | 0.57 | 0.30 | 0.6 | 0.7 | 1.5% | 0.7 |

## Bowling

`src/game/bowling/`.

**Delivery types** (12) are physical recipes: speed relative to the bowler's stock ball, swing direction, seam factor, side/top spin split, backspin, length constraints, execution difficulty and physical effort. Fast, slower ball, inswinger, outswinger, yorker (pitches 0.4–1.3 m from the stumps), full toss (does not pitch), bouncer (9.5–12.5 m), off-break, leg-break, top-spinner, doosra and googly. A bowler can only bowl the types for their style.

**Stock speed** comes from style and the pace attribute: fast 34–42 m/s (122–151 km/h), fast-medium 31–37.5, medium 28–33, spin 20–24.

**Intention vs execution.** The plan is a type, a line (where it should pass the stumps) and a length (where it should pitch). The bowler aims using the movement they *intend*: angle from the crease, swing, drift and turn. A shooting-method solver finds the launch velocity that lands the ball on the aiming point with drag and swing included. The ball then gets the movement it *actually* has:

- swing ±30% of intended (sometimes barely any);
- random seam movement that the bowler cannot control;
- spin ±15%;
- per-delivery bounce variation;
- line, length and speed error.

**Error scale** = (0.4 + 1.1 × (1 − accuracy)) × delivery difficulty × (1 + 0.8 × fatigue) × (1 + 1.5 × (1 − release quality)). Line σ ≈ 8.5 cm, length σ ≈ 45 cm (spin 35 cm) at scale 1.

**Release quality** comes from the human's accuracy meter, or the computer's execution roll.

**Fatigue** builds each ball, faster for low stamina and high-effort deliveries. It recovers 0.09 per over rested, costs up to 6% pace and widens error by up to 80%.

**No-balls**: 0.4–3% depending on accuracy and fatigue. One extra, not a legal ball, no wicket.

## Batting

`src/game/batting/`. The heart of the game.

### Strokes

Sixteen strokes, each a distinct set of physical intentions:

- contact depth (front or back foot);
- the line and height of ball it suits;
- bat speed and restitution, and how much along-the-face velocity it keeps;
- intended direction and elevation;
- timing tolerance and swing time;
- which way a late stroke turns the face.

All of them go through the same contact physics. The defensive **push** is the block played with more bat and placed into a gap. Its tolerance is lower, so it carries more risk than a dead bat.

### Footwork and the contact point

Front-foot strokes go to the pitch of the ball when it is within reach: the batter meets it just after it lands, up to 0.55 m in front of the crease plus up to 0.25 m from the footwork attribute. A ball pitching at the crease (a yorker) cannot be reached and must be met at the toes. Back-foot strokes meet the ball deeper.

### Timing

The player commits with a key press; the bat arrives `swingTime` later (0.14–0.30 s by stroke). The timing error is the bat's arrival minus the ball's arrival at the contact point.

- **Tolerance is a distance along the ball's path**, so the time window shrinks with ball speed: pace is harder to time than spin. It is widened by the timing attribute.
- **Early strokes** meet the ball as it reaches the contact point.
- **Late strokes** meet it wherever it is when the bat arrives, unless it has already reached the pads or stumps.
- Timing rotates the face continuously (late opens it for straight-bat strokes and turns leg-side strokes finer) and lowers contact quality and bat speed. It is not a pass/fail check.

### Where the bat goes, and what the batter could see

When the batter commits, the bat's line is set from what is visible at that moment.

- **The ball's flight so far** is seen as it is.
- **Swing** is read at 75–100% (it can be seen happening).
- **Spin** is read at 45–95%, depending on technique.
- **A doosra or googly** is read as the stock ball unless the batter picks it, with a 20–80% chance by technique.
- **Seam movement and uneven bounce** cannot be anticipated.

After the ball pitches, the batter can correct, but only if there is time: no correction within 0.1 s of the bounce, up to 90% by 0.35 s, scaled by technique. Whatever is left becomes a sideways and vertical error at the bat.

This is where most edges and plays-and-misses come from. A seaming ball on a good length (little time after the bounce) is dangerous; a half-volley (no time for movement) is safe; spin gives time to adjust but can be misread.

### Contact

`contact.ts` computes contact in three stages.

1. **Quality.** It combines timing error and positional error (the ball's distance outside the line/height window the stroke suits), each normalised by tolerances from technique, timing and footwork: q = exp(−½(τ² + δ²)).
2. **Where on the bat.** Across the face: offset from line errors, lateness and the bat-line error above, plus bounded noise that shrinks with technique and quality. Beyond 4 cm from the centre is an edge (outside or inside); beyond the bat plus the ball's radius is a miss. Along the blade: balls higher than ideal hit nearer the splice (they go up); dug-out balls hit the toe.
3. **Physics.** The batter sets the face for the ball *as perceived*: its pace always, its angle and movement in proportion to technique. Then an impulse model collides the *real* ball with the moving face: the bat is much heavier than the ball, the normal relative velocity is reversed and scaled by restitution, and part of the tangential velocity is kept. Restitution falls away from the sweet spot. The outgoing velocity therefore depends on the delivery's actual speed, angle and bounce, so the same keys against different deliveries give different trajectories.

**Edges** deflect the incoming ball by 3–35° (more for thicker edges), keeping 35–65% of its speed plus some bat push. Outside edges go to the slips and keeper; inside edges can go on to the stumps.

The [batting report](docs/batting-report.md) shows the resulting distributions. It is a description of the model's shape, not proof of realism.

## Fielding and running

`src/game/fielding/plan.ts`.

1. The struck ball's path is projected with the real physics.
2. Each fielder reacts (0.35–0.55 s, or 0.12–0.32 s for close catchers) and runs with acceleration (6 m/s², top speed 5.4–8 m/s by attribute). They reach the ball standing (0.9 m reach) or diving (1.8 m).
3. The first fielder to a catchable or stoppable point takes it. Nobody dives at a ball they could collect cleanly within half a second, and ties go to whoever is better set.
4. **Catches**: the hold probability falls with difficulty: a dive, little time to settle, ball pace (keepers and slips are less troubled by pace), or reaching above 2.2 m. Better catchers hold more.
5. **Ground stops**: a fumble lets the ball run on.
6. **Boundary**: four if the ball reaches the rope and bounced first, six if it did not.
7. **Runs**: the computer takes the runs that are safe (it completes a run only if the batters make their ground with 0.3 s to spare before the return throw arrives at the nearer stumps). A human batter calls each run with Space/R; the batters set off when called, and if the throw reaches the end they are running to before they do, that batter is run out. Timings: call and start 0.35 s, first run 2.95 s, each further run 3.0 s, gather 0.55 s (+0.9 s after a dive), throw release 0.35 s, throw speed 20–32 m/s.

**The field** is a one-day field: keeper, slip, gully, a ring saving the single at 25–27 m, and fine leg back. Fielders stand where real fields put them, which leaves real gaps: a well-timed cover drive or pull can find the rope, while a mistimed one finds the fielder.

## Computer opposition

**Bowling AI**: mostly stock balls in the off-stump corridor, mixed with the bowler's variations. Yorkers are aimed full and bouncers short. Higher difficulty means tighter lines and lengths and better execution.

**Batting AI**: no omniscience. It judges the ball only after 0.14 s of flight, with errors in line and length that grow with lower technique and higher difficulty perception error. It cannot see seam movement before the bounce, and a slower ball or wrong'un can fool it. It picks a stroke for what it *thinks* is coming:

- drive the full ball;
- respect the good-length ball, pushing it into gaps;
- cut or pull the short ball;
- leave the wide one.

It then commits with a timing error drawn from its timing attribute, and its stroke goes through exactly the same contact physics as the human's.

**Match situation**: in a match the batting AI's intent follows the state of the game: it attacks more as the required rate climbs or the overs run out, and defends more when wickets have fallen quickly or the tail is in. The computer captain bowls its best available bowler within the quota rules.

**Difficulty**: Easy, Normal and Hard scale the AI's execution error (×1.6 / 1 / 0.65), perception error, tactical discipline and reaction delay.

Computer v computer at Normal, measured over 400 balls on three seeds: 3.5–5.1 runs per over and a wicket every 30–56 balls, mostly caught, the rest bowled. That is one-day-international territory. Easy gives more wickets (about one per 20 balls) because the computer batter is worse too; Hard gives more runs (about 4.5 per over). The automated test enforces broad bounds: 2.5–11 runs per over and 12–150 balls per wicket.

## Matches

`src/game/match/match.ts` runs a limited-overs match between two sides, either of which may be human or computer.

- **Setup**: overs (2, 5, 10, 20 or 50), difficulty, pitch (affects bounce, pace and turn), and who bats first, or a toss won by a seeded coin.
- **Squads**: four fictional teams of sixteen. The playing XI must be eleven different players from the squad; the squad board warns, but allows, a side with no wicketkeeper, fewer than five bowling options or no spinner. The batting order is the XI's order.
- **Bowler quotas**: at most `ceil(overs / 5)` overs each (one each in a 2–5 over game, four in 20, ten in 50), never two overs in a row, and never the keeper. A human bowling side picks the bowler at the start of each over.
- **Overs** are six legal balls. Strike changes on odd runs and at the end of each over. A run-out removes whichever batter was running to the broken end.
- **Extras**: a no-ball or a wide adds one run and is re-bowled. A wide is a ball passing more than 0.85 m outside off stump or 0.45 m outside leg (relative to the batter), or above head height (1.95 m), that the batter does not hit. No wicket of any kind falls off a no-ball (a simplification: under the Laws a run-out still stands).
- **LBW** (Law 36, simplified): when the ball hits the pad or body first, it is not out if it pitched outside leg stump, or hit the batter outside the line of leg stump, or outside off stump while a stroke was offered. Otherwise the ball is projected on with the same physics as if the batter were not there: out if it would have hit the stumps, not out if it would have gone over or missed. The outcome banner gives the reason.
- **End of innings**: overs used up, ten wickets down, or (second innings) the target passed. Results read "won by N runs", "won by N wickets (M balls left)", or a tie.
- **Scorecards**: runs, balls, fours, sixes and strike rate for each batter with how out; extras; fall of wickets; overs, maidens, runs, wickets and economy for each bowler.

## Presentation

- **Players** are articulated humanoids (pelvis, torso, head, two-bone arms and legs) posed every frame from the simulation: the bowler's run-up, gather, delivery stride and follow-through; the batter's stance, backlift and stroke, with the hands solved onto the bat handle by inverse kinematics; the keeper's crouch and rise; fielders' ready position, running gait, gather and throw; and celebrations on a wicket. Kits use the team colours; batters wear helmets and pads, the keeper gloves and pads.
- **Stadium**: two-tier stands, an instanced crowd that jumps on boundaries and wickets, fictional sponsor boards, floodlights and a live scoreboard.
- **Camera**: a broadcast view from behind the bowler, which follows the struck ball; <kbd>C</kbd> cycles views.
- **Sound** is synthesised with the Web Audio API: the bat (a sharper, louder crack for a well-timed hit, a dull click for an edge), pads, stumps, the bounce, catches, boundaries and the crowd's murmur and cheers.
- **Graphics quality**: Low turns off shadows, the crowd and high-DPI rendering, and is chosen by default on software renderers.

## Not yet implemented

- Byes, leg byes and overthrows; DRS.
- Field changes and captaincy tactics beyond bowler selection.
- Sending a batter back after a run is called.
- Stroke spin imparted on the ball; inside edges onto the pad.
