// THE ABOUT PAGE, WHICH IS THE ONE SCREEN IN THIS GAME THAT IS PURE PRESENTATION.
//
// Nobody is riding while this is up, so the house rule the rest of the client
// bends to — the player and the collision edge are the two highest-contrast
// things on screen, everything else is deliberately drab — does not apply here.
// The rule it DOES keep is the other half of that sentence: this has to look
// like the same program as the canvas behind it. So every colour comes from the
// level's own palette or from the CSS variables that were derived from it, the
// masthead is set in the game's own stroke alphabet (art/letters.ts, the same
// one that paints signage onto the walls), and the bikes are the real bike,
// drawn by the real renderer at the size being argued about.
//
// THE COPY IS THE USER'S, VERBATIM. It is lowercase on purpose and it stays
// that way. What this file adds is not words — it is weight: the numbers come
// out of the prose and get set as numbers, and the one comparison that can be
// drawn instead of read (their bike is 17 % of the screen, ours was 6.6 %) is
// drawn. A reader who SEES that difference has already understood the section.
//
// WHY IT OWNS ITS OWN STYLESHEET. Everything else in the client is styled from
// style.css. This page carries its `<style>` with it, so the page and the rules
// that lay it out are one file that can be read, moved or deleted in one piece,
// and so a stat row can never be left behind by a selector rename in a file
// eight hundred lines away. The same argument legendart.ts makes about drawing
// its own pictures rather than shipping icons.
//
// NOTHING HERE IS AN innerHTML SINK. Every string below reaches the document
// through `textContent`, including the inline emphasis, which is parsed into
// runs (`inline`) and then built out of real elements. The copy is static today;
// the point is that it stays safe on the day somebody makes it not static.
import { cloneSpec } from '@/sim/spec.ts';
import { textOutline } from './art/letters.ts';
import type { Palette } from './art/palette.ts';
import type { BikeLook } from './art/bikeart.ts';
import { headDrawRadius } from './art/bikeart.ts';
import { POSES, legendPose, poseBounds, poseUrl } from './legendart.ts';
import { BOOT_PRESET } from './presets.ts';

// --- the copy ----------------------------------------------------------------
//
// Data, not markup, for the reason every other list of truth in this client is
// data (keys.ts, DRIVE, PLAY): the thing that renders it and the thing that
// tests it then read the same source. `*single asterisks*` are emphasis and
// `**double**` are strong, which is how the copy arrived and is therefore how
// it can be edited back.

/** One chunk of the page, in the order it is read. */
export type Block =
  | { kind: 'p'; text: string }
  /** A line that is a beat on its own. Two of them, both the user's rhythm. */
  | { kind: 'pull'; text: string }
  /** The drawn size comparison, and the sentence it is a picture of. */
  | { kind: 'scale' }
  /** The three remaining measurements, as numbers. */
  | { kind: 'stats' }
  | { kind: 'labelled'; items: readonly Labelled[] };

export interface Labelled {
  /** The word the copy already puts in front of the colon. */
  label: string;
  /** `yes` is what we took, `no` is what we did not. Colour, nothing else. */
  tone: 'yes' | 'no';
  text: string;
}

export interface Section {
  title: string;
  blocks: readonly Block[];
  /** The credit at the end sits apart and reads quieter. */
  quiet?: boolean;
}

/**
 * A measured pair, hoisted out of its sentence so it can be set as a number.
 *
 * The sentence keeps the number too — the prose below is the user's, unedited —
 * and that repetition is deliberate: the display is what you see, the sentence
 * is what you read, and a reader who only does one of those still gets it.
 */
export interface Stat {
  a: { value: string; label: string };
  b: { value: string; label: string };
  /**
   * `vs` when the two are rivals, `to` when they are the same thing over time.
   *
   * A word rather than an arrow, and that is a screenshot talking: this page is
   * set in the client's monospace stack, which has no `→` and substitutes a
   * hairline dash for it at a third of the size of the numbers either side.
   */
  join: string;
  /** What the pair is counted in, when the values do not say so themselves. */
  unit?: string;
  text: string;
}

/**
 * THE ONE MEASUREMENT THAT IS BETTER DRAWN THAN READ.
 *
 * `frac` is the number in `value`, as a fraction, and that is not a convenience
 * — it is the invariant. The strips are drawn by multiplying `frac` by the
 * strip's own width, so the picture cannot disagree with the percentage printed
 * on it unless somebody changes one and not the other, which is exactly what
 * `about.test.ts` refuses to let happen.
 */
export const SCALE = {
  a: { value: '17%', label: 'elma', frac: 0.17 },
  b: { value: '6.6%', label: 'velo', frac: 0.066 },
  text: 'their bike is **17% of the screen**. ours was 6.6%. we were playing on a map, they were playing on a bike.',
} as const;

export const STATS: readonly Stat[] = [
  {
    a: { value: '9.8 m', label: 'elma' },
    b: { value: '25.8 m', label: 'velo' },
    join: 'vs',
    text: 'they show you **9.8 m** of world. we were showing 25.8.',
  },
  {
    a: { value: '0.7', label: 'elma' },
    b: { value: '1.8', label: 'velo' },
    join: 'vs',
    unit: 'bike-lengths',
    text: 'their ground changes direction every **0.7 bike-lengths**. ours did it every 1.8. theirs is *busier* than ours, not simpler.',
  },
  {
    a: { value: '87 m', label: 'level 1' },
    b: { value: '428 m', label: 'level 14' },
    join: 'to',
    text: 'and our levels got longer as they got "harder" — 87 m at level 1, 428 m by level 14 — while the number of apples never moved. we\'d been making them *further*, not harder.',
  },
];

export const SECTIONS: readonly Section[] = [
  {
    title: 'where this came from',
    blocks: [
      {
        kind: 'p',
        text: 'i grew up playing elasto mania. the levels were *hard*. and not hard like "do this jump 40 times" hard — hard like you\'d sit there and go, ok, how am i even supposed to do this. figure that out, feel like a genius for about nine seconds, and then realise you did it ugly and there\'s a way better line in there somewhere.',
      },
      { kind: 'pull', text: 'that second part is where all the hours went.' },
      {
        kind: 'p',
        text: 'that\'s the whole thing right there. a level you can beat is fine. a level where you beat it and immediately go *"ok no, i can do that way cleaner"* — that\'s the one you\'re still riding a week later.',
      },
      { kind: 'pull', text: 'so i wanted to make that. with my new skills.' },
    ],
  },
  {
    title: 'then we took it apart',
    blocks: [
      { kind: 'p', text: 'turns out the kid was onto something measurable. we pulled the old screenshots apart with pixel rulers:' },
      { kind: 'scale' },
      { kind: 'stats' },
      { kind: 'p', text: 'so we fixed it, and the six newest levels are all built to those numbers instead of to vibes.' },
    ],
  },
  {
    title: 'what we took, and what we didn\'t',
    blocks: [
      {
        kind: 'labelled',
        items: [
          { label: 'took', tone: 'yes', text: 'apples and a flower, a head that kills you, and go in whatever order you like. the ideas.' },
          { label: 'didn\'t take', tone: 'no', text: 'a single polygon. not one. their levels are theirs, and honestly their tolerances wouldn\'t even fit — different bike, different scale.' },
        ],
      },
    ],
  },
  {
    title: 'what\'s ours',
    blocks: [
      {
        kind: 'p',
        text: 'a solver that plays every level before you do, so nothing ships that can\'t be finished. replays stored as button presses and re-run on the server, so a time on the board is a time somebody actually rode. and levels that get generated and then *filtered*, because 100 levels is only good if they\'re 100 different levels.',
      },
    ],
  },
  {
    title: 'and',
    quiet: true,
    blocks: [
      { kind: 'p', text: 'elasto mania, balázs rózsa, 2000. and action supercross before it, 1997. thanks for the hours.' },
    ],
  },
];

// --- the two pure bits, so the page can be asserted without a browser --------

export interface Run {
  text: string;
  /** '' is plain, 'em' is `*this*`, 'strong' is `**this**`. */
  tag: '' | 'em' | 'strong';
}

/**
 * Inline emphasis, as runs.
 *
 * Deliberately the smallest parser that reads the copy as it was written and
 * nothing more: no links, no code, no nesting. It returns TEXT, never markup,
 * which is the whole reason the renderer downstream of it can be `textContent`
 * and an element per run rather than an `innerHTML` assignment.
 *
 * An unclosed marker is left alone rather than swallowing the rest of the
 * paragraph — a typo in the copy should look like a stray asterisk, not like
 * half a section going italic.
 */
export function inline(src: string): Run[] {
  const out: Run[] = [];
  let plain = '';
  let i = 0;
  const flush = (): void => {
    if (plain) out.push({ text: plain, tag: '' });
    plain = '';
  };
  while (i < src.length) {
    if (src[i] === '*') {
      const double = src[i + 1] === '*';
      const mark = double ? '**' : '*';
      const from = i + mark.length;
      const end = src.indexOf(mark, from);
      // `end > from` and not `>= from`: `**` with nothing between it is two
      // stray asterisks, not an empty strong run.
      if (end > from) {
        flush();
        out.push({ text: src.slice(from, end), tag: double ? 'strong' : 'em' });
        i = end + mark.length;
        continue;
      }
    }
    plain += src[i];
    i++;
  }
  flush();
  return out;
}

/**
 * How big to draw the bike inside a strip that is `stripW` CSS px across.
 *
 * `poseUrl` fits the bike's bounding box into the box it is handed with 18 % of
 * air around it (`pad` in legendart.ts), so a strip that wants the bike itself
 * to be `frac` of its width has to ask for a box `pad` times bigger. Without
 * this the drawn bike is 15 % narrower than the percentage printed beside it,
 * which is a figure that quietly lies about its own caption.
 *
 * The floor exists because the small bike is 6.6 % of the strip: at the narrow
 * end of a portrait phone that is eleven pixels, and a picture that has
 * collapsed into a smudge is not evidence of anything. Eighteen px is about the
 * smallest the two wheels and the head still read as a bike — and hitting the
 * floor makes the comparison UNDERSTATE the difference, never overstate it,
 * which is the right way round for a figure that is making an argument.
 */
export const SCALE_PAD = 1.18;
export const SCALE_MIN_PX = 18;

/**
 * How wide the ridden bike is against how tall, from the SPEC and nothing else.
 *
 * The same bounding box `poseUrl` frames on — the two wheel circles, the head
 * sphere and the chassis box, out of `poseBounds` — so the strip can be made
 * exactly tall enough for the bike it is about to be handed. Guessing this
 * number is what the first version did, and it cropped the big bike's head off
 * at every viewport under 430 px tall.
 *
 * Constant for the life of the page and independent of the livery:
 * `headDrawRadius` takes the spec's own head radius and ignores the helmet, and
 * the spec here is the SHIPPED one, so no slider can move it either.
 */
const SPEC = cloneSpec(BOOT_PRESET.spec);
const RIDE_BOX = poseBounds(SPEC, legendPose(SPEC, POSES.ride), headDrawRadius(SPEC, ''));
export const RIDE_ASPECT = (RIDE_BOX.maxX - RIDE_BOX.minX) / (RIDE_BOX.maxY - RIDE_BOX.minY);

/** The terrain band at the bottom of a strip, in CSS px. Matches the CSS. */
export const STRIP_FLOOR_PX = 15;
/** Clearance above the bike for the name-and-percentage chip. */
export const STRIP_TOP_PX = 24;

export function scaleBox(stripW: number, frac: number): { w: number; h: number } {
  const w = Math.max(SCALE_MIN_PX, Math.round(stripW * frac * SCALE_PAD));
  // Not square. The box is the bike's own proportions plus the same air on
  // every side, which makes the WIDTH the axis `poseUrl` binds on — and the
  // width is the axis the percentage is about.
  return { w, h: Math.ceil(w / RIDE_ASPECT) };
}

/**
 * How tall a strip has to be to hold the bigger of the two bikes.
 *
 * Set from JavaScript rather than from the stylesheet because it depends on the
 * strip's measured width, which depends on the viewport — and a fixed height in
 * CSS is exactly the arithmetic-over-pictures move that has shipped a broken
 * layout on this project every time it has been tried.
 */
export function stripHeight(stripW: number): number {
  const ink = scaleBox(stripW, SCALE.a.frac).h / SCALE_PAD;
  return Math.round(STRIP_FLOOR_PX + ink + STRIP_TOP_PX);
}

// --- the stylesheet ---------------------------------------------------------
//
// One `<style>`, installed once, carrying both the page and the one button in
// the control legend that opens it. `.lg-about` lives here rather than in
// style.css on purpose: it is part of this feature, and a switch whose styling
// is in a file the feature does not own is a switch that goes invisible the
// next time somebody tidies that file.

const STYLE_ID = 'about-css';

const CSS = `
/* the way in, in the legend's header, between the dev switch and the close */
.lg-about {
  padding: 1px 8px;
  background: #221d42;
  border: 1px solid var(--line);
  border-radius: 3px;
  color: var(--dim);
  font: inherit;
  font-size: 10px;
  letter-spacing: .08em;
  cursor: pointer;
}
.lg-about:hover { color: var(--accent); border-color: #6b5a20; }
/* Not hidden with the dev switch. A phone has no keyboard and no dev toolbar,
   and this is the one thing in that header a player on a phone wants. */
body.touch .lg-about { display: inline-block; }

#about {
  position: fixed;
  inset: 0;
  z-index: 8;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--ink);
  /* The whole point of the readability rule is that the canvas wins. There is
     no canvas to lose to here — this is opaque and it is the page. */
  text-shadow: none;
}
#about[hidden] { display: none !important; }

/* THE SKY IS THE LEVEL'S SKY. Painted from the palette's own wall ramp, so the
   page you are reading belongs to the level you were riding. It is a wash
   behind the text and never under it: the scrim keeps the body copy on a flat
   ground no derived palette can brighten. */
.ab-sky {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.ab-scrim {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(180deg, #0d0b1acc 0%, #0d0b1af2 46%, var(--bg) 78%);
}

.ab-head {
  position: relative;
  z-index: 2;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px 6px 12px;
  background: #0d0b1aee;
  border-bottom: 1px solid var(--line);
}
.ab-mark { color: var(--accent); letter-spacing: .22em; text-transform: uppercase; font-size: 10px; }
.ab-crumb { flex: 1 1 auto; color: #6b6390; font-size: 10px; letter-spacing: .1em; }
.ab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  /* A THUMB TARGET, not a 13 px glyph. The legend's own close glyph is 13 px because a
     mouse is on it; this page is read on a phone, at arm's length, one-handed. */
  min-width: 62px;
  min-height: 30px;
  padding: 0 10px;
  background: #221d42;
  border: 1px solid var(--line);
  border-radius: 3px;
  color: var(--ink);
  font: inherit;
  font-size: 11px;
  letter-spacing: .1em;
  cursor: pointer;
}
.ab-close:hover { border-color: var(--edge); color: var(--edge); }
#about button:focus-visible,
.ab-scroll:focus-visible,
.lg-about:focus-visible { outline: 2px solid var(--edge); outline-offset: 1px; }

/* THE SCROLLER IS THE PAGE. Its own element rather than the overlay, so the
   header can be pinned outside it and the way out stays on screen at 348 px
   tall with three hundred words under it. */
.ab-scroll {
  position: relative;
  z-index: 1;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  outline: none;
}
.ab-col {
  position: relative;
  max-width: 640px;
  margin: 0 auto;
  padding: 14px 16px 54px;
}

/* --- the masthead: the game's own alphabet, riding its own ground ---------- */
.ab-mast { position: relative; margin: 2px 0 26px; }
.ab-word { display: block; width: 100%; height: auto; }
.ab-ground {
  position: relative;
  height: 17px;
  border-radius: 0 0 2px 2px;
}
.ab-mastbike {
  position: absolute;
  right: 5%;
  display: block;
}

.ab-sec { margin: 0 0 26px; }
.ab-sec.quiet { margin-top: 34px; padding-top: 18px; border-top: 1px solid var(--line); }
.ab-h { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; }
.ab-h b {
  flex: 0 0 auto;
  color: var(--accent);
  font-weight: normal;
  font-size: 13px;
  letter-spacing: .05em;
}
.ab-h i { flex: 1 1 auto; height: 1px; background: linear-gradient(90deg, var(--line), #0d0b1a00); }
.ab-sec.quiet .ab-h b { color: var(--dim); }

.ab-p {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.78;
  color: var(--ink);
}
.ab-sec.quiet .ab-p { color: var(--dim); font-size: 12px; }
.ab-p em { font-style: normal; color: var(--accent); }
.ab-p strong { font-weight: 700; color: #fff6e8; }

/* The two beats. The user's copy sets them on their own line; this makes that
   visible instead of leaving them as two short paragraphs among four. */
.ab-pull {
  margin: 16px 0 18px;
  padding: 2px 0 2px 14px;
  border-left: 2px solid var(--accent);
  color: #fff6e8;
  font-size: 15px;
  line-height: 1.62;
}

/* --- the drawn comparison ------------------------------------------------- */
.ab-scale { margin: 6px 0 14px; display: flex; flex-direction: column; gap: 7px; }
.ab-strip {
  /* The height is set from about.ts, off the strip's own measured width: the
     bike in it is a fixed fraction of that width, and a height pinned in CSS
     cropped the big one at every viewport under 430 px tall. This is only the
     floor for the first frame, before anything has been measured. */
  position: relative;
  min-height: 74px;
  border: 1px solid var(--line);
  border-radius: 3px;
  overflow: hidden;
}
.ab-stripbg { position: absolute; inset: 0; }
.ab-stripfloor { position: absolute; left: 0; right: 0; bottom: 0; height: 17px; }
.ab-bike { position: absolute; display: block; }
.ab-tag {
  position: absolute;
  left: 7px;
  top: 6px;
  display: inline-flex;
  align-items: baseline;
  gap: 7px;
  padding: 1px 7px 2px;
  background: #0d0b1acc;
  border: 1px solid #ffffff1f;
  border-radius: 3px;
}
.ab-tagname { color: var(--dim); font-size: 9px; letter-spacing: .16em; text-transform: uppercase; }
.ab-tagnum { font-size: 15px; line-height: 1.2; font-variant-numeric: tabular-nums; }
.ab-strip.a .ab-tagnum { color: var(--accent); }
.ab-strip.b .ab-tagnum { color: var(--dim); }

/* --- the numbers ---------------------------------------------------------- */
.ab-stats { display: flex; flex-direction: column; gap: 8px; margin: 0 0 14px; }
.ab-stat {
  display: grid;
  /* 182 px, not 158. At 158 the widest pair on the page — 9.8 m vs 25.8 m —
     broke across two lines on an iPad, which turned the one part of the card
     that is supposed to be read at a glance into the part that had to be
     puzzled out. Found in a screenshot; no arithmetic predicted it. */
  grid-template-columns: 182px 1fr;
  gap: 6px 16px;
  align-items: center;
  padding: 10px 13px;
  background: #17132ecc;
  border: 1px solid var(--line);
  border-left: 2px solid var(--accent);
  border-radius: 3px;
}
.ab-figure { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.ab-nums { display: flex; align-items: flex-end; gap: 9px; }
.ab-num { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.ab-n { font-size: 20px; line-height: 1.1; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ab-num.a .ab-n { color: var(--accent); }
.ab-num.b .ab-n { color: var(--dim); }
.ab-lab { color: #6b6390; font-size: 9px; letter-spacing: .14em; text-transform: uppercase; }
.ab-join { color: #7a72a8; font-size: 13px; line-height: 1; padding-bottom: 14px; }
.ab-unit { color: #6b6390; font-size: 9px; letter-spacing: .12em; text-transform: uppercase; }
.ab-say { font-size: 12.5px; line-height: 1.7; color: var(--ink); }
.ab-say em { font-style: normal; color: var(--accent); }
.ab-say strong { font-weight: 700; color: #fff6e8; }

/* --- took / didn't take --------------------------------------------------- */
.ab-took { display: flex; flex-direction: column; gap: 9px; margin: 0 0 12px; }
.ab-item { display: grid; grid-template-columns: 92px 1fr; gap: 4px 14px; align-items: baseline; }
.ab-key {
  justify-self: start;
  padding: 1px 8px 2px;
  border: 1px solid;
  border-radius: 3px;
  font-size: 10px;
  letter-spacing: .1em;
  white-space: nowrap;
}
.ab-key.yes { color: #9dff3d; border-color: #3f6b1d; background: #16240c; }
.ab-key.no { color: #ff6a1f; border-color: #6b3a1d; background: #26140c; }

/* --- narrow: everything becomes one column -------------------------------- */
@media (max-width: 560px) {
  .ab-col { padding: 12px 13px 44px; }
  .ab-stat { grid-template-columns: 1fr; gap: 7px; }
  .ab-item { grid-template-columns: 1fr; gap: 3px; }
  .ab-p { font-size: 12.5px; }
  .ab-pull { font-size: 14px; }
}
/* --- short: a landscape phone is 348 px tall and this page is longer ------- */
@media (max-height: 430px) {
  .ab-mast { margin-bottom: 16px; }
  .ab-sec { margin-bottom: 20px; }
  .ab-col { padding-top: 9px; padding-bottom: 26px; }
  .ab-pull { margin: 12px 0 14px; }
}
`;

function installStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  // A constant in this module, never anything from the network, a level file or
  // a player. See the header note: this is the only string in the file that is
  // not `textContent`, and it is the one string that can never be dynamic.
  el.textContent = CSS;
  document.head.append(el);
}

// --- the page ---------------------------------------------------------------

export interface AboutOpts {
  /** No keyboard: the close button says `close` rather than naming Escape. */
  touch: boolean;
  /** Read late, like the legend's: both the palette and the livery move. */
  palette(): Palette;
  look(): BikeLook;
  /**
   * What to put the keyboard back on when this closes — the button that opened
   * it, in practice.
   *
   * Remembering `document.activeElement` on the way in is not enough and the
   * headless probe caught it: a click does not focus the button it went
   * through, so the thing remembered was the body, focusing the body is a
   * no-op, and the keyboard was left sitting on a close button inside a hidden
   * element with nowhere to go but the start of the document.
   */
  returnFocus?(): HTMLElement | null;
}

export interface About {
  readonly open: boolean;
  setOpen(on: boolean): void;
  toggle(): void;
  /** The level palette or the livery moved; repaint what is drawn. */
  refresh(): void;
  /** For chrome.ts's tests and for `bin/shots`. */
  readonly root: HTMLElement;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A paragraph's runs, as elements. Never `innerHTML`; see the header note. */
function runsInto(host: HTMLElement, src: string): void {
  for (const r of inline(src)) {
    if (r.tag === '') host.append(document.createTextNode(r.text));
    else host.append(el(r.tag, undefined, r.text));
  }
}

export function createAbout(opts: AboutOpts): About {
  installStyles();

  const root = el('section', undefined);
  root.id = 'about';
  root.hidden = true;
  root.setAttribute('aria-label', 'about velo');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');

  const sky = el('div', 'ab-sky');
  const scrim = el('div', 'ab-scrim');

  const head = el('header', 'ab-head');
  head.append(el('span', 'ab-mark', 'velo'), el('span', 'ab-crumb', 'about'));
  const close = el('button', 'ab-close');
  close.type = 'button';
  // A device with no keyboard must not be told to press one — the same rule
  // capsFor() keeps in the legend and the death banner keeps in the art.
  close.textContent = opts.touch ? 'close' : 'close  esc';
  close.setAttribute('aria-label', 'close');
  head.append(close);

  const scroll = el('div', 'ab-scroll');
  // Focusable so the arrows, space and page keys can scroll it — every one of
  // which is sim input that this page takes off the bike while it is up.
  scroll.tabIndex = 0;
  const col = el('div', 'ab-col');
  scroll.append(col);

  // --- the masthead ---------------------------------------------------------
  const mast = el('div', 'ab-mast');
  const word = document.createElement('canvas');
  word.className = 'ab-word';
  const ground = el('div', 'ab-ground');
  const mastBike = document.createElement('img');
  mastBike.className = 'ab-mastbike';
  mastBike.alt = '';
  mast.append(word, ground, mastBike);
  col.append(mast);

  // --- the scale strips, filled in by `paint` ------------------------------
  const strips: { wrap: HTMLElement; bg: HTMLElement; floor: HTMLElement; img: HTMLImageElement; frac: number }[] = [];

  function scaleBlock(): HTMLElement {
    const wrap = el('div', 'ab-scale');
    for (const [side, s] of [['a', SCALE.a], ['b', SCALE.b]] as const) {
      const strip = el('div', `ab-strip ${side}`);
      const bg = el('div', 'ab-stripbg');
      const floor = el('div', 'ab-stripfloor');
      const img = document.createElement('img');
      img.className = 'ab-bike';
      img.alt = '';
      const tag = el('span', 'ab-tag');
      tag.append(el('span', 'ab-tagname', s.label), el('span', 'ab-tagnum', s.value));
      strip.append(bg, floor, img, tag);
      wrap.append(strip);
      strips.push({ wrap: strip, bg, floor, img, frac: s.frac });
    }
    const say = el('p', 'ab-say');
    say.style.margin = '9px 0 0';
    runsInto(say, SCALE.text);
    wrap.append(say);
    return wrap;
  }

  function statsBlock(): HTMLElement {
    const wrap = el('div', 'ab-stats');
    for (const s of STATS) {
      const row = el('div', 'ab-stat');
      const figure = el('div', 'ab-figure');
      const nums = el('div', 'ab-nums');
      for (const [side, v] of [['a', s.a], ['b', s.b]] as const) {
        if (side === 'b') nums.append(el('span', 'ab-join', s.join));
        const box = el('span', `ab-num ${side}`);
        box.append(el('b', 'ab-n', v.value), el('span', 'ab-lab', v.label));
        nums.append(box);
      }
      figure.append(nums);
      // UNDER THE NUMBERS AND NOWHERE ELSE. It spent one screenshot as its own
      // cell in the outer grid, which put "bike-lengths" at the bottom-left
      // corner of a three-line card, a hundred pixels from the two decimals it
      // was the unit for.
      if (s.unit) figure.append(el('span', 'ab-unit', s.unit));
      row.append(figure);
      const say = el('p', 'ab-say');
      say.style.margin = '0';
      runsInto(say, s.text);
      row.append(say);
      wrap.append(row);
    }
    return wrap;
  }

  for (const sec of SECTIONS) {
    const node = el('section', sec.quiet ? 'ab-sec quiet' : 'ab-sec');
    const h = el('div', 'ab-h');
    h.append(el('b', undefined, sec.title), el('i'));
    node.append(h);
    for (const b of sec.blocks) {
      if (b.kind === 'p' || b.kind === 'pull') {
        const p = el('p', b.kind === 'pull' ? 'ab-pull' : 'ab-p');
        runsInto(p, b.text);
        node.append(p);
      } else if (b.kind === 'scale') {
        node.append(scaleBlock());
      } else if (b.kind === 'stats') {
        node.append(statsBlock());
      } else {
        const list = el('div', 'ab-took');
        for (const it of b.items) {
          const item = el('div', 'ab-item');
          item.append(el('span', `ab-key ${it.tone}`, it.label));
          const p = el('p', 'ab-say');
          p.style.margin = '0';
          runsInto(p, it.text);
          item.append(p);
          list.append(item);
        }
        node.append(list);
      }
    }
    col.append(node);
  }

  root.append(sky, scrim, head, scroll);
  document.body.append(root);

  // --- painting -------------------------------------------------------------
  //
  // MEASURED, NOT CALCULATED. Every size below comes off a real element's
  // clientWidth after it is in the document, because the one lesson every
  // layout pass on this game has taught is that the arithmetic and the picture
  // disagree. `frac * measured width` is also what makes the strips honest: the
  // bike really is 17 % of the thing it is drawn inside.

  let painted = '';

  function paintArt(force = false): void {
    if (root.hidden) return;
    const P = opts.palette();
    const look = opts.look();
    const w = col.clientWidth;
    if (w <= 0) return;
    const key = `${look.plate}|${w}|${P.lipTop}|${P.solid}`;
    if (!force && key === painted) return;
    painted = key;

    // The sky: the level's own wall ramp, lightest at the top, exactly as the
    // renderer spills light down a background wall.
    sky.style.background = `linear-gradient(180deg, ${P.wall.join(', ')})`;

    // The masthead, set in the alphabet that paints the game's own signage.
    drawWord(word, 'velo', w, P);
    ground.style.background = P.solid;
    ground.style.borderTop = `2px solid ${P.lipTop}`;
    // The bike rides the masthead's own ground, and it has to SIT on the lip
    // for the same reason the strips do — a page about ground contact whose
    // one decorative bike is hovering is a page that undercuts itself.
    const mastBox = scaleBox(w, 0.10);
    mastBike.width = mastBox.w;
    mastBike.height = mastBox.h;
    mastBike.style.width = `${mastBox.w}px`;
    mastBike.style.height = `${mastBox.h}px`;
    mastBike.style.bottom = `${Math.round(15 - (mastBox.h - mastBox.h / SCALE_PAD) / 2)}px`;
    const mastUrl = poseUrl('ride', P, look, mastBox.w, mastBox.h);
    if (mastUrl) mastBike.src = mastUrl;

    // BOTH STRIPS ARE THE SAME WIDTH AND THE SAME HEIGHT, and that is the
    // argument: one screen, two bikes. The height comes off the BIGGER of the
    // two bikes so the small one is never the thing setting the frame.
    const h = stripHeight(strips.length ? strips[0].wrap.clientWidth : w);
    for (const s of strips) {
      const sw = s.wrap.clientWidth;
      if (sw <= 0) continue;
      s.wrap.style.height = `${h}px`;
      s.bg.style.background = `linear-gradient(180deg, ${P.wall.slice(0, 4).join(', ')})`;
      s.floor.style.background = P.solid;
      s.floor.style.height = `${STRIP_FLOOR_PX + 2}px`;
      s.floor.style.borderTop = `2px solid ${P.lipTop}`;
      const box = scaleBox(sw, s.frac);
      s.img.width = box.w;
      s.img.height = box.h;
      s.img.style.width = `${box.w}px`;
      s.img.style.height = `${box.h}px`;
      // SAT ON THE LIP, not floating over it. `poseUrl` centres the bike in the
      // box it is handed with the pad's worth of air around it, so half that
      // air is under the tyres and has to be taken back off again — otherwise
      // every bike here hovers, which on a page arguing about ground contact
      // would be an unfortunate picture.
      const air = (box.h - box.h / SCALE_PAD) / 2;
      s.img.style.left = `${Math.round((sw - box.w) / 2)}px`;
      s.img.style.bottom = `${Math.round(STRIP_FLOOR_PX + 2 - air)}px`;
      const url = poseUrl('ride', P, look, box.w, box.h);
      if (url) s.img.src = url;
    }
  }

  /**
   * "VELO" in the stroke alphabet, with the signage treatment from the art.
   *
   * Extruded in ink, outlined in ink, filled in the palette's own lip colour —
   * which is the colour of the collision edge, and therefore the one colour in
   * every derived palette that is guaranteed to be the brightest thing it can
   * be drawn against. A masthead that is legible by construction.
   */
  function drawWord(canvas: HTMLCanvasElement, text: string, cssW: number, P: Palette): void {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    // CAPPED AGAINST THE VIEWPORT, not just against the column. At 915 x 348 —
    // a landscape phone with the URL bar on it, the viewport this whole client
    // is judged at — a masthead sized off the column alone took 155 px of 348
    // before a word of the copy, which is a logo with a page attached rather
    // than the other way round.
    const cssH = Math.round(Math.min(
      112, Math.max(56, cssW * 0.22), Math.max(46, window.innerHeight * 0.2),
    ));
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    // No 2d context is a real state in a memory-pressured browser. A missing
    // masthead is a missing masthead; it is not an exception on the way in.
    if (!ctx) return;
    const lay = textOutline(text, 0, 0, { size: 1, align: 'left' });
    const bw = lay.maxX - lay.minX;
    const bh = lay.maxY - lay.minY;
    if (!(bw > 0) || !(bh > 0)) return;
    const fat = Math.max(4, cssH * 0.1) * dpr;
    const margin = fat * 1.4 + 3 * dpr;
    const zoom = Math.min(
      (canvas.width - margin * 2 - 6 * dpr) / bw,
      (canvas.height - margin * 2) / bh,
    );
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    // y flips: the alphabet is y-up like the world, a canvas is y-down.
    ctx.translate(margin, canvas.height - margin);
    ctx.scale(zoom, -zoom);
    ctx.translate(-lay.minX, -lay.minY);
    const path = new Path2D();
    for (const poly of lay.strokes) {
      poly.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const stroke = (colour: string, widthPx: number, dx = 0, dy = 0): void => {
      ctx.save();
      ctx.translate(dx / zoom, dy / zoom);
      ctx.strokeStyle = colour;
      ctx.lineWidth = widthPx / zoom;
      ctx.stroke(path);
      ctx.restore();
    };
    // Four offsets in ink is the extrusion the art uses on a wall piece.
    for (let i = 4; i >= 1; i--) stroke(P.ink, fat, i * dpr * 0.9, -i * dpr * 0.9);
    stroke(P.ink, fat + 5 * dpr);
    stroke(P.lipTop, fat);
    ctx.restore();
  }

  // --- opening, closing, and the keyboard while it is up --------------------

  let open = false;
  let returnTo: HTMLElement | null = null;

  /**
   * THE KEYBOARD, TAKEN AT THE CAPTURE PHASE ON THE WINDOW.
   *
   * The chooser and the customiser take theirs on their own root and lean on
   * main.ts for a global Escape, because a key pressed while the focus is
   * elsewhere would otherwise reach the game. This page cannot do that — it is
   * a self-contained feature and main.ts is not its to edit — so it takes the
   * window instead, at capture, which reaches the keys BEFORE input.ts's
   * listeners regardless of where the focus went. It is strictly the stronger
   * of the two and it is why no hook in main.ts was needed.
   *
   * Tab is deliberately let through to the browser (propagation stopped,
   * default allowed) so focus still walks; everything the sim binds is
   * swallowed, and the scroll keys are turned into scrolling, so reading the
   * page with the keyboard never drives the bike underneath it.
   */
  const SCROLLERS: Record<string, number> = {
    ArrowDown: 64, ArrowUp: -64, PageDown: 0.85, PageUp: -0.85, Space: 0.85,
  };

  function onKey(e: KeyboardEvent): void {
    if (!open) return;
    if (e.code === 'Escape') {
      setOpen(false, true);
    } else if (e.code === 'Home' || e.code === 'End') {
      scroll.scrollTop = e.code === 'Home' ? 0 : scroll.scrollHeight;
    } else if (e.code in SCROLLERS) {
      const d = SCROLLERS[e.code];
      scroll.scrollBy({ top: Math.abs(d) < 2 ? d * scroll.clientHeight : d });
    } else if (e.code === 'Tab') {
      // A TRAP, because this is a modal over a page full of focusable things.
      // Tabbing out of the back of it lands the keyboard on the legend's
      // buttons and the tuning panel's sliders, underneath an opaque overlay —
      // focus somewhere the person tabbing cannot see. There are exactly two
      // stops in here, so the cycle is written out rather than discovered.
      const stops: HTMLElement[] = [scroll, close];
      const at = stops.indexOf(document.activeElement as HTMLElement);
      const next = (at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length;
      stops[at < 0 ? 0 : next].focus({ preventScroll: true });
    } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  /**
   * The matching releases, for exactly the keys swallowed above.
   *
   * chooserui.ts's note applies word for word: a keyup that reaches the game
   * for a keydown that did not is how an input bit gets stuck on.
   */
  function onKeyUp(e: KeyboardEvent): void {
    if (!open) return;
    if (e.code === 'Enter' || e.code === 'NumpadEnter') return;
    e.preventDefault();
    e.stopPropagation();
  }

  function onResize(): void {
    if (open) paintArt();
  }

  close.addEventListener('click', () => setOpen(false, true));

  function setOpen(on: boolean, moveFocus = false): void {
    if (open === on) return;
    open = on;
    root.hidden = !on;
    if (on) {
      returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('keyup', onKeyUp, true);
      window.addEventListener('resize', onResize);
      // DROP WHATEVER WAS HELD. input.ts clears the sim mask and releases every
      // held command on `blur`, for alt-tab's sake; opening a page over the top
      // of a moving bike is the same situation, so it goes through the same
      // door rather than around it. Without this, a thumb still on `gas` when
      // this opens keeps the throttle on for as long as somebody reads.
      window.dispatchEvent(new Event('blur'));
      scroll.scrollTop = 0;
      painted = '';
      paintArt(true);
      // A second pass after layout: the first one runs before the browser has
      // laid the strips out on the very first open, and `clientWidth` is 0
      // then. Cheap — `poseUrl` caches by size, so the sizes that did not move
      // cost a map lookup.
      requestAnimationFrame(() => paintArt());
      if (moveFocus) close.focus({ preventScroll: true });
      else scroll.focus({ preventScroll: true });
    } else {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('resize', onResize);
      // The button that opened it first, then whatever had the keyboard before
      // it opened. If neither will take focus, the close button is BLURRED
      // rather than left holding it: focus inside a hidden subtree is the one
      // outcome that is worse than focus on nothing.
      const back = opts.returnFocus?.() ?? (returnTo?.isConnected ? returnTo : null);
      if (back && back.isConnected) back.focus({ preventScroll: true });
      else if (root.contains(document.activeElement)) close.blur();
      returnTo = null;
    }
  }

  return {
    get open(): boolean {
      return open;
    },
    setOpen: (on: boolean) => setOpen(on, true),
    toggle: () => setOpen(!open, true),
    refresh: () => paintArt(true),
    root,
  };
}
