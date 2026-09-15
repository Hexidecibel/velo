// The palette, and the one rule the whole art direction rests on.
//
// THE INVERSION: solids are DARK and air is LIGHT. That is the opposite of the
// original renderer and it is not a taste call — it is what makes the collision
// boundary the highest-contrast line in a loud frame. A bright wall behind dark
// terrain means the silhouette of the ground reads first, before any texture,
// any sign and any prop; the ink-and-lip rule on top of it then makes the exact
// pixel of the boundary unmissable.
//
// Every colour an art layer uses comes from here. Nothing below this file may
// contain a literal colour, because the moment one does, a palette swap stops
// being a palette swap.
export interface Palette {
  /** Near-black. Every outline in the game is this colour. */
  ink: string;
  ink2: string;

  // --- terrain ---
  solid: string;
  patchA: string;
  patchB: string;
  /** Cel band on an up-facing edge — the lit one. */
  bandTop: string;
  /** Cel band on a vertical edge. */
  bandSide: string;
  /** Cel band on a down-facing edge — the dark one, with drips. */
  bandUnder: string;

  // --- the collision edge ---
  lipTop: string;
  lipSide: string;
  lipUnder: string;

  /** Background wall luminance ramp, lightest first. Light spills from above. */
  wall: string[];

  // --- accents ---
  yellow: string;
  orange: string;
  magenta: string;
  cyan: string;
  lime: string;
  cream: string;
  red: string;
  lilac: string;
  teal: string;
  rust: string;
  steel: string;
  steelD: string;
}

export const CONCRETE: Palette = {
  ink: '#0d0b1a',
  ink2: '#1a1630',
  solid: '#26214d',
  patchA: '#2f2960',
  patchB: '#1f1a40',
  bandTop: '#443b8c',
  bandSide: '#2b2557',
  bandUnder: '#171332',
  lipTop: '#ffd21f',
  lipSide: '#ff6a1f',
  lipUnder: '#8f7ad8',
  wall: ['#b9e3e6', '#93c4d2', '#6f9dbb', '#5a7ea3', '#4b6a92', '#3f5a82', '#364d73'],
  yellow: '#ffd21f',
  orange: '#ff6a1f',
  magenta: '#ff2f8e',
  cyan: '#29d9f2',
  lime: '#9dff3d',
  cream: '#fff6e8',
  red: '#ff3d3d',
  lilac: '#b39ddb',
  teal: '#1fb8a6',
  rust: '#c7412b',
  steel: '#9aa3b8',
  steelD: '#5e6478',
};

export const PALETTES: Record<string, Palette> = { concrete: CONCRETE };

export const DEFAULT_PALETTE = 'concrete';

/**
 * Look a palette up by name, falling back to the default.
 *
 * PHASE 1 NEVER CALLS THIS WITH A LEVEL'S OWN `style`. The `style` block is
 * parsed and carried but deliberately not honoured yet — shipping the format
 * before the behaviour is the cheap half of a one-way door, and wiring the
 * behaviour first would mean every level in the set silently acquiring a look
 * nobody has reviewed. This exists so that the Phase 2 wiring is one line.
 */
export function resolvePalette(name: string | undefined): Palette {
  if (!name) return CONCRETE;
  return PALETTES[name] ?? CONCRETE;
}

/** rgba() from a #rrggbb and an alpha. Cheap, and it keeps literals out of the layers. */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Composite `over` onto `hex` at alpha `a`, at BAKE time.
 *
 * The haze wash that pushes the background behind the solids was two
 * full-viewport alpha fills per frame, which on a CPU-rasterised canvas is two
 * milliseconds for a result that never changes. Since it is a constant wash over
 * a constant colour, the composite can be done once into the colour itself. The
 * arithmetic is the same; the per-frame cost is gone.
 */
export function wash(hex: string, over: [number, number, number], a: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number, o: number): number => Math.round(c + (o - c) * a);
  const r = mix((n >> 16) & 255, over[0]);
  const g = mix((n >> 8) & 255, over[1]);
  const b = mix(n & 255, over[2]);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** The haze: a cold wash, and a warmer one near the light at the top. */
export const HAZE: [number, number, number] = [60, 90, 140];
export const HAZE_A = 0.2;
