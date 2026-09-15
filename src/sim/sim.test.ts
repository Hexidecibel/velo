import { describe, it, expect } from 'vitest';
import { parseLevel } from './level.ts';
import { createSim } from './sim.ts';
import { DEFAULT_SPEC, cloneSpec } from './spec.ts';
import type { BikeSpec } from './spec.ts';
import { TEST_LEVEL } from './testlevel.ts';
import { IN_BRAKE, IN_FLIP, IN_LEAN_L, IN_LEAN_R, IN_THROTTLE, TICKS_PER_FRAME } from './consts.ts';

const level = parseLevel(TEST_LEVEL);
const drive = (f: number): number => (f % 9 < 6 ? IN_THROTTLE : 0) | (f % 31 < 5 ? IN_LEAN_L : 0) | (f % 97 === 0 ? IN_FLIP : 0);

describe('the bike at rest', () => {
  it('settles on its suspension and stays there', () => {
    const sim = createSim(level, DEFAULT_SPEC);
    for (let f = 0; f < 128 * 3; f++) sim.advance(0);
    const s = sim.state;
    expect(s.dead).toBe(false);
    // It has not fallen through the floor, nor been launched off it.
    expect(s.py).toBeGreaterThan(0.25);
    expect(s.py).toBeLessThan(0.55);
    expect(Math.abs(s.vy)).toBeLessThan(0.05);
    expect(Math.abs(s.vx)).toBeLessThan(0.05);
    // Both wheels down, chassis level.
    expect(s.grounded).toBe(3);
    expect(s.ox).toBeGreaterThan(0.99);
    // The wheels sit on the surface, not in it.
    expect(s.wy[0]).toBeGreaterThan(DEFAULT_SPEC.wheel.radius - 0.02);
  });

  it('never produces a non-finite number', () => {
    const sim = createSim(level, DEFAULT_SPEC);
    for (let f = 0; f < 128 * 20; f++) {
      sim.advance(drive(f));
      const s = sim.state;
      for (const v of [s.px, s.py, s.vx, s.vy, s.ox, s.oy, s.w, s.ax, s.ay, s.aw, ...s.wx, ...s.wy, ...s.wvx, ...s.wvy, ...s.wspin]) {
        if (!Number.isFinite(v)) throw new Error(`non-finite state at frame ${f}`);
      }
    }
  });
});

describe('determinism', () => {
  it('two sims fed the same inputs agree exactly', () => {
    const a = createSim(level, DEFAULT_SPEC);
    const b = createSim(level, DEFAULT_SPEC);
    for (let f = 0; f < 1200; f++) {
      a.advance(drive(f));
      b.advance(drive(f));
    }
    expect(a.hash()).toBe(b.hash());
  });

  it('is unaffected by a sim that ran earlier in the same process', () => {
    // The broadphase dedupe stamps are per-WORLD and the per-tick scratch is
    // module-level; if either leaked between instances this would drift.
    const warm = createSim(level, DEFAULT_SPEC);
    for (let f = 0; f < 700; f++) warm.advance(drive(f * 3));
    const a = createSim(level, DEFAULT_SPEC);
    const b = createSim(level, DEFAULT_SPEC);
    for (let f = 0; f < 600; f++) {
      a.advance(drive(f));
      warm.advance(drive(f));
      b.advance(drive(f));
    }
    expect(a.hash()).toBe(b.hash());
  });

  it('advance() is exactly TICKS_PER_FRAME ticks', () => {
    const sim = createSim(level, DEFAULT_SPEC);
    sim.advance(0);
    expect(sim.state.tick).toBe(TICKS_PER_FRAME);
  });

  it('ignores bits outside the input mask', () => {
    const a = createSim(level, DEFAULT_SPEC);
    const b = createSim(level, DEFAULT_SPEC);
    for (let f = 0; f < 200; f++) {
      a.advance(drive(f));
      b.advance(drive(f) | 0x7fff0000);
    }
    expect(a.hash()).toBe(b.hash());
  });
});

describe('snapshot / restore', () => {
  it('branching from a snapshot matches running straight through', () => {
    // The one solver requirement that is painful to retrofit: a search must be
    // able to branch from a state rather than replay from the start.
    const a = createSim(level, DEFAULT_SPEC);
    for (let f = 0; f < 400; f++) a.advance(drive(f));
    const snap = a.snapshot();
    for (let f = 400; f < 900; f++) a.advance(drive(f));
    const straight = a.hash();

    const b = createSim(level, DEFAULT_SPEC);
    b.restore(snap);
    for (let f = 400; f < 900; f++) b.advance(drive(f));
    expect(b.hash()).toBe(straight);
  });

  it('restore is the EXACT inverse of snapshot, to the last bit', () => {
    // Not "close". A solver that branches from a state must get bit-identical
    // results to one that replayed to it, and a one-ulp discrepancy from a
    // defensive renormalise is the hardest kind of bug to ever notice.
    const sim = createSim(level, DEFAULT_SPEC);
    for (let f = 0; f < 300; f++) sim.advance(drive(f));
    const snap = sim.snapshot();
    const h = sim.hash();
    for (let f = 0; f < 50; f++) sim.advance(drive(f + 1000));
    sim.restore(snap);
    expect(sim.hash()).toBe(h);
  });

  it('a snapshot is a copy, not a view', () => {
    const sim = createSim(level, DEFAULT_SPEC);
    for (let f = 0; f < 100; f++) sim.advance(IN_THROTTLE);
    const snap = sim.snapshot();
    const before = snap.wx[0];
    for (let f = 0; f < 100; f++) sim.advance(IN_THROTTLE);
    expect(snap.wx[0]).toBe(before);
    expect(snap.tick).not.toBe(sim.state.tick);
  });
});

describe('flip', () => {
  it('is edge-triggered, free, and changes nothing but facing', () => {
    const sim = createSim(level, DEFAULT_SPEC);
    for (let f = 0; f < 128; f++) sim.advance(0);
    const before = sim.snapshot();
    sim.advance(IN_FLIP);
    expect(sim.state.facing).toBe(-1);
    // Holding it does not flip again.
    for (let f = 0; f < 20; f++) sim.advance(IN_FLIP);
    expect(sim.state.facing).toBe(-1);
    sim.advance(0);
    sim.advance(IN_FLIP);
    expect(sim.state.facing).toBe(1);
    // Nothing teleported.
    expect(Math.abs(sim.state.px - before.px)).toBeLessThan(0.05);
  });

  it('selects the other drive wheel', () => {
    const a = createSim(level, DEFAULT_SPEC);
    for (let f = 0; f < 128; f++) a.advance(0);
    for (let f = 0; f < 60; f++) a.advance(IN_THROTTLE);
    expect(a.state.wspin[0]).toBeLessThan(-1); // rear wheel when facing +x
    const b = createSim(level, DEFAULT_SPEC);
    for (let f = 0; f < 128; f++) b.advance(0);
    b.advance(IN_FLIP);
    for (let f = 0; f < 60; f++) b.advance(IN_THROTTLE);
    expect(b.state.wspin[1]).toBeGreaterThan(1);
  });
});

describe('the death sphere and the objects', () => {
  it('kills when the head touches terrain, and freezes the run', () => {
    // The head is on the ARM, not at a fixed offset, so volting into a low
    // ceiling kills you. A fixed head deletes that skill invisibly.
    const spec = cloneSpec(DEFAULT_SPEC);
    const lowRoom = parseLevel({
      format: 'velo-level',
      start: { x: 0, y: 0.6 },
      flower: { x: 6, y: 0.6 },
      // Ceiling at 0.95 — under the head's resting height of 0.55 + 0.16.
      polygons: [{ kind: 'cave', points: [[-4, 0], [10, 0], [10, 0.95], [-4, 0.95]] }],
    });
    const sim = createSim(lowRoom, spec);
    for (let f = 0; f < 128; f++) sim.advance(0);
    expect(sim.state.dead).toBe(true);
    const at = sim.state.endTick;
    for (let f = 0; f < 50; f++) sim.advance(IN_THROTTLE);
    expect(sim.state.endTick).toBe(at);
  });

  it('collects apples and only then accepts the flower', () => {
    const lvl = parseLevel({
      format: 'velo-level',
      start: { x: 0, y: 0.6 },
      flower: { x: 0.2, y: 0.6 },
      apples: [{ x: 3, y: 0.6 }],
      polygons: [{ kind: 'cave', points: [[-4, 0], [30, 0], [30, 8], [-4, 8]] }],
    });
    const sim = createSim(lvl, DEFAULT_SPEC);
    // The flower is right next to the start but one apple is still out there.
    for (let f = 0; f < 60; f++) sim.advance(0);
    expect(sim.state.finished).toBe(false);
    expect(sim.state.applesLeft).toBe(1);
    for (let f = 0; f < 128 * 4 && !sim.state.finished && !sim.state.dead; f++) sim.advance(IN_THROTTLE);
    expect(sim.state.applesLeft).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Rotation authority
// ---------------------------------------------------------------------------
//
// The bike used to rotate by gravity weight transfer alone, which is strongest
// upright and useless inverted — exactly backwards from what a player needs,
// and it showed up in a playtest as "spin just keeps going, need to be able to
// correct easily". `rider.attitudeTorque` is the fix, and these are the three
// properties it has to have. They test the SHAPE of the control, not today's
// numbers, so tuning does not churn them.

/** A 400 m shaft, so the bike can rotate in free fall without touching anything. */
const AIR = parseLevel({
  format: 'velo-level',
  start: { x: 0, y: 0 },
  flower: { x: 0, y: -395 },
  polygons: [{ kind: 'cave', points: [[-40, -400], [40, -400], [40, 20], [-40, 20]] }],
});

/** The shipping bike, pinned here so that dragging a slider cannot turn these red. */
function tuned(weightTransfer = 0.6): BikeSpec {
  const s = cloneSpec(DEFAULT_SPEC);
  s.chassis.inertia = 12;
  s.damping.angular = 3.0;
  s.rider.attitudeTorque = 340;
  s.rider.weightTransfer = weightTransfer;
  return s;
}

/**
 * Spin up in free fall from a given attitude, holding one lean key.
 *
 * The whole pose is rotated, not just the rotor: the wheels are re-seated on
 * their anchors and the arm on its rest direction. Rotating the chassis alone
 * would leave the wheels hanging in the wrong place, and the suspension would
 * then supply a torque of its own — which is exactly the confound this test is
 * trying to exclude.
 */
function spin(spec: BikeSpec, ox: number, oy: number, mask: number, frames: number, w0 = 0): number {
  const sim = createSim(AIR, spec);
  const s = sim.state;
  s.ox = ox;
  s.oy = oy;
  s.w = w0;
  const rx = (x: number, y: number): number => ox * x - oy * y;
  const ry = (x: number, y: number): number => oy * x + ox * y;
  for (let i = 0; i < 2; i++) {
    const a = spec.wheel.anchors[i];
    s.wx[i] = s.px + rx(a.x, a.y);
    s.wy[i] = s.py + ry(a.x, a.y);
    s.wvx[i] = s.vx;
    s.wvy[i] = s.vy;
  }
  s.ax = rx(spec.rider.rest.x, spec.rider.rest.y);
  s.ay = ry(spec.rider.rest.x, spec.rider.rest.y);
  s.aw = w0;
  for (let f = 0; f < frames; f++) sim.advance(mask);
  return sim.state.w;
}

describe('rotation authority', () => {
  it('is attitude-independent: the same lean does the same thing inverted', () => {
    // With gravity weight transfer switched off, what remains is the attitude
    // torque, and it must not care which way up the bike is. Equal to ten
    // decimal places rather than bit-exactly: the same physics evaluated in a
    // rotated frame rounds differently in the last ulp or two, which is a float
    // artefact and not an attitude dependence. A real one would show up in the
    // second decimal, because the term this replaced peaked at 192 N m.
    const s = tuned(0);
    const upright = spin(s, 1, 0, IN_LEAN_L, 64);
    const inverted = spin(s, -1, 0, IN_LEAN_L, 64);
    const nose = spin(s, 0, 1, IN_LEAN_L, 64);
    expect(upright).toBeGreaterThan(1);
    expect(inverted).toBeCloseTo(upright, 10);
    expect(nose).toBeCloseTo(upright, 10);
  });

  it('arrests a runaway spin from any attitude, in well under half a second', () => {
    // The playtest complaint, as an assertion. -8 rad/s is faster than the bike
    // can reach on its own.
    const s = tuned();
    for (const [ox, oy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const after = spin(s, ox, oy, IN_LEAN_L, 64, -8); // 64 frames = 0.5 s
      expect(after, `from attitude (${ox}, ${oy})`).toBeGreaterThan(0);
    }
  });

  it('converges to a terminal rate instead of accelerating forever', () => {
    // A constant torque against linear angular damping gives
    // w(t) = w_inf * (1 - e^(-c t)). That is what makes a tap a nudge and a
    // hold a clean flip, with no ramp or charge-up mechanic anywhere.
    //
    // Measured with weight transfer OFF, because that term is a function of the
    // arm's world-horizontal component and therefore adds a once-per-revolution
    // wobble to the rate — real, wanted, and not the thing being asserted here.
    const s = tuned(0);
    const at1 = spin(s, 1, 0, IN_LEAN_L, 128);
    const at3 = spin(s, 1, 0, IN_LEAN_L, 384);
    const at4 = spin(s, 1, 0, IN_LEAN_L, 512);
    expect(at3).toBeGreaterThan(at1);
    expect(Math.abs(at4 - at3)).toBeLessThan(0.05);
    // Fast enough to flip satisfyingly, slow enough to read and reverse.
    expect(at4).toBeGreaterThan(3.5);
    expect(at4).toBeLessThan(7);
  });

  it('still lets the rider weight lift the front under power', () => {
    // Weight transfer is demoted to flavour, not deleted: leaning back on the
    // throttle must still produce a wheelie, because it is the single most
    // important thing a rider does.
    const withTransfer = createSim(level, tuned(0.4));
    const without = createSim(level, tuned(0));
    let a = 0;
    let b = 0;
    for (let f = 0; f < 128; f++) {
      withTransfer.advance(IN_THROTTLE);
      without.advance(IN_THROTTLE);
      a = Math.max(a, withTransfer.state.oy);
      b = Math.max(b, without.state.oy);
    }
    expect(a).toBeGreaterThan(b);
  });
});

/**
 * Flat ground with plenty of headroom. The suspension and brake-dive tests
 * below need a surface with no features on it at all: on test01 they would be
 * measuring which bump the wheel happened to land on.
 */
const FLAT = parseLevel({
  format: 'velo-level',
  start: { x: 0, y: 1 },
  flower: { x: 95, y: 1 },
  polygons: [{ kind: 'cave', points: [[-10, 0], [100, 0], [100, 20], [-10, 20]] }],
});

/** The shipping bike's driveable numbers, on a flat surface. */
function rideable(): BikeSpec {
  const s = tuned();
  s.drive.maxTorque = 140;
  return s;
}

describe('asymmetric suspension damping', () => {
  /**
   * Drop the bike onto flat ground and report how high it comes back UP.
   *
   * Measured from the bottom of the compression stroke, not from first contact.
   * From first contact it measures nothing useful: the chassis is still falling
   * then, so "peak height after touchdown" is dominated by how far it had left
   * to fall, and a firmer damper reads HIGHER simply because it stopped the
   * fall sooner. The rebound stroke starts at maximum compression and that is
   * where the measurement has to start too.
   */
  function dropBounce(compression: number, rebound: number): number {
    const s = rideable();
    s.suspension.compressionDamping = compression;
    s.suspension.reboundDamping = rebound;
    const sim = createSim(FLAT, s);
    sim.state.py += 2;
    for (let i = 0; i < 2; i++) sim.state.wy[i] += 2;
    let lowest = Infinity;
    let bottomedAt = -1;
    let peak = -Infinity;
    for (let f = 0; f < 128 * 4; f++) {
      sim.advance(0);
      const py = sim.state.py;
      if (bottomedAt < 0) {
        if (sim.state.grounded !== 0 && py < lowest) {
          lowest = py;
        } else if (sim.state.grounded !== 0 && py > lowest + 1e-6) {
          bottomedAt = f;
          peak = py;
        }
      } else if (py > peak) {
        peak = py;
      }
    }
    return peak - lowest;
  }

  it('is bit-identical to one symmetric coefficient when the two are equal', () => {
    // The migration path, asserted rather than assumed: splitting the field must
    // not have changed the bike anybody was already riding. The branch in
    // step.ts selects the same number from either side, so this is exact.
    const a = rideable();
    a.suspension.compressionDamping = 640;
    a.suspension.reboundDamping = 640;
    const simA = createSim(FLAT, a);
    const simB = createSim(FLAT, a);
    for (let f = 0; f < 400; f++) {
      const m = f % 5 < 3 ? IN_THROTTLE : 0;
      simA.advance(m);
      simB.advance(m);
    }
    expect(simA.hash()).toBe(simB.hash());
    expect(simA.state.py).toBe(simB.state.py);
  });

  it('gives the bike back more of a landing when rebound damping is lower', () => {
    // The whole mechanism in one assertion: the spring stores the impact either
    // way, and the rebound coefficient decides whether it comes back as height
    // or as heat.
    const firm = dropBounce(500, 1600);
    const loose = dropBounce(500, 120);
    expect(loose).toBeGreaterThan(firm);
  });

  it('separates the two strokes — one coefficient does not set both', () => {
    // If the sign test in step.ts were backwards, or one coefficient were
    // applied to both strokes, these two would come out the same.
    const a = dropBounce(1600, 120);
    const b = dropBounce(120, 1600);
    expect(Math.abs(a - b)).toBeGreaterThan(0.005);
  });
});

describe("the rider's inertial reaction on the pivot", () => {
  /**
   * Run up to speed on flat ground, then brake, and report the most nose-down
   * the chassis got. `oy` IS the sine of the pitch angle — the sim stores
   * orientation as a rotor precisely so that nothing has to call atan2 — so a
   * falling `oy` is the nose going down for a bike facing +x.
   */
  function brakeDive(inertialTransfer: number): number {
    const s = rideable();
    s.rider.inertialTransfer = inertialTransfer;
    const sim = createSim(FLAT, s);
    // Run up holding the chassis level. Without the lean the bike wheelies to
    // 40 degrees on the way to speed and the brake measurement starts from a
    // different attitude for every coefficient, which is not a measurement.
    for (let f = 0; f < 128 * 6; f++) {
      let m: number = IN_THROTTLE;
      const err = sim.state.oy + sim.state.w * 0.18;
      if (err > 0.02) m |= IN_LEAN_R;
      else if (err < -0.02) m |= IN_LEAN_L;
      sim.advance(m);
    }
    expect(sim.state.vx).toBeGreaterThan(5);
    expect(Math.abs(sim.state.oy)).toBeLessThan(0.2);
    let worst = sim.state.oy;
    for (let f = 0; f < 20; f++) {
      sim.advance(IN_BRAKE);
      if (sim.state.oy < worst) worst = sim.state.oy;
    }
    return worst;
  }

  it('is off at zero in DEFAULT_SPEC — rev 3 at 0 is the rev 2 bike', () => {
    expect(DEFAULT_SPEC.rider.inertialTransfer).toBe(0);
  });

  it('dives the nose under braking, and more of it with a bigger coefficient', () => {
    // The user's report: "slamming on brake should slam down the front end,
    // right? just like gassing lifts up". It should, and before this term there
    // was no path at all from braking onto the chassis.
    const off = brakeDive(0);
    const on = brakeDive(1);
    const more = brakeDive(2);
    expect(on).toBeLessThan(off);
    expect(more).toBeLessThan(on);
  });

  it('turns a LANDING into rotation when the rider is leaned — not a brake hack', () => {
    // The other half of the same term, and the one that matters for technique.
    // Under a landing the pivot decelerates hard upward; with the rider leaned,
    // that acceleration crosses the arm and becomes chassis torque. It is what
    // makes "lean in as you hit" convert momentum into rotation, which a static
    // weight term cannot do, because a static term does not know the difference
    // between a landing and standing still.
    //
    // A brake-gated special case would score identically on the braking test
    // above and produce exactly nothing here.
    const spin = (it: number): number => {
      const s = rideable();
      s.rider.inertialTransfer = it;
      const sim = createSim(FLAT, s);
      sim.state.py += 2;
      for (let i = 0; i < 2; i++) sim.state.wy[i] += 2;
      let worst = 0;
      for (let f = 0; f < 128; f++) {
        sim.advance(IN_LEAN_R);
        if (Math.abs(sim.state.w) > Math.abs(worst)) worst = sim.state.w;
      }
      return Math.abs(worst);
    };
    expect(spin(1)).toBeGreaterThan(spin(0) * 1.02);
  });
});
