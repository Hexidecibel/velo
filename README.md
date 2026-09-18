# Velo

A 2D motorbike physics game in the spirit of **Elasto Mania**: ride through
polygon caves, collect every apple, touch the flower to finish. Two sprung
wheels, and a rider whose **head is a death sphere** — touch it to terrain and
the run is over.

**Milestone 1 is done and signed off.** It was one bike, one deliberately ugly
test level and a live tuning panel, ridden until it felt good — because if the
bike does not feel good, nothing downstream rescues it. The user drove every
preset in the dropdown, picked a character out of the spread, dialled the one
number that was wrong, and called it *"close to original"*, which is the highest
praise available here. That bike is now frozen and everything else is built
against it.

Since then: twenty hand-authored levels forming a teaching curriculum, replays
as exportable files, remote tuning from a terminal, level navigation, a
deployment, and a **leaderboard with ghosts** — times verified by re-simulating
the input stream on the server, and the run one place ahead of you riding beside
you while you try to catch it.

```
bin/dev                    # dev server, hot-reloads levels as you author them
bin/deploy                 # build, restart, health-check the live service
```

**Live at https://velo.cush.rocks** — 127.0.0.1:9422, systemd `velo.service`,
behind the cush-auth device gate.

## What this is not

- **It is not a game yet.** There are no menus beyond a level picker. `test01` is ugly on purpose, so that you can see what the collision is
  doing; `test02` exercises the level format's curve primitive.
- **The leaderboard is not authenticated, and does not pretend to be.**
  Re-simulation means a *time* cannot be faked. *Whose* time it is can be —
  nothing upstream of this app tells it who is playing. See
  [Who you are, and what that is worth](#who-you-are-and-what-that-is-worth).
- **The TAS category is declared, not detected.** Nothing can tell a
  solver-generated input stream from a person's, because there is nothing to
  tell — both are just buttons the sim accepts. The split is a convention, and
  a deliberate one.
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
| `bin/smoke` | Builds, then drives the real page in headless Chrome over CDP: asserts nothing threw, nothing went NaN, the replay verifies, the **cross-engine hash chain from Chrome's V8 matches Node's V8**, live tune applies end to end, and **holding TAB advances neither the clock nor the recording**. It asserts audio stays asleep until a **trusted** gesture and then initialises without throwing, that a hidden tab suspends the context, and — the one that matters — that **the same fixed input stream driven muted and driven loud records byte-identical replays**, with the loud pass firing cues and the muted pass firing none so the comparison cannot pass vacuously. It then starts a **real velo server** on a scratch data directory, posts a real replay to it, and asserts the built page fetches that board, builds a ghost from it and steps that ghost one frame for one input frame. |
| `bin/preview` | Serves the built `dist/`. A production-bundle sanity check, not a deployment. |
| `bin/level-export` | Writes the built-in levels out to `levels/test01.json` and `levels/test02-bowl.json`. |
| `bin/level-check` | Validates a hand-authored level JSON, prints its two hashes, and **warns about straight runs too coarse to ride smoothly**. |
| `bin/level-drive` | Drives a level headlessly with a scripted rider and reports whether every apple and the flower can actually be reached. `--save <path>` writes the pilot's best run as a standard replay file — a trailing `/` writes one per level into a directory. The saved file is re-verified before it is written, and loads in the client with `L`. |
| `bin/solve` | **Searches for a run that completes a level, proves it, and scores how hard it was.** A best-first search over macro-actions — held input masks for tenths of a second — through `advance(mask)`, so anything it finds is expressible as a replay. Reports completability, the winning apple order, a difficulty score measured from the search rather than from level statistics, and with `--save` a verified replay file you can watch. `--jobs N` solves several levels at once on worker threads. Not a CI tool: minutes per hard level. See *The solver* below. |
| `bin/difficulty-import` | **Turns a `bin/solve --json` payload into `src/solver/measured.ts`**, which is the one place the client can read a measured difficulty score from. Solving the set is about an hour of CPU, so the scores are a build-time artefact; every row is keyed by the level's `simHash` **and** the sim rev, so an edited level stops matching and the chooser says *unrated* rather than showing a confident number about geometry that no longer exists. |
| `bin/spec` | **Changes the bike from a terminal while somebody rides it.** Writes `data/spec.json`; the client picks it up within ~2 s and says what moved. |
| `bin/replay` | **Re-simulates an exported replay file** and reports identity, hash-chain verification and a diagnostic pass. This is what turns "sometimes it gets weird" into a reproducible artifact. |
| `bin/air` | Measures jump height and airtime off a fixed synthetic feature, per bike, in metres. Turns "it should catch more air" into a number. |
| `bin/dive` | Measures chassis pitch under braking and under throttle, in degrees. Turns "braking should slam the front down like gassing lifts it" into a symmetry you can check. Includes a **full-throttle-from-rest** row, which is the only one in which the drive half of the inertial transfer is measurable at all — at 9 m/s the torque has already tapered against `maxWheelSpin` and every coefficient reads the same. |
| `bin/hook` | **Measures whether a wheel can hook over a thin obstacle and hang there.** The answer is no, and the rig is kept so that "no" stays checkable. See *Hooking a wheel, and why it does not work*. |
| `bin/palette-set` | **Judges the shipped levels' palettes as a SET**, which is the one thing no per-palette test can do. Prints each level's wall, solid and lit lip, the spread of wall chroma and brightness across the twenty, and the closest pairs; exits 1 if any pair falls under the floor. |
| `bin/slope-sweep` | Sweeps a synthetic ramp across slope angle, entry speed, input strategy and transition sharpness, and prints what the bike does. |
| `bin/audiobench` | **Measures what the sound costs a frame.** Drives a fixed input stream through the real frame loop twice — loud, and muted, which *suspends* the audio context and so really is the cost of no audio at all — interleaved so a busy box biases both equally, and reports the per-frame audio update alongside whole-frame times. `BENCH_FRAMES` and `BENCH_PASSES` lengthen it. |
| `bin/artbench` | **Measures the art renderer's frame budget with the camera moving.** Flies the camera across a level at play speed, times the render call against the old flat renderer on the same frames, breaks the cost down layer by layer, and then drives the real game and watches real frame times. Exits 2 if a warm frame's p95 goes over 16.7 ms. Every timed pass runs at FULL detail with the adaptive system off, so "it passes" can never quietly mean "it passed by turning everything off"; what the adaptive system settles at is printed separately. `BENCH_OUT=<file>` appends each level as it finishes, so a killed sweep costs only what it had not reached. `BENCH_ART='{"props":0,...}'` overrides art parameters before measuring, which is how a before/after stays honest on one build. |
| `bin/montagebench` | **Measures what the end-of-level montage costs a frame, and is where `MONTAGE_CAP` comes from.** Stands up N synthetic riders on a real level and reports the two costs separately — the riders' own sims stepping, and the extra bikes being drawn — because they scale with different things. The draw samples are **paired and interleaved**, each frame drawn twice back to back with the crowd and without it: this box's load average moves by a factor of three inside a minute, and two consecutive passes report whatever somebody else's build was doing. Defaults to `20-close-quarters`, which is the level that decides the cap, because everybody dies inside the same few metres there and so **culling saves nothing**. |
| `bin/icons` | Redraws the home-screen icons into `public/` from the game's own palette. Generated rather than committed as opaque binaries so the icon and the game cannot end up using two different blues; the output *is* committed, because a build must not need it. |
| `bin/shots` | Screenshots several levels at the three zooms the camera reaches, with the art on, the art off, the `G` overlay up, and framed on the level's tightest ceiling. Output to `shots/` (gitignored). The A/B pair is the point: "is the collision edge still the most legible line" is a comparison, not an opinion. `SHOTS_ONLY=art-62` takes one shot per level, which is how you judge twenty levels as a SET; `SHOTS_AT=x,y,zoom` frames one exact place, which is how you find out what a prop that looked wrong in an overview actually is. `SHOTS_QUERY=touch=1` shoots the page with the phone thumb pads up — they are elements, so they are in the screenshot — and `SHOTS_MONTAGE=24` stands up a crowd of montage riders first, because "does the winning line still read against the failures" is the whole acceptance criterion for that feature's look and is likewise a comparison rather than an opinion. `SHOTS_CHROME=1` adds two frames per level for judging the chrome instead of the art: the **level chooser with its thumbnails drawn** (it waits, because they are rendered one per animation frame on purpose) and the same frame with the **debug readout switched off**. `SHOTS_PHONES=1` re-shoots the page **once per real phone viewport** — landscape with browser chrome (915x348), landscape without it, a small landscape, portrait, narrow portrait and a tablet — of whatever the game itself framed, rather than of a camera the script chose. That flag exists because the first touch pass was designed against an idealised 844x390 that no browser hands you, and shipped a layout that was fine there and unusable on the real thing. |
| `bin/board` | **Inspect, check, rebuild and prune the leaderboard store.** No arguments — or `list`, which is what everybody types, since every other subcommand here is a verb — lists every level with its entry counts; a level id shows one board; `player <id>` shows one player's PBs; `check` is an integrity pass; `rebuild [--verify]` regenerates the boards and player files from the submission log, re-simulating every replay if asked; `prune [--apply]` removes replay blobs nothing references, and is a dry run unless you say so. |
| `bin/submit` | **Posts a replay file to a running server.** Defaults to the **TAS** category, because anything submitted from a terminal was produced by a program and declaring that is the whole point of having the category. Takes a directory, so `bin/submit /tmp/pilot/` posts a whole `bin/level-drive --save` sweep. A path that does not exist (or a directory with no replays in it) is one line and a non-zero exit — a typo is the common way to get here and a raw `ENOENT` stack trace reads like the script is broken rather than like the filename is wrong. |
| `bin/clean` | Removes `dist/` and `tsconfig.tsbuildinfo`; `--all` also removes `node_modules/`. |

`bin/_chrome.mjs` is shared by the two scripts that drive headless Chrome, and
it exists for a reason worth knowing: **both of them kill Chrome in a `finally`,
which does nothing when the script itself is killed** — and a long sweep gets
killed routinely. A headless Chrome rasterising a canvas in software sits at
most of a core rather than idling, so orphans accumulate and the next benchmark
silently measures the load left behind by the last one. Here that took the same
level from 77% of the frame budget to 253% over an afternoon. The scripts now
reap any Chrome holding one of their own profile directories before they start.

## Controls

| Key | |
| --- | --- |
| arrows / WASD | gas, brake, rotate left, rotate right |
| space | **flip direction** — changes the driven wheel; free, legal mid-air, and the mechanic the whole double-back level design rests on |
| TAB (hold) | **see the whole level.** The sim and the clock freeze while it is down. |
| R | restart |
| T | replay the last run and check its hash chain |
| F | **watch every attempt of this session at once** — see *The montage* |
| E | **export the last run** as a self-contained `.replay.json` file |
| L | load a replay file and watch it (or drag one onto the window) |
| `[` / `]` | previous / next level |
| G | **draw the true collision boundary**, its normals and the live contacts, over everything else |
| V | art renderer on / off — the A/B for readability |
| B | show/hide the **leaderboard and ghost picker** — open by default |
| M | **mute** — remembered. Sound starts on your first click or key press, because browsers will not let a page make noise before one. |
| C | **the level chooser** — a picture of every level, its measured difficulty, and your best time on it |
| Y | **your bike** — six silhouettes, ten liveries, and what the rider is wearing. None of it changes how the bike rides. |
| H | show/hide the tuning panel — **closed by default**, remembered once you open it |
| `` ` `` | **hide the debug readout.** Remembered. The level card, clock and apple counter stay — they are drawn in the canvas and they are the game talking — and so do the two warnings that are not telemetry. |
| `+` / `-` / `0` | zoom in, zoom out, back to the default. A multiplier on the derived framing, remembered per device, and clamped so it can never ask for a zoom outside `minZoom`..`maxZoom`. On a phone the same variable is driven by a two-finger pinch. |
| P | pause |

**On the end-of-level screen** — which appears on a finish and never on a death
— a few keys mean something else for as long as it is up, and it prints every
one of them on itself:

| Key | |
| --- | --- |
| **Enter** (or N) | **next level.** The default action. |
| R | retry — exactly what R does everywhere else, routed at the same function |
| Esc | close it. Instantly; nothing fades and nothing has to be waited through. |
| T | watch your run |
| F | **watch all N attempts at once** — only when there are at least two |
| G | watch the ghost's run — *(the collision overlay everywhere else)* |
| B | the fuller leaderboard |
| L | level select — opens the chooser — *(load a replay file everywhere else)* |

There is a collapsible control legend in the bottom-left corner of the page,
because space-to-flip was the single most undiscoverable thing in the game and
nothing on screen said so.

## Finding your way around a big level

The levels grew: `10-cathedral` is 176 x 49 m, `07-the-chimney` is 52 x 48 m,
`04-switchback` is 124 x 34 m. The camera holds a hard readability floor at
38 px/m so the collision edge stays legible, which is right while driving and
means you cannot see where you are in a level that size, or where the last apple
went.

**There is deliberately no minimap.** A minimap costs permanent HUD real estate,
shows an abstraction of the level instead of the level, needs its own visual
language maintained alongside the real renderer forever, and is worse than
zooming out at everything except being always-on. Modern 2D games dropped it for
those reasons. Three things replace it:

**Hold TAB and the camera eases out to frame the whole level** — the real
camera, the real renderer, the real geometry, just further away. A level too
large to fit above the overview's own zoom floor frames a generous radius around
the bike instead, clamped so the view never scrolls off the level. Release and
it eases back. Both directions are smoothed with a half-life, and the zoom
blends *geometrically* rather than linearly, because a linear blend from 62 px/m
to 7 spends most of its travel in the high numbers and then lurches.

**The sim and the clock freeze while it is held**, and that is three decisions
at once:

- The readability floor exists because you are driving. The overview
  deliberately goes under it, which is only acceptable because nobody is.
- **It cannot affect a recorded replay.** No sim tick advances, so
  `sim.advance()` is never called, the recorder gains no input frame, and
  `state.tick` — the clock — does not move. A run held in overview for a minute
  produces a byte-identical replay file to the same run never held at all.
  `src/client/overview.test.ts` asserts exactly that against the real sim and
  the real recorder, and `bin/smoke` asserts it again in Chrome through the real
  key path, because the freeze gate itself lives in the frame loop where no unit
  test can reach it.
- It makes the feature a viewing aid rather than a competitive question.

**Loading a level shows that same wide framing briefly before settling** to play
zoom. Route planning *is* the game — apples are collectable in any order, and
the interesting levels have genuinely different orders with different times — so
a player who never sees the whole level cannot plan a route. It is short, **any
input skips it**, and it fires on a level load and never on `R`: the die-retry
loop must stay instant.

**Small chevrons at the edge of the window point at uncollected apples**, with
the distance in metres, and at the flower once the apples are gone. This is the
cheap half of the problem and it needs no map at all: "where is the last one" is
a question about one object, and an arrow plus a distance answers it completely.
They are low-alpha and small on purpose — the standing readability rule is that
the player and the collision edge are the highest-contrast things on screen, and
these must not compete.

Everything above is on the tuning panel under **Overview (TAB)**: padding, the
overview zoom floor, both easing half-lives, the opening peek's duration (0
disables it), and the markers' inset and alpha (0 turns them off).

## Levels, and the level picker

The picker at the top of the page lists **every file in `levels/`**, by the
`name` inside the file rather than by its filename. The list is a build-time
glob, not a hand-maintained array: adding a level is dropping a JSON file in a
directory, and a registry you have to remember to update defeats that. A level
that fails to load still appears, marked `BROKEN`, with the loader's message —
silently vanishing from the menu is the most confusing possible feedback for
somebody halfway through authoring it. **C** opens the fuller chooser — pictures,
measured difficulty and best times — which is below.



- `?level=<id>` selects a level and is kept in sync with the picker, so the
  address bar is always a shareable link to what is on screen. `?level=bowl`
  from before the picker existed still works.
- The last level played, the panel's tuned spec, and local best times are
  remembered in `localStorage`. All three are **per-viewer conveniences, not
  game state**: best times there are unverified, local to one browser, and keyed
  by `SIM_REV` so a physics change retires them automatically. The times that
  count live on the server behind re-simulation — see *The leaderboard* below —
  and nothing in `localStorage` is allowed to grow into that. The one exception
  is the `playerId`, which is identity rather than a convenience and is treated
  as such.

## The level chooser

**C**, or the `browse` button beside the picker. A card per level with a picture
of it, what the solver measured its difficulty to be, its apple count and size,
and your best time on it.

The one-line dropdown is still there and still does its job — it says which
level you are on, and `[` / `]` step levels instantly. **Neither of them goes
anywhere near the chooser**, because stepping levels when you already know where
you are going has to stay free. The chooser answers the other question, the one
a list of names cannot: *which of the twenty should I ride.*

### The pictures are renders, not files

A thumbnail is the real renderer, at the framing TAB already gives you, into a
176x99 offscreen canvas. Twenty PNGs in the repo would be stale the first time
somebody edited a level and wrong the first time the art changed; a render
cannot drift from the game, because it **is** the game.

Four rules keep it off the hot path, which is the whole risk in drawing twenty
frames of a game that is trying to hold 60 fps:

- nothing is drawn until the chooser is opened, so a player who never opens it
  never pays;
- **one per animation frame**, queued, and the queue is abandoned the moment the
  chooser closes;
- results are cached for the session by `simHash`, so the second open is free;
- the render call passes `measure: false`, so a thumbnail's cost never reaches
  the **adaptive detail controller**. Without that, opening a menu would quietly
  reduce the detail of the next second of play — twenty long offscreen frames
  are real milliseconds, but they are not evidence about the frame budget.

The chooser also **pauses the game** while it is up, which is the existing `P`
and cannot touch a recording: no input frames are captured while the loop is
paused.

### The difficulty number is the solver's, not an opinion

Every rating comes from `bin/solve` — precision, clearance, effort and
lethality, measured from what the search actually experienced (see *Difficulty,
measured from the search*). Nothing here is hand-assigned, and there is **no
description text**, because the level format has no description field and
twenty invented sentences would be filler nobody maintains. What is on a card
besides the picture and the time is read off the level: apple count, and size in
metres.

Scoring the set costs about an hour of CPU, so the numbers are a build-time
artefact in `src/solver/measured.ts`, written by `bin/difficulty-import`. **The
anti-rot mechanism is the key**: a row is keyed by the level's `simHash` and the
sim rev, so moving one apple re-keys the level, the row stops matching, and the
card says *unrated* instead of describing geometry that no longer exists. A
rename or a recolour keeps it — the same split the leaderboard already trusts.

Two more rules about honesty, both of which cost a card its rating:

- **an unsolved level is never shown as hard.** `16-one-way` is the one the
  solver cannot do; that is an honest "could not" and the solver has been wrong
  in that direction twice, so the card says unrated and says why.
- a level with no row at all — a new one, an edited one, a rev bump — is
  unrated, never easy.

The word beside the bar (*gentle, steady, tricky, hard, brutal*) is presentation
cut against the twenty levels the set actually contains, which span 8 to 56. The
score is the measurement; re-cutting the words changes no ordering.

### Grouped by the shape the set already has

In `number` order the cards group by decade — `01 – 10`, `11 – 20` — because the
set was authored as a curriculum and a flat alphabetical list throws that away.
The grouping is **derived from the leading number in the filename**, so a
twenty-first level lands in `21 – 30` without anybody editing a table, and
anything unnumbered (the two test levels, a level adopted from a replay file)
goes in its own group at the end. `by difficulty` collapses it to one ramp,
easiest first, with the unrated kept out of it rather than given a place in the
order they have not earned.

## The debug readout is toggleable now

From the user: *"starting to feel like the hud overlay should be toggleable too,
almost ready to just play it straight up."* **`` ` ``** does it, and the choice
is remembered.

The interesting part is the line between what is a readout and what is the game:

- **The in-canvas HUD stays.** The level card, the clock and the apple counter
  are drawn on the canvas in the level's own palette. They are the game telling
  you where you are, not an instrument.
- **The text column goes.** Speed, spin, contacts, zoom, fps, worst frame,
  recorded frames, the ghost and montage captions, both hashes and the rev line
  are development instruments, and they are what "play it straight up" means
  getting rid of.
- **The `DETAIL n%` chip goes with them.** It is the one thing in the in-canvas
  HUD that is an instrument rather than the game talking, so it follows the
  readout rather than the art HUD.
- **Two things survive being hidden**, as a compact badge in the corner where
  the readout was, because they are warnings rather than telemetry and hiding
  them would hide the thing they warn about:
  - **the bike is not the one as shipped** — tuned by your own sliders, or with
    a field held by `bin/spec`. Such a run finishes normally and is then
    silently refused by the leaderboard, which is exactly the confusion that put
    the notice on the HUD in the first place. The badge says the consequence
    ("times will not post"), not just the state.
  - **`data/spec.json` named a field this build does not have.** The tune you
    think you are riding is not the tune you are riding, and that is invisible
    by construction.

  With neither of those true — a shipped bike and no live tune — the badge is
  empty and the screen is the game and nothing else.

The **legend is left alone**: it is separate chrome, already collapsible, already
remembered, and it is how somebody finds out that `` ` `` exists in the first
place. Hiding the keys along with the telemetry would make the feature harder to
undo than to do.

`src/client/hudmode.ts` decides which warnings survive and is tested in plain
node, because "a warning that is not shown" is not a thing a screenshot catches.

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

## The leaderboard

**A replay is an input stream, not a trajectory.** About a kilobyte of
run-length-encoded button masks — `src/server/fixture.replay.json` is an
11.7-second run of `01-first-light` in **1,499 bytes**. Nothing in it says where
the bike went; it says which buttons were held, and the physics decides the
rest.

That one fact is the whole design. The server **re-simulates every submission
and derives the time itself**, so the board is cheat-proof by construction: you
cannot fabricate a state trajectory the sim would not produce, because you never
submit a trajectory. It works because determinism was designed in from the first
commit and the cross-engine hash chain is proven — a browser-recorded run
re-verifies bit-identically on the box, which `bin/smoke` checks on every run.

Verification of a real run costs **6-60 ms**. A ten-minute run, the longest the
server will accept, is about half a second.

```
POST /api/runs                      { playerId, name, appearance, category, replay }
GET  /api/leaderboard/:simHash      ?category= &rev= &player= &limit=
GET  /api/replays/:replayId         ?level=<simHash>   — the ghost fetch
GET  /api/players/:playerId
GET  /api/levels                    every level with its entry counts
GET  /api/rules                     rev, bike hash, categories, every limit
```

### Verify before persisting

Nothing is written until the re-simulation has confirmed the outcome, the time
*and* the apple count. In order, a submission must:

1. be **under the caps** — 512 KB of body, 76,800 input frames (ten minutes),
   and a bounded `hashes` array;
2. be the **live `SIM_REV`**, or it is refused with the same wording
   `bin/replay` uses, from `revMismatchRefusal()` so the two cannot drift;
3. be for a **level this build ships**, matched by `simHash`. A replay file
   carries its own level so that it stands alone as a bug report, and trusting
   *that* here would let anybody mint a board for a one-metre ramp with the
   flower on top;
4. be on the **shipped bike**, by `specHash`. A time set with the tuning panel
   open is a real run of a different sport, and the verifier would confirm it
   happily;
5. **finish**, with every apple collected;
6. **re-simulate to exactly the claimed outcome.** Claim a faster time and the
   answer is `time disagrees: claimed 1, got 5989`.

Each refusal says which of those it was and what to do about it, because "my
time did not appear" is a bug report and "your live tune was on" is not.

### Caps, and the DoS the caps are for

`[0, 4294967295]` — eight bytes of JSON that decode to four billion array
entries. The body-size limit does **not** stop it, and neither does a per-run
limit on the RLE, because the same attack works as fifty thousand individually
legal runs. So the cap is on the **decoded total** and it is checked *before*
each run is expanded: `decodeInputs(s, maxFrames)`. The server passes one; the
client and `bin/replay` do not, because they read a file a human chose.

Verification runs **off the request handler**, in a queue of one, driven in
slices by `verifyReplaySteps` so the event loop gets a turn about forty times
across the longest legal run — and so the two-second wall-clock budget is
enforceable at all. You cannot time out a loop that never yields. The slice size
is a scheduling knob and cannot change a verdict; `replay.test.ts` asserts that
by verifying the same run at five different slice sizes and comparing.

Not `worker_threads`, deliberately. The server runs under `tsx`, a worker would
inherit the TypeScript loader by accident of `execArgv` rather than by design,
and a transpile hook that silently fails in a worker turns the leaderboard off in
a way that passes every test on this machine. This is 0.15 s of arithmetic, not
video encoding. If verification ever grows teeth, a worker pool is the migration.

### Storage — plain JSON on NVMe

```
data/replays/<levelSimHash>/<ab>/<replayId>.json   ab = first 2 hex of the id
data/leaderboard/<levelSimHash>.json               every player's best + top N
data/players/<playerId>.json                       that player's PBs
data/submissions.jsonl                             append-only, the source of truth
```

A replay is an immutable ~1 KB blob written once and thereafter fetched **only
by id** — the exact shape where blob-in-a-database is the wrong call. The
`replayId` is a content address (sha256 of rev + level + bike + stream), so
submitting the same stream twice writes one file and two players who genuinely
produced the same run share it. The `<ab>` fan-out is 256 buckets, because an
evening of a friend group grinding one level plus a `bin/level-drive` sweep is
thousands of files and a directory with tens of thousands of entries is
unpleasant on every filesystem.

The embedded level and bike spec are **stripped before storing**. A replay file
carries them so it stands alone; a replay on a leaderboard needs neither, and
keeping them would be 19 KB of `10-cathedral` in a 20 KB blob — shipped down to
a client that is currently riding that level.

Every mutating write is **temp file + `fsync` + `rename(2)`**, the same pattern
as `gpu-watch`'s `sms-token.js`: a reader sees the whole old file or the whole
new one, never a half-written board, even if the process is killed mid-write.
Writes to one board are serialised by an **in-process keyed mutex**, because
read-modify-write on a JSON file races with itself the moment two people finish
the same level at once. One Node process, so that is sufficient and total — no
`fcntl`, which is the mechanism that does not work on this box's mergerfs pool
and the reason for the standing no-SQLite-on-the-pool rule. (The repo is on NVMe
ext4, so the rule does not even bite here; the preference for plain JSON is the
house style regardless.)

Because every accepted submission is appended to `submissions.jsonl`, the boards
are **derived state** and `bin/board rebuild` is a real rebuild rather than a
comforting name. Corrupting a board file and rebuilding produces a
byte-identical result; `--verify` re-simulates every replay on the way past,
which is the one command that answers *is anything on this board not real*.

### Partitioning

Decided on day one and not re-litigated:

- Boards key on **`level.simHash`** — the hash over only the fields the sim
  reads. Retitle a level, recolour it, move a decor polygon: the board survives.
  Move an apple by 1e-12 and it does not, because that is a different level to
  ride.
- Boards **partition by `simRev`**. A time set under different physics is not a
  time on the same level, so it is neither silently invalidated nor wrongly
  compared — it sits on the rev-2 board, labelled, forever. Through milestone 1
  the rev bumps freely and the live board therefore empties; the panel says so,
  and it names how many times the older revs still hold, so nobody concludes
  their runs were deleted.
- Boards **partition by category**, and there are two from the start: `human`
  and `tas`.
- Every entry records the **bike's `specHash`**. Only one bike ships, so it
  partitions nothing yet; recording it from day one is what makes a
  stat-varying bike a migration rather than an archaeology project.

### TAS is a category, not an exploit

Deterministic verification means **any input stream the sim accepts is
legitimate by definition**. A solver-generated optimal run verifies perfectly,
and no test could ever tell it from a human's — because there is nothing to
tell. That is unfixable in principle.

So there is a TAS board from the start, and `bin/level-drive --save` already
produces exactly such runs. `bin/submit` posts them and **defaults to `tas`**,
because anything submitted from a terminal was produced by a program;
`--category human` prints a warning saying that nothing here or on the server
can check that claim. Retrofitting a category split after people have competed
is a fight. Doing it now costs one string field.

**The category is not, however, a thing to watch.** A TAS time is information; a
TAS *line* is the level's answer, and the client has no way to play one at all.
See *Why a TAS line cannot be watched* under Ghosts.

### Who you are, and what that is worth

**No identity signal reaches this app.** HAProxy adds only `X-Forwarded-*`, and
the cush-auth device gate — which decides whether your browser gets through the
front door at all — sets no identity header downstream. That was checked
directly, not assumed.

So: a `playerId` is generated once on your device and kept in `localStorage`,
you pick a display name, and both are submitted with a run.

> Re-simulation means a **time** cannot be faked. **Whose** time it is can be.
> Anyone who can reach the game can post a verified run under any playerId and
> any name they like.

Among a handful of device-gated friends that is fine and socially
self-correcting, and saying it plainly is better than implying a guarantee that
does not exist. The proper fix, when it matters, is **cush-auth passing an
identity header downstream** and the client reading it instead of minting one.
That is the migration path; it is deliberately not built.

**The id is the identity and the name is never a key.** Every board entry, every
personal best and every player file keys on the opaque `playerId`; the name is
denormalised onto an entry for rendering and is refreshed in place when it
changes. Three things follow: renaming is free and does not fork anybody's
history, two people picking `hexi` is a cosmetic clash rather than a silent
merge of their times, and a real signup later is a **claim** on an existing id —
every row that references it transfers untouched — rather than a rewrite of
every board. `PlayerFile` ships an unused `claimedBy` slot for that. There is
deliberately **no email field** and will not be one until an account system
needs it: storing personal data carries obligations that a local display name
does not.

### Being the same player on your phone

Identity lives in **one browser's `localStorage`**. That was tolerable until
touch controls shipped: the moment you pick up your phone you are a different
person — new id, no times, and, now that a bike can be chosen, not even the same
bike. A name is cheap to retype; a livery and a leaderboard history are not.

So the board panel has **link a device**: a QR encoding `/?claim=<playerId>`,
and the same id printed underneath in four-character groups, because cameras
fail, QR readers vary and a code you can type is the fallback that always works.
Scan it on the phone, it lands on the game, and it offers — never applies
silently — to become that player. The name and the bike come down with it, so
the phone posts as *them* rather than under their id wearing your label.

Four things are worth being plain about, and the panel says all four rather than
implying any of them:

- **It is a bearer credential.** Anyone who can see the code can become that
  player on their own device. Among a handful of device-gated friends that is a
  perfectly good trade.
- **It is not a new exposure.** The `playerId` is not a secret and never was:
  every leaderboard row the API returns carries the playerId of whoever set it,
  so the code gives away nothing the board does not already publish.
- **The phone has to be enrolled with cush-auth first.** An un-enrolled device
  bounces to the sign-in page before a byte of the game loads, which looks
  exactly like a broken QR code and is not one.
- **It is not a login, and this changes nothing above.** Re-simulation proves a
  time is real; nothing proves whose it is. A claim code does not move that line
  by one bit — it moves an id between two devices that could both already post
  under any id they liked.

**Nothing is lost by claiming, and it is reversible.** The playerId, name and
bike are replaced; the id this device had is kept, so one click goes back. Local
best times are untouched, and not out of convenience: `bests.rev<N>` is keyed by
the level's `simHash` alone — it is this *browser's* record of what it has done,
not this *player's* — so there is nothing to merge and nothing to discard.
Merging them into the claimed player would be the dishonest option, since those
times were set by a different player record on the server.

**Rotation** is offered as *start over as a new player*, and what it costs is
stated rather than glossed: there is no server-side secret to rotate — the code
*is* the id — so rotating means becoming a different player. Times already
posted stay on the board under the old id; they are not deleted and not moved,
they just stop being yours. The old id is kept, so showing a code on a stream is
recoverable rather than permanent.

The QR encoder is **written out rather than installed** — `src/client/qr.ts`,
about three hundred lines, byte mode at error-correction level L, versions 1 to
10. Same reasoning as the art, the audio and the physics: a QR code is a spec
with a fixed answer, so there is no version of that dependency that gets better.
`qr.test.ts` checks the generator polynomials and the format information against
the published tables, reads the data back out of the finished matrix to prove
the placement, mask and interleave agree with each other, and compares the whole
841-module matrix against one produced by an independent encoder. That last
check earned its place immediately: the format information was written
**transposed**, which produces a code that is structurally perfect, passes every
self-consistency test, and that no reader on earth will open.

## The end-of-level screen

Finishing a level used to just stop. There was a moment of completion with
nothing in it and no route onward, which on a twenty-level game is most of what
a player needs from the moment.

**It appears on a FINISH and never on a death.** Dying is the common case in a
die-and-retry game and it already has instant restart; a panel in front of that
would ruin the core loop, so `finishRun` gates it on `replay.finished` and
`bin/smoke` asserts both halves against the real bundle — a death run leaves the
panel shut, a finish opens it.

**The rule everything else on it serves: the fastest path back into the game is
the default, and dismissal is instant.** A results screen that costs three
clicks to reach the next level is worse than no results screen. So Enter goes
onward, R retries, Escape closes, nothing animates in, and nothing on it is ever
waited through — the summary is complete on the frame the run ends, with or
without a server, and the posting line fills itself in afterwards.

What it shows:

* **The time, large.** It is the thing you came for and the only large text on
  the screen.
* **Versus your PB** — faster or slower, signed, and against what. A new best is
  marked with its own line in its own colour and the words rather than a symbol.
  An exact tie has its own branch, because on a 128 Hz input grid two clean runs
  of the same line tie routinely and folding that into "slower" reads as a loss.
* **Your position and the gap to the entry above.** The gap is the number that
  makes a board a race: with a field of two, "0.618 s behind krrl" is a thing you
  go and do something about and "#2 of 2" is trivia.
* **Whether it posted, resolved rather than hidden** — and when a refusal is
  fixable, *how*. Every `RejectCode` the server can produce is handled by name:
  over-cap, rev mismatch, non-shipped bike, verification failure, rate limit,
  busy, timeout. "Not posted: this bike is not the shipped one" is a true
  sentence that tells you nothing to do, and it had already confused this
  project's own user once; it now comes with "press H and hit reset spec, and
  turn live tune off if it is on".
* **A compact top of the leaderboard**, with your own row present even when you
  are outside it — and marked as a jump rather than silently mixed in. Being
  outside the top N is the common case for a new player and exactly when a board
  most needs to say something.

**With no server it is a complete screen.** The time, the PB comparison, the
apples and every action survive it; the board rows and the standing simply are
not there, and the posting line says the leaderboard is offline and the time is
yours locally. The PB comparison is against the **local** best, which is why it
works at all offline — and it is read *before* `recordBest` overwrites it, or
every run would compare against itself and look like a tie.

`results.ts` decides all of that and is tested in plain node; `resultsui.ts`
turns a model into elements and is not. Same split as the leaderboard panel, and
for the same reason — there is no jsdom in this repo, and the DOM is not what
could be wrong.

## Ghosts

The run one place ahead of you, riding beside you.

A ghost is a **second, independent sim** — the same `createSim(level, spec)` you
are riding, fed somebody else's input stream, one frame for one frame. Not a
recorded path, not a sampled trajectory. That is affordable only because a
replay is a kilobyte of buttons and because the sim was built cheap to
instantiate and steppable headlessly for the solver that has not been written
yet.

**A ghost is always a HUMAN run.** `chooseGhost` reads the human board and
nothing else — it is handed the TAS standing as well and pointedly never looks
at it, so that the rule is stated where it is enforced and `ghost.test.ts` can
assert the consequence directly: a level with a TAS entry and no human entry
yields **no ghost**, for every selector setting. That matters today rather than
in principle, because thirteen of the twenty shipped levels are currently in
exactly that state. See *Why a TAS line cannot be watched* below for why this is
a spoiler argument and not a preference one.

Which board is on SCREEN is a separate question from which board a ghost comes
from, and conflating them was a real bug: opening the TAS category quietly
changed the line riding beside you. The client now always fetches the human
board, whatever the panel is showing.

**Ghost selection matters more than it sounds.** The picker offers the fastest
human run, your own PB, and *the entry just above you* — and the last is the
default, because a record is a number while the person one place ahead of you is
a race you can win tonight. Trials figured this out; it holds here. With no time
of your own, the entry "just above you" is the **slowest time on the board**,
which is the right answer rather than a degenerate one: with no time everybody
is ahead of you, and the nearest of them is the one you can actually catch. The
server computes it, because the client only ever receives the top N.

With a field of two — which is what this board actually is — that chain is the
whole feature. If you are second, the ghost is the one person ahead of you. If
you are first, it falls back to your own PB, which is still a race. If neither
exists it shows nothing and says **"no ghost yet — be the first to finish this
level"**, which is a perfectly good state and an honest one. It never falls back
to the fastest run: silently showing somebody a time forty seconds faster than
anything they have ridden is discouraging, not motivating, and that argument
applies twice over to a solver's.

**The ghost is strictly read-only with respect to you,** and that is asserted
rather than hoped. It owns its own `Sim`, so its own state and its own `World`;
`createWorld` clones the spec, so it cannot even reach the object your bike is
made of; the level is shared and never written. `ghost.test.ts` runs the same
input stream twice — once alone, once with a ghost stepped alongside — and
asserts every periodic state hash is identical. If a ghost could ever touch your
state, that is what catches it.

**A ghost from a different `simRev` or bike spec cannot be shown**, and says so
instead. Playing rev-2 inputs under rev-3 physics would draw a bike taking a
line nobody ever rode, labelled with somebody's name and time — worse than an
empty screen, and exactly the failure the whole rev mechanism exists to prevent.

It restarts with you, because the loop is die-retry-die-retry and a ghost that
kept its position across a restart would be racing a phantom you are forty
metres behind. It stops at its last frame rather than vanishing, because a ghost
halted at the hard part is information. The HUD names it and reports the gap **in
metres** — the two clocks are identical by construction, since the ghost is
stepped one frame for one frame with you, so a time gap would always read 0.00 s.
What differs is where you each are.

### Why a TAS line cannot be watched

**A TAS time may be seen. A TAS line may not — not on any condition, by anyone,
from anywhere in the client.**

The two are different things and the split is the point. Knowing a 41.7 s exists
here is motivating, and it proves the level is completable — which has already
mattered twice in this project, when the scripted pilot declared three levels
broken and the solver disproved it. That is information. But **route choice is
this game's depth**: apples come in any order and the good levels have genuinely
different orders with different times, and a TAS entry is the output of a search
over exactly that space. It *is* the answer. Watching it does not merely
discourage; it deletes the puzzle, permanently, because you cannot un-see a
route. **A time is information; a line is a solution.**

So:

* A TAS run is never a ghost, never auto-selected, and never the fallback when
  the human board is empty.
* Its **time** shows on the TAS board and on the end-of-level screen.
* Its **line** has no route to a screen. No key, no button, no unlock, no
  disabled control hinting at one. The TAS board prints times and no `watch`
  column; the end-of-level screen prints the time and has no matching action.

**There was a gate here and the gate was wrong.** An earlier pass made the line
watchable once you had finished the level yourself, on the reasoning that it is
then a reward rather than a walkthrough. That reasoning is not silly, but a gate
keeps the thing it gates — the route was still one keypress from every player who
had beaten a level once, which is every player the argument was about. Removing
it is the honest version of the position the gate was already taking.

What replaced `canWatchLine(category, completedThisLevel)` is
`watchableCategory(category)`, and the **shorter signature is the guarantee**:
nothing about the player is an input, so no state a player can reach changes the
answer. It is enforced twice, in the panel that decides which rows get a button
and in `watchEntry`, which is the function that actually fetches somebody's
route — "the UI does not show it" is a presentation fact, not a rule.

The tests assert **absence, not refusal**, which is the stronger claim:
`ghost.test.ts` asserts no `canWatchLine`-shaped export exists on the module at
all, and `results.test.ts` asserts the string "TAS" never appears in an action
list for *any* input and that C is unbound on a full action list rather than a
stripped one.

**`bin/replay` still plays any replay file from the command line**, including a
solver's, and that is deliberate. It is an authoring tool invoked at a terminal
by somebody who went looking; it is not something the game offers a player in
the middle of a session. The distinction being drawn is about what is *offered*,
not about what is technically possible for whoever owns the box.

The category itself is not going anywhere — it is proof of completability, it
keeps machine runs out of human competition, and retrofitting the split later is
a fight nobody wins. What changed is the framing: the solver's output is an
**authoring tool** and a **number**, and not player-facing content.

## Your bike

*"customizable character, colors, clothes, bike"*, and then *"multiple bike
types, colors, accessories, etc. nothing that will impact gameplay or anything
like that"*. Press **Y**.

Six bike silhouettes, ten liveries, four helmets, three jacket cuts, three
scarves and four sets of bodywork markings — 8,640 combinations, all of which
ride **identically**.

### The hard constraint: cosmetics live outside `BikeSpec`

Collision is two wheels, three chassis circles and a head sphere, all of them
`BikeSpec` values, and `BikeSpec` is content-hashed into `specHash` — which the
server checks to decide whether a time counts. **If a colour touched
`BikeSpec`, repainting your bike would refuse your runs**, with the same "this
bike is not the shipped one" message the tuning panel already produces and that
has confused this user twice.

So an `Appearance` is a separate structure in `src/shared/appearance.ts` that
the sim never sees and `specHash` never covers — the same pattern as the level
format's `style` block. That is not a convention, it is three tests:

- **every one of the 8,640 appearances leaves `specHash` bit-identical**, and no
  appearance axis appears anywhere in `specPaths()`;
- **every bike type resolves to the same `specHash`**, swept across the whole
  product. A future contributor who thinks a bobber *should* have a longer
  wheelbase gets a failing test rather than a leaderboard full of refused runs;
- `bikeart.ts` may import `BikeSpec` only as a **type**, so the art can read the
  shape of a spec and can never construct or mutate one.

`bin/smoke` makes the same check through the real bundle: repaint the bike in
the built page, and `window.velo.specHash()` must not move.

### The guardrail: you cannot make yourself invisible

Hand someone a free colour wheel and they will pick dark grey on a dark level,
disappear, and correctly report the game as unfair. **There is no colour
picker.** A colourway is a set of *hues*, and the hex is solved per level
against that level's own palette — the same discipline `palette.ts` already runs
under, where the collision lip's contrast is computed rather than hoped for.

Terrain is dark by law: `derivePalette` caps every terrain tone at
`TERRAIN_MAX_LUM`, because the whole art direction rests on solids being dark
and air being light. So the floors are stated against that:

| | floor | against |
| --- | --- | --- |
| every bike part | **3.2** | the brightest terrain tone in this level's palette |
| the head — the death sphere | **4.6**, and never below luminance 0.68 | the same |
| every part that is not the head | ceiling at luminance 0.55 | so the head is always the brightest thing on the bike |
| visor, decals | **1.7** | the colour they are drawn *on top of* |

Clearing the terrain floor also clears the part's own ink outline, which is what
separates it from the *light* half of the frame — the same ink-and-lip mechanism
the terrain edge uses, and the reason the shipped cream bodywork reads against a
pale wall at contrast 1.3.

The helmet is kept distinct from the wheels **by construction rather than by
arithmetic**: every colourway places its helmet hue at least 45 degrees from its
wheel and frame hues. Contrast ratio is luminance-only and would call a yellow
and a blue at the same luminance identical, which is exactly wrong for "is that
a third wheel or the rider's head" — the failure the shipped art already avoided
when it put the wheel hubs in ink rather than cream.

**Level palettes are derived per level**, so a livery that reads on 03 may
vanish on 11. The sweep is therefore against the whole set rather than a sample:
every bike x accessory x livery against the twenty shipped levels, `CONCRETE`
and generated palettes, plus every colourway against four hundred more for the
levels not written yet.

### Nothing may lie about the collision shape

Two rules the shapes inherit, both learned the hard way:

- **The head is the death sphere and is drawn at its true radius.** Every helmet
  decorates the circle *from the inside*, under a clip, so no accessory can make
  the thing that kills you look bigger than it is. `headDrawRadius` is a
  function rather than a habit precisely so that a per-helmet outset is a
  failing test.
- **Nothing overhangs.** The exhaust tip used to sit at x = -0.90 while the rear
  tyre's back edge is at -0.85, so the pipe stuck out *behind* the wheel and was
  the only part of the bike that did — reported from play as "why does the bike
  have a weird long muffler?". With six bike types there are six ways to do that
  again, so it is a sweep: every polygon, every run and every disc of every type
  is sampled against the bike's own silhouette. Tank bands, seat wedges and
  decals are exempt because they are drawn under a clip on the body path and a
  clipped fill cannot add a pixel to an outline.

Everything survives the detail tiers. At the **overview tier** a bike is three
blobs and a link, and it still carries its livery — a montage of forty bikes in
one colour is a texture rather than a crowd, which is the whole thing this
feature exists to avoid. Every wheel style also has to keep **spin** visible:
spokes, or a disc's own mark. Spin is a real state variable and traction cannot
be read without seeing it.

### The payoff: ghosts wear their owner's colours

Appearance travels with a submission as presentation metadata, **keyed to the
`playerId` exactly like the display name** — and, like the name, it is
**refreshed in place** when it changes, so repainting repaints the rows you
already hold. That was a real bug the last time this pattern was built, and it
has its own test.

- **Leaderboard ghosts** wear the livery on the row you are chasing. The board
  entry wins over anything the stored replay remembers, because the entry is
  refreshed on every submission, so the bike beside you and the row you clicked
  can never disagree.
- **Replay files** carry it in `meta`, the file's presentation block — never
  read by the sim, never hashed. A replay with a livery and the same replay
  without one verify to a **bit-identical hash chain**, which is asserted the
  same way a muted run and a loud one are. Every file recorded before today has
  no `meta`, and the pilot and solver runs in `replays/` never will; absent is an
  ordinary state and falls back to the shipped bike.
- **The montage** is resolved live rather than embedded per attempt, and that is
  a decision rather than an oversight. Embedding would show a mid-session
  repaint historically, which is arguably nicer — but the failure mode of two
  code paths disagreeing is a crowd of forty split down the middle between two
  liveries, which reads as a bug. The montage is about *you*, so it is all you,
  in the colours you are wearing now.
- **Board rows and the results screen** show that player's bike as a small
  avatar beside their name. It is the same drawing code at a small scale
  (`avatar.ts` calls `drawBikePortrait`, which calls `drawBike`), so an avatar
  cannot drift from the bike it is a picture of — the same argument the level
  thumbnails make.

A row with no appearance — every row written before today — resolves to a
**stable derivation from the playerId** rather than to one shared default. Same
argument as twenty levels sharing one palette: a board of people who have never
opened the customiser should still be a board of different people.

## The montage

Finish a level and the panel offers one more thing, on **A**: *watch all 37
attempts at once*. Press it and every run of the session rides simultaneously —
all the failures, faint, alongside the line that worked — dozens of ghosts dying
in every wrong way while one of them makes it. It is Super Meat Boy's trick, and
in that game it is the single most-loved thing in it, because it turns a grind
into a visible story of how you learned the level.

**It is nearly free here, and specifically because of a decision made on day
one.** A replay is an **input stream of about a kilobyte**, not a trajectory, so
a hundred attempts is ~100 KB rather than megabytes, and playback is N sims
stepping in parallel — which the sim has supported since the first commit,
because the solver needed it cheap to instantiate and steppable headlessly. The
recorder has been retaining every attempt per level rather than overwriting for
exactly this, so the feature was a rendering job rather than a data migration.

Four rules govern it, and each one is a thing that would otherwise go wrong:

**Ghosts stop at their death tick rather than vanishing.** The cluster of
stopped bikes at the hard part *is* the story — it is a heat map of where the
level beat you — and a rider that disappeared when it died would erase exactly
the thing worth showing. When the last one stops, the HUD says so.

**The crowd fades as it grows.** A single ghost draws at alpha 0.3 and that is
the number the montage matches at the low end, because it must not introduce a
second idiom for "another bike". But alpha composites: forty bikes at 0.3 piled
on the same three metres is an opaque block, and the winning line would then
read against a wall rather than against a crowd. So alpha falls off as
`1/sqrt(n)`, with a floor so a lone rider at the far end does not disappear.

**The crowd draws as silhouettes** — the renderer's *own* coarse tier, the one a
bike already drops to when it is small on screen, asked for explicitly. Two
reasons: a dozen full-detail bikes, chrome and panel lines and exhaust smoke
times twelve, is a texture rather than a crowd; and it is the difference between
fitting and not, at about **2.2 ms per full-detail rider against 0.45 ms per
silhouette** on this box, roughly five times. It was briefly a *threshold* —
full detail below a dozen riders — and that was worse than either rule alone,
because it put a cliff in the middle: twelve attempts measured at 26 ms and
twenty-four at 12 ms, so watching **fewer** of your failures cost more than
watching more of them.

**It is offered, never forced.** This screen's standing rule is that the fastest
path back into the game is the default and dismissal is instant, so the montage
is a key you press, printed on the panel like every other action, below `next`
and `retry`. Nothing plays at you before you can hit Enter. A restart clears it
immediately — faint bikes over a live attempt would be the exact opposite of the
readability rule.

The winning line is **not** one of the ghosts: it runs on the player's own sim
through the ordinary playback path, which is what makes the camera follow it and
what makes it the only bike on screen at full strength.

### What it actually costs, and where the cap came from

The plan estimated 50 ghosts at ~3.7 ms of a 16.7 ms frame from the sim
benchmark. That arithmetic is right about the half it measured and it is half
the bill. `bin/montagebench`, on `20-close-quarters` at 900x500 with the art's
adaptive detail forced **off** so the number cannot be bought by quietly turning
the game down:

| riders | sim step (ms per input frame) | draw delta p50 | total per frame @ 60 fps |
| ---: | ---: | ---: | ---: |
| 6 | 0.055 | 8.3 ms | 8.4 ms |
| 12 | 0.078 | 5.4 ms | 5.6 ms |
| 24 | 0.121 | 9.7 ms | 10.0 ms |
| 40 | 0.190 | 10.8 ms | 11.2 ms |

Read those rows with ±2–3 ms of scheduler noise apiece: this box sits at a load
average around 15, and an **empty** frame of the same scene measured anywhere
between 6 and 12 ms across runs — which is why the 6-rider row can come out
above the 12-rider one. Across every run the marginal cost is about **0.25 ms of
draw per rider**.

The **sim** half is far better than the plan predicted — a fifth of a
millisecond of a rendered frame for forty riders. It is the **drawing** that
costs, by an order of magnitude, even on the silhouette tier.

So the cap is **24, not 50**, and the level that decided it is
`20-close-quarters`: the densest in the set, the one the user can already feel,
and the one where **culling saves least**, because the crowd dies inside the
same few metres and most of it is on screen at once. On a sprawling level most
of the crowd is off camera and the draw cost falls with it — the riders keep
*stepping* either way, since a sim paused because it went off screen would come
back in the wrong place at the wrong moment.

That ~10 ms is a **floor, not a ceiling**: this box has no GPU, so Chrome
rasterises on the CPU. A machine with a GPU is faster, never slower.

Attempts prefer the most recent — the last two dozen are the ones on the part of
the level that was actually hard, while the first ten are you learning the ramp
exists and all die in the same uninteresting place. The winning run is exempt
from the cap, because a montage without the line that worked is a pile of
failures. Runs from another sim rev or another bike are **counted and not
shown**, the same rule the leaderboard ghost runs under and for the same reason:
replaying those inputs under these physics would draw a line nobody rode.

Nothing here is written to disk. Attempts are for the run of play you are having
right now; persisting them would be inventing the storage layer that belongs to
the server.

## Playing on a phone

Landscape, a thumb in each bottom corner, the play area above and between them.
The controls come up on their own when the primary pointer is coarse, and
`?touch=1` forces them on from a desktop (`?touch=0` off).

Everything below is judged with `SHOTS_PHONES=1 SHOTS_QUERY=touch=1 bin/shots`,
at the viewport a phone actually hands you rather than the one a test would pick.
The previous version of this section described a layout that looked right at
844 x 390 and was unusable at 915 x 348, which is the size a large Android phone
in Chrome really reports — and every part of that was visible in a picture and
none of it in a number.

**Large zones, never joysticks — and that is the one decision everything else
follows from.** A virtual stick is the obvious thing to reach for and it would
be wrong, because **the sim takes a bitmask**: throttle is on or off, lean is on
or off, and there is no analog value anywhere in the physics. A stick over a
bitmask is a four-way pad wearing a costume, and a worse one than a pad — it
adds a dead zone, it makes the thumb travel to reach an input that is binary at
the other end, and it is a **false affordance**, because everybody who has held
a stick expects it to mean partial throttle and it cannot.

### The pads are sized in millimetres, and that is not a detail

**A thumb is the same size on every phone. A percentage of a canvas is not.**
The first version of this layout sized the pads as fractions of the viewport —
lean at 15% wide and *half the height* each, the gas cluster a third of the
width — and a screenshot from a large Android phone in landscape showed what
that means in practice: four enormous rectangles across the entire lower half of
the screen, over empty background, while the whole level sat in a band across the
top. The same fractions on a small phone would have been too small to hit.
Neither is a size anybody chose.

So every number in the layout is millimetres, converted once at the top of
`touch.ts`. About **9–10 mm is the minimum comfortable touch target and 12–15 mm
is generous**; past that a pad is not easier to hit, it is just taking screen
away from the level. And **thumbs pivot from where the hand grips and sweep an
arc**, so on a big phone the *far* corners are harder to reach rather than
easier — everything you touch while driving now hugs the bottom corner it is
already near.

CSS's own `mm` unit cannot be used for this: absolute CSS units are pinned to
the CSS pixel at exactly 96 per inch, which is a fiction on a phone. The real
figure is set by the device-pixel-ratio the platform picks and is only knowable
statistically — ~6.3 CSS px/mm on Android, 5.56 on an iPhone 15 Pro, 6.38 on an
SE — so `PX_PER_MM` is **6.0**, the middle of the phone range. A pad specified at
12 mm therefore lands between 10.9 and 12.6 mm on real hardware, inside the
comfortable band at both ends.

| Zone | Size | Where, and what it is owed |
| --- | --- | --- |
| **GAS** | 21 x 20 mm | bottom-right corner, where the thumb already rests — **held almost constantly**, so it gets the best position and the largest area |
| **brake** | 13 x 20 mm | tiled inboard of it: you reach for it in bursts, so narrower |
| **lean ↺ / ↻ lean** | 15 x 20 mm each | bottom-left, two zones **sharing an edge** — used constantly and switching direction mid-air |
| **FLIP** | 34 x 13 mm | directly above the right cluster, across a **3 mm dead strip**: rare, critical, reached by rolling the right thumb up off the gas |
| restart, levels, full screen, gas mode, zoom | 13 x 9 mm each | a 3 x 2 block at the top-left, below the HUD band and dimmer than the controls — you press these between runs and the others during one |

That comes to about a fifth of a landscape phone's glass, and all of it in the
corners; the previous layout was nearer 40% and in the middle of everything. On
a viewport too narrow to hold both clusters — a 360 px portrait phone is 60 mm
across and the clusters plus their gap want 76 — the whole thing **scales** down
rather than reflowing, because the positions are what a player learns, and it
stops at the comfortable minimum rather than shrinking forever.

**The dead strip under FLIP is the one gap in the layout, and it is deliberate.**
Everywhere else a gap would eat an input. There it prevents one: a thumb
drifting up off a held throttle must not arrive in flip, because that fires a
direction change in mid-air and loses the run. A touch that slides into nothing
latches, so the strip catches the drift and the throttle stays held; reaching
flip on purpose means crossing 3 mm of nothing, which a press does and a drift
does not.

**Multi-touch is the normal case, not an edge case.** Throttle plus lean is most
of the game and throttle plus lean plus flip — three fingers — is how you save a
landing, so the mask is built from a **map of pointer id to zone** rather than a
set of zones: two fingers can be in the same zone, and a set would release the
throttle when either of them lifted. Every way a touch can end is handled
separately, because they are not interchangeable — `pointerup` is a lift,
`pointercancel` is the OS taking the gesture away, and a window `blur` is the
tab going away with fingers still down. A control that only listened for the
first of those leaves the throttle welded on.

**The lean pair has no dead strip between them.** Direction changes constantly
in mid-air and lifting a thumb to do it would lose runs, so a moving touch
re-tests which zone it is in on every move. But a touch that slides into the
**play area latches** rather than releasing: the throttle is held for most of a
run and a thumb drifts while it is held, and four millimetres past the top edge
must not cut the engine with nothing on screen to say why. Only lifting
releases. A slide never enters a command zone either — a thumb crossing the
restart button on its way somewhere must not end the run.

**Flip is the awkward one and it gets a home, not a gesture.** It is rare, it is
critical, and both thumbs are already busy. No double-tap and no swipe: a
gesture that fails does so *silently*, and this game punishes a missed input
inside a tenth of a second.

### Auto-throttle, as an option

A two-button scheme was floated early and argued down for the keyboard. On a
phone it is a genuinely better idea, so it ships as a toggle — the small **gas:
held / gas: auto** button at the top — remembered between sessions, and off by
default because some people will strongly prefer each.

With it on the gas is held for you and the right cluster collapses to one big
target. That target is the **brake**, which is the honest fourth control: the
plan said "three targets, right thumb free", and dropping the brake would delete
hooking the front tyre, `20-close-quarters`' braking beat, and any level that
asks you to stop. The thumb is still free — this is a control you touch in
bursts rather than hold, which was the point.

Two details make it work rather than fight you. **The brake cuts the auto gas**
rather than fighting it: throttle and brake are additive torques on the wheel,
so holding both makes the bike fight itself, and under auto-throttle "brake"
means "stop". (A player asking for both *deliberately* on a keyboard still gets
exactly what they asked for; this governs only the bit the client adds on their
behalf.) And **tap to start**: with the gas held the mask is never zero, so the
opening peek — which ends on any input at all — would end on the frame the level
loaded and the bike would drive off the line before anybody had looked at it. So
the auto bit is withheld until the first touch since the last restart.

### What the camera does about hands

**Thumbs occlude the screen.** In landscape, hands cover the bottom corners,
which is exactly where a grounded bike sits when the camera centres it — so the
one thing the readability rule says must always be legible would be under a
thumb. `screenBiasY` pushes the bike up the frame, and the ground it is about to
hit comes up with it. It is a **presentation offset only**: it moves the
published view and never the follow, so the safe-box guarantee still holds
against the play framing, and the two together are clamped so they can never put
the bike off the edge. It fades out under the overview, where there is no corner
to hide in and an off-centre framing is just a crooked picture.

**It used to be a flat 0.17 of the half-frame and that was wrong on a real
phone.** 0.17 was chosen against an idealised 844 x 390 viewport. Chrome's URL
bar and Android's system bars make the real one about 915 x 348, and on a frame
that short the same fraction was pushing a grounded bike up **under the level
card** — the exact thing the offset exists to keep it out from under. A constant
fraction cannot be right on two viewports that differ by a factor of three in
height.

So it is derived, from the two things that are actually covering the glass:

- **the want** — the clear band runs from the bottom of the 52 px HUD to the top
  of the thumb pads, and the bike wants the middle of *that* rather than the
  middle of the screen. That is a shift of half the difference between the two
  insets, and it is a number of **pixels**, so it comes out large on a short
  screen and small on a tall one without anybody choosing either;
- **the room** — the safe box already allows the follow `safeBox` of the
  half-frame above centre, so the worst case is `safeBox + bias` and it has to
  land below the HUD. On a short viewport that is the binding constraint and the
  want is not paid in full;
- **the cap** — `screenBiasY` survives as the most this may ever ask for (0.30 on
  touch, 0 on a desktop), which is what keeps a desktop at exactly zero and
  leaves a slider on the tuning panel that means something.

`thumbInsetPx` is measured off the real pads every frame rather than guessed, so
switching to auto-throttle, rotating the phone or the URL bar collapsing all move
it, and all of them ease.

| viewport | pads cover | derived bias | bike sits |
| --- | --- | --- | --- |
| 1600 x 900 desktop | nothing | 0 | dead centre |
| 1180 x 820 tablet | 141 px | 0.109 | 366 px down of 820 |
| 915 x 348 phone + browser chrome | 141 px | 0.256 | 130 px down of 348 |
| 736 x 280 small phone | 136 px | 0.209 | 111 px down of 280 |
| 412 x 800 portrait | 127 px | 0.094 | 362 px down of 800 |

In every row the bike ends up in the middle of the band nothing is covering,
which is the only thing the rule says.

**The phone was being shown less than half the level, and that was the real
bug.** There used to be a `zoomBias: 1.25` here, reasoned from "the bike is only
6.6% of the screen width on a desktop, so a small screen wants to be closer".
The measurement says the opposite. A fixed px/m does not frame a level at all —
it frames a *bike* — and what it actually decides is how much world is on
screen, which then depends entirely on how wide the window happens to be:

| viewport | at a fixed 62 px/m | world visible |
| --- | --- | --- |
| desktop, 1600 px | 62 px/m | 25.8 m |
| ultrawide, 3440 px | 62 px/m | 55.5 m |
| landscape phone, 844 px | 62 px/m | 13.6 m |
| the same phone, x1.25 | 78 px/m | **10.9 m** |

Nobody chose the second and third rows, and the fourth made the complaint worse.
So **the base zoom is derived from the viewport**: `baseZoom` is an anchor
measured on one window — 62 px/m at 1600 px, which is the framing all twenty
levels were authored and played at — and every other screen solves for it with
`zoom = baseZoom * (cssW / refWidth) ** widthExp`.

`widthExp` is 0.5 and the two extremes are why. At 0 you have the old fixed
px/m. At 1 every screen sees exactly 25.8 m, which asks an 844 px phone for 33
px/m — *below* the readability floor, so the floor would overrule it anyway. 0.5
is the geometric mean of the two defensible targets: the same amount of LEVEL as
the reference desktop (25.8 m) and the same APPARENT scale as it (a phone
subtends about 55% of the visual angle a monitor does, so ~14 m), and it lands
within 2% of that compromise.

### Both dimensions, and the limiting one wins

**That formula was still only half right, and the half it was missing is the one
a phone needs.** `zoom = baseZoom * (cssW / refWidth) ** widthExp` answers "how
much level is *across* the screen" and says nothing at all about how much is up
it — which is fine while every screen has roughly the reference's 16:9 and
catastrophic the moment one does not.

A landscape Android phone in Chrome is about **915 x 348** once the URL bar and
the system bars have taken their quarter. That is an aspect of 2.63 against the
reference's 1.78, and the width-only formula picked a comfortable 19.5 m across
and handed over **seven and a half metres of vertical world** — four bike-lengths
— so the level came out as a thin band across the top of the canvas with the
pads covering the empty rest. That is the screenshot that started this pass.

So each axis derives its own zoom from its own reference extent with the same
exponent, and the answer is the **smaller** of the two. It is not an average and
not a compromise; it is the statement that *no axis ever shows less world than
its own derivation asked for*:

```
byW  = baseZoom * (cssW / refWidth)  ** widthExp
byH  = baseZoom * (cssH / refHeight) ** widthExp
zoom = clamp(min(byW, byH), minZoom, maxZoom)
```

| viewport | width-only | now | world visible | was |
| --- | --- | --- | --- | --- |
| 1600 x 900 — **the reference** | 62.0 | **62.0** | 25.8 x 14.5 m | unchanged |
| 1920 x 1080 — same aspect | 67.9 | **67.9** | 28.3 x 15.9 m | unchanged |
| 1180 x 820 tablet landscape | 53.2 | **53.2** | 22.2 x 15.4 m | unchanged |
| 3440 x 1440 ultrawide | 90.9 | **78.4** | 43.9 x 18.4 m | 37.8 x 15.8 m |
| 844 x 390 iPhone landscape | 45.0 | **40.8** | 20.7 x 9.6 m | 18.7 x 8.7 m |
| **915 x 348 Android + browser chrome** | 46.9 | **38.6** | 23.7 x 9.0 m | 19.5 x 7.4 m |
| 915 x 412 the same, installed | 46.9 | **41.9** | 21.8 x 9.8 m | 19.5 x 8.8 m |
| 736 x 280 small phone landscape | 42.1 | **38.0** floored | 19.4 x 7.4 m | 17.5 x 6.7 m |
| 412 x 800 portrait | 38.0 | **38.0** floored | 10.8 x 21.1 m | unchanged |
| 360 x 640 narrow portrait | 38.0 | **38.0** floored | 9.5 x 16.8 m | unchanged |

**Every window that has the reference aspect is untouched**, which is the safety
argument for the whole change: every level was tuned at 1600 x 900, and a 16:9
window of any size still frames exactly what it framed before. The ultrawide
moving is the same rule working in the other direction, and in the direction of
*more* world, which is the one that cannot hurt.

**The floor still outranks the framing, and it is not quietly lowered to make
the numbers look better.** A portrait phone wants 31 px/m and gets `minZoom`; a
280 px-tall landscape one wants 34.6 and gets 38. Both see less world than the
rule asked for rather than a mushier collision edge — the bike's LOD dead bands
are derived from that floor too.

And the honest answer for the phone in the complaint: at 915 x 348 the derived
zoom is 38.6 px/m against a floor of 38, so **that viewport is within 1.4% of the
readability floor**. There is no more vertical world to give without the
collision edge going soft. The only thing that actually buys more is getting the
browser chrome off the screen — which is worth about 0.8 m of vertical world, and
is why the manifest and the full-screen pad below are part of this fix rather
than a nicety.

The same ratio logic applies to the speed zoom-out: it is a *ratio* now
(`minZoom / baseZoom`, the same 1.63x everywhere rather than a fixed 38 px/m that
would zoom an ultrawide out to 90 m of level), and on a phone the floor takes
most of that away, because there is no room underneath 38 px/m to zoom out into.

The happy consequence, which nobody asked for: deriving the zoom makes the bike
**bigger** on a small screen anyway. 1.7 m at 45 px/m is 9.1% of an 844 px
width, against the desktop's 6.6%. The phone gave up some world, not all of it.

**Resize and rotation need no listener.** The viewport is an input to the zoom on
every frame, so a window drag, a rotated phone, a collapsing address bar and a
keyboard sliding up all arrive the same way and all *ease* — `approach` is
already the right behaviour for a framing that changed underneath you.

**And screens differ, so pinch to zoom.** It drives `zoomBias` — the same
variable the `+`/`-` keys drive, because a second concept for "the player asked
for a different zoom" is two things to keep in step for no gain — and it is
remembered per device like every other preference.

The hard part is not the arithmetic. **Two fingers on the glass is the normal
case here**: gas and lean is most of the game and gas, lean and flip is three, so
a recogniser that watched raw touch points would fire while driving. The rule is
structural rather than heuristic:

> A pointer that landed on a pad is a control for as long as it is down.

It can never become half of a gesture, *including after it slides off the pad
into the play area* — which is exactly the latch that keeps a drifting thumb on
the throttle. Pinch fingers and control fingers are therefore disjoint sets by
construction, so no gesture can take an input away and no stray touch can break
one. A pinch takes **two fingers that both started in the play area**, at least
56 px apart, and the scale runs through a 10% rubber band so a 4 mm drift moves
nothing. A third finger, on a pad or off one, does not cancel the gesture in
progress: a pinch that died because of a knuckle would be the same silent
failure the pads exist to avoid.

The zoom multiplier is **printed on a pad in the top-left, and tapping it resets
to 1.0x**. A gesture that goes wrong mid-run needs a way back that is not another
gesture, and the pad is also the only thing on the screen that says pinch exists
at all. It is always there rather than appearing when you are zoomed, because a
pad that comes and goes means rebuilding the overlay mid-run — which drops
pointer capture and would silently release a held throttle.

### All of the desktop chrome goes, including the level bar

The HUD is nine lines of telemetry, the legend lists keys there is no keyboard
for, and the leaderboard panel sits exactly where the left thumb goes. Those
three were already hidden. **The level bar was not, and it was the problem.** It
was parked at top-right, which is precisely where the art renderer draws the
clock and the apple counter — the screenshot has the level-name dropdown and a
`browse  C` button printed straight through the in-canvas HUD, two HUDs stacked
on each other, one of them advertising a keyboard key to a device with no
keyboard.

So it is hidden, and **`levels` in the touch overlay replaces it**: the same
chooser the button opened, at a size a thumb can hit, in the block with the rest
of the occasional controls. Hiding the only way to change level without putting
one back would have been a worse bug than the one it fixed. The death banner
follows the same rule and says **TAP RESTART** rather than *R TO RESTART* when
there is no R key.

Nothing in the overlay is allowed into the top 52 px either, which is the band
the art renderer draws the level card, the clock and the apple counter in. That
is asserted across every viewport in `touch.test.ts`, and the whole page is
photographed by `SHOTS_PHONES=1 bin/shots` — because a DOM panel sitting on top
of a canvas is not a thing any unit test can see, and it took a screenshot to
catch it the first time.

The in-canvas HUD itself now **fits a narrow screen**: the clock and the apple
counter used to hang off the right of a centred level card, which is invisible on
a desktop and ran the apple counter clean off the edge of a 412 px portrait
phone. The row is centred as a whole when it does not fit, and scaled down if it
still does not. A desktop is byte-identical — the natural position is tried
first and only a row that overflows is touched at all.

The results panel's own buttons are tappable: the pads fade out for as long as it
is up.

### Getting the browser chrome back

**On an Android phone in landscape the browser is eating about a quarter of the
screen**, and at 915 x 348 that is the difference between 9.0 m of vertical world
and 9.8 m — on a viewport that is already within 1.4% of the readability floor,
so it is the only place left to get any.

Two routes, and **neither of them grabs anything**:

- **A web app manifest with `display: standalone`.** Add to home screen and the
  game opens with no URL bar at all. This is the better route, it is the only one
  that exists on an iPhone, and it costs the player one deliberate gesture once.
- **A `full screen` pad**, which calls the Fullscreen API *from the press* — the
  user gesture the API requires anyway. A game that requests fullscreen on load
  is hostile, and it would be refused. Where the API does not exist (iOS Safari
  on an iPhone) the pad is **not built at all**, rather than built and dead.

`viewport-fit=cover` lets the game paint under a notch and a home indicator, and
the price of that is that the corners of the glass are not all usable — so the
pads read `env(safe-area-inset-*)` off a probe element and stay out of them. The
pads also keep a 3.5 mm margin from every edge on purpose: Android's back gesture
lives on the left and right edges and the home indicator lives on the bottom, so
a pad flush to the corner would be fighting the OS for the same three
millimetres.

**The layout is correct with the chrome still on screen.** Both of these are
extra, and the table above is measured with the browser chrome in place.

### It is the same game, and that is asserted

**A touch-played run records the same input stream as a keyboard one and must
verify identically.** The pads emit nothing but the sim's own `IN_*` bits, and
those bits reach the sim through `input.mask()` — the same function the
fixed-step loop samples at 128 Hz for the keyboard — rather than being OR-ed in
at the call site, because there are three call sites and one of them would
eventually be missed. The recorder never learns where a bit came from.

`touch.test.ts` asserts it rather than claiming it: a thumb-shaped stream goes
through the real sim, the real recorder and the real `verifyReplay`, and the
same buttons expressed as raw bits produce a byte-identical stream.

## Live tune — changing the bike from a terminal

Tuning by talking somebody through a table of sliders to drag is slow, and it
puts the person who can *measure* the result furthest from the knob. So the bike
can be changed from a terminal while somebody else rides it:

```
bin/spec                                   print the effective spec
bin/spec set rider.inertialTransferDrive 0.45   set one field by dotted path
bin/spec set gravity 9.2
bin/spec unset rider.inertialTransferDrive      drop one override
bin/spec reset                             clear every override
bin/spec load tuned.json                   apply a whole spec file
bin/spec preset poppy                      apply one of the built-in presets
bin/spec --paths                           list all 46 addressable fields
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

### A renamed field is now loud rather than silent

**A dotted path this build has no field for is not an error anywhere in the
apply path.** `applySpecOverride` sets what it recognises and leaves the rest
alone, so an override naming a field that has since been *renamed* does not
fail — it quietly stops being in force and the bike reverts to a default nobody
chose. `bin/spec` prints `IGNORED n unknown path(s)` at the terminal, which the
person *playing* is not looking at.

That gap cost a real session. A live override held `rider.inertialTransfer`;
that field became the brake/drive pair; the client dropped it, fell back to 0.6
against `maxTorque` 126 — the worst pairing available, lifting like the default
with less power to recover — and it was ridden for twenty minutes with nothing
on screen to explain why the bike had changed. **A rename is exactly when this
is most dangerous, because it is also exactly when nothing looks broken.**

So dropped paths now get their own toast, which **names the keys rather than
counting them** and fires even when nothing else moved, plus a HUD line that
stays up for as long as the file names a field this build does not have. The
toast is the alert; the HUD line is the answer when somebody comes back to the
screen an hour later asking why the bike feels wrong. `livetune.ts` carries them
out as `droppedPaths` alongside `heldPaths`, which is the half that was being
thrown away.

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

## The art

Press **V** to turn it off. That toggle is not a leftover — it is the instrument
the whole look is judged with, and it stays.

Phase 2 added three things on top of the terrain and edge treatment below:
**every level derives its own palette and its own non-colour look** from its
`simHash`, **props** with a placement rule and an enforced budget, and an
**adaptive detail** system that gives back exactly what a long frame costs.
Those have their own sections further down, and each has its own 0/1 or 0..1
slider on the panel so it can be compared against the version without it.

### The rule, and the inversion that serves it

> The player and the collision edge are always the highest-contrast things on
> screen.

The flat renderer obeyed that with a thin cyan line on near-black. It was honest
and almost unreadable: a dark ledge against a dark cave is a shape you infer
rather than see, and inferring where the floor is at 20 m/s is not a skill worth
testing.

The art inverts the value structure. **Solids are dark, air is light** — a lit
concrete wall behind, dark terrain in front — so the silhouette of the ground
reads before any texture, any stencil and any prop. On top of that goes the rule
that does the actual work:

- **5 px of ink on every collidable edge**, stroked centred on the true boundary.
- **A coloured lip just inside it**, 4 px wide: **yellow on tops, orange on
  sides, lilac on undersides.** The colour tells you which way a surface faces
  before you have parsed its shape.
- **Cel bands** behind the lip in the same three classes — lit, mid, dark — with
  drips off the undersides.

Both widths are in SCREEN pixels, not metres, because the rule is about what an
eye can resolve; the cel bands are in metres, because a band is material catching
light. Ink and lip taper below 40 px/m so the overview reads as shape rather than
as a hairball of outlines.

The lip is stroked at `inkWidth + 2 * lipWidth` and clipped to the solid. That
arithmetic matters: stroke it at `2 * lipWidth` — which is what the mockup did
and what this shipped first — and the ink, being centred, covers the lip exactly.
The first screenshots came out with no lip at all anywhere, which is the kind of
bug you only find by looking.

### What derives from geometry, and therefore works on every level

Nothing below is placed by hand. All of it falls out of the polygons plus a
palette, so a generated level gets it for free:

- Terrain base fill, seeded blotches, cracks and diagonal tooth.
- Cel bands and the ink-and-lip edge treatment, classified by each edge's
  **air-facing normal** — which is `CompiledPolygon.nx/ny` unchanged, the same
  array the narrowphase reads. The art and the sim cannot disagree about which
  side the material is on because they share the number.
- **Hazard chevrons at every convex top-to-side corner** — which is every ledge
  you can ride off. This is the cheapest safety feature in the game: it marks the
  drop-offs of a level nobody has ever looked at.
- Stencil stamps at seeded intervals along long top edges.
- Under-ledge shadow bands, and bracketed pipework under ceilings longer than 4 m.
- The background wall: stepped luminance bands, a concrete panel grid with seeded
  tone and stains, a hard light wedge, seeded panel stencils, and drifting dust.
- The bloom pass, the apples, the bike, the rider, the FX and the in-canvas HUD.
- **The palette itself, and every non-colour look parameter** — panel pitch,
  hatch, band contrast, light-wedge angle — derived from the level's `simHash`.
- **Every prop in the game**: pieces, tags, numerals, posters, banners, signs,
  vents, ladders, hose boxes, lamps, conduit, cables and painted floor marks,
  placed from a clearance field computed off the same polygons.
- **Parallax depth layers**, which are the level's own rings under a transform.

Two of those needed a rule the mockup did not have, because the mockup was one
hand-framed shot of one ledge:

**Convexity flips sign with `solidInside`.** On a `ground` platform the solid is
to the LEFT of the direction of travel and a ledge is a left turn; in a `cave`
the solid is on the RIGHT and a ledge is a right turn. The mockup only ever ran
on ground polygons and needed one sign. Most of our levels are a single cave, so
getting this wrong would have put chevrons on every inside corner of every room
and none on any actual ledge. A minimum turn angle keeps tessellated arcs — which
are hundreds of segments whose class drifts gradually — from sprouting a chevron
every few centimetres.

**Pipework needs headroom.** A bracketed pipe slung under a ledge looks exactly
like collidable geometry. Hanging one through a two-metre corridor on
`19-low-roof`, whose entire lesson is head clearance, would be the renderer lying
about where the ceiling is. So the bake measures the free space under every
candidate ceiling and hangs nothing where there is less than 3.5 m, and clamps
the under-ledge shadow to under half the clearance so a tight corridor does not
go black.

### `G` still tells the truth

The debug overlay now draws the **true collision boundary** in a colour the
palette does not contain, plus normals and live contacts, **last and at full
opacity, over everything else.** An overlay the terrain can paint over is not a
check. `bin/shots` captures it on every level, and the green line sits exactly on
the ink.

### How it renders at 60 fps with the camera moving

This was the actual risk and it was measured before any art was tuned.

The mockup draws **one static frame into cached screen-space layers**. Screen
space is worthless the instant a camera pans, and the obvious replacement — a
world-space tile cache of rendered pixels — buys a hitch at every tile boundary,
a memory budget, a zoom ladder and an invalidation policy.

**None of that was necessary, because the expensive thing was never the pixels.
It was rebuilding the geometry.** A few thousand seeded blotches, cracks, stains
and stencil placements, reconstructed from the RNG sixty times a second. So
`src/client/art/bake.ts` builds them **once, as `Path2D` objects in WORLD
coordinates**, and a frame becomes a few dozen fills under the existing view
transform. There is no pixel cache, so there is nothing to invalidate when the
camera moves and nothing to pop in when it moves fast. The result is also exact
at every zoom instead of being a scaled bitmap.

Geometry is filed into a 12 m chunk grid and a frame fills only the chunks the
viewport touches, so a 428 m level costs the same as a 50 m one. The bake is
seeded off `simHash`, so the cracks in a level are the same on every machine and
do not move when somebody retitles it.

Four things came out of measurement rather than design:

1. **Canvas2D rasterises lazily.** The first version of `bin/artbench` timed the
   render call alone and reported the old renderer at 0.33 ms and blamed 11.8 ms
   on the bloom pass — which was simply the one call that read the canvas back
   and therefore paid for everybody else's deferred work. Every sample now forces
   a flush with a 1x1 `getImageData`, and the readback cost is reported so it can
   be subtracted.
2. **The haze was two full-viewport alpha fills a frame for a result that never
   changes.** It is now composited into the luminance band colours at bake time.
   Same arithmetic, no per-frame cost.
3. **The luminance bands were six stacked half-planes** — six full-screen fills
   to show two. They are strips with bounds now.
4. **Hatch is generated live over the viewport**, not baked. It is the one layer
   where "build it once" loses: baked, it meant walking thousands of line
   subpaths, mostly offscreen, to draw the two hundred that are on screen. Its
   pitch is bounded in screen pixels and doubles as you zoom out, because a
   world-fixed pitch is right at the base camera and catastrophic in the overview.

Texture fades out below 38 px/m and is gone by 26. Both sit under the camera's
own 38 px/m floor, so it only ever fires in the overview — where the texture is
sub-pixel mud that hides the silhouette AND by far the most expensive thing on
screen. Turning it off there is a readability win and a performance win at once.

`bin/artbench` is the standing check. It exits 2 if a warm frame's p95 goes over
16.7 ms.

Every timed pass runs at **full detail with the adaptive system off**, because a
budget check that lets the renderer turn layers off to pass is not a check. What
the adaptive system settles at is measured separately, during the real loop, and
printed beside the honest numbers.

It also measures **Phase 1's parameter set as one more pass in the same
process**, so the before/after is a comparison rather than two readings. This
box is shared: a sweep taken while another project's build agents were running
reported a level at 162% of budget that measures well under it when the box is
quiet. Two separate runs cannot tell those apart; two passes in one process
both pay whatever the load is.

### The numbers

Measured by `bin/artbench` at 1600x900, camera flying across the level at 18 m/s.
**This box has no GPU**, so Chrome rasterises the canvas in software — these are a
FLOOR, not a ceiling. A machine with a GPU is faster, never slower.

#### Phase 1 against Phase 2, on interleaved frames

The headline for Phase 2, and the only measurement here that survives a busy
machine. `BENCH_AB=1` flies one pass across the level alternating between the
Phase 1 parameter set and the Phase 2 one in blocks, so both configurations pay
whatever load the box is under. **The ratio is the number to read**; the
absolute milliseconds in that sweep were taken while another project's agents
had twelve cores at a load average above twenty, and they say more about the box
than about the renderer.

Across all twenty levels:

| | median | mean | range |
| --- | --- | --- | --- |
| Phase 2 / Phase 1, frame mean | **1.14x** | 1.11x | 0.80x – 1.44x |
| Phase 2 / Phase 1, frame p95 | **1.04x** | 1.05x | 0.61x – 1.58x |

So the palettes, the variant, the props and the parallax together cost roughly
**a tenth of a frame more than Phase 1 at the mean, and are inside the noise at
p95.** Five levels of twenty come in above 1.25x at the mean; the two with the
least headroom, `19-low-roof` and `20-close-quarters`, both come in BELOW 1.0 —
which is the level-aware density and prop clamps doing exactly what they were
built to do.

Three of the four things that make up that cost were free or nearly so. The one
that was not was the variant's texture density, and the fix was not to narrow
the range for everybody but to bound its expensive half by what each level's own
frames can afford.

#### Absolute cost, on a quiet box

From a sweep taken when the machine was idle. Net of the raster-flush readback
the script reports separately:

| Level | size | art @62 px/m | art @110 | art, overview | OLD renderer @62 |
| --- | --- | --- | --- | --- | --- |
| `07-the-chimney` | 52 x 48 m | 8.9 / 12.2 | 8.0 / 9.9 | 3.0 / 3.7 | 0.7 / 2.2 |
| `10-cathedral` | 176 x 49 m | 8.3 / 9.6 | 6.6 / 7.8 | 3.8 / 5.2 | 1.0 / 1.6 |
| `16-one-way` | 328 x 55 m | 7.7 / 9.8 | 7.2 / 9.8 | 3.6 / 4.8 | 1.1 / 2.5 |
| `19-low-roof` | 290 x 11 m | 12.4 / 14.1 | 7.5 / 11.0 | 2.9 / 3.8 | 1.2 / 2.2 |
| `20-close-quarters` | 332 x 17 m | 13.3 / 14.8 | 10.5 / 13.0 | 4.1 / 5.3 | 1.3 / 2.0 |

(mean / p95, milliseconds, PHASE 1. Budget is 16.7 ms.)

The bake is 16-56 ms once per level, on the frame the level loads, next to a
level-change that already rebuilds the sim. There is no per-frame cache, so there
is no warm-up and **no hitching when the camera moves fast**: warm and cold frames
cost the same thing because nothing is ever rebuilt mid-run.

The worst case is not the biggest level, it is the SHORTEST one. `19-low-roof`
and `20-close-quarters` are 11 m and 17 m tall, so the whole level height is on
screen at once and the solid fills nine tenths of the frame; `10-cathedral` is 49
m tall and most of its frame is background. Cost tracks how much SOLID is on
screen, not how big the level is.

Layer by layer, on the levels where it is tightest: bloom 2.0-4.4 ms, terrain
blotches and cracks 1.0-4.4, hatch 0.8-3.6, wall detail 1.0-1.5, everything else
under half a millisecond each. Bloom is the first thing to turn down, it is a
slider, and it is also the first thing the adaptive system gives up.

#### What the adaptive system is worth

The same sweep drives the real game loop twice, with the adaptive system off and
on. Under the heavy external load it was taken under — which is a fair stand-in
for a machine much slower than the target — it is the difference between
dropping frames and not:

| Level | art on, fixed detail | adaptive |
| --- | --- | --- |
| `17-backswing` | 11 fps | **27 fps** |
| `09-runaway` | 20 fps | **35 fps** |
| `10-cathedral` | 23 fps | **40 fps** |
| `16-one-way` | 23 fps | **47 fps** |
| `20-close-quarters` | 24 fps | **45 fps** |
| `15-feather` | 27 fps | **55 fps** |
| `19-low-roof` | 33 fps | **51 fps** |
| `01-first-light` | 60 fps | 60 fps — nothing to do |

On a quiet box most levels sit at 60 fps either way and the DETAIL chip never
appears, which is the intended resting state.

**A caution about reading any of these numbers.** This box is shared, and a
headless Chrome rasterising a canvas in software sits at most of a core rather
than idling. A sweep run while another project's build agents were busy measured
`01-first-light` — one of the cheapest levels — at 153% of budget on the PHASE 1
parameter set, and the same level reads 90% when the box is quiet. That is why
the A/B is interleaved and why `bin/_chrome.mjs` exists.

### Every level is its own room now

Twenty levels used to share one palette and one set of seeded parameters, so
they read as twenty screenshots of the same place. That was a bigger problem
than prop density, and it is fixed first because it costs nothing at runtime.

**A level with no `style` block derives its palette from its `simHash`.** All
twenty differ from each other with zero hand-authoring, and a given level looks
the same on every load and every machine. `style.palette` naming a palette this
build ships wins over the derivation, and `style.colors` overrides individual
slots on top of either. `style` is still not in `simHash` — recolouring a level
must never retire its leaderboard — and `level.test.ts` still asserts that.

**The generator cannot produce an illegible collision edge.** That is the part
that makes generated palettes safe rather than merely convenient. Everything is
chosen in LUMINANCE rather than in lightness, because luminance at a fixed HSL
lightness varies by a factor of five across the hue wheel — a lime at 0.35 is
brighter than a navy at 0.6 — so sampling lightness and repairing afterwards
produced palettes whose lit cel band out-shone anything a saturated lip could
reach. Sampling luminance and solving for it makes the floors arithmetic:

| Guarantee | Floor | Enforced by |
| --- | --- | --- |
| Lit (floor) lip vs the brightest terrain tone it can sit on | 4.6:1 | target luminance derived from that tone |
| Side and underside lips, same | 3.2:1 | same |
| Solid vs the darkest wall band, after the haze | 1.55:1 | the solid's luminance ceiling comes FROM the wall |
| The three lip hues are distinguishable | ≥ 40° apart | placed at fixed offsets, so it needs no rejection loop |
| The ceiling lip never out-shines the floor lip | — | a luminance ceiling on the underside lip |

`palette.test.ts` runs all of that over **400 derived palettes** and reports
which slot failed rather than merely that one did. The shipped `concrete`
palette is held to the same bar, so the floors cannot drift away from the thing
they were calibrated on.

One finding that only a contact sheet of all twenty could have produced:
**a bright wall has no colour left to have.** Luminance and chroma trade against
each other in sRGB, so a lightly saturated wall driven to 0.7 luminance comes
out as the same near-white whatever hue it started from. The first sweep had
twenty visibly different solids standing in front of twenty identical pale
walls, and neither the cause nor the cure is something the per-palette tests
could have caught — they check legibility, and twenty legible rooms that look
alike pass every one of them.

**Raising the saturation floor was only half a fix, and measuring the set said
so.** The realised chroma of the twenty walls still bunched between 0.10 and
0.30 while the code read as though it spanned 0.22 to 0.72, and fourteen of the
twenty sat inside one narrow luminance band. Sampling chroma and luminance
INDEPENDENTLY does not do what it looks like: ask for a saturated wall at a high
luminance and `atLum` hands back whatever chroma is left up there, which is
almost none. So chroma is now a **primary axis and luminance is derived from
it** — `lumCeil = 0.66 − 0.36 · chroma` — which lets a saturated wall be a deep
room and a washed one be a bright one, two visibly different kinds of place
rather than twenty samples of the same overcast afternoon. The sample is skewed
away from the middle of that range for the same reason, the ramp's bottom is a
fraction of its top rather than an absolute (an absolute floor under a dark top
leaves no ramp), the ramp's hue drift went from ±32° to ±60° (at ±32 it was a
tint, and a tint is not a second colour), and chroma now *rises* as the ramp
darkens instead of bleeding away — a dark tone carries chroma a bright one
cannot.

**The edge-contrast floors were not touched**, because they are the one rule the
whole look serves and they are not the thing with slack in it. Every number
above varies *within* them, and the 400-palette assertions below still pass
unchanged.

Measured across the shipped twenty, before and after:

| | closest pair | mean pair | wall chroma | wall luminance |
| --- | --- | --- | --- | --- |
| before | 0.281 (04/11, pale lilac over purple) | 1.107 | 0.10 – 0.80, most under 0.30 | 0.29 – 0.61 |
| after | 0.368 (02/05) | 1.330 | 0.08 – 0.94, spread through | 0.19 – 0.49 |

`bin/palette-set` prints that table and the closest pairs; `palette.test.ts`
asserts the floor, so a change that quietly narrows the set fails a build rather
than waiting for somebody to remember to re-render the sheet.

**The contact sheet says the reported clusters are gone and one family is
not.** 09, 11 and 13 are now periwinkle-blue, magenta and pale-lilac-over-teal —
three places; 19 and 20 are warm beige and green, not twins. But **06/07 still
read as two pale lavender rooms and 14/15 as two hot magenta ones**, and the
proxy does not flag either (0.764 and 0.834, both comfortably over the floor).

That is worth being honest about rather than tuning away, because it is not a
generator fault. Twenty independent uniform hues collide: the shipped set has
eight of twenty between 243° and 299°, and the RNG is uniform to chi-square over
20,000 seeds, so that is the birthday problem. The only fixes are per-SET
coordination — which would break the property the 100-level plan depends on,
that a generated level derives its own palette with no reference to any other —
or distorting the hue distribution, which buys nothing. What is left to do is
make same-hue rooms differ on the axes that are not hue, which is what every
widening above does and which is why the ramp gamma, the drift and the
solid-hue offset are all deliberately larger than they look like they need to
be.

**It is a proxy and not a verdict.** The judgement is a contact sheet you look
at (`SHOTS_ONLY=art-62 bin/shots <all twenty>`), and the two pairs above are the
standing evidence that the number and the eye can disagree.

**Hue alone is not enough.** A palette swap still reads as the same room
repainted, so a level also derives a `StyleVariant`: concrete panel pitch, panel
tone frequency, stain density, wall stencil density, blotch and crack density,
hatch pitch and hatch run, the number of luminance bands and how ragged their
edges are, how many shafts of light there are, how far they lean and where they
fall, parallax depth, and prop density. Every field is a midpoint plus a spread,
and the panel's **variety** slider scales the *spread* — so 0 is exactly the old
uniform look and is the honest A/B for whether any of this earned its place.

Two of the variant's limits are frame-budget numbers rather than taste:
`panelW`/`panelH` floor at 1.3 x 0.7 m and `hatchPitch` at 0.18 m. The first
version let the coursing go to 0.9 x 0.5, which is four and a half times the
strokes of the mockup's 2.0 x 1.0 — measured, that took the wall-detail layer on
`20-close-quarters` from about 1.3 ms to 3.1, on the one level with no headroom
to give.

### Props: the rule for where a prop goes

Phase 1 named the blocker precisely, and this is it. The mockup's props are all
here now as **parameterised generators** rather than fixed drawings — the VELO
piece, handstyle tags, painted numerals, posters, banners, arrow signs, a fan
vent, ladders, hose boxes, wall lamps with their light cones, conduit runs and
slung cables — and every one varies by seed in size, colour, text and placement.

Placement is seeded from `simHash`, so a level's dressing is stable across loads
and differs between levels.

**The text is geometry, not a font.** The mockup leaned on Bungee and Permanent
Marker from Google Fonts; pulling those in would make the art a network
dependency, and a piece that silently falls back to Arial on a cold load is
worse than one more chevron. `art/letters.ts` is a stroke alphabet — polylines
in a unit box — so a piece is the same path stroked fat for the body, offset for
the extrusion, and again in ink for the outline. Identical on every machine, at
every zoom, with nothing to load. Tags are a seeded scrawl rather than letters,
because a tag is read as a gesture and nobody reads the real ones either.

#### Visibly non-collidable, structurally

Every prop is drawn in the **background pass, behind every solid**. Terrain
paints over it, so a prop can never cover a collision edge, and a lamp that
overlaps a ledge on screen plainly reads as being behind it. On top of that,
every prop belongs to exactly one class, and each class carries a geometric
invariant that `props.test.ts` checks **on every prop of all twenty real
levels**:

| Class | What it is | Invariant |
| --- | --- | --- |
| `paint` | Pigment on the terrain — floor markings, stencilled signage | Its whole box is INSIDE solid material |
| `mural` | Flat art on the background plane — pieces, numerals, tags | ≥ 0.8 m of clear air around its whole box |
| `fixture` | A thing in the room — ladders, lamps, posters, vents, conduit | Body entirely in air, **and** the site has the room |

The corollary is the rule that would have prevented the Phase 1 bug outright:
**a tight space gets paint and never an object.** A fixture needs 3.0 m of free
air, a hanging one 4.2 m, and — separately — the floor-to-ceiling corridor
*through the prop itself* must be at least 3.0 m. That last test is not
redundant: `d.clear` measures out along the mount normal, so a lamp bolted to a
wall with six metres in front of it passes that while still hanging in a
two-and-a-half-metre corridor. The test found exactly that on `12-whoops`.

Prop colours are drawn from a decor set with **the three lip colours filtered
out by appearance**, not by slot name. Exact-match filtering catches the
hand-authored palette, where `yellow` and `lipTop` are literally the same
string; it does not catch a derived palette whose decor green sits a few degrees
of hue and a few per cent of luminance from its floor lip, which looks identical
on screen. So a decor colour is dropped if it is within 22° of hue AND under
1.35:1 of contrast against any lip — unless that would leave fewer than five
usable colours, in which case the whole set is kept, because a level dressed in
two colours is worse than one that reuses a hue. Those three colours mean "this
is the boundary and this is which way it faces"; a sign painted in the floor
lip's yellow spends the player's attention on the wrong thing.

#### Where the sites come from

`art/space.ts` rasterises the level's solid into a 0.5 m grid once, runs a
chamfer distance transform over it, and every later question is a lookup. A cell
is solid if its centre is inside material **or an edge crosses it** — without
the second pass a wall thinner than the pitch reads as open air, which is the
one error that could put a prop inside a wall. The error is conservative in the
right direction: the field can only ever think there is *less* room than there
is.

Five site kinds, refined against what the twenty levels actually contain:

- **pocket** — a local maximum of the clearance field. These are the rooms, and
  they take the big flat art.
- **wall** — a long near-vertical face with air in front. Ladders, conduit,
  lamps, posters, stencilled signage. The commonest site by a wide margin,
  because most of these levels are one big cave polygon.
- **ceiling** — a long down-facing edge with real height beneath it. The hardest
  site to earn, because it is the one that went wrong.
- **ledge** — the convex corner where a top edge meets a side edge, reusing the
  hazard-chevron detector so the two can never disagree about where the drop is.
- **floor** — a long up-facing edge. Paint only, forever: something standing on
  the floor is something to hit, and the art does not get to add those.

One measurement in here was silently wrong in the first version, in the way
worth recording: it used the clearance field sampled a metre out from the
surface. The field measures distance to the *nearest* solid, and a point a metre
off a wall is a metre from that wall — so every surface in every level reported
about 1.0, every fixture failed, and the feature produced nothing at all. **A
rule that silently refuses everything looks a lot like a rule that is working.**
`rayGap` marches along the normal instead and reports the real corridor.

#### The budget, enforced from the first prop

Capped by level area, and then **by how solid a typical frame of the level is**,
measured over screen-sized windows centred on air the bike can actually occupy.
That second term is the level-aware part: render cost tracks visible solid area,
so the levels whose frames are mostly material are the ones with no headroom —
and they are precisely the levels where the choppiness was reported.

| Level | Play-time solid | Props (of budget) | mural / fixture / paint |
| --- | --- | --- | --- |
| `16-one-way` | 0.10 | 30 / 52 | 11 / 9 / 10 |
| `17-backswing` | 0.16 | 30 / 52 | 11 / 6 / 13 |
| `10-cathedral` | 0.22 | 29 / 35 | 10 / 7 / 12 |
| `04-switchback` | 0.29 | 18 / 27 | 8 / 3 / 7 |
| `19-low-roof` | 0.41 | 5 / 5 | 2 / 1 / 2 |
| `20-close-quarters` | 0.54 | 11 / 11 | 3 / 5 / 3 |
| `08-needle` | 0.88 | 1 / 5 | 0 / 0 / 1 |

There are also **per-kind quotas**. Without them the first run put seventeen
graffiti pieces on `15-feather` and twenty-six tags on `17-backswing`, because
those levels are mostly open air and every pocket took the first kind its site
offered. A piece is a two-metre word: three across a level is a place somebody
has been, and seventeen is wallpaper. Sites are walked in a seeded shuffle of a
canonical order, so quotas spread across the level rather than being spent at
the left-hand end.

### Adaptive detail

Reported from play, on a machine **with** a GPU: *"feels choppy a lil bit
sometimes"* on `20-close-quarters`, and then, asked how bad, *"its not like
SUPER choppy, just a tiny bit here and there"*. Occasional dropped frames, not a
low frame rate — which matches that level measuring 89% of the budget exactly.

The counterintuitive part is why 20 is the worst level: it is the **shortest**
one, 17 m tall, so its whole height is on screen and the solid fills most of the
frame. **Cost tracks visible solid area, not level size.** 19 is the same shape.

Four rules, all asserted in `adapt.test.ts`:

1. **Engage late.** Nothing is scaled until frames actually run long. Trading
   quality across twenty levels to smooth a hitch on one is a regression dressed
   as a fix.
2. **Cheapest reduction first**, not proportional scaling: bloom (the most
   expensive layer and the most forgiving to lose — it is atmosphere, not
   information), then props, then blotches and cracks, then hatch, then wall
   detail. The hatch *pitch* widens as well as fading, because it is the line
   count that costs.
3. **Never the ink or the lip.** Nor the cel bands, the chevrons or the
   silhouette. Degrade decoration, never legibility.
4. **Back off early.** Full detail returns as soon as there is room, smoothly —
   the bike's detail tiers already taught that lesson.

It is fed by the **visible solid fraction**, which is knowable *before* the frame
is drawn. That matters: a controller reading only measured time is always one
frame behind, and one frame behind is the frame that drops. The cost model is
`unit × load × costAt(q)` with `unit` the only measured term, so it
self-calibrates on hardware neither of us has.

The HUD shows a **DETAIL** chip whenever the system is doing anything at all.
Its absence is informative too: a dropped-frame report with no chip on screen
means the art was at full detail and the frame was long anyway.

`bin/artbench` measures every timed pass with the adaptive system **off**, so
"it passes" can never quietly mean "it passed by turning everything off", and
prints what the adaptive system settled at during the real loop beside the
honest numbers.

### Parallax, and what a background has to earn

The only backdrop added is **silhouettes of the level's own geometry**, scaled
about the level centre and held back by a fraction of the camera's offset. No
bake at all, because the rings already exist and the scale plus the offset are a
single canvas transform. It is also the only background that cannot contradict
the level, since it *is* the level.

**It is stroked, not filled, and that is the difference between it earning its
place and not.** The first version filled each ring. Measured on
`01-first-light`, two full-viewport fills cost **3.9 ms** — a quarter of the
frame budget for a wash you can barely see, which is exactly the layer the brief
said not to add. A stroke pays for a few hundred pixels of line instead of every
pixel behind the room, and it reads *more* like depth rather than less: a ghost
outline of another shaft behind this one.

It also fades out as the frame fills with solid, and culls per layer against the
transformed bounds. A background pass is painted and then painted over, so on
the levels where the solid fills most of the screen almost none of it is
visible.

### What this deliberately is still not

- **No hand-placed props.** Every prop in the game is generated. `style.theme`
  is still a hook nothing reads, and a hand pass per level is still possible but
  is not something any level needs.
- **No prop animation beyond the fan.** The blades turn; nothing else moves.
- **No particles beyond the existing dust, exhaust and motes.** There IS
  sound now — see *The sound* — and it is synthesised for the same reason the
  art is drawn in code.

## The sound

**Everything is synthesised. There are no audio files and there never will be.**
Oscillators, one two-second buffer of noise, and filters — for the same reason
the art is drawn in code: it has to work on any level including generated ones,
and a sample pack is megabytes of liability nobody asked for. It also means
"how hard was that landing" is a continuous parameter rather than a choice
between `thud_soft.wav` and `thud_hard.wav`.

The taste is the art's: Jet Set Radio Future. Synthetic and characterful, not a
recording of a motor.

### The engine is bound to wheel spin, not to ground speed

This is the whole bet, and it is one line of the mapping. Pitch follows the
**driven wheel's angular velocity**, normalised against `spec.drive.maxWheelSpin`
— the spin at which `step.ts` has tapered drive torque to zero.

Spin and ground speed agree while the tyre grips and diverge exactly where it is
interesting:

| | ground speed | wheel spin | what you hear |
| --- | --- | --- | --- |
| pulling away cleanly | rising | rising | a pull |
| wheelspin off the line | ~0 | high | a scream, and the tyre scrubbing over it |
| throttle held mid-air | irrelevant | climbing to the limit | free revs, thinning out |
| landing on a spun-up wheel | jumps | drops as it bites | the note bends down as the bike surges |

A speed-bound engine gets the middle two exactly backwards, and those are the
two that are fun.

**Brightness tracks pull, pitch tracks spin,** and they are deliberately
different quantities. `step.ts` scales drive torque by `1 - spin/maxWheelSpin`,
so that fraction is literally how much torque the engine still has; it drives
the lowpass cutoff. At max wheelspin the engine is at full pitch with the filter
closing — screaming with nothing behind it, which is what wheelspin *is*.

Two detuned saws and a square sub an octave down, split either side of the
fundamental so the detune slider is not also a tuning slider, through one
lowpass with a slow wobble on its cutoff. The wobble is why the idle reads as a
machine running rather than as a test tone.

### Everything else

| Sound | What it reads | Notes |
| --- | --- | --- |
| landing | fall speed of each wheel, **and** how far that wheel's suspension compressed | Per wheel, not per bike: the common case is the front touching first and the rear then slamming down, and the slam is the one with weight in it. Two wheels inside one frame coalesce to one cue at the harder of the two — two envelopes 4 ms apart is a flam, not a thump. |
| tyre scrub | contact-patch slip, `v·t − spin·R`, the exact quantity `step.ts` solves friction against | Deadbanded, or the tyre hisses continuously and you stop hearing the case that matters. Silent airborne however fast the wheel is turning. |
| suspension | compression **rate**, not compression | A parked bike is fully compressed and silent; a bike crossing a ridge is barely compressed and creaks. This is also why there is no separate "bump" cue — it covers every bump that never leaves the ground. |
| wind | speed, loudest airborne | |
| apple | `applesLeft` dropping | Climbs a pentatonic ladder **within a run**, so a clean sweep is a rising phrase and not the same blip eight times. Resets with the run. |
| flower | `finished` | Three notes and a tail. The only thing it has to say that the apple does not is *resolution*. |
| death | `dead`, scaled by speed, with a floor | Pitch collapse under a filtered crunch. Half a second, dull, low. |
| flip | `facing` changing | A short air whoosh. Space is free and legal mid-air, so this is one of the most-repeated sounds in the game; keep it quiet or turn it off. |

### The rules it has to keep

**The sim never learns about audio.** Audio reads sim state and never writes it,
exactly like the renderer, so a replay is bit-identical whether the tab was
muted, loud, or had no output device. A leaderboard where the volume slider can
move a time is not a leaderboard. Three checks rather than three sentences:
`src/sim/` may not contain the word *audio*; the sampler runs against a
`SimState` and `World` wrapped in Proxies that **throw on any write**, one level
down into the typed arrays where a write would actually land; and a real run
sampled every frame produces the same hash chain as the identical run with no
audio in it. `bin/smoke` then does the end-to-end version in the browser —
**the same fixed input stream driven muted and loud must record byte-identical
replays**, with the loud pass actually firing cues and the muted pass firing
none, so the comparison cannot pass vacuously.

**Audio is per rendered frame, not per tick.** The sim runs at 512 Hz; emitting
an event per tick would be 512 scheduled envelopes a second for a game with
maybe three audible things happening at once. The only thing that costs is the
transients you can miss between two frames, and those are handled by tracking a
per-wheel extremum across the airborne window — the fall speed that makes a
landing loud is gone by the time the contact exists, so it is caught on the way
down rather than by sampling faster.

**The graph is built once and never grows.** Twenty-eight nodes, all started
when the context opens and all still running when the tab closes; a cue is an
envelope scheduled onto an AudioParam of a node that already exists. Creating a
node per event is the normal way to do this and it is the wrong way here — node
churn costs main-thread time and GC pressure exactly when the frame is busiest,
which is exactly when the sounds happen. Continuous voices are deadbanded, so an
unchanged voice costs a compare rather than a scheduling call; most frames move
two of the nine.

**Nothing fires on a restart.** The clock going backwards resets the model and
suppresses every cue on that frame — not the death that caused it, not a landing
from the bike dropping onto its wheels, not the apple count resetting — and the
engine comes up from silence rather than snapping to idle. This is a
die-and-retry game: a player hears the start of a run hundreds of times in a
session and anything that fires there is hated long before they get good at the
level. It is the most important test in `model.test.ts`.

### The browser's rules, handled rather than logged about

- **A gesture is required.** The AudioContext is not *constructed* until the
  first pointer or key event — not constructed and then resumed, because merely
  constructing one on a gestureless page puts a warning in the console, and a
  warning that reappears on every load forever is how a console stops being
  worth reading. Until then `update` is a no-op and the HUD says what it is
  waiting for, because every failure mode of browser audio is silent by design
  and "I hear nothing" with nothing on screen to explain it is
  indistinguishable from broken.
- **A hidden tab is suspended,** not turned down: `visibilitychange` suspends
  the context outright, so a backgrounded game costs nothing rather than
  rendering silence through nine voices.
- **Mute suspends it too,** for the same reason, and is remembered in
  `localStorage`. `M`, or the switch at the top of the Sound group on the panel.
- **Everything is wrapped.** A locked-down browser, no output device, a context
  that refuses to resume: every entry point catches, `error` is set **once**,
  and audio disables itself for the session. Nothing about this feature can stop
  the game running, and nothing about it writes sixty lines a second into the
  console.

Resume and suspend are **serialised**, which is not defensive plumbing — it is a
bug `bin/smoke` caught. Both are async and both decide what to do from
`ctx.state`, so an unmute immediately followed by the tab being hidden read a
context that was still `suspended`, concluded there was nothing to suspend, and
then the resume landed and left a hidden tab making noise.

### What it costs

`bin/audiobench` drives a fixed input stream through the real frame loop twice
— loud, and muted (which suspends the context, so it really is the cost of no
audio at all) — interleaved, and times both the audio update itself and the
whole frame.

Measured on this box (no GPU, so Chrome rasterises the canvas on the CPU and the
frame is dominated by drawing), 1600x900, 1600 input frames x 3 passes each way:

| | `20-close-quarters` | `10-cathedral` |
| --- | --- | --- |
| audio update, mean | **0.026 ms** | **0.027 ms** |
| audio update, p95 / max | 0.100 / 0.200 ms | 0.100 / 0.200 ms |
| frame time, loud (mean) | 16.848 ms | 16.711 ms |
| frame time, muted (mean) | 16.867 ms | 16.726 ms |
| frames over 16.7 ms | 1.1% loud / 1.2% muted | 0.3% loud / 0.4% muted |
| cues fired | 70 loud / 0 muted | 93 loud / 0 muted |

**About 0.03 ms a frame, which is 0.16% of a 60 fps budget** — and the whole-
frame A/B cannot see it at all: the delta is slightly *negative* on both levels,
which is noise, and `performance.now()` is coarsened to 0.1 ms in Chrome so the
p50 of the update reads as a flat zero. That is the honest reading of this
table: the audio update is below the resolution of the frame clock, and the
synthesis itself never touches the main thread — it runs on the audio thread,
which is the entire reason the graph is long-lived nodes with modulated
parameters rather than nodes built per event.

Nothing here was expensive enough to be worth cutting. The most expensive single
sound is the death cue, which schedules six envelopes across four voices in one
call — and it is still well under a tenth of a millisecond, and it happens once
per run by definition.

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

**1b. The unit of framing is metres of world, not pixels per metre.** A fixed
px/m answers "how big is the bike", which is not a question anybody asks while
playing, and it made a 3440 px monitor see more than twice the level an 844 px
phone got. So `baseZoom` is an anchor measured on ONE window — 62 px/m at
1600 x 900, the framing all twenty levels were authored at — and every other
viewport derives from it **on both axes, the limiting one winning**. Rule 1 still
outranks it: a viewport too small to demand `minZoom` sees less world rather than
a softer edge. The table and the reasoning are under *Playing on a phone*, which
is where it matters.

It is not a cinematic system: every value is one exponential and one clamp, and
all of it is on the tuning panel, because anything with feel belongs on the
panel. The sim never sees any of it and must not — a time that depended on how
somebody framed their screen would not be a time.

Hold-to-overview is the **one** thing allowed past rule 1, and only because it
freezes the sim first — see *Finding your way around a big level*. It is a pure
view effect: the play framing keeps smoothing underneath the whole time and
never learns that it happened, so releasing TAB returns to where following had
got to rather than recovering from anything.

## The tuning panel is the deliverable

**It is closed by default, and `H` opens it.** Someone opening the link should
get the game, not a wall of sliders; the panel is a development instrument. Once
you open it the choice is remembered in `localStorage`, because the person who
tunes does it constantly and must not have to re-open it on every hot reload.

That is **presentation, not access control.** Anyone who knows the key can open
it, and that is fine: this app deliberately has no idea who is on the other end
of the connection. It binds loopback, HAProxy fronts it, the cush-auth device
gate decides who gets in, and no identity header reaches the process — so a real
admin/non-admin distinction is not something this app can make today, and
faking one with a hidden panel would imply a guarantee that does not exist. If
one is ever wanted — most likely when leaderboards need per-user identity — the
right fix is cush-auth passing an identity header downstream, built for that
purpose.

It matters less than it used to anyway: **live tune** below changes the bike from
a terminal, so the sliders are not the only route to the numbers.

The two things the panel would otherwise be the only place to see — a stale
hand-tune and a field held by `bin/spec` — are reported on the HUD whenever the
panel is closed. A bike that is not the preset as shipped, with nothing on
screen saying so, is how somebody spends an afternoon debugging their own
leftover slider.

The camera, the overview, the art and the **sound** live on the same panel and
use the same slider machinery, because anything with feel belongs here. None of
them is in the `BikeSpec` and none of them may ever be — a time that depended on
how somebody framed their screen or how loud their speakers were would not be a
time. The Sound group's advice is worth repeating outside it: **tune by ear
against a restart loop, not a single play.** The launch is the sound you hear
hundreds of times in a session.

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
lines:

```
tq += -m*g*L*ax                  * weightTransfer                   static, as before
tq +=  m*L*(ay*acx - ax*acy)     * inertialTransferBrake | ...Drive   inertial
```

Measured with `bin/dive` — full brake from 9 m/s with the rear wheel down, nose
-down pitch at 0.15 s and time to reach 30° nose-down. Both halves swept
together, so each row is one symmetric coefficient:

| `inertialTransfer` | at 0.15 s | to −30° |
| --- | --- | --- |
| 0 *(the old bike)* | −16.1° | 0.233 s |
| 0.3 | −19.8° | 0.208 s |
| **0.6** *(default)* | **−23.4°** | **0.189 s** |
| 1.0 *(physically honest)* | −23.2° | 0.181 s |
| 2.0 | −32.3° | 0.152 s |

It ships at 0.6 rather than the honest 1.0 because sustained full brake already
loops the bike over the front at every setting including zero, with 1.0 getting
there sooner still. It is a slider.

**These numbers replace an earlier table that was measured on a broken rig, and
the break is worth recording.** `bin/dive` borrowed `bin/air`'s test level,
whose flat section ends at x = 30 — so its "run up to speed and settle" gate
never fired, and every measurement started from the runway bail-out instead, at
whatever attitude and whatever point in the suspension's oscillation the bike
happened to be in. Entry *speed* was right to within 0.3 m/s, which is exactly
why it read as a working instrument. The symptom was rows that were not monotone
in the coefficient being swept, which no physics can produce. The rig now has
its own 140 m runway, and because the throttle and the level-hold are both
bang-bang controllers a cruising bike sits in a limit cycle rather than at a
fixed point, so each row is now the **mean of 8 entries spread across more than
one period of that cycle**, with the spread printed alongside. Averaging is not
polish here; it is what removes the phase and leaves the input.

**It is deliberately not gated on being grounded.** Braking a spinning wheel in
mid-air puts reaction torque on the chassis and pitches it — a different
mechanism, also real, also a technique worth keeping. `bin/dive` reports the
airborne row separately so the two are never conflated. A brake-input special
case would have scored the same on the braking measurement and produced nothing
at all on a landing, which is the half that matters more.

### …and the same term lifts it, which is why there are now two of them

*SIM_REV 4.* Read as pure mechanics that term is symmetric, and the symmetry was
the problem. The same rider mass that dives the nose under braking **lifts it
under acceleration**, so the user hit the identical slider from the other side:
*"i'm having a hard time hitting top speed without front tire lifting"* against
*"slamming on brake should slam down the front end"*. Every notch that tamed the
launch wheelie took the same notch out of the brake dive. No single value
satisfies both, because they are two ends of one slider.

So it is two coefficients now — `rider.inertialTransferBrake` and
`rider.inertialTransferDrive` — selected by the sign of the pivot's acceleration
along the bike's forward axis. **This is an active-rider model, not a fudge.** A
symmetric coefficient models a sack of potatoes strapped to the pivot: it reacts
to acceleration in both directions with the same authority because it is not
doing anything. A rider is not a sack of potatoes. Under acceleration a real
rider shifts their weight *forward* — crouches over the bars, pulls on them —
precisely to keep the front wheel down, and that is the most-practised habit in
the sport; under braking they do the opposite of resisting. Two directions, two
effective masses on the arm, and one number cannot express that. Elma's bike
behaves like there is somebody riding it.

Set the two equal and the branch selects the same number, so a matched pair is
arithmetically the rev-3 bike.

The drive side is picked off the **wheelie threshold**, which is a pure torque
balance about the rear contact patch with inertia absent from it entirely — mass
71 kg, CoM 0.658 m above the contact, half-wheelbase 0.6 m, so the restoring
moment is `m*g*a` = 383 N·m against `m*a*h` plus the rider's extra `m_r*L*a`
scaled by the coefficient. At `drive.maxTorque` 126 the front comes up above
0.373 and stays down below it, so **0.3** is the largest round value with any
margin — and it is the value the user had live while playing. Confirmed
dynamically, full throttle from a standstill, time to 30° nose-up (the peak
reaches 90° at *every* setting, so only the time discriminates):

| bike | to 30° nose-up |
| --- | --- |
| rev 3 as shipped — mt 140, both 0.6 | 0.91 s |
| the user's hand-tune — mt 126, both 0.45 | 1.02 s |
| what was live — mt 126, both 0.30 | 1.10 s |
| **rev 4 as shipped — mt 126, 0.6 / 0.30** | **1.12 s** |
| mt 126, 0.6 / 0 | 1.48 s |

Which is the split doing its job exactly: the shipped bike lifts the nose as
reluctantly as the symmetric 0.30 the user was riding, while braking behaves
like 0.6 — which the symmetric 0.30 could not. 23% longer to the wheelie than
the rev-3 bike, and no brake dive given up for it.

`drive.maxTorque` **126** ships with it, down from 140. That is the user's own
hand-tune, recovered from an exported replay, and it belongs in the same change
because the wheelie threshold moves with drive torque — the two are a pair. The
`m1` comparison preset stays at 140 and therefore still wheelies on the same
coefficient, which is the honest thing for a preset kept for comparison to do.

That gap is now closed. `bin/dive`'s grounded-throttle row does **not** show any
of this — at 9 m/s the drive torque has already tapered against `maxWheelSpin`,
so there is barely any acceleration left to react to and every coefficient reads
the same. The wheelie is a low-speed phenomenon and that rig cruises. So there
is a **`throttle FROM REST` row**: full throttle from a standstill, sampled at
the same times, plus the time to 30° nose-**up**. From rest the wheel is stopped,
the torque is at its peak, and the coefficient is the only thing deciding
whether the front comes up.

It discriminates where the cruising row does not — sweeping the drive half on
the soft preset, pitch at 0.3 s and time to +30°:

| `inertialTransferDrive` | grounded throttle at 0.3 s | from rest at 0.3 s | from rest, to +30° |
| --- | --- | --- | --- |
| 0 | +1.7° (±6.7) | +5.1° | never |
| 0.3 (shipped) | +2.8° (±9.9) | +6.4° | never |
| 0.6 | +2.2° (±8.5) | +7.9° | 0.789 s, loops |
| 0.9 | +2.9° (±9.9) | +9.5° | 0.648 s, loops |
| 1.2 | +2.8° (±9.9) | +11.2° | 0.563 s, loops |

The cruising column is noise with a spread three times its own signal and is not
even monotone; the from-rest column is monotone in the coefficient and its
spread is zero by construction. **No averaging, and that is not an omission** —
the grounded rows average eight entries because a bike cruising on flat ground
sits in a limit cycle and one sample measures its phase, whereas a bike that has
settled at rest has no cycle to be in. There is exactly one standstill. The
airborne row already used the same convention for the same reason.

The table also shows the pairing: at the shipped `maxTorque` 126 the front never
reaches 30° at the shipped coefficient, which is the intended feel and is why
the two numbers were tuned together.

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

## Hooking a wheel, and why it does not work

The idea, from the user, recalling Elasto Mania: *"hooking one tire over a thing
and sliding — in Elastomania it would stretch your bike out. A good way to show
is a level where the apples are underneath the poles so the user can figure it
out."*

**It does not work, there is no prototype level, and the reason is structural
rather than a tuning miss.** `bin/hook` reproduces every number below.

Geometry had already said yes — the chassis colliders keep 0.22–0.35 m of
clearance at every nose-down pitch from 5° to 80° — and the suspension
arithmetic said the stretch would be expressive: 10 cm hanging off one wheel,
20 cm at +1 g, 25 cm and bottomed at a 2.5 g catch, against a 71 kg bike on a
6500 N/m spring with 25 cm of travel. **Geometry is not dynamics.** Four
measurements, in the order they have to be asked:

### 1. A circle cannot hook. Only a vertex holds it

Over 1,080 placed hangs — every pitch, every offset, both wheels, six obstacle
shapes:

| obstacle | longest hold | why |
| --- | --- | --- |
| blade (razor wedge) | **11.05 s** (the whole test) | the contact point is pinned to a vertex |
| square lip | 0.30 s | the wheel rolls along the surface and off the end |
| rounded lip | 0.30 s | same, and the normal rotates away as it goes |
| pole, 10 cm wide | 0.25 s | the frame has nowhere to hang |
| pole, 6 cm wide | 0.23 s | same |
| free-floating rail | 0.30 s | same |

A wheel is a circle against polygon edges, so nothing about it *hooks* the way a
grappling shape would. The only forces available are support from below — the
suspension is a zero-rest-length spring, so a bike hanging under a wheel pulls
that wheel *down* onto whatever it is resting on — and friction. **On a flat lip
the contact point slides along the surface as the wheel rolls, and nothing at
all resists the rolling moment of a body hanging off one side.** It rolls off,
every time. On a razor tip the contact is a *vertex*, so rolling no longer walks
the contact anywhere, and the whole thing becomes an ordinary compound pendulum
with its centre of mass below the pivot. That is the entire difference, and it
is why exactly one row holds.

**A pole is the wrong shape and cannot be made right.** The chassis collider is
0.28 m in radius and hangs 0.61 m below and only ~0.21 m to the side of the
hooked wheel, so it wants precisely the space a mast occupies. The clearance
arithmetic says the solid below the hook point has to be gone within 0.28 m
laterally — which no pole with a body under it is, at any width including zero.
The same arithmetic kills grinding along a rail: to hang below a rail, the 1.2 m
long, 0.56 m thick chassis has to be where the rail is, and in the rig the
rider's head starts *inside* the rail and the run is over on frame one. A wheel
can ride **on top** of a rail, which is just riding.

### 2. You cannot get into one

| entry | best hold | catch rate |
| --- | --- | --- |
| ridden off the end of a deck, 1–12 m/s, 588 approach/hold/tail combinations | 0.23 s | 2 of 768 |
| dropped onto a blade, holding nothing | 2 s+ | **0.48 %** |
| dropped onto a blade, holding brake | 2 s+ | **1.27 %** |
| dropped onto a square or rounded lip, either | — | **0 of 1,650** |

And no catch survives above 3 m/s of horizontal speed. A bike riding off a tip
carries its momentum past the tip; to hook you would have to arrive at walking
pace, which is not a thing a level can ask for and not a thing a player would
enjoy being asked. The blade's capture cone is wide — nearly a half-plane of
directions — and it still does not help, because the problem is the velocity you
arrive with and not the angle.

### 3. The stretch saturates, so it cannot be the readout

The premise was that a slow hook hangs and a fast one visibly extends, making
the stretch a readout of how hard you came in. **Every catch that holds bottoms
the suspension.** Peak deflection across the successful catches is 0.245–0.250 m
against a 0.25 m hard clamp — 2.5× the 9.8 cm static hang — from a 0.3 m drop at
zero horizontal speed upward. The readout is pinned at the top of its scale for
every arrival that sticks, and the settled hang then sits at ~0.158 m (1.6×
static) regardless of how it was entered.

### 4. And you cannot get out

From a settled hang, seven of eight held inputs never release it — hold, brake,
lean either way, throttle, throttle-right and flip-throttle are all still hooked
after four seconds. Only throttle *plus* lean-left breaks free. So on the rare
occasion somebody did catch one, the default experience is being stuck in the
scenery.

### The one part that would have worked

The reach is fine. A settled hang sweeps its four apple-collecting points over
x ∈ [−1.07, −0.04] and y ∈ [−0.86, +0.24] relative to the tip, so with the
0.4 m pickup radius an apple is collectable anywhere down to **1.26 m below the
tip and 1.47 m back under it**. The apples-underneath-the-poles layout is
buildable exactly as described. There is simply no reliable way to arrive at it.

### What it would need, reported and not done

Not suspension travel: the suspension already bottoms out on every catch, so
more of it changes nothing about whether a hook holds. The blockers are (a) that
a circle on a convex surface has no rolling resistance, so a hook needs either a
concave capture feature the wheel has to climb out of, or an explicit grab
state, and (b) the chassis collider radius against the wheelbase, which decides
whether a body can hang beside anything at all. Both are `src/sim` changes and
both are considerably bigger than a tuning tweak. **`SIM_REV` stays 4.**

The front-tyre hook from the plan — brake into a bump, flip, and *roll* on the
front wheel — is a different mechanic and is untouched by any of this: it never
leaves the ground, so none of the four failures above apply to it. It is still
worth prototyping; this was not it.

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

## The solver

`bin/level-drive` is a scripted rider — throttle while a wheel is down, lean into
the face — and the plan calls it *"a lower bound, not a proof"*. It duly reported
**13-reservoir, 15-feather and 17-backswing as uncompletable**, which nobody
believed: the pass/fail pattern across the set looked like the pilot's
brittleness rather than a physics wall.

`bin/solve` is the real answer. It searches the deterministic sim for a run that
collects every apple and reaches the flower, and it either hands you a verified
replay you can watch or tells you exactly where it got stuck.

```
bin/solve levels/13-reservoir.json --save /tmp/
bin/solve levels/*.json --jobs 7 --time 1500 --json /tmp/solved.json
```

All three turned out to be fine and the pilot was simply too weak — 13-reservoir
is two jumps of 8 m and 12 m over pits with overhanging lips, 15-feather wants
14.6 m/s carried through a fast section, and 17-backswing is a 909 m route that
doubles back twice. The solver rides all three and the replays are in `replays/`.

### What it searches over

**Macro-actions, not per-frame masks.** Five buttons at 128 Hz is 32 branches per
input frame and hopeless. People hold inputs for tenths of a second, so the
search branches over *(held mask, duration)* pairs: nine held combinations —
lean-left and lean-right together are a no-op in the sim, so that pair is absent
rather than wasted — four of them with a flip on the first frame, each held for
2, 6, 16 or 40 input frames. The durations are **nested**, so one rollout of the
longest emits all four children at its checkpoints: four nodes for the price of
one.

Both ends of that list are load-bearing and they pull against each other. The
short end decides what can be **timed**: with a 3-frame floor the search could
not clear the 8 m gap on 13-reservoir and would have agreed with
`bin/level-drive`; with a 2-frame floor it clears it. The long end decides how
far a node **reaches**: capping at 24 frames made the search cover ground so
slowly that 09-runaway — a 285 m level it solves in eight seconds — stopped
finishing at all inside two and a half minutes.

**`advance(mask)` is the only way time moves.** `stepTick` is never reached past
the sim's own door. That is what structurally guarantees every trajectory the
search can find is expressible as a replay — give a solver raw ticks and it
eventually finds a run no human input stream can reproduce, and you discover
that when you try to save it. `search.test.ts` asserts the property rather than
trusting the comment: the mask stream reconstructed from a node, re-simulated
from scratch, reproduces that node's state hash exactly.

### Why there is no beam

Two earlier attempts at this are on the record and both failed the same way:

- *"A coarse dedupe grid collapsed the frontier onto 'do nothing' and it never
  left the start line."*
- *"A top-N-by-x beam filled with the fastest states, which all crashed into the
  same wall and made passable terrain look impassable."*

Both are one mistake: **selection pressure on a single scalar destroys the
diversity a search needs.** So there is no beam here and no truncation at all.
The frontier is a priority queue, and the only thing ever discarded is a node
another node already dominates *in the same state cell* — where a cell is
position, velocity, chassis attitude, rider-arm attitude, contact state, facing
and the set of apples collected. Two states share a cell only when they are
genuinely the same situation; a slow one and a fast one never do.

The key is one integer rather than a string because the search computes millions
of them, and the product of the ranges is checked against 2^52 at setup so the
arithmetic stays exact.

### Progress is not x-position

It is distance along a *route*, and the route is a choice.

**The map.** `field.ts` builds a uniform occupancy grid over the level with a
clearance value per cell, and a geodesic distance field per apple and for the
flower. Straight-line distance is worse than useless in a cave: an apple three
metres away through a metre of rock reads as nearly reached, and a heuristic
that says so drives the search into the rock and keeps it there.

**Apple order** is a depth-first search over "which apple next", nearest-geodesic
first, with backtracking and with failures memoised on the arrival node — without
that memo the backtracking walks straight back into work it has already done, and
on 13-reservoir it spent the same 45 000 expansions failing at the same apple
three times over.

**How hard to try** is a ladder of strategies, and the ladder is a record of what
was measured rather than a design:

| | what it does | why |
|---|---|---|
| `whole` | one search over the leg, greedy (h×1.7) | cheap, and enough for most legs |
| `carry` | h×1.2 plus **momentum credit** | the one that clears gaps |
| `patient` | h×1.08, big budget | for legs where greed threw away the run-up |
| `segmented` | the leg cut into 14 m pieces | precision at one specific obstacle |

**Momentum credit is the interesting one.** A gap that has to be cleared at a
particular speed is a question about the *run-up*, and both of the obvious
priorities get it wrong: a greedy weight prefers the state nearer the far lip to
the state that will still be moving when it arrives, and plain Dijkstra explores
every way of being slow first. Crediting closing speed — how fast a node is
eating route distance, measured against its own parent — says "keep carrying
speed" in the only currency a frontier understands. Measured on 13-reservoir,
whose two pits are 8 m and 12 m across:

| | first pit | second pit |
|---|---|---|
| greedy (h×1.7) | 117 000 expansions | never |
| Dijkstra-ish (h×1.08) | 13 500 expansions | never |
| **momentum (h×1.2, +20)** | **8 600 expansions** | **20 700 expansions** |

Segmenting a leg into fixed distance thresholds was the *first* thing tried and
it was a mistake as a default. It does what it promises — the hard bit gets a
fresh dedupe archive and a full budget instead of arriving at a saturated one —
but every segment boundary is a place the search stops, and a bike handed
forward through six of them has been asked six times to arrive rather than to
keep going. Across the set it cost more levels than it won: 03-mind-your-head
solves whole and does not solve segmented at all. It stays last on the ladder
because the thing it is good at is exactly what the first three are bad at.

### Reaching an apple is not the same as still riding

The first version reported a level uncompletable for a reason worth writing
down. Pickup tests the head, the chassis and both wheels, so the fastest way to
touch an apple a metre off the floor turns out to be **the rider's head on the
way round a backflip**. The search duly "reached" it, handed the next leg four
arrival states that were each a tenth of a second from planting the head, and
every one died within two expansions. The frontier emptied and the level was
declared impossible.

So a goal only counts if some simple continuation survives it — any single held
mask, for 40 input frames. It does not have to be the continuation that gets
used; this is a viability filter, not a plan. It is also a **preference and not a
veto**: a search that finds only goals nothing simple survives returns those
rather than reporting failure, because a veto here is how a low-ceiling level
becomes unsolvable — every arrival under a roof fails a probe that does not know
the one input that gets you out.

### When the map is wrong, stop believing it

The occupancy grid is deliberately optimistic. It answers "does a disc fit
here", which is the right question for a bike that can be anywhere in the air
and the wrong one for "can a bike *get* here" — so it will happily route
straight up a three-metre wall, because there is air above the wall.

On 17-backswing that costs the level. A 3 m block two metres wide sits at the
end of the start platform; the apple behind it is 31 m away through the block
and 200 m away the long way round, so every strategy spends its whole budget
failing to climb it. No amount of searching finds the real route while the
heuristic is pointing at the wall.

So when every strategy stalls in the same place, the solver walks *downhill on
the distance field* from the stall point — which is exactly the route the
heuristic was pointing at — blocks a corridor along it, recomputes that target's
field and tries again. It is the search correcting the map with what it learned.
Blocking the stall point alone does not work, and the failure is instructive: the
bike stalls standing on the platform *next to* the wall, so blocking where the
bike is blocks the platform, the field re-routes half a metre over, and aims at
the same wall again. What has to stop being a route is the route.

A re-route is refused if it would make the target unreachable, which is the
failure mode that would turn an honest "could not" into a false "cannot".

### The answer on the twenty levels

**19 of 20, and all three of the levels `bin/level-drive` called uncompletable
are completable.** The pilot was simply too weak. Every run below is a real
input stream that re-simulates from scratch to a finished, living bike, and is
saved beside this README in `replays/` as `<level>.solve.replay.json` — watch
one with `bin/replay replays/13-reservoir.solve.replay.json` or load it in the
client with `L`.

Measured on one box, seven workers, a 20-minute cap per level; `search` is that
level's own wall clock, not the wall clock of the set.

| level | | time | score | precision | clearance | effort | lethality | head clearance | search |
|---|---|---|---|---|---|---|---|---|---|
| 03 Mind Your Head | ok | 35.0 s | **56** | 0.07 | 0.98 | 0.76 | 1.00 | 0.014 m | 113 s |
| 08 Needle | ok | 27.7 s | **55** | 0.20 | 1.00 | 0.54 | 0.89 | 0.001 m | 48 s |
| 07 The Chimney | ok | 47.1 s | **51** | 0.04 | 0.94 | 1.00 | 0.41 | 0.041 m | 841 s |
| 06 Two Doors | ok | 68.3 s | **48** | 0.04 | 0.93 | 0.56 | 0.90 | 0.049 m | 58 s |
| 12 Whoops | ok | 62.6 s | **48** | 0.03 | 0.94 | 0.69 | 0.73 | 0.040 m | 156 s |
| 20 Close Quarters | ok | 108.9 s | **43** | 0.07 | 0.95 | 0.57 | 0.50 | 0.037 m | 155 s |
| 10 Cathedral | ok | 96.3 s | **42** | 0.01 | 0.87 | 0.70 | 0.41 | 0.089 m | 296 s |
| 05 Airtime | ok | 25.5 s | **41** | 0.01 | 0.91 | 0.30 | 1.00 | 0.061 m | 5 s |
| 14 Kicker | ok | 73.0 s | **39** | 0.02 | 0.81 | 0.63 | 0.44 | 0.133 m | 184 s |
| 18 Double | ok | 38.3 s | **39** | 0.03 | 0.77 | 0.45 | 0.74 | 0.162 m | 17 s |
| 19 Low Roof | ok | 93.7 s | **39** | 0.03 | 0.86 | 0.37 | 0.80 | 0.097 m | 23 s |
| 04 Switchback | ok | 72.6 s | **36** | 0.04 | 0.52 | 0.62 | 0.58 | 0.333 m | 109 s |
| 17 Backswing | ok | 113.3 s | **36** | 0.01 | 0.96 | 0.61 | 0.11 | 0.029 m | 164 s |
| 09 Runaway | ok | 45.3 s | **35** | 0.03 | 0.51 | 0.50 | 0.73 | 0.346 m | 63 s |
| 13 Reservoir | ok | 53.1 s | **35** | 0.02 | 0.61 | 0.66 | 0.35 | 0.270 m | 119 s |
| 11 Downhill | ok | 27.2 s | **33** | 0.00 | 0.61 | 0.35 | 0.77 | 0.274 m | 9 s |
| 15 Feather | ok | 44.6 s | **31** | 0.00 | 0.71 | 0.44 | 0.38 | 0.204 m | 27 s |
| 01 First Light | ok | 13.7 s | **20** | 0.01 | 0.08 | 0.34 | 0.65 | 0.645 m | 4 s |
| 02 The Long Climb | ok | 17.6 s | **8** | 0.00 | 0.15 | 0.15 | 0.10 | 0.593 m | 2 s |
| 16 One Way | **unsolved** | — | — | | | | | | 1200 s |

The ordering reads right. The two tutorials are at the bottom with room to
spare; the top of the table is the low-roof set — 03, 08, 07 — where the head
passes within a centimetre or two of rock and a one-frame slip kills you a fifth
of the time on 08-needle. 02-the-long-climb scoring 8 is honest rather than
flattering: it is a wide corridor with a gentle climb and the solver walks it in
593 expansions.

**Times are not competitive times.** The solver finds *a* run, not a fast one —
a weighted A* on frames stops at the first thing that works. 17-backswing's
113 s is a lap of a level a person would ride in well under a minute. Optimising
the found line is a separate job and a much easier one, because it starts from a
solution.

**16-one-way is the one it cannot do.** It gets within 8 m of apple 6, having
collected five. The level's name is the diagnosis: apples 3 and 4 sit six metres
apart vertically at the same x, and the drop between them is one-way, so the
route has to commit to the right hole on the way past and the solver keeps
arriving at the wrong one. That is a "could not", not a "cannot" — `bin/level-drive`'s
scripted navigator completes it, so a run certainly exists.

### Where it is weak

- **Failure is never proof.** Every unsolved report is "this search, with this
  budget, could not". The tool has been wrong in that direction twice already
  in its own short history — once for a three-frame minimum macro duration, once
  for an apple order that stranded an apple on an upper shelf — and both times
  the level was fine.
- **It is sensitive to the macro alphabet.** One entry in `DURATIONS` is the
  difference between 13-reservoir being completable and not. A level needing a
  take-off timed finer than 16 ms would be reported uncompletable and the report
  would be wrong.
- **The map does not know about gravity.** The occupancy grid answers "does a
  disc fit", so it routes up walls. The re-route mechanism repairs that when the
  search proves it wrong, but it repairs it *slowly*, a corridor at a time, and
  each round costs a search.
- **Apple order is a greedy DFS with a tier rule, not a solver.** It tries three
  targets per step, prefers apples at or above the bike's own height, and
  memoises failures. That is enough for these twenty and it is not a route
  optimiser; a level with a genuinely non-obvious order could defeat it.
- **Cost is real.** One to four minutes for a typical level on one core, 14
  minutes for the worst of these twenty, ~60 minutes of CPU for the set. This is
  a tool you run over a level set or a generator batch, not one you put in CI.
- **Memory grows with the search.** A hard level holds 300-600 MB of nodes by
  the end, and nothing is reclaimed within a level, because the mask chain back
  to the start has to stay walkable.

### Difficulty, measured from the search

A difficulty number must come from what the search *experienced*. Apple count,
level length and polygon count are properties of a file; they say nothing about
whether a level is hard, and a generator optimising against them would learn to
make long boring levels.

| component | weight | what it measures |
|---|---|---|
| **precision** | 0.40 | of 200 one-frame nudges to the winning stream, the fraction that **kill** within 1.5 s |
| **effort** | 0.25 | node expansions per metre of route, logged |
| **clearance** | 0.20 | the smallest gap between the rider's head and rock anywhere on the line |
| **lethality** | 0.15 | deaths per expansion during the search |

The precision measure is the one worth arguing about, because the obvious
version of it is wrong. "Does the perturbed stream still finish the level" was
tried first and is not a difficulty measure at all: a deterministic bike is
chaotic, so nudging one boundary near the start makes everything downstream a
different run, and the finish rate mostly reports how *long* the stream is. On
that measure 01-first-light scored 0.89, above levels nobody finds hard. Death
within a bounded horizon of the nudge is local, is comparable between a
14-second level and a 100-second one, and is what a player actually feels: on a
hard level a slip kills you, on an easy one it just means you come up short and
go round again. The whole-run finish rate is still reported, because it is
interesting, but it is not weighted.

**What this is not.** It is not a claim about how hard a *human* finds a level —
nothing here models learning, reading a level, or nerve. It measures how narrow
the successful corridor is and how much work it took to find, which is what a
generator needs to filter on and what an editor can show live. A level whose
solution only a solver would find scores high and may simply be bad; the number
is a flag to go and look, not a verdict.

The `effort` component also depends on the solver's own parameters, so scores
are comparable **within a run** and not across solver versions. `precision`,
`clearance` and the raw measurements behind them do not have that problem.

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
- **`style` is an optional, purely cosmetic block** — a palette name, a theme
  tag, explicit colour overrides, non-colour look parameters, and room for art
  hints nobody has thought of yet:

  ```json
  "style": { "palette": "concrete", "theme": "industrial",
             "colors": { "solid": "#26214d" },
             "variant": { "panelW": 2.6, "wedgeCount": 3 } }
  ```

  It is honoured now. **A level that says nothing gets a palette and a look
  derived from its own `simHash`**, which is what makes twenty levels twenty
  places with no hand-authoring; `style.palette` naming a palette this build
  ships wins over the derivation, `style.colors` overrides individual slots on
  top of either, and `style.variant` overrides the non-colour parameters. A
  malformed override — a colour that is not `#rrggbb`, a variant field that is
  not a finite number — is **ignored rather than fatal**, and an out-of-range
  variant field is clamped. A cosmetic hint must never be able to stop a level
  loading or hand the renderer a value that costs the frame. Unknown keys inside
  it are carried through untouched, like `zones`.

  **`style` is not part of `simHash`, and that is the whole point.** If it were,
  recolouring a level would re-identify it and wipe its leaderboard — exactly the
  bug the two-hash split exists to prevent, arriving through the one field most
  likely to be edited for reasons that have nothing to do with how a level plays.
  `src/sim/level.test.ts` asserts that adding and changing `style` leaves
  `simHash` bit-identical while moving `contentHash`.
- **`provenance` is an optional block recording where the level came from** —
  who or what made it, and how to make it again:

  ```json
  "provenance": { "source": "generated", "generator": "velogen 0.3", "seed": 918273 }
  ```

  It ships as a **slot**, before there is anything to put in it, for the same
  reason the arc primitive and `style` did. AI level generation is on the
  roadmap, and the moment authored and generated levels mix in one directory
  "which of these did a machine make, and can I regenerate it" becomes
  unanswerable unless the field already existed — the information is not
  recoverable afterwards, because nothing else records it and nothing can
  reconstruct it. Absent means UNKNOWN, which is the honest answer for every
  level authored before the field existed; the twenty are deliberately not
  backfilled.

  `source` is deliberately **not an enum**. A generator that does not exist yet
  will want a value this build has never heard of, and rejecting it would let a
  metadata field stop a level loading. The loader validates the SHAPE only, and
  carries unknown keys through.

  **It is not in `simHash` either.** Two runs of a generator that land on
  identical geometry are the same level as far as a leaderboard is concerned, so
  recording a different seed beside them must not fork their times. It is in
  `contentHash`, because it is content. Parsed and otherwise ignored in this
  phase: no behaviour, no UI, no rendering.
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
pivot, shipped together because neither ever escaped on its own. So did rev 4 —
splitting that inertial reaction into a brake half and a drive half. `SIM_REV`
is now **4**, and earlier revs' code is not kept. Note what counted as a physics
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
src/shared/         the two things BOTH halves have to agree about and neither
                    may own: appearance.ts is the cosmetic catalogue (six bikes,
                    ten liveries, the accessories) plus the tolerant parser and
                    the stable per-playerId derivation — the client draws from
                    it, the server validates against it, and NOTHING in it can
                    reach BikeSpec; claim.ts is the cross-device claim URL and
                    the typable code. Like src/sim it imports nothing, touches
                    no DOM and reads no clock, for the same reason: one copy is
                    how the two sides stay in step.
src/solver/         the headless solver. field.ts is the level as a MAP
                    (occupancy grid, clearance, geodesic distance fields);
                    search.ts is the macro-action best-first search and its
                    dedupe archive; solve.ts is the apple order and the
                    route-progress segmentation; difficulty.ts turns what the
                    search experienced into a number; pack.ts is a SimState as
                    flat doubles. It imports src/sim and nothing imports it, so
                    the sim's isolation rule is untouched and no search ever
                    reaches the client bundle. measured.ts is the exception and
                    is not code: a GENERATED table of difficulty scores, keyed by
                    simHash and sim rev, which the chooser reads and
                    bin/difficulty-import writes.
src/client/         canvas renderer, input, tuning panel, record-and-replay
                    camera.ts is the play framing; overview.ts is the wide view,
                    the freeze and the opening peek; markers.ts is the off-screen
                    indicators. The last two are pure state and geometry so they
                    test in plain node.
                    art/bikeart.ts is the bike as DATA — the six silhouettes,
                    the wheel treatments, the helmets and jackets, and the
                    arithmetic that solves a colourway against a level's own
                    palette so a player CANNOT pick something invisible. It
                    imports BikeSpec as a type only, so the art can read a spec
                    and can never build or edit one. avatar.ts is that same
                    drawing code at 46 px, cached per livery per palette, which
                    is what puts a person on a leaderboard row; lookui.ts is the
                    customiser panel and qr.ts is a hand-rolled QR encoder,
                    checked module-for-module against an independent one;
                    claimui.ts is the panel that shows it.
                    ghost.ts is the second sim that rides beside you, the
                    rules for choosing whose run it is (human runs only) and
                    watchableCategory, which is why a TAS line has no route to a
                    screen at all; identity.ts is the
                    device-local playerId and the honest note about what it is
                    not; api.ts is the leaderboard wire, and every call in it
                    degrades to "offline" rather than failing; boardui.ts is
                    the panel.
                    results.ts is what the end-of-level screen DECIDES — the PB
                    comparison, the refusal-to-plain-words mapping, the rows and
                    the action list with its key bindings — and tests in plain
                    node; resultsui.ts is the only half that touches the DOM.
                    montage.ts is which attempts ride at once, how faint the
                    crowd is drawn and which of them are worth drawing at all:
                    arithmetic over plain objects, no sim and no DOM. The riders
                    themselves are ghost.ts's createRider, which is the
                    primitive under both a leaderboard ghost and a montage
                    rider, so the "it cannot touch the player's run" argument is
                    made once.
                    chooser.ts is what the level chooser LISTS — grouping,
                    ordering, best times and the measured rating, decided over
                    plain objects and tested in plain node; chooserui.ts is the
                    only half that touches the DOM; thumbs.ts renders a level
                    into a small offscreen canvas, one per animation frame, and
                    caches it by simHash. hudmode.ts is the one rule the debug
                    readout's on/off switch must not break: which warnings
                    survive being hidden.
                    touch.ts is the phone: where the thumb zones are, which one
                    a touch is in, and what bitmask a set of held zones makes —
                    all DOM-free and tested in plain node — with the elements
                    and the pointer handlers underneath. It emits nothing but
                    the sim's own IN_* bits and reaches the sim through
                    input.mask(), so a touch run and a keyboard run are the same
                    bytes.
src/server/         Hono, the published bundle, and the leaderboard.
                    board.ts is the board as ARITHMETIC — placement, ranks, the
                    entry above you — with no filesystem in it, so it tests in
                    plain node. store.ts is the only file that touches a disk;
                    mutex.ts serialises writes per level; queue.ts runs
                    verification off the request handler with a budget;
                    limits.ts is every cap in one screen; runs.ts is the
                    submission pipeline; api.ts is the routes.
src/client/audio/   the sound. params.ts is the panel's knobs; model.ts is the
                    whole of the feel as PURE numbers (sim state -> synth
                    parameters) and tests in plain node; engine.ts is the
                    WebAudio graph and the only browser-only file; sample.ts is
                    the one place that touches the sim, and it only reads;
                    index.ts is the lifecycle — the gesture gate, mute, and
                    suspending a hidden tab.
src/client/art/     the art direction. geom.ts (edge classification and hazard
                    corners), palette.ts, params.ts, rng.ts and stencils.ts are
                    DOM-free and tested in plain node; bake.ts builds the
                    world-space Path2D geometry and is the only browser-only
                    file. artrender.ts beside them is the per-frame draw.
bin/                every operational task
levels/             exported level JSON
```

`bin/` also holds underscore-prefixed modules that are imported rather than run:
`_board.ts` and `_submit.ts` (the leaderboard tools),
`_smoke.mjs` (the headless Chrome driver), `_audiobench.mjs`, `_sag.ts` (the coarse-run metric,
shared by `bin/level-check` and `src/sim/curvelevel.test.ts`), `_pilot.ts` (the
scripted rider), `_solve.ts`, `_solve-run.ts` and `_solve-worker.ts` (the
solver's CLI, the one-level-and-score routine both the in-process and worker
paths call, and the worker itself), `_slope.ts`, `_air.ts` and `_dive.ts` (the
measurement rigs), and `_replay.ts`. The rigs build their own synthetic levels rather than using
anything in `levels/`: a measuring instrument needs one feature at a known place
with known dimensions, which is the opposite of what a level is for.

One npm package, npm not pnpm, no workspace. Tests are vitest and colocated
(`src/sim/rot.test.ts` beside `src/sim/rot.ts`); there is no jsdom and no
`@testing-library`, so every test runs in plain node. Test pure functions, never
rendering.

`localStorage` appears in two client tests and there is still no jsdom: it is a
three-method interface, so a `Map` stands in for it exactly — including the case
that matters, which is an implementation that **throws** on access (a private
window, blocked site data) rather than returning null. Every access in the
client is wrapped for that reason, and `identity.test.ts` asserts the game still
boots when storage is gone.
