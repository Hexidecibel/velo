import { describe, it, expect } from 'vitest';
import { ROT_IDENTITY, cosSmall, rotIntegrate, rotNormalize, rotX, rotY, sinSmall, unrotX, unrotY } from './rot.ts';
import { DT } from './consts.ts';

describe('small-angle Taylor', () => {
  // The claim the whole determinism design rests on: at the per-tick angles a
  // bike actually produces, the fixed polynomials are indistinguishable from
  // the engine's own transcendentals — so we give up nothing by refusing to
  // call them.
  it('matches Math.sin/cos to float64 precision at realistic tick angles', () => {
    // Exact at anything a bike actually does...
    for (const w of [0.5, 5, 20]) {
      const a = w * DT;
      expect(Math.abs(sinSmall(a) - Math.sin(a))).toBeLessThanOrEqual(1e-16);
      expect(Math.abs(cosSmall(a) - Math.cos(a))).toBeLessThanOrEqual(2e-16);
    }
    // ...and still far below anything that could matter at MAX_ANGVEL.
    const a = 60 * DT;
    expect(Math.abs(sinSmall(a) - Math.sin(a))).toBeLessThan(1e-13);
    expect(Math.abs(cosSmall(a) - Math.cos(a))).toBeLessThan(1e-11);
  });

  it('degrades gracefully rather than exploding at silly angles', () => {
    // MAX_ANGVEL keeps us far from here, but a polynomial that goes to
    // infinity off the end of its range is a different kind of hazard from one
    // that just gets inaccurate.
    expect(Number.isFinite(sinSmall(1))).toBe(true);
    expect(Math.abs(sinSmall(0.5) - Math.sin(0.5))).toBeLessThan(1e-8);
  });
});

describe('rotor', () => {
  it('rotates vectors and inverts exactly', () => {
    const r = rotNormalize(3, 4);
    const x = 1.7;
    const y = -0.4;
    const wx = rotX(r, x, y);
    const wy = rotY(r, x, y);
    expect(unrotX(r, wx, wy)).toBeCloseTo(x, 12);
    expect(unrotY(r, wx, wy)).toBeCloseTo(y, 12);
    // A rotation preserves length.
    expect(Math.sqrt(wx * wx + wy * wy)).toBeCloseTo(Math.sqrt(x * x + y * y), 12);
  });

  it('holds unit magnitude EXACTLY over 600k ticks', () => {
    // 600,000 ticks is ~20 minutes of real time at 512 Hz — longer than any
    // level will ever take. The interesting assertion is not "close to 1", it
    // is that per-tick renormalisation makes the drift stop accumulating at
    // all, which is why orientation can be integrated forever without a
    // periodic re-anchor that would itself have to be part of the replay.
    let r = ROT_IDENTITY;
    let worstEarly = 0;
    let worstLate = 0;
    for (let i = 0; i < 600000; i++) {
      r = rotIntegrate(r, 17.5, DT);
      const d = Math.abs(Math.sqrt(r.x * r.x + r.y * r.y) - 1);
      if (i < 10000) {
        if (d > worstEarly) worstEarly = d;
      } else if (i >= 590000 && d > worstLate) {
        worstLate = d;
      }
    }
    // One ulp, and — the part that matters — no worse at the end than at the
    // start. Bounded, not merely small: an error that accumulates would force a
    // periodic re-anchor, and that re-anchor would itself have to be part of
    // the replay format.
    expect(worstEarly).toBeLessThanOrEqual(2.3e-16);
    expect(worstLate).toBeLessThanOrEqual(worstEarly);
    expect(Math.sqrt(r.x * r.x + r.y * r.y)).toBe(1);
  });

  it('is bit-identical when the same rotation is replayed', () => {
    const run = (): string => {
      let r = ROT_IDENTITY;
      for (let i = 0; i < 5000; i++) r = rotIntegrate(r, (i % 37) - 18, DT);
      return r.x.toExponential(20) + '/' + r.y.toExponential(20);
    };
    expect(run()).toBe(run());
  });
});
