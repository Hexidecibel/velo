// The occupancy grid and the geodesic fields.
//
// These are the solver's map of the level, and a wrong map is worse than no map
// — the heuristic would confidently steer the search into rock. The tests here
// are all "does the map agree with the geometry", never "is this number 3.4".
import { describe, it, expect } from 'vitest';
import { parseLevel } from '@/sim/level.ts';
import type { RawLevel } from '@/sim/level.ts';
import { TEST_LEVEL } from '@/sim/testlevel.ts';
import { buildField, buildEdgeIndex, nearestSurface, geodesic, cellOf, nearestFree, distAt } from './field.ts';

const level = parseLevel(TEST_LEVEL);

/** A plain box with a floor at y = 0 and a solid pillar splitting it in two. */
const BOXED: RawLevel = {
  format: 'velo-level',
  rev: 1,
  name: 'boxed',
  start: { x: -8, y: 1 },
  flower: { x: 8, y: 1 },
  apples: [],
  polygons: [
    { kind: 'cave', points: [[-10, 0], [10, 0], [10, 10], [-10, 10]] },
    { kind: 'ground', points: [[-0.5, 0], [0.5, 0], [0.5, 6], [-0.5, 6]] },
  ],
};

describe('nearestSurface', () => {
  it('measures the distance to the floor', () => {
    const lvl = parseLevel(BOXED);
    const ix = buildEdgeIndex(lvl);
    expect(nearestSurface(ix, -5, 1)).toBeCloseTo(1, 6);
    expect(nearestSurface(ix, -5, 3)).toBeCloseTo(3, 6);
  });

  it('sees the pillar, not just the cave wall', () => {
    const lvl = parseLevel(BOXED);
    const ix = buildEdgeIndex(lvl);
    expect(nearestSurface(ix, 2, 3)).toBeCloseTo(1.5, 6);
  });

  it('saturates rather than reporting a distance it did not look for', () => {
    const lvl = parseLevel(BOXED);
    const ix = buildEdgeIndex(lvl, 2, 3);
    expect(nearestSurface(ix, 0, 100)).toBe(3);
  });
});

describe('buildField', () => {
  const f = buildField(parseLevel(BOXED), 0.25, 0.3);

  it('calls the inside of the box free and the inside of solid not', () => {
    expect(f.free[cellOf(f, -5, 3)]).toBe(1);
    expect(f.free[cellOf(f, 0, 3)]).toBe(0);
    expect(cellOf(f, -20, 3)).toBe(-1);
  });

  it('signs clearance negative inside solid', () => {
    expect(f.clear[cellOf(f, -5, 3)]).toBeGreaterThan(0);
    expect(f.clear[cellOf(f, 0, 3)]).toBeLessThan(0);
  });

  it('refuses to call a gap narrower than the bike free', () => {
    const tight = buildField(parseLevel(BOXED), 0.25, 2.0);
    // 2 m of clearance does not fit anywhere within 2 m of the floor.
    expect(tight.free[cellOf(tight, -5, 1)]).toBe(0);
    expect(tight.free[cellOf(tight, -5, 5)]).toBe(1);
  });
});

describe('geodesic', () => {
  it('goes round the pillar rather than through it', () => {
    const lvl = parseLevel(BOXED);
    const f = buildField(lvl, 0.25, 0.3);
    const d = geodesic(f, 8, 1);
    const straight = 16;
    const got = distAt(f, d, -8, 1, 8, 1);
    // Over the top of a 6 m pillar: strictly longer than the straight line.
    expect(got).toBeGreaterThan(straight + 4);
    expect(got).toBeLessThan(straight + 30);
  });

  it('is zero at the target and rises with distance', () => {
    const lvl = parseLevel(BOXED);
    const f = buildField(lvl, 0.25, 0.3);
    const d = geodesic(f, 8, 1);
    expect(distAt(f, d, 8, 1, 8, 1)).toBeLessThan(0.6);
    expect(distAt(f, d, 5, 1, 8, 1)).toBeGreaterThan(distAt(f, d, 7, 1, 8, 1));
  });

  it('reports a real level as routable from the start to every apple', () => {
    const f = buildField(level, 0.4, 0.3);
    for (const a of level.apples) {
      const d = geodesic(f, a.x, a.y);
      expect(Number.isFinite(distAt(f, d, level.start.x, level.start.y, a.x, a.y))).toBe(true);
    }
  });
});

describe('nearestFree', () => {
  it('finds a free cell from inside solid', () => {
    const f = buildField(parseLevel(BOXED), 0.25, 0.3);
    const i = nearestFree(f, 0, 3);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(f.free[i]).toBe(1);
  });

  it('gives up rather than wandering the whole level', () => {
    const f = buildField(parseLevel(BOXED), 0.25, 0.3);
    expect(nearestFree(f, -100, -100, 2)).toBe(-1);
  });
});
