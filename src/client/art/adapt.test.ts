// The adaptive detail system's four rules, as assertions.
//
// It exists because of a report from play on a machine with a GPU — "feels
// choppy a lil bit sometimes", on 20-close-quarters, then "its not like SUPER
// choppy, just a tiny bit here and there". Occasional dropped frames, not a low
// frame rate. So the bar is not "make it fast", it is "give back exactly what a
// long frame costs and no more", and these tests are what stop the thing
// quietly becoming a global quality reduction instead.
import { describe, it, expect } from 'vitest';
import { chooseQuality, costAt, detailAt, loadOf, newAdapt, observe } from './adapt.ts';

/** Drive the controller for n frames against a machine of a given speed. */
function run(unitMs: number, frames: number, load = 1, target = 11, floor = 0.2): ReturnType<typeof newAdapt> {
  const s = newAdapt();
  for (let i = 0; i < frames; i++) {
    const q = chooseQuality(s, load, { target, floor });
    observe(s, unitMs * load * costAt(q), load, q);
  }
  return s;
}

describe('rule 1: engage late', () => {
  it('does nothing at all on a machine that fits the budget', () => {
    // The user likes how it looks and said so. Trading visible quality across
    // twenty levels to smooth an occasional hitch on one would be a bad trade,
    // so a frame that fits must produce no scaling whatsoever.
    for (const unit of [1, 3, 6, 8]) {
      expect(run(unit, 300).q, `unit ${unit}`).toBe(1);
    }
  });

  it('holds full detail right up to the budget', () => {
    // 10.8 ms against an 11 ms target: still inside, still untouched.
    expect(run(10.8, 300).q).toBe(1);
  });

  it('a single spike does not cost the whole look', () => {
    const s = newAdapt();
    for (let i = 0; i < 60; i++) {
      const q = chooseQuality(s, 1, { target: 11, floor: 0.2 });
      observe(s, 6 * costAt(q), 1, q);
    }
    expect(s.q).toBe(1);
    // One frame at four times the budget.
    observe(s, 44, 1, 1);
    const after = chooseQuality(s, 1, { target: 11, floor: 0.2 });
    expect(after).toBeLessThan(1);
    expect(after, 'one spike must not be a cliff').toBeGreaterThan(0.9);
  });
});

describe('rule 2: cheapest reduction first', () => {
  it('gives up bloom before it touches the terrain texture', () => {
    // Bloom is the most expensive layer Phase 1 measured, at 2.0-4.4 ms, and
    // the most forgiving to lose: it is atmosphere, not information.
    const d = detailAt(0.8);
    expect(d.bloom).toBeLessThan(1);
    expect(d.detail).toBe(1);
    expect(d.hatch).toBe(1);
    expect(d.wall).toBe(1);
  });

  it('the order is bloom, then patches, then hatch, then wall', () => {
    const gone = (q: number): string[] =>
      Object.entries(detailAt(q)).filter(([k, v]) => k !== 'hatchPitch' && v < 0.999).map(([k]) => k);
    // Each step down only ever ADDS to the set of things given up.
    let prev: string[] = [];
    for (let q = 1; q >= 0.2; q -= 0.02) {
      const now = gone(q);
      for (const k of prev) expect(now, `q=${q.toFixed(2)}`).toContain(k);
      prev = now;
    }
    expect(gone(0.95)).toEqual(['bloom']);
    expect(gone(0.6)).toContain('detail');
    expect(gone(0.25)).toContain('wall');
  });

  it('widens the hatch pitch rather than only fading it', () => {
    // It is the line COUNT that costs on a CPU rasteriser, not the opacity.
    expect(detailAt(1).hatchPitch).toBe(1);
    expect(detailAt(0.3).hatchPitch).toBeGreaterThan(1.5);
  });

  it('cost falls monotonically with quality, and never to zero', () => {
    expect(costAt(1)).toBeCloseTo(1, 6);
    for (let q = 1; q > 0.2; q -= 0.02) expect(costAt(q - 0.02)).toBeLessThanOrEqual(costAt(q) + 1e-9);
    // The floor is everything the system refuses to scale: the silhouette, the
    // cel bands, the ink, the lip, the actors.
    expect(costAt(0)).toBeGreaterThan(0.3);
  });
});

describe('rule 3: never the ink or the lip', () => {
  it('scales nothing but decoration at any quality', () => {
    // Stated as a shape test, because the guarantee is structural: the only
    // things `detailAt` can return are the six decorative layers. Ink width, lip
    // width, cel band scale and the chevrons are not in it and cannot be.
    const keys = Object.keys(detailAt(0.2)).sort();
    expect(keys).toEqual(['bloom', 'detail', 'hatch', 'hatchPitch', 'motes', 'props', 'wall']);
  });

  it('props are among the first decoration to go', () => {
    // They are the newest thing in the frame and the least load-bearing, and on
    // the two levels with no headroom they are also the least earned.
    expect(detailAt(0.5).props).toBeLessThan(1);
    expect(detailAt(0.3).props).toBe(0);
    expect(detailAt(0.62).props).toBe(1);
  });
});

describe('rule 4: back off early', () => {
  it('returns to full detail once the machine has room again', () => {
    // A scaler that settles permanently at reduced quality because one frame
    // spiked is a regression dressed as a fix.
    const s = newAdapt();
    for (let i = 0; i < 200; i++) {
      const q = chooseQuality(s, 1, { target: 11, floor: 0.2 });
      observe(s, 30 * costAt(q), 1, q);
    }
    expect(s.q, 'should have scaled down on a slow machine').toBeLessThan(0.8);
    // The load drops away — the camera left the solid-filled part of the level.
    for (let i = 0; i < 400; i++) {
      const q = chooseQuality(s, 0.3, { target: 11, floor: 0.2 });
      observe(s, 2 * 0.3 * costAt(q), 0.3, q);
    }
    expect(s.q).toBe(1);
  });

  it('climbs back smoothly rather than snapping', () => {
    // The bike's detail tiers already taught this: detail that pops in and out
    // while riding is worse than detail that is simply absent.
    const s = newAdapt();
    for (let i = 0; i < 200; i++) {
      const q = chooseQuality(s, 1, { target: 11, floor: 0.2 });
      observe(s, 30 * costAt(q), 1, q);
    }
    const low = s.q;
    let biggest = 0;
    let prev = low;
    for (let i = 0; i < 300; i++) {
      const q = chooseQuality(s, 0.3, { target: 11, floor: 0.2 });
      observe(s, 2 * 0.3 * costAt(q), 0.3, q);
      biggest = Math.max(biggest, Math.abs(q - prev));
      prev = q;
    }
    expect(biggest).toBeLessThanOrEqual(0.06);
  });

  it('never goes below the floor', () => {
    expect(run(400, 500).q).toBeGreaterThanOrEqual(0.2);
    expect(run(400, 500, 1, 11, 0.35).q).toBeGreaterThanOrEqual(0.35);
  });
});

describe('the feed-forward predictor', () => {
  it('reads more load from a frame that is mostly solid', () => {
    // 20-close-quarters is the shortest level in the set, so its whole height is
    // on screen and solid fills about nine tenths of the frame. Cost tracks
    // visible solid AREA, not level size, and this is what knows that before
    // the frame is drawn rather than one frame after.
    expect(loadOf(0.9)).toBeGreaterThan(loadOf(0.15));
    expect(loadOf(0)).toBeGreaterThan(0);
  });

  it('drops quality on entering a dense stretch without waiting to measure it', () => {
    // Calibrate on open level, then hand it a solid-filled viewport. The
    // decision has to change on the FIRST such frame: reacting only to measured
    // time means quality is a frame behind, and a frame behind is the frame
    // that drops.
    const s = newAdapt();
    for (let i = 0; i < 120; i++) {
      const q = chooseQuality(s, loadOf(0.15), { target: 11, floor: 0.2 });
      observe(s, 12 * loadOf(0.15) * costAt(q), loadOf(0.15), q);
    }
    expect(s.q).toBe(1);
    const dense = chooseQuality(s, loadOf(0.9), { target: 11, floor: 0.2 });
    expect(dense).toBeLessThan(1);
  });
});

describe('warm-up', () => {
  it('does not treat the cold-bake frames as evidence', () => {
    // The first frames after a level load include building every path in the
    // level and a cold rasteriser. Believing them would drop the quality of
    // every level for its first half second.
    const s = newAdapt();
    for (let i = 0; i < 6; i++) {
      const q = chooseQuality(s, 1, { target: 11, floor: 0.2 });
      observe(s, 90, 1, q);
    }
    expect(s.q).toBe(1);
    expect(s.unit).toBe(0);
  });
});
