import { describe, it, expect } from 'vitest';
import { parseLevel } from '@/sim/level.ts';
import type { RawPolygon } from '@/sim/level.ts';
import { chunkKey, chunkRange, chunkWindow, classify, edgesOfPoly, hazardCorners, segInView, viewBounds, CHUNK } from './geom.ts';

/**
 * The art's geometry is the half of the look that can lie about the collision
 * surface, so it is the half that gets tested. Everything here runs in plain
 * node: no canvas, no Path2D, no DOM — which is exactly why classification and
 * corner-finding live in geom.ts and not in the renderer.
 */

// The loader refuses a start inside solid, so every fixture has to say where
// the open air is. For a `cave` that is inside the ring; for a `ground` it is
// anywhere off the slab.
const lvl = (polys: RawPolygon[], at: [number, number] = [1, 1]) => parseLevel({
  format: 'velo-level',
  start: { x: at[0], y: at[1] },
  flower: { x: at[0] + 0.1, y: at[1] },
  polygons: polys,
});

describe('edge classification', () => {
  it('splits on the air-facing normal, not on the edge direction', () => {
    expect(classify(1)).toBe('top');
    expect(classify(-1)).toBe('under');
    expect(classify(0)).toBe('side');
    expect(classify(0.61)).toBe('top');
    expect(classify(0.59)).toBe('side');
    expect(classify(-0.61)).toBe('under');
  });

  it('honours the threshold, which is what moves "ramp" to "wall"', () => {
    // A 45-degree ramp is a floor at the mockup's 0.6 and a wall at 0.8.
    const ny = Math.SQRT1_2;
    expect(classify(ny, 0.6)).toBe('top');
    expect(classify(ny, 0.8)).toBe('side');
  });

  it('a GROUND platform has a lit top, dark underside and two sides', () => {
    // A 10x2 slab. The loader normalises winding, so the vertex order here is
    // deliberately the "wrong" way round: getting this right must not depend on
    // how somebody typed it.
    const [p] = lvl([{ kind: 'ground', points: [[0, 0], [0, 2], [10, 2], [10, 0]] }], [-5, 5]).polys;
    const E = edgesOfPoly(p);
    const counts = { top: 0, side: 0, under: 0 };
    for (const e of E) counts[e.cls]++;
    expect(counts).toEqual({ top: 1, side: 2, under: 1 });
    const top = E.find((e) => e.cls === 'top')!;
    expect(top.y0).toBe(2);
    expect(top.ny).toBeCloseTo(1);
    const under = E.find((e) => e.cls === 'under')!;
    expect(under.y0).toBe(0);
    expect(under.ny).toBeCloseTo(-1);
  });

  it('a CAVE gets the same classes, because the normal already points out of the solid', () => {
    // The floor of a room faces UP into the air even though the solid is
    // outside the ring. CompiledPolygon.nx/ny is the out-of-solid normal, so no
    // flip belongs anywhere in the art — and if one were added, this fails.
    const [p] = lvl([{ kind: 'cave', points: [[0, 0], [20, 0], [20, 8], [0, 8]] }]).polys;
    const E = edgesOfPoly(p);
    const floor = E.find((e) => e.y0 === 0 && e.y1 === 0)!;
    expect(floor.cls).toBe('top');
    expect(floor.ny).toBeCloseTo(1);
    const roof = E.find((e) => e.y0 === 8 && e.y1 === 8)!;
    expect(roof.cls).toBe('under');
    expect(roof.ny).toBeCloseTo(-1);
  });
});

describe('hazard corners — every ledge you can ride off', () => {
  it('finds the two ends of a ground platform and nothing else', () => {
    const [p] = lvl([{ kind: 'ground', points: [[0, 0], [0, 2], [10, 2], [10, 0]] }], [-5, 5]).polys;
    const corners = hazardCorners(p, edgesOfPoly(p));
    expect(corners).toHaveLength(2);
    // Both are at the top of the slab, where the top edge meets a side.
    for (const c of corners) expect(c.y).toBe(2);
    expect(corners.map((c) => c.x).sort((a, b) => a - b)).toEqual([0, 10]);
  });

  it('finds the drop-off in a CAVE, where convex has the opposite sign', () => {
    // A room whose floor steps down in the middle. In a cave the solid is on
    // the RIGHT of the direction of travel, so a ledge is a right turn — the
    // opposite of a ground platform. The mockup only ever ran on ground
    // polygons and needed one sign; most of our levels are a single cave, so
    // getting this backwards would put chevrons on every inside corner of every
    // room and none on any actual ledge.
    const [p] = lvl([{
      kind: 'cave',
      points: [[0, 0], [10, 0], [10, -6], [30, -6], [30, 20], [0, 20]],
    }], [5, 10]).polys;
    const corners = hazardCorners(p, edgesOfPoly(p));
    expect(corners).toHaveLength(1);
    expect(corners[0].x).toBe(10);
    expect(corners[0].y).toBe(0);
    expect(corners[0].top.cls).toBe('top');
    expect(corners[0].side.cls).toBe('side');
  });

  it('ignores the INSIDE corner where a wall rises out of a floor', () => {
    // A step UP has two corners and only one of them is a hazard. At the foot
    // of the wall the solid fills three quadrants — an inside corner, and
    // striping it would cry wolf on every wall in the level. At the top the
    // solid fills one, and that IS a ledge: ride left off the upper floor and
    // you fall six metres.
    const [p] = lvl([{
      kind: 'cave',
      points: [[0, 0], [10, 0], [10, 6], [30, 6], [30, 20], [0, 20]],
    }], [20, 10]).polys;
    const corners = hazardCorners(p, edgesOfPoly(p));
    expect(corners).toHaveLength(1);
    expect(corners[0]).toMatchObject({ x: 10, y: 6 });
  });

  it('ignores the gentle turns a tessellated arc is made of', () => {
    // The real risk: a curve compiled at the level's sag tolerance is hundreds
    // of segments whose class drifts from top to side, and without a minimum
    // turn every one of them sprouts a chevron. A quarter circle has no ledge
    // in it.
    // A circular room: sixty segments, every class boundary in it crossed
    // gradually, and not one ledge anywhere. Without a minimum turn this
    // produces a chevron everywhere the classification flips.
    const pts: [number, number][] = [];
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      pts.push([Math.cos(a) * 20, Math.sin(a) * 20]);
    }
    const [p] = lvl([{ kind: 'cave', points: pts }], [0, 0]).polys;
    const E = edgesOfPoly(p);
    // It does have all three classes — this is not passing by classifying
    // everything the same way.
    expect(new Set(E.map((e) => e.cls))).toEqual(new Set(['top', 'side', 'under']));
    expect(hazardCorners(p, E)).toHaveLength(0);
  });

  it('ignores a step too shallow to matter', () => {
    const shallow = lvl([{
      kind: 'cave',
      points: [[0, 0], [10, 0], [10, -0.2], [30, -0.2], [30, 20], [0, 20]],
    }], [5, 10]).polys[0];
    expect(hazardCorners(shallow, edgesOfPoly(shallow))).toHaveLength(0);
  });

  it('reports the runs, so the block can be clipped to a short ledge', () => {
    const [p] = lvl([{ kind: 'ground', points: [[0, 0], [0, 0.5], [3, 0.5], [3, 0]] }], [-5, 5]).polys;
    const corners = hazardCorners(p, edgesOfPoly(p));
    expect(corners).toHaveLength(2);
    for (const c of corners) {
      expect(c.runTop).toBeCloseTo(3);
      expect(c.runSide).toBeCloseTo(0.5);
    }
  });
});

describe('chunking — what bounds a frame to the screen and not the level', () => {
  it('keys are unique per chunk and stable', () => {
    expect(chunkKey(0, 0)).toBe(chunkKey(0, 0));
    expect(chunkKey(1, 0)).not.toBe(chunkKey(0, 1));
    expect(chunkKey(-3, 7)).not.toBe(chunkKey(7, -3));
  });

  it('a range covers the chunks a box touches, negatives included', () => {
    const r = chunkRange(-1, -1, CHUNK + 1, 1);
    expect(r).toEqual({ x0: -1, y0: -1, x1: 1, y1: 0 });
  });

  it('a window key changes only when the visible chunk set changes', () => {
    const a = chunkWindow({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    const b = chunkWindow({ minX: 1, minY: 1, maxX: 11, maxY: 11 });
    expect(b.key).toBe(a.key);
    const c = chunkWindow({ minX: 0, minY: 0, maxX: CHUNK + 1, maxY: 10 });
    expect(c.key).not.toBe(a.key);
  });

  it('view bounds are the viewport in metres, padded', () => {
    const b = viewBounds(0, 0, 100, 800, 400, 0);
    expect(b).toEqual({ minX: -4, minY: -2, maxX: 4, maxY: 2 });
    expect(viewBounds(0, 0, 100, 800, 400, 1).minX).toBe(-5);
  });

  it('segment culling does not care which way a segment was written', () => {
    const b = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(segInView(-5, 5, 5, 5, b)).toBe(true);
    expect(segInView(5, 5, -5, 5, b)).toBe(true);
    expect(segInView(-5, 5, -1, 5, b)).toBe(false);
    expect(segInView(3, 20, 3, 30, b)).toBe(false);
  });
});
