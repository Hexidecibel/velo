# Elasto Mania, looked at

A companion to `level-design-canon.md`, written from **pictures and primary wiki
text rather than search snippets**. The Fandom wiki blocks HTML fetches but its
MediaWiki API is open; everything below marked *READ* comes from
`action=parse&prop=wikitext` on that API — the raw page source, infoboxes
included — and everything marked *SAW* comes from measuring or looking at a
screenshot.

**Confidence key, used on every claim:**

- **SAW** — I looked at the pixels, or measured them. Reproducible from the
  files in the scratchpad.
- **READ** — stated in the wiki's own page source. First-hand for what the wiki
  asserts; the wiki can still be wrong.
- **INFERRED** — my reasoning over SAW/READ. Flagged as such, every time.

**The boundary is unchanged from the canon doc.** No `.lev` file was opened, no
binary parsed, no coordinate transcribed. Their scale is not ours: Velo's bike is
1.7 m on 0.25 m wheels.

**What was obtainable, and what was not.** The whole wiki is 67 pages and 31
images. Level pages exist for **1–21 plus 30 (Pipe) and 31 (Animal Farm)** and
nothing else — there is no page for Slalom (22), Bounce Back (28), Zig-Zag (33),
Curvaceous (38) or Hooked (53), which are four of the five levels this study was
asked about. Level screenshots exist for **levels 1–11 only**, plus one online
screenshot the wiki's own gallery labels as level 21. Everything from 22 to 54 is
a name in a table. Nothing here can therefore claim to have *seen* the back half
of the set, and I have not pretended otherwise.

---

## 1. The two measurements

### 1.1 Bike size on screen — the estimate was right

**SAW.** Measured on 1024×768 screenshots with a pixel ruler, twice on a bike
sitting level on flat ground (Warm Up; the left-hand rider in the EOL shot), plus
a third leaning bike (Twin Peaks) as a sanity check.

| quantity | Elma, px of 1024 | Elma, % of screen width | Velo at reference framing (62 px/m, 1600 px) |
|---|---|---|---|
| bike, rear tyre outer edge → front tyre outer edge | 174 – 180 | **17.0 – 17.6 %** | 105 px = **6.6 %** |
| wheelbase (hub to hub) | 112 – 113 | 11.0 % | 74 px = 4.65 % |
| wheel diameter | 62 – 65 | 6.1 – 6.3 % | 31 px = 1.94 % |
| apple (drawn sprite) | 58 – 62 | 5.7 – 6.1 % | 20 px = 1.25 % |

**The zoom is fixed, and I can prove it.** The apple sprite's solid-red core
measures **48–51 px wide in all eleven screenshots** (mean 49.3, spread ±1.5 px,
i.e. ±3 %) — across seven different levels, two different ground textures, and
both the offline and the EOL build. Elma does not zoom per level and does not
zoom with speed. Anything scale-dependent I say below therefore transfers between
shots.

**The implied world width.** Taking Elma's bike as the same nominal 1.7 m machine
Velo models:

```
Elma   1.7 m / 0.173  =  9.8 m across the screen   (range 9.7 – 10.0 m)
Velo   1.7 m / 0.066  = 25.8 m across the screen   (DEFAULT_CAMERA, confirmed in camera.ts)
```

**Your 16–18 % / 9.7 m estimate is confirmed.** It survives a second anchor, too:
if instead of the bike you use the wheel and assume a ~0.6 m dirt-bike front
wheel, 0.6 / 0.062 = 9.7 m. Two independent anchors, same answer.

**And the area gap is bigger than the width gap** (INFERRED from the above, plus
each game's aspect ratio):

```
Elma   9.8 m  ×  7.4 m  =   72 m² on screen   (4:3)
Velo  25.8 m  × 14.5 m  =  374 m² on screen   (16:9, refHeight 900 / 62)
```

**Velo shows 5.2× the world area Elma does.** Width 2.6×, height 2.0×.

**Three consequences worth stating separately:**

1. **Their bike is 2.6× bigger on screen than ours.** A 0.5 m step is 5 % of the
   Elma screen and 2 % of ours. Everything the terrain says, it says 2.6× louder.
2. **Their apple is 4.7× bigger on screen than ours** (5.9 % vs 1.25 % of screen
   width). SAW: in Elma the apple sprite is drawn the *same size as the wheel* —
   measured 58–62 px against a 62–65 px wheel. Ours is drawn at 0.16 m radius
   against a 0.25 m wheel, so it is smaller than the wheel *and* on a 2.6×
   wider view. An Elma apple is a landmark; ours is a dot with a faint ring.
3. **Their bike's proportions differ from ours.** Wheelbase ÷ wheel diameter is
   **1.79** in Elma (112 / 63) against **2.4** in Velo (1.2 / 0.5). Their machine
   is short with fat wheels — closer to a trials bike. INFERRED consequence: a
   step of a given height is a smaller fraction of *their* wheel's climbing
   ability than ours, and their bike pivots in a shorter footprint.

**What this decides.** If you want Elma's framing, `baseZoom` has to go from 62 to
about **160 px/m** at the 1600 px reference — 2.6× — which puts the bike at 272 px
and the wheel at 40 px. That is well inside the existing `maxZoom` of 150… except
it is *above* it, so `maxZoom` would have to move too. I am not recommending the
jump wholesale; see §6.

### 1.2 The minimap

**SAW, and this is the solid part.** The minimap is present in **every one of the
twelve screenshots**, including both 294×220 thumbnails and the EOL online shot.
It is not a toggle and it is not per-level.

| property | measured |
|---|---|
| position | bottom-right, hard-anchored to the screen corner |
| outer border | 1 px bright green, at x = 843 and x = 985, y = 696 and y = 766 |
| interior | **141 × 70 px**, identical in every shot |
| as a fraction of a 1024×768 screen | **13.8 % wide × 9.1 % tall**, 1.25 % of screen area |
| aspect | **2.01 : 1** |
| rendering | flat two-tone silhouette: solid = dark navy (13,13,70), open = light blue (34,115,188). No textures, no grass, no decoration. |
| markers | small squares, ~3×3 px: **white** = player, **red** = apple, **teal/grey-blue** = flower. Verified by cross-checking marker positions against the on-screen apple in the Tunnel Terror shot: the red marker sat within 2 px of where the on-screen apple maps. |
| what it does NOT show | no route, no trail, no travelled-path history, no text, no scale bar |
| EOL | the online build prints `speed / max speed / one wheel` telemetry **on top of** the minimap. It is not treated as sacred screen space. |

**The HUD around it is nearly empty** (SAW): two 7-segment timers, one in each top
corner — best time top-left, current time top-right — and the minimap. That is the
entire base-game HUD. No speedometer, no apple counter.

**What it shows is a whole-level schematic, probably.** The evidence:

- **For whole-level (SAW):** the blob count in the minimap matches the wiki's
  stated `ground polygons` for every level that states one. Uphill Battle is one
  polygon and its minimap is one long ramp. Hi Flyer is two polygons and its
  minimap is two masses. Tag is two and shows a ribbon plus a stepped mass.
  Gravity Ride is five and shows about five thin bars. That is four independent
  hits and it is hard to get by accident.
- **Against (SAW):** the two Tunnel Terror screenshots — which share an identical
  `01:07:54` best-time readout in the top-left corner, i.e. almost certainly the
  same player on the same level — show **materially different minimaps**. One is
  a field of thin ledges; the other is a large solid mass filling 60 % of the
  box. A static whole-level fit cannot do that. (Caveat, READ: the file
  `Tunnel Terror 2.jpg` is used on the *Elasto Mania* page captioned only
  "Screenshot from Elasto Mania", so the filename is not evidence of which level
  it shows.)
- **Also against (SAW):** Warm Up's minimap has a hard vertical boundary two
  pixels left of the player marker with open space to its right and solid to its
  left, and the main view at that same instant (t = 1.34 s) shows open sky and
  continuous grass off the left edge of the screen. No wall exists there.

**Where I measured the scale.** In the second Tunnel Terror shot I could pin two
features that appear in both the main view and the minimap — a thin ledge and the
apple — and both gave the same answer: **≈ 22.7 screen px per minimap px**. That
makes the box cover about **3.1 view-widths × 2.1 view-heights ≈ 31 m × 15 m**. A
second, rougher fit on Hi Flyer's island gave ≈ 30 screen px per minimap px, i.e.
≈ 40 m × 21 m. **INFERRED: an Elma internal level is roughly 30–40 m wide and
15–20 m tall.** Wide error bars; two measurements.

**Verdict, stated at the confidence it deserves.** The minimap is a permanently
visible, tiny (1.25 % of screen), untextured solid-vs-open schematic of a region
several times larger than the play view, carrying markers for the player, every
apple and the flower. Whether that region is the whole level or a large scrolling
window I could **not** settle, and I am not going to assert one. If it matters,
the cheap test is ten minutes in a real Elma build: load Warm Up, drive left, and
watch whether the dark region on the left of the minimap changes.

**What it decides for us anyway — and this part does not depend on the unresolved
bit.** Elma makes a 9.8 m view survivable by giving you, *at all times and for
free*, a schematic that answers "where are the apples, where is the flower, where
am I" without leaving the bike. We have a freeze-and-look overview instead: it
answers the same question, but it costs a mode switch and it is not available
while riding. **The thing Elma proves is that the answer to a tight zoom is a
permanent 1 %-of-screen schematic, not a wider camera.** Their tight zoom is not
a compromise they tolerate — it is a choice they paid for with a minimap.

---

## 2. Every level image, one at a time

Eleven internal levels exist as pictures, plus one online shot and one
replay-viewer shot. All measurements are from the 1024×768 originals unless
noted. Apple/killer/polygon counts are READ from the wiki infobox; everything
about shape is SAW.

### 01 Warm Up — WR 14.00

- **SAW.** One grass-topped ground mass filling the bottom 42 % of the screen, a
  shallow undulation of maybe five or six straight segments. Sky above it.
  Nothing else on screen but a large decorative tree, which is a *picture*
  (no collision) — the bike rides straight through it.
- **READ.** 1 ground polygon, **16 ground vertices**, 7 pictures, 1 apple, 0
  killers. "Quite flat level with an apple on the right side and a flower on the
  left, the driver's starting place being in the middle."
- **INFERRED.** The entire level is one sixteen-sided polygon. The screen shows
  perhaps a third of it. Level 1 is an out-and-back with exactly one collectible,
  and its lesson is the contract: throttle, roll, the floor is not flat.
- **Built around:** nothing. It is deliberately nothing.

### 02 Flat Track — WR 14.88

- **SAW** (294×220 thumbnail only — measurements coarse). One ground mass: a
  shallow dip, a small sharp peak, another dip, a rise to the right. Bushes
  decorate the right-hand rise. The screenshot catches the bike **airborne off
  the small peak**.
- **READ.** 1 ground polygon, **0 apples**, 0 killers.
- **Built around:** the crest. Level 2, with nothing to collect, teaches that the
  floor can launch you. Compare Velo, where the equivalent lesson (`09-runaway`,
  crest radius) arrives at level 9 and is 280 m long.

### 03 Twin Peaks — WR 17.50

- **SAW.** A valley: the floor descends from the left, bottoms out, rises to the
  right. **Two grass-topped slabs hang down from the top of the screen**, a
  partial roof over the dip. A killer sits on the left slope, directly on the
  route. One apple floats at rider-head height right on the line.
- **READ.** 2 apples, **2 killers**.
- **Built around:** a roof over a dip. You cannot answer the dip by carrying
  height, because the height is occupied. This is our U5/U11 ("jump under a
  roof", "a crest under a ceiling") and Elma does it at **level 3**.
- Roughly 8–10 collision segments on screen, counting both hanging slabs.

### 04 Over and Under — WR 28.95

- **SAW.** The busiest screen in the whole set. Bike airborne off a ledge lip;
  below and right, a **red girder scaffold**: three horizontal beams at three
  different heights joined by a vertical, forming shelves you must pass over and
  under. Another grass ledge far right. More beams bottom-left. About **six
  distinct solid masses** and ~15 collision segments in view.
- **SAW.** One apple hanging in **open air** at roughly two-thirds screen height,
  directly on the flight path but above it — the jump has to reach it.
- **READ.** 2 apples, 2 killers. WR is **double level 3's**.
- **Built around:** one structure traversed twice, once on top and once beneath.

### 05 Uphill Battle — WR 19.79

- **SAW.** Almost nothing. Flat grass-topped brick filling the bottom half of the
  screen, one small V-notch in the grass, decorative blue crates behind. No
  apples, no killers, no second polygon. Two or four collision segments in view.
- **SAW (minimap).** A single long ramp rising left-to-right across the whole box.
- **READ.** 1 ground polygon, **0 apples**, 0 killers. "Can be easily driven
  without turning, or one-wheel." The WR style uses a *slide brutal* — a bounce
  combined with a full 360° volt, only possible at high FPS.
- **Built around:** the grade, and nothing else. The level *is* the slope. This is
  the purest instance in the set of "one idea, no furniture".

### 06 Long Haul — WR 30.19

- **SAW.** Two stacked grass-topped brick ledges forming a large step, with an
  open drop between them. A ramp slab at top-left. A brick wedge hanging from the
  ceiling. About four masses, ~8 segments.
- **SAW.** The apple is **tucked into the inside corner** where the lower ledge
  meets the upper ledge's underside — below and behind the natural line. You have
  to drop off the fast route to take it.
- **READ.** 5 apples, 0 killers. "A few larger islands with apples above them. The
  last apple and flower are placed on the ground, allowing the driver to catch
  them both almost simultaneously."
- **Built around:** apples that cost something. This is canon item U8 ("the apple
  that denies the shortcut") at **level 6**; we still have not built it.

### 07 Hi Flyer — WR 26.36

- **SAW.** **One** floating triangular island: flat grass top, brick underside
  tapering to a point below the screen. An apple floating just above the top
  surface. Absolutely nothing else on screen — the rest is sky. Three collision
  segments in view.
- **READ.** **2 ground polygons for the entire level**, 3 apples, 1 killer. "The
  level consists of a big loop where the kuski starts; above him is an island
  with an apple accessible **from both left and right**. At the left side of the
  loop are two more apples above a killer. Left-down from them is the flower in a
  hole. The flower placement can be confusing for beginners, due to easily
  missing it." The WR style uses a slide brutal.
- **Built around:** a loop that throws you, an apple with **two legitimate
  approaches** — the first genuine route choice in the set, at level 7 — and a
  flower that is hidden rather than signposted.

### 08 Tag — WR 20.53

- **SAW.** One **very thin brick ribbon** — about 30 px, i.e. ~0.3 m — spanning
  the entire screen width, gently wavy. A zig-zag grass-topped ceiling above it.
  **Three apples: one above the ribbon, two below it.** A flag picture at the
  bottom.
- **READ.** 2 ground polygons, 3 apples, 0 killers, ground "ground, brick masks".
- **Built around:** a single thin divider with fruit on both faces. It forces the
  underside — the first hanging level — and it is the cleanest piece of route
  tension in the visible set: the order in which you work the two sides is a real
  decision. Note the thing that makes it work is that the divider is *thin*: a
  0.3 m ribbon in a 9.8 m view.

### 09 Tunnel Terror — WR 50.24 — **two shots, and your reading was exactly right**

- **SAW (shot a).** One thin floating platform, stepped: a low flat section, a
  vertical riser of about half a bike-height, then a higher section that tapers
  away to the right. One apple sitting right at the step. Nothing else on screen
  at all. **A flat, a step and a ramp.** That is the whole screen.
- **SAW (shot b).** A large steep rock face rising on the right; a grass slope
  climbing toward it; an apple on the slope; a thin floating ledge at the left;
  decorative trees. Three masses.
- **READ.** 4 apples, 0 killers, ground `stone1`. WR 50.24 — **nearly double the
  longest level before it**.
- **Built around:** length and enclosure. This is the set's first genuine wall
  (§4.3).
- **The comparison you asked for, made explicit.** Their level 9: one stepped
  ledge, one apple, one riser, ~8 collision segments in view, an estimated 30 m
  of level. Our level 9 (`09-runaway`): 280 m long, 9.7:1, 50 edges, 7 apples, a
  cave and two decor polys, and the solver takes 45 s to get through it.

### 10 The Steppes — WR 10.66 — the shortest internal level in the game

- **SAW.** One stepped floating island: a low flat, a ramp, a higher flat, a small
  step down, continuing right. A thin vertical spike at the far right edge. A
  decorative tree. About 8 segments, one mass.
- **READ.** **1 ground polygon, 0 apples, 0 killers.** "With this WR time, The
  Steppes is the shortest internal level." "This level is the first where Balázs
  included a **Secret Area**. It is located to the right of the level, accessible
  by jumping on top of the loop and going right." The WR style uses a slide
  brutal.
- **Built around:** steps, and a secret. **INFERRED:** its real job is structural
  — it sits immediately after the hardest level in the game so far (9, 50 s) and
  is 10.7 s long. It is a reset, and it is placed deliberately (§4.1).

### 11 Gravity Ride — WR 23.00

- **SAW.** A single thin flat beam, grass on top, brick below, spanning about half
  the screen. The bike is **hanging inverted** — one wheel resting over the top of
  the beam, the frame and rider dangling below it. Apples clustered at the
  top-left of the screen and one at the far left edge. Four collision segments in
  view.
- **SAW (minimap).** About five thin horizontal bars at different heights, plus a
  short steep diagonal at the left.
- **READ.** **5 ground polygons**, 6 apples, 0 killers. "This is the level where
  gravity apples are introduced."
- **Built around:** gravity reversal. Visually it is five thin bars floating in
  open sky — the simplest possible substrate for the least simple idea. When you
  are teaching something new, the geometry gets *simpler*, not harder.

### 21 Hangman — WR 14.37 — seen only in the EOL online screenshot

- **SAW.** Flat ground, a ramp rising at the right, and **one thin floating beam**
  up and to the left. One apple below the beam. Two riders on screen (an EOL
  battle), both drawn at identical size — a useful cross-check on the zoom.
- **READ.** 3 apples, 0 killers. "This is one of the shortest internal levels,
  however it doesn't seem to be. The trick is in going **right instead of left**
  at the start, then hanging on the middle floating polygon and going to the
  flower while taking the remaining apple."
- **Built around:** a deliberate misdirection — the obvious first move is the
  wrong one — plus a hang. Three apples and 14 seconds, and it is a route puzzle.
  **INFERRED:** it is also a second reset, placed immediately after the longest
  and hardest run of the set (16–20, all 35–83 s).

### 50 Expert System — seen in a modern replay-viewer screenshot

- **SAW.** A large angular solid with a **V-shaped notch** funnelling down-right,
  a thin sloping ledge, decorative trees, and a ghost trail of the bike curving
  into the notch. Two or three masses.
- **SAW (the viewer's own apple splits).** 6.27 s / 8.13 / 14.99 / **15.05** /
  18.39 / 22.46. **Apple 4 arrives 0.059 s after apple 3** — a pair taken in a
  single motion. That is a design idiom we do not have: two collectibles placed
  so close that they read as one event.
- **READ** (replay manager listing): finished times for this level range 29.9 –
  51.3 s across five stored replays.
- **INFERRED, and worth the whole entry:** at level **50 of 54**, the on-screen
  geometry is still only two or three large angular masses. The set never gets
  visually busier. It gets harder by asking more of the same few shapes.

### What the editors show (two shots, both SAW)

- **The original Elma editor**, showing a community level in wireframe: one big
  irregular enclosing outline, roughly **1.5 : 1** in bounding aspect, plus about
  a dozen long thin internal slivers, plus objects. That is the canonical Elma
  level shape — an *enclosure* with ledges in it.
- **SLE (a modern editor)**, showing a 2020s community battle level: here the
  level is genuinely **carved chambers** — interlocking brick solids with pockets
  of open sky between them, gravity apples each with a direction arrow drawn
  beside it (exactly what the etiquette page demands). **INFERRED:** the community
  style moved toward carved solids; the internals are thin islands in open sky.
  If you copy one, know which one you are copying.
- **Both confirm the topology** (READ, `Level Editing`, and SAW in both editors):
  in Elma, **polygons enclose the playable space, and everything outside every
  polygon is solid.** Their "cave" is not a bounding box you draw around a level —
  it *is* the level. Warm Up is one sixteen-vertex enclosure and that is the
  entire map.

---

## 3. Simplicity: the impression is right, but not for the reason assumed

You wrote: *"their per-screen geometry is markedly SIMPLER than ours."* I tested
that three ways and it came out **partly true, and the true part is not about
geometry**.

### 3.1 Edge count per screen — no difference

Careful visual count of collision segments visible on screen in each Elma shot,
excluding grass sawtooth and decorative pictures:

```
Warm Up 5-6 · Flat Track ~6 · Twin Peaks 8-10 · Over and Under ~15 · Uphill 2-4
Long Haul ~8 · Hi Flyer 3 · Tag ~12 · Tunnel Terror ~8 · Steppes ~8
Gravity Ride 4 · Hangman ~6            →  median ≈ 8 per screen
```

Computed exactly over all 21 Velo levels (edges of non-decor polygons ÷ x-span ×
25.8 m): **median 8.5 edges per screen**, range 4.1 (13-reservoir) to 31.8
(07-the-chimney).

**Median 8 vs median 8.5. The per-screen edge counts are the same.**

### 3.2 Edge count per metre — Elma is *finer*, not simpler

Because their screen is 2.6× narrower, those ~8 edges are packed into 9.8 m
rather than 25.8 m:

| | metres of level per collision edge | in bike-lengths |
|---|---|---|
| Elma | ~1.2 m | **0.7 bike-lengths** |
| Velo (median 0.33 edges/m) | ~3.0 m | **1.8 bike-lengths** |

**INFERRED, and I think this is the finding.** Elma's terrain changes direction
about every two-thirds of a bike length. Ours changes about every two bike
lengths. Their ground is *talking to the bike at the bike's own scale* — every
feature is something the wheelbase spans or nearly spans. Ours is at roughly
triple that wavelength, which is why our terrain reads as long smooth runs with
occasional events, and theirs reads as constant conversation.

This also explains why 21-rollers — 64 m, 3.4:1, 14 edges, 0.22 edges/m but with
the rollers *sized to the bike* — was the one that landed.

### 3.3 Where the difference actually is: total extent

| | Elma internals | Velo levels |
|---|---|---|
| level width | **~30–40 m** (estimated, §1.2, wide error bars) | 52 – 428 m, median 196 m |
| level width in view-widths | ~3 – 4 screens | **2.0 – 16.6 screens, median 7.6** |
| **bounding aspect** | **~1.5 : 1 to 2 : 1** (editor wireframe SAW; minimap box is 2.01:1) | **median 6.6 : 1**, worst 26.4 : 1 |
| solved / record time | WR 10.7 – 82.8 s, **median 23 s** (READ, 21 levels) | solver first-solution 13.7 – 113 s, **median 45 s** |
| apples | 0 – 8, **median 3**, and **five of the first twenty-one levels have none at all** | 5 – 10, median 7, **never fewer than 5** |

**So the honest version of your impression:** per screen their geometry is not
simpler, it is the same density. What is simpler is **the level** — theirs is
three to four screens of world, ours is eight. And what is different in kind is
the **shape**: theirs are roughly 2:1 blocks that use the vertical axis as hard as
the horizontal; ours are 6.6:1 corridors that mostly do not.

The Elma minimap being a 2.01:1 box is itself evidence (INFERRED): the overview
affordance the designer built assumes levels of about that proportion. A 26.4:1
level would be 5 px tall in it.

### 3.4 The apple count is the other half

**READ.** Elma apple counts for levels 1–21: 1, 0, 2, 2, 0, 5, 3, 3, 4, 0, 6, 1,
1, 1, 5, ?, 6, 1, 0, 6, 3. **Five zeros and five ones in the first twenty-one
levels.** Levels 2, 5, 10 and 19 have *no collectibles at all* — they are pure
navigation, and 19 (Turnaround) is 35.8 s long with nothing to pick up.

Velo has never shipped a level with fewer than five apples, and sits flat at
about seven from level 3 to level 20. **INFERRED:** we use apples as a default
furnishing; Elma uses them as a statement. When Elma has one apple (12, 13, 14,
18) the apple *is* the level; when it has six (11, 17, 20) the level is about
route. We have no such register.

---

## 4. The curve, level by level

The wiki's infoboxes carry world-record times for every level with a page. These
are **READ**, first-hand from the page source, and they are the best objective
series available for testing the shape of the set. A WR is not difficulty — it is
a lower bound on how long the level takes a twenty-year expert — but it is a clean
measure of *how much level there is*, which is what the alternation claim is
about.

| # | level | WR | apples | killers | polys |
|---|---|---|---|---|---|
| 1 | Warm Up | 14.00 | 1 | 0 | 1 (16 verts) |
| 2 | Flat Track | 14.88 | 0 | 0 | 1 |
| 3 | Twin Peaks | 17.50 | 2 | 2 | |
| 4 | Over and Under | **28.95** | 2 | 2 | |
| 5 | Uphill Battle | 19.79 | 0 | 0 | 1 |
| 6 | Long Haul | **30.19** | 5 | 0 | |
| 7 | Hi Flyer | 26.36 | 3 | 1 | 2 |
| 8 | Tag | 20.53 | 3 | 0 | 2 |
| 9 | Tunnel Terror | **50.24** | 4 | 0 | |
| 10 | The Steppes | **10.66** | 0 | 0 | 1 |
| 11 | Gravity Ride | 23.00 | 6 | 0 | 5 |
| 12 | Islands in the Sky | 20.65 | 1 | 0 | |
| 13 | Hill Legend | **13.88** | 1 | 1 | 4 |
| 14 | Loop-de-Loop | 17.61 | 1 | 1 | |
| 15 | Serpents Tale | **48.82** | 5 | 0 | |
| 16 | New Wave | **1:22.80** | ? | 0 | |
| 17 | Labyrinth | 53.41 | 6 | 0 | |
| 18 | Spiral | 44.24 | 1 | 0 | 2 |
| 19 | Turnaround | 35.78 | **0** | 1 (hidden) | |
| 20 | Upside Down | 57.76 | 6 | 1 | |
| 21 | Hangman | **14.37** | 3 | 0 | |
| 30 | Pipe | — | | | |
| 31 | Animal Farm | 1:10.37 | 8 | 0 | |

No page and therefore no data exists for 22–29 and 32–54.

### 4.1 Does the set alternate? — **Yes, and the shape is sharper than "alternates"**

**SAW in the data.** Plot the WR series and the structure is unmistakable:

```
14 15 18 | 29 | 20 | 30 26 21 | 50 | 11 | 23 21 | 14 | 18 | 49  83  53 44 36  58 | 14 |
 ↑build↑  pk   ↓   ↑ build ↑   PEAK  ↓↓  ↑    ↓      ↑ -------- the long run -------- ↓↓
```

The pattern is not a sawtooth. It is **build → peak → hard reset**:

- levels 1–4 build (14 → 29), level 5 resets to 20;
- levels 6–9 build to the first real peak (50.2 s at Tunnel Terror), and level 10
  drops to **10.66 s — the shortest level in the entire game**, immediately after
  the longest one so far;
- levels 11–14 sit low and short (23, 21, 14, 18) — four easy levels in a row;
- levels 15–20 are the long run: 49, **83**, 53, 44, 36, 58 — six consecutive
  levels every one of which is longer than anything in 1–14;
- level 21 drops to **14.37 s**.

**The two shortest levels in the set (10 and 21) sit immediately after the two
hardest runs.** That is not alternation, it is punctuation, and it is
deliberate: the designer spends a whole level slot on relief.

**We do not do this.** Our solver times run 13.7, 17.6, 35.0, 72.6, 25.5, 68.3,
47.1, 27.7, 45.3, 96.3, 27.2, 62.6, 53.1, 73.0, 44.6, —, 113.3, 38.3, 93.7,
108.9 — a noisy climb with no relief slot anywhere. The nearest thing we have to a
level-10 is `21-rollers` (64 m, 3.4:1) and it was an accident.

**Second, hidden alternation — the geometry gets simpler when the idea gets
harder.** READ + SAW: the levels with the fewest polygons are 1, 2, 5, 10 (one
each) and 7, 8, 18 (two each). Gravity Ride, which introduces gravity flipping —
the most conceptually violent thing in the game — is five thin bars in empty sky.
**INFERRED: when Elma teaches something new it strips the level to the bone.** Our
set does the reverse — the later the level, the longer and busier.

### 4.2 Are lessons reprised 12–18 levels later? — **No. The interval is not a rule.**

The canon's claim was that lessons come back "12–18 levels later in a harder
frame". Tested against the only three reprises the wiki itself names or that the
titles make unambiguous:

| first statement | reprise | gap | evidence |
|---|---|---|---|
| 17 Labyrinth | 35 **Labyrinth Pro** | **+18** | name; the obvious case the claim was built on |
| 11 Gravity Ride | 20 **Upside Down** | **+9** | **READ**: Upside Down's page says "It is the second gravity level (after internal 11)" |
| 21 Hangman | 52 **Hang Tight** → 53 **Hooked** | **+31 / +32** | name family; `Playing` defines *hang* as the shared technique |

**The claim fails.** Three verifiable reprises give gaps of 9, 18 and 31. The
"12–18" figure was a generalisation from the single case that happens to be
named `Pro`. **Mark that claim in `level-design-canon.md` as not supported.**

What *is* supportable (INFERRED, from names only, and I want to be clear that
this is name-reading and nothing more) is that the set is organised into
**families that recur at irregular intervals**:

- flat / ground: 1, 2, 10, 42 Enduro
- climb: 5, 32 Steep Corner, and its mirror 48 Downhill
- air: 7, 24 Ramp Frenzy, 44 Freefall, 51 Tricks Abound
- over-and-under a divider: 4, 8, 27 Shelf Life, 41 Framework
- enclosure / low roof: 9, 30 Pipe, 37 Jaws, 45 Sink
- gravity: 11, 20
- rotation: 14 Loop-de-Loop, 18 Spiral, 26 Circuitous
- **S-curves: 15 Serpents Tale, 16 New Wave, 22 Slalom, 33 Zig-Zag, 34 Bumpy Journey, 38 Curvaceous, 39 Haircut** — seven levels, the largest family in the game
- route puzzles: 17, 35, 47 Enigma, 50 Expert System
- reversal: 19 Turnaround, 28 Bounce Back
- hanging: 21, 52, 53
- apple-heavy: 31 Animal Farm (8), 36 Fruit in the Den, 46 Bowling, 54 Apple Harvest

**The S-curve family being seven levels of fifty-four is the number I would act
on.** Canon item U3 ("close descending S-curves") is not a niche lesson in Elma;
it is their single most repeated idea, and we have zero.

### 4.3 Where are the walls, and does an early one gate the set?

**SAW in the WR series, INFERRED as to what it means:**

- **Wall 1 — level 9, Tunnel Terror (50.2 s).** Nearly double the longest level
  before it and 2.4× its immediate predecessor. The first level that is *long*.
- **Wall 2 — level 16, New Wave (1:22.80).** The longest level in the game by 25
  s, sitting sixth from the end of the shareware set.
- **The 15–20 block** is the real wall: six consecutive levels of 36–83 s with no
  relief between them.

**Does an early wall gate the rest?** **READ, and this is the important structural
fact nobody has mentioned:** Spiral's page says *"This is the last level of
unregistered Elma."* **Levels 1–18 were the shareware demo.** Everything from 19
on was behind the purchase.

**INFERRED, with some confidence:** the curve's shape is explained by that. The
demo had to teach the bike (1–8), prove there was depth (9), give relief (10),
introduce the game's most exotic mechanic while it was still free (11, gravity),
coast (12–14), and then finish on the biggest levels in the set (15–18) so the
purchase looked worth it. Level 9 is not a mis-tuned difficulty spike; it is the
demo's "this game is bigger than you thought" moment, and it is deliberately
followed by the shortest level in the game so nobody quits there.

**The transferable rule is not "put a wall at 9".** It is: **an early wall is
survivable only if the level immediately after it is the shortest in the set.**
We have walls (`04-switchback` at 72.6 s, `10-cathedral` at 96.3 s) and we have
nothing short after either of them.

---

## 5. The four techniques you remember

Honest headline first: **the wiki has no page for three of these four levels.**
There is no Slalom, no Bounce Back, no Zig-Zag, no Curvaceous, no Hooked page —
they are entries in a navigation template and nothing more. What follows separates
what the wiki says about the *technique* (READ, from `Playing` and
`Advanced Tricks`) from what I can infer about the *level*.

### 28 Bounce Back — and a correction to the canon

**READ, `Playing`, verbatim:**

> "You can also ***bounce***, not only by falling from a height, but also on
> purpose on almost any surface in the level as long as you have sufficient speed
> and right direction. (Note that the term bounce is always used to refer to a
> special compression and sudden release of the bike's suspension, **not the bike
> hitting a polygon and bouncing off normally**.) You can combine a bounce with
> ***brutal volt***, which is simply a full 360° volt made on a flat surface. The
> added bounce, when done properly, gives you extra height and/or speed and may
> help you get over tall obstacles, as for example in the world record style in
> Uphill Battle."

**This corrects canon item U2.** The canon frames U2 as "the wall-pop reversal —
carry speed into a vertical face, let the impact stop you, flip, and leave with
speed the other way", and attributes that framing to Elma's own vocabulary. **The
wiki explicitly says the opposite:** *bounce* in Elma means a suspension
compression-and-release, performed **on almost any surface**, most usefully on
**flat ground combined with a 360° volt**, and the canon page names *Uphill
Battle* — a flat-then-climbing level with no walls at all — as the exemplar.
There is no wall in it.

**What Bounce Back is therefore about (INFERRED):** the level is named for the
technique, and the technique is a suspension trick for gaining height or speed
where the terrain will not give it to you — Elma's version of our U1 (pump a
roller to make the gap), not our U2. **Advanced Tricks** (READ) lists a whole
family of these and every page is a red link: *Bounce, Brutal volt, Wheel
compression, O-bounce, Deadbounce, Zweq-spin, Nekit-spin, Piping.* Eight named
suspension/rotation techniques, none documented, all invented by players.

**What that means for us:** the mechanics probe should be asking "can our
suspension be compressed and released deliberately for height on flat ground?"
rather than "can we pop off a wall". If the answer is yes, that is one level. If
the answer is no, U2 as written is chasing the wrong thing.

### 19 Turnaround — the one with a page, and it is the interesting one

**READ.** WR 35.78 s. **0 apples.** 1 killer, and the infobox says
**"1 (hidden)"**.

**INFERRED, and the inference is short because the facts are loud:** a 36-second
level with nothing to collect is a level whose entire content is *getting
somewhere and getting back*. Named `Turnaround`, with no apples, it is an
out-and-back where the reversal itself is the difficulty. The hidden killer is
notable for a second reason: the wiki's own `Level Designing Etiquette` page
(READ) forbids exactly this — *"Do not make invisible polygons… use this REALLY
only when needed and when it doesn't surprise kuskis."* The internals break their
own community's later rules.

**For us:** canon item U4 is "the timed reverse", and we framed it as a mid-air
flip timed to a window. Turnaround suggests the simpler and more teachable frame:
**a level with no collectibles at all, where the only content is the reversal.**
We have never shipped a zero-apple level. We could not — every level in `levels/`
has at least five.

### 22 Slalom / 33 Zig-Zag / 38 Curvaceous — the biggest family in the game

**READ:** nothing beyond the names and their position in the table.

**INFERRED, from the family structure (§4.2):** these three are part of a
**seven-level** family — 15 Serpents Tale, 16 New Wave, 22 Slalom, 33 Zig-Zag, 34
Bumpy Journey, 38 Curvaceous, 39 Haircut — spread from level 15 to level 39, with
gaps of 1, 6, 11, 1, 4, 1. They are not spaced on a schedule. They come in
**pairs and clusters** (15/16, 33/34, 38/39).

**READ, and it is the one hard datum about this family:** 15 Serpents Tale is
48.82 s and 16 New Wave is **1:22.80 — the longest level in the game**. The two
levels that open the S-curve family are back-to-back and are two of the three
longest levels in the first twenty-one. **INFERRED:** an S-curve chain is
intrinsically a *long* level, because the content is a sequence and the sequence
has to be long enough to establish a rhythm. Our U3 should be budgeted as a long
level, not a short one — which is the opposite of the instinct this project has
been developing.

I could not find out what the individual S-curves look like. No picture exists for
any of the seven.

### 53 Hooked — third from last, and the family is documented even if the level is not

**READ, `Playing`, verbatim:**

> "You don't always drive with both wheels on the ground. You can ***hang***,
> which means driving upside down on a thin polygon with **one or both wheels**."

**SAW.** Gravity Ride's screenshot shows this exactly: the bike inverted with one
wheel resting over a thin beam and the frame and rider hanging beneath it. That
picture is the best evidence of what the hang family asks — **the contact patch
is a single wheel on a thin edge, and everything else is below it.**

**INFERRED, from position and family:** the hang family is 21 Hangman → 52 Hang
Tight → 53 Hooked, i.e. introduced early (21), reprised near the end (52), and
made into the hardest thing in the game (53). "Hooked" names the *front* tyre
specifically, and level 53 of 54 is where the game puts its final exam.

**The bad news for Velo is unchanged and now better evidenced.** A circle cannot
hook. Elma's hang works because the level provides a **thin polygon** — Tag's
ribbon measured ~0.3 m thick against a 0.5 m wheel — and their wheel can rest
across it with the frame below. Our wheels are circles with no grab state and our
ribbons would have to be thinner than a wheel radius. The canon already lists
hanging as ❌ and this study does not move it. **What it does move:** the hang
family is three of fifty-four levels and contains the game's declared hardest
level. If we are permanently excluded from it, our top end has to come from
somewhere else, and we should say so out loud rather than leaving it as a
deferred ❌.

### One extra the wiki hands us free: 30 Pipe is our U5/U11, fully specified

**READ, `Playing`, verbatim:**

> "Sometimes a passage is too low to allow you to go through it normally without
> banging your head. This is called a ***pipe***. To get through a pipe you need
> to drive through it **sideways**, while repeatedly pressing the turn or volt
> keys to keep your head from hitting the floor or ceiling."

**SAW:** the SLE editor has a dedicated **"Pipe"** tool in its left-hand toolbar,
i.e. a first-class level-construction primitive for exactly this.

This is a named technique, a named internal level (30), and a level-editor
primitive — and it is the direct answer to the user's stated wish for "a ceiling
that forces you low through a gap where volting would kill you". It is also
strictly harder than our U5, because the answer is not "go flat", it is "go
sideways and drum the controls". Whether our bike can do the sideways version is
a mechanics-probe question, not a design one.

---

## 6. What I would act on

Ordered by how directly the evidence supports it.

1. **The camera is the biggest single difference, and it is a dial.** 25.8 m
   against their 9.8 m; 5.2× the world area. I am not recommending 160 px/m
   wholesale — our levels are 6.6:1 and 196 m long at the median, and at Elma's
   zoom you would see 1/20th of `13-reservoir`. **The zoom and the level shape
   have to move together.** Elma's framing works because Elma's levels are 2:1
   and three screens wide.
2. **Build one level at Elma's proportions and Elma's zoom and see.** ~30 m wide,
   ~15 m tall, 2:1, one enclosing polygon plus two or three thin ledges, three
   apples, a target time near 20 s, played at ~160 px/m. That is one level, it is
   cheap, and it tests the whole hypothesis at once. `21-rollers` (64 m, 3.4:1,
   2.5 screens) is already halfway there and is the level that landed.
3. **Make the apples readable.** Theirs are the same size as the wheel and 5.9 %
   of the screen; ours are 1.25 %. Even without touching the camera, drawing the
   apple at the wheel's radius rather than 0.64× it is a one-line change with a
   real effect on whether a level reads in two seconds.
4. **If we go tighter, the overview has to become permanent and free.** 141×70 px
   in the corner, solid-vs-open, player + apples + flower as three-pixel squares.
   1.25 % of the screen. The freeze-and-look overview is the wrong shape for a
   tight camera because it costs a mode switch on every attempt, and in a
   die-and-retry game you pay that cost every attempt.
5. **Put a relief slot in the ramp, deliberately.** Their two shortest levels sit
   immediately after their two hardest runs. Ours has no such slot. This costs one
   level and is pure structure.
6. **Allow zero-apple and one-apple levels.** Ten of their first twenty-one levels
   have one apple or none. We have never shipped fewer than five, and canon §2.2
   already showed fourteen of our twenty-one lay their apples out in a line — i.e.
   most of our apples are furniture. Four of them could be deleted from several
   levels without changing anything except how busy the screen looks.
7. **Budget U3 (descending S-curves) as a long level and build more than one.**
   Seven of their fifty-four levels are in that family, and the two that open it
   are among the three longest in the set.
8. **Re-frame U2.** Elma's "bounce" is a suspension compression on any surface,
   not a wall rebound. Point the mechanics probe at that question instead.

---

## 7. Corrections to `level-design-canon.md`

These are claims in the existing canon that this pass could check against a
primary source. I have not edited that file.

| canon claim | verdict | evidence |
|---|---|---|
| "lessons are reprised 12–18 levels later" | **Not supported.** Verified gaps are 9, 18 and 31. | READ: Upside Down's page dates gravity's reprise to +9; Hangman→Hang Tight is +31 |
| U2 "wall-pop reversal", attributed to Elma's vocabulary as "braking at walls to change motion energy from one direction to another" | **Mis-attributed.** Elma's *bounce* is explicitly **not** hitting a polygon and rebounding; it is a suspension compression-and-release usable on almost any surface, exemplified on the flat in Uphill Battle. | READ, `Playing`, verbatim |
| "Overuse of gravity apples indicates weak underlying design" | **Confirmed, in weaker form.** The etiquette page says "Be careful with gravity. It is recommended to put an arrow next to the gravity apple to tell the direction" — a readability rule, not a quality judgement. The stronger quotation is not on the wiki. | READ, `Level Designing Etiquette` |
| "Holes too small for a wheel to enter — a specific etiquette failure" | **Confirmed, and it is subtler than stated.** The rule is about two polygons placed too close: "unexpected behaviour might happen, such as speeding up the bike unrealistically fast or completely stopping it. The result depends highly on the FPS and thus is most unfair." And per `Tuning`, whether a wheel can enter a sub-wheel hole *depends on frame rate* — internal 45 (Sink) and internal 27 (Shelf Life) both have WR routes that rely on it. | READ, `Level Designing Etiquette` + `Tuning` |
| "Invisible or unreadable geometry that surprises the player mid-jump" is a beginner failure | **Confirmed as a rule, and the internals break it.** The etiquette page forbids invisible polygons; internal 19 Turnaround's infobox lists its single killer as "**1 (hidden)**". | READ, both pages |
| "Speedloops… are generally considered boring and unwanted" | **Confirmed verbatim.** | READ, `Level Designing Etiquette` |
| "The majority's opinion of the suitable length for a hoylable level is 30–80 seconds" | **Consistent with the internals.** Their WRs run 10.7–82.8 s with a median of 23 s. But note the WR is the *floor*, not the typical time. | READ, 21 infoboxes |
| "Elma's physics keeps giving; techniques were still being named years after release" | **Confirmed.** `Advanced Tricks` lists eight player-invented techniques — bounce, brutal volt, wheel compression, o-bounce, deadbounce, Zweq-spin, Nekit-spin, piping — and **every one of the eight pages is a red link.** The vocabulary outran the documentation. | READ |
| Elmanager compares replays by "appletakes / left volts / right volts / supervolts / turns / groundtouches" | **Not verifiable here** — no Elmanager page exists on this wiki. The replay viewer I did see reports per-apple split times, which is a fingerprint of the same family. | SAW, replay-viewer screenshot |

**One thing the canon does not mention that changes how the set should be read:**
**levels 1–18 were the shareware demo** (READ, Spiral's page: "This is the last
level of unregistered Elma"). The shape of the first eighteen levels is a sales
curve as much as a teaching curve.

---

## 8. Sources, and how to reproduce

**API, which is open where HTML is blocked:**

```
https://elastomania.fandom.com/api.php?action=parse&page=<PAGE>&prop=wikitext&format=json
https://elastomania.fandom.com/api.php?action=query&list=allpages&aplimit=500&format=json
https://elastomania.fandom.com/api.php?action=query&generator=allimages&gailimit=500&prop=imageinfo&iiprop=url|size&format=json
```

with `curl -sS -L --max-time 25 -A '<desktop Chrome UA>'`. Image binaries come
from `static.wikia.nocookie.net` and time out perhaps one request in four; retry.

**Pages read in full:** Internal Level, Warm Up, Flat Track, Twin Peaks, Over and
Under, Uphill Battle, Long Haul, Hi Flyer, Tag, Tunnel Terror, The Steppes,
Gravity Ride, Islands in the Sky, Hill Legend, Loop-de-Loop, Serpents Tale, New
Wave, Labyrinth, Spiral, Turnaround, Upside Down, Hangman, Pipe (internal),
Animal Farm, Playing, Advanced Tricks, Level Editing, Level Designing Etiquette,
Tuning, Elasto Mania, EOL, Template:Level Table.

**Images looked at** (in
`scratch/`):
`elma-lv-01-WarmUp.jpg`, `elma-lv-01-small.jpg`, `elma-lv-02-FlatTrack-small.jpg`,
`elma-lv-Twin_Peaks.jpg`, `elma-lv-Over_and_Under.jpg`, `elma-lv-Uphill_Battle.jpg`,
`elma-lv-06-LongHaul.jpg`, `elma-lv-Hi_Flyer.jpg`, `elma-lv-Tag.jpg`,
`elma-lv-Tunnel_Terror.jpg`, `elma-lv-09-TunnelTerror2.jpg`, `elma-lv-TheSteppes.jpg`,
`elma-lv-Gravity_Ride.jpg`, `elma-lv-EOL.jpg`, `elma-editor2.jpg`,
`elma-leveleditor.png`, `elma-RM.png`, `elma-RMviewer.png`.

**Derived views generated for measurement** (same directory):
`sheet-minimaps.png` (all twelve minimaps as cropped), `sheet-minimaps-classified.png`
(the same, thresholded to solid/open with the player marker in magenta),
`sheet-mm3.png` and `sheet-tunnel-mm.png` (7× zooms with a centre crosshair),
`rule-wu.png`, `rule-tp.png`, `rule-eol.png` (10-px-grid pixel rulers over the bike).

**What could not be obtained, and would close the remaining gaps:**

- Any picture of levels 12–20 and 22–54. The wiki has none; neither does its
  image table. Forty-three of the fifty-four levels have never been seen here.
- Any text on Slalom, Bounce Back, Zig-Zag, Curvaceous or Hooked.
- Whether the minimap is whole-level or a scrolling window (§1.2). Ten minutes in
  a running Elma answers it; nothing on the wiki does.
- The Mopolauta forum threads the previous study quoted. Still behind Cloudflare;
  those quotations remain second-hand.
