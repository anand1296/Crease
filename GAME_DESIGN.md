# Game design

This document records gameplay rules and simulation decisions as they are implemented. Sections for systems that do not exist yet are deliberately absent rather than speculative.

## Principles

- Gameplay over graphics; skill over arbitrary randomness.
- One source of truth: the simulation decides what happened, the renderer only shows it.
- Every random draw comes from a seeded RNG, so any delivery or match can be replayed exactly.
- Randomness is bounded and scaled by skill, timing and contact quality, never added just to make results differ.

## World and units

- SI units throughout: metres, seconds, kilograms.
- Origin at the centre of the pitch. **x** runs across the pitch (+x is the off side for a right-handed striker), **y** is up, **z** runs along the pitch towards the striker.
- Striker's stumps at z = +10.06, bowler's-end stumps at z = −10.06 (22 yards apart).
- Dimensions follow the Laws of Cricket: popping crease 1.22 m in front of the stumps, return creases 1.32 m either side of middle stump, stumps 71.1 cm high and 22.86 cm wide, ball radius 3.6 cm and mass 160 g. Boundary radius is 65 m.
- From the default broadcast camera (behind the bowler) +x appears on the left of the screen.

## Simulation timing

- The simulation advances in fixed steps of 1/240 s, independent of frame rate.
- Frame deltas longer than 0.1 s (hidden tab, debugger) are clamped, so the game pauses rather than fast-forwards.
- Rendering interpolates between the last two simulation states.
- Verified by tests: identical results at 30, 60 and 144 fps to within one step.

## Ball physics (P0)

Implemented in `src/game/physics/ball.ts`. Integration is semi-implicit Euler.

| Effect | Model | Tunable |
| --- | --- | --- |
| Gravity | 9.81 m/s² | — |
| Air drag | a = −k·\|v\|·v, k = ½ρ·Cd·A / m with Cd = 0.45 | `DRAG_K` |
| Bounce | vertical speed × restitution (0.55 default) | `SurfaceProperties.restitution` |
| Bounce friction | 12 % of horizontal speed lost per bounce | `bounceFriction` |
| Rolling | constant deceleration, 1.6 m/s² | `rollingResistance` |

Safety rules:

- Ground contact is resolved after each step and the ball is put back on the surface, so it cannot tunnel through the ground at any speed.
- Bounces with vertical impact speed under 0.35 m/s become rolling, so the ball cannot micro-bounce forever.
- Speed is capped at 70 m/s, above anything achievable in cricket, as a numerical guard.

Not yet modelled (planned for P1/P2): swing, seam movement, spin and its effect on bounce, bat contact, stump collision.

## Demo deliveries (P0 only)

An attract-mode loop bowls seeded deliveries at 28–40 m/s (≈100–145 km/h) aimed to pitch between 2 m and 9 m in front of the striker's stumps. The launch velocity is solved ignoring drag, so drag makes deliveries pitch slightly shorter than targeted. This loop is replaced by the real delivery engine in P1.

## Fielding positions

Positions are data (`src/game/data/fieldPositions.ts`), given as angle and distance from the striker's stumps, and mirrored for left-handers. The P0 field is a standard one-day setting with a wicketkeeper and nine fielders.
