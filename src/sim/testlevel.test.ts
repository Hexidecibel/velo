// test01 is completable, proved by driving it.
//
// This test exists because a playtest found apples on it that nobody could
// reach — on the FIRST hand-authored level, with a human placing five of them by
// hand. Coordinates look fine right up until you try to ride to them, so the
// assertion here is a driven run, not an inspection.
import { describe, it, expect } from 'vitest';
import { parseLevel } from './level.ts';
import { TEST_LEVEL } from './testlevel.ts';
import { DEFAULT_SPEC, cloneSpec } from './spec.ts';
import type { BikeSpec } from './spec.ts';
import { drive } from '../../bin/_pilot.ts';

const level = parseLevel(TEST_LEVEL);

/**
 * The shipping bike, pinned here rather than imported from src/client/presets.ts
 * — same reasoning as src/sim/curvelevel.test.ts. `DEFAULT_SPEC` is the plan's
 * numbers and is measurably not driveable, so a reachability test cannot use it;
 * importing the live preset would make this fail every time somebody drags a
 * slider, and this test is about the LEVEL.
 */
function ridingBike(): BikeSpec {
  const s = cloneSpec(DEFAULT_SPEC);
  s.drive.maxTorque = 140;
  s.chassis.inertia = 12;
  s.damping.angular = 3.0;
  s.rider.attitudeTorque = 340;
  s.rider.weightTransfer = 0.6;
  const r = (28 * Math.PI) / 180;
  s.rider.leanL = { x: -Math.sin(r), y: Math.cos(r) };
  s.rider.leanR = { x: Math.sin(r), y: Math.cos(r) };
  return s;
}

describe('test01 is actually completable', () => {
  it('collects every apple and touches the flower in one driven run', () => {
    // Easing off between x 14 and 23 is the route decision the pit demands:
    // carry speed and you fly over it, roll up to it and you drop in for the
    // apple on the boulder. Both are legitimate; only one collects it.
    const run = drive(level, ridingBike(), { look: 1.1, caps: [[14, 23, 5.5]], seconds: 120 });
    expect(run.outcome, `stopped at x=${run.x.toFixed(1)} with ${run.applesLeft} apples left`).toBe('finished');
    expect(run.applesLeft).toBe(0);
    expect(run.applesTaken.every((v) => v === 1)).toBe(true);
  });

  it('flies the pit instead when it is not asked to slow down', () => {
    // The same level, the same rider, no speed cap: it clears the pit and
    // therefore misses the apple in it. That is the route choice working, and
    // it is also why a single scripted run is a lower bound on reachability
    // rather than a proof of unreachability.
    const run = drive(level, ridingBike(), { look: 1.0, seconds: 90 });
    expect(run.applesTaken[1]).toBe(0);
    expect(run.x).toBeGreaterThan(55);
  });
});
