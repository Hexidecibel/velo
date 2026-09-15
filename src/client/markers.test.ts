// The off-screen indicator placement.
//
// Pure geometry, which is exactly the kind of code that is wrong by a factor of
// two or a sign and looks fine — a marker on the wrong side of the screen sends
// somebody the wrong way down a 176 m level and they blame the level.
//
// The y sign is the one to watch: the world is y-up and the canvas is y-down,
// so an apple ABOVE the bike must produce a marker at the TOP of the window.
import { describe, it, expect } from 'vitest';
import { edgeMarkers } from './markers.ts';

const W = 1200;
const H = 800;
const VIEW = { x: 0, y: 0, zoom: 40 };

describe('edgeMarkers', () => {
  it('says nothing about a target that is already on screen', () => {
    const m = edgeMarkers([{ x: 1, y: 1, kind: 'apple' }], VIEW, W, H, { x: 0, y: 0 }, 30);
    expect(m).toHaveLength(0);
  });

  it('puts an apple that is above the bike at the TOP of the window', () => {
    // 60 m up at 40 px/m is 2400 px: far off the top. The canvas is y-down, so
    // "top" is a SMALL sy — getting this backwards is the whole reason this
    // test exists.
    const [m] = edgeMarkers([{ x: 0, y: 60, kind: 'apple' }], VIEW, W, H, { x: 0, y: 0 }, 30);
    expect(m.sy).toBeCloseTo(30, 6);
    expect(m.sx).toBeCloseTo(W / 2, 6);
    expect(m.dy).toBeCloseTo(-1, 6);
  });

  it('puts one below at the bottom, and one to the right at the right', () => {
    const [down] = edgeMarkers([{ x: 0, y: -60, kind: 'apple' }], VIEW, W, H, { x: 0, y: 0 }, 30);
    expect(down.sy).toBeCloseTo(H - 30, 6);
    const [right] = edgeMarkers([{ x: 80, y: 0, kind: 'apple' }], VIEW, W, H, { x: 0, y: 0 }, 30);
    expect(right.sx).toBeCloseTo(W - 30, 6);
    expect(right.sy).toBeCloseTo(H / 2, 6);
  });

  it('never places a marker outside the inset rectangle, at any angle', () => {
    const inset = 30;
    const targets = [];
    for (let i = 0; i < 360; i++) {
      // A ring far outside the viewport, one target per degree.
      const a = (i * Math.PI) / 180;
      targets.push({ x: Math.cos(a) * 400, y: Math.sin(a) * 400, kind: 'apple' as const });
    }
    const ms = edgeMarkers(targets, VIEW, W, H, { x: 0, y: 0 }, inset);
    // Thinned by the minimum spacing — the claim here is about WHERE each one
    // lands, not how many survive — but the ring must still be represented all
    // the way round rather than collapsing to a handful.
    expect(ms.length).toBeGreaterThan(60);
    for (const m of ms) {
      expect(m.sx).toBeGreaterThanOrEqual(inset - 1e-6);
      expect(m.sx).toBeLessThanOrEqual(W - inset + 1e-6);
      expect(m.sy).toBeGreaterThanOrEqual(inset - 1e-6);
      expect(m.sy).toBeLessThanOrEqual(H - inset + 1e-6);
      // And on the rectangle, not merely inside it: one axis is at its bound.
      const onX = Math.abs(Math.abs(m.sx - W / 2) - (W / 2 - inset)) < 1e-6;
      const onY = Math.abs(Math.abs(m.sy - H / 2) - (H / 2 - inset)) < 1e-6;
      expect(onX || onY).toBe(true);
      expect(Math.abs(Math.sqrt(m.dx * m.dx + m.dy * m.dy) - 1)).toBeLessThan(1e-9);
    }
  });

  it('reports the distance in metres from the BIKE, not from the camera', () => {
    // The camera leads ahead of the bike, so these genuinely differ, and the
    // number a player reads has to be how far THEY are from the apple.
    const cam = { x: 10, y: 0, zoom: 40 };
    const [m] = edgeMarkers([{ x: 100, y: 0, kind: 'apple' }], cam, W, H, { x: 0, y: 0 }, 30);
    expect(m.dist).toBeCloseTo(100, 6);
  });

  it('draws nothing when the window is smaller than twice the inset', () => {
    expect(edgeMarkers([{ x: 99, y: 0, kind: 'apple' }], VIEW, 40, 40, { x: 0, y: 0 }, 30)).toHaveLength(0);
  });

  it('collapses a pile-up to the nearest, so labels never land on each other', () => {
    // Four apples on almost the same bearing, at different distances. They all
    // project to within a few px of the same spot on the rectangle, and four
    // distance labels stacked there is a smudge rather than information.
    const ms = edgeMarkers(
      [
        { x: 100, y: 0.2, kind: 'apple' },
        { x: 140, y: 0.3, kind: 'apple' },
        { x: 180, y: 0.1, kind: 'apple' },
        { x: 220, y: 0.4, kind: 'apple' },
      ],
      VIEW, W, H, { x: 0, y: 0 }, 30,
    );
    expect(ms).toHaveLength(1);
    // And it is the NEAREST that survives — the one you would reach first.
    expect(ms[0].dist).toBeCloseTo(100, 0);
  });

  it('keeps well-separated markers, and gives the flower the spot when they collide', () => {
    const ms = edgeMarkers(
      [
        // Three apples at three bearings: all kept.
        { x: 100, y: 0, kind: 'apple' },
        { x: 0, y: 100, kind: 'apple' },
        { x: -100, y: 0, kind: 'apple' },
        // And the flower sitting on top of the first. The flower wins — it is
        // the exit, and there is one of it. (In practice they never coexist:
        // the renderer only offers the flower once the last apple is gone.)
        { x: 101, y: 0, kind: 'flower' },
      ],
      VIEW, W, H, { x: 0, y: 0 }, 30,
    );
    expect(ms).toHaveLength(3);
    expect(ms.filter((m) => m.kind === 'flower')).toHaveLength(1);
  });

  it('carries the kind through, so the flower can read louder than an apple', () => {
    const ms = edgeMarkers(
      [{ x: 99, y: 0, kind: 'apple' }, { x: -99, y: 0, kind: 'flower' }],
      VIEW, W, H, { x: 0, y: 0 }, 30,
    );
    // Flower first: the thinning pass places it before any apple can take its
    // spot. Order is an implementation detail of that rule, not a draw order.
    expect(ms.map((m) => m.kind)).toEqual(['flower', 'apple']);
  });
});
