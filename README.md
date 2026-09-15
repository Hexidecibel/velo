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
| `bin/spec` | **Changes the bike from a terminal while somebody rides it.** Writes `data/spec.json`; the client picks it up within ~2 s and says what moved. |
| `bin/replay` | **Re-simulates an exported replay file** and reports identity, hash-chain verification and a diagnostic pass. This is what turns "sometimes it gets weird" into a reproducible artifact. |
| `bin/air` | Measures jump height and airtime off a fixed synthetic feature, per bike, in metres. Turns "it should catch more air" into a number. |
| `bin/dive` | Measures chassis pitch under braking and under throttle, in degrees. Turns "braking should slam the front down like gassing lifts it" into a symmetry you can check. |
| `bin/slope-sweep` | Sweeps a synthetic ramp across slope angle, entry speed, input strategy and transition sharpness, and prints what the bike does. |
| `bin/clean` | Removes `dist/` and `tsconfig.tsbuildinfo`; `--all` also removes `node_modules/`. |

`start`, `stop`, `status`, `logs`, `install-units` and `deploy` arrive with the
server milestone and deliberately do not exist yet.

## Controls

| Key | |
| --- | --- |
| arrows / WASD | gas, brake, rotate left, rotate right |
| space | **flip direction** — changes the driven wheel; free, legal mid-air, and the mechanic the whole double-back level design rests on |
| R | restart |
| T | replay the last run and check its hash chain |
| E | **export the last run** as a self-contained `.replay.json` file |
| L | load a replay file and watch it (or drag one onto the window) |
| `[` / `]` | previous / next level |
| G | draw contacts and surface normals |
| H | hide the tuning panel |
| `+` / `-` | zoom bias |
| P | pause |

There is a collapsible control legend in the bottom-left corner of the page,
because space-to-flip was the single most undiscoverable thing in the game and
nothing on screen said so.

## Levels, and the level picker

The picker at the top of the page lists **every file in `levels/`**, by the
`name` inside the file rather than by its filename. The list is a build-time
glob, not a hand-maintained array: adding a level is dropping a JSON file in a
directory, and a registry you have to remember to update defeats that. A level
that fails to load still appears, marked `BROKEN`, with the loader's message —
silently vanishing from the menu is the most confusing possible feedback for
somebody halfway through authoring it.

- `?level=<id>` selects a level and is kept in sync with the picker, so the
  address bar is always a shareable link to what is on screen. `?level=bowl`
  from before the picker existed still works.
- The last level played, the panel's tuned spec, and local best times are
  remembered in `localStorage`. All three are **per-viewer conveniences, not
  game state**: best times are unverified, local to one browser, and keyed by
  `SIM_REV` so a physics change retires them automatically. Real times live on
  the server behind re-simulation, which is milestone 4, and nothing here is
  allowed to grow into that.

## Replays are files now

Press **E** and the last run downloads as a self-contained JSON file carrying
the input stream, the periodic state hashes, the level, the bike spec and the
`SIM_REV` it was recorded under. Drop it back on the window, or hand it to
`bin/replay`, and the exact run happens again — on this machine, on a server,
months later.

```
bin/replay velo-rev3-20260915-013000-dead-12.40s-6e559edf.replay.json
```

This is the determinism work earning its keep. "Sometimes it gets weird" cannot
be acted on; a file can. `bin/replay` prints three things in order of how much
you should care: **identity** (rev, level, bike — any mismatch stated, never
papered over), **verification** (the hash chain, with the first divergent frame
named if there is one), and **diagnostics** (suspension bottoming, velocity
clamps firing, deep penetration, contact spikes — places to look, not verdicts).
`--csv` dumps per-frame telemetry.

The failure modes are deliberately loud. A replay recorded under a different
`SIM_REV` is **refused**, in the client and in `bin/replay`, rather than played
back against different physics — a run that silently differs from the one
recorded is worse than no playback at all, and treating it as a near-miss would
make the whole versioning scheme decorative. A level or bike mismatch is named
separately from a rev mismatch, and recovered from the file where it can be: the
embedded bike is adopted (after its hash is checked) and the embedded level is
taken on if this build does not ship it.

Every attempt of a session is retained, not just the most recent, keyed by
level. There is no UI for that yet; it is the cheap groundwork for replaying
every failed attempt alongside the line that worked.

## Live tune — changing the bike from a terminal

Tuning by talking somebody through a table of sliders to drag is slow, and it
puts the person who can *measure* the result furthest from the knob. So the bike
can be changed from a terminal while somebody else rides it:

```
bin/spec                                   print the effective spec
bin/spec set rider.inertialTransfer 0.45   set one field by dotted path
bin/spec set gravity 9.2
bin/spec unset rider.inertialTransfer      drop one override
bin/spec reset                             clear every override
bin/spec load tuned.json                   apply a whole spec file
bin/spec preset poppy                      apply one of the built-in presets
bin/spec --paths                           list all 45 addressable fields
```

Source of truth is **`data/spec.json`** (gitignored), holding a *partial*
BikeSpec — only the fields you set. The client polls `GET /api/spec` every two
seconds and applies a change when the content hash moves. The endpoint is served
by the Hono server in a build and by a Vite middleware under `bin/dev`, both
calling the same `specPayload()`, so the two cannot disagree.

**The HTTP surface is read-only, deliberately.** Writes go through `bin/spec` to
a file, which means nothing reachable over the network can change the bike. That
binds loopback behind the cush-auth gate today, but "the only way to write is to
be on the box" is a property worth having unconditionally rather than one that
depends on the front door staying shut.

### Precedence: per field, not per spec

There are three specs and the distinction is the whole of how the panel and
live tune coexist:

| | |
| --- | --- |
| **local** | what the panel writes, and what `localStorage` remembers. Yours. |
| **remote** | the partial override from `data/spec.json`, driven by `bin/spec`. |
| **effective** | local with remote layered on top, **per field**. What the sim runs and what a replay records. |

So `bin/spec set gravity 9.2` takes gravity and leaves every slider you touched
alone, and `bin/spec unset gravity` hands gravity back to *your* value rather
than to the preset's. That is the only precedence under which both halves stay
usable at once.

It is made visible rather than left to be inferred. A held row in the panel goes
**read-only with a LIVE badge** — a slider you can still drag but that a poll
overwrites two seconds later is worse than no slider at all — and a banner names
how many fields are held and how to take them back. The sliders *display* the
effective value and *write* underneath it, so unsetting an override restores
what you had rather than whatever the slider last showed. **Reset to preset**
clears your tune and deliberately leaves the remote override alone: it is
somebody else's and it is not that button's to throw away.

### Three rules it does not break

- **Applying a change restarts the attempt.** Always, and never mid-flight. A
  replay records the bike spec's hash, so a spec that changes during a run makes
  that run meaningless — and silently so, which is the worse half. Restarting
  costs nothing while tuning and it is honest.
- **It says what changed.** A brief toast names the fields: `gravity 9 → 9.2`.
  A bike that silently changes under somebody concentrating on a run is the
  worst possible outcome — they conclude they have lost their touch rather than
  that the numbers moved.
- **Replay integrity is untouched.** Verification still keys on the spec hash
  embedded in the replay. Loading a replay whose bike differs switches live tune
  **off** and says so, because the next poll would otherwise change the bike
  underneath the playback and diverge the hash chain.

Determinism is unaffected: this changes *which* spec is loaded, never how a tick
is computed. The purity guard, the hash chain and the cross-engine check are
exactly as they were.

**`bin/spec` cannot reach the physics version or the shipped default.** It
layers a runtime override and nothing else: `SIM_REV`, `DT`, the tick order and
the level are not fields on a `BikeSpec`, so no dotted path names them; the
layering clones before it writes, so the preset it reads cannot drift; and
`DEFAULT_SPEC` is deep-frozen, so a write aimed at it throws rather than
silently succeeding. All three are asserted in `src/sim/specpath.test.ts`. The
committed boot spec stays exactly what it is — **`c911d20c1e1fc095`**, "Soft
(hand-tuned default)", which is the bike the user signed off on. `bin/spec`
prints that hash next to the effective one on every invocation, so a drift would
be visible immediately.

The toggle is on by default under `bin/dev` and off by default in a build — a
dev server is somebody tuning, a built page is somebody playing — and is
remembered once touched. The poll skips while the tab is hidden, backs off from
2 s to 30 s on errors and recovers immediately on the next success, and a failed
fetch can never reach the game loop. A malformed `data/spec.json` answers 200
with an `error` field, keeps the last good override, and shows the message:
a typo in a tuning file must not take the game down or yank the bike back to the
preset mid-edit.

## The camera

Four rules, in priority order, and the first one outranks framing:

1. **The collision edge must stay readable.** A camera that frames the level
   beautifully and leaves you unable to see exactly where the ground is has
   failed at the only job that matters, so `minZoom` is a hard floor rather than
   a suggestion. Below roughly 34 px/m the 1.7 m bike is under 58 px long and
   you are guessing at clearances.
2. **Never lose the bike.** Smoothing is a lag, and a lag during a fast
   direction change can put the bike off-screen, so a `safeBox` clamp is applied
   *after* the smoothing: whatever the smoothing wanted, the bike stays inside
   the middle of the frame. In ordinary riding it never fires.
3. **No snapping.** Every input is continuous in the sim state. Nothing reads
   `facing`, which is the one discrete thing a flip changes — look-ahead comes
   from VELOCITY, so flipping mid-air moves the camera not at all, and a
   direction reversal eases across instead of jumping.
4. **Smooth, not floaty.** Frame-rate-independent exponential smoothing with a
   half-life, so 144 Hz and 60 Hz displays agree about how fast the camera
   moves. Zoom is speed-driven, out quickly and back in slowly, which is what
   stops the view pumping over rolling terrain.

It is not a cinematic system: every value is one exponential and one clamp, and
all of it is on the tuning panel, because anything with feel belongs on the
panel. The sim never sees any of it and must not — a time that depended on how
somebody framed their screen would not be a time.

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
- The client boots on **Soft (hand-tuned default)**, and its provenance is the
  most trustworthy thing about it: the user drove every preset in the dropdown,
  picked this character out of the spread, and dialled the one number that was
  wrong. Their words, in order — *"soft and floaty feels close to original!!!"*,
  *"maybe just a TINY bit too floaty"*, *"gravity on 9 is fucking sick"*. "Close
  to original" is the highest praise available here, since reproducing how
  Elasto Mania feels is the whole exercise.
- It is the earlier reasoned **M1 candidate** (drive torque 450 → 140, chassis
  inertia 11 → 12, angular damping 0.15 → 3.0, lean 40° → 28°, `attitudeTorque`
  0 → 340, `weightTransfer` 1 → 0.6) with three more numbers moved, all pulling
  the same way: spring stiffness 12000 → **6500**, damping 500 → **320**, and
  gravity 10 → **9**. Half the spring rate is the compliant, long-travel
  character; gravity is hang time and is the only lever on it, which is why a
  hunt through the damping sliders could never have found it.
- **The dropdown is why this happened.** Nobody reasoned their way to gravity 9.
  The user found it because there was a spread of characters to drive rather
  than one candidate and a wall of sliders. Offer a spread, not a proposal, the
  next time a feel question comes up.
- The plan's spec, the earlier candidate, a softer variant and a stiff one are
  all one click away for comparison.
- **The suspension is not bottoming on ordinary landings**, which was a standing
  suspicion about what "gets weird" might be. Measured with `bin/air` on the
  shipping bike: a 1.2 m drop reaches 0.180 m of the 0.25 m hard clamp, and a
  deliberately excessive 3.5 m drop at 7.7 m/s touchdown reaches 0.215 m. It
  never touches the clamp. `bin/replay` counts clamp frames on any real run, so
  this stays checkable rather than remembered.
- **Rotation is its own control**, braking dives the nose, and suspension has
  separate compression and rebound damping. All three are physics changes rather
  than tuning ones. See below.

### Suspension has two damping coefficients now

`suspension.damping` became `compressionDamping` and `reboundDamping`. `rate` in
the tick is d(len)/dt, so `rate < 0` is the wheel coming up into the bike — the
compression stroke, a landing or a bump — and `rate > 0` is the spring pushing
it back out. One symmetric number forces a bad trade between those halves: high
damping keeps a landing planted and also eats the rebound energy that would
otherwise launch the bike off a feature. Real motorcycle suspension has two
adjusters for exactly this reason.

**Set the two equal and the arithmetic is identical to the single coefficient it
replaced** — the branch selects the same number. That is the migration path and
there is a test asserting it hash-for-hash.

Measured with `bin/air`, mean peak chassis height off a 0.2 m bump, averaged
over approach speeds from 5 to 12 m/s, on the shipping bike:

| `reboundDamping` | mean peak |
| --- | --- |
| 800 | 0.178 m |
| 500 | 0.209 m |
| 320 *(default)* | 0.244 m |
| 120 | 0.281 m |

So halving rebound is worth roughly a third more height off a bump, and
touchdown speed off the drop test is unchanged to within 0.1 m/s across the
whole range — the launch half moved and the landing half did not, which is the
entire point of splitting the coefficient. Three things are worth saying plainly
about that table:

- **Per-speed values are noisy and the trend is only in the mean.** A soft
  spring is still oscillating when the wheel leaves a 2 m feature, so whether it
  happens to be extending at that instant is a phase question, and phase moves
  with speed. `bin/air --matrix bump` prints the whole grid rather than one
  number for this reason.
- **The textbook recipe is wrong here.** "Compression up so landings stay
  planted, rebound down so it pops" measured *worse* than the symmetric default:
  compression damping decides how much energy gets **into** the spring, so
  raising it costs more launch than the lower rebound buys back. Lowering
  rebound on its own is the move that works.
- **A ramp is not a bump.** Off the kicker — geometry, not stored energy —
  rebound barely registers: 0.388 to 0.419 m across the entire 120-to-800 range.

The shipping default stays symmetric at 320/320, because that is the bike the
user signed off on. **Soft + poppy** in the preset menu is the same bike with
rebound at 150, one click away.

### Braking dives the nose now

Reported as an asymmetry, and it was one: *"slamming on brake should slam down
the front end, right? just like gassing lifts up"*. Gassing lifted the front
because drive torque is reacted straight onto the chassis. Braking had no
comparable path at all, because the tick transferred only the rider's **static**
weight — `tau = cross(L*u, (0, -m*g))` — and a static term does not know the
bike is decelerating.

The fix is to evaluate that same torque in the pivot's **accelerating** frame.
The rider does not pull against gravity, it pulls against gravity minus the
pivot's acceleration, and the arm already integrates exactly that pseudo-force
one step later in the tick. Feeding the same quantity to the chassis is two
lines, and `rider.inertialTransfer` scales it:

```
tq += -m*g*L*ax                  * weightTransfer      static, as before
tq +=  m*L*(ay*acx - ax*acy)     * inertialTransfer    new
```

Measured with `bin/dive` — full brake from 9 m/s with the rear wheel down, nose
-down pitch at 0.15 s and time to reach 30° nose-down:

| `inertialTransfer` | at 0.15 s | to −30° |
| --- | --- | --- |
| 0 *(the old bike)* | −17.3° | 0.211 s |
| 0.5 | −29.3° | 0.156 s |
| **0.6** *(default)* | **−32.5°** | **0.148 s** |
| 1.0 *(physically honest)* | −41.5° | 0.125 s |
| 2.0 | −54.1° | 0.109 s |

It ships at 0.6 rather than the honest 1.0 for two reasons: it matches
`weightTransfer`, and the two are literally the two halves of one quantity, so
scaling them apart would be odd to have to explain; and sustained full brake
already loops the bike over the front at every setting including zero, with 1.0
getting there in two-thirds the time. It is a slider.

**It is deliberately not gated on being grounded.** Braking a spinning wheel in
mid-air puts reaction torque on the chassis and pitches it — a different
mechanism, also real, also a technique worth keeping. `bin/dive` reports the
airborne row separately so the two are never conflated. A brake-input special
case would have scored the same on the braking measurement and produced nothing
at all on a landing, which is the half that matters more.

Because the same term also fires on **impacts**, timing a lean into a face now
pays. Re-running the slope sweep, the technique-versus-naive gap in energy
surviving the transition:

| `inertialTransfer` | sharp corner | filleted corner |
| --- | --- | --- |
| 0 | +13.1% | +16.0% |
| 0.6 | +17.5% | +18.6% |
| 1.0 | +16.9% | +21.7% |
| 1.5 | +25.9% | +29.5% |

The *naive* number goes down as the term goes up while the *technique* number
holds, which is the shape you want: the rider's mass is a liability if you
ignore it and an asset if you time it. That is the user's own description of
Elma climbing — *"by leaning in when you hit you could use your momentum"* —
showing up in a measurement for the first time.

### A suspect for "sometimes it gets weird"

`bin/replay` found this on the first file it was pointed at, which is roughly
the point of building it.

**The suspension can press a wheel several centimetres into a wall and hold it
there.** Measured on a pilot run into the end wall of test01: the front wheel
sat **8.7 cm inside solid geometry for over 40 consecutive ticks**, on a 25 cm
wheel. Per-tick, the sequence is:

1. the contact solver sets the wheel's velocity to the Baumgarte correction
   target, which is capped at `MAX_CORRECTION_VEL` = 2 m/s;
2. on the *next* tick the suspension spring — 2640 N at that deflection, on a
   3 kg wheel, so ~1.7 m/s of Δv per tick — pulls it straight back toward the
   anchor, which is on the far side of the wall;
3. position integration happens **before** the contact solve, so what moves the
   wheel is the spring-modified velocity, not the corrected one.

Net: the correction is applied at the end of a tick and partly undone at the
start of the next one before the position moves. The wheel digs in rather than
out, and stays visibly inside the wall until the chassis backs off.

This is not a NaN and not a desync — the hash chain verifies perfectly — but it
is exactly the shape of a complaint like "it got weird": a wheel inside a wall,
and the bike feeling stuck against it.

**This is a KNOWN, ACCEPTED issue and is deliberately not fixed.** It was put to
the user with the measurement, and the call was theirs: *"wheel in wall feels
fine. no changes there until we move on."* So it stays, and it stays documented
here rather than in somebody's head. Do not quietly fix it — it is not an
oversight, it is a decision, and reopening it is a decision too.

The fix, when it is wanted, is to collect contacts against the *predicted*
positions, solve velocities, and only then integrate positions, so that the
corrected velocity is the one that moves the body. That is a tick-order change
and therefore a `SIM_REV` bump. Raising `MAX_CORRECTION_VEL` is the cheaper
alternative; a positional projection pass was already considered and rejected,
because three chassis circles in a corner triple-count and pop the bike.

`bin/replay` flags penetration over 5 cm on any run, so if this ever *does* stop
feeling fine, the evidence arrives with the complaint.

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

  **That reading was right about the sweep and wrong about the technique.** The
  measurement above holds a *sustained* lean on a face, and for that the static
  term really is enough. The user's description was about *timing* — "lean in
  **when you hit**" — and timing is the one thing a static term cannot express.
  The inertial reaction shipped in rev 3 for the brake-dive report, and the
  slope sweep re-run with it on shows the technique-versus-naive gap widening on
  both corner types. See "Braking dives the nose now".

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
sim changed. **Replacing the rider's rotation model did**, and so did rev 3 — the
asymmetric suspension damping split and the rider's inertial reaction on the
pivot, shipped together because neither ever escaped on its own. `SIM_REV` is
now **3**, and earlier revs' code is not kept. Note what counted as a physics
change there: moving the weight-transfer line to a different point in the tick
reordered two floating-point additions, worth ~5e-16 at frame 400 — and a
visibly different line by frame 5000, because a bike bouncing off geometry is
chaotic. A rev bump is not about the size of the edit. Through milestone 1 the rev bumps freely and times
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

`bin/` also holds underscore-prefixed modules that are imported rather than run:
`_smoke.mjs` (the headless Chrome driver), `_sag.ts` (the coarse-run metric,
shared by `bin/level-check` and `src/sim/curvelevel.test.ts`), `_pilot.ts` (the
scripted rider), `_slope.ts`, `_air.ts` and `_dive.ts` (the measurement rigs),
and `_replay.ts`. The rigs build their own synthetic levels rather than using
anything in `levels/`: a measuring instrument needs one feature at a known place
with known dimensions, which is the opposite of what a level is for.

One npm package, npm not pnpm, no workspace. Tests are vitest and colocated
(`src/sim/rot.test.ts` beside `src/sim/rot.ts`); there is no jsdom and no
`@testing-library`, so every test runs in plain node. Test pure functions, never
rendering.
