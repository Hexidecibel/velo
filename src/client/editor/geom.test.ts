import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseLevel } from '@/sim/level.ts';
import { tessellateArc } from '@/sim/arc.ts';
import { blankDoc, docToRaw, setBulge, startDraft } from './doc.ts';
import {
  arcHandle, bulgeFor, distToSegment, envelopeFindings, freeSpan, headroomFindings,
  pickEdge, pickHandle, rayDist, snapPoint, snapTo,
} from './geom.ts';

const levelsDir = fileURLToPath(new URL('../../../levels/', import.meta.url));
const load = (f: string) => parseLevel(JSON.parse(readFileSync(levelsDir + f, 'utf8')));

describe('snapping', () => {
  it('rounds to the grid, and a zero grid is no grid', () => {
    expect(snapTo(1.24, 0.5)).toBe(1);
    expect(snapTo(1.26, 0.5)).toBe(1.5);
    expect(snapTo(-1.26, 0.5)).toBe(-1.5);
    expect(snapTo(1.2345, 0)).toBe(1.2345);
    expect(snapPoint({ x: 0.9, y: -2.4 }, 1)).toEqual({ x: 1, y: -2 });
  });
});

describe('the arc handle', () => {
  it('bulge and handle are exact inverses', () => {
    // This is what makes dragging the handle and typing the number the SAME
    // operation. If they were only approximately inverse, a handle would drift
    // every time it was picked up and put down in the same place.
    const a = { x: -3, y: 1 };
    const b = { x: 4, y: 2.5 };
    for (const bulge of [-2.5, -0.4, 0.001, 0.75, 3]) {
      expect(bulgeFor(a, b, arcHandle(a, b, bulge))).toBeCloseTo(bulge, 12);
    }
  });

  it('positive bulges to the left of the direction of travel', () => {
    // arc.ts's convention, and the whole of what an author has to remember:
    // write a floor left to right and positive humps up.
    expect(bulgeFor({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 2 })).toBeCloseTo(2, 12);
    expect(bulgeFor({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -2 })).toBeCloseTo(-2, 12);
    expect(arcHandle({ x: 0, y: 0 }, { x: 10, y: 0 }, 2)).toEqual({ x: 5, y: 2 });
  });

  it('the handle sits on the arc the loader actually tessellates', () => {
    // The handle is only a truthful control if it is ON the curve. Walk the
    // real tessellation and check the middle of it lands where the handle is.
    const a = { x: 0, y: 0 };
    const b = { x: 8, y: 0 };
    const bulge = 1.6;
    const out: number[] = [];
    expect(tessellateArc(a.x, a.y, b.x, b.y, bulge, 0.002, out)).toBe('ok');
    // `out` carries the INTERIOR points only, an odd number of them, so the
    // middle of the arc is the middle entry.
    const k = (out.length / 2 - 1) / 2;
    expect(Number.isInteger(k)).toBe(true);
    const h = arcHandle(a, b, bulge);
    expect(out[2 * k]).toBeCloseTo(h.x, 6);
    expect(out[2 * k + 1]).toBeCloseTo(h.y, 6);
  });

  it('a zero-length chord has no handle to speak of', () => {
    expect(bulgeFor({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 5, y: 5 })).toBe(0);
    expect(arcHandle({ x: 1, y: 1 }, { x: 1, y: 1 }, 3)).toEqual({ x: 1, y: 1 });
  });
});

describe('picking', () => {
  it('prefers objects, then vertices, then arc handles', () => {
    // Order is priority, not alphabet: an arc handle is the only one of the
    // three whose position you chose by dragging it there, so it is the one you
    // can always reach by zooming in.
    let doc = blankDoc('t', 't');
    doc = setBulge(doc, 0, 1, 3);
    // The apple sits at (0, 0.6); vertex 0 of the floor is at (-20, 0).
    expect(pickHandle(doc, { x: 0.05, y: 0.6 }, 0.5)?.kind).toBe('apple');
    expect(pickHandle(doc, { x: -20.05, y: 0 }, 0.5)?.kind).toBe('vertex');
    const h = arcHandle(doc.polygons[0].verts[0], doc.polygons[0].verts[1], 3);
    const hit = pickHandle(doc, h, 0.5);
    expect(hit?.kind).toBe('arc');
    expect(hit?.vi).toBe(1);
    expect(pickHandle(doc, { x: 500, y: 500 }, 0.5)).toBeNull();
  });

  it('finds the vertices of the draft too', () => {
    const doc = startDraft(blankDoc('t', 't'), 'ground', { x: 5, y: 5 });
    expect(pickHandle(doc, { x: 5.01, y: 5 }, 0.5)?.kind).toBe('draft');
  });

  it('finds the nearest edge, and where on it', () => {
    const doc = blankDoc('t', 't');
    const e = pickEdge(doc, { x: 3, y: 0.2 }, 0.5);
    expect(e?.pi).toBe(0);
    // The floor runs from vertex 0 to vertex 1, so the edge ARRIVES at 1.
    expect(e?.vi).toBe(1);
    expect(e?.x).toBeCloseTo(3, 9);
    expect(e?.y).toBeCloseTo(0, 9);
    expect(pickEdge(doc, { x: 3, y: 5 }, 0.5)).toBeNull();
  });

  it('distToSegment clamps to the ends', () => {
    expect(distToSegment({ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(distToSegment({ x: 5, y: 3 }, { x: 1, y: 1 }, { x: 1, y: 1 })).toBeCloseTo(Math.sqrt(20), 12);
  });
});

describe('the gap probe', () => {
  const box = parseLevel(docToRaw(blankDoc('t', 't')));

  it('measures floor to ceiling through a point', () => {
    // The blank document is a 40 x 12 m room.
    const s = freeSpan(box.polys, 0, 3);
    expect(s.down).toBeCloseTo(3, 9);
    expect(s.up).toBeCloseTo(9, 9);
    expect(s.height).toBeCloseTo(12, 9);
  });

  it('is infinite where the level is open', () => {
    expect(rayDist(box.polys, 500, 0, 1)).toBe(Infinity);
    expect(freeSpan(box.polys, 500, 0).height).toBe(Infinity);
  });

  it('agrees with a level whose whole lesson is head clearance', () => {
    // 19-low-roof's tightest corridor is a real measurement, not a guess: the
    // bike needs 1.2 m and the level gives it 1.35.
    const lv = load('19-low-roof.json');
    let worst = Infinity;
    for (let x = lv.minX + 1; x < lv.maxX - 1; x += 0.5) {
      const h = freeSpan(lv.polys, x, 0.6).height;
      if (Number.isFinite(h) && h < worst) worst = h;
    }
    expect(worst).toBeGreaterThan(1.2);
    expect(worst).toBeLessThan(1.6);
  });
});

describe('what the geometry asks of the bike', () => {
  it('names a long climb past the measured limit', () => {
    const doc = {
      ...blankDoc('t', 't'),
      start: { x: -5, y: 1 },
      apples: [{ x: -2, y: 1 }],
      flower: { x: 10, y: 5 },
      polygons: [{
        kind: 'cave' as const,
        verts: [
          { x: -10, y: 0, bulge: 0 },
          { x: 0, y: 0, bulge: 0 },
          { x: 4, y: 4, bulge: 0 },   // 45 degrees, 5.6 m long
          { x: 20, y: 4, bulge: 0 },
          { x: 20, y: 20, bulge: 0 },
          { x: -10, y: 20, bulge: 0 },
        ],
      }],
    };
    const lv = parseLevel(docToRaw(doc));
    const f = envelopeFindings(lv.polys).filter((x) => x.code === 'climb');
    expect(f.length).toBe(1);
    expect(f[0].value).toBeCloseTo(45, 6);
    expect(f[0].message).toContain('34°');
  });

  it('names a vertical step in the range where a level looks passable and is not', () => {
    const step = (h: number) => {
      const lv = parseLevel(docToRaw({
        ...blankDoc('t', 't'),
        start: { x: -5, y: 1 },
        apples: [{ x: -2, y: 1 }],
        flower: { x: 10, y: h + 1 },
        polygons: [{
          kind: 'cave' as const,
          verts: [
            { x: -10, y: 0, bulge: 0 },
            { x: 0, y: 0, bulge: 0 },
            { x: 0, y: h, bulge: 0 },
            { x: 20, y: h, bulge: 0 },
            { x: 20, y: 20, bulge: 0 },
            { x: -10, y: 20, bulge: 0 },
          ],
        }],
      }));
      return envelopeFindings(lv.polys).filter((x) => x.code === 'step');
    };
    // Under the limit the bike rides up it; over three metres nobody thought
    // they were riding it. In between is the range worth a warning.
    expect(step(0.2).length).toBe(0);
    expect(step(0.8).length).toBe(1);
    expect(step(0.8)[0].message).toContain('0.35');
    expect(step(6).length).toBe(0);
  });

  it('stays quiet on the levels that were authored without it', () => {
    // A warning that fires on every wall in a cave is a warning nobody reads.
    // The twenty shipped levels are the calibration: single digits each, and
    // the ones that trip it most are the levels whose lesson IS a wall.
    for (const f of ['01-first-light.json', '12-whoops.json', '15-feather.json', '19-low-roof.json', '20-close-quarters.json']) {
      expect(envelopeFindings(load(f).polys).length).toBe(0);
    }
    expect(envelopeFindings(load('10-cathedral.json').polys).length).toBeLessThan(12);
  });

  it('warns about headroom where the player must go, and nowhere else', () => {
    const lv = load('19-low-roof.json');
    expect(headroomFindings(lv).length).toBe(0);

    // Drop a ceiling 1.05 m over the start: that is under the 1.10 m that kills.
    const doc = blankDoc('t', 't');
    doc.polygons.push({
      kind: 'ground',
      verts: [{ x: -18, y: 1, bulge: 0 }, { x: -14, y: 1, bulge: 0 }, { x: -14, y: 3, bulge: 0 }, { x: -18, y: 3, bulge: 0 }],
    });
    const f = headroomFindings(parseLevel(docToRaw(doc)));
    expect(f.length).toBe(1);
    expect(f[0].value).toBeCloseTo(1, 6);
    expect(f[0].message).toContain('the start');
  });
});
