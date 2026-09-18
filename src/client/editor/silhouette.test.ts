import { describe, expect, it } from 'vitest';
import { DEFAULT_SPEC } from '@/sim/spec.ts';
import { BOOT_PRESET } from '../presets.ts';
import { layout, measureRestingBike, restingChassisY } from './silhouette.ts';

describe('the bike as a ruler', () => {
  it('measures the shipped bike', () => {
    // 1.7 m long on 0.25 m wheels. The length is the number an author actually
    // uses — "is this ledge longer than the bike" — and it is the one the whole
    // level set was designed against.
    const s = measureRestingBike(BOOT_PRESET.spec);
    expect(s.length).toBeCloseTo(1.7, 3);
    expect(s.wheels[0].r).toBe(BOOT_PRESET.spec.wheel.radius);
    expect(s.wheels[1].x - s.wheels[0].x).toBeCloseTo(1.2, 9);
    // Head height at rest. Not the plan's 1.13 — that figure predates the
    // preset's softer spring — which is exactly why this is measured off a
    // settled sim rather than quoted from a document.
    expect(s.height).toBeGreaterThan(1.05);
    expect(s.height).toBeLessThan(1.1);
  });

  it('agrees with the arithmetic to within a centimetre', () => {
    // The closed form is the fallback when there is no sim to ask. If the two
    // ever diverged badly it would mean the static equilibrium had moved, which
    // is a physics change and should be noticed.
    const measured = measureRestingBike(BOOT_PRESET.spec);
    const derived = layout(BOOT_PRESET.spec, restingChassisY(BOOT_PRESET.spec));
    expect(Math.abs(measured.height - derived.height)).toBeLessThan(0.02);
    expect(measured.length).toBeCloseTo(derived.length, 9);
  });

  it('is derived from the spec, never from constants', () => {
    // A silhouette built from hard-coded numbers is a picture of a bike that
    // used to exist, and it goes wrong silently.
    const big = {
      ...DEFAULT_SPEC,
      wheel: {
        ...DEFAULT_SPEC.wheel,
        radius: 0.5,
        anchors: [{ x: -1, y: -0.15 }, { x: 1, y: -0.15 }] as [{ x: number; y: number }, { x: number; y: number }],
      },
    };
    const s = layout(big, restingChassisY(big));
    expect(s.wheels[1].x - s.wheels[0].x).toBeCloseTo(2, 9);
    expect(s.length).toBeCloseTo(3, 9);
    expect(s.height).toBeGreaterThan(layout(DEFAULT_SPEC, restingChassisY(DEFAULT_SPEC)).height);
  });

  it('a stiffer spring stands the bike taller', () => {
    const soft = { ...DEFAULT_SPEC, suspension: { ...DEFAULT_SPEC.suspension, stiffness: 6500 } };
    const stiff = { ...DEFAULT_SPEC, suspension: { ...DEFAULT_SPEC.suspension, stiffness: 1e9 } };
    expect(restingChassisY(stiff)).toBeGreaterThan(restingChassisY(soft));
    expect(measureRestingBike(stiff).height).toBeGreaterThan(measureRestingBike(soft).height);
  });

  it('never sinks the chassis through the floor on a spec that would bottom out', () => {
    const noodle = { ...DEFAULT_SPEC, suspension: { ...DEFAULT_SPEC.suspension, stiffness: 1 } };
    for (const c of layout(noodle, restingChassisY(noodle)).chassis) expect(c.y).toBeGreaterThan(0);
  });
});
