// A stroke alphabet, because the game has no web fonts and is not getting any.
//
// The mockup's signage — the VELO piece, the poster headers, KEEP CLEAR, the
// level numeral — all leaned on Bungee and Permanent Marker off Google Fonts.
// Phase 1 refused to port the text stencils for exactly that reason: pulling a
// font in makes the art a network dependency, and a stamp that silently falls
// back to Arial on a cold load is worse than one more chevron. That reasoning
// has not changed, but "no text at all" turned out to cost most of what makes
// the mockup's walls read as a place somebody has been.
//
// So the letters are geometry. Each glyph is a list of polylines in a unit box
// with Y UP — the same frame everything downstream of the world transform uses
// — and drawing one is stroking a path. That buys the whole mockup vocabulary
// for free: stroke it fat and round for a piece, thin and square for signage,
// four times at an offset for the extrusion, once more in ink for the outline.
// It renders identically on every machine, at every zoom, with nothing to load.
//
// Pure. No canvas here — `textOutline` returns coordinates and the drawing code
// turns them into a Path2D — which is what makes the layout testable in node.

/** Polylines in a unit box, y up, origin at the glyph's bottom-left. */
export type Glyph = [number, number][][];

const G: Record<string, Glyph> = {
  ' ': [],
  A: [[[0, 0], [0.5, 1], [1, 0]], [[0.16, 0.34], [0.84, 0.34]]],
  B: [[[0, 0], [0, 1], [0.68, 1], [0.95, 0.79], [0.7, 0.55], [0, 0.55]],
      [[0, 0.55], [0.8, 0.55], [1, 0.29], [0.74, 0], [0, 0]]],
  C: [[[1, 0.83], [0.74, 1], [0.26, 1], [0, 0.72], [0, 0.28], [0.26, 0], [0.74, 0], [1, 0.17]]],
  D: [[[0, 0], [0, 1], [0.58, 1], [1, 0.7], [1, 0.3], [0.58, 0], [0, 0]]],
  E: [[[1, 1], [0, 1], [0, 0], [1, 0]], [[0, 0.52], [0.78, 0.52]]],
  F: [[[1, 1], [0, 1], [0, 0]], [[0, 0.55], [0.78, 0.55]]],
  G: [[[1, 0.83], [0.74, 1], [0.26, 1], [0, 0.72], [0, 0.28], [0.26, 0], [0.76, 0], [1, 0.2], [1, 0.45], [0.55, 0.45]]],
  H: [[[0, 0], [0, 1]], [[1, 0], [1, 1]], [[0, 0.52], [1, 0.52]]],
  I: [[[0.5, 0], [0.5, 1]], [[0.12, 1], [0.88, 1]], [[0.12, 0], [0.88, 0]]],
  J: [[[0.9, 1], [0.9, 0.26], [0.64, 0], [0.26, 0], [0, 0.22]]],
  K: [[[0, 0], [0, 1]], [[1, 1], [0.04, 0.45]], [[0.32, 0.61], [1, 0]]],
  L: [[[0, 1], [0, 0], [1, 0]]],
  M: [[[0, 0], [0, 1], [0.5, 0.42], [1, 1], [1, 0]]],
  N: [[[0, 0], [0, 1], [1, 0], [1, 1]]],
  O: [[[0.26, 1], [0.74, 1], [1, 0.72], [1, 0.28], [0.74, 0], [0.26, 0], [0, 0.28], [0, 0.72], [0.26, 1]]],
  P: [[[0, 0], [0, 1], [0.7, 1], [1, 0.78], [0.7, 0.52], [0, 0.52]]],
  Q: [[[0.26, 1], [0.74, 1], [1, 0.72], [1, 0.28], [0.74, 0], [0.26, 0], [0, 0.28], [0, 0.72], [0.26, 1]], [[0.62, 0.26], [1.02, -0.06]]],
  R: [[[0, 0], [0, 1], [0.7, 1], [1, 0.78], [0.7, 0.52], [0, 0.52]], [[0.44, 0.52], [1, 0]]],
  S: [[[1, 0.85], [0.7, 1], [0.24, 1], [0, 0.8], [0.16, 0.58], [0.8, 0.46], [1, 0.24], [0.74, 0], [0.26, 0], [0, 0.16]]],
  T: [[[0, 1], [1, 1]], [[0.5, 1], [0.5, 0]]],
  U: [[[0, 1], [0, 0.26], [0.26, 0], [0.74, 0], [1, 0.26], [1, 1]]],
  V: [[[0, 1], [0.5, 0], [1, 1]]],
  W: [[[0, 1], [0.22, 0], [0.5, 0.58], [0.78, 0], [1, 1]]],
  X: [[[0, 0], [1, 1]], [[0, 1], [1, 0]]],
  Y: [[[0, 1], [0.5, 0.5], [1, 1]], [[0.5, 0.5], [0.5, 0]]],
  Z: [[[0, 1], [1, 1], [0, 0], [1, 0]]],
  '0': [[[0.26, 1], [0.74, 1], [1, 0.72], [1, 0.28], [0.74, 0], [0.26, 0], [0, 0.28], [0, 0.72], [0.26, 1]], [[0.2, 0.2], [0.8, 0.8]]],
  '1': [[[0.18, 0.76], [0.5, 1], [0.5, 0]], [[0.14, 0], [0.86, 0]]],
  '2': [[[0, 0.8], [0.26, 1], [0.74, 1], [1, 0.74], [0, 0], [1, 0]]],
  '3': [[[0, 1], [1, 1], [0.44, 0.56], [0.88, 0.56], [1, 0.3], [0.74, 0], [0.26, 0], [0, 0.18]]],
  '4': [[[0.74, 0], [0.74, 1], [0, 0.3], [1, 0.3]]],
  '5': [[[1, 1], [0.14, 1], [0.05, 0.56], [0.7, 0.62], [1, 0.34], [0.8, 0], [0.26, 0], [0, 0.14]]],
  '6': [[[0.9, 0.9], [0.6, 1], [0.26, 1], [0, 0.7], [0, 0.26], [0.26, 0], [0.7, 0], [0.95, 0.26], [0.74, 0.5], [0.26, 0.5], [0, 0.32]]],
  '7': [[[0, 1], [1, 1], [0.34, 0]]],
  '8': [[[0.3, 0.55], [0.1, 0.76], [0.26, 1], [0.74, 1], [0.9, 0.76], [0.7, 0.55], [0.3, 0.55], [0.05, 0.3], [0.26, 0], [0.74, 0], [0.95, 0.3], [0.7, 0.55]]],
  '9': [[[0.1, 0.1], [0.4, 0], [0.74, 0], [1, 0.3], [1, 0.74], [0.74, 1], [0.3, 1], [0.05, 0.74], [0.26, 0.5], [0.74, 0.5], [1, 0.68]]],
  '-': [[[0.1, 0.5], [0.9, 0.5]]],
  '.': [[[0.44, 0.04], [0.56, 0.04]]],
  '!': [[[0.5, 1], [0.5, 0.3]], [[0.5, 0.1], [0.5, 0.02]]],
  '/': [[[0.05, 0], [0.95, 1]]],
  ':': [[[0.5, 0.72], [0.5, 0.64]], [[0.5, 0.2], [0.5, 0.12]]],
};

/** Everything this alphabet can draw. Anything else is dropped, never boxed. */
export const ALPHABET = Object.keys(G).join('');

/** Advance per glyph as a fraction of cap height, plus the gap between them. */
const ADVANCE = 0.78;
const TRACK = 0.2;

export interface TextOpts {
  /** Cap height in world metres. */
  size: number;
  /** Extra tracking, as a fraction of size. */
  track?: number;
  /** 'left' puts x at the first glyph's left edge; 'center' centres the run. */
  align?: 'left' | 'center';
  /** Draw top-to-bottom instead, one glyph per line. Vertical signage. */
  vertical?: boolean;
}

export interface TextLayout {
  /** World-space polylines, ready to stroke. */
  strokes: [number, number][][];
  width: number;
  height: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Lay a string out as world-space polylines.
 *
 * An unknown character is DROPPED rather than replaced with a box. The strings
 * this draws are generated — a level name, a seeded word from a small list —
 * and a tofu box in the middle of a wall piece is a bug that looks like a bug,
 * where a missing letter just looks like worn paint.
 */
export function textOutline(text: string, x: number, y: number, o: TextOpts): TextLayout {
  const s = o.size;
  const track = (o.track ?? 0) * s;
  const chars = text.toUpperCase().split('').filter((c) => c in G);
  const strokes: [number, number][][] = [];

  if (o.vertical) {
    // One glyph per line, top down, which is how the banner in the mockup reads.
    const step = s * 1.32;
    const h = Math.max(0, chars.length - 1) * step + s;
    chars.forEach((c, i) => {
      const gy = y - i * step;
      for (const poly of G[c]) strokes.push(poly.map(([px, py]) => [x + (px - 0.5) * s, gy + py * s] as [number, number]));
    });
    return bounds(strokes, s, h);
  }

  const adv = s * ADVANCE + track + s * TRACK;
  const width = chars.length > 0 ? chars.length * adv - (track + s * TRACK) : 0;
  const x0 = o.align === 'center' ? x - width / 2 : x;
  chars.forEach((c, i) => {
    const gx = x0 + i * adv;
    for (const poly of G[c]) strokes.push(poly.map(([px, py]) => [gx + px * s * ADVANCE, y + py * s] as [number, number]));
  });
  return bounds(strokes, width, s);
}

function bounds(strokes: [number, number][][], width: number, height: number): TextLayout {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of strokes) {
    for (const [px, py] of poly) {
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
  }
  if (!strokes.length) { minX = 0; minY = 0; maxX = 0; maxY = 0; }
  return { strokes, width, height, minX, minY, maxX, maxY };
}

/**
 * A handstyle scrawl: an illegible seeded squiggle with the RHYTHM of writing.
 *
 * Deliberately not letters. A tag is read as a gesture rather than as words —
 * nobody reads the ones on a real wall either — and a procedural scrawl carries
 * that at a tenth of the geometry, never spells anything unfortunate, and can
 * be generated per level without a word list. The alphabet above is for the
 * things that are meant to be legible: signage, numerals, the piece.
 */
export function scrawl(
  x: number, y: number, w: number, h: number, letters: number, r: () => number,
): [number, number][] {
  const pts: [number, number][] = [];
  const step = w / Math.max(1, letters);
  let cx = x;
  for (let i = 0; i < letters; i++) {
    // Each "letter" is a down-up-over gesture with seeded overshoot, and the
    // baseline drifts, which is what stops a row of them reading as a fence.
    const drift = (r() - 0.5) * h * 0.3;
    pts.push([cx, y + drift + h * (0.1 + r() * 0.2)]);
    pts.push([cx + step * 0.25, y + drift + h * (0.85 + r() * 0.25)]);
    pts.push([cx + step * 0.5, y + drift + h * (0.05 + r() * 0.15)]);
    pts.push([cx + step * 0.8, y + drift + h * (0.55 + r() * 0.35)]);
    cx += step;
  }
  // The flick at the end, which is the single most recognisable thing about a
  // tag and costs two points.
  if (pts.length) {
    const [lx, ly] = pts[pts.length - 1];
    pts.push([lx + w * 0.18, ly + h * 0.35]);
    pts.push([lx - w * 0.5, ly + h * 0.62]);
  }
  return pts;
}
