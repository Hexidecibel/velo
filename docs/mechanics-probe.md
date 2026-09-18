# Three techniques, measured

Empirical probe of three Elasto Mania techniques against the bike we actually
have. Physics is **SIM_REV 4**, shipped bike (`BOOT_PRESET`, the hand-tuned
"soft" preset: gravity 9, stiffness 6500, damping 320/320, maxTorque 126,
attitudeTorque 340, brakeTorque 900, `inertialTransferBrake` 0.6). Nothing here
proposes a physics change. The question was only ever "can this bike do it".

Every number below comes from headless runs through `advance(mask)` on
`getEngine(4)`, so everything measured is expressible as a replay. Rigs live in
`/tmp/.../scratchpad/mech/` (throwaway); four probe levels were validated with
`bin/level-check` and all four solve with `bin/solve` on rev 4.

**How to read the timing numbers.** For each technique I report the *window*:
the contiguous span of input frames for the timed key press that still succeeds,
converted to milliseconds (1 input frame = 7.8125 ms). And the *sloppy rate*:
success over 200 trials with every timed event jittered uniformly by ±50 ms.
A sub-30 ms window is a TAS curiosity; 150 ms is a skill; 500 ms is free.

Caveat, stated once and meant throughout: the *timed* events are jittered, while
the continuous steering (attitude hold on the lean keys) is done by a fixed
controller. A person is worse than that controller at steering and better at
reacting to what they see. Treat the milliseconds as the **timing budget**, not
as a full playability model.

---

## Baseline facts you need to read the rest

| | |
|---|---|
| Terminal speed, flat, throttle + attitude hold | **11.7 m/s** |
| Time from standstill | 6 m/s at 2.0 s, 9 m/s at 3.7 s, 10.8 m/s at 6 s |
| Holding throttle with *no* lean correction | loops and dies at **1.80 s** |
| Holding the brake on flat above **3.3 m/s** | over the bars, dead |
| Mid-air rotation authority, lean key | **~135–140 °/s** |
| Mid-air rotation authority, throttle (via drive reaction) | **~25 °/s** |

---

## 1. Popping off a wall to reverse — **works, and is generous**

### Does it work

Yes, and the timing is not the hard part. But it does not do what the name
suggests: on rev 4 a flat wall is not a trampoline, it is **a brake that costs
you no distance**.

**Hands off, coasting into a vertical wall** (no input after release):

| approach | peak rebound | outcome |
|---|---|---|
| 5.98 m/s | −2.16 m/s | pitches to −135°, dead |
| 8.76 m/s | −2.52 m/s | stops against the wall |
| 11.28 m/s | −2.66 m/s | stops against the wall |

Nine of twelve hands-off runs (wall angles 60–90°, speeds 6–11.5) ended dead —
the impulse pitches the bike *nose-down into the wall* (the contact is below the
CoM) and it keeps rotating to −135° until the head hits the floor. So the wall
alone doesn't reverse you. **The rider has to rotate.**

### How much speed survives

Coast-out speed measured 3 m back from the face, throttle **off** after the turn,
best over a grid of lean/flip timings:

| face | in 6 | in 9 | in 11.5 |
|---|---|---|---|
| wall 105° (overhang) | 2.08 (35%) | 2.12 (24%) | 2.04 (18%) |
| wall 90° | 2.49 (41%) | 2.56 (28%) | 2.42 (21%) |
| wall 75° | 2.48 (41%) | 2.44 (27%) | 2.63 (23%) |
| wall 60° | 2.84 (47%) | 2.25 (25%) | 2.67 (23%) |
| quarter-pipe R=1 | 3.28 (55%) | 3.36 (37%) | 3.00 (26%) |
| quarter-pipe R=2 | 3.95 (66%) | 3.81 (42%) | 2.76 (24%) |
| quarter-pipe R=3 | 4.08 (68%) | 4.27 (47%) | 5.83 (51%) |
| **quarter-pipe R=5** | 4.24 (71%) | **5.62 (62%)** | **6.88 (60%)** |
| quarter-pipe R=8 | 3.86 (64%) | 5.69 (63%) | **7.18 (62%)** |
| quarter-pipe R=12 | 3.67 (61%) | 5.41 (60%) | 6.84 (59%) |

**The dial is the transition radius, not the wall angle.** Every flat face from
60° through a 105° overhang returns the same 2.0–2.8 m/s and that number is
*independent of how fast you arrive* — the signature of a saturated, near-inelastic
contact (restitution 0.05 plus a spring that bottoms on its 0.25 m clamp), not of
a controller that failed to find the trick. Put a **radius of 5 m or more** under
the wall and it becomes a real pop: 60–71% of approach speed comes back, because
you are now converting speed to height and back rather than into the spring.
Above R≈5 it saturates — R=8 and R=12 buy nothing over R=5.

### The window

Two timed events: when you start rotating the nose up into the face, and when you
press flip. Everything else is continuous steering.

| face | approach | lean-start window | flip window | sloppy ±50 ms |
|---|---|---|---|---|
| wall 90° | 9 | 516 ms | 1156 ms | **100%** |
| wall 90° | 11.5 | 688 ms | 1078 ms | **100%** |
| wall 75° | 9 | 453 ms | 344 ms | 98% |
| wall 105° | 9 | 719 ms | 375 ms | **100%** |
| wall 60° | 9 | 500 ms | 406 ms | 86% |
| pipe R=3 | 9 | 719 ms | 1063 ms | **100%** |
| pipe R=5 | 11.5 | 719 ms | 1188 ms | **100%** |
| pipe R=8 | 11.5 | 719 ms | 516 ms | **100%** |

Windows of 340–1200 ms, sloppy success 86–100%. This is vocabulary, not a trick.
The one awkward case is the shallowest wall (60°) — shallow enough to ride *up*,
so an early rotation launches you off it, and that's where the 86% comes from.

### What it's actually for: space, not speed

Turnaround time measured across a ±12 m gate (cross it going right, cross it
going left):

| approach | off a wall | off a pipe R=5 | flat: brake, stop, flip, go |
|---|---|---|---|
| 9 m/s | **3.40–3.52 s** | 3.52 s | 3.70–5.64 s, needs 7.4–11.5 m of run-out |
| 11.5 m/s | **3.14–3.22 s** | 3.75 s | 4.42–7.21 s, needs 10.5–17.9 m |

A wall reverses you inside about a metre. Stopping needs ten. **That** is the
mechanic: the wall is how you turn around in a space where you could not have
stopped.

### What a level built on it should ask

A dead-end pocket with the apple at the back of it and no braking room — the wall
is the only way out, and the level is teaching "you can aim at that and live".
Then make the transition radius the difficulty knob across two or three
instances: a flat back wall means you leave at walking pace and have to rebuild
everything, a 5 m transition means you leave at 60% and keep the run alive. That
contrast is the whole lesson and it is legible at a glance from the geometry.

---

## 2. Tight descending S-curves — **works, but "tight" and "fast" are exclusive**

### The governing number

An arc of bulge `b` over a chord of horizontal length `L` has radius
`R ≈ L²/(8b)`. Whether the bike stays on a crest is the textbook condition
`v < sqrt(g·R)`. It holds here, and it holds *across scale*: four geometries with
very different absolute sizes but matched `v/v_crit` give the same answer.

Contact fraction through the middle of a 10-arc alternating section, pooled:

| v / v_crit | contact | longest continuous air |
|---|---|---|
| 0.30 | 87–90% | ~100 ms |
| 0.45 | 85–89% | 100–170 ms |
| **0.60** | **76–87%** | **100–170 ms** |
| 0.75 | 68–74% | 270–305 ms |
| 0.90 | 49–58% | 290–700 ms |
| 1.10 | 30–50% | 450–720 ms |
| 1.40 | 34–50% | 660–775 ms |

The boundary between *riding* and *scenery* is **v/v_crit ≈ 0.6–0.75**. Past 0.9
the rider is a passenger: over half the section is airborne and the curves are a
sequence of unaimed jumps.

### The design band, in metres

Rideable (contact ≥ ~80%, air bursts ≤ ~170 ms) needs

```
b  ≤  0.045 · g · L² / v²     →   at g = 9:   b ≤ 0.4 · L² / v²
```

| chord L | at 5 m/s | at 9 m/s | at 11.5 m/s |
|---|---|---|---|
| 3 m | b ≤ 0.14 | b ≤ 0.045 | b ≤ 0.027 |
| 5 m | b ≤ 0.40 | b ≤ 0.12 | b ≤ 0.076 |
| 8 m | b ≤ 1.02 | b ≤ 0.32 | b ≤ 0.19 |
| 12 m | b ≤ 2.3 | b ≤ 0.72 | b ≤ 0.44 |

Read the 9 m/s column and the answer to the original question falls out: **at
speed a genuinely tight S is not expressible as a riding problem.** A 3 m chord
at 9 m/s wants 45 mm of bulge, which is invisible. Tight S-curves are a
*low-speed* feature. Conversely a *long* S (8–12 m chords) at half a metre of
bulge is fully rideable at 9–11 m/s and reads as flowing terrain.

Grade barely matters. 0°, 10° and 18° descents all collapse onto the same
`v/v_crit` curve; the grade only sets what speed you arrive at.

### Two side effects worth designing with

**It is a speed regulator.** Push a section past v_crit and it takes the speed
back. L=4, b=0.5 (v_crit 6.0) on a 10° descent: enter at 9.9 m/s, exit at 5.6.
Enter at 3.3 and exit at 3.9. The section pins you near v_crit from either side.
That is a clean way to cap a run without a wall or a brake gate.

**The dishes bottom the suspension.** Peak wheel-to-anchor deflection hits the
0.25 m hard clamp for every case with `v/v_crit ≳ 0.8`, and stays at 0.18–0.21
below it. The point where it starts to feel harsh is the same point where you
start losing contact — one boundary, two symptoms.

### Is there a skill in it? Yes, in the loose half only

Coast in with the **throttle off** and see whether timed lean strokes beat a
passive attitude hold. Every candidate branches from one snapshot, so the run-up
is identical by construction. Gain is energy the rider put in.

| geometry (10° descent) | R | v in | best baseline | best timed stroke | gain | phase window |
|---|---|---|---|---|---|---|
| L=8, b=0.35 | 22.9 | 8.91 | 7.60 | 9.77 | **+2.17 m/s** | 266 ms of a 898 ms cycle |
| L=8, b=0.5 | 16.0 | 8.83 | 7.41 | 9.64 | **+2.23 m/s** | 125 ms of a 906 ms cycle |
| L=5, b=0.2 | 15.6 | 7.40 | 7.06 | 8.47 | +1.40 m/s | every phase wins |
| L=5, b=0.35 | 8.9 | 7.18 | 7.45 | 8.12 | +0.67 m/s | 281 ms of a 695 ms cycle |
| L=5, b=0.5 | 6.3 | 6.97 | 6.48 | 7.17 | +0.68 m/s | **8 ms** — TAS only |
| L=8, b=0.8 | 10.0 | 8.54 | 6.19 | 7.43 | +1.24 m/s | **8 ms** — TAS only |
| L=8, b=0.5, 18° | 16.0 | 13.29 | 11.87 | 12.33 | +0.46 m/s | **8 ms** — TAS only |

Working the bike through the alternation is worth **1.4–2.2 m/s over 50–80 m of
coasting**, and the phase window is **125–280 ms** in the loose band — a real,
learnable rhythm. Tighten the curves (R ≤ 10) or steepen the descent and the
window collapses to a single frame. Pumping is a mechanic for *long* rollers, not
for tight ones.

### What a level built on it should ask

A descending S whose fast line sits right at the top of the contact band — around
`v = 0.6·v_crit`, say 8 m chords at 0.35–0.5 m of bulge, entered at 9 m/s. Then
you get a genuine choice: ride the rhythm and pump out 2 m/s faster than you came
in, or send it, get bounced, and arrive at the bottom *slower* despite having
gone in quicker. Put the reward at the exit — a gap that only the pumped exit
clears — so the two outcomes are visibly different rather than just a timer
difference.

---

## 3. Timed reverses — **works, but only one situation makes the timing real**

### What the flip actually does

`facing *= -1` and nothing else. It selects the driven wheel and the sign of the
drive torque. Which means: **the flip's timing can only matter while the throttle
is held.** With the gas off it is free in every sense.

The tempting second use — flip mid-air to reverse the chassis rotation, because
the drive reaction lands on the chassis — **does not work on rev 4**. Measured
rotation over the first second of a launch:

| held input | rotation |
|---|---|
| nothing | 0.9 °/s |
| throttle | 24.9 °/s |
| lean key | 133–140 °/s |

The flip-driven rotation is under a fifth of a lean key. Sweeping the flip frame
across an entire flight (111 frames, three gap/drop geometries, gas held
throughout) produced **zero** successful landings. If you want to rotate, you
press a lean key; the flip cannot save a flight.

What throttle-in-air *is* good for is the opposite: it is a **stabiliser**. Off a
kicker the bike drifts nose-down ~18° over 0.75 s hands-off; holding the gas
arrests that at ~6°. Worth knowing as vocabulary in its own right.

### Where the timing does become real

Ride up a transitioned wall **on the gas** to reach something near the top of your
reach. Flip and the drive turns from a climb into a descent.

With nothing above you, the window is one-sided and wide open: too early fails
(you never got the apple), too late never fails. Even with the apple 0.1 m below
the maximum reachable height the window is **1188 ms** — that is a height gate
wearing a stopwatch, not a timing skill.

Put a **ceiling** over it and the window becomes two-sided, because the gas is
still driving you upward while your head arrives. Apple at y = 3.3, approach
11.5 m/s, transition R=3:

| roof height | headroom over the apple | window | sloppy ±25 | ±50 | ±80 | ±120 |
|---|---|---|---|---|---|---|
| 4.20 | 0.90 m | 289 ms | 100% | 100% | 100% | 100% |
| 4.10 | 0.80 m | 188 ms | 100% | 100% | 100% | 87% |
| 4.05 | 0.75 m | 164 ms | 100% | 100% | 100% | 85% |
| **4.00** | **0.70 m** | **148 ms** | 100% | 100% | 94% | 81% |
| 3.95 | 0.65 m | 125 ms | 100% | 100% | 86% | 79% |
| 3.90 | 0.60 m | 94 ms | 100% | 95% | 77% | 68% |
| 3.85 | 0.55 m | 70 ms | 100% | 80% | 74% | 63% |
| 3.80 | 0.50 m | 55 ms | 100% | 78% | 68% | 54% |
| 3.75 | 0.45 m | 47 ms | 94% | 86% | 66% | 58% |

**Headroom is a continuous difficulty dial with a clean calibration.** About
0.7 m of clearance over the target gives a 148 ms window at 94% under ±80 ms of
slop — a skill. Half a metre gives 55 ms — a TAS line. Anything above 0.9 m is
free.

The failure at the late end is a head death: the rider's arm and head are still
climbing while the drive pushes the bike up. That is the same lethality the sim
deliberately keeps for volting into a low ceiling, reused as a timer.

### What a level built on it should ask

An alcove up a wall, under a lid: climb on the gas, take the thing, flip before
your head gets there. Ship it at 0.8–0.9 m of headroom the first time it appears
(188–289 ms, essentially unmissable once you know it exists) and at 0.65–0.70 m
where you want it to bite (125–148 ms). Do not go below 0.55 m; past there it
stops being a skill and starts being a re-roll.

---

## Things I stumbled into that are worth more than one of the three

### The brake is not a stop button — it is a pitch control

This is the biggest single finding and it is not one of the three techniques.

A **held** brake on flat ground puts the bike over the bars above **3.3 m/s**
(survives 3.2, dies 3.4). From 9 m/s the chassis reaches −179° and the head hits
the floor in about half a second. Holding a lean key against it does not save it
either. This is `inertialTransferBrake = 0.6` doing exactly what it says.

What survives is **pulsing**:

| technique from 9 m/s | result |
|---|---|
| held | dead |
| 32 frames on / 32 off (250 ms strokes) | dead |
| **16 / 16 (125 ms strokes, ~4 Hz)** | **stops in 2.12 s / 7.6 m** |
| 8 / 8 (62 ms strokes) | stops in 2.47 s / 7.6 m |
| 2 / 2 (15.6 ms strokes — not human) | stops in 1.40 s / 5.3 m |
| release whenever the nose is already down past oy < −0.2 | stops in 1.70 s / 7.4 m |

So "how do I slow down" already has a technique in this game, with a ~125–250 ms
stroke window, and it is arguably a more fundamental piece of vocabulary than any
of the three asked about. A level that teaches braking — a long descent into
something you must arrive at slowly — would be teaching a real skill.

### The throttle needs a hand on the lean keys at all times

Holding the throttle from a standstill with no attitude correction loops the bike
and kills it at **1.80 s**. Any correction at all fixes it completely: attitude
deadbands from 0.02 to 0.2 all survive 20 s and reach 11.5–12.2 m/s. This is on
the *shipped* preset, not the plan defaults. "Gas and lean are one input" is a
true statement about this bike.

### Wall rebound has a hard ceiling

Arriving faster at a flat wall buys you nothing: 6 / 9 / 11.3 m/s in returns
2.16 / 2.52 / 2.66 m/s out. Above about 6 m/s the impact is effectively
inelastic. Useful as a designer's guarantee: you cannot build a flat wall that
someone can "hit harder to go faster" off.

### Independent check against the repo's own tools

Four minimal probe levels — flat-wall pop, transition pop, S-band descent, timed
reverse under a roof — all pass `bin/level-check` and all four **solve on rev 4**:

| probe | difficulty | time | note |
|---|---|---|---|
| flat wall pop | 31/100 | 13.8 s | 2% of one-frame slips fatal |
| transition pop | 46/100 | 12.5 s | 4% fatal |
| S-band descent | 48/100 | 16.5 s | **11% fatal, lethality 1.00** — the most dangerous of the four, consistent with contact loss being the risk |
| timed reverse | 29/100 | 14.4 s | 2% fatal |

The solver is not the evidence for any claim above — it is the existence proof
that each geometry is completable at all, and it agrees with the hand-driven
measurements about which one is dangerous.

---

## Summary

| technique | verdict | window | sloppy ±50 ms | lives at |
|---|---|---|---|---|
| **Wall pop** | **works, generous** | 340–1200 ms | 86–100% | any face 60–105°; returns 2.0–2.8 m/s. Put R ≥ 5 m under it to return 60–70% instead |
| **Descending S** | **works below `v = 0.6·sqrt(gR)`** | pump phase 125–280 ms (loose), 8 ms (tight) | n/a — continuous steering | `b ≤ 0.4·L²/v²`. Tight + fast is not available; tight is a slow-speed feature |
| **Timed reverse** | **works, needs a lid** | 148 ms at 0.70 m headroom; 55 ms at 0.50 m | 94% at ±80 ms | gas held, climbing a wall under a ceiling |
| *(bonus)* **Pulsed brake** | **works, and is load-bearing** | 125–250 ms strokes | — | anywhere you must stop; a held brake is lethal above 3.3 m/s |
