// Arc tessellation, tested against the circle it claims to approximate rather
// than against a recorded point list. A golden array would pass forever while
// silently describing the wrong curve; "every point is on the circle, every
// chord sags less than the tolerance" cannot.
import { describe, it, expect } from 'vitest';
import { tessellateArc, chordSag } from './arc.ts';
import { MAX_ARC_SEGMENTS } from './consts.ts';

/** The circle an (endpoints, bulge) triple names. Free to use Math.* — a test is not the sim. */
function circleOf(x0: number, y0: number, x1: number, y1: number, bulge: number) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const c = Math.hypot(dx, dy);
  const h = c * 0.5;
  const b = bulge / h;
  const k = (h * (b * b - 1)) / (2 * b);
  return {
    cx: x0 + dx * 0.5 + (-dy / c) * k,
    cy: y0 + dy * 0.5 + (dx / c) * k,
    r: (h * (1 + b * b)) / (2 * Math.abs(b)),
  };
}

function run(x0: number, y0: number, x1: number, y1: number, bulge: number, tol: number) {
  const flat: number[] = [];
  const status = tessellateArc(x0, y0, x1, y1, bulge, tol, flat);
  const pts: [number, number][] = [[x0, y0]];
  for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
  pts.push([x1, y1]);
  return { status, pts, segments: pts.length - 1 };
}

describe('arc tessellation geometry', () => {
  it('puts every generated point on the arc, and every chord inside the tolerance', () => {
    const cases: [number, number, number, number, number][] = [
      [0, 0, 2, 0, 1], //            exact semicircle, r = 1
      [0, 0, 12, 0, -2.5], //        a dish
      [0, 0, 20, 5, 0.5], //         shallow, sloped chord
      [0, 0, 2, 2, 0.585786437627], // 90 degrees on r = 2
      [-3, 4, 1, -6, -7], //         major arc, arbitrary placement
      [0, 0, 4.242640687119, 0, 5.121320343560], // 270 degrees on r = 3
    ];
    for (const [x0, y0, x1, y1, bulge] of cases) {
      const tol = 0.002;
      const { status, pts } = run(x0, y0, x1, y1, bulge, tol);
      expect(status).toBe('ok');
      const { cx, cy, r } = circleOf(x0, y0, x1, y1, bulge);
      for (const [px, py] of pts) {
        expect(Math.abs(Math.hypot(px - cx, py - cy) - r)).toBeLessThan(1e-9);
      }
      for (let i = 1; i < pts.length; i++) {
        const len = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        expect(chordSag(r, len)).toBeLessThanOrEqual(tol * (1 + 1e-9));
      }
    }
  });

  it('reproduces the exact geometry of a known arc', () => {
    // A semicircle of radius 1 bulging UP from (0,0) to (2,0): the midpoint of
    // the emitted chain must be (1, 1), not (1, -1). That single assertion is
    // the whole "which way does it bulge" contract, and getting it backwards
    // mirrors every curve in the game.
    const { pts } = run(0, 0, 2, 0, 1, 0.002);
    const mid = pts[(pts.length - 1) / 2];
    expect(mid[0]).toBeCloseTo(1, 12);
    expect(mid[1]).toBeCloseTo(1, 12);
  });

  it('bulges to the LEFT of travel, whichever way you travel', () => {
    // Same two points, opposite order, same sign of bulge: the two arcs must
    // land on opposite sides of the chord. This is what makes two equal bulges
    // between one pair of points a circle rather than a lens.
    const up = run(0, 0, 2, 0, 0.6, 0.002).pts;
    const down = run(2, 0, 0, 0, 0.6, 0.002).pts;
    expect(Math.max(...up.map((p) => p[1]))).toBeGreaterThan(0.5);
    expect(Math.min(...down.map((p) => p[1]))).toBeLessThan(-0.5);
  });

  it('never emits a duplicate consecutive point', () => {
    for (const bulge of [0.01, 0.3, 1, 4, -0.05, -2.2]) {
      const { pts } = run(0, 0, 3, 1, bulge, 0.002);
      for (let i = 1; i < pts.length; i++) {
        const d2 = (pts[i][0] - pts[i - 1][0]) ** 2 + (pts[i][1] - pts[i - 1][1]) ** 2;
        expect(d2).toBeGreaterThan(1e-14);
      }
    }
  });
});

describe('arc tessellation density', () => {
  it('is driven by the tolerance, not by a fixed count', () => {
    const counts = [0.05, 0.01, 0.002, 0.0005].map((tol) => run(0, 0, 8, 0, -2, tol).segments);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1]);
  });

  it('gives a tighter curve more segments than a gentle one', () => {
    // Same chord, same tolerance: the deeper bulge is the tighter curve and
    // must get more segments. This is the behaviour a fixed segment count gets
    // exactly backwards.
    const gentle = run(0, 0, 8, 0, -0.3, 0.002).segments;
    const tight = run(0, 0, 8, 0, -3.5, 0.002).segments;
    expect(tight).toBeGreaterThan(gentle);
  });

  it('collapses to a bare chord when the whole arc is inside the tolerance', () => {
    // The sag of a single chord across the arc IS the bulge, so this is the
    // one-segment case falling out of the same rule rather than a special case.
    expect(run(0, 0, 10, 0, 0.0019, 0.002).segments).toBe(1);
    expect(run(0, 0, 10, 0, 0.0021, 0.002).segments).toBeGreaterThan(1);
    expect(run(0, 0, 10, 0, 0, 0.002).segments).toBe(1);
  });

  it('is bit-identical across calls (it is hashed, so this is not optional)', () => {
    const a = run(1.5, -2.25, 9.75, 3.125, -1.875, 0.002).pts;
    const b = run(1.5, -2.25, 9.75, 3.125, -1.875, 0.002).pts;
    expect(b).toEqual(a);
  });
});

describe('arc tessellation refusals', () => {
  it('refuses coincident endpoints', () => {
    expect(run(3, 3, 3, 3, 1, 0.002).status).toBe('zero-chord');
  });

  it('refuses a tolerance so tight it would exceed the segment cap', () => {
    const { status, pts } = run(0, 0, 40, 0, 20, 1e-12);
    expect(status).toBe('too-many-segments');
    // Nothing is emitted on a refusal: a partial arc is worse than none.
    expect(pts.length).toBe(2);
  });

  it('stays under the cap at the default tolerance on a very large circle', () => {
    const { status, segments } = run(0, 0, 200, 0, 100, 0.002);
    expect(status).toBe('ok');
    expect(segments).toBeLessThan(MAX_ARC_SEGMENTS);
  });
});

describe('chordSag', () => {
  it('matches the L^2/(8R) approximation where the approximation is good', () => {
    expect(chordSag(100, 1)).toBeCloseTo(1 / 800, 7);
    expect(chordSag(2, 1)).toBeCloseTo(2 - Math.sqrt(4 - 0.25), 12);
  });

  it('saturates rather than going NaN when the chord exceeds the diameter', () => {
    expect(chordSag(1, 5)).toBe(1);
  });
});
