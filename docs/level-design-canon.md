# The level-design canon, read for Velo

What twenty years of Elasto Mania level-making knows, translated into things
*our* bike can be asked to do, and into two numbers a generator can be filtered
on.

**The boundary.** Everything here is design knowledge in prose: techniques,
pacing, structural ideas, what the community argues about. No geometry was
acquired, no `.lev` file was opened, no coordinate was transcribed, and nothing
below could be pasted into `levels/`. Their tolerances would not transfer
anyway — Velo's bike is 1.7 m long on 0.25 m wheels and tops out near 12 m/s on
the flat, and a gap that is a stretch in Elma is a different gap here.

**Read first, if you are only reading one thing:** §1 (unclaimed lessons — the
generation targets), §2 (depth is not difficulty, and our set is shallower than
it is hard), §3 (the similarity metric, which has already been validated against
21-rollers).

---

## 1. The unclaimed lessons — the generation targets

These are entries in the taxonomy (§5) that **no level in `levels/` asks for**,
that **rev 4 can actually do**, and that are **not variations on something we
already ship**. Ordered by what I judge to be the value-to-effort ratio.

| # | Lesson | What it asks | Why it is not just a reskin of what we have |
|---|---|---|---|
| U1 | **Pump a roller to make the gap** | A rhythm of convex ground where lean timing against the terrain adds speed, ending in a gap that is not clearable at arrival speed | Measured: rev 4 gains **+1.24 m/s** on coasting rollers from `attitudeTorque` alone, and hill-pump-gap clears **4.25 m** against a no-pump baseline. We have never taught this and 09-runaway deliberately *suppresses* it. This is the single biggest piece of latent vocabulary. |
| U2 | **The wall-pop reversal** | Carry speed into a vertical face, let the impact and the suspension stop you, flip, and leave with usable speed the other way | Elma's own vocabulary calls this *braking at walls to "change motion energy from one direction to another and gain speed back the other way"*. We have flips (04, 07, 16) but every one is a *slow* turnaround; none converts direction into speed. Support pending the mechanics probe. |
| U3 | **Close descending S-curves** | A chain of alternating concave/convex arcs going downhill, tight enough that each transition re-aims the bike and each concave compresses the suspension | 12-whoops is *rolling ground at a steady height*; 09-runaway is *arcs too large to launch you*. Nothing in the set is a descending alternating chain where the compression on the inside of each dip is the hazard. Canon family: New Wave, Zig-Zag, Curvaceous, Serpents Tale. |
| U4 | **The timed reverse** | A flip that is only correct inside a window — flip at the apex so you land on the driven wheel, or flip mid-drop so you arrive pointing at the exit | Our flips are all "flip when you have stopped". Flip is free, instant and legal mid-air, and it **changes which wheel is driven**; nothing in the set makes the *timing* of that matter. |
| U5 | **Jump under a roof** | A gap that must be crossed on a flat trajectory because a ceiling is over the flight path, so the usual answer (more speed, more arc, lean back) kills you | We have low roofs (03, 19) and we have gaps (05, 13, 14, 18), and we have never crossed them at the same time. Directly answers the user's "a ceiling that forces you low through a gap where volting would kill you". |
| U6 | **The confined landing** | Drop into a pit whose roof is low, where the suspension rebound after landing is what kills you rather than the descent | Uses the asymmetric damping we deliberately built (low rebound = pop) as a *hazard* for the first time. |
| U7 | **Brake-to-climb** | A face too steep to power up, where the answer is brake plus lean, using the brake to hold the nose down while rotation walks the bike up | Elma lists climbing as "skilful brake and volt usage **simultaneously**". Our brake is barely pressed anywhere (§6): the highest brake fraction on any winning line in the set is 8 %, and on 15-Feather — whose stated lesson *is* the brake — it is **1 %**. |
| U8 | **The apple that denies the shortcut** | A wide-open fast line exists, and one apple sits off it in a place that costs exactly enough to make the choice real | This is the canon's *stated* purpose of food — "use apples in places you want the player to go, so he can't use a shortcut". Our apples are mostly waypoints on a single line (§4). |
| U9 | **The short-but-slow shortcut** | Two routes where the *shorter* one is the *slower* one, so distance is not the cue | Straight from a levelmaking thread: "levels with big shortcuts that are shorter but slower than the long way". 13, 18 and 04 all have bail-out routes, but in each the slow route is also the long one, so the decision reads as "safe vs fast" rather than as a genuine puzzle. |
| U10 | **Traction, not power** | A grade near the friction limit where full throttle spins the wheel and less throttle climbs | The wheel has real inertia and a Coulomb patch at µ=1.4; wheelspin exists and has never been the subject of a level. |
| U11 | **A crest under a ceiling** | Climb where leaning back to climb is exactly what puts the head into the roof | 19-low-roof's lesson is "the ground in front of the roof is the problem", but it never combines that with a *climb*, where the lean is not optional. |
| U12 | **Over-rotation punished** | A kicker steep enough that full throttle backflips you, so the throttle must be released on the lip | The bike backflips under sustained drive torque and the set never charges for it. |
| U13 | **The one-pass combination** | Three or four collectibles each trivially reachable alone, arranged so that a single continuous line through all of them is much harder and much faster | This is what 21-rollers does by accident (§8) and it is the thing the user actually described liking. It deserves to be an explicit, repeatable generator template. |

Four more that are real lessons in the canon and that we should **not** generate
yet, with the reason: **hanging/hooking** and **upside-down riding** (a circle
cannot hook — settled, needs a grab state); **bunny hop** (settled, does not
exist); **killer objects** (planned, format reserves it, no sim support today);
**gravity flips** (format tolerates `zones`, sim ignores them — and the
community's own line is that gravity apples are "a weakness in the design", so
this is low priority even once supported).

---

## 2. Depth is not difficulty, and our set is shallower than it is hard

The user's own framing: *"the apples are tough to reach (in one pass). easy to
get one at a time… doing all three required like 10-15 passes. and then that's
probably not even close to optimal so it's like… people keep pushing… it's like
the mechanics. not the length."*

Two independent axes:

- **Difficulty** — distance from *arriving* to *completing*. This is what
  `bin/solve` already measures: precision, clearance, effort, lethality.
- **Depth** — distance from *completing* to *mastering*. Nothing measures it.

A level can be savage and shallow (one line, execute or die) or gentle and deep
(21-rollers: every apple trivial alone, the one-pass line still unfound after a
dozen attempts, and the player believes a better one exists). The canon's own
explanation for why fifty-four levels from the year 2000 are still being ridden
is entirely a depth argument: *"Time improvements have often shown to rely on
finding new ways to solve the levels. Advancement also relies on polishing known
styles."* New routes, then polish. Not difficulty.

### 2.1 Two different sources of depth — keep them apart

**Route tension** is combinatorial: the convenient apple order is not the fast
one, so there is a decision to get right. **Line tension** is continuous: the
order is obvious, but taking apple *k* in the way that sets up apple *k+1* is
much harder than taking it on its own. 21-rollers has **zero** route tension
(its five apples are collected strictly left to right) and enormous line
tension. If we only chase route tension we will not reproduce the level the user
liked.

### 2.2 The uncomfortable table

Measured now, from the stored solve replays, by re-simulating each winning run
and comparing the apple order it took against the two orders a player would
reach for without thinking (left-to-right by x, and pure nearest-neighbour from
the start). `τ` is the fraction of apple pairs ordered differently — **0.00
means the level's apple layout admits exactly one sensible order.**

| level | τ vs left-to-right | τ vs nearest-first | route tension? |
|---|---|---|---|
| 17 — Backswing | 0.62 | 0.48 | **yes** |
| 06 — Two Doors | 0.52 | 0.33 | **yes** |
| 07 — The Chimney | 0.52 | 0.14 | **yes** |
| 10 — Cathedral | 0.44 | 0.40 | **yes** |
| 04 — Switchback | 0.39 | 0.32 | **yes** |
| 03 — Mind Your Head | 0.24 | 0.24 | some |
| 16 — One Way | *unsolved* | *unsolved* | designed for it; unverified |
| 01, 02, 05, 08, 09, 11, 12, 13, 14, 15, 18, 19, 20, **21** | **0.00** | **0.00** | **none** |

**Fourteen of our twenty-one levels lay their apples out in a line.** That
includes every level from 11 to 15 and every level from 18 to 20 — the entire
back half of the set except 16 and 17. The plan's founding claim that "apple
collection order is the player's choice — that route freedom is the depth" is
true of six levels and false of fourteen.

Two honest caveats. First, τ = 0 is a *layout* fact, not proof of no tension: an
out-and-back level (12, 19, 20) sweeps apples in one pass by construction and
could still hide a branch. Second, and more important: **the solver cannot
currently measure route tension at all.** `src/solver/solve.ts` picks apple
targets nearest-first with a finish-your-tier-first rule and backtracks only on
failure — so the order it reports *is* the convenient order by construction, and
the fast order has never been computed for any level in the repo. The table
above says "the convenient order is the only order the geometry offers", which
is the weaker of the two claims but still the damning one.

### 2.3 A depth suite — four measures, cheapest first

**D1 — Order tension (needs one small solver flag).** Add `bin/solve --order
2,0,3,1` forcing an apple permutation, and `--orders N` to sample N permutations
(the full set is `n!`, so sample: the convenient order, the reverse, and N−2
random ones, plus every order reachable by one adjacent transposition of the
convenient one). Report

```
orderTension = 1 − T(convenient order) / T(best order found)
```

0 means the convenient order is the best one. Anything above ~0.15 means there
is a decision worth making. This is the generator's **primary** acceptance test
for route depth, and it is the property to *design for*: place apples so that
the convenient order is slow.

**D2 — The optimality gap, as a decision problem (moderate cost).** The solver's
weighted A* stops at the first run that works, so `T_first` is a *ceiling*, not a
time. Re-run the same level with a lower `hWeight` and a frame budget of
`0.75 × T_first`, and ask only *"does a run 25 % faster exist?"* — a decision
problem is far cheaper than optimisation. Report `headroom25 ∈ {yes, no,
unknown}`. A level where a big budget cannot beat its own first run by 10 % is
probably execute-or-fail. A level where 25 % falls out immediately has room for
people to keep pushing, which is precisely what was asked for.

**D3 — Line-carry (cheap).** For each leg *k* of the solved route, reload the
arrival state of leg *k−1*, **zero the velocity**, and re-solve leg *k*. Then

```
carry(k) = T(leg k | stopped entry) / T(leg k | real entry)      (∞ if unsolvable)
lineTension = median_k min(carry(k), 4)
```

This is the direct measurement of *"easy to get one at a time, hard in one
pass"*. A level where every leg is as easy from a standstill has no line
tension; a level where the legs only work with inherited momentum has a lot. My
prediction, stated in advance so it can be scored: 21-rollers will come out high
on D3 and near zero on D1, and 13-Reservoir/14-Kicker will come out moderate on
D3 and zero on D1.

**D4 — Time spread under perturbation (nearly free).** The difficulty pass
already nudges the winning input stream by one frame, 157 times, and records
whether the run dies and whether it still finishes. Also record the **finish
times** of the survivors. Wide spread = the line is not on a knife edge and
there is room to be better; every survivor finishing within 1 % = there is one
line and you are on it. This costs one extra field in an existing loop.

**Composite.** Report `depth` as a 0-100 number *beside* `difficulty`, never
folded into it — they must be separately visible in the chooser and in the
generator's filter, because the whole point is that they are different axes.
Suggested weights, to be recalibrated once D1-D3 have run on the set:
`0.35·orderTension + 0.35·lineTension + 0.20·headroom25 + 0.10·timeSpread`.

---

## 3. Detecting "same same same same" — a similarity metric that already works

### 3.1 The idea

Two levels are the same level when they **ask the same thing**, not when their
polygons resemble each other. So the metric must be computed from the *run*, not
from the map. The Elma community reached the same conclusion independently:
Elmanager, the community's replay tool, compares replays by *"appletakes / left
volts / right volts / supervolts / turns / groundtouches"* — a control-and-contact
fingerprint, exactly this family of statistic.

### 3.2 Layer 1 — the control fingerprint (implemented and measured)

Twelve scalars, extracted by re-simulating a verified replay (seconds per level,
no search):

| feature | what it separates |
|---|---|
| `airFrac` | fraction of input frames with neither wheel down |
| `thrFrac`, `brkFrac`, `leanFrac` | how much of the run each control is *held* |
| `thr100`, `brk100`, `lean100` | *presses* per 100 m — rhythm, not duty cycle |
| `flip100` | direction reversals per 100 m |
| `gt100` | ground-touch events per 100 m (landings) |
| `maxSpeed` | the speed band the level lives in |
| `detour` | route metres ÷ x-span — how much of the level is doubling back |
| `backFrac` | fraction of route travelled in −x |

Z-normalise each column over the corpus, then `dist(A,B) = ‖z(A) − z(B)‖ / √12`.

### 3.3 It has already been validated, and the validation is the headline

Measured over the 19 solved hand-authored levels plus 21-rollers (190 pairs):

```
min 0.387    p5 0.740    p25 1.052    median 1.255    max 2.966
```

The **closest pairs** it finds, unprompted:

| distance | pair | is that right? |
|---|---|---|
| 0.387 | 13 Reservoir ~ 14 Kicker | yes — "height is stored speed" and "a curved lip converts speed to height" are the same lesson twice |
| 0.481 | 11 Downhill ~ 15 Feather | yes — both are low-throttle landing-management levels |
| 0.537 | 06 Two Doors ~ 19 Low Roof | yes — both are out-and-back at moderate speed |
| 0.593 | 03 Mind Your Head ~ 09 Runaway | plausible — both are steady-speed ground-contact levels |

And **21-rollers**, the level nobody curated and the user liked most, sits
**1.924 from its nearest neighbour** — five times the closest pair in the set,
and above the 95th percentile of the entire distance matrix. Its fingerprint is
unlike anything hand-authored: `leanFrac 0.60` (next highest 0.45), `flip100
34.6` (next highest 15.1), `gt100 22.0` (next highest 14.0), `maxSpeed 7.6`
(the lowest in the set), 76 % of its frames spent between 3 and 6 m/s.

**The metric independently picked out the one level we already know was
novel.** That is the evidence that it is measuring the right thing.

### 3.4 Thresholds, calibrated on our own set

- **Novelty floor τ = 0.75** (the 5th percentile of the existing matrix).
  Reject any generated level within 0.75 of *any* level already accepted. This
  is defensible because it is derived from a set the user has already agreed is
  varied: it says "no closer than the closest pairs we already tolerate".
- **Duplicate floor 0.39** (the observed minimum). Anything below this is the
  same level twice and should be dropped without a human ever seeing it.
- Always report each candidate's **nearest existing neighbour and the
  distance** — "this is 0.52 from 12-Whoops" is far more useful to a curator
  than a pass/fail.

### 3.5 Layer 0 — a geometry prefilter, because solving costs minutes

Solving 70 candidates is ~2.5 hours of CPU, so kill the obvious twins before
paying for them. From the level JSON alone, with no sim: a histogram of floor
slope by arclength; a histogram of corridor height (floor to the nearest ceiling
above it, sampled along the floor); a gap-length histogram; apple spread and
collinearity; level aspect ratio; and the fraction of floor with a roof under
3 m. Cosine distance over the concatenated histograms. Anything under ~0.1 from
an accepted level is a near-twin — drop it unsolved.

### 3.6 Layer 2 — the beat string, for when Layer 1 saturates

Layer 1 is a bag of statistics: it cannot tell "jump, duck, climb" from "climb,
duck, jump". When the generator starts producing levels that pass Layer 1 by
shuffling the same beats, add this. Segment the winning route into typed beats
using events already visible in the trace:

- `A` air beat (takeoff → landing), tagged short/long and with/without a flip
- `G` ground beat, tagged by mean slope sign and by whether speed rose or fell
- `T` tight beat (head clearance < 0.4 m sustained)
- `R` reversal (facing flip while grounded)
- `P` apple pickup

Compare two levels by normalised Levenshtein distance over their beat strings.
Combine as `0.6·layer1 + 0.4·beatEdit`. Do not build this until Layer 1 stops
discriminating — it is more code and Layer 1 is already working.

### 3.7 Curation: maximin, not thresholding alone

Given 70 solved candidates, do **greedy maximin selection**: repeatedly accept
the candidate whose *minimum* distance to everything already accepted (including
levels 01-21) is largest, subject to (a) difficulty-band quotas so the set still
ramps, (b) depth floors from §2, and (c) a **per-template cap** — the generator
will have a handful of parametric templates, and six seeds of one template are
six of the same level however the statistics fall. Track the template and seed
in `provenance` and cap each template at three or four accepted levels.

### 3.8 Known weaknesses, stated plainly

- The fingerprint describes **the solver's route**, and the solver finds *a* run,
  not *the* run. On a level with genuine branches its choice is close to
  arbitrary. Mitigation: once D1 exists, fingerprint the *best* order's run.
- `flip100` and `lean100` partly measure solver style rather than level demand —
  the solver flips freely because flipping is free. 21-rollers' 34.6 flips/100 m
  is a real signal about the level *and* partly an artefact of a search that
  happily swaps the driven wheel every few metres. Treat single-feature outliers
  as a prompt to go and look, not as a verdict.
- Nothing here measures *aesthetics*. A level can be statistically novel and
  still be ugly nonsense. The solver is a gate, not a judge; the user is the
  judge, and the metric's job is only to make sure the seventy things they look
  at are seventy different things.

---

## 4. What the community says separates a great level from a tedious one

Sources are linked in §11. Where the community disagrees I have said so. A large
part of the deep forum material (Mopolauta threads, the Elma Online wiki, the
Fandom wiki) is behind Cloudflare and could not be fetched directly; what is
quoted below came through search indexing of those pages, so treat single
sentences as reported rather than as verified in context.

**Length.** The one hard number the community states: *"The majority's opinion of
the suitable length for a hoylable level is 30-80 seconds."* Relaxed "cruise"
levels run 2-3 minutes. Another designer, in a levelmaking thread, argues for
30-45 s. **But this is a competition-format number, not a design principle** —
it is about what fits a battle slot. The user has explicitly told us to drop
length as a framing, and they are right to: 21-rollers is 14 s and has more in it
than several of our 90-second levels.

**Openings.** *"Falling down for 10 secs isn't interesting, neither is plane
ground. Put something there."* And: players spend about **two seconds** deciding
whether to keep playing a level. That is the community's independent statement of
the user's "2 second click and ditch" — the first two seconds are the whole
audition. Our own rule — *in a die-and-retry game you pay for empty distance on
every attempt* — is the same instinct pointed at the middle of the level rather
than the start. **They agree with us and they add a rule we lack: the cost is
front-loaded.** Whatever a level is going to ask, it should start asking inside
two seconds.

**Polish versus challenge.** The canon warns against over-refining: keep *"a good
balance; make it ergonomic and fun to play but still hard to drive perfectly"*.
The level should be smooth enough that a good line feels good, and not so
smoothed that every line is equally good. This is a real tension with our
habit of filleting every crest.

**What marks a beginner's level** — a genuinely useful list, because it is a list
of things a naive generator will do:
- *"Excessive big downhills, loops, and speed-focused design"* — seems cool, ages
  badly, and is exactly what a parametric generator finds easiest to emit.
- **Overuse of gravity apples** *"indicates weak underlying design"*; the stronger
  form is *"usually, if there is gravity in a level, it means that there is some
  weakness in the design"*. Not our problem yet, and a reason not to rush zones.
- Invisible or unreadable geometry that surprises the player mid-jump.
- Holes too small for a wheel to enter — the canon calls this a specific
  etiquette failure, and it is a concrete geometric validity check a generator
  should run: **no pocket narrower than the wheel diameter that the route can
  reach.**

**Difficulty versus precision.** I could not find the community stating this as a
rule in as many words, and I am not going to invent a quotation. What they *do*
say, repeatedly, is that a level's value lies in *"finding new ways to solve"* it
and then in polishing a known style — which implies the same ordering our own
plan already asserts (*"the best hard levels ask a new question rather than
tighten a tolerance"*), but it is our formulation, not theirs.

### 4.1 "More than a 2 second click and ditch" — what gives a level staying power

This is the user's quality bar and it is the sharpest thing said about level
design in this project so far. The canon's answer to *why are people still riding
these levels after twenty years* has three parts, and none of them is difficulty:

1. **The route is still contested.** *"Time improvements have often shown to rely
   on finding new ways to solve the levels."* A level with staying power is one
   where the community's idea of the correct route has changed more than once.
   Our D1 metric is a direct proxy for whether that is even possible.
2. **The line can always be polished.** *"Advancement also relies on polishing
   known styles."* There is a skill gradient with no top. Our D4 (time spread
   under perturbation) is the cheap proxy: if every survivor of a one-frame nudge
   finishes within 1 %, there is nothing left to polish.
3. **The physics keeps giving.** The community attributes the game's longevity to
   *"perfectly balanced and fine-grained physics that offers a world full of
   opportunities"* — techniques were still being discovered and named years after
   release (bounce, brutal volt, the various spins). **This maps directly onto
   the user's "it's like the mechanics, not the length"**: depth comes from the
   bike having moves the player has not found, and the level's job is to create
   situations where an unfound move is the answer. Which is §6.

One more idea, from a thread on escaping one's own levelmaking habits, that is
directly usable as a **generator template**: *"spam apples to an empty level and
make a level around it"*. Placing the demands first and deriving the geometry
second is exactly the inversion our architecture already wants (lesson and beat
structure → geometry), and it is the community's own remedy for sameness.

---

## 5. The lesson taxonomy

Forty-four situations a 2D bike game can ask of a player, assembled from the
canon's technique vocabulary (accelerating, turning, braking, pushing, volting,
hanging, jumping, bouncing, climbing, dropping, stretching, picking, brutal
volting, piping, gravity playing, killer avoiding) and from the shape of its
level set. Support is against **rev 4**, the live rev.

Legend — **✅** supported today · **⚠️** needs work (sim or format) · **❌** not
possible on this bike.

### Ground and traction

| # | Lesson | What it asks / what makes it hard | Usual presentation | Velo | Ours |
|---|---|---|---|---|---|
| 1 | Throttle on flat | Nothing; establishes the contract | Opening 20 m | ✅ | 01 |
| 2 | Graded climb | A climb is fair only where drive-out-pulls-gravity and momentum-suffices overlap | Ascending series, each grade steeper | ✅ | 02 |
| 3 | Brake-and-lean climb | Hold the nose down with brake while rotation walks the bike up a face too steep to power | A single steep face with no run-up | ✅ | **U7** |
| 4 | Traction limit | Full throttle spins; less throttle climbs | A loose-feeling steep grade | ✅ | **U10** |
| 5 | Descent where braking makes the next lip | Arriving too fast overshoots the only landing | Drop, then a short pad between hazards | ✅ | 15 (nominally; see §6) |
| 6 | Crest radius and launch | Above √(g·r) the crest throws you; below it, it does not | Long arcs of a chosen radius | ✅ | 09 |
| 7 | Rollers / whoops, stay grounded | There is no throttle in the air, so the fast line stays on the ground | A field of rolling ground | ✅ | 12 |
| 8 | **Pump the rollers** | Time lean against the terrain to *add* speed | Rollers ending in a demand | ✅ | **U1** |
| 9 | Climb under a ceiling | Leaning back to climb is what hits the roof | Ramp with a low soffit | ✅ | **U11** |
| 10 | Long flat travel | — | — | ✅ | *avoid: this is the empty-distance tax* |

### Air

| # | Lesson | What it asks / what makes it hard | Usual presentation | Velo | Ours |
|---|---|---|---|---|---|
| 11 | Flat-lip gap jump | Commit at speed; no correction once airborne | Ravine with rounded lips | ✅ | 05 |
| 12 | Curved lip converts speed to height | A quarter-pipe puts you *on top of* a thing, ~1.7 m above the lip here | A step that needs a ramp to beat | ✅ | 14 |
| 13 | Height is stored speed | Flat ground caps you; only a descent buys more | A hill above a gap, lip position is the puzzle | ✅ | 13 |
| 14 | Landing attitude | Nose down onto a downslope keeps speed; flat throws it away | Two kickers, one onto each | ✅ | 11, 05 |
| 15 | Doubles | Surviving jump 1 is not the test; arriving on jump 2's slope is | Pads separated by gaps, each pad a ramp | ✅ | 18 |
| 16 | Mid-air attitude control | Rotate to set the landing angle | Any long flight | ✅ | throughout |
| 17 | **Jump under a roof** | The arc is capped; volting into the ceiling kills | Gap with a soffit over the flight path | ✅ | **U5** |
| 18 | **Confined landing** | Rebound after the landing is the hazard, not the drop | Drop into a low-roofed pit | ✅ | **U6** |
| 19 | Long freefall with an arrival demand | Nothing to do for a second, then everything at once | Shaft with a shaped floor | ✅ | **unclaimed** (canon: *Freefall*) |
| 20 | **Over-rotation punished** | Sustained torque backflips the bike; release on the lip | A steep kicker | ✅ | **U12** |
| 21 | Wheelspin-assisted landing | Land on a spun-up wheel and be launched forward | A landing after a long flight with throttle held | ✅ | **unclaimed** |

### The head (our death sphere; Elma's killer clearance)

| # | Lesson | What it asks | Usual presentation | Velo | Ours |
|---|---|---|---|---|---|
| 22 | Gates / teeth | Duck: the head is 1.13 m up lying level | Descending series of roof heights | ✅ | 03 |
| 23 | Head position follows pitch | The ground *before* the roof is the problem | A hump under a roof | ✅ | 19 |
| 24 | Sustained pipe | Nowhere in it that is not close | A long tube with grades | ✅ | 08 |
| 25 | Roof on the landing side | You cannot arrive nose-up | Gap with a low far lip | ✅ | **unclaimed** |
| 26 | Piping proper (riding inside a tube) | Camera and reference frame both rotate | Circular section | ✅ geometry exists; ⚠️ untested | **unclaimed** |

### Direction, reversal and commitment

| # | Lesson | What it asks | Usual presentation | Velo | Ours |
|---|---|---|---|---|---|
| 27 | Turn around for a spur | The apple is behind you | Shelf entered in the middle | ✅ | 16, 04 |
| 28 | Out and back | Every obstacle taken twice, the second time from the other side | Flower behind the start | ✅ | 12, 19, 20 |
| 29 | Flip in the air to land driven | Which wheel drives depends on facing | Shaft with short ledges | ✅ | 07 (partly) |
| 30 | **Timed reverse** | The flip is only correct inside a window | Apex of a jump; mid-drop | ✅ | **U4** |
| 31 | **Wall-pop reversal** | Convert forward speed into speed the other way | Dead-end face at the end of a run | ⚠️ probe pending | **U2** |
| 32 | Hook a wheel, then flip to power it | Powers the wheel you are balanced on | Thin ledge | ❌ hooking impossible | — |
| 33 | One-way commitment | A cliff only goes one way; choose before you take it | Tiers entered by falling | ✅ | 16 |

### Route and collectibles

| # | Lesson | What it asks | Usual presentation | Velo | Ours |
|---|---|---|---|---|---|
| 34 | Order matters (terminal placement) | Whatever you do last should be next to the flower | Cellar at one end, climb to the flower at the other | ✅ | 06 |
| 35 | Fork with apples on both branches | The jump chooses your order and skips no work | Trench mouth vs bridge | ✅ | 03 |
| 36 | Fast-risky vs slow-safe | A measured time difference, not a vibe | A hole with a bypass | ✅ | 04, 13, 18 |
| 37 | The apple *is* the run-up | The detour is the only way to face the obstacle with room | Apple parked at the far end of a shelf | ✅ | 17 |
| 38 | **Short-but-slow shortcut** | Distance is not the cue | A tempting tight line | ✅ | **U9** |
| 39 | **Apple denies the shortcut** | Placed exactly to make a fast line not free | One apple off the obvious line | ✅ | **U8** |
| 40 | Take-at-speed or stop-and-take | A style choice with a real cost either way | Apple in a pocket beside a fast line | ✅ | **unclaimed** |
| 41 | **One-pass combination** | Each collectible trivial alone; the chain is the level | Three or four, spaced to the bike's rhythm | ✅ | **U13** / 21 |

### Hazard and environment

| # | Lesson | What it asks | Usual presentation | Velo | Ours |
|---|---|---|---|---|---|
| 42 | Killer objects | A specific line, because the easy one is fatal | Mines on the obvious path | ⚠️ planned; `kill` reserved | — |
| 43 | Gravity flips | Re-learn which way is down | Gravity apple mid-flight | ⚠️ `zones` tolerated, ignored | — *(community: a design smell)* |
| 44 | Confinement | Nothing longer than ~14 m of clear run, so every gap is crossed on what the last dozen metres gave | Dense obstacles, no bypasses | ✅ | 20 |

**Not in the table, deliberately:** hanging/upside-down riding (❌ needs a grab
state), bunny hop (❌ settled), supervolt (❌ — our sim treats both lean keys as
neither: `if (leanL !== leanR)` in `step.ts`, so there is no analogue of Elma's
double-key move, and a whole family of canon lessons built on it has no
counterpart here), the suspension-compression *bounce* (❌ as such — Elma's is an
acknowledged physics bug; our spring is real, and what we have instead is
pumping, which is #8).

---

## 6. Supported but never asked for — where depth is cheap

The user's *"it's like the mechanics, not the length"* points here. These are
moves the live bike can already make that **no level in the set requires**. They
are worth more than any new mechanic because they cost zero sim work.

| technique | evidence it works | evidence we never ask for it |
|---|---|---|
| **Rotational pumping** | `bin/pump` on rev 4: **+1.24 m/s** over coasting rollers, **+0.51 m** of peak off a lip, and the user's own "hill, pump at the crest, clear a gap" works for **4.25 m** of gap — all against searched rev-4 controls from the same snapshot | No level's lesson is pumping. 09-runaway explicitly *sizes its arcs so they cannot launch you*, which is the anti-pump level. |
| **The brake** | `brakeTorque` 900 N·m, brake-pitch in mid-air from wheel inertia, and the canon calls braking *"possibly the hardest control to fully master"* | **Brake is held for ≤ 8 % of frames on every winning line in the set**, and for **1 %** on 15-Feather, whose stated lesson is the brake. The lesson is asserted in the commit message and not enforced by the geometry. |
| **Flip as a drive-wheel selector** | `sim.ts`: flip is a free, instant, mid-air-legal facing swap, and `rear = facing > 0 ? 0 : 1` — so it changes which wheel is powered | Every flip in levels 01-20 is a slow turnaround on the ground. Nothing makes *when* you flip matter. |
| **Mid-air throttle counter-rotation** | Deliberately bought by giving the wheel real inertia; called out in `spec.ts` as "a real Elma technique that a spinless wheel throws away" | Never the subject of a level; it is available as an attitude trim on every jump and is never the *answer* to one. |
| **Wheelspin / traction limit** | µ = 1.4 at the patch, wheel inertia present | No level has a grade near the limit. |
| **Asymmetric rebound** | Compression damping high, rebound low, deliberately, "so the spring returns what it stored" | The pop is never used as either a tool (a launch) or a hazard (a rebound into a roof). |

Six techniques in the bike, zero levels teaching them. **That is the cheapest
depth available to this project** — and it is the direct answer to *"someone does
something new"*: people can only find a move the level gives them a reason to
look for.

---

## 7. Apple and route design, as the canon does it

The single clearest statement of purpose: food should *"be used in places you
want the player to go, so he can't use a shortcut"*. Apples are a **routing
instrument**, not a score. The counterweight, from a levelmaking guide: *"if you
don't see a reason to force players to go through a spot, just don't put an apple
there"* — because a gratuitous apple *"might limit their routes or styles or give
unnecessary hints"*. Those two together are the whole doctrine: **every apple
must be denying something, and an apple that denies nothing is worse than no
apple.** Our fourteen zero-tension levels are almost all in violation of the
second half: their apples are waypoints marking a line the player was going to
ride anyway.

What makes a *good* branch, assembled from the same sources and from our own
measured evidence:

1. **The two options must be close in time.** Our own set does this well when it
   tries: 04's hole is 51.1 s against 55.2 s; 13's commit-or-detour is 43.8 s
   against 50.1 s; 18's doubles are 35.9 s against 38.9 s. Under ~10 % and the
   choice is real; over ~25 % and one branch is a bail-out, which is a *mercy*,
   not a decision. Both are legitimate — but only the first creates depth, and we
   should label which one each level is doing.
2. **The cue must not be distance.** The canon's fresh idea is the shortcut that
   is *shorter but slower*. If the faster route is always the shorter one, the
   player reads the map once and never thinks again.
3. **Commitment beats reversibility.** The best route decisions are made *before*
   the information arrives — a one-way drop taken at the wrong end (16), or a
   run-up fetched in the opposite direction to the obstacle (17). A decision you
   can undo by turning round is not a decision.
4. **Opportunistic pickups should be possible but not free.** An apple you can
   take at speed *or* stop for is a style choice, and style choices are where a
   community's route arguments live.
5. **Gravity apples are a smell.** Not applicable yet, and worth remembering
   before we ship zones.

---

## 8. What 21-rollers is doing right

Solved, rev 4: **13.86 s, 5 apples, difficulty 41/100** (precision 0.08,
clearance 0.60, effort 0.67, lethality 0.64), **64 m of route**, min head
clearance 0.282 m, peak speed 7.6 m/s, 22 flips, 15 % airborne, apple order
0→1→2→3→4. One polygon, fourteen vertices, three arcs.

Put beside the hand-authored set, six things stand out.

1. **Difficulty density.** It scores 41 — the same as 10-Cathedral (42) and
   05-Airtime (41) — on **64 m of route** where those spend 633 m and 141 m, and
   in 13.9 s where the set averages 56 s. Difficulty per route metre is **0.66 —
   higher than every hand-authored level**: 08-Needle, the densest of the twenty,
   is 0.38, and the set's median is 0.10. Nothing in it is travel.
2. **It is slow.** Peak 7.6 m/s — the lowest in the set — against a 12 m/s flat
   top speed, and 76 % of its frames between 3 and 6 m/s. Almost every level from 11 to 20 bought its
   difficulty with speed. This one buys it with terrain that is the wrong shape
   for the bike.
3. **It is contact-dense, not air-dense.** 22 ground-touch events per 100 m
   (next highest in the set: 14). The bike is being *worked against the ground*
   continuously rather than thrown across gaps.
4. **It is reversal-dense.** 34.6 flips per 100 m against a set maximum of 15.1.
   Partly a solver artefact — flipping is free and the search uses it liberally —
   but it also reflects a level where which wheel is driven genuinely matters,
   over and over, which is exactly technique #30.
5. **Its depth is line tension, not route tension.** τ = 0.00 against both
   reference orders: the five apples are taken strictly left to right, and there
   is no routing decision at all. The user's *"doing all three required like
   10-15 passes"* is entirely about **chaining** — each apple sits above a roller,
   trivially reachable on its own, and a single continuous line through all of
   them demands that each pickup leaves the bike set up for the next. **This is
   the template to generalise (U13), and it is not the template our stated
   "route freedom is the depth" thesis predicts.**
6. **It has an honest three-act shape in fourteen seconds:** the roller rhythm
   with the apples above it, one mandatory gap off a raised lip, then a climb to
   a shelf. Introduce, demand, resolve. No section repeats another.

The uncomfortable conclusion: this level was written by an agent testing an
editor, with no curation, and it beats the curated set on the two axes the user
cares about. It is short, it is slow, it is dense, it has no route branch, and
every metre of it is asking a question.

---

## 9. Our set read against the taxonomy

**Covered, and covered well:** graded climbing (2), crest radius (6), rollers as
an obstacle (7), flat-lip gaps (11), curved lips (12), height as speed (13),
landing attitude (14), doubles (15), gates (22), pitch-dependent head position
(23), the sustained pipe (24), turn-around-for-a-spur (27), out-and-back (28),
one-way commitment (33), terminal ordering (34), the fork (35), fast-vs-safe
(36), the run-up-as-apple (37), confinement (44). That is the ~17-19 distinct
lessons the plan already estimated, and the estimate was accurate.

**Claimed but not actually enforced:** the brake (5/15-Feather — 1 % brake usage
on the winning line), and route freedom as a whole (six of twenty-one levels).

**Unclaimed and generatable now:** the thirteen in §1, plus #19 (long freefall
with an arrival demand), #21 (wheelspin-assisted landing), #25 (roof on the
landing side), #26 (piping proper), #40 (take-at-speed or stop).

**Unclaimed and blocked:** #32 (hook-then-flip — needs a grab state), #42
(killers — planned), #43 (gravity — and do not hurry).

---

## 10. How the canon sequences 54 levels

What is verifiable: the set is fifty-four levels with a fixed order, and its
names read as a curriculum with reprises rather than a ramp. In order (names
confirmed through level ~43 via speedrun.com's per-level pages and the Fandom
level list; the tail is less certain and I have not verified 44-54):

1 Warm Up · 2 Flat Track · 3 Twin Peaks · 4 Over and Under · 5 Uphill Battle ·
6 Long Haul · 7 Hi Flyer · 8 Tag · 9 Tunnel Terror · 10 The Steppes ·
11 Gravity Ride · 12 Islands in the Sky · 13 Hill Legend · 14 Loop-de-Loop ·
15 Serpents Tale · 16 New Wave · 17 Labyrinth · 18 Spiral · 19 Turnaround ·
20 Upside Down · 21 Hangman · 22 Slalom · 23 Quick Round · 24 Ramp Frenzy ·
25 Precarious · 26 Circuitous · 27 Shelf Life · 28 Bounce Back · 29 Headbanger ·
30 Pipe · 31 Animal Farm · 32 Steep Corner · 33 Zig-Zag · 34 Bumpy Journey ·
35 Labyrinth Pro · 36 Fruit in the Den · 37 Jaws · 38 Curvaceous · 39 Haircut ·
40 Double Trouble · 41 Framework · 42 Enduro · 43 He He …

What that ordering shows:

- **Two pure-teaching levels, then the curriculum starts.** Warm Up and Flat
  Track, and by level 3 the set is already doing islands. Matches our 01/02.
- **Introduce, then reprise in a harder frame.** Labyrinth (17) returns as
  Labyrinth Pro (35); Twin Peaks' islands return as Islands in the Sky (12);
  Hangman (21) and Serpents Tale (15) are both hanging levels, sixteen apart.
  The gap between an introduction and its hard reprise is on the order of
  **12-18 levels** — long enough that the reprise is a test rather than a
  repetition. Our set has only one reprise structure (10-Cathedral as an exam at
  the end of set one) and nothing at all after it.
- **The difficulty curve is not monotone.** *Quick Round* at 23 and *He He* at 43
  are, by reputation, breathers sitting among much harder neighbours; *Hangman*
  is *"one of the shortest internal levels, however it doesn't seem to be"*. A
  54-level set alternates rather than ramps — which is a real disagreement with
  the user's instruction for 1-20 (*"All diff all teaching all increasing in
  difficulty"*). That instruction was right for a twenty-level curriculum. For a
  hundred-level set, a strictly monotone ramp will read as a grind, and the canon
  says so by example.
- **Named single-mechanic levels dominate the middle.** Turnaround, Bounce Back,
  Headbanger, Pipe, Steep Corner, Zig-Zag, Curvaceous, Double Trouble — each name
  is a lesson, not a place. That is the same discipline as our own naming, and it
  is a good test for a generated level: **if you cannot name the lesson in two
  words, it probably does not have one.**

I could not establish, and will not guess at: the intended per-level difficulty
ratings, whether the ordering was designed as a curve or assembled from a backlog,
or what the tail of the set (44-54) is called and asks.

---

## 11. What I could not find out

- **The deep forum material is gated.** Mopolauta threads, the Elma Online wiki
  and the Fandom wiki all returned 403/402/Cloudflare challenges to direct
  fetches. Everything quoted from them arrived through search-engine indexing of
  those pages. Single sentences are therefore reported, not verified in context,
  and I have not seen the threads' disagreements in full. If this matters, the
  next session should try the Wayback Machine (rate-limited when I tried) or ask
  the user to paste a thread.
- **No community rule distinguishing "hard" from "merely precise"** was found
  stated as such. Our own formulation stands on its own merits; do not attribute
  it to them.
- **No per-level design notes** for the canon's set — the community documents
  world records and routes, not authorial intent.
- **Whether the wall-pop reversal works on our bike** is not settled here by
  design; the mechanics probe owns that question.
- **The internal level list beyond ~43** is unverified.

---

## 12. Sources

- [Moposite — Knowledge: Level designing](https://moposite.com/info_knowledge_designing.php) — the single richest design document: length, openings, apple ethics, gravity, beginner mistakes, etiquette.
- [Moposite — Knowledge: Playing](https://moposite.com/info_knowledge_playing.php) — the technique vocabulary: accelerating, turning, braking, pushing, volting, hanging, jumping, bouncing, climbing, dropping, stretching, picking, brutal volting, piping, gravity playing, killer avoiding.
- [Elma Wiki — Advanced tricks](https://wiki.elmaonline.net/Advanced_tricks) and [Fandom — Advanced Tricks](https://elastomania.fandom.com/wiki/Advanced_Tricks) — bounce, brutal volt, wheel compression, o-bounce, deadbounce, the spins, piping.
- [Fandom — Playing](https://elastomania.fandom.com/wiki/Playing) — volt/supervolt/alovolt, and braking as the way to "change motion energy from one direction to another and gain speed back the other way".
- [Fandom — Level Editing](https://elastomania.fandom.com/wiki/Level_Editing) — editing etiquette, holes too small for a wheel.
- [Fandom — Internal Level](https://elastomania.fandom.com/wiki/Internal_Level) and [Elma Wiki — Internal levels](https://wiki.elmaonline.net/Internal_levels) — the 54-level set and why it is still played.
- [Mopolauta — Guide to Level Making and Battle Starting for new players](https://mopolauta.moposite.com/viewtopic.php?t=10056) — "if you don't see a reason to force players to go through a spot, just don't put an apple there".
- [Mopolauta — Getting out of the levelmaking comfort zone](https://mopolauta.moposite.com/viewtopic.php?p=246796) — apple-first design, shortcuts that are shorter but slower, deliberately inverting your own taste.
- [Speedrun.com — Elasto Mania levels](https://www.speedrun.com/elma/levels) — level numbering.
- [m-l.fi — Elmanager](https://m-l.fi/Elma/) — the community's replay tool, and its comparison metrics (appletakes / left volts / right volts / supervolts / turns / groundtouches), which motivated §3.2.
- [Fandom — Uphill Battle](https://elastomania.fandom.com/wiki/Uphill_Battle), [Hangman](https://elastomania.fandom.com/wiki/Hangman), [Hill Legend](https://elastomania.fandom.com/wiki/Hill_Legend) — the few per-level notes that exist.

Internal, and the source of every number in §2, §3 and §8: `bin/solve` output for
`levels/*.json`, the stored `replays/*.solve.replay.json` re-simulated on rev 4,
`src/solver/difficulty.ts`, `src/solver/measured.ts`, `src/sim/step.ts`,
`src/sim/spec.ts`, `src/sim/sim.ts`, and the level commit messages in `git log --
levels/`, which are the authoritative statement of what each of our twenty levels
was meant to teach.

---

## Appendix A — the measured control fingerprints

Extracted by re-simulating each stored `replays/*.solve.replay.json` on rev 4 and
counting. Reproduce with a ~140-line script over `parseReplayFile` →
`getEngine(rev)` → `sim.advance(mask)`; nothing else is needed. `*100` columns are
events per 100 route metres; `Frac` columns are the fraction of input frames.

| level | airFrac | thrFrac | brkFrac | leanFrac | thr100 | brk100 | lean100 | flip100 | gt100 | maxSpd | detour | backFrac | routeM | sec |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 01 First Light | 0.01 | 0.59 | 0.00 | 0.07 | 13.2 | 0.0 | 3.6 | 4.8 | 8.4 | 9.0 | 1.04 | 0.00 | 83 | 13.7 |
| 02 The Long Climb | 0.11 | 0.56 | 0.01 | 0.11 | 20.2 | 1.9 | 5.8 | 5.8 | 9.6 | 8.7 | 1.04 | 0.00 | 104 | 17.6 |
| 03 Mind Your Head | 0.10 | 0.56 | 0.05 | 0.37 | 15.2 | 2.4 | 10.0 | 10.5 | 7.6 | 10.4 | 1.83 | 0.22 | 210 | 35.0 |
| 04 Switchback | 0.09 | 0.57 | 0.07 | 0.43 | 16.8 | 5.2 | 11.4 | 12.3 | 7.8 | 14.0 | 3.60 | 0.34 | 422 | 72.6 |
| 05 Airtime | 0.18 | 0.57 | 0.01 | 0.24 | 15.6 | 1.4 | 8.5 | 7.1 | 10.6 | 9.4 | 1.06 | 0.00 | 141 | 25.5 |
| 06 Two Doors | 0.08 | 0.50 | 0.03 | 0.20 | 15.1 | 2.1 | 7.1 | 4.2 | 8.5 | 11.8 | 2.89 | 0.39 | 424 | 68.3 |
| 07 The Chimney | 0.16 | 0.51 | 0.07 | 0.32 | 18.2 | 5.6 | 11.5 | 12.6 | 7.8 | 13.3 | 5.91 | 0.37 | 269 | 47.1 |
| 08 Needle | 0.07 | 0.67 | 0.08 | 0.44 | 17.2 | 8.3 | 9.6 | 15.1 | 8.3 | 10.0 | 1.08 | 0.00 | 145 | 27.7 |
| 09 Runaway | 0.05 | 0.54 | 0.04 | 0.34 | 15.1 | 3.6 | 6.8 | 11.5 | 5.0 | 10.6 | 1.03 | 0.00 | 278 | 45.3 |
| 10 Cathedral | 0.13 | 0.57 | 0.05 | 0.28 | 13.7 | 3.3 | 8.2 | 8.8 | 8.7 | 14.8 | 3.88 | 0.34 | 633 | 96.3 |
| 11 Downhill | 0.17 | 0.40 | 0.02 | 0.20 | 9.5 | 2.0 | 6.0 | 4.0 | 14.0 | 15.6 | 1.06 | 0.00 | 201 | 27.2 |
| 12 Whoops | 0.28 | 0.61 | 0.05 | 0.42 | 12.2 | 2.4 | 11.4 | 8.8 | 12.0 | 12.3 | 2.01 | 0.50 | 466 | 62.6 |
| 13 Reservoir | 0.15 | 0.60 | 0.03 | 0.31 | 10.4 | 1.7 | 9.2 | 6.4 | 13.2 | 16.3 | 1.08 | 0.02 | 424 | 53.1 |
| 14 Kicker | 0.15 | 0.62 | 0.02 | 0.36 | 13.1 | 1.9 | 10.0 | 9.0 | 11.5 | 15.1 | 1.14 | 0.07 | 480 | 73.0 |
| 15 Feather | 0.16 | 0.40 | 0.01 | 0.19 | 11.9 | 0.7 | 6.6 | 4.6 | 9.9 | 13.6 | 1.04 | 0.00 | 303 | 44.6 |
| 17 Backswing | 0.08 | 0.60 | 0.02 | 0.13 | 14.1 | 0.5 | 8.0 | 11.5 | 1.7 | 16.1 | 3.53 | 0.39 | 920 | 113.3 |
| 18 Double | 0.07 | 0.51 | 0.03 | 0.31 | 15.7 | 2.5 | 8.1 | 8.9 | 4.7 | 16.3 | 1.12 | 0.06 | 235 | 38.3 |
| 19 Low Roof | 0.11 | 0.42 | 0.03 | 0.21 | 15.2 | 2.4 | 6.1 | 5.8 | 7.7 | 8.7 | 2.03 | 0.50 | 574 | 93.7 |
| 20 Close Quarters | 0.18 | 0.50 | 0.05 | 0.45 | 13.9 | 4.2 | 11.9 | 11.3 | 12.7 | 10.0 | 2.05 | 0.49 | 646 | 108.9 |
| **21 Rollers** | 0.15 | **0.69** | 0.04 | **0.60** | **23.6** | 6.3 | **22.0** | **34.6** | **22.0** | **7.6** | 1.05 | 0.00 | **63** | **13.9** |

16-One Way is absent: the solver has never completed it, so it has no verified
line to fingerprint. That is worth noticing — it is also the level with the most
deliberate route structure in the set.

Distances are z-normalised Euclidean over the twelve columns, divided by √12.
Over the 190 pairs: min 0.387, p5 0.740, p25 1.052, median 1.255, max 2.966.
21-Rollers' nearest neighbours: 08-Needle 1.924, 20-Close Quarters 2.069,
04-Switchback 2.163, 03-Mind Your Head 2.182.

## Appendix B — apple orders as taken

`solver` is the order the verified winning run actually collected them in; `x` is
left-to-right; `nn` is nearest-neighbour from the start.

| level | solver | x | nn |
|---|---|---|---|
| 01 First Light | 0-1-2-3-4 | 0-1-2-3-4 | 0-1-2-3-4 |
| 02 The Long Climb | 0-1-2-3-4-5 | same | same |
| 03 Mind Your Head | 0-1-2-3-6-5-4 | 0-1-4-2-3-5-6 | 0-1-4-2-3-5-6 |
| 04 Switchback | 0-1-2-3-4-5-6-7 | 5-0-3-6-1-2-7-4 | 0-3-6-2-1-7-4-5 |
| 05 Airtime | 0-1-2-3-4-5-6 | same | same |
| 06 Two Doors | 2-3-4-5-6-1-0 | 0-1-2-3-4-5-6 | 3-2-1-0-4-5-6 |
| 07 The Chimney | 0-1-2-3-4-6-5 | 4-5-1-0-2-6-3 | 1-0-2-3-6-5-4 |
| 08 Needle | 0-1-2-3-4-5-6 | same | same |
| 09 Runaway | 0-1-2-3-4-5-6 | same | same |
| 10 Cathedral | 0-1-2-4-5-3-7-8-9-6 | 6-0-7-1-5-8-2-4-9-3 | 0-6-7-5-1-2-4-8-9-3 |
| 11 Downhill | 0-1-2-3-4-5-6 | same | same |
| 12 Whoops | 6-0-1-2-3-4-5 | same | same |
| 13 Reservoir | 0-1-2-3-4-5 | same | same |
| 14 Kicker | 0-1-2-3-4-5 | same | same |
| 15 Feather | 0-1-2-3-4-5 | same | same |
| 17 Backswing | 0-1-2-3-4-6-5 | 5-3-2-0-4-6-1 | 2-3-5-0-4-6-1 |
| 18 Double | 0-1-2-3-5-4-6 | same | same |
| 19 Low Roof | 5-0-1-2-3-4 | same | same |
| 20 Close Quarters | 0-1-2-3-4-5-6-7 | same | same |
| 21 Rollers | 0-1-2-3-4 | same | same |

Remember the caveat from §2.2: the solver *chooses* nearest-first with a tier
rule, so "solver = x = nn" partly reflects the solver's own policy. What it
proves is the weaker claim — that the geometry does not force a different order —
and that claim is enough to say fourteen of these levels have their apples
strung out along one line.

---

## 12. MEASURED VERDICTS — where this document describes the wrong bike (2026-09-18)

**Read this before designing around any unclaimed entry above.**

This taxonomy was assembled by studying Elasto Mania. Much of it transfers. Some of it describes **Elma's bike, not ours**, and the difference is invisible until somebody tries to build the level. Across two authoring batches (levels 27-32), **five entries failed on contact with rev 4** — each disproved by measurement, not by opinion.

| entry | verdict | what was actually measured |
| --- | --- | --- |
| **U6** rebound as a hazard | ❌ **not available** | The shipped preset damps compression and rebound **equally (320/320)** — there is no asymmetry to exploit. Head-top after touchdown peaks at **1.18-1.61 m regardless of a 2 m or a 7 m drop**, against 1.16 m standing. The suspension eats a 7 m drop as completely as a 2 m one. |
| **U5** "lean back kills you" | ❌ **backwards** | Rotation does not move the centre of mass, and tilting the arm slightly **lowers** the head. Leaning back in the air does not raise it at all. The real hazard under a roof is **speed**: faster crossing = flatter flight = the roof arrives sooner. |
| **U10** traction, not power | ❌ **mechanic does not exist** | Coulomb friction with **no static/kinetic distinction**: forward force is `µ·N_rear` whether the wheel grips or slides, and 126 N·m on a 0.15 kg·m² wheel saturates `maxWheelSpin` in ~0.1 s, so it is *always* slipping. Swept held throttle against 12/25/33/50/62/75 % duty over 24-50°: **held was never worse for traction.** |
| **U12** "reapply in flight" | ❌ **a trim, not a control** | The driven wheel saturates in **~95 ms**, so airborne throttle is a **one-shot 25-30 °/s impulse worth ~10° of attitude** after angular damping (τ = 0.33 s), not a sustained rate. Off a nose-up kicker that impulse **finishes** the flip. Reapplying is what kills. |
| **U7** brake-to-climb | ❌ **not realisable** | Held brake on 45-85° faces, pulsed at 8/16/32-frame strokes, brake-as-ratchet, brake-dab-against-the-wheelie on 30-46°, brake timed into a concave foot, brake over a crest, and **a 1,500-program random search over six-phase input sequences** on 1.0/1.6/2.2 m steps at 75°. **The brake lost to not-braking in every cell.** A 1.0 m step is climbable without it and not with it; 1.6 m is climbable by nothing. |

### Two of the five had a real mechanic underneath, and the levels were rebuilt on it

A dead entry is not always a dead level. Where the *player-facing* lesson survived, the geometry was rebuilt on what the bike actually does:

- **U10 → `30-scree`.** Full throttle's real cost is not lost grip, it is **126 N·m of nose-up reaction on the chassis** (`tq -= SWT[rear]`), which loops you backwards on a grade. Held gas finishes **7/126**; gas released whenever the nose rises finishes **137/216** — 11x, at the same best time. To the player the lesson reads identically: *stop holding it*.
- **U7 → `32-anchor`.** The brake cannot climb, but it is **2-6x better than anything else at holding station**: parked on a face the bike rolls back 13.0 m at 30°, 23.6 m at 55°, and **dies at every angle >= 35°**; the held brake stops it in 2.1-3.3 m. The lesson became *the brake is what keeps the height you bought*. Honestly the weakest of the six, because a good line never needs it.

### Other negative results worth not rediscovering

- **A take-off crest under a beam cannot gate speed.** Head peak over a 30°/R=3 bump varies **non-monotonically** with approach speed — 9.8 m/s cleared better than 8.5 — because the suspension's phase at the bump dominates. Any beam tight enough to punish speed is also randomly lethal. Use **pure free flight** instead, where the closed form and the sim agree within ~0.1 m.
- **Landing attitude alone is not lethal.** Touchdown pitch swept -20°..110° against slopes -24°..+32°: nothing below ~95° dies. An inversion needs a long enough flight for the throttle to rotate you there — which is why `31-ejector` spends 2.1 s in the air deliberately.

### The rule this establishes

**Measure the mechanic before designing the level, not after.** Every entry above still marked "unclaimed" is a hypothesis about a bike nobody has tested it on. The cost of checking is an afternoon with a scripted rider on `createSim`; the cost of not checking is a level built around something that cannot happen, which is worse than no level because it ships looking fine and teaches nothing.

Where a probe kills an entry, **record the negative here** — five of these were found twice before anyone wrote them down.

### A sixth failure, and this one is the PROBE's, not the canon's (levels 33-35)

`docs/mechanics-probe.md` gives a headroom-to-window calibration for the timed reverse: 0.90 m = 289 ms (free), 0.70 m = 148 ms (a skill), 0.50 m = 55 ms (TAS). **It did not transfer to `35-window`.** Measured there, 0.55 m of headroom gives a **344 ms** survivable span.

The cause is a different approach: on that geometry the bike **leaves the R=3 transition ballistically** and peaks ~3.5 m up the wall *regardless of approach speed* (10.7 and 13.4 m/s gave the same peak), where the probe's rig drove up the face under power. Same headroom, different flight, different window.

**So the probe's numbers are properties of the probe's geometry, not constants of the bike.** Treat every window figure in that document as an existence proof — *this technique can have a window this wide* — and **re-measure it on your own geometry** before sizing a level to it. That is the same rule as §12 one level down: the general finding transfers, the number does not.

One shape worth knowing because nothing predicted it: that level's window is **two-lobed**. Flip frames 18-32 survive, **33-37 die**, 38-61 survive again. The dead band is flipping exactly as the bike crosses the transition's top, reproducible across the sweep. A window is not necessarily an interval.
