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
import { drive, probeReachability } from '../../bin/_pilot.ts';

const level = parseLevel(TEST_LEVEL);

/**
 * The shipping bike, PINNED here rather than imported from
 * src/client/presets.ts — same reasoning as src/sim/curvelevel.test.ts.
 * `DEFAULT_SPEC` is the plan's numbers and is measurably not driveable, so a
 * reachability test cannot use it; importing the live preset would make this
 * fail every time somebody drags a slider, and this test is about the LEVEL.
 *
 * It does have to TRACK the shipping preset, though, or it stops testing
 * anything anyone plays. These are `handTuned()` in presets.ts: the M1
 * candidate's drive and rotation numbers, with the soft suspension and gravity
 * 9 the user arrived at by hand.
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
  s.suspension.stiffness = 6500;
  s.suspension.compressionDamping = 320;
  s.suspension.reboundDamping = 320;
  s.gravity = 9;
  return s;
}

describe('test01 is actually completable', () => {
  it('collects every apple and touches the flower', () => {
    // Easing off between x 14 and 23 is the route decision the pit demands:
    // carry speed and you fly over it, roll up to it and you drop in for the
    // apple on the boulder. Both are legitimate; only one collects it.
    //
    // ACROSS A SPREAD of look-ahead distances, not one pinned value, and that
    // is not test-fiddling — it is the claim being made. "This level is
    // completable" means SOME run completes it; the scripted pilot is a lower
    // bound on reachability and never a proof of unreachability. Pinning one
    // parameter also made this test fail on a change that altered nothing but
    // the ORDER two floats were added in: a 5e-16 difference at frame 400 is a
    // different line by frame 5000, because a bike bouncing off geometry is
    // chaotic. The level did not change and neither did the physics.
    const r = probeReachability(level, ridingBike(), [[[14, 23, 5.5]]], 120);
    expect(r.finished, `best run stopped at x=${r.best.x.toFixed(1)} with ${r.best.applesLeft} apples left`).toBe(true);
    expect(r.ever.every((v) => v === 1)).toBe(true);
    expect(r.best.applesLeft).toBe(0);
  });

  it('flies the pit instead when it is not asked to slow down', () => {
    // The same level, the same rider, no speed cap: it clears the pit and
    // therefore misses the apple in it. That is the route choice working, and
    // it is also why a single scripted run is a lower bound on reachability
    // rather than a proof of unreachability.
    //
    // The assertion is on the ROUTE, not on the distance: every uncapped run
    // must miss the pit apple, and at least one must get past the pit. A pinned
    // "and it reaches x > 55" is the brittle half and it was measuring the
    // pilot, not the level.
    const runs = [0.9, 1.0, 1.1, 1.3].map((look) => drive(level, ridingBike(), { look, seconds: 90 }));
    expect(runs.every((r) => r.applesTaken[1] === 0)).toBe(true);
    expect(Math.max(...runs.map((r) => r.x))).toBeGreaterThan(30);
  });
});
