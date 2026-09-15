import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LevelError, parseLevel, pointInSolid } from './level.ts';
import { DEFAULT_SAG_TOLERANCE } from './consts.ts';
import { TEST_LEVEL } from './testlevel.ts';

const box = (pts: [number, number][], kind = 'ground') => ({
  format: 'velo-level',
  start: { x: 50, y: 50 },
  flower: { x: 51, y: 50 },
  polygons: [{ kind, points: pts }],
});

describe('level loader rejections', () => {
  // Every one of these produces a NaN or an inside-out world if it gets
  // through, and one NaN poisons the whole state buffer within a tick. This is
  // the likeliest way a hand-authored level nukes the sim, so it is caught at
  // load, loudly, with the offending index in the message.
  it('rejects a polygon with fewer than 3 vertices', () => {
    expect(() => parseLevel(box([[0, 0], [1, 0]]))).toThrow(LevelError);
  });

  it('rejects duplicate consecutive vertices (zero-length edge -> NaN normal)', () => {
    expect(() => parseLevel(box([[0, 0], [1, 0], [1, 0], [1, 1]]))).toThrow(/zero-length edge/);
  });

  it('rejects a duplicate across the wrap-around edge too', () => {
    expect(() => parseLevel(box([[0, 0], [1, 0], [1, 1], [0, 0]]))).toThrow(/zero-length edge/);
  });

  it('rejects non-finite coordinates', () => {
    expect(() => parseLevel(box([[0, 0], [Infinity, 0], [1, 1]]))).toThrow(/finite/);
  });

  it('rejects a collinear, zero-area polygon', () => {
    expect(() => parseLevel(box([[0, 0], [1, 0], [2, 0]]))).toThrow(/degenerate/);
  });

  it('rejects a start position inside solid', () => {
    const lvl = box([[0, 0], [10, 0], [10, 10], [0, 10]]);
    lvl.start = { x: 5, y: 5 };
    expect(() => parseLevel(lvl)).toThrow(/start.*inside solid/);
  });

  it('rejects an apple inside solid (a silently impossible level)', () => {
    const lvl = { ...box([[0, 0], [10, 0], [10, 10], [0, 10]]), apples: [{ x: 5, y: 5 }] };
    expect(() => parseLevel(lvl)).toThrow(/apples\[0\].*inside solid/);
  });

  it('rejects a level with no collidable polygon', () => {
    expect(() => parseLevel(box([[0, 0], [1, 0], [1, 1]], 'decor'))).toThrow(/no collidable/);
  });

  it('rejects an unknown polygon kind', () => {
    expect(() => parseLevel(box([[0, 0], [1, 0], [1, 1]], 'lava'))).toThrow(/kind/);
  });
});

describe('level loader normalisation', () => {
  it('normalises winding, so vertex order is not a silent trap', () => {
    // The reason `kind` exists at all: getting the order backwards must be
    // impossible to do wrong, not merely documented.
    const ccw = parseLevel(box([[0, 0], [10, 0], [10, 10], [0, 10]]));
    const cw = parseLevel(box([[0, 10], [10, 10], [10, 0], [0, 0]]));
    expect(cw.simHash).toBe(ccw.simHash);
  });

  it('points ground normals outward and cave normals inward', () => {
    const ground = parseLevel(box([[0, 0], [10, 0], [10, 10], [0, 10]])).polys[0];
    // The bottom edge of a CCW square runs +x, so out-of-solid is -y.
    const bottom = [...ground.nx].findIndex((_, i) => ground.ny[i] < -0.9);
    expect(bottom).toBeGreaterThanOrEqual(0);

    const caveLvl = { ...box([[-100, -100], [100, -100], [100, 100], [-100, 100]], 'cave'), start: { x: 0, y: 0 }, flower: { x: 1, y: 0 } };
    const cave = parseLevel(caveLvl).polys[0];
    // Same square, but now the solid is outside, so the bottom edge's
    // out-of-solid normal is +y — you stand ON it.
    const caveBottom = [...cave.ny].findIndex((v) => v > 0.9);
    expect(caveBottom).toBeGreaterThanOrEqual(0);
  });

  it('agrees between kinds about what is solid', () => {
    const g = parseLevel(box([[0, 0], [10, 0], [10, 10], [0, 10]])).polys[0];
    expect(pointInSolid(g, 5, 5)).toBe(true);
    expect(pointInSolid(g, 15, 5)).toBe(false);
    const cLvl = { ...box([[0, 0], [10, 0], [10, 10], [0, 10]], 'cave'), start: { x: 5, y: 5 }, flower: { x: 6, y: 5 } };
    const c = parseLevel(cLvl).polys[0];
    expect(pointInSolid(c, 5, 5)).toBe(false);
    expect(pointInSolid(c, 15, 5)).toBe(true);
  });
});

describe('the two hashes', () => {
  it('simHash ignores presentation, contentHash does not', () => {
    // Leaderboards key on simHash: retitling or recolouring a level must
    // preserve its board, while moving an apple by 1e-12 must not.
    const a = parseLevel(TEST_LEVEL);
    const b = parseLevel({ ...TEST_LEVEL, name: 'a completely different title', author: 'someone else' });
    expect(b.simHash).toBe(a.simHash);
    expect(b.contentHash).not.toBe(a.contentHash);

    const moved = parseLevel({
      ...TEST_LEVEL,
      apples: TEST_LEVEL.apples!.map((p, i) => (i === 0 ? { x: p.x + 1e-12, y: p.y } : p)),
    });
    expect(moved.simHash).not.toBe(a.simHash);
  });

  it('simHash ignores decor', () => {
    const a = parseLevel(TEST_LEVEL);
    const b = parseLevel({ ...TEST_LEVEL, polygons: TEST_LEVEL.polygons.filter((p) => p.kind !== 'decor') });
    expect(b.simHash).toBe(a.simHash);
  });
});

describe('forward compatibility', () => {
  it('tolerates unknown zones and entities rather than rejecting', () => {
    // A level authored in 2027 must load in a 2026 client. Rev 1 ignores both
    // arrays; it must not refuse them.
    const lvl = parseLevel({
      ...TEST_LEVEL,
      zones: [{ type: 'gravity-well-2027', strength: 3 }],
      entities: [{ type: 'teleporter', to: 9 }],
    });
    expect(lvl.polys.length).toBe(2);
  });

  it('accepts the test level and finds its decor', () => {
    const lvl = parseLevel(TEST_LEVEL);
    expect(lvl.polys.length).toBe(2);
    expect(lvl.decor.length).toBe(1);
    expect(lvl.apples.length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Arcs in the authoring format
// ---------------------------------------------------------------------------

const arcBox = (points: unknown[]) => ({
  format: 'velo-level',
  start: { x: 50, y: 50 },
  flower: { x: 51, y: 50 },
  polygons: [{ kind: 'ground', points }],
});

describe('backwards compatibility with plain point lists', () => {
  it('produces a BIT-IDENTICAL simHash for the only level that existed', () => {
    // The cheapest possible guard against silently invalidating every time ever
    // recorded. If this literal has to change, the change is not a refactor.
    expect(parseLevel(TEST_LEVEL).simHash).toBe('d016a3cde9c75c2e');
  });

  it('agrees with the exported JSON on disk', () => {
    // The .json file is the actual artefact a leaderboard would key on, and it
    // goes through JSON.parse rather than the TypeScript literal. Checking only
    // the literal would miss a loader that treats the two differently.
    const path = fileURLToPath(new URL('../../levels/test01.json', import.meta.url));
    const onDisk = parseLevel(JSON.parse(readFileSync(path, 'utf8')));
    const inSource = parseLevel(TEST_LEVEL);
    expect(onDisk.simHash).toBe(inSource.simHash);
    expect(onDisk.contentHash).toBe(inSource.contentHash);
  });

  it('reports an arc-free level as arc-free', () => {
    const lvl = parseLevel(TEST_LEVEL);
    expect(lvl.arcCount).toBe(0);
    expect(lvl.arcSegments).toBe(0);
    expect(lvl.sagTolerance).toBe(DEFAULT_SAG_TOLERANCE);
  });
});

describe('arc authoring', () => {
  it('tessellates an arc into straight segments the sim cannot distinguish', () => {
    // The load-bearing claim of the whole feature: an arc and the points it
    // compiles to are the SAME LEVEL as far as the sim and the leaderboard are
    // concerned, because simHash covers the tessellated output.
    const curved = parseLevel(arcBox([[0, 0], { arcTo: [10, 0], bulge: -2 }, [10, 6], [0, 6]]));
    const p = curved.polys[0];
    const literal = parseLevel(
      arcBox([...Array.from({ length: p.vx.length }, (_, i) => [p.vx[i], p.vy[i]] as [number, number])]),
    );
    expect(literal.simHash).toBe(curved.simHash);
    expect(literal.arcCount).toBe(0);
    expect(curved.arcCount).toBe(1);
    expect(curved.arcSegments).toBeGreaterThan(20);
  });

  it('accepts two arcs between two points as a circle', () => {
    // Two entries, both arcs. A radius-and-flags form needs the same two
    // entries plus two booleans; this needs one number twice.
    const lvl = parseLevel(arcBox([
      { arcTo: [-1, 0], bulge: 1 },
      { arcTo: [1, 0], bulge: 1 },
    ]));
    const p = lvl.polys[0];
    for (let i = 0; i < p.vx.length; i++) {
      expect(Math.hypot(p.vx[i], p.vy[i])).toBeCloseTo(1, 9);
    }
    expect(p.vx.length).toBeGreaterThan(40);
  });

  it('lets an arc at entry 0 curve the closing edge', () => {
    // The points list is a RING, so the edge into entry 0 comes from the last
    // entry. Nothing special is needed to say that, and it must not be a
    // silently-dropped arc.
    const straight = parseLevel(arcBox([[0, 0], [10, 0], [10, 6]]));
    const closed = parseLevel(arcBox([{ arcTo: [0, 0], bulge: 1.5 }, [10, 0], [10, 6]]));
    expect(closed.polys[0].vx.length).toBeGreaterThan(straight.polys[0].vx.length + 10);
    expect(closed.arcCount).toBe(1);
  });

  it('never leaves a duplicate consecutive vertex at an arc join', () => {
    const lvl = parseLevel(arcBox([[0, 0], { arcTo: [10, 0], bulge: -3 }, { arcTo: [10, 8], bulge: 0.4 }, [0, 8]]));
    const p = lvl.polys[0];
    for (let i = 0; i < p.vx.length; i++) {
      const j = i + 1 === p.vx.length ? 0 : i + 1;
      expect((p.vx[j] - p.vx[i]) ** 2 + (p.vy[j] - p.vy[i]) ** 2).toBeGreaterThan(1e-14);
    }
  });

  it('honours a per-arc sagTolerance override', () => {
    const fine = parseLevel(arcBox([[0, 0], { arcTo: [10, 0], bulge: -2 }, [10, 6], [0, 6]]));
    const coarse = parseLevel(arcBox([[0, 0], { arcTo: [10, 0], bulge: -2, sagTolerance: 0.05 }, [10, 6], [0, 6]]));
    expect(coarse.arcSegments).toBeLessThan(fine.arcSegments);
  });

  it('honours a level-wide sagTolerance, and that MOVES simHash', () => {
    // Stated out loud because it is the price of the feature: a tolerance is a
    // physics constant wearing an authoring hat. Changing it changes the
    // collision geometry, so it must change the level's identity.
    const base = arcBox([[0, 0], { arcTo: [10, 0], bulge: -2 }, [10, 6], [0, 6]]);
    const fine = parseLevel(base);
    const coarse = parseLevel({ ...base, sagTolerance: 0.05 });
    expect(coarse.sagTolerance).toBe(0.05);
    expect(coarse.arcSegments).toBeLessThan(fine.arcSegments);
    expect(coarse.simHash).not.toBe(fine.simHash);
  });

  it('leaves an arc-free level untouched by the tolerance', () => {
    // The corollary, and the reason test01's hash is safe: no arcs, no effect.
    const a = parseLevel(TEST_LEVEL);
    const b = parseLevel({ ...TEST_LEVEL, sagTolerance: 0.25 });
    expect(b.simHash).toBe(a.simHash);
  });
});

describe('arc rejections', () => {
  // Arcs are held to exactly the standard the rest of the geometry is: reject
  // at load, loudly, with the offending index, because a NaN normal poisons the
  // whole state buffer within a tick.
  it('rejects an arc with no bulge rather than assuming one', () => {
    expect(() => parseLevel(arcBox([[0, 0], { arcTo: [10, 0] }, [10, 6]]))).toThrow(/bulge.*required/);
  });

  it('rejects a non-finite bulge', () => {
    expect(() => parseLevel(arcBox([[0, 0], { arcTo: [10, 0], bulge: NaN }, [10, 6]]))).toThrow(/finite/);
  });

  it('rejects an arc to coincident points', () => {
    expect(() => parseLevel(arcBox([[0, 0], { arcTo: [0, 0], bulge: 1 }, [10, 6]]))).toThrow(/coincident/);
  });

  it('rejects an unrecognised points entry instead of skipping it', () => {
    // Unlike `zones` and `entities`, geometry gets NO forward tolerance: a
    // points list is the collision surface, and quietly dropping an entry you
    // did not understand is how a level loads with a hole in the floor.
    expect(() => parseLevel(arcBox([[0, 0], { curveTo: [10, 0] }, [10, 6]]))).toThrow(/arcTo/);
    expect(() => parseLevel(arcBox([[0, 0], 'straight on', [10, 6]]))).toThrow(/arcTo/);
  });

  it('rejects a non-positive sagTolerance, at either scope', () => {
    expect(() => parseLevel({ ...TEST_LEVEL, sagTolerance: 0 })).toThrow(/sagTolerance/);
    expect(() => parseLevel(arcBox([[0, 0], { arcTo: [10, 0], bulge: 1, sagTolerance: -1 }, [10, 6]]))).toThrow(/sagTolerance/);
  });

  it('rejects a tolerance too tight to tessellate rather than silently coarsening', () => {
    expect(() => parseLevel({
      ...arcBox([[0, 0], { arcTo: [400, 0], bulge: 200 }, [400, 300]]),
      sagTolerance: 1e-12,
    })).toThrow(/segments/);
  });

  it('still needs 3 vertices AFTER tessellation', () => {
    expect(() => parseLevel(arcBox([[0, 0], [1, 0]]))).toThrow(/3 vertices/);
  });
});
