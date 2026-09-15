// Everything about a level's look that is NOT a colour.
//
// A palette swap alone still reads as the same room repainted. What actually
// makes two levels feel like two places is that the concrete is coursed
// differently, the light falls at a different angle, the stains run heavier,
// the hatch is coarser. None of those are hues and none of them can be reached
// by recolouring, so they get their own derived object.
//
// Derived from simHash, exactly like the palette, so a level looks the same on
// every load and different from its neighbours with no hand-authoring. A level
// may override any field through `style.variant`, and — like every other art
// hint — a malformed override is ignored rather than fatal.
//
// THE `variety` KNOB. Every field is generated as a midpoint plus a spread, and
// the panel's `variety` multiplier scales the spread rather than the value. At
// 0 every level gets the identical mid parameters, which is Phase 1's look and
// therefore the honest A/B for "did the variation earn its place"; at 1 the
// generator runs to its full range. That is only possible because the spread is
// separated from the midpoint here rather than baked into one random draw.
import type { LevelStyle } from '@/sim/level.ts';
import { rng, seedFrom } from './rng.ts';

export interface StyleVariant {
  /** Concrete panel pitch, metres. Coursing is the loudest non-colour cue. */
  panelW: number;
  panelH: number;
  /** Panels get a lighter or darker tone this often, 0..1. */
  panelTone: number;
  /** Runs down the wall, 0..1. */
  stainDensity: number;
  /** Stencil stamps on the wall, per square metre. */
  stampPerM2: number;
  /** Terrain blotches per square metre, and their radius. */
  patchPerM2: number;
  patchRadius: number;
  /** Cracks per square metre. */
  crackPerM2: number;
  /** Metres between hatch lines over the terrain. */
  hatchPitch: number;
  /** Run of the hatch: 1 is 45 degrees, larger lies flatter. */
  hatchSlope: number;
  /** Steps in the background luminance ramp. */
  lumBands: number;
  /** How ragged the boundary between two luminance bands is, as a fraction. */
  lumJag: number;
  /** Shafts of light, and how far off vertical they lean. */
  wedgeCount: number;
  wedgeSlant: number;
  wedgeWidth: number;
  /** Where the light comes from across the level, 0 = left edge, 1 = right. */
  wedgeAt: number;
  /** Parallax silhouette layers behind the play space. */
  parallaxLayers: number;
  /** How much of the level's own geometry the furthest layer keeps, 0..1. */
  parallaxDepth: number;
  /** Multiplier on the prop budget for this level. */
  propDensity: number;
}

/** The midpoint of every field: what a level gets at variety 0. */
export const MID_VARIANT: StyleVariant = {
  panelW: 2.0,
  panelH: 1.0,
  panelTone: 0.26,
  stainDensity: 0.12,
  stampPerM2: 0.012,
  patchPerM2: 0.11,
  patchRadius: 0.87,
  crackPerM2: 0.035,
  hatchPitch: 0.26,
  hatchSlope: 1,
  lumBands: 6,
  lumJag: 0.04,
  wedgeCount: 2,
  wedgeSlant: 0,
  wedgeWidth: 1,
  wedgeAt: 0.5,
  parallaxLayers: 2,
  parallaxDepth: 0.55,
  propDensity: 1,
};

/**
 * Half-widths. A field's value is `mid + (r - 0.5) * 2 * spread * variety`,
 * clamped by `LIMITS`, so `variety` is a single honest dial over the whole
 * generator and every number here can be read as "how far can this move".
 */
const SPREAD: Record<keyof StyleVariant, number> = {
  panelW: 1.1,
  panelH: 0.45,
  panelTone: 0.2,
  stainDensity: 0.11,
  stampPerM2: 0.006,
  patchPerM2: 0.04,
  patchRadius: 0.42,
  crackPerM2: 0.026,
  hatchPitch: 0.14,
  hatchSlope: 0.75,
  lumBands: 2.4,
  lumJag: 0.035,
  wedgeCount: 1.4,
  wedgeSlant: 0.42,
  wedgeWidth: 0.7,
  wedgeAt: 0.34,
  parallaxLayers: 1.4,
  parallaxDepth: 0.22,
  propDensity: 0.55,
};

/** Hard bounds. These are the numbers that keep the generator from being unfair. */
const LIMITS: Record<keyof StyleVariant, [number, number]> = {
  // THESE FLOORS ARE A FRAME-BUDGET NUMBER, not a taste one. The panel grid is
  // strokes per square metre and it scales as 1/(panelW * panelH), so a 0.9 x
  // 0.5 m course is four and a half times the work of the 2.0 x 1.0 the mockup
  // used. Measured on 20-close-quarters, where the solid fills half the frame,
  // the first version of this generator took the wall-detail layer from about
  // 1.3 ms to 3.1 — on the one level that had no headroom to give. 1.3 x 0.7
  // still reads as a different, blockier room and costs about twice, not five
  // times.
  panelW: [1.3, 4.2],
  panelH: [0.7, 2.2],
  panelTone: [0.04, 0.55],
  stainDensity: [0, 0.3],
  stampPerM2: [0, 0.018],
  patchPerM2: [0.03, 0.15],
  patchRadius: [0.45, 1.5],
  crackPerM2: [0, 0.07],
  // The hatch pitch floor is a frame-budget number, not a taste one: it is
  // drawn live over the viewport, so halving it doubles a per-frame stroke
  // count on the level where the solid fills the screen.
  hatchPitch: [0.18, 0.52],
  hatchSlope: [0.35, 2.2],
  lumBands: [4, 9],
  lumJag: [0, 0.09],
  wedgeCount: [0, 4],
  wedgeSlant: [-0.5, 0.5],
  wedgeWidth: [0.4, 1.9],
  wedgeAt: [0.12, 0.88],
  parallaxLayers: [0, 3],
  parallaxDepth: [0.3, 0.8],
  propDensity: [0.3, 1.7],
};

const KEYS = Object.keys(MID_VARIANT) as (keyof StyleVariant)[];
const INTEGER: (keyof StyleVariant)[] = ['lumBands', 'wedgeCount', 'parallaxLayers'];

/** Fields where a bigger number is more work per frame. */
const DENSER_IS_DEARER: (keyof StyleVariant)[] = [
  'patchPerM2', 'crackPerM2', 'stampPerM2', 'stainDensity', 'panelTone', 'parallaxLayers',
];
/** Fields where a SMALLER number is more work per frame. */
const FINER_IS_DEARER: (keyof StyleVariant)[] = ['panelW', 'panelH', 'hatchPitch'];

function clamp(k: keyof StyleVariant, v: number): number {
  const [lo, hi] = LIMITS[k];
  const c = v < lo ? lo : v > hi ? hi : v;
  return INTEGER.includes(k) ? Math.round(c) : c;
}

/**
 * The look parameters for a level.
 *
 * `variety` comes from the panel and scales the spread, not the value, so 0 is
 * exactly Phase 1's uniform look and anything above it is this level being
 * itself. Explicit `style.variant` fields win over the derivation, and a field
 * that is not a finite number is ignored — a cosmetic hint must never be able
 * to stop a level loading or to hand the bake a NaN.
 */
export function deriveVariant(
  simHash: string, variety: number, style?: LevelStyle | null, solidFrac = 0,
): StyleVariant {
  const r = rng(seedFrom(`variant:${simHash}`));
  const v = Math.max(0, variety);
  const out = { ...MID_VARIANT };
  // Fixed key order, so adding a field at the end cannot reshuffle every level
  // already authored — the same discipline the RNG substreams exist for.
  for (const k of KEYS) out[k] = clamp(k, MID_VARIANT[k] + (r() - 0.5) * 2 * SPREAD[k] * v);

  // THE DENSITY A LEVEL GETS IS BOUNDED BY WHAT ITS OWN FRAMES CAN AFFORD.
  //
  // The variant's whole point is that some rooms are grainier than others, and
  // the grain is what the user asked for. But render cost tracks visible solid
  // area, so "more texture" costs almost nothing on `16-one-way`, whose frames
  // are a tenth solid, and costs the entire remaining budget on
  // `20-close-quarters`, whose frames are half solid and which is the level the
  // choppiness was reported on. A single global range has to be set for the
  // worst level and is then timid everywhere else.
  //
  // So only the EXPENSIVE HALF of each density range is scaled back, and only
  // on the levels that cannot afford it. A busy level still gets a sparser
  // variant than its neighbour — the variety survives — it just cannot get a
  // denser one. This is the same reasoning as the prop budget, applied to the
  // texture.
  const busy = Math.max(0.15, Math.min(1, 1.3 - solidFrac * 1.6));
  if (busy < 1) {
    for (const k of DENSER_IS_DEARER) {
      if (out[k] > MID_VARIANT[k]) out[k] = MID_VARIANT[k] + (out[k] - MID_VARIANT[k]) * busy;
    }
    // Panel and hatch pitch are the other way round: SMALLER is denser.
    for (const k of FINER_IS_DEARER) {
      if (out[k] < MID_VARIANT[k]) out[k] = MID_VARIANT[k] - (MID_VARIANT[k] - out[k]) * busy;
    }
  }

  const over = style && typeof style.variant === 'object' && style.variant !== null
    ? (style.variant as Record<string, unknown>)
    : null;
  if (over) {
    for (const k of KEYS) {
      const x = over[k];
      if (typeof x === 'number' && Number.isFinite(x)) out[k] = clamp(k, x);
    }
  }
  return out;
}

/** A short identity for the bake signature: two variants that differ must differ here. */
export function variantKey(v: StyleVariant): string {
  let h = 0x811c9dc5;
  for (const k of KEYS) {
    const s = v[k].toFixed(4);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16);
}
