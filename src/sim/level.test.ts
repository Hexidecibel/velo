import { describe, it, expect } from 'vitest';
import { LevelError, parseLevel, pointInSolid } from './level.ts';
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
