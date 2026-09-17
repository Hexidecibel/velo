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
import type { LevelStyle } from '@/sim/level.ts';
import { atLum, contrast, hexRgb, hsl, hueOf, lum, wrapHue } from './color.ts';
import { rng, seedFrom } from './rng.ts';

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
 * Look a palette up by name.
 *
 * Returns null for a name this build has never heard of, so the caller can fall
 * back to a DERIVED palette rather than to the one hand-authored one. An art
 * hint from a newer client must never stop a level loading, and it must not
 * quietly collapse twenty levels back onto a single look either.
 */
export function resolvePalette(name: string | undefined): Palette | null {
  if (!name) return null;
  return PALETTES[name] ?? null;
}

// --- derivation -------------------------------------------------------------
//
// THE PROBLEM THIS SOLVES: twenty levels sharing one palette read as twenty
// screenshots of the same room, which is a bigger readability and identity
// problem than prop density ever was. Every level therefore gets its own
// palette, derived from its simHash, so the whole set differs with no
// hand-authoring and a given level looks the same on every load and every
// machine.
//
// simHash and not contentHash, for the same reason the cracks use it:
// retitling a level must not repaint it.
//
// THE CONSTRAINT THAT MAKES THIS SAFE. A generated palette is a palette nobody
// looked at, and the one rule the whole art direction exists to serve is that
// the collision edge is the most legible line on screen. So the generator does
// not merely usually produce a legible lip — it cannot produce an illegible
// one. Every lip is lifted until it clears a contrast floor against the
// BRIGHTEST terrain tone in its own palette, which by construction is the
// brightest thing it can ever be drawn against inside the solid. palette.test.ts
// asserts that floor across hundreds of derived palettes.

/** Minimum contrast a lip must have against the brightest terrain tone. */
export const LIP_MIN_CONTRAST = 3.2;
/** The lit lip gets more, because it is the one marking rideable ground. */
export const LIP_TOP_MIN_CONTRAST = 4.6;
/** Minimum contrast between the solid and the wall it is silhouetted against. */
export const INVERSION_MIN_CONTRAST = 1.55;
/**
 * Luminance ceiling on the underside lip — a preference, not a floor: it is
 * abandoned rather than allowed to push the lip below LIP_MIN_CONTRAST.
 */
export const UNDER_MAX_LUM = 0.36;
/**
 * Luminance ceiling on the terrain tones — the lit cel band and the patch
 * tones. It exists for the lip's sake: they are the brightest things a lip is
 * ever stroked over, so an unbounded lit band would force the lit lip to
 * near-white just to clear its floor, and a palette of white lips is a palette
 * with no edge classes.
 */
export const TERRAIN_MAX_LUM = 0.085;

/**
 * A full palette from a seed.
 *
 * Structure rather than sampling is what makes the guarantees hold. The three
 * lip hues are placed at fixed minimum angular separations, so "the three edge
 * classes are distinguishable from each other" is true by construction and
 * needs no rejection loop; the luminance floors are then reached by lifting,
 * which always terminates because white clears every floor here.
 */
export function derivePalette(seed: number): Palette {
  const r = rng(seed);

  // The lip family anchors the palette: it is the one set of colours the
  // player is required to read, so everything else is positioned relative to it
  // rather than the other way round. The three hues are placed at fixed minimum
  // separations, which is what makes "the three edge classes are
  // distinguishable" true by construction rather than by rejection sampling.
  const lipH = r() * 360;
  const sideSign = r() < 0.5 ? -1 : 1;
  const sideH = wrapHue(lipH + sideSign * (48 + r() * 38));
  const underH = wrapHue(lipH + 150 + r() * 62);

  // The wall is usually OPPOSED to the lips — cold room, warm edges, which is
  // what the shipped concrete palette does and what keeps the edge from
  // blending into the background at a glance. A quarter of the time it is
  // merely adjacent, which reads as a single-temperature room.
  const opposed = r() < 0.75;
  const wallH = wrapHue(lipH + (opposed ? 140 + r() * 90 : 45 + r() * 45));
  // CHROMA IS A PRIMARY AXIS, AND LUMINANCE FOLLOWS FROM IT. This is the one
  // that decides whether two levels read as two places.
  //
  // Luminance and saturation trade against each other in sRGB: a hue driven to
  // a high luminance has to give up chroma to get there. Sampling the two
  // INDEPENDENTLY therefore does not do what it looks like it does — ask for
  // saturation 0.7 at luminance 0.6 and `atLum` hands back something near 0.2,
  // because that is all the hue can carry up there. The first twenty-level
  // contact sheet was twenty different solids behind twenty identical pale
  // walls for exactly this reason, and measuring the SET afterwards (see
  // palette.test.ts and bin/_palette-set.ts) showed it only half fixed: the
  // realised saturation of the twenty walls still bunched between 0.10 and
  // 0.30, and fourteen of the twenty sat inside one narrow luminance band.
  //
  // So chroma is chosen first and the luminance ceiling is derived from it.
  // A heavily saturated wall is allowed to be a DEEP room and a washed one is
  // allowed to be a BRIGHT one, which is two visibly different kinds of place
  // rather than twenty samples of the same overcast afternoon. Nothing here
  // touches an edge-contrast floor — those are the rule the whole look serves
  // and they are not the thing with slack in it. This varies WITHIN them.
  const wallS = 0.12 + r() * 0.86;

  // EVERYTHING BELOW IS CHOSEN IN LUMINANCE, NOT IN LIGHTNESS, and that is the
  // whole trick. The readability rule is a set of contrast ratios, contrast is
  // a function of luminance, and luminance at a fixed lightness varies by a
  // factor of five across the hue wheel — a lime at lightness 0.35 is brighter
  // than a navy at 0.6. Sampling lightness and repairing afterwards produced
  // palettes whose lit cel band was brighter than anything a saturated lip
  // could reach. Sampling luminance and solving for lightness makes the floors
  // arithmetic.

  // The room's luminance range, with the top of it CAPPED BY THE CHROMA above.
  //
  // 0.66 down to 0.30 across the chroma range is not a fudge factor: it is
  // roughly where sRGB actually runs out, so asking for more would just be
  // asking `atLum` to throw the chroma away again — which is the bug, not the
  // fix. The floor rises a little with chroma for the same reason from the
  // other end: a deeply saturated hue at luminance 0.1 is nearly black and
  // stops being a colour.
  const lumCeil = 0.66 - 0.36 * wallS;
  const lumFloor = 0.15 + 0.09 * wallS;
  // Skewed toward the ends rather than uniform, because the MIDDLE of this
  // range is where every room looked the same. Squaring a symmetric sample
  // pushes draws outward from the centre without ever leaving the range.
  const skew = r() * 2 - 1;
  const wallTopLum = lumFloor + (lumCeil - lumFloor) * 0.5 * (1 + Math.sign(skew) * skew * skew);
  // The bottom of the ramp, as a FRACTION of the top rather than an absolute:
  // an absolute floor under a dark top produces a flat wall with no ramp left
  // in it. 0.10 is the hard floor, because the inversion's contrast is measured
  // against the darkest wall tone and the solid has to fit underneath it.
  const wallBotLum = Math.max(0.1, wallTopLum * (0.18 + r() * 0.42));
  // How the ramp falls off. Below 1 it stays bright and then drops; above 1 it
  // darkens immediately. Another axis of room character that owes nothing to
  // hue — which is the point, because hue is the axis that collides. Twenty
  // independent uniform hues WILL put several levels in the same family (the
  // shipped set has eight of twenty between 243 and 299 degrees, and the RNG is
  // uniform to chi-square, so that is the birthday problem and not a bug). The
  // only honest answer is to make two rooms that share a hue still read
  // differently, so every non-hue axis here is deliberately wide.
  const rampGamma = 0.55 + r() * 2.05;
  // Hue drifts as the ramp darkens, so the shadowed end of the room is a
  // different colour from the lit end rather than the same colour turned down.
  // Widened from +-32 deg: at the old figure the drift was a tint, and a tint
  // is not a second colour.
  const wallDrift = (r() - 0.5) * 120;
  const wall: string[] = [];
  for (let i = 0; i < 7; i++) {
    const u = Math.pow(i / 6, rampGamma);
    // Chroma RISES as the ramp darkens rather than falling. The old ramp bled
    // 25 % of it away toward the bottom, which is backwards: a dark tone can
    // carry chroma a bright one cannot, and the shadowed end of a room is where
    // the colour survives.
    wall.push(atLum(wallH + wallDrift * u, Math.min(1, wallS * (1 + 0.35 * u)), wallTopLum + (wallBotLum - wallTopLum) * u));
  }

  // The solid is DARK BY LAW — the inversion is the bet the whole look rests on
  // — and its ceiling is derived from the wall it will be silhouetted against
  // rather than picked, so the silhouette can never lose against its own
  // background however dark this particular room came out.
  const darkestWall = wash(wall[wall.length - 1], HAZE, HAZE_A);
  // Same two per cent margin as the lips, and for the same reason: atLum lands
  // on the nearest reachable 8-bit triple, which can be a hair on the wrong
  // side of an exact ceiling.
  const solidCeil = (lum(darkestWall) + 0.05) / (INVERSION_MIN_CONTRAST * 1.02) - 0.05;
  const solidLum = Math.min(0.012 + r() * 0.032, solidCeil);
  // Widened from +-45: the solid is near-black by law so its hue reads faintly,
  // but "faintly" is not "not at all" and it is one more thing separating two
  // rooms that landed on the same wall hue.
  const solidH = wrapHue(wallH + (r() - 0.5) * 160);
  const solidS = 0.18 + r() * 0.45;
  const solid = atLum(solidH, solidS, solidLum);

  const ink = atLum(solidH, solidS * 0.7, solidLum * 0.2);
  const ink2 = atLum(solidH, solidS * 0.8, solidLum * 0.62);

  // Cel bands, again in luminance. `bandContrast` is the second independent
  // contrast axis: how hard the light is. Capped in absolute luminance because
  // the lit band is the brightest thing a lip is ever stroked over, and an
  // unbounded one would force the lit lip to near-white to clear its floor.
  const bandContrast = 1.8 + r() * 2.2;
  const bandTopLum = Math.min(TERRAIN_MAX_LUM, solidLum * bandContrast);
  const bandTop = atLum(wrapHue(solidH + (wallH - solidH) * 0.35), solidS * 0.85, bandTopLum);
  const bandSide = atLum(solidH, solidS, solidLum * (1.05 + (bandContrast - 1.8) * 0.12));
  const bandUnder = atLum(solidH, solidS * 1.05, solidLum * 0.42);
  const patchA = atLum(solidH, solidS * 0.95, Math.min(TERRAIN_MAX_LUM, solidLum * (1.35 + r() * 0.55)));
  const patchB = atLum(solidH, solidS * 1.05, solidLum * (0.5 + r() * 0.22));

  // The brightest thing a lip of this class can be stroked over, inside the
  // solid: the terrain fill, either patch tone, and its OWN cel band. Clear
  // that one colour and the lip is clear of every colour it can actually touch.
  // (The other classes' bands are excluded because a top band and an under lip
  // only ever meet at a corner, and the ink sits between them there.)
  const bandOf = { top: bandTop, side: bandSide, under: bandUnder };
  const worstLum = (cls: 'top' | 'side' | 'under'): number =>
    Math.max(solidLum, lum(patchA), lum(patchB), lum(bandOf[cls]));
  /**
   * The luminance a lip needs to clear a contrast floor against its worst
   * neighbour, plus two per cent. The margin is not decoration: `atLum` lands
   * on the nearest 8-bit triple it can reach, which is sometimes a hair under
   * the exact target, and a guarantee that is true to three decimals and false
   * to four is not a guarantee.
   */
  const needed = (cls: 'top' | 'side' | 'under', floor: number): number =>
    floor * 1.02 * (worstLum(cls) + 0.05) - 0.05;

  const lipSide = atLum(sideH, 0.86 + r() * 0.14, needed('side', LIP_MIN_CONTRAST));
  // The underside lip is held DIM — it is the shadowed face, and a ceiling lip
  // that out-shines the floor lip is the frame telling the player the wrong
  // thing about which way a surface points. Its own floor still wins over the
  // preference, which is why this is a max and not a clamp.
  const lipUnderLum = Math.max(needed('under', LIP_MIN_CONTRAST), 0);
  const lipUnder = atLum(underH, 0.4 + r() * 0.34, Math.max(lipUnderLum, Math.min(UNDER_MAX_LUM, lipUnderLum * 1.25)));
  // The lit lip clears the highest floor, and is then lifted past the underside
  // one if that came out brighter — which it can, because the two are different
  // hues with very different luminance ceilings.
  const lipTopLum = Math.max(needed('top', LIP_TOP_MIN_CONTRAST), lum(lipUnder) * 1.18);
  const lipTop = atLum(lipH, 0.88 + r() * 0.12, lipTopLum);

  // Accents split in two, and the split is a gameplay decision rather than an
  // aesthetic one. An apple is red in every level because it is an OBJECT the
  // player has to recognise instantly; a pipe is whatever colour this room's
  // pipes are. So the object colours are nudged within their own hue band and
  // the decor colours follow the palette family wherever it went.
  const nudge = (base: number, span: number): number => wrapHue(base + (r() - 0.5) * span);
  const red = hsl(nudge(2, 26), 0.82 + r() * 0.14, 0.55 + r() * 0.07);
  const lime = hsl(nudge(92, 34), 0.82 + r() * 0.18, 0.54 + r() * 0.1);
  const yellow = hsl(nudge(51, 22), 0.92 + r() * 0.08, 0.5 + r() * 0.08);
  const magenta = hsl(nudge(328, 28), 0.88 + r() * 0.12, 0.54 + r() * 0.07);
  const cream = hsl(wallH + 40, 0.22 + r() * 0.36, 0.93 + r() * 0.04);

  return {
    ink, ink2, solid, patchA, patchB, bandTop, bandSide, bandUnder,
    lipTop, lipSide, lipUnder,
    wall,
    yellow, orange: hsl(sideH, 0.9, 0.52), magenta,
    cyan: hsl(wallH - 12, 0.7 + r() * 0.25, 0.52 + r() * 0.08),
    lime, cream, red,
    lilac: hsl(underH, 0.38 + r() * 0.3, 0.68 + r() * 0.1),
    teal: hsl(wallH + 28, 0.6 + r() * 0.25, 0.38 + r() * 0.1),
    rust: hsl(sideH, 0.55 + r() * 0.2, 0.36 + r() * 0.1),
    steel: hsl(wallH, 0.1 + r() * 0.1, 0.62 + r() * 0.1),
    steelD: hsl(wallH, 0.12 + r() * 0.1, 0.38 + r() * 0.08),
  };
}

/** Every key a level may override through `style.colors`. */
const SCALAR_KEYS: (keyof Palette)[] = [
  'ink', 'ink2', 'solid', 'patchA', 'patchB', 'bandTop', 'bandSide', 'bandUnder',
  'lipTop', 'lipSide', 'lipUnder',
  'yellow', 'orange', 'magenta', 'cyan', 'lime', 'cream', 'red', 'lilac', 'teal', 'steel', 'steelD', 'rust',
];

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * The palette a level is actually drawn in.
 *
 * Precedence, and the order is the whole design:
 *
 *  1. `style.palette` naming a palette this build ships — an explicit choice.
 *  2. Otherwise DERIVED from the level's simHash, so a level with no style block
 *     at all still looks like its own place. This is the part that matters:
 *     twenty levels differ from each other with zero hand-authoring.
 *  3. `style.colors` overrides on top of either, per slot.
 *
 * Nothing here can reach simHash — `style` is not in it, by construction in
 * level.ts and by assertion in level.test.ts, which is exactly what lets a level
 * be recoloured without retiring its leaderboard.
 */
export function levelPalette(style: LevelStyle | null | undefined, simHash: string): Palette {
  const named = resolvePalette(typeof style?.palette === 'string' ? style.palette : undefined);
  const base = named ?? derivePalette(seedFrom(`palette:${simHash}`));
  const colors = style?.colors;
  if (!colors || typeof colors !== 'object') return base;

  const out: Palette = { ...base, wall: [...base.wall] };
  for (const k of SCALAR_KEYS) {
    const v = (colors as Record<string, unknown>)[k];
    // A malformed override is IGNORED rather than fatal. The alternative is a
    // level that fails to load because somebody typed a colour wrong, and a
    // cosmetic hint must never be able to do that.
    if (typeof v === 'string' && HEX.test(v)) (out as unknown as Record<string, string>)[k] = v.toLowerCase();
  }
  const w = (colors as Record<string, unknown>).wall;
  if (Array.isArray(w)) {
    const ramp = w.filter((x): x is string => typeof x === 'string' && HEX.test(x)).map((x) => x.toLowerCase());
    if (ramp.length >= 2) out.wall = ramp;
  }
  return out;
}

// --- how different two palettes are ------------------------------------------
//
// THE FAILURE THIS EXISTS TO CATCH IS INVISIBLE TO EVERY PER-PALETTE TEST.
// Twenty legible rooms that look alike pass `paletteFaults` twenty times over.
// The first contact sheet was twenty different solids behind twenty identical
// pale walls, and the only instrument that could have found it is one that
// looks at the SET. So the set is now a thing with a number attached, asserted
// in palette.test.ts over the shipped levels and printed by bin/_palette-set.ts.

/**
 * A palette as a point in a space where distance means "reads as a different
 * place".
 *
 * The wall carries most of the weight because it is most of the screen: the
 * solids are dark by law, so whatever hue they carry barely reads, and the wall
 * is where a room's identity actually lives. The lips come next — they are the
 * brightest thing in the frame and they trace every edge. Hue axes are on a
 * circle and are scaled to sit alongside the 0-1 ones.
 */
function palettePoint(p: Palette): number[] {
  const top = p.wall[0];
  const mid = p.wall[Math.min(3, p.wall.length - 1)];
  const bot = p.wall[p.wall.length - 1];
  return [
    hueOf(top) / 360, lum(top), sat(top),
    hueOf(mid) / 360, lum(mid), sat(mid),
    lum(bot), sat(bot),
    hueOf(p.solid) / 360, lum(p.solid) * 6, sat(p.solid),
    hueOf(p.lipTop) / 360, hueOf(p.lipSide) / 360,
  ];
}

/** Which of those axes are angles, and so wrap. */
const POINT_CIRCULAR = new Set([0, 3, 8, 11, 12]);
const POINT_WEIGHTS = [3.0, 2.6, 2.2, 1.6, 1.2, 1.0, 0.8, 0.6, 0.7, 0.7, 0.4, 0.9, 0.5];

/** Saturation as a fraction of the brightest channel — HSV's S, not HSL's. */
function sat(hex: string): number {
  const [r, g, b] = hexRgb(hex);
  const mx = Math.max(r, g, b);
  return mx === 0 ? 0 : (mx - Math.min(r, g, b)) / mx;
}

/**
 * How differently two palettes read, as one number. Larger is more different.
 *
 * It is a proxy and it is worth being honest that it is one — the judgement is
 * still a contact sheet somebody looks at. What it buys is a REGRESSION guard:
 * a change that quietly narrows the set shows up as a number falling, months
 * before anybody would have thought to re-render the sheet.
 */
export function paletteDistance(a: Palette, b: Palette): number {
  const u = palettePoint(a);
  const v = palettePoint(b);
  let s = 0;
  for (let i = 0; i < u.length; i++) {
    let d = Math.abs(u[i] - v[i]);
    if (POINT_CIRCULAR.has(i) && d > 0.5) d = 1 - d;
    s += (d * POINT_WEIGHTS[i]) ** 2;
  }
  return Math.sqrt(s);
}

/**
 * The floor the shipped set is held to.
 *
 * Measured, not chosen: before the wall's chroma and luminance were widened the
 * closest of the 190 pairs across the twenty levels was 0.281 (04 and 11, both
 * pale lilac over purple) and two pairs sat under 0.35. Afterwards the closest
 * is 0.373 and none are under 0.35. The floor is set just under the measured
 * closest, so it fails on a regression rather than on noise.
 */
export const SET_MIN_DISTANCE = 0.35;

/**
 * How far a palette is from meeting the readability guarantee. 0 means it meets
 * it. Exported so the test can report WHICH slot failed rather than just that
 * one did, and so a hand-authored override can be audited the same way a
 * derived palette is.
 */
export function paletteFaults(p: Palette): string[] {
  const faults: string[] = [];
  const check = (name: string, lip: string, band: string, floor: number): void => {
    let m = p.solid;
    for (const c of [p.patchA, p.patchB, band]) if (lum(c) > lum(m)) m = c;
    const c = contrast(lip, m);
    if (c < floor) faults.push(`${name} ${c.toFixed(2)} < ${floor} vs terrain`);
  };
  check('lipTop', p.lipTop, p.bandTop, LIP_TOP_MIN_CONTRAST);
  check('lipSide', p.lipSide, p.bandSide, LIP_MIN_CONTRAST);
  check('lipUnder', p.lipUnder, p.bandUnder, LIP_MIN_CONTRAST);
  if (lum(p.lipTop) <= lum(p.lipUnder)) {
    faults.push('the ceiling lip out-shines the floor lip');
  }
  const darkestWall = wash(p.wall[p.wall.length - 1], HAZE, HAZE_A);
  if (lum(p.solid) >= lum(darkestWall)) faults.push('solid is not darker than the wall — the inversion is broken');
  const inv = contrast(p.solid, darkestWall);
  if (inv < INVERSION_MIN_CONTRAST) faults.push(`solid/wall ${inv.toFixed(2)} < ${INVERSION_MIN_CONTRAST}`);
  if (lum(p.wall[0]) <= lum(p.wall[p.wall.length - 1])) faults.push('wall ramp is not lightest-first');
  return faults;
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
