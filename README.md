# Velo

A 2D motorbike physics game in the spirit of **Elasto Mania**: ride through
polygon caves, collect every apple, touch the flower to finish. Two sprung
wheels, and a rider whose **head is a death sphere** — touch it to terrain and
the run is over.

**This repo is at milestone 1.** Milestone 1 is one bike, one deliberately ugly
hand-written test level, and a live tuning panel — ridden until it feels good.
Nothing downstream starts until that lands, because if the bike does not feel
good, nothing downstream rescues it.

```
bin/dev     # then open http://127.0.0.1:5173/ and drive
            # ...or http://127.0.0.1:5173/?level=bowl for the arc level
```

## What this is not

- **It is not a game yet.** There are no menus, no art, no audio, no juice, and
  two levels. `test01` is ugly on purpose, so that you can see what the collision
  is doing; `test02` exists to exercise the level format's curve primitive and is
  reachable only by typing `?level=bowl` into the URL, because a level *menu* is
  milestone 6.
- **There is no server, no leaderboard, and no network code.** `getEngine()`
  exists in `src/sim/rev.ts` because physics versioning is a one-way door and
  costs nothing to build now, but nothing calls it over HTTP. Port 9422 is
  penciled in for later; it is *not* claimed, HAProxy is untouched, and
  `INFRASTRUCTURE.md` has not been edited.
- **It is not a level editor.** The level *format* is a deliverable — it is
  plain JSON you can write in a text editor — but the visual builder is deferred.
- **It is not tuned.** The numbers in `DEFAULT_SPEC` are reasoned starting
  points that the plan supplied, and measurement says several of them are wrong
  (see *State of the bike* below). Changing them is the entire point of the
  panel.
- **It is not a physics library.** There is no Box2D, no Matter.js, no Rapier.
  A third-party engine cannot promise bit-identical results across browsers and
  a server, and that promise is the only thing that makes a re-simulated
  leaderboard cheat-proof.

## Scripts

Every operational task goes through `bin/`. If something you need is not here,
add a script rather than running an ad-hoc command.

| Script | What it does |
| --- | --- |
| `bin/dev` | Vite dev server on 127.0.0.1:5173. The only way to play right now. |
| `bin/build` | `tsc -b` typecheck (a separate, mandatory step) then `vite build` into `dist/`. |
| `bin/test` | vitest, colocated, plain node. `--watch` to re-run on change. |
| `bin/lint` | `tsc -b` plus eslint. Both, in that order — eslint here is type-unaware. |
| `bin/smoke` | Builds, then drives the real page in headless Chrome over CDP: asserts nothing threw, nothing went NaN, the replay verifies, and the **cross-engine hash chain from Chrome's V8 matches Node's V8**. |
| `bin/preview` | Serves the built `dist/`. A production-bundle sanity check, not a deployment. |
| `bin/level-export` | Writes the built-in levels out to `levels/test01.json` and `levels/test02-bowl.json`. |
| `bin/level-check` | Validates a hand-authored level JSON, prints its two hashes, and **warns about straight runs too coarse to ride smoothly**. |
| `bin/level-drive` | Drives a level headlessly with a scripted rider and reports whether every apple and the flower can actually be reached. |
| `bin/slope-sweep` | Sweeps a synthetic ramp across slope angle, entry speed, input strategy and transition sharpness, and prints what the bike does. |
| `bin/clean` | Removes `dist/` and `tsconfig.tsbuildinfo`; `--all` also removes `node_modules/`. |

`start`, `stop`, `status`, `logs`, `install-units` and `deploy` arrive with the
server milestone and deliberately do not exist yet.

## Controls

| Key | |
| --- | --- |
| arrows / WASD | gas, brake, volt left, volt right |
| space | flip (changes the driven wheel; free, legal mid-air) |
| R | restart |
| T | replay the last run and check its hash chain |
| G | draw contacts and surface normals |
| H | hide the tuning panel |
| `+` / `-` | zoom |
| P | pause |

## The tuning panel is the deliverable

Not the renderer, and not a debug tool. "Ride it until it feels good" means
changing the `BikeSpec` dozens of times in a sitting, and doing that by editing
a source file and waiting for HMR is roughly ten times slower than dragging a
slider. The groups are ordered by how much of the feel they own: suspension and
wheel friction first (call it 80%), then volt authority, then drive, then
chassis and world.

When it feels right, press **Copy spec JSON** and paste the result over
`DEFAULT_SPEC` in `src/sim/spec.ts`. Do not retype it. A slider emits doubles
like `0.30000000000000004`, and the exact doubles that were tuned with must be
the exact doubles that ship — `JSON.stringify` writes the shortest decimal that
reparses to the identical double, which is exactly the guarantee wanted here.

Editing a slider rebuilds the world around the new spec **without** moving the
bike, so you can tune suspension mid-air. It also discards the current
recording, because a replay whose spec changed halfway through is not
reproducible and silently keeping one would be worse than losing it.

## State of the bike

Honest status, measured rather than asserted. All of it on flat ground with the
plan's geometry, and re-measured after the rotation-authority change below.

- The plan's `DEFAULT_SPEC` is **not driveable**. Holding the throttle from a
  standstill pitches the bike past 90 degrees within 0.4 s and backflips it into
  the floor, at every drive torque above about 160 N·m. 450 N·m on a 0.25 m
  wheel is 1800 N of thrust on a 71 kg bike — 2.5 g, far past the ~910 N the
  contact patch can actually put down — so the wheel spins and the reaction
  torque loops the chassis.
- The client therefore boots on **M1 candidate**, which now differs in six
  numbers. Four came from the user's own hands on the sliders — drive torque
  450 → 140, chassis inertia 11 → 12, angular damping 0.15 → 3.0, lean angle
  40° → 28° — and two are the rotation-authority fix below: `attitudeTorque`
  0 → 340 and `weightTransfer` 1 → 0.6. The plan's spec is one click away in the
  preset menu for comparison.
- With the candidate, measured on flat ground: **12.7 m/s** top speed, reached in
  about 8 s; full throttle from a standstill **stays upright** and pitches only
  3°; 200 N·m of drive torque loops it at 1.4 s, so the margin is now 60 N·m
  rather than 5.
- **Rotation is its own control now, and that is a physics change, not a tuning
  one.** See below.

### Rotation authority, and why the pendulum alone was wrong

A playtest found it: *"spin just keeps going, need to be able to correct
easily."* That was not a slider being off. The rider was a driven pendulum and
nothing else, and three things combined to make rotation uncontrollable:

- the servo's lean target is **chassis-relative**, so when the chassis spins the
  target spins with it, the arm tracks it happily, and no correcting torque is
  produced at all;
- servo torque **vanishes as the arm arrives**, so rotation authority was a
  one-shot impulse rather than sustained control;
- the only sustained term was gravity weight transfer, which depends on the
  arm's **world-horizontal** component and therefore **averages to zero over a
  revolution**. During a spin it is a wobble, not a brake.

Net: rotation control was strongest upright and useless inverted — exactly
backwards from what a player needs. Elasto Mania's left and right rotate the
bike **identically at every attitude**, and that orientation-independence is
precisely why a spin there is recoverable.

So `rider.attitudeTorque` is now the primary rotation control: a constant torque
on the chassis while a lean key is held, sign from the direction, with no
dependence on orientation or on gravity. **It is a gameplay term, not a physical
one** — nothing receives the reaction, so it does not conserve angular momentum.
That is deliberate. The physically honest version would react against wheel
angular momentum the way a motocross rider does, and it was rejected because
authority would then vanish whenever the wheels are stopped, which is exactly
when the player most needs to correct.

The servo and the pendulum arm are unchanged. They still move the arm and
therefore the **head**, which is what makes volting under a low ceiling lethal —
a real skill worth keeping. `rider.weightTransfer` (0–1) scales the gravity term
so that leaning back on the throttle still produces a wheelie without gravity
dominating rotation.

Measured on the candidate, in free fall, at 340 N·m against inertia 12 and
angular damping 3.0:

| input | result |
| --- | --- |
| 6-frame tap (47 ms) | 46° — an attitude nudge |
| 13-frame tap (0.1 s) | 89° — a committed correction |
| 1 s hold | 267° — past inverted, still recoverable |
| held | terminal 4.16–5.74 rad/s, ~63% of it by 0.33 s |
| held, from rest | first full flip at **1.61 s** |
| held, at terminal | **1.26 s** per revolution |
| arresting a −6 rad/s spin | **0.18 s** |
| arresting a −8 rad/s spin | 0.21 s |

**"The longer you hold, the faster you spin" falls out and needed no special
case.** A constant torque against linear angular damping gives
`ω(t) = ω∞·(1 − e^(−ct))`, so a tap is a nudge, a hold accelerates toward a
ceiling, and a sustained hold does clean continuous flips. There is deliberately
**no ramp or charge-up mechanic**; if the plain exponential still feels too
abrupt near neutral, a ramp should be a separate, argued change rather than
something smuggled in here.

On flat ground a held lean does **not** lift the front on its own: 340 N·m is
under the ~410 N·m it takes to tip 68 kg over a 0.6 m half-wheelbase. A 26-frame
hold from rest gives 9° of pitch and a 10 cm hop. That split is intentional —
the ground holds you, the air is where you rotate.

`weightTransfer` costs less than expected to turn down, which is worth knowing
before reaching for the slider. Same 26-frame hold from rest:

| `weightTransfer` | ground pitch | hop | airborne spin band |
| --- | --- | --- | --- |
| 1.0 | 11° | 12 cm | 3.57–6.23 rad/s |
| 0.6 | 9° | 10 cm | 4.16–5.74 rad/s |
| 0.4 | 9° | 9 cm | 4.44–5.49 rad/s |

So the ground feel survives being turned down and the airborne spin rate stops
swinging by 75%. 0.6 keeps a visible once-per-revolution wobble, which reads as
the rider's weight swinging round rather than as noise. 1.0 is the old behaviour
exactly.

Still true, and still the first slider to reach for:

- **Throttle held through airtime rotates the bike backwards**, hard — drive
  torque is reacted on the chassis and an airborne wheel gives the reaction
  nothing to push against. That is a real Elma technique rather than a bug, but
  it also means holding gas through a spawn drop or a crest commits you to a
  loop. Both test levels start with a 5 cm settle for exactly this reason.
- **A wheelie is an unstable equilibrium**, so there is no drive torque at which
  the bike holds one: the restoring moment falls as the nose rises while the
  driving moment does not. Under power, a 6-frame lean tap gives 25° and a
  12-frame tap loops you. That cliff is inherent, not a tuning miss.
- The earlier note that *"below ~50° a volt pitches the bike the wrong way"* no
  longer applies. It was true when the servo's reaction torque was the only
  rotation authority there was. Lean angle is now back to meaning what it should
  — where the rider's **weight and head** go — which is why 28° is fine.

## Climbing a hill, and what a sharp corner costs

A playtest: *"impossible to go up a semi-steep slope, even with lots of speed."*
`bin/slope-sweep` exists to answer that with measurement rather than argument —
it sweeps slope angle against entry speed, for two input strategies and two
transition geometries, and reports the outcome, the energy that survived the
transition, and the peak chassis pitch.

**Being unable to blast up a hill is correct, and it is where the skill lives.**
In Elasto Mania you arrive with momentum, lean into the face as you make contact
so the bike's attitude matches it, and correct your way up. So the target is a
*gap*: naive input fails legibly, technique succeeds repeatably. Here is that gap
(M1 candidate, sharp corner at the base, 3.5 m of rise):

| slope | naive, throttle only | technique, lean into the face |
| --- | --- | --- |
| 20–35° | OK at 4–16 m/s | OK at 4–16 m/s |
| 40° | loops at 4 m/s, OK above | OK at 4–16 m/s |
| 45° | loops at 4 and 8 m/s | OK at 4–16 m/s |
| 50° | **loops at every speed** | OK at 8–16 m/s, stalls at 4 |

Naive fails by **looping** — peak pitch 180° — which is legible and recoverable
knowledge. Technique holds it at 45–66° and climbs. That is the shape wanted, and
it arrived for free with the rotation-authority fix; **no drive or traction
number was changed.**

### The dominant variable is not the bike, it is the corner

The counterintuitive half of the report — *"even with lots of speed"* — is real,
and the reason is geometric, not a tuning miss. A wheel meeting a corner square
loses the component of its velocity **normal to the new face**, and restitution
is 0.05, so almost none of it comes back: `cos²θ` of the kinetic energy is
destroyed on contact, before the rider has any say. Measured, as the fraction of
energy surviving the transition:

| slope | 8 m/s | 12 m/s | 16 m/s |
| --- | --- | --- | --- |
| 30°, sharp corner | 1.00 | 0.79 | 0.61 |
| 40°, sharp corner | 0.86 | 0.61 | 0.40 |
| 50°, sharp corner | 0.62 | 0.29 | **0.19** |
| 50°, 1.5 m fillet | 1.00 | 0.58 | 0.34 |

So arriving fast at a sharp 50° corner throws away four fifths of the run-up. It
compounds with the drive curve — torque falls linearly to zero at 20 m/s, so
speed also buys less thrust — but the corner is much the larger term.

**The fix is level design, and the tool is the arc primitive.** A filleted
transition converts the velocity direction gradually instead of destroying it:
with a 1.5 m fillet the technique rider gets up **every** angle tested, including
50° from 4 m/s, where a sharp corner stalls. `test02` fillets its transitions and
a scripted rider completes it in every configuration tried; `test01` is all hard
corners on purpose and its slopes are kept correspondingly gentle, with one real
35° climb.

### What was ruled out

- **Not traction.** Friction 1.4 allows ~54° before the tyre slips, and the
  wheel is not breaking loose at the angles that fail.
- **Not raising `maxWheelSpin`.** It would let throttle alone brute-force a steep
  face, which deletes the technique and makes the game worse. Explicitly not done.
- **Not the missing `m·a` inertial reaction** — at least not first. Leaning
  already transfers real load onto the driven wheel: on a 50° face, holding the
  attitude-matching lean roughly doubles the driven wheel's suspension
  compression (26 mm → 60 mm) against the same run. The mechanism exists, so the
  dynamic term is a refinement rather than the missing piece.

## Determinism

Replays must reproduce **bit-identically** in the browser and on the server, or
server-side leaderboard verification is worthless. The rule is not "go
fixed-point" — that is a permanent tax on readability and tuning. It is:

> `src/sim` uses only `+ - * /` and the exactly-specified `Math` functions, and
> imports nothing at all.

`Math.sin`, `cos`, `tan`, `exp`, `pow`, `log`, `atan2` and friends are
*implementation-approximated* by ECMA-262 and genuinely differ between V8,
SpiderMonkey and JavaScriptCore. So is the `**` operator. Orientation is
therefore a unit complex number rotated by fixed Taylor polynomials and
renormalised with `sqrt`, never an angle; the rider's lean targets are pre-baked
unit vectors; the drive torque curve is piecewise linear; damping is
`v /= (1 + c*DT)` rather than `v *= exp(-c*DT)`.

Two tests enforce this and they were written **before** any physics:

- `src/sim/purity.test.ts` — monkeypatches every banned `Math.*` plus
  `Date.now` and `performance.now` to throw, then runs a full record-and-verify
  replay through them. It also scans the source, because a runtime trap cannot
  see a branch no test reaches and a source scan cannot see an aliased call.
- `src/sim/isolation.test.ts` — reads `src/sim/*.ts` and fails on any import
  specifier that leaves the directory, or any reference to a DOM, Node or timer
  global.

Neither has any coupling to the physics constants, so neither churns while the
bike is being tuned. That is exactly why they were cheap to write first, and why
skipping them is how a `Math.pow` ends up three months deep.

The renderer is explicitly exempt and uses `atan2`, `sin` and `cos` freely —
nothing downstream of rendering is ever verified.

`bin/smoke` closes the loop: `src/sim/crosscheck.ts` runs a fixed 2000-frame
input stream and returns its state-hash chain, and the smoke check runs it in
Chrome's V8 *and* in Node's V8 and asserts the chains are identical. That is the
one check that actually proves a server can re-simulate a browser's replay. A
second engine (SpiderMonkey via Playwright) plugs into the same place.

**There are no golden replay fixtures yet, on purpose.** The plan's
`bin/goldens-regen` forcing function — refuse to regenerate unless `SIM_REV` has
been bumped — is right, and it is also exactly the wrong thing to have during a
milestone whose entire job is changing the physics dozens of times a day. What
`replay.test.ts` asserts instead is *self*-consistency: a recorded input stream
re-simulates to the same hash chain it produced, and a tampered one is caught at
the frame it diverges. Goldens land when the spec stops moving.

## Rates, and why they are one-way doors

- **Sim at 512 Hz.** `DT = 0.001953125`, exactly representable in binary, unlike
  1/1000 or 1/480.
- **Input at 128 Hz** — every 4 ticks. This is a competitive-fairness decision,
  not a detail: sampling input once per rendered frame gives a 144 Hz player
  finer input timing than a 60 Hz player, and on a leaderboard that is an
  integrity problem. 7.8 ms granularity is well below the floor of human timing
  precision, so it costs nothing in expressiveness and makes replays 4× smaller.
- **`advance(mask)` is the sim's public unit** and is exactly one input frame;
  `stepTick` is internal. That structurally guarantees any trajectory the later
  solver finds is expressible as a replay.
- **`step()` takes no `dt` argument.** If the signature permits one, someone
  eventually passes a variable dt and every replay downstream is silently
  poisoned.

Both rates are baked into every replay ever recorded.

## Level format

JSON, hand-writable, **y-up** (gravity is `-y`; the renderer flips). See
`levels/test01.json` and `levels/test02-bowl.json`, or `src/sim/testlevel.ts`
and `src/sim/curvelevel.ts`, which are the same data as TypeScript literals.

```json
{
  "format": "velo-level",
  "start":  { "x": -5, "y": 0.42 },
  "flower": { "x": 59, "y": 4.6 },
  "apples": [{ "x": 9, "y": 2.2 }],
  "sagTolerance": 0.002,
  "polygons": [
    { "kind": "cave",   "points": [[-8, 0], [60, 0], [60, 14], [-8, 14]] },
    { "kind": "ground", "points": [[18.5, -4], [19.5, -1.8], [20.5, -4]] },
    { "kind": "decor",  "points": [[1, 6], [3, 8], [5, 6]] }
  ],
  "zones": [],
  "entities": []
}
```

- `kind` replaces a winding convention **deliberately**. Winding is an invisible
  failure mode for a hand-author: get the vertex order backwards and the level
  loads fine with inside-out collision. `cave` means the playable space is
  *inside* the ring; `ground` means the solid is inside; `decor` never collides.
  The loader normalises winding on load, so getting it wrong is impossible.
- **The loader rejects hard, at load time**: fewer than 3 vertices, duplicate
  consecutive vertices, non-finite coordinates, a degenerate polygon, or a
  start/apple/flower inside solid. A zero-length edge produces a NaN normal and
  one NaN poisons the entire state buffer within a tick.
- `zones` and `entities` are reserved for the later boost pads, gravity zones,
  ice and teleporters. Rev 1 ignores them, and the loader **tolerates unknown
  entries rather than rejecting**, which is what keeps a level authored in 2027
  loadable by a 2026 client.
- **Known limitation: nothing here can tell you a level is completable.**
  `bin/level-check` validates *geometry* — degenerate edges, non-finite
  coordinates, apples inside solid, and coarse-tessellation sag. It cannot tell
  you whether a route through the level exists. That gap is not theoretical: the
  very first hand-authored level shipped with apples nobody could reach, with a
  human placing five of them by hand, and it took a playtest to find out. That is
  a strong argument that solver-backed reachability checking is not a
  nice-to-have for generated content later but a basic authoring tool, and when
  the visual builder lands it should be a live check while you author.
  `bin/level-drive` is the interim answer — a scripted rider, a lower bound, not
  a proof — and the real fix is the solver in milestone 7.
- **Two hashes.** `simHash` covers only what the sim reads — collidable polygons
  in order, start, apples in order, flower. `contentHash` covers the whole file.
  Leaderboards key on `simHash`, so retitling or recolouring a level preserves
  its board while moving an apple by 1e-12 does not.

### Curves

A `points` entry may be an **arc to the next point** instead of a literal
vertex:

```json
{ "kind": "cave", "points": [
  [-12, 0],
  [-4, 0],
  { "arcTo": [2.339, -1.405], "bulge":  0.356 },
  { "arcTo": [9.946, -1.405], "bulge": -0.843 },
  { "arcTo": [16.286, 0],     "bulge":  0.356 }
]}
```

`bulge` is the **signed height in metres** of the middle of the arc off the
middle of its chord, positive to the **left of the direction of travel**. Write
a floor left-to-right — which is what everyone does in a y-up side-scroller —
and the rule is "positive humps up, negative dishes down". Zero is a straight
line, an arc as the *first* entry curves the closing edge (the list is a ring),
and two arcs between two points is a circle in two lines.

**The curve lives in the authoring format and nowhere else.** `parseLevel`
tessellates every arc into straight segments at load, and `src/sim/collide.ts`
still has exactly one collision primitive and has never heard of an arc. That
trade is the whole feature: level files stay short and hand-editable, and the
physics stays as simple and as tested as it already was.

- **Why a signed sagitta in metres and not a radius.** A radius has an
  impossible range — anything below half the chord names no arc at all, and
  nudging one endpoint turns a level that loaded yesterday into a rejection
  today. It also needs two extra booleans, and nobody writes
  `largeArc: false, sweep: true` correctly from memory. The CAD/DXF bulge factor
  (`tan(θ/4)`) has the right *shape* — one signed number, no impossible value,
  0 is a straight line — but the number means nothing to a human. So: keep the
  shape, change the units. `bulge` is exactly `halfChord · tan(θ/4)`, so every
  formula is the CAD one after a single division, and "this bowl dips 2.5 m
  below its chord" is something you can picture and measure. The reasoning is
  recorded in `src/sim/arc.ts` because it is a one-way door.
- **Density comes from a sag tolerance, not a segment count.** `sagTolerance`
  (metres, default **0.002**) is the most any generated chord may dip below the
  true arc. Segment count follows from it *and the radius*, so a tight curve is
  automatically tessellated finer than a gentle one — which is the behaviour you
  want and the exact opposite of what a fixed count gives. Set it per level, or
  per arc (`{ "arcTo": …, "bulge": …, "sagTolerance": 0.05 }` — which is what
  decor should use, since decor never collides).
- **No trigonometry.** `purity.test.ts` bans `Math.sin`/`cos`/`atan2` under
  `src/sim`, so the arc is walked with a half-angle rotor built from `+ - * /`
  and `sqrt` alone: the quarter-arc rotor comes straight out of the tangent
  (`cos = 1/√(1+t²)`), halving is `c' = √((1+c)/2), s' = s/(2c')`, and doubling
  is `(c²−s², 2cs)`. Segment counts are therefore powers of two — up to 2×
  more segments than strictly minimal, which is a price worth paying for
  geometry that is bit-identical on every engine.
- **`simHash` covers the tessellated output, never the arc parameters**, because
  the collision geometry is what determines a time. The consequence is
  deliberate and has to be said out loud: **changing `sagTolerance` moves the
  vertices, moves `simHash`, and invalidates every recorded time on that level.**
  A tolerance is a physics constant wearing an authoring hat. `DEFAULT_SAG_TOLERANCE`
  is worse still — it is inherited by every level that omits the field, so
  changing *it* silently re-identifies all of them, and it moves with `SIM_REV`
  exactly like `DT`. A level with no arcs is unaffected by either, which is why
  `levels/test01.json` hashed bit-identically across this whole feature and a
  test asserts the literal. That literal has since moved exactly once, and for
  the right reason: test01's geometry was edited to make unreachable apples
  reachable, and apple positions are precisely what `simHash` covers. A real
  geometry change must re-identify the level; it must not be able to hide behind
  a stale assertion.
- **Arcs are held to the same standard as everything else.** Coincident
  endpoints, a missing or non-finite `bulge`, a non-positive tolerance, a
  tolerance too tight to tessellate inside the segment cap, and an unrecognised
  entry are all load-time rejections. Unlike `zones` and `entities`, a `points`
  list gets **no** forward tolerance: it is the collision surface, and quietly
  skipping an entry you did not understand is how a level loads with a hole in
  the floor. Tessellation can never emit a duplicate consecutive vertex, at an
  arc's interior or at either join.

### `bin/level-check` warns about coarse hand-authored runs

A wheel rolling a chord of length `L` across a curve of radius `R` drops
`L²/(8R)` below the true surface mid-chord. Against the 0.25 m wheel: 0.25 m
segments sag 0.8–3.9 mm and are imperceptible; 0.5 m segments sag 1–15.6 mm and
get buzzy; 1 m segments on a tight 2 m curve sag 62 mm, which is a real jolt at
speed. So `bin/level-check` estimates the curve each vertex implies against its
two neighbours and reports the sag:

```
    sag         17 vertices imply more than 2.0 mm of sag (worst 199.9 mm)
      warn      polygon 0 at (35, 0): turns 38.7 deg, so a 2.56 m chord across the implied 4.2 m curve sags 199.9 mm
```

It **warns and never rejects**: a deliberate hard edge is legitimate level
design — test01 is made of them on purpose — and a tool that called that an
error is a tool you stop reading. Two gates keep it honest: a turn sharper than
45° is read as a corner rather than a coarsely sampled curve, and a vertex must
sit in a *run* of same-direction turns, because one isolated kink is a corner
and there is no true curve for it to sag away from. The metric lives in
`bin/_sag.ts` and `src/sim/curvelevel.test.ts` asserts against the same function,
so the tool and the test cannot disagree about what "too coarse" means.

## Versioning

One hand-bumped integer, `SIM_REV` in `src/sim/rev.ts`, pins everything that can
affect a result — both the code and the constants, since either invalidates a
time. `DEFAULT_SAG_TOLERANCE` is one of those constants: it is inherited by
every level that omits `sagTolerance`, so changing it silently re-tessellates
all of them, changes their collision geometry *and* their `simHash`, and both
the rev and their leaderboards move. A level's own `sagTolerance` is level data
rather than engine data, so that one is caught by `simHash` alone. Adding the
arc primitive itself did **not** bump the rev: no existing level contains an
arc, `levels/test01.json` hashed bit-identically across it, and no line of the
sim changed. **Replacing the rider's rotation model did**: `SIM_REV` is now **2**,
and rev 1's code is not kept. Through milestone 1 the rev bumps freely and times
reset — freezing revs into directories is a launch-time job, not a today job. **Through milestone 1 it bumps freely and times reset**; the HUD says so.
Tuning must stay cheap, and any scheme that makes retuning expensive during M1
makes the game worse.

At public launch it freezes: frozen revs become frozen directories,
`getEngine(rev)` dispatches to them, old replays verify forever, and the
leaderboard *forks* by rev rather than resetting.

## Layout

```
index.html          Vite entry at the repo root
src/sim/            the deterministic core — imports NOTHING
src/client/         canvas renderer, input, tuning panel, record-and-replay
bin/                every operational task
levels/             exported level JSON
```

`bin/` also holds two underscore-prefixed modules that are imported rather than
run: `_smoke.mjs` (the headless Chrome driver) and `_sag.ts` (the coarse-run
metric, shared by `bin/level-check` and `src/sim/curvelevel.test.ts`).

One npm package, npm not pnpm, no workspace. Tests are vitest and colocated
(`src/sim/rot.test.ts` beside `src/sim/rot.ts`); there is no jsdom and no
`@testing-library`, so every test runs in plain node. Test pure functions, never
rendering.
