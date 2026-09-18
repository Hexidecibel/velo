# Velo — mobile reachability audit

**Date:** 2026-09-18 · **Working tree at audit:** `0e6e803` plus a large uncommitted client workstream.
**Read at:** `src/client/touch.ts` as of 15:44 PDT, `src/client/keys.ts` as of 10:57, `src/client/style.css`
as of 15:37, `src/client/main.ts` as of 15:47.

> **These files were being edited while I read them.** Two agents were live in `src/client/` and
> `src/solver/` during this audit. `touch.ts` changed under me once mid-read — it grew `MM.cmdMin` and
> `oneRowW` between my first and second pass. Every line number below was re-checked against the
> timestamps above, but a number may have moved by the time you read this. The *arguments* are the
> durable part; the *line numbers* are not.

**Confidence markers, used on every claim:**

- **[verified]** — I read the code; the file:line is cited.
- **[measured]** — I ran `touchZones` from the real source through `tsx` on this box; the number is its
  output.
- **[inferred]** — reasoning from what I read. I did not execute it.
- **[needs a device]** — cannot be settled without running the app on real glass. Said out loud rather
  than guessed.

---

## The finding in one paragraph

The customiser was not a one-off. **Three player-facing capabilities have no touch path, and one of
them is worse than missing — it is a button that appears on a phone, is tappable, and does nothing.**
The results screen prints `leaderboard` on every finish [verified `results.ts:422`]; tapping it sets
`boardVisible = true` and refetches the board [verified `main.ts:1369-1375`]; and `body.touch #board {
display: none }` means nothing appears [verified `style.css:800-802`]. That is the same shape of bug as
the montage bound to `A` — an advertised control that reaches nothing — except this one is advertised
*on the device where it is dead*, which is worse.

**And the answer to "what should be promoted to permanent glass" is: nothing.** The permanent row is
exactly full. Three command pads need 234 px of the 250 px gutter on a 736 × 280 phone; a fourth needs
315 px, and at 315 the whole block — `restart` included — falls out of the gutter into the top-left
portrait branch, straight across the band the bike rides through [measured; the arithmetic is below].
That is precisely the failure `MM.cmdW = 12` was chosen to avoid [verified `touch.ts:306-317`], and it
would be re-introduced by *any* fourth permanent pad, regardless of what that pad does.

---

## The triage

Tiers, in the sense the brief set them:

- **P — permanent glass.** Used *during* a run. Costs screen forever.
- **D — behind `more`.** Needed, between runs.
- **K — keyboard-only is correct**, with a reason.
- **✗ — no path on any device**, or a path that does not work.

### Driving — the five sim bits

Every one is a permanent pad and every one earns it. Nothing to say.

| Capability | Desktop | Touch | Tier | Verdict |
| --- | --- | --- | --- | --- |
| flip | `space` / `shift` | `flip` pad, above the right cluster across a dead strip | **P** | Correct. The dead strip is load-bearing [verified `touch.ts:290-297`]. |
| gas | `↑` / `W` | `gas` pad, bottom-right corner | **P** | Correct. |
| brake | `↓` / `S` | `brake` pad, inboard of gas, tiled | **P** | Correct. |
| lean left | `←` / `A` | `lean ↺` pad | **P** | Correct. Tiled with lean-right, no dead strip. |
| lean right | `→` / `D` | `↻ lean` pad | **P** | Correct. |

### Playing

| Capability | Desktop | Touch | Tier | Verdict |
| --- | --- | --- | --- | --- |
| restart | `R` | `restart` pad, gutter | **P** | Correct. Die-and-retry, no `R` key. |
| whole level | `TAB` (hold) | `overview` pad (toggles) | **P** | Correct, and the precedent the rest of this table is judged against. |
| level chooser | `C` | `levels` drawer pad | **D** | Correct. |
| prev / next level | `[` / `]` | none directly; chooser (2 taps), or `next` on the results panel | **D** | **Correct — do not add pads.** `[`/`]` is an instant stepper for someone already holding a keyboard; on touch the same intent is served by `levels` and by the results panel's own `next`. A dedicated pair of pads would be two permanent pads for a between-runs action. |
| zoom | `+` / `−` / `0` | `zoom` drawer pad (resets to 1.0×) **and** a two-finger pinch in the play area | **D** + gesture | Correct, and the best-served capability in the game on touch: the pinch is continuous where the keys are stepped [verified `touch.ts:913-1000`]. |
| your bike / profile | `Y` | `your bike` drawer pad | **D** | **Now correct** — the pad landed today [verified `touch.ts:565`]. **But see gap 3:** `keys.ts:115` still has no `pad`, so the touch legend does not list it. |
| control legend | `?` | `controls` drawer pad | **D** | Correct, and the argument for it is stronger on a phone than a desktop [verified `touch.ts:570-576`]. |
| pause | `P` | none | **K** | **Correct.** `overview` freezes the sim and the clock through the same `hold` register [verified `main.ts:360`, `hold.add('overview', …)`], so a phone already has a pause — it just also shows you the level while it pauses. A second pad for the same freeze would be a pad that does less. |
| leaderboard + ghost picker | `B` | **none**, and a dead button | **✗** | **Gap 1.** See below. |
| sound on / off | `M` | **none** | **✗** | **Gap 2.** See below. |

### Screens and flows that are not keys

| Capability | Desktop | Touch | Tier | Verdict |
| --- | --- | --- | --- | --- |
| first-run profile offer | automatic, once | same, automatic | — | Correct [verified `main.ts:2645-2662`]. |
| your name | board panel field, or the customiser's field | customiser's field | **D** | Correct. Both routes go through one `onNameChosen` [verified `boardui.ts:119-123`, `lookui.ts:356`, `main.ts:2531-2534`]. |
| link a device / QR / claim code | board's `link a device`, or the customiser's `play as you on your phone too` | the customiser's button | **D** | Correct [verified `lookui.ts:389-393` → `main.ts:2542`]. The board route is desktop-only but the customiser route is not, so the capability survives the board being hidden. |
| adopt an identity from a claim URL | automatic on boot, with a confirm | same | — | Correct [verified `main.ts:2440-2466`]. |
| about page | `about` button in the legend header | same button — explicitly kept visible on touch | **D** | Correct, and deliberately so: `body.touch .lg-about { display: inline-block }` [verified `about.ts:325`]. |
| watch your run | `T`, or the results panel | results panel button | **D** | Correct. |
| watch the ghost's run | `G` on the results panel | results panel button | **D** | Correct. |
| the montage | `F`, or the results panel (≥2 attempts) | results panel button | **D** | Correct. The one `DEV` entry with a real player path, which is why it is in both lists. |
| watch a rival's run | board row `watch`, or a results row `watch` | results row `watch` | **D** | Partially correct: on touch you can only watch the rows the results panel prints (`RESULTS_ROWS`), not the whole board. Falls out of gap 1. |
| next / retry / close, after a finish | `Enter` / `R` / `Esc`, or buttons | buttons | **D** | Correct. Pads are hidden under the panel so its buttons are tappable [verified `main.ts:1325-1328`]. |
| chooser sort (order / difficulty) | buttons | same buttons | **D** | Correct. |
| full screen | — (no desktop equivalent) | `full screen` drawer pad, **not built** where the API is absent | **D** | Correct, and a good example: a control that cannot work is not built rather than built and dead [verified `touch.ts:566-567`, `canFullscreen`]. This is the standard gap 1 fails. |
| gas: auto / held | — (touch-only) | `gas: auto/held` drawer pad | **D** | Correct. |
| skip the opening peek | any input | any tap | — | Correct. |
| ghost picker (off / above / pb / wr) | board dropdown | **none** | **✗** | **Gap 4.** Default is `above` [verified `main.ts:261`], which is a good default, so this is a preference you cannot change rather than a capability you cannot use. |
| board category (human / TAS) | board buttons | **none** | **✗** | **Gap 5.** Information only — the TAS time already appears on the results panel [verified `resultsui.ts:126`]. Lowest-hurt of the lot. |
| board refresh | board `↻` | **none** | **✗** | Not a gap worth a slot: the board refetches on every finish. |

### The dev toolbar — keyboard-only, and that is the right answer

`H` `` ` `` `G` `V` `T` `E` `L` `F` `Q` are hidden on touch by three CSS rules that remove the chip, the
toggle and the whole dev bar [verified `style.css:832-834`], and `#hud` and `#levelbar` go with them
[verified `style.css:800-802`].

**This is correct and should not change**, for reasons that are specific rather than reflexive:

- **`H` tuning sliders** — a tuned bike cannot post a time [verified `keys.ts:153`]. Handing a phone
  player a control whose only effect is to silently invalidate their runs is a trap, not a feature.
- **`` ` `` readout, `G` collision, `V` art A/B** — these answer questions you ask while *building* the
  renderer. There is no version of a kid on a phone who wants the contact normals drawn.
- **`E` export / `L` import** — a file download and a file picker. `E` is a `<a download>` in a browser
  that may not have a visible filesystem; `L` is a drag target. [inferred] Both are technically
  reachable on some mobile browsers and useless on others, which is the worst of both.
- **`Q` editor** — the editor binds `A`, `S`, `D`, `Z` and the arrows in the capture phase and prints
  them on its own panel [verified `keys.test.ts:87-90`, `editor/index.ts:452-520`]. It is a keyboard
  application with a pointer for dragging, and porting it to thumbs is a project, not a pad.
- **`T` replay-last-run** is the one borderline case, and it is already served: the results panel offers
  `watch your run` on touch [verified `results.ts:412`].

**The dev toolbar being invisible on touch is the strongest thing in this audit.** It is the existing
proof that this codebase can say "not on a phone" and mean it, and it is why gaps 1, 2 and 4 read as
oversights rather than as decisions.

---

## The gaps, ordered by how much they hurt

### Gap 1 — the leaderboard is unreachable, and the results screen advertises it anyway

**[verified]** Three facts, each on its own line of source:

1. `body.touch #board { display: none }` — `style.css:801`. Unconditional; no state, no `:not()`.
2. `actionsFor()` pushes `{ id: 'board', key: 'B', label: 'leaderboard' }` with no touch condition —
   `results.ts:422`. The `ActionInput` it takes has no touch flag at all [verified `results.ts:366-392`,
   and the call site passes none — `main.ts:1316-1322`].
3. `resultsAction('board')` sets `boardVisible = true`, persists the flag, and refetches —
   `main.ts:1369-1375`. Every one of those succeeds. Nothing is drawn.

So on a phone, every finish prints a button labelled `leaderboard`, and pressing it does nothing
visible. **[inferred]** It also silently persists `board = true` to localStorage, so the next time that
player opens the game on a desktop the board is up whether they wanted it or not.

This is the highest-hurt gap for three reasons that compound. It is a **silent failure**, which is the
exact class `touch.ts` was written to eliminate ("a gesture that fails does so silently",
`touch.ts:260-264`). It is **the social half of the game** — where you stand, who you are racing — and
that is most of the reason to have posted a time at all. And it takes with it the ghost picker (gap 4)
and the category switch (gap 5), because the board panel is the only host for either.

**Tier: behind `more`.** Not permanent glass. Checking the board is the definition of a between-runs
action, and the results panel already covers "where do I stand" in the moment it matters — it prints
your standing line, the rows around you, and a `watch` button per row [verified `results.ts:269-330`,
`resultsui.ts:100-125`]. What is missing is the board *outside* a finish.

**Cost:** one drawer slot. That is the last one — see the budget.

**The smaller, cheaper half, if the slot is not wanted:** stop printing a dead button. `actionsFor`
takes an `ActionInput`; adding one field to it and gating the `board` push is a two-line change in a
pure function that is already tested in plain node. That removes the *lie* without spending any glass,
and it can ship independently of deciding whether the board itself gets a pad.

### Gap 2 — there is no way to turn the sound off from inside the game on a phone

**[verified]** `setMuted` has exactly two non-test callers: `KeyM` at `main.ts:3134`, and the
`window.velo` test surface at `main.ts:3453`. `keys.ts:116` gives `mute` no `pad`. There is no mute
control anywhere in the touch overlay, the customiser, the chooser or the results panel.

**[inferred, and this is the part that matters]** A phone has hardware volume keys, so this is not
"you cannot make it quiet". But the game ships **four engine sounds** as a customisation axis
[verified `appearance.ts:110`, `appearance.ts:183`], which means the game has an opinion about its own
audio, and the player has none. And on iOS the ringer switch does not mute WebAudio in Safari
[inferred, not tested here — **needs a device**], so "flick the switch" is not reliably the answer
either.

**Tier: not the drawer — the customiser.** This is the recommendation I am most confident about,
because it costs *nothing*. The customiser already owns `engine`; a `sound: on / off` row beside it is
a row in a panel that is already scrolling, it is discoverable by exactly the person who cares (someone
looking at engine noises), and it spends **zero** permanent or drawer glass. Spending the last drawer
slot on mute when the panel that owns sound is one tap away would be the wrong trade.

### Gap 3 — `keys.ts` does not know the `your bike` pad exists, so the touch legend omits it

**[verified]** `touch.ts:565` pushes `['look', 'your bike']` into the drawer. `keys.ts:115` is still
`{ id: 'look', codes: ['KeyY'], caps: ['Y'], title: 'your bike' }` — **no `pad` field**. And
`chrome.ts:356` reads:

```ts
if (touch && !c.pad) continue;
```

So the control legend on a phone — the one screen whose entire job is to teach a phone player what the
pads are, and the reason `controls` earned a drawer slot at all — does not list `your bike`, even
though the pad is right there in the drawer the player just opened.

**This is the smallest and most broken thing in the audit, and I have not touched it.** It is a
one-field data change (`pad: 'your bike'` on `keys.ts:115`), it is in a file another agent is actively
working in, and it is exactly the sort of edit that produces a merge conflict for no reason. **Place it
yourself.** It is also the perfect illustration of why the test in the last section should key off this
field: the pad and the legend are once again two hand-maintained copies of one truth, which is the
sentence at the top of `keys.ts`.

### Gap 4 — the ghost picker is unreachable on touch

**[verified]** `GHOST_KINDS = ['off', 'above', 'pb', 'wr']` [`ghost.ts:46`], selected only by the
board's `<select>` [`boardui.ts:243`], and the board is hidden. Default is `'above'`
[`main.ts:261`].

Lower hurt than it looks, because `above` — race whoever is one place ahead of you — is the right
default and is the one most players would pick. What a phone player cannot do is turn the ghost **off**,
which is the choice somebody learning a level actually wants. Falls out with the board; no separate
work.

### Gap 5 — the human / TAS category switch is unreachable on touch

**[verified]** `boardui.ts:96-97`. Information-only: the TAS time for the level is already printed on
the results panel [`resultsui.ts:126`]. Falls out with the board. Lowest priority in the audit.

### Gap 6 — the README's Controls table describes a desktop

**[verified]** `README.md:131` prints `| B | show/hide the leaderboard and ghost picker — open by
default |` with no touch caveat, while `TAB`, `+/-/0`, `C` and `?` all carry one in the same table
(lines 126-136). `keys.test.ts` parses this table for *key* agreement [`keys.test.ts:221-239`] and
cannot see the omission, because the omission is prose.

---

## The coverage arithmetic

**[measured]** All numbers below are `touchZones` from `src/client/touch.ts` as of 15:44, run through
`tsx`, summing `w × h` over every zone and dividing by `w × h` of the viewport. Viewport table is the
one `touch.test.ts:35-64` already uses. Default state: auto-throttle off, fullscreen available.

### What the pads cost today

| Viewport | | Closed | Hold pads | Commands | Drawer open |
| --- | --- | --- | --- | --- | --- |
| land-chrome | 915 × 348 | **18.75 %** | 15.08 % | 3.66 % | 25.26 % |
| land-full | 915 × 412 | 15.83 % | 12.74 % | 3.09 % | 21.33 % |
| land-iphone | 844 × 390 | 18.13 % | 14.59 % | 3.54 % | 23.27 % |
| land-small | 736 × 280 | **28.96 %** | 23.30 % | 5.66 % | 39.84 % |
| portrait | 412 × 800 | 14.20 % | 11.42 % | 2.77 % | 19.75 % |
| portrait-narrow | 360 × 640 | 14.87 % | 12.02 % | 2.85 % | 20.57 % |
| ipad11-land | 1194 × 834 | **4.50 %** | 3.62 % | 0.88 % | 6.26 % |
| ipad13-land | 1366 × 1024 | 3.21 % | 2.58 % | 0.63 % | 4.46 % |

The tablet figures match the 4–6 % the brief quotes. **The phone figure does not match the 17.7 % the
phone pass reported: I measure 18.75 % on 915 × 348 today.** [inferred] The difference is one permanent
command pad — dropping to two (`restart` + `more`, without `overview`) gives 17.52 % on the same
viewport, which is within rounding of the reported number. So 17.7 % is most likely a pre-`overview`
measurement, and **18.75 % is the honest current figure**. I have not tried to reconstruct the exact
historical run.

### What one more permanent pad costs

| Viewport | One 12 × 9 mm command pad | Closed coverage becomes |
| --- | --- | --- |
| land-chrome 915 × 348 | +1.22 % | 19.97 % |
| land-iphone 844 × 390 | +1.18 % | 19.31 % |
| land-small 736 × 280 | +1.89 % | **30.85 %** |
| ipad13-land | +0.21 % | 3.41 % |

**But the percentage is not the constraint, and quoting it alone would be the mistake the brief warns
about.** The constraint is a hard layout cliff:

| Viewport | Gutter width | 3 pads need | 4 pads need | Verdict |
| --- | --- | --- | --- | --- |
| land-chrome / land-full | 429 px | 234 px | 315 px | fits |
| land-iphone | 358 px | 234 px | 315 px | fits |
| **land-small 736 × 280** | **250 px** | **234 px** | **315 px** | **does not fit** |

`touchZones` takes the gutter branch only while `gutW >= rowW(cmdRow.length)` [verified
`touch.ts:682`]. At four permanent pads that test fails on 736 × 280, and the whole block — `restart`,
`more`, `overview` and the newcomer — drops through to the portrait branch at `touch.ts:724`, which
places it **top-left, below the HUD band, over the band the bike rides through**. That is the exact
layout the phone rewrite exists to remove, and it is the failure `MM.cmdW = 12` was chosen to avoid
[verified `touch.ts:306-317`]. The three permanent pads deliberately do not shrink [verified
`touch.ts:336-341`], so there is no give.

**Conclusion: the permanent-glass budget is full at three, and it is full by 16 pixels.** The only way
to a fourth permanent pad is to let the permanent row shrink too — 4 pads in 250 px is 55.75 px, which
is **9.3 mm**, above the 8 mm floor but well below the 12 mm chosen. That is a real option and it should
be a deliberate one; it is not a thing to discover by adding a pad. **Nothing in this audit is worth
it.**

### The drawer's own capacity — the question that changes everything below it

The drawer no longer wraps. As of today it shrinks its row to fit, down to `MM.cmdMin = 8 mm` [verified
`touch.ts:319-342`, `oneRowW` at `touch.ts:636-641`]. So capacity is the largest `n` with
`n × 8 mm + (n−1) × 1.5 mm ≤ room`.

**[measured]**

| Viewport | Room for the drawer row | Entries today | One-row capacity | Headroom |
| --- | --- | --- | --- | --- |
| land-chrome / land-full 915 | 429 px (gutter) | 6 | **7** | **1** |
| land-iphone 844 × 390 | 358 px (gutter) | 5 (no fullscreen on iOS) | **6** | **1** |
| land-iphone-class Android 844 | 358 px (gutter) | 6 | **6** | **0** |
| land-small 736 × 280 | 250 px gutter → capacity **4** | 6 | already over | — falls to the wide row |
| land-small, wide row above the clusters | 460 px | 6 | **8** | 2 |
| ipad11 / ipad13 | 773 / 945 px | 6 | 15 / 19 | plenty |

Read that carefully, because two things in it are surprising.

**First: the answer to "how many more drawer entries fit" is ONE.** A seventh entry takes the 844
px-wide class of phone below the 8 mm floor (`(358 − 54) / 7 = 43.4 px = 7.2 mm`), `oneRowW` returns 0,
and the drawer falls to the wide-row-above-both-clusters branch at `touch.ts:700-722` — which is out of
the cheap gutter glass and into the band the bike is framed in. An eighth does the same to the 915 px
phones.

**Second: 736 × 280 has already lost the gutter.** Its gutter holds 4 drawer entries; there are 6. It
is on the wide-row branch today, which the code argues is an acceptable transient state [verified
`touch.ts:700-706`] — and I agree with the argument, but it is worth saying plainly that the "even the
open state costs nothing" claim [`touch.ts:687-690`] is **true on 844 and 915 px phones and false on
736 × 280**, where opening the drawer puts a row of six pads across the middle of the level. That is
already the case before anything in this audit is added. [measured: at 736 × 280 the open drawer row
sits at y = 106 of 280, with the lean pads starting at y = 169.]

**So: one slot.** And gap 1 (the leaderboard) is the only gap in this audit that wants it. Mute goes in
the customiser precisely so that it does not compete for it; ghost picker and category ride in with the
board rather than taking slots of their own; `[`/`]` gets nothing. **If you also want `sound` on the
drawer, you are spending the slot the leaderboard needs, and one of the two then has to move into a
panel — which is the answer for mute anyway.**

---

## The regression test that stops this recurring

`keys.test.ts` asserts that every advertised **key** reaches a handler. Nothing asserts that every
player-facing **capability** reaches a thumb. This is the specification for the test that does.

### The hard part first: what counts as player-facing

This is the judgement the brief is right to call out, and **the repo has already made it** — that is the
whole point of `keys.ts` splitting `DRIVE` + `PLAY` from `DEV` [verified `keys.ts:89-97`, `keys.ts:134-151`].
The test must key off *that* split rather than inventing a heuristic of its own. A heuristic would be
either noise (flagging `G` collision overlay) or a rubber stamp (accepting anything with a pad).

So the rule is:

> **A capability is player-facing iff it is in `DRIVE` or `PLAY`, or it appears in a new `SCREENS`
> list.** `DEV` is not player-facing, by definition, and asserting otherwise is out of scope.

That handles keys. It does not handle the half of this audit that is not a key — the board's ghost
picker, the customiser's name field, the `link a device` button, the about page, the results panel's
own actions. Those need a registry, because a test cannot infer "this is a capability" from a DOM node
it has no DOM to inspect (there is no jsdom in this repo — stated at `keys.test.ts:27-31` and observed
in `boardui.ts:1-18`).

### The shape

**Step 1 — make `Control.pad` a declaration, not a note.**

Change `Control` so that every `PLAY` entry must carry exactly one of:

```ts
pad: string;              // the label of the touch zone that does this
touch: { none: string };  // a REASON this is keyboard-only, in the player's words
```

A `PLAY` entry with neither fails to compile. This is the same trick `keys.ts` already plays with
`codes: []` meaning "thumb only" [verified `keys.ts:36-40`] — it forces the judgement into the data
where a test can see it, instead of leaving it in somebody's head.

`pause` gets `touch: { none: 'the overview pad already freezes the sim' }` and passes. `mute` and
`board` do not have an answer today, which is the point: **the test fails on the current tree**, and
that is how you know it is worth building.

**Step 2 — assert every declared `pad` is a pad that exists.**

Pure, no DOM. For every `PLAY` control with a `pad`, assert that some reachable touch state produces a
zone whose `label` is that string. "Reachable" is the cross-product the layout already has:

```
viewport ∈ touch.test.ts's VIEWPORTS          (11 of them)
menu     ∈ {false, true}
overview ∈ {false, true}
auto     ∈ {false, true}
fullscreen ∈ {'none', 'off', 'on'}
```

Assert both directions:

- every declared `pad` label is produced by at least one state, **and**
- every `command: true` zone label produced by any state is either a declared `pad`, or in a short
  explicit allowlist of touch-only commands (`more` / `close`, `gas: auto` / `gas: held`, `full screen`
  / `exit full`, `ride`, and `zoom N.N×`, which is generated).

The second direction is the one that catches the reverse drift — a pad added to `touch.ts` that
`keys.ts` never learns about — which is **exactly gap 3**, live in the tree right now.

The `zoom` label is generated by `zoomLabel(bias)` [verified `touch.ts:406-408`], so match it with the
same function rather than a literal, or the test breaks the first time somebody changes the format.

**Step 3 — the `SCREENS` registry, for capabilities that are not keys.**

A new exported list in `keys.ts` (it is already the file that holds "truth about what this game
advertises", and it stays pure data with no imports):

```ts
export interface Screen {
  id: string;             // 'ghostPicker', 'linkDevice', 'about', 'name', …
  title: string;          // in the player's words
  desktop: Reach;         // how you get there with a keyboard and a mouse
  touch: Reach | { none: string };
}

type Reach =
  | { pad: string }            // a touch zone label
  | { key: string }            // a KeyboardEvent.code, cross-checked against DRIVE/PLAY/DEV
  | { el: string };            // a CSS selector for the button or field that does it
```

Populating it is a one-time act of judgement — the triage table at the top of this document *is* the
initial contents — and after that it is a diff a reviewer can read.

**Step 4 — the assertion that would have caught gap 1: a declared `el` must not be hidden on touch.**

This is the valuable, buildable, source-text half, in the same spirit as `keys.test.ts`'s handler scan.

Parse `style.css` for every rule whose selector list contains `body.touch` **and** whose body sets
`display: none`. Collect the selectors. For each `Screen` whose touch reach is `{ el }`, fail if that
selector — or any ancestor selector in it — appears in that set.

Three details that decide whether this test is worth having:

1. **Guard the parse against matching nothing.** `keys.test.ts` already learned this the hard way
   [`keys.test.ts:27-31`]. Assert the scan found at least, say, 3 hiding rules, and assert specifically
   that `#levelbar` is among them — a known-true fact that will stay true, so a regex that silently
   stops matching fails loudly instead of passing for free.
2. **State-qualified rules are not hides.** `body.touch #legend:not(.lg-open) { display: none }`
   [verified `style.css:828`] hides the legend *while it is closed*, which is not the same as hiding it.
   Any selector carrying a `:not(...)`, a state class, or a pseudo-class must be **skipped**, and the
   skip must be explicit and commented, or the test will flag the legend forever and get disabled.
3. **Also scan the reverse.** `about.ts:325` un-hides `.lg-about` on touch. A rule that sets
   `display:` to anything other than `none` under `body.touch` should clear a hide inherited from a
   broader selector. [inferred] In practice today no pair of rules interacts this way, so implement it
   as: collect hides, collect un-hides, subtract. Cheap, and it stops a false positive that would
   otherwise land the day somebody re-hides and re-shows something.

**Step 5 — the results panel's action list.**

`actionsFor` is pure and already tested in plain node [verified `results.test.ts`]. Give `ActionInput`
a `touch: boolean`, and assert: **for every action id the list can produce with `touch: true`, there is
a `Screen` or `Control` entry whose touch reach is non-`none`.** That is the assertion that fails on
today's `board` action. It is also the assertion that keeps the results panel honest as the one place
on a phone where `watch your run`, `watch the ghost` and `the montage` are reachable at all.

### What this test deliberately does not do

- **It does not demand parity.** `DEV` is out of scope by construction, and `PLAY` entries can opt out
  with a reason string. The test's job is to make the opt-out *visible and deliberate*, not to prevent
  it.
- **It does not check that a pad is reachable by a thumb** — `touch.test.ts` already owns geometry,
  overlap, thumb reach and the HUD band, and it does it well. This test is about *existence*, not
  *placement*.
- **It does not look at the DOM.** Everything above is pure functions plus source-text scanning, which
  is the house rule for this repo and the reason `keys.test.ts` works at all.

### One more assertion, cheap and worth it

`touch.test.ts:225` currently asserts the open-drawer command set equals a hard-coded array of nine ids.
That is a snapshot, and a snapshot goes green forever once somebody updates it. **Add the budget as a
test instead:**

- assert the drawer lays out as **one row inside the gutter** on 915 × 348 and 844 × 390 in every
  fullscreen state — this is the assertion that fails the moment a seventh entry is added, and it turns
  the "one slot" finding above into something the build enforces;
- assert `rowW(permanentCommands) <= gutW` on 736 × 280 — this is the assertion that fails the moment a
  fourth permanent pad is added, which is the cliff `MM.cmdW = 12`'s comment describes but nothing
  currently checks from the *pad count* side.

---

## Things I could not settle from the code

- **[needs a device]** Whether the claim panel's tap-to-select-the-code gesture [`claimui.ts:148-155`]
  actually raises a copy affordance on iOS Safari and Android Chrome. A programmatic `Range` selection
  does not always produce the selection handles that a user-initiated one does. The typed-code fallback
  works regardless, so this is a polish question, not a reachability one.
- **[needs a device]** Whether iOS's ringer switch silences this game's WebAudio. It affects how much
  gap 2 actually hurts, not whether it is real.
- **[needs a device]** Whether the customiser panel — 7 axes, 34-plus option chips, capped at
  `max-height: 88vh` [verified `style.css:1229`] — is comfortably scrollable at 280 px of height. The
  CSS has clearly been worked on for touch [`style.css:1229-1243`]; whether it lands is a picture, not
  an argument.
- **[verified, but flagged rather than judged]** `main.ts:2636-2641` claims "bin/smoke asserts that THIS
  panel, opened by the real pad in the real bundle, actually lands in it". The smoke harness calls
  `window.velo.openLook()` [verified `bin/_smoke.mjs:942-945`], which is the API and not the pad. That
  may be mid-edit as I write this; worth a glance once the in-flight work settles.
