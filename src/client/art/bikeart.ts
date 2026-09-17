// The bike, as DATA: six silhouettes, ten liveries, and the arithmetic that
// stops any of them from making you invisible.
//
// Two halves, and they are separate on purpose.
//
// SHAPE. Every bike type is a set of chassis-local polygons and runs. They are
// cosmetic to the last decimal: the wheels are still 0.25 m on anchors at
// (+-0.6, -0.15), the chassis colliders are still three circles, the head is
// still the death sphere at its true radius, and `bikeart.test.ts` asserts that
// every type resolves to the SAME `specHash`. A contributor who thinks a bobber
// "should" have a longer wheelbase gets a failing test rather than a board full
// of refused runs.
//
// COLOUR. A colourway is a set of hues, not a set of hex codes, and the hex is
// solved per level against that level's own palette. That is the same discipline
// palette.ts already runs under, where the collision lip's contrast is computed
// rather than hoped for — and it is what turns "the player probably picked
// something visible" into "the player CANNOT pick something invisible".
//
// THE ONE RULE THE WHOLE LOOK SERVES, restated because this file is where it is
// easiest to break: solids are dark, air is light, every bike part carries ink,
// and the bike stays the most legible thing on screen. A free colour wheel
// breaks that on the first dark level somebody paints themselves grey on. There
// is deliberately no colour wheel here.
import type { BikeSpec } from '@/sim/spec.ts';
import type { Appearance } from '@/shared/appearance.ts';
import { BIKES, DECALS, HELMETS, JACKETS, PAINTS, SCARVES } from '@/shared/appearance.ts';
import type { Palette } from './palette.ts';
import { atLum, contrast, hueDist, hueOf, lum, mixHex } from './color.ts';

export type Pt = readonly [number, number];

// --- the silhouette rule -----------------------------------------------------
//
// WHAT THE MUFFLER TAUGHT, AS A NUMBER. The exhaust tip used to sit at x = -0.90
// while the rear tyre's back edge is at -0.85, so the pipe stuck out BEHIND the
// wheel and it was the only part of the bike that did. Reported from play: "why
// does the bike have a weird long muffler?" An accessory that visually overhangs
// where nothing collides misleads in exactly that way, and with six bike types
// and four decal sets there are now a lot more ways to do it.
//
// So it stops being a thing to remember. Every drawn point of every bike type
// must lie inside the bike's own silhouette: the bodywork box below, or inside
// one of the two tyres. `bikeart.test.ts` samples every polygon, every run and
// every disc of every type and asserts it.

/**
 * The bodywork box, in chassis-local metres.
 *
 * Derived from what the collision actually is rather than from the shipped art:
 * the centre chassis collider is r 0.28 at (0, 0.05) so the frame reads to about
 * y 0.33 and down to -0.23, the outriggers sit at x +-0.35 r 0.20, and the two
 * wheels put the true extremes at x +-0.85. The box is drawn just outside the
 * chassis circles and well INSIDE the tyres, which is the shape a bike has:
 * bodywork between the wheels, nothing hanging past them.
 */
export const FRAME_BOX = { minX: -0.58, maxX: 0.55, minY: -0.3, maxY: 0.4 };

/** How far past a tyre's own radius a drawn point may sit. The shipped muffler's margin. */
export const TYRE_MARGIN = 0.03;

/** True when a chassis-local point is outside the bike's own silhouette. */
export function outsideSilhouette(spec: BikeSpec, x: number, y: number, r = 0): boolean {
  if (
    x - r >= FRAME_BOX.minX && x + r <= FRAME_BOX.maxX &&
    y - r >= FRAME_BOX.minY && y + r <= FRAME_BOX.maxY
  ) return false;
  const reach = spec.wheel.radius + TYRE_MARGIN;
  for (const a of spec.wheel.anchors) {
    const dx = x - a.x;
    const dy = y - a.y;
    if (Math.sqrt(dx * dx + dy * dy) + r <= reach) return false;
  }
  return true;
}

// --- the shapes --------------------------------------------------------------

export interface WheelStyle {
  /** Rim disc radius, as a fraction of the wheel. */
  rim: number;
  /** Hub disc radius, as a fraction of the wheel. */
  hub: number;
  /** Radial spokes, drawn on the sim's own spin scalar. 0 for a plain disc. */
  spokes: number;
  /** Tread blocks round the tyre. 0 is a slick. */
  treads: number;
  /** A solid disc wheel — no spokes, a plate instead. */
  disc: boolean;
}

export interface PipeRun {
  from: Pt;
  ctrl: Pt;
  mid: Pt;
  tip: Pt;
  /** Stroke width in metres. */
  w: number;
  /** The ink cap at the tip. */
  tipR: number;
}

export interface BikeShape {
  id: string;
  /** The chassis outline. THE thing that says which bike this is. */
  body: readonly Pt[];
  /**
   * Tank and seat accents, and the ink wedge. All three are drawn CLIPPED TO
   * THE BODY PATH, so they are exempt from the silhouette rule by construction
   * — a clipped fill cannot add a pixel to an outline — and they may therefore
   * run past the body's own edge, which is how a band reaches the edge cleanly.
   */
  tank: readonly Pt[];
  seat: readonly Pt[];
  /** Exhaust, or null for a bike that vents instead of piping. */
  pipe: PipeRun | null;
  /** A vent slot on the flank, for the one bike with no pipe. Clipped to the body. */
  vent: readonly Pt[] | null;
  /** Swingarm: frame to rear wheel centre. Index 1 is replaced by the wheel anchor. */
  swing: Pt;
  swingW: number;
  /** Fork: frame to front wheel centre. */
  fork: Pt;
  forkW: number;
  /** Headlight or number disc on the nose. Fine tier only. */
  lamp: { x: number; y: number; r: number } | null;
  wheel: WheelStyle;
}

const SHAPES: readonly BikeShape[] = [
  {
    // The shipped bike, unchanged to the decimal. "Default" and "the art that
    // was signed off" must be the same object or they drift apart.
    id: 'scrambler',
    body: [
      [-0.5, 0.1], [-0.52, 0.24], [-0.4, 0.28], [-0.2, 0.24], [-0.02, 0.32], [0.2, 0.35],
      [0.38, 0.3], [0.46, 0.16], [0.4, 0.04], [0.12, -0.02], [-0.25, -0.02], [-0.44, 0.02],
    ],
    tank: [[-0.7, 0.17], [0.6, 0.06], [0.6, 0.16], [-0.7, 0.27]],
    seat: [[-0.54, 0.22], [-0.2, 0.24], [-0.02, 0.32], [-0.2, 0.34], [-0.54, 0.3]],
    pipe: { from: [0.02, -0.1], ctrl: [-0.14, -0.28], mid: [-0.42, -0.25], tip: [-0.82, -0.14], w: 0.075, tipR: 0.052 },
    vent: null,
    swing: [-0.1, -0.04], swingW: 0.07,
    fork: [0.33, 0.3], forkW: 0.06,
    lamp: { x: 0.46, y: 0.26, r: 0.075 },
    wheel: { rim: 0.6, hub: 0.2, spokes: 3, treads: 12, disc: false },
  },
  {
    id: 'cafe',
    body: [
      [-0.5, 0.02], [-0.56, 0.14], [-0.48, 0.24], [-0.32, 0.18], [-0.08, 0.15], [0.12, 0.18],
      [0.32, 0.28], [0.46, 0.22], [0.48, 0.08], [0.34, -0.01], [0.04, -0.05], [-0.3, -0.04],
    ],
    tank: [[0.0, 0.02], [0.6, 0.06], [0.6, 0.3], [0.0, 0.2]],
    seat: [[-0.58, 0.08], [-0.3, 0.12], [-0.34, 0.22], [-0.58, 0.24]],
    pipe: { from: [0.02, -0.08], ctrl: [-0.22, -0.2], mid: [-0.42, -0.22], tip: [-0.8, -0.2], w: 0.058, tipR: 0.04 },
    vent: null,
    swing: [-0.12, -0.02], swingW: 0.055,
    fork: [0.36, 0.26], forkW: 0.05,
    lamp: { x: 0.45, y: 0.18, r: 0.085 },
    wheel: { rim: 0.64, hub: 0.16, spokes: 6, treads: 0, disc: false },
  },
  {
    id: 'moto',
    body: [
      [-0.5, 0.16], [-0.52, 0.3], [-0.34, 0.32], [-0.12, 0.3], [-0.02, 0.26], [0.08, 0.34],
      [0.3, 0.36], [0.44, 0.26], [0.42, 0.08], [0.16, -0.01], [-0.2, -0.02], [-0.46, 0.06],
    ],
    tank: [[-0.05, 0.0], [0.5, 0.1], [0.5, 0.34], [-0.05, 0.3]],
    seat: [[-0.58, 0.24], [-0.05, 0.27], [-0.05, 0.36], [-0.58, 0.34]],
    pipe: { from: [0.06, -0.04], ctrl: [-0.12, 0.0], mid: [-0.32, 0.05], tip: [-0.52, 0.12], w: 0.07, tipR: 0.05 },
    vent: null,
    swing: [-0.08, -0.03], swingW: 0.075,
    fork: [0.3, 0.32], forkW: 0.055,
    lamp: { x: 0.42, y: 0.3, r: 0.07 },
    wheel: { rim: 0.54, hub: 0.22, spokes: 4, treads: 16, disc: false },
  },
  {
    id: 'bobber',
    body: [
      [-0.44, 0.04], [-0.48, 0.18], [-0.34, 0.24], [-0.22, 0.16], [-0.02, 0.18], [0.14, 0.3],
      [0.34, 0.32], [0.46, 0.2], [0.48, 0.02], [0.3, -0.05], [-0.04, -0.06], [-0.34, -0.02],
    ],
    tank: [[0.0, 0.0], [0.55, 0.08], [0.55, 0.34], [0.0, 0.32]],
    seat: [[-0.54, 0.1], [-0.24, 0.12], [-0.26, 0.24], [-0.54, 0.22]],
    pipe: { from: [0.04, -0.1], ctrl: [-0.18, -0.24], mid: [-0.42, -0.24], tip: [-0.74, -0.22], w: 0.095, tipR: 0.065 },
    vent: null,
    swing: [-0.14, -0.05], swingW: 0.08,
    fork: [0.34, 0.28], forkW: 0.07,
    lamp: { x: 0.44, y: 0.22, r: 0.09 },
    wheel: { rim: 0.72, hub: 0.26, spokes: 5, treads: 10, disc: false },
  },
  {
    id: 'mono',
    body: [
      [-0.54, 0.08], [-0.5, 0.3], [-0.16, 0.34], [0.22, 0.34], [0.46, 0.24],
      [0.48, 0.1], [0.3, -0.03], [-0.1, -0.05], [-0.42, 0.0],
    ],
    tank: [[-0.6, 0.18], [0.6, 0.12], [0.6, 0.26], [-0.6, 0.32]],
    seat: [[-0.58, 0.2], [-0.2, 0.24], [-0.2, 0.36], [-0.58, 0.34]],
    pipe: null,
    vent: [[-0.4, 0.02], [-0.12, 0.04], [-0.12, 0.12], [-0.4, 0.1]],
    swing: [-0.16, -0.02], swingW: 0.085,
    fork: [0.32, 0.3], forkW: 0.065,
    lamp: { x: 0.44, y: 0.16, r: 0.06 },
    wheel: { rim: 0.78, hub: 0.18, spokes: 0, treads: 0, disc: true },
  },
  {
    id: 'trials',
    body: [
      [-0.42, 0.16], [-0.46, 0.24], [-0.26, 0.26], [-0.04, 0.2], [0.12, 0.18],
      [0.3, 0.24], [0.42, 0.18], [0.4, 0.08], [0.14, 0.02], [-0.16, 0.04], [-0.38, 0.09],
    ],
    tank: [[0.02, 0.04], [0.45, 0.1], [0.45, 0.26], [0.02, 0.22]],
    seat: [[-0.5, 0.18], [-0.24, 0.2], [-0.24, 0.28], [-0.5, 0.26]],
    pipe: { from: [0.06, -0.02], ctrl: [-0.14, 0.04], mid: [-0.34, 0.08], tip: [-0.54, 0.14], w: 0.052, tipR: 0.036 },
    vent: null,
    swing: [-0.06, 0.04], swingW: 0.05,
    fork: [0.28, 0.24], forkW: 0.045,
    lamp: null,
    wheel: { rim: 0.5, hub: 0.14, spokes: 8, treads: 14, disc: false },
  },
];

const SHAPE_BY_ID = new Map(SHAPES.map((s) => [s.id, s]));

export function bikeShape(id: string): BikeShape {
  return SHAPE_BY_ID.get(id) ?? SHAPES[0];
}

export const ALL_SHAPES: readonly BikeShape[] = SHAPES;

// --- the rider ---------------------------------------------------------------

export interface JacketCut {
  id: string;
  /** Torso outline, chassis-local, relative to the shoulder and hip anchors. */
  torso: readonly Pt[];
  /** Arm stroke width. */
  arm: number;
  /** A shoulder flash in the trim colour, or null. */
  flash: readonly Pt[] | null;
  /** True for an open front: a wedge of the jacket colour is cut back. */
  open: boolean;
}

/**
 * Torso points are given in a frame anchored on the shoulder (sh) and hip
 * points the pose computes, as `[dxFromShoulder, dyFromShoulder]` for the first
 * three and `[dxFromHip, dyFromHip]` for the last two — see `drawRider`. They
 * therefore move with the pendulum rather than being a fixed pose.
 */
const JACKET_CUTS: readonly JacketCut[] = [
  {
    id: 'bomber',
    torso: [[-0.17, -0.01], [0.04, 0.12], [0.17, -0.06]],
    arm: 0.1,
    flash: null,
    open: false,
  },
  {
    id: 'racer',
    torso: [[-0.13, -0.02], [0.03, 0.1], [0.14, -0.05]],
    arm: 0.085,
    flash: [[-0.1, 0.02], [0.06, 0.1], [0.04, 0.03], [-0.1, -0.03]],
    open: false,
  },
  {
    id: 'vest',
    torso: [[-0.15, -0.03], [0.02, 0.09], [0.13, -0.07]],
    arm: 0.07,
    flash: null,
    open: true,
  },
];

export function jacketCut(id: string): JacketCut {
  return JACKET_CUTS.find((j) => j.id === id) ?? JACKET_CUTS[0];
}

export const ALL_JACKETS: readonly JacketCut[] = JACKET_CUTS;

export interface ScarfStyle {
  id: string;
  /** Segments. 0 means no scarf at all. */
  segments: number;
  /** Total trailing length, metres. */
  length: number;
  /** Stroke width, metres. */
  w: number;
  /** How hard the wind moves it. */
  sway: number;
}

const SCARF_STYLES: readonly ScarfStyle[] = [
  { id: 'trail', segments: 6, length: 0.62, w: 0.09, sway: 0.09 },
  { id: 'none', segments: 0, length: 0, w: 0, sway: 0 },
  { id: 'short', segments: 3, length: 0.24, w: 0.08, sway: 0.05 },
];

export function scarfStyle(id: string): ScarfStyle {
  return SCARF_STYLES.find((s) => s.id === id) ?? SCARF_STYLES[0];
}

export const ALL_SCARVES: readonly ScarfStyle[] = SCARF_STYLES;

// --- helmets -----------------------------------------------------------------
//
// THE HEAD IS THE DEATH SPHERE AND IT IS DRAWN AT ITS TRUE RADIUS, ALWAYS.
//
// Every helmet below decorates the head circle FROM THE INSIDE: the renderer
// fills the circle at `headDrawRadius`, clips to that same circle, and draws
// the helmet's primitives inside the clip. So a rect that runs past the edge is
// trimmed by the circle and a helmet CANNOT change the silhouette of the thing
// that kills you. A generous-looking helmet would be a lie about the kill
// volume, and it is the one lie this renderer is not allowed to tell.
//
// `headDrawRadius` exists as a function purely so that lie is a test failure
// rather than a code review: if anybody ever adds a per-helmet outset, the
// assertion in bikeart.test.ts fires.

export function headDrawRadius(spec: BikeSpec, _helmet: string): number {
  return spec.rider.headRadius;
}

/** Sanity bound on declared helmet art, in head radii. Everything is clipped anyway. */
export const HELMET_MAX_EXTENT = 1.7;

export interface HelmetStyle {
  id: string;
  /** Visor / lens rects in head-radius units: [x, y, w, h]. */
  lens: readonly (readonly [number, number, number, number])[];
  /** Band rects in the frame colour. */
  band: readonly (readonly [number, number, number, number])[];
  /** Studs and strap dots in the trim colour: [x, y, r]. */
  studs: readonly (readonly [number, number, number])[];
  /** Where the shaded underside of the shell starts, in head radii. */
  shadeY: number;
}

const HELMET_STYLES: readonly HelmetStyle[] = [
  {
    // The shipped visor, to the decimal.
    id: 'visor',
    lens: [[-0.1, -0.5, 1.3, 0.85]],
    band: [],
    studs: [],
    shadeY: 0.3,
  },
  {
    id: 'goggles',
    lens: [[0.05, -0.36, 0.62, 0.62], [-0.62, -0.3, 0.5, 0.5]],
    band: [[-1.2, -0.12, 2.4, 0.22]],
    studs: [[-0.72, -0.05, 0.1]],
    shadeY: 0.42,
  },
  {
    id: 'halfshell',
    lens: [[0.35, -0.2, 0.9, 0.3]],
    band: [[-1.2, -0.62, 2.4, 0.3]],
    studs: [[0.5, 0.24, 0.12]],
    shadeY: 0.18,
  },
  {
    id: 'bucket',
    lens: [[0.1, -0.3, 1.1, 0.55]],
    band: [[-1.2, -0.72, 2.4, 0.36], [-1.2, 0.12, 2.4, 0.2]],
    studs: [[-0.55, -0.55, 0.11], [0.35, -0.55, 0.11]],
    shadeY: 0.46,
  },
];

export function helmetStyle(id: string): HelmetStyle {
  return HELMET_STYLES.find((h) => h.id === id) ?? HELMET_STYLES[0];
}

export const ALL_HELMETS: readonly HelmetStyle[] = HELMET_STYLES;

// --- decals ------------------------------------------------------------------
//
// Placed relative to the BODY'S OWN BOUNDING BOX rather than authored per bike,
// so a marking lands sensibly on all six shapes with one set of numbers — and,
// more to the point, so adding a seventh bike cannot forget to place them. Drawn
// clipped to the body path, which is what makes them structurally incapable of
// extending the outline.

export interface BodyBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function bodyBox(shape: BikeShape): BodyBox {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of shape.body) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

/** A digit for the number plate, derived from the player's id. Cosmetic, stable. */
export function plateNumber(playerId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < playerId.length; i++) {
    h ^= playerId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return String((h % 99) + 1);
}

// --- colour ------------------------------------------------------------------
//
// THE GUARANTEE, AND HOW IT IS MADE.
//
// A colourway is hues and target luminances, never hex. The hex is solved per
// LEVEL, because the level's palette is derived from its own simHash and a bike
// that reads well on 03 may vanish on 11. The floors below are stated against
// the one thing that is true of every palette this game can produce: TERRAIN IS
// DARK BY LAW. `derivePalette` caps every terrain tone at TERRAIN_MAX_LUM and
// the solid at a fraction of that, because the whole art direction is built on
// solids being dark and air being light.
//
// So the bike's floor is a floor against the brightest terrain tone, solved with
// `atLum` exactly the way the collision lips are. Clear that and the part also
// clears its own ink outline (ink is darker than the solid by construction),
// which is what separates it from the LIGHT half of the frame — the same
// ink-and-lip mechanism the terrain edge uses, and the reason the shipped cream
// bodywork reads against a pale wall at contrast 1.3.
//
// Two floors, not one, because two different things can go wrong:
//
//   * every part must read against the material it can be drawn over;
//   * the HEAD must read more loudly than that, and must be the brightest thing
//     on the bike, because it is the death sphere. "Three identical pale
//     circles" was the failure the shipped art called out when it put the wheel
//     hubs in ink rather than cream, and giving players a helmet colour is a new
//     way to reintroduce it.
//
// The head is kept distinct from the wheels by CONSTRUCTION rather than by
// rejection: every colourway places its helmet hue at least HEAD_HUE_APART
// degrees from its wheel and frame hues, and the test asserts it. Contrast ratio
// is luminance-only and would call a yellow and a blue at the same luminance
// identical, which is exactly wrong for this question.

/** Every bike part must clear this against the brightest terrain tone it can sit on. */
export const BIKE_MIN_CONTRAST = 3.2;
/** The death sphere clears the lit lip's floor instead — it is the thing that kills you. */
export const HEAD_MIN_CONTRAST = 4.6;
/** And is never dimmer than this, so it is always the brightest part of the bike. */
export const HEAD_MIN_LUM = 0.68;
/** Luminance ceiling on every part that is NOT the head, so the head always wins. */
export const BIKE_MAX_LUM = 0.55;
/** A marking drawn ON another bike colour must clear this against its own ground. */
export const DECOR_MIN_CONTRAST = 1.7;
/** Minimum hue separation between the helmet and the wheel/frame, in degrees. */
export const HEAD_HUE_APART = 45;

/**
 * The brightest tone a bike part can be drawn over inside the terrain.
 *
 * Same set the lips measure against, plus the ink: a bike overlaps the solid
 * fill, both patch tones and all three cel bands as it rides past a face, and
 * clearing the brightest of them clears all of them.
 */
export function worstTerrainLum(p: Palette): number {
  return Math.max(
    lum(p.solid), lum(p.patchA), lum(p.patchB),
    lum(p.bandTop), lum(p.bandSide), lum(p.bandUnder),
    lum(p.ink),
  );
}

/**
 * The luminance needed to clear `floor` against a tone of luminance `against`,
 * plus two per cent.
 *
 * The margin is not decoration and the reason is palette.ts's: `atLum` lands on
 * the nearest reachable 8-bit triple, which is sometimes a hair under the exact
 * target, and a guarantee that is true to three decimals and false to four is
 * not a guarantee.
 */
function needed(floor: number, against: number): number {
  return floor * 1.02 * (against + 0.05) - 0.05;
}

/** The luminance ceiling that keeps a marking `floor` clear of its ground. */
function ceilAgainst(ground: number, floor: number): number {
  return (ground + 0.05) / (floor * 1.02) - 0.05;
}

interface Ink {
  h: number;
  s: number;
  /** Target luminance. Clamped by the floors above on the way to a hex. */
  l: number;
}

export interface PaintScheme {
  id: string;
  frame: Ink;
  panel: Ink;
  wheel: Ink;
  head: Ink;
  visor: Ink;
  jacket: Ink;
  scarf: Ink;
  trim: Ink;
  decal: Ink;
}

/**
 * Build a scheme from five hues.
 *
 * The saturations and target luminances are FIXED across every colourway, which
 * is what makes them a family rather than ten unrelated pickers: the frame sits
 * mid, the accents sit slightly brighter, and the helmet is always a pale, low
 * chroma tint near the top of the range. That last one is a deliberate trade —
 * helmets vary in HUE and in style, not in darkness, because the death sphere
 * has to stay the palest and loudest thing on the bike and a player must not be
 * able to trade that away for a moody black helmet.
 */
function scheme(id: string, h: { frame: number; panel: number; wheel: number; head: number; accent: number }): PaintScheme {
  return {
    id,
    frame: { h: h.frame, s: 0.72, l: 0.42 },
    panel: { h: h.panel, s: 0.82, l: 0.47 },
    wheel: { h: h.wheel, s: 0.8, l: 0.44 },
    head: { h: h.head, s: 0.3, l: 0.78 },
    visor: { h: h.accent, s: 0.8, l: 0.22 },
    jacket: { h: h.accent, s: 0.76, l: 0.44 },
    scarf: { h: h.panel, s: 0.86, l: 0.5 },
    trim: { h: h.accent, s: 0.86, l: 0.52 },
    decal: { h: h.head, s: 0.55, l: 0.18 },
  };
}

/**
 * The ten liveries.
 *
 * Every one places its helmet hue at least HEAD_HUE_APART from both the wheel
 * and the frame, which is the construction that keeps the death sphere from
 * reading as a third wheel. The test asserts it rather than trusting this note.
 */
const SCHEMES: readonly PaintScheme[] = [
  scheme('ember', { frame: 12, panel: 32, wheel: 4, head: 200, accent: 44 }),
  scheme('citrus', { frame: 58, panel: 92, wheel: 50, head: 305, accent: 104 }),
  scheme('mint', { frame: 148, panel: 166, wheel: 140, head: 14, accent: 8 }),
  scheme('ice', { frame: 196, panel: 182, wheel: 210, head: 48, accent: 174 }),
  scheme('orchid', { frame: 286, panel: 320, wheel: 272, head: 96, accent: 330 }),
  scheme('slate', { frame: 222, panel: 216, wheel: 228, head: 52, accent: 50 }),
  scheme('sunset', { frame: 22, panel: 340, wheel: 8, head: 186, accent: 350 }),
  scheme('lagoon', { frame: 178, panel: 190, wheel: 168, head: 40, accent: 36 }),
  scheme('bone', { frame: 36, panel: 26, wheel: 30, head: 214, accent: 2 }),
  scheme('acid', { frame: 82, panel: 70, wheel: 94, head: 288, accent: 340 }),
];

const SCHEME_BY_ID = new Map(SCHEMES.map((s) => [s.id, s]));

export function paintScheme(id: string): PaintScheme {
  return SCHEME_BY_ID.get(id) ?? SCHEMES[0];
}

export const ALL_SCHEMES: readonly PaintScheme[] = SCHEMES;

/** Every slot that is drawn against the LEVEL and therefore carries the terrain floor. */
export const LEVEL_SLOTS = ['frame', 'panel', 'wheel', 'jacket', 'scarf', 'trim', 'metal'] as const;
/** Slots drawn ON another bike colour, and therefore floored against that instead. */
export const DECOR_SLOTS = ['visor', 'decal'] as const;

export interface BikeColors {
  frame: string;
  panel: string;
  wheel: string;
  jacket: string;
  scarf: string;
  trim: string;
  /** The exhaust and fork chrome. Not player-chosen; still floored. */
  metal: string;
  /** The death sphere. Brightest thing on the bike, always. */
  head: string;
  visor: string;
  decal: string;
  /**
   * The tyre carcass, and the ONE part exempt from the floor — deliberately and
   * with a reason rather than by omission. A tyre is dark because tyres are
   * dark; it is a narrow annulus with a rim inside it that is NOT dark, and it
   * carries the ink outline's job on the outside. Making it clear a contrast
   * floor against the terrain would produce a bike with pale tyres and no
   * wheels, which reads worse, not better.
   */
  tyre: string;
  /** Trousers and boots. Dark for the same reason as the tyre, and outlined. */
  dark: string;
  /** Every outline in the game. Straight off the palette. */
  ink: string;
}

/**
 * Solve a colourway against ONE level's palette.
 *
 * Pure, cheap, and the whole guarantee: give it any appearance and any palette
 * and the colours that come back clear the floors. `bikeFaults` below is the
 * same statement as a checkable predicate, and the test sweeps the product of
 * every bike type, every accessory and every level palette through both.
 */
export function resolveBikeColors(app: Appearance, P: Palette): BikeColors {
  const s = paintScheme(app.paint);
  const worst = worstTerrainLum(P);
  const floorL = needed(BIKE_MIN_CONTRAST, worst);

  // The ceiling is a preference and the floor is the rule, so the floor is
  // applied LAST and wins — the same `max`-not-clamp shape the underside lip
  // uses in palette.ts. On a hand-authored palette with illegally bright
  // terrain that can push a part past the ceiling; `bikeFaults` then says so
  // rather than the colour quietly being wrong.
  const level = (k: Ink): string => atLum(k.h, k.s, Math.max(floorL, Math.min(BIKE_MAX_LUM, k.l)));

  const head = atLum(s.head.h, s.head.s, Math.max(needed(HEAD_MIN_CONTRAST, worst), HEAD_MIN_LUM, s.head.l));
  const frame = level(s.frame);

  return {
    frame,
    panel: level(s.panel),
    wheel: level(s.wheel),
    jacket: level(s.jacket),
    scarf: level(s.scarf),
    trim: level(s.trim),
    // Chrome: the room's own hue, washed almost out. It follows the palette
    // family so an exhaust does not read as a colour nothing else in the level
    // has, and it carries the same floor as everything else.
    metal: level({ h: hueOf(P.wall[0]), s: 0.09, l: 0.52 }),
    head,
    // Markings sit ON a bike colour, never against the level, so their floor is
    // against their own ground — and they get there by DIMMING, because both
    // grounds are bright by the rules above and there is nowhere brighter to go.
    visor: atLum(s.visor.h, s.visor.s, Math.min(s.visor.l, ceilAgainst(lum(head), DECOR_MIN_CONTRAST))),
    decal: atLum(s.decal.h, s.decal.s, Math.min(s.decal.l, ceilAgainst(lum(frame), DECOR_MIN_CONTRAST))),
    tyre: mixHex(P.ink, P.solid, 0.55),
    dark: mixHex(P.ink, P.solid, 0.35),
    ink: P.ink,
  };
}

/**
 * How far a resolved bike is from meeting the readability guarantee. Empty means
 * it meets it.
 *
 * Exported, and shaped like `paletteFaults` on purpose: the test can say WHICH
 * slot failed against WHICH palette rather than that something did, and a
 * hand-authored `style.colors` override can be audited exactly the way a derived
 * palette is.
 */
export function bikeFaults(c: BikeColors, P: Palette): string[] {
  const faults: string[] = [];
  const worst = Math.max(lum(P.solid), lum(P.patchA), lum(P.patchB), lum(P.bandTop), lum(P.bandSide), lum(P.bandUnder));
  const worstHex = [P.solid, P.patchA, P.patchB, P.bandTop, P.bandSide, P.bandUnder]
    .reduce((m, x) => (lum(x) > lum(m) ? x : m), P.solid);

  for (const slot of LEVEL_SLOTS) {
    const v = contrast(c[slot], worstHex);
    if (v < BIKE_MIN_CONTRAST) faults.push(`${slot} ${v.toFixed(2)} < ${BIKE_MIN_CONTRAST} vs terrain`);
    const vi = contrast(c[slot], c.ink);
    if (vi < BIKE_MIN_CONTRAST) faults.push(`${slot} ${vi.toFixed(2)} < ${BIKE_MIN_CONTRAST} vs its own outline`);
  }

  const h = contrast(c.head, worstHex);
  if (h < HEAD_MIN_CONTRAST) faults.push(`head ${h.toFixed(2)} < ${HEAD_MIN_CONTRAST} vs terrain`);
  if (lum(c.head) < HEAD_MIN_LUM) faults.push(`head luminance ${lum(c.head).toFixed(3)} < ${HEAD_MIN_LUM}`);
  for (const slot of LEVEL_SLOTS) {
    if (lum(c[slot]) >= lum(c.head)) faults.push(`${slot} is at least as bright as the death sphere`);
  }

  const v = contrast(c.visor, c.head);
  if (v < DECOR_MIN_CONTRAST) faults.push(`visor ${v.toFixed(2)} < ${DECOR_MIN_CONTRAST} vs the helmet`);
  const d = contrast(c.decal, c.frame);
  if (d < DECOR_MIN_CONTRAST) faults.push(`decal ${d.toFixed(2)} < ${DECOR_MIN_CONTRAST} vs the bodywork`);

  // Unused, but computed above and worth naming if a palette ever breaks the
  // law it is generated under — a bike cannot be lifted clear of terrain that
  // is brighter than the terrain rules allow.
  if (worst > 0.2) faults.push(`terrain luminance ${worst.toFixed(3)} is brighter than the inversion allows`);
  return faults;
}

/** Which `LEVEL_SLOTS`/`DECOR_SLOTS` this appearance actually puts on screen. */
export function slotsUsed(app: Appearance): string[] {
  const out = ['frame', 'wheel', 'jacket', 'head', 'ink', 'tyre', 'dark'];
  const shape = bikeShape(app.bike);
  if (shape.pipe || shape.vent) out.push('metal');
  out.push('panel');
  if (scarfStyle(app.scarf).segments > 0) out.push('scarf');
  const helmet = helmetStyle(app.helmet);
  if (helmet.lens.length > 0) out.push('visor');
  if (helmet.studs.length > 0 || jacketCut(app.jacket).flash) out.push('trim');
  if (app.decal !== 'none') out.push('decal');
  return out;
}

// --- catalogue coverage ------------------------------------------------------
//
// A list you have to remember to update is a list that is wrong. These two are
// asserted against each other so that adding an option to the shared catalogue
// without adding its art — or the reverse — fails the build rather than drawing
// the default and looking like it worked.

export function catalogueGaps(): string[] {
  const gaps: string[] = [];
  const check = (
    what: string,
    ids: readonly { id: string }[],
    art: readonly { id: string }[],
  ): void => {
    for (const o of ids) if (!art.some((a) => a.id === o.id)) gaps.push(`${what} "${o.id}" has no art`);
    for (const a of art) if (!ids.some((o) => o.id === a.id)) gaps.push(`${what} art "${a.id}" is not offered`);
  };
  check('bike', BIKES, SHAPES);
  check('paint', PAINTS, SCHEMES);
  check('helmet', HELMETS, HELMET_STYLES);
  check('jacket', JACKETS, JACKET_CUTS);
  check('scarf', SCARVES, SCARF_STYLES);
  // Decals are placed from the body box rather than authored per bike, so there
  // is no per-decal art table to fall out of step — the renderer switches on the
  // id directly and the list below is the whole of it.
  for (const d of DECALS) {
    if (!['none', 'stripe', 'number', 'checks'].includes(d.id)) gaps.push(`decal "${d.id}" has no drawing`);
  }
  return gaps;
}

/** Colourways whose helmet hue is too close to their wheel or frame. */
export function schemeFaults(s: PaintScheme): string[] {
  const out: string[] = [];
  const dw = hueDist(s.head.h, s.wheel.h);
  const df = hueDist(s.head.h, s.frame.h);
  if (dw < HEAD_HUE_APART) out.push(`${s.id}: helmet hue is ${dw.toFixed(0)} deg from the wheel`);
  if (df < HEAD_HUE_APART) out.push(`${s.id}: helmet hue is ${df.toFixed(0)} deg from the frame`);
  return out;
}

// --- one look, resolved ------------------------------------------------------

/**
 * Everything the renderer needs to draw ONE person's bike, in one object.
 *
 * It exists so there is a single place where an appearance becomes colours, and
 * therefore a single answer to "what livery is this bike in". The hazard the
 * user named is two code paths disagreeing and putting half a montage in one
 * livery and half in another; a `BikeLook` is the object that cannot happen to.
 */
export interface BikeLook {
  app: Appearance;
  colors: BikeColors;
  /** The competition number, or '' when the markings are not a number plate. */
  plate: string;
}

export function makeLook(app: Appearance, P: Palette, playerId?: string | null): BikeLook {
  return {
    app,
    colors: resolveBikeColors(app, P),
    plate: app.decal === 'number' ? plateNumber(playerId || app.paint) : '',
  };
}
