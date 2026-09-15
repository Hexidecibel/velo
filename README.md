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
```

## What this is not

- **It is not a game yet.** There are no menus, no art, no audio, no juice, and
  exactly one level, which is ugly on purpose so that you can see what the
  collision is doing.
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
| `bin/level-export` | Writes the built-in test level out to `levels/test01.json`. |
| `bin/level-check` | Validates a hand-authored level JSON and prints its two hashes. |
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
plan's geometry.

- The plan's `DEFAULT_SPEC` is **not driveable**. Holding the throttle from a
  standstill pitches the bike past 90 degrees within 0.4 s and backflips it into
  the floor, at every drive torque above about 160 N·m. 450 N·m on a 0.25 m
  wheel is 1800 N of thrust on a 71 kg bike — 2.5 g, far past the ~910 N the
  contact patch can actually put down — so the wheel spins and the reaction
  torque loops the chassis.
- The client therefore boots on **M1 candidate**, which differs in four numbers:
  drive torque 450 → 140, chassis inertia 11 → 8, angular damping 0.15 → 0.5,
  lean angle 40° → 60°. The plan's spec is one click away in the preset menu for
  comparison.
- With the candidate, measured on flat ground: 16 m/s top speed; **holding left
  rotates the bike counter-clockwise at roughly 60–100°/s** and holding right
  rotates it clockwise, so a tap is a wheelie and a hold is a backflip; a 0.1 s
  volt tap gives a 35° pitch and a 30 cm hop. That is an Elma-shaped control set.
  Whether it *feels* right is a question only hands on the keys can answer.
- **The throttle has no pitch authority of its own, and the margin is one
  newton-metre wide.** Swept on flat ground: at 145 N·m the bike holds 5° of
  pitch under full gas; at 150 N·m it backflips. There is no drive torque at
  which it holds a wheelie, because a wheelie is an unstable equilibrium — the
  restoring moment falls as the nose rises while the driving moment does not.
  That is true of real bikes too, but a real rider modulates continuously and a
  binary key cannot. Consequence: every bit of rotation comes from the lean
  keys, and the gas feels planted. Nudging drive torque to 145–148 buys a bike
  that lifts under power at the cost of sitting one notch from a loop; that
  trade is the user's to make, and it is the first slider to reach for.
- The **lean angle is the sharpest knob on the panel** and its behaviour is not
  monotonic. Below about 50° the servo's transient reaction torque dominates and
  a volt pitches the bike the *wrong* way; above it the rider's weight transfer
  wins and leaning back lifts the front, which is what a player expects. If the
  volt ever feels inverted, that slider is why.
- **Throttle held through airtime rotates the bike backwards**, hard — drive
  torque is reacted on the chassis and an airborne wheel gives the reaction
  nothing to push against. That is a real Elma technique rather than a bug, but
  it also means holding gas through a spawn drop or a crest commits you to a
  loop. The test level's start was lowered to a 5 cm settle for exactly this
  reason.

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
`levels/test01.json`, or `src/sim/testlevel.ts` which is the same data as a
TypeScript literal.

```json
{
  "format": "velo-level",
  "start":  { "x": -5, "y": 0.42 },
  "flower": { "x": 59, "y": 4.6 },
  "apples": [{ "x": 9, "y": 2.2 }],
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
- **Two hashes.** `simHash` covers only what the sim reads — collidable polygons
  in order, start, apples in order, flower. `contentHash` covers the whole file.
  Leaderboards key on `simHash`, so retitling or recolouring a level preserves
  its board while moving an apple by 1e-12 does not.

## Versioning

One hand-bumped integer, `SIM_REV` in `src/sim/rev.ts`, pins everything that can
affect a result — both the code and the constants, since either invalidates a
time. **Through milestone 1 it bumps freely and times reset**; the HUD says so.
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

One npm package, npm not pnpm, no workspace. Tests are vitest and colocated
(`src/sim/rot.test.ts` beside `src/sim/rot.ts`); there is no jsdom and no
`@testing-library`, so every test runs in plain node. Test pure functions, never
rendering.
