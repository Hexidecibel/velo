// Colour arithmetic for the palette generator.
//
// Everything here is pure and testable in plain node, which is the point: the
// one rule the whole art direction serves is that the collision edge is the
// most legible line on screen, and once palettes are GENERATED rather than
// authored, "legible" stops being something a human checked once and becomes
// something a function has to guarantee. That guarantee is a number, so it
// needs number code that can be asserted against.
//
// Contrast is WCAG relative luminance, which is the sRGB-linearised luminance
// with the standard +0.05 flare term. It is not a perfect perceptual model, but
// it is the one with a published threshold everybody already reasons about, and
// the alternative (CIEDE2000) would be a lot of code to move a floor by a few
// per cent.

/** Clamp to [0, 1]. */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Wrap a hue into [0, 360). */
export function wrapHue(h: number): number {
  const m = h % 360;
  return m < 0 ? m + 360 : m;
}

/** Shortest angular distance between two hues, 0..180. */
export function hueDist(a: number, b: number): number {
  const d = Math.abs(wrapHue(a) - wrapHue(b));
  return d > 180 ? 360 - d : d;
}

/** `#rrggbb` from h in degrees, s and l in 0..1. */
export function hsl(h: number, s: number, l: number): string {
  const hh = wrapHue(h) / 360;
  const ss = clamp01(s);
  const ll = clamp01(l);
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const ch = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return rgbHex(
    Math.round(ch(hh + 1 / 3) * 255),
    Math.round(ch(hh) * 255),
    Math.round(ch(hh - 1 / 3) * 255),
  );
}

export function rgbHex(r: number, g: number, b: number): string {
  const c = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  return `#${((c(r) << 16) | (c(g) << 8) | c(b)).toString(16).padStart(6, '0')}`;
}

export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance, 0..1. */
export function lum(hex: string): number {
  const [r, g, b] = hexRgb(hex);
  const c = (v: number): number => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}

/** WCAG contrast ratio, 1..21. Symmetric. */
export function contrast(a: string, b: string): number {
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Linear blend between two hexes. */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexRgb(a);
  const [br, bg, bb] = hexRgb(b);
  const u = clamp01(t);
  return rgbHex(ar + (br - ar) * u, ag + (bg - ag) * u, ab + (bb - ab) * u);
}

/**
 * Raise a colour's lightness — keeping its hue and saturation — until it clears
 * a contrast floor against `against`.
 *
 * This is the mechanism that turns "the generator probably makes legible lips"
 * into "the generator cannot make an illegible one". It terminates: `against`
 * is always one of the dark slots, so white clears any floor below about 9,
 * and the loop is bounded by the step count regardless.
 */
export function liftUntil(
  h: number, s: number, l: number, against: string, floor: number,
): { hex: string; l: number } {
  let ll = clamp01(l);
  let hex = hsl(h, s, ll);
  for (let i = 0; i < 64 && contrast(hex, against) < floor; i++) {
    ll = clamp01(ll + 0.015);
    hex = hsl(h, s, ll);
    if (ll >= 1) break;
  }
  // Saturation is what caps a hue's achievable luminance: a fully saturated
  // blue tops out well below a fully saturated yellow. If lightness alone ran
  // out, wash the saturation down, which is the only remaining lever.
  for (let i = 0; i < 64 && contrast(hex, against) < floor; i++) {
    s = clamp01(s - 0.02);
    ll = clamp01(ll + 0.01);
    hex = hsl(h, s, ll);
    if (s <= 0 && ll >= 1) break;
  }
  return { hex, l: ll };
}

/** Lower a colour's lightness until it is at most `target` luminance. */
export function dropUntil(h: number, s: number, l: number, maxLum: number): string {
  let ll = clamp01(l);
  let hex = hsl(h, s, ll);
  for (let i = 0; i < 64 && lum(hex) > maxLum; i++) {
    ll = clamp01(ll - 0.01);
    hex = hsl(h, s, ll);
    if (ll <= 0) break;
  }
  return hex;
}

/**
 * Lower a colour's lightness toward a luminance ceiling, but never past a
 * contrast floor against `against`.
 *
 * The floor wins. This exists so that the underside lip can be held DIMMER than
 * the lit one — a ceiling that out-shines the ground is the frame telling the
 * player the wrong thing — without that preference ever being allowed to make
 * the lip itself illegible.
 */
export function dimUntil(
  h: number, s: number, l: number, maxLum: number, against: string, floor: number,
): { hex: string; l: number } {
  let ll = clamp01(l);
  let hex = hsl(h, s, ll);
  for (let i = 0; i < 64 && lum(hex) > maxLum; i++) {
    const next = hsl(h, s, clamp01(ll - 0.012));
    if (contrast(next, against) < floor) break;
    ll = clamp01(ll - 0.012);
    hex = next;
    if (ll <= 0) break;
  }
  return { hex, l: ll };
}

/**
 * The colour of hue `h` and saturation `s` whose relative luminance is as close
 * as possible to `target`.
 *
 * Bisection on lightness, which is valid because luminance is monotonic in HSL
 * lightness at fixed hue and saturation. This is the workhorse of the palette
 * generator and it is what turns the contrast guarantees from a repair loop
 * into arithmetic: pick the luminances the readability rule requires, then ask
 * for a colour at each. A hue that cannot reach the target (a saturated blue
 * asked for 0.6) simply lands as close as it can, which is white-ward, and the
 * caller's floor is stated in luminance so it still holds.
 */
export function atLum(h: number, s: number, target: number): string {
  let lo = 0;
  let hi = 1;
  let hex = hsl(h, s, 0.5);
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    hex = hsl(h, s, mid);
    if (lum(hex) < target) lo = mid; else hi = mid;
  }
  // A fully saturated hue has a hard luminance ceiling — pure blue tops out at
  // 0.072 — so if the target is still out of reach, desaturate toward white,
  // which is the only direction luminance can still go.
  if (lum(hex) < target * 0.97) {
    let ss = s;
    for (let i = 0; i < 40 && lum(hex) < target * 0.97; i++) {
      ss = clamp01(ss - 0.025);
      lo = 0; hi = 1;
      for (let k = 0; k < 20; k++) {
        const mid = (lo + hi) / 2;
        hex = hsl(h, ss, mid);
        if (lum(hex) < target) lo = mid; else hi = mid;
      }
      if (ss <= 0) break;
    }
  }
  return hex;
}

/**
 * Hue of a hex, in degrees. 0 for a grey, which is correct for this use: a grey
 * has no hue to confuse with anything.
 */
export function hueOf(hex: string): number {
  const [r8, g8, b8] = hexRgb(hex);
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  if (d === 0) return 0;
  let h: number;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return wrapHue(h * 60);
}
