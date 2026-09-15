// The arc level, and the two things it is here to prove: that a curve written
// as four arcs is SMOOTH once compiled, and that the bike can actually ride it.
//
// It imports the sag metric from bin/ rather than re-deriving it, so the number
// this test asserts against is the same number bin/level-check prints. A level
// that passes here cannot warn there, and that is the point — the tool and the
// test must not be able to disagree about what "too coarse" means.
import { describe, it, expect } from 'vitest';
import { parseLevel } from './level.ts';
import { createSim } from './sim.ts';
import { CURVE_LEVEL } from './curvelevel.ts';
import { TEST_LEVEL } from './testlevel.ts';
import { IN_THROTTLE, IN_LEAN_L, IN_LEAN_R } from './consts.ts';
import { DEFAULT_SPEC, cloneSpec } from './spec.ts';
import type { BikeSpec } from './spec.ts';
import { sagFindings } from '../../bin/_sag.ts';

const level = parseLevel(CURVE_LEVEL);

/**
 * The bike this level was designed around — the client's M1 candidate, PINNED
 * HERE rather than imported from src/client/presets.ts.
 *
 * `DEFAULT_SPEC` is the plan's numbers verbatim and is measurably not
 * driveable: full throttle from a standstill backflips it inside 0.4 s. So a
 * drivability test cannot use it. But importing the client's live preset would
 * make this test fail every time somebody drags a slider, and the repo's whole
 * position is that tuning must stay cheap. A frozen copy is the only version of
 * this test that is about the LEVEL rather than about today's bike.
 */
function ridingBike(): BikeSpec {
  const s = cloneSpec(DEFAULT_SPEC);
  s.drive.maxTorque = 140;
  s.chassis.inertia = 12;
  s.damping.angular = 3.0;
  s.rider.attitudeTorque = 340;
  s.rider.weightTransfer = 0.6;
  // 28 degrees of lean, baked to unit vectors the way the panel bakes them.
  const r = (28 * Math.PI) / 180;
  s.rider.leanL = { x: -Math.sin(r), y: Math.cos(r) };
  s.rider.leanR = { x: Math.sin(r), y: Math.cos(r) };
  return s;
}
const BIKE = ridingBike();

function findings(lvl: ReturnType<typeof parseLevel>) {
  return lvl.polys.flatMap((p) => sagFindings(p, lvl.sagTolerance));
}

/**
 * The simplest input stream a person would actually use: throttle while a wheel
 * is down, and keep the chassis level in the air. Nothing clever — drive torque
 * is reacted on the chassis, so holding the gas through airtime rotates the
 * bike backwards, and knowing to let go is the first thing anyone learns.
 */
function pilot(lvl: ReturnType<typeof parseLevel>, spec = BIKE, frames = 128 * 30) {
  const sim = createSim(lvl, spec);
  for (let f = 0; f < frames; f++) {
    const s = sim.state;
    let mask = s.grounded ? IN_THROTTLE : 0;
    if (!s.grounded) {
      if (s.oy > 0.02) mask |= IN_LEAN_R;
      else if (s.oy < -0.02) mask |= IN_LEAN_L;
    }
    sim.advance(mask);
    const t = sim.state;
    for (const v of [t.px, t.py, t.vx, t.vy, t.ox, t.oy, t.w, ...t.wx, ...t.wy]) {
      if (!Number.isFinite(v)) throw new Error(`non-finite state at frame ${f}`);
    }
    if (t.dead) return { outcome: 'dead' as const, frame: f, x: t.px, applesLeft: t.applesLeft };
    if (t.finished) return { outcome: 'finished' as const, frame: f, x: t.px, applesLeft: t.applesLeft };
  }
  return { outcome: 'timeout' as const, frame: frames, x: sim.state.px, applesLeft: sim.state.applesLeft };
}

describe('the arc level compiles to something smooth', () => {
  it('turns a handful of arcs into a few hundred segments', () => {
    expect(level.arcCount).toBeGreaterThanOrEqual(12);
    expect(level.arcSegments).toBeGreaterThan(150);
    // The ratio IS the feature. Anything near 1:1 means tessellation stopped
    // working and the level is secretly a polyline again.
    expect(level.arcSegments / level.arcCount).toBeGreaterThan(8);
  });

  it('leaves no chord sagging more than the tolerance', () => {
    expect(findings(level)).toEqual([]);
  });

  it('while test01 — hand-authored straight runs — is full of them', () => {
    // The control. If this ever comes back empty the metric has stopped
    // measuring anything and the test above is worthless.
    const coarse = findings(parseLevel(TEST_LEVEL));
    expect(coarse.length).toBeGreaterThan(5);
    expect(Math.max(...coarse.map((f) => f.sag))).toBeGreaterThan(0.05);
  });

  it('gets coarse again if you loosen the tolerance', () => {
    // Proof that the knob is connected to anything: at 5 cm the same arcs
    // compile to geometry its own check would warn about.
    const loose = parseLevel({ ...CURVE_LEVEL, sagTolerance: 0.05 });
    expect(loose.arcSegments).toBeLessThan(level.arcSegments / 2);
    expect(findings({ ...loose, sagTolerance: 0.002 }).length).toBeGreaterThan(0);
  });
});

describe('the arc level drives', () => {
  it('can be completed with throttle-when-grounded and nothing else', () => {
    const r = pilot(level);
    expect(r.outcome).toBe('finished');
    expect(r.applesLeft).toBe(0);
  });

  it('starts settled on the arc surface rather than dropping onto it', () => {
    const sim = createSim(level, DEFAULT_SPEC);
    for (let f = 0; f < 128 * 3; f++) sim.advance(0);
    const s = sim.state;
    expect(s.dead).toBe(false);
    expect(s.grounded).toBe(3);
    expect(Math.abs(s.vx)).toBeLessThan(0.05);
    expect(Math.abs(s.vy)).toBeLessThan(0.05);
  });
});
