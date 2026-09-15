// WHERE A PROP GOES. The rule Phase 1 said was the blocker.
//
// Everything here is placement, not drawing: it decides what exists, how big it
// is, what colour it is and where — and it does it with pure numbers, so the
// two constraints that matter can be asserted in plain node against the real
// twenty levels rather than judged from a screenshot.
//
// THE TWO CONSTRAINTS, both learned the hard way in Phase 1:
//
// 1. A PROP MUST BE VISIBLY NON-COLLIDABLE. Bracketed pipework under a ledge
//    already read as solid geometry once, and hung through 19-low-roof's
//    corridor — the level whose entire lesson is head clearance. The fix was a
//    clearance rule, not a colour. So every prop falls into exactly one of
//    three classes, and each class has a geometric invariant that props.test.ts
//    checks on every prop of every level:
//
//      `paint`  — pigment on the terrain. Lies ENTIRELY INSIDE SOLID material,
//                 so it cannot be mistaken for something in the air because it
//                 is not in the air. Tight corridors get nothing else.
//      `mural`  — pigment on the BACKGROUND WALL, behind every solid in the
//                 draw order and therefore occluded by terrain exactly the way
//                 the wall itself is. Needs open air around it so it never sits
//                 close enough to an edge to be read as part of one.
//      `fixture` — an actual thing, anchored to a surface. Needs PROP_MIN_CLEAR
//                 metres of free air out from the surface, PROP_CEILING_CLEAR if
//                 it hangs, AND a floor-to-ceiling corridor through its own
//                 centre. The corollary is the rule that would have prevented
//                 the Phase 1 bug outright: A TIGHT SPACE GETS PAINT AND NEVER
//                 AN OBJECT.
//
// 2. THE BUDGET IS ENFORCED FROM THE FIRST PROP. Every Phase 1 layer is bounded
//    by the screen; a per-level prop system is not, and on 19 and 20 there were
//    only about three milliseconds of headroom. So the count is capped by level
//    area before anything is placed, props are culled by bounding box at draw
//    time, and `bin/artbench` stays the standing check.
//
// Seeded from simHash, so a level's dressing is stable across loads and rebakes
// and differs between levels — the same reasoning the cracks and stains use.
import type { Level } from '@/sim/level.ts';
import type { Palette } from './palette.ts';
import type { StyleVariant } from './variant.ts';
import type { Site, SolidField } from './space.ts';
import { buildField, findSites, playSolidFraction, rayGap, worstClearance } from './space.ts';
import { seedFrom, substream } from './rng.ts';
import { contrast, hueDist, hueOf } from './color.ts';
import type { Rng } from './rng.ts';

export type PropClass = 'paint' | 'mural' | 'fixture';

export type PropKind =
  | 'piece' | 'numeral' | 'tag' | 'poster' | 'banner'
  | 'sign' | 'vent' | 'ladder' | 'box' | 'lamp' | 'conduit' | 'cable'
  | 'floorMark' | 'stencilText';

/** Free air a fixture needs before it may exist at all. */
export const PROP_MIN_CLEAR = 3.0;
/** Free air a HANGING fixture needs. Higher, because this is the one that went wrong. */
export const PROP_CEILING_CLEAR = 4.2;
/** Air a mural needs around its whole bounding box, so it never crowds an edge. */
export const MURAL_KEEPOUT = 0.8;
/** Metres a mounted fixture's body is held off its surface, so the ink still reads. */
export const MOUNT_GAP = 0.06;

export interface Prop {
  kind: PropKind;
  cls: PropClass;
  /** Centre of the prop's own box, in world metres. */
  x: number;
  y: number;
  /** Outward normal of the surface it is mounted on. (0, 1) for a mural. */
  nx: number;
  ny: number;
  /** Direction along the surface. */
  dx: number;
  dy: number;
  /** Box extents in world metres, before rotation. */
  w: number;
  h: number;
  rot: number;
  /** Its own RNG seed, so drawing detail can vary without a shared stream. */
  seed: number;
  /** Colours, resolved at plan time so the drawing code holds no palette logic. */
  colors: string[];
  text?: string;
  alpha: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** What the site measured. Reported by the bench and asserted by the tests. */
  clear: number;
  /**
   * Free air straight DOWN from the prop's centre.
   *
   * Only the lamp reads it, and only to decide how far its light cone reaches —
   * but it has to be measured here rather than guessed at draw time, because
   * the drawing code has no access to the field, and a cone sized from the
   * MOUNT-normal gap is a cone sized from a horizontal distance on every
   * wall-mounted lamp in the game.
   */
  drop: number;
}

export interface PropPlan {
  props: Prop[];
  budget: number;
  /** Sites considered, and how many were refused for want of room. */
  sites: number;
  refused: number;
}

/**
 * How many props a level may have.
 *
 * By AREA, because that is what decides how many end up on one screen — a
 * screenful at the base camera is about 380 square metres, so this works out
 * near two and a half props in frame at the default density. Capped at both
 * ends: a tiny level still gets dressed, and the cathedral does not get two
 * hundred things to bounding-box test every frame.
 *
 * AND BY HOW SOLID A TYPICAL FRAME OF THE LEVEL IS, which is the level-aware
 * part and the one that matters. Render cost tracks visible solid area, so the
 * levels with no headroom are the ones whose frames are mostly material —
 * measured, `20-close-quarters` sits at 0.54 and `19-low-roof` at 0.41 where
 * the open levels are near 0.15. Those are precisely the levels where the
 * choppiness was reported, so they get a fraction of the dressing rather than
 * the same amount as a level with room to spare. The user's frame rate is worth
 * more than the decoration on the two levels that cannot afford it.
 */
export function propBudget(level: Level, density: number, solidFrac = 0): number {
  const area = (level.maxX - level.minX) * (level.maxY - level.minY);
  const busy = Math.max(0.18, Math.min(1, 1.25 - solidFrac * 1.8));
  return Math.max(4, Math.min(52, Math.round((area / 150) * Math.max(0, density) * busy)));
}

/** The colours a prop may use. */
export function decorColors(P: Palette): string[] {
  // THE LIP COLOURS ARE NOT IN HERE, and that is a readability rule rather than
  // a taste one: those three colours mean "this is the collision boundary and
  // this is which way it faces". A sign painted in the floor lip's yellow
  // spends the player's attention on the wrong thing.
  //
  // Filtered by APPEARANCE rather than by slot name, and that is the part that
  // matters. Exact-match filtering catches the hand-authored concrete palette,
  // where `yellow` and `lipTop` are literally the same string — but a derived
  // palette can perfectly well produce a decor green a few degrees of hue and a
  // few per cent of luminance away from its floor lip, which looks identical on
  // screen and is not caught by an equality test.
  const lips = [P.lipTop, P.lipSide, P.lipUnder];
  const all = [P.cyan, P.magenta, P.lime, P.orange, P.cream, P.teal, P.rust, P.lilac, P.steel, P.red, P.yellow];
  const confusable = (c: string): boolean =>
    lips.some((l) => l === c || (hueDist(hueOf(c), hueOf(l)) < 22 && contrast(c, l) < 1.35));
  const kept = all.filter((c) => !confusable(c));
  // Never strip the palette down to nothing: a level with two usable colours
  // would look poorer than one that reuses a hue. Five is enough for every
  // generator here, and below that the unfiltered set is the lesser evil.
  return kept.length >= 5 ? kept : all;
}

/**
 * How many of each kind one level may have, as a fraction of its budget with a
 * hard floor and ceiling.
 *
 * WITHOUT THIS THE SET DRESSING IS A PARADE. The first run placed seventeen
 * graffiti pieces on 15-feather and twenty-six tags on 17-backswing, because
 * those levels are mostly open air and every open pocket took the first kind
 * its site offered. A piece is a two-metre word; three of them across a level
 * is a place somebody has been, and seventeen is wallpaper.
 *
 * The quotas also do the variety work the weighted picks alone could not: once
 * the pieces are used up, the next big pocket gets a tag, then nothing at all —
 * and a level with a few empty rooms reads better than one with something in
 * every corner.
 */
const QUOTA: Record<PropKind, [frac: number, min: number, max: number]> = {
  piece: [0.08, 1, 3],
  numeral: [0, 1, 1],
  tag: [0.18, 1, 7],
  poster: [0.10, 1, 4],
  banner: [0.06, 1, 3],
  sign: [0.10, 1, 4],
  vent: [0.06, 1, 2],
  ladder: [0.10, 1, 4],
  box: [0.08, 1, 3],
  lamp: [0.14, 1, 6],
  conduit: [0.10, 1, 4],
  cable: [0.06, 1, 2],
  floorMark: [0.22, 1, 9],
  stencilText: [0.12, 1, 4],
};

function quotaOf(kind: PropKind, budget: number): number {
  const [frac, lo, hi] = QUOTA[kind];
  return Math.max(lo, Math.min(hi, Math.round(budget * frac)));
}

/** Words the generator may paint. Short, neutral, and drawable by the alphabet. */
const WORDS = ['VELO', 'GO', 'RIDE', 'FAST', 'NO BRAKES', 'SEND IT', 'AIR', 'LINE', 'GRIP', 'HOLD', 'DROP', 'GAS'];
const SIGNAGE = ['KEEP CLEAR', 'NO EXIT', 'DANGER', 'AUTHORISED ONLY', 'HARD HAT AREA', 'MIND THE GAP'];
const SHORT = ['GO', 'H', 'E', '!', 'V', 'OK'];

/**
 * Plan a level's dressing.
 *
 * Sites are walked in their own stable order and each is offered the kinds that
 * suit it, most demanding first. The first kind whose clearance test passes
 * takes the site; if none passes, the site is refused and counted. That
 * ordering is what makes the result a function of the level and the seed rather
 * than of how the arrays happened to be built.
 */
export function planProps(
  level: Level, P: Palette, v: StyleVariant, faceT: number,
  field?: SolidField, solidFrac?: number,
): PropPlan {
  const f = field ?? buildField(level);
  const sites = findSites(level, f, faceT);
  const budget = propBudget(level, v.propDensity, solidFrac ?? playSolidFraction(f, level));
  const r = substream(seedFrom(level.simHash), 'props');
  const cols = decorColors(P);
  const out: Prop[] = [];
  let refused = 0;

  // Level index, for the numeral. Content, so it is read off the level rather
  // than configured — the same place the HUD card gets it.
  const m = /^\s*(\d+)/.exec(level.name);
  const index = m ? m[1] : '';
  let numeralDone = false;

  // Sites arrive sorted left to right, which would hand every quota to the left
  // end of the level. A seeded shuffle spreads them without giving up any
  // determinism: the order is a function of the level's own simHash, and the
  // list it shuffles was already sorted into a canonical order that owes
  // nothing to how the polygons happened to be listed.
  const order = sites.map((_, i) => i);
  const rs = substream(seedFrom(level.simHash), 'proporder');
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rs() * (i + 1));
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }

  const used = new Map<PropKind, number>();
  for (const i of order) {
    if (out.length >= budget) break;
    const site = sites[i];
    const opts = kindsFor(site, r);
    let placed: Prop | null = null;
    for (const kind of opts) {
      if (kind === 'numeral' && (numeralDone || !index)) continue;
      if ((used.get(kind) ?? 0) >= quotaOf(kind, budget)) continue;
      const p = build(kind, site, f, r, cols, P, index);
      if (!p) continue;
      if (overlapsAny(p, out)) continue;
      placed = p;
      break;
    }
    if (placed) {
      out.push(placed);
      used.set(placed.kind, (used.get(placed.kind) ?? 0) + 1);
      if (placed.kind === 'numeral') numeralDone = true;
    } else {
      refused++;
    }
  }
  // Back into a canonical order, so the baked list and everything downstream of
  // it does not depend on the shuffle.
  out.sort((a, b) => a.minX - b.minX || a.minY - b.minY);
  return { props: out, budget, sites: sites.length, refused };
}

/**
 * Which kinds this site can carry, most demanding first.
 *
 * These are the placement rules, and they came from looking at what the twenty
 * real levels actually contain rather than from the sketch. They are mostly one
 * big cave polygon each, so a long near-vertical face is by far the most common
 * site and a genuine dead-end pocket is rarer than expected — while the open
 * shafts and drop chambers the murals want turn out to be exactly the maxima of
 * the clearance field.
 */
function kindsFor(s: Site, r: Rng): PropKind[] {
  const pick = r();
  switch (s.kind) {
    case 'pocket':
      // The rooms. Big flat art, because it is the only place with room for it
      // and the only place where nothing is near enough to an edge to confuse.
      if (s.clear >= 6) return pick < 0.45 ? ['piece', 'numeral', 'tag'] : ['numeral', 'piece', 'tag'];
      if (s.clear >= 4.2) return pick < 0.5 ? ['piece', 'tag'] : ['tag', 'piece'];
      return ['tag'];
    case 'wall':
      // Where most set dressing in a real place lives. Ladders and conduit want
      // a long run; lamps, vents, boxes and posters do not.
      if (s.run >= 6 && pick < 0.4) return ['ladder', 'conduit', 'poster', 'stencilText'];
      if (s.run >= 4 && pick < 0.7) return ['conduit', 'lamp', 'poster', 'stencilText'];
      if (pick < 0.35) return ['vent', 'box', 'poster', 'stencilText'];
      if (pick < 0.7) return ['poster', 'box', 'stencilText'];
      return ['lamp', 'sign', 'stencilText'];
    case 'ceiling':
      // The site that has to be hardest to earn, because it is the one that
      // went wrong in Phase 1. Everything here hangs, so everything here needs
      // PROP_CEILING_CLEAR.
      return pick < 0.5 ? ['lamp', 'banner', 'cable'] : ['banner', 'cable', 'lamp'];
    case 'ledge':
      // A ladder or a sign belongs exactly where the hazard chevron already is.
      return pick < 0.5 ? ['ladder', 'sign'] : ['sign', 'ladder'];
    case 'floor':
      // Paint only, forever. Something standing on the floor is something to
      // hit, and the art does not get to add those.
      return ['floorMark'];
  }
}

/** Build one prop, or null if it does not fit its site. */
function build(
  kind: PropKind, s: Site, f: SolidField, r: Rng, cols: string[], P: Palette, index: string,
): Prop | null {
  const seed = (r() * 0xffffffff) >>> 0;
  const c = (): string => cols[Math.floor(r() * cols.length)];
  const base = {
    kind, x: s.x, y: s.y, nx: s.nx, ny: s.ny, dx: s.dx, dy: s.dy,
    rot: 0, seed, clear: s.clear, drop: 0,
  };
  /** Centre a box on the site, pushed `off` metres out along the surface normal. */
  const out = (w: number, h: number, off: number): { x: number; y: number; w: number; h: number } => ({
    x: s.x + s.nx * off, y: s.y + s.ny * off, w, h,
  });

  switch (kind) {
    // --- murals: pigment on the background plane ----------------------------
    case 'piece': {
      const h = Math.min(3.4, s.clear * 0.5);
      const text = WORDS[Math.floor(r() * WORDS.length)];
      const w = Math.min(s.clear * 1.75, h * (text.length * 0.98 + 0.6));
      return mural({ ...base, ...out(w, h, 0), rot: (r() - 0.5) * 0.14, text, colors: [c(), c(), c(), P.cream], alpha: 0.72 }, f);
    }
    case 'numeral': {
      if (!index) return null;
      const h = Math.min(4.2, s.clear * 0.62);
      return mural({
        ...base, ...out(h * index.length * 0.95, h, 0), rot: (r() - 0.5) * 0.1,
        text: index, colors: [c(), P.cream], alpha: 0.3,
      }, f);
    }
    case 'tag': {
      const h = 0.5 + r() * 0.5;
      return mural({ ...base, ...out(h * (3 + r() * 3), h, 0), rot: (r() - 0.5) * 0.2, colors: [c()], alpha: 0.7 }, f);
    }

    // --- paint: pigment INSIDE the solid ------------------------------------
    case 'floorMark': {
      const w = Math.min(s.run * 0.7, 3.2 + r() * 2.4);
      const h = 0.75 + r() * 0.5;
      const text = r() < 0.5 ? undefined : SHORT[Math.floor(r() * SHORT.length)];
      return paint({ ...base, w, h, colors: [c()], text, alpha: 0.26 + r() * 0.16 }, f, 0.95 + h * 0.5);
    }
    case 'stencilText': {
      const h = 0.44 + r() * 0.3;
      const text = SIGNAGE[Math.floor(r() * SIGNAGE.length)];
      const w = h * text.length * 0.9;
      if (w > s.run * 0.95) return null;
      return paint({ ...base, w, h, colors: [P.ink], text, alpha: 0.26 + r() * 0.14 }, f, 0.8 + h);
    }

    // --- fixtures: things in the room, anchored to a surface ----------------
    case 'poster': {
      const ph = 0.95 + r() * 0.5;
      const n = 1 + Math.floor(r() * 3);
      const w = n * ph * 0.74 + (n - 1) * 0.1;
      if (w > s.run * 0.8) return null;
      return fixture({ ...base, ...out(w, ph, 0.12 + ph / 2), colors: [c(), c(), P.cream, P.ink], text: `${n}`, alpha: 0.92 }, f, PROP_MIN_CLEAR);
    }
    case 'banner': {
      // Hangs DOWN from its mount, so its box is pushed along the normal by
      // half its own length. Ceiling sites only — a banner off a vertical wall
      // would stick out sideways into the line you ride.
      if (s.kind !== 'ceiling') return null;
      const h = Math.min(4.6, s.clear * 0.5);
      if (h < 1.6) return null;
      const text = WORDS[Math.floor(r() * WORDS.length)];
      return fixture({ ...base, ...out(0.8 + r() * 0.3, h, 0.1 + h / 2), colors: [c(), P.cream], text, alpha: 0.95 }, f, PROP_CEILING_CLEAR);
    }
    case 'sign': {
      const h = 1.1 + r() * 0.5;
      return fixture({ ...base, ...out(h, h, 0.15 + h / 2), colors: [c(), P.ink, P.steel], alpha: 0.95 }, f, PROP_MIN_CLEAR);
    }
    case 'vent': {
      const h = 1.3 + r() * 0.7;
      if (h > s.run * 0.8) return null;
      return fixture({ ...base, ...out(h, h, 0.1 + h / 2), colors: [P.steelD, P.steel, P.ink], alpha: 0.95 }, f, PROP_MIN_CLEAR);
    }
    case 'ladder': {
      // Runs ALONG the face it is bolted to, which on a wall or a ledge means
      // down. `w` is its length; `h` is the rail spacing.
      const len = Math.min(s.run * 0.85, 3 + r() * 5);
      if (len < 2) return null;
      return fixture({ ...base, ...along(s, len, 0.44, 0.28), colors: [c(), P.ink], alpha: 0.95 }, f, PROP_MIN_CLEAR);
    }
    case 'box': {
      const h = 0.8 + r() * 0.4;
      return fixture({ ...base, ...out(h * 0.82, h, 0.1 + h / 2), colors: [c(), P.cream, P.ink], text: 'H', alpha: 0.95 }, f, PROP_MIN_CLEAR);
    }
    case 'lamp': {
      const h = 1.1 + r() * 0.5;
      // The box has to be wide enough for the stem, which reaches back toward
      // the mount: a box that does not contain the whole prop is a clearance
      // test that does not test the whole prop.
      return fixture({ ...base, ...out(h * 1.1, h, 0.08 + h / 2), colors: [P.steelD, P.yellow, P.ink], alpha: 0.95 }, f,
        s.kind === 'ceiling' ? PROP_CEILING_CLEAR : PROP_MIN_CLEAR);
    }
    case 'conduit': {
      const len = Math.min(s.run * 0.9, 5 + r() * 9);
      if (len < 3) return null;
      return fixture({ ...base, ...along(s, len, 0.55, 0.42), colors: [P.steelD, P.steel, c()], alpha: 0.95 }, f, PROP_MIN_CLEAR);
    }
    case 'cable': {
      if (s.kind !== 'ceiling') return null;
      const len = Math.min(s.run * 0.9, 4 + r() * 8);
      if (len < 3) return null;
      const sag = Math.min(1.3, s.clear * 0.16);
      return fixture({ ...base, ...along(s, len, 0.45 + sag, sag * 0.5 + 0.2), colors: [P.ink2, c()], alpha: 0.95 }, f, PROP_CEILING_CLEAR);
    }
  }
  return null;
}

/**
 * Box for a prop that runs ALONG its surface: a ladder down a wall, conduit
 * across one, a cable slung under a ceiling. `len` is measured along the face,
 * `depth` out from it, and the box is centred on the surface midpoint pushed
 * out by half its depth.
 */
function along(
  s: Site, len: number, depth: number, off: number,
): { x: number; y: number; w: number; h: number } {
  const cx = s.x + s.nx * (MOUNT_GAP + off);
  const cy = s.y + s.ny * (MOUNT_GAP + off);
  // Axis-aligned bound of a rotated rectangle.
  const ax = Math.abs(s.dx) * len / 2 + Math.abs(s.nx) * depth / 2;
  const ay = Math.abs(s.dy) * len / 2 + Math.abs(s.ny) * depth / 2;
  return { x: cx, y: cy, w: ax * 2, h: ay * 2 };
}

// --- the three clearance rules ----------------------------------------------
//
// EVERY PROP IS DRAWN IN THE BACKGROUND PASS, behind every solid. That is the
// structural half of "visibly non-collidable": terrain paints over a prop, so a
// prop can never cover a collision edge, and a fixture that overlaps a ledge on
// screen is plainly BEHIND it rather than bolted to the front of it. The rules
// below are the other half — they keep a prop out of the places where being
// behind the terrain would not be enough to tell.

type Draft = Omit<Prop, 'cls' | 'minX' | 'minY' | 'maxX' | 'maxY'>;

function box(d: Draft): [number, number, number, number] {
  return [d.x - d.w / 2, d.y - d.h / 2, d.x + d.w / 2, d.y + d.h / 2];
}

/**
 * A mural: flat pigment on the background plane. Open air all round, so it is
 * never close enough to a collision edge to be read as part of one.
 */
function mural(d: Draft, f: SolidField): Prop | null {
  const [minX, minY, maxX, maxY] = box(d);
  if (worstClearance(f, minX, minY, maxX, maxY) < MURAL_KEEPOUT) return null;
  return { ...d, cls: 'mural', minX, minY, maxX, maxY };
}

/** Free air straight down from a point, capped. */
function dropBelow(f: SolidField, x: number, y: number): number {
  return rayGap(f, x, y, 0, -1, 12).gap;
}

/**
 * Paint: pigment INSIDE the solid, `inset` metres in from the surface.
 *
 * Its whole box has to be solid, which is a stronger statement than "it looks
 * flat": a thing inside the material cannot be mistaken for a thing in the air,
 * whatever it is drawn like. This is what a corridor too tight for anything
 * else still gets, and it is why the art can dress 19-low-roof at all.
 */
function paint(d: Draft, f: SolidField, inset: number): Prop | null {
  const cx = d.x - d.nx * inset;
  const cy = d.y - d.ny * inset;
  const rot = Math.atan2(d.dy, d.dx);
  const ex = Math.abs(Math.cos(rot)) * d.w / 2 + Math.abs(Math.sin(rot)) * d.h / 2;
  const ey = Math.abs(Math.sin(rot)) * d.w / 2 + Math.abs(Math.cos(rot)) * d.h / 2;
  const [minX, minY, maxX, maxY] = [cx - ex, cy - ey, cx + ex, cy + ey];
  // Every sample solid. `worstClearance` is 0 only where the whole box is.
  if (worstClearance(f, minX, minY, maxX, maxY) > 0) return null;
  return { ...d, x: cx, y: cy, rot, cls: 'paint', minX, minY, maxX, maxY };
}

/**
 * A fixture: a thing in the room, anchored to a surface.
 *
 * TWO tests, and both are needed. Its body must sit in air — no part of it
 * inside the material, so it never looks like a growth out of the terrain — AND
 * the site must have `need` metres of free space. The second is the one that
 * would have stopped Phase 1's pipework hanging through 19-low-roof, and it is
 * what makes "a tight space gets paint and never an object" true rather than
 * aspirational.
 */
function fixture(d: Draft, f: SolidField, need: number): Prop | null {
  if (d.clear < need) return null;
  const [minX, minY, maxX, maxY] = box(d);
  const k = 0.03;
  if (worstClearance(f, minX + k, minY + k, maxX - k, maxY - k) <= 0) return null;
  // THE HEAD-CLEARANCE TEST, and it is a separate question from the one above.
  // `d.clear` measures out along the MOUNT normal, so a lamp bolted to a wall
  // with six metres of room in front of it passes that while still hanging in a
  // two-and-a-half-metre-tall corridor. props.test.ts found exactly that on
  // 12-whoops. What matters to a rider is the floor-to-ceiling gap THROUGH the
  // prop, so measure that too.
  const down = dropBelow(f, d.x, d.y);
  const corridor = rayGap(f, d.x, d.y, 0, 1).gap + down;
  if (corridor < Math.max(PROP_MIN_CLEAR, need * 0.8)) return null;
  return { ...d, cls: 'fixture', drop: down, minX, minY, maxX, maxY };
}

/** Props do not stack. Boxes are inflated so two neighbours still read as two. */
function overlapsAny(p: Prop, placed: Prop[]): boolean {
  const pad = 0.7;
  for (const q of placed) {
    if (p.minX - pad > q.maxX || p.maxX + pad < q.minX) continue;
    if (p.minY - pad > q.maxY || p.maxY + pad < q.minY) continue;
    return true;
  }
  return false;
}
