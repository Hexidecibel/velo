// The authoring format's one curve primitive, turned into straight segments at
// COMPILE time. Nothing below the loader ever learns that an arc existed:
// `collide.ts` keeps exactly one collision primitive and stays exactly as
// simple, and as tested, as it is.
//
// WHY A SIGNED SAGITTA IN METRES, AND NOT A RADIUS
// -----------------------------------------------
// This is a one-way door, so the reasoning is recorded rather than implied.
//
// The two pieces of prior art are SVG's elliptical-arc command (endpoint,
// radius, large-arc flag, sweep flag) and the CAD/DXF polyline "bulge factor"
// (tan of a quarter of the included angle, carried on the vertex the arc leaves
// from). Both are unambiguous about which of the four candidate arcs is meant.
// They fail differently everywhere else:
//
//   * A RADIUS HAS AN IMPOSSIBLE RANGE. Any radius below half the chord length
//     names no arc at all, and it is the single easiest mistake to make by hand
//     — nudge one endpoint and a level that loaded yesterday is rejected today.
//     SVG's own answer is to silently scale the radius up, which is a whole
//     class of "why did my curve change shape" that a level format must not
//     have. A radius also needs TWO extra booleans to disambiguate, and
//     "large-arc: false, sweep: true" is not something anyone writes correctly
//     from memory.
//
//   * A DIMENSIONLESS BULGE FACTOR has no impossible value and needs no flags —
//     one signed number names one arc, and 0 is exactly a straight line. That
//     is the right shape. Its only flaw is that the NUMBER is meaningless to a
//     human: 0.4142 is a quarter circle and 1 is a semicircle, and you cannot
//     see either of those from the value without knowing tan(theta/4).
//
// So: keep the bulge-factor SHAPE and change its UNITS. `bulge` here is the
// signed perpendicular distance, IN METRES, from the middle of the chord to the
// middle of the arc — the sagitta. It is exactly `halfChord * tan(theta/4)`, so
// every formula below is the CAD one after a single division, and it inherits
// every algebraic virtue: no impossible value, no flags, 0 is a straight line,
// and the sign alone picks the side.
//
// What it buys over the dimensionless form is that the number means something
// in the same units as the coordinates around it. "This bowl dips 2.5 m below
// its chord" is a thing an author can picture, measure off graph paper and
// check against the terrain either side of it. "b = -0.4167" is not.
//
// SIGN: positive bulges to the LEFT of the direction of travel, i.e. left of
// the vector from the previous vertex to this one. In a y-up frame a floor is
// almost always written left-to-right, so the rule an author actually needs is
// "positive humps up, negative dishes down", and that is the whole convention.
// Tessellation happens BEFORE the loader normalises winding, so reversing a
// polygon's vertex order can never silently flip a bulge.
//
// NO TRIGONOMETRY
// ---------------
// `purity.test.ts` bans Math.sin/cos/atan2 under src/sim, and it is right to:
// they are implementation-approximated and differ between engines, which would
// make the tessellated geometry — and therefore simHash, and therefore the
// leaderboard — engine-dependent. So the arc is walked with a half-angle rotor
// built out of nothing but `+ - * /` and `sqrt`:
//
//   tan(theta/4) = -bulge/halfChord               (the sign flip is derived below)
//   cos(x) = 1/sqrt(1+t^2), sin(x) = t*cos(x)     for t = tan(x), |x| < 90 deg
//   half:   c' = sqrt((1+c)/2),  s' = s/(2c')     exact, stable while c > 0
//   double: C  = c*c - s*s,      S  = 2*c*s
//
// The quarter-arc rotor comes straight out of the tangent, so it is available
// without ever forming the full sweep angle — which matters, because the full
// sweep is ambiguous modulo 360 degrees and the quarter never is (|theta| < 360
// always, so |theta/4| < 90).
import { MAX_ARC_SEGMENTS, MIN_EDGE_LEN2 } from './consts.ts';

/**
 * Why tessellation can refuse. Returned rather than thrown so that this file
 * imports nothing — `level.ts` owns the error text, because only it knows which
 * polygon and which vertex index the author needs to be told about.
 */
export type ArcStatus = 'ok' | 'zero-chord' | 'too-many-segments' | 'segment-too-short';

/**
 * Append the INTERIOR points of the arc from (x0, y0) to (x1, y1) to `out` as
 * flat x, y pairs. The endpoints are not emitted: the caller already has
 * (x0, y0) and will emit (x1, y1) itself, which is what guarantees that an arc
 * can never introduce a duplicate consecutive vertex at either join.
 *
 * `tol` is the sag tolerance in metres — the most any emitted chord may dip
 * below the true arc. The segment count follows from it and from the radius, so
 * a tight curve is automatically tessellated finer than a gentle one. That is
 * the whole reason this is a tolerance and not a count: a fixed count gets both
 * cases wrong, and gets them wrong in opposite directions.
 */
export function tessellateArc(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  bulge: number,
  tol: number,
  out: number[],
): ArcStatus {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const chord2 = dx * dx + dy * dy;
  // Coincident endpoints name every circle through them and therefore none.
  if (chord2 < MIN_EDGE_LEN2) return 'zero-chord';

  // A bulge at or under the tolerance IS the one-segment case: the sag of a
  // single chord across the whole arc is exactly |bulge|. Emitting nothing
  // leaves the caller's straight edge, which is the correct answer and not a
  // special case bolted on the side.
  const sag = bulge < 0 ? -bulge : bulge;
  if (sag <= tol) return 'ok';

  const chord = Math.sqrt(chord2);
  const h = chord * 0.5;
  const b = bulge / h;

  // Centre. Solving |O - P0| = |O - arcMidpoint| along the perpendicular
  // bisector gives O = midpoint + u * h * (b*b - 1) / (2b), where u is the unit
  // LEFT normal of the chord. b = 1 is the semicircle and puts O on the chord,
  // which is the easy check that the sign is right.
  const ux = -dy / chord;
  const uy = dx / chord;
  const k = (h * (b * b - 1)) / (2 * b);
  const ox = x0 + dx * 0.5 + ux * k;
  const oy = y0 + dy * 0.5 + uy * k;
  const radius = (h * (1 + b * b)) / (2 * (b < 0 ? -b : b));

  // Sweep sense: the cross product of (P0 - O) with (arcMid - O) works out to
  // -h * (g*g + h*h) / (2g), so a bulge to the LEFT sweeps CLOCKWISE. Hence
  // tan(theta/4) = -b rather than +b. Getting this backwards mirrors every
  // curve in the game about its chord, which is exactly the kind of invisible
  // failure `kind` was introduced to kill, so it is derived here rather than
  // guessed.
  const t = -b;
  let c = 1 / Math.sqrt(1 + t * t); // cos(theta/4)
  let s = t * c; //                    sin(theta/4)

  // (c, s) is the HALF-step rotor for an n-segment tessellation, so the sag of
  // that tessellation is radius * (1 - cos(theta / 2n)) = radius * (1 - c).
  // Halving the rotor doubles n. A power of two is not the minimal segment
  // count — it can overshoot by up to 2x — but it is the only count reachable
  // by exact half-angle arithmetic, and "deterministic on every engine" beats
  // "minimal" by a distance here.
  let n = 2;
  while (radius * (1 - c) > tol) {
    if (n >= MAX_ARC_SEGMENTS) return 'too-many-segments';
    const ch = Math.sqrt((1 + c) * 0.5);
    s = s / (2 * ch);
    c = ch;
    n = n * 2;
  }

  // Segment chord = 2 * radius * |sin(theta / 2n)|. Below the loader's own
  // zero-length-edge floor this would emit duplicate consecutive vertices and
  // hand the narrowphase a NaN normal, so refuse instead. Unreachable in
  // practice — it needs a sub-micron arc — but the whole point of this file is
  // that a hand-authored curve cannot poison the state buffer.
  const segChord2 = 4 * radius * radius * s * s;
  if (segChord2 < MIN_EDGE_LEN2) return 'segment-too-short';

  const cs = c * c - s * s; // cos(theta/n)
  const sn = 2 * c * s; //     sin(theta/n)

  let ax = x0 - ox;
  let ay = y0 - oy;
  for (let i = 1; i < n; i++) {
    const rx = ax * cs - ay * sn;
    const ry = ax * sn + ay * cs;
    // Re-seat the radius vector on the circle every step. Over 4096 steps the
    // drift is tiny either way, but `sqrt` is correctly rounded so this is
    // bit-identical everywhere, and it means the emitted points are on the arc
    // the author asked for rather than on a slowly-growing spiral.
    const m = Math.sqrt(rx * rx + ry * ry);
    const f = radius / m;
    ax = rx * f;
    ay = ry * f;
    out.push(ox + ax, oy + ay);
  }
  return 'ok';
}

/**
 * Sag of a straight chord of length `len` drawn across a circle of radius `r`,
 * in metres — how far the chord's middle falls below the arc it replaces.
 *
 * This is the quantity the whole tessellation is sized by, and it is also what
 * `bin/level-check` measures on hand-authored polylines. Exact, not the
 * len^2 / (8r) approximation, because at the coarse end the approximation is
 * optimistic by exactly the amount that matters.
 */
export function chordSag(r: number, len: number): number {
  const half = len * 0.5;
  if (half >= r) return r;
  return r - Math.sqrt(r * r - half * half);
}
