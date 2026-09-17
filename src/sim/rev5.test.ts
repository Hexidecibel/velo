// SIM_REV 5: the rider's linear reaction on the pivot.
//
// Two claims are worth testing and only one of them is about pumping.
//
// The first is the migration claim, and it is what this file exists for: with
// `rider.inertialTransferLinear` at 0, rev 5 is not "close to" rev 4, it IS rev
// 4 — every float, every tick. That property is what makes the new term a lever
// rather than a new bike, exactly as the rev-2-to-3 damping split and the
// rev-3-to-4 inertial split were, and both of those asserted it in a comment.
// This one asserts it against the actual doubles, over real runs on real levels
// out of `replays/` rather than over a bike doing donuts on the test level.
//
// The second is that the term does something a rev-4 bike structurally cannot:
// let a rider input change the machine's LINEAR momentum. On rev 4 the rider's
// 35 kg is welded to the chassis origin, so moving the arm cannot move the
// centre of mass — which is the whole reason pumping was impossible, and the
// reason it is worth proving the floor has moved before measuring how far.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { getEngine } from './rev.ts';
import { parseReplayFile, decodeInputs } from './replay.ts';
import { DEFAULT_SPEC, cloneSpec } from './spec.ts';
import type { BikeSpec } from './spec.ts';
import { TEST_LEVEL } from './testlevel.ts';
import { IN_BRAKE, IN_FLIP, IN_LEAN_L, IN_LEAN_R, IN_THROTTLE } from './consts.ts';
import type { SimState } from './step.ts';

const REV4 = getEngine(4);
const REV5 = getEngine(5);
const REPLAY_DIR = fileURLToPath(new URL('../../replays/', import.meta.url));

/** Rev 5 needs the extra field; a rev-4 spec would not parse. */
function onRev5(base: BikeSpec, linear: number): unknown {
  return { ...base, rider: { ...base.rider, inertialTransferLinear: linear } };
}

/** Every float in the state, in a fixed order, for an exact comparison. */
function floats(s: SimState): number[] {
  const out = [s.px, s.py, s.vx, s.vy, s.ox, s.oy, s.w, s.ax, s.ay, s.aw];
  for (let i = 0; i < 2; i++) out.push(s.wx[i], s.wy[i], s.wvx[i], s.wvy[i], s.wspin[i]);
  return out;
}

describe('rev 5 at zero is rev 4', () => {
  // Real runs: a jump level and a long technical one, both ridden by the solver
  // on the shipped bike. Thousands of frames of contact, air, brake and flip —
  // which is the coverage a hand-written input stream on the test level cannot
  // buy, because the test level is 70 m of box and the plan-default bike
  // backflips into it inside 250 frames and then the state is frozen and every
  // comparison after it is vacuous.
  for (const name of ['05-airtime.solve.replay.json', '14-kicker.solve.replay.json']) {
    it(`${name}: every double identical, end to end`, () => {
      const file = parseReplayFile(JSON.parse(readFileSync(REPLAY_DIR + name, 'utf8')));
      expect(file.simRev).toBe(4);

      const level4 = REV4.parseLevel(file.level);
      const level5 = REV5.parseLevel(file.level);
      expect(level5.simHash).toBe(level4.simHash);

      const spec4 = REV4.parseSpec(file.spec);
      const sim4 = REV4.createSim(level4, spec4);
      const sim5 = REV5.createSim(level5, REV5.parseSpec(onRev5(spec4, 0)));

      const masks = decodeInputs(file.inputs);
      expect(masks.length).toBeGreaterThan(1000);

      for (let f = 0; f < masks.length; f++) {
        sim4.advance(masks[f]);
        sim5.advance(masks[f]);
        if ((f + 1) % 64 !== 0 && f !== masks.length - 1) continue;
        const a = floats(sim4.state);
        const b = floats(sim5.state);
        for (let i = 0; i < a.length; i++) {
          // Object.is, not a tolerance: the claim is bit-identity. Two runs that
          // agree to 1e-15 at frame 400 are a visibly different line by frame
          // 5000, because a bike bouncing off geometry is chaotic — which is the
          // whole reason a rev is a rev and not a patch.
          expect(Object.is(a[i], b[i]), `frame ${f}, float ${i}: ${a[i]} vs ${b[i]}`).toBe(true);
        }
      }
      // ...and the run has to be the real one, or this is two bikes agreeing
      // about a crash on the start line.
      expect(sim4.state.finished).toBe(true);
      expect(sim5.state.finished).toBe(true);
      expect(sim5.elapsedTicks()).toBe(file.timeTicks);
    });
  }

  it('is a different bike the moment the coefficient is not zero', () => {
    const file = parseReplayFile(JSON.parse(readFileSync(REPLAY_DIR + '05-airtime.solve.replay.json', 'utf8')));
    const level = REV5.parseLevel(file.level);
    const base = REV4.parseSpec(file.spec);
    const zero = REV5.createSim(level, REV5.parseSpec(onRev5(base, 0)));
    const live = REV5.createSim(level, REV5.parseSpec(onRev5(base, 0.5)));
    for (const m of decodeInputs(file.inputs).slice(0, 600)) {
      zero.advance(m);
      live.advance(m);
    }
    expect(live.hash()).not.toBe(zero.hash());
    // ...and the spec identity has to move with it, or a leaderboard cannot
    // tell the two bikes apart and a tuned coefficient becomes a cheat.
    expect(live.specHash).not.toBe(zero.specHash);
  });
});

describe('rev 5 lets the rider move the bike', () => {
  const base = cloneSpec(DEFAULT_SPEC);

  /**
   * Hang the bike 8 m up in the test level's cave — which is clear from about
   * 0.5 m to 13 m, so a run of this length neither lands nor puts the head into
   * the roof — run an input stream, and report the whole machine's
   * centre-of-mass velocity.
   *
   * Everything in here is a closed system except gravity: the servo's torque is
   * applied to the arm and subtracted from the chassis, `attitudeTorque` and the
   * two weight-transfer terms are TORQUES and so move no momentum at all, and
   * the suspension is an internal force pair. So with no contact, the only thing
   * that may change the total linear momentum is gravity — which is identical
   * between two runs of the same length and cancels when they are compared.
   */
  function freeFlight(
    engine: typeof REV4,
    spec: unknown,
    masks: number[],
  ): { vx: number; vy: number; comX: number; touched: boolean } {
    const level = engine.parseLevel(TEST_LEVEL);
    const parsed = engine.parseSpec(spec);
    const sim = engine.createSim(level, parsed);
    const lift = 8;
    sim.state.py += lift;
    sim.state.wy[0] += lift;
    sim.state.wy[1] += lift;
    let touched = false;
    for (const m of masks) {
      sim.advance(m);
      if (sim.state.grounded !== 0 || sim.state.dead) touched = true;
    }
    const s = sim.state;
    // The chassis body already carries the rider's mass (world.ts folds it in),
    // so the system momentum is that lump, plus the rider's motion RELATIVE to
    // the pivot, plus the two wheels — which are separate bodies on springs and
    // carry real momentum of their own.
    const mc = parsed.chassis.mass + parsed.rider.mass;
    const mw = parsed.wheel.mass;
    const total = mc + 2 * mw;
    // d(u)/dt = aw * perp(u), so the rider's velocity relative to the pivot is
    // L * aw * (-ay, ax).
    const relx = parsed.rider.armLength * s.aw * -s.ay;
    const px = mc * s.vx + parsed.rider.mass * relx + mw * (s.wvx[0] + s.wvx[1]);
    return { vx: s.vx, vy: s.vy, comX: px / total, touched };
  }

  // Out one way, back the other. 60 frames is just under half a second.
  const swing: number[] = [];
  for (let f = 0; f < 60; f++) swing.push(f < 30 ? IN_LEAN_L : IN_LEAN_R);
  const still: number[] = new Array(60).fill(0);
  // Out, back, and long enough afterwards for the servo to bring the arm to
  // rest — a cycle that has not closed proves nothing about conservation.
  const cycle: number[] = [];
  for (let f = 0; f < 120; f++) cycle.push(f < 40 ? IN_LEAN_L : f < 80 ? IN_LEAN_R : 0);

  it('rev 4: the chassis barely notices the rider swinging', () => {
    const a = freeFlight(REV4, base, swing);
    const b = freeFlight(REV4, base, still);
    expect(a.touched).toBe(false);
    // Not exactly zero, and the residue is honest: leaning rotates the chassis,
    // rotating the chassis drags the suspension anchors, and the wheels push
    // back. What the rider's own 35 kg contributes is nothing at all.
    expect(Math.abs(a.vx - b.vx)).toBeLessThan(0.05);
  });

  it('rev 5: the same swing moves it by an order of magnitude more', () => {
    const r4 = freeFlight(REV4, base, swing);
    const r4still = freeFlight(REV4, base, still);
    const r5 = freeFlight(REV5, onRev5(base, 1), swing);
    const r5still = freeFlight(REV5, onRev5(base, 1), still);
    expect(r5.touched).toBe(false);
    const moved4 = Math.abs(r4.vx - r4still.vx);
    const moved5 = Math.abs(r5.vx - r5still.vx);
    expect(moved5).toBeGreaterThan(10 * moved4);
    expect(moved5).toBeGreaterThan(0.2);
  });

  it('rev 5 is momentum-conserving in free flight, not a thruster', () => {
    // The property that makes pumping a TIMING skill rather than mashing: with
    // no ground to push against, whatever the rider borrows from the machine he
    // gives back. If this failed, the term would be free energy and a player
    // would climb by waggling in mid-air.
    const moved = freeFlight(REV5, onRev5(base, 1), cycle);
    const idle = freeFlight(REV5, onRev5(base, 1), new Array(cycle.length).fill(0));
    expect(moved.touched).toBe(false);
    expect(idle.touched).toBe(false);
    // The chassis alone HAS moved — that is the point of the previous test —
    // while the centre of mass has not. Stated as a RATIO rather than an
    // absolute, because conservation here is not exact and should not be
    // claimed to be: `damping.linear` bleeds 0.02/s off every velocity in the
    // sim, which is a genuine momentum sink and does not cancel between two
    // runs whose velocities differ. What has to hold is that the residue is
    // small against the thing being measured.
    const comMoved = Math.abs(moved.comX - idle.comX);
    const chassisMoved = Math.abs(moved.vx - idle.vx);
    expect(chassisMoved).toBeGreaterThan(0.15);
    expect(comMoved).toBeLessThan(0.2 * chassisMoved);
  });
});

describe('the two revs do not accept each other\'s replays', () => {
  // The fork, both ways round. A rev-5 run must verify on rev 5 and be REFUSED
  // on rev 4 — not silently re-simulated under different physics, which would
  // make the whole versioning scheme decorative. The refusal is by rev number
  // and does not depend on the spec, because a spec that happens to match is
  // still a different engine.
  const base = cloneSpec(DEFAULT_SPEC);

  it('a rev-5 replay verifies on rev 5 and is refused by rev 4', () => {
    const level = REV5.parseLevel(TEST_LEVEL);
    const spec = REV5.parseSpec(onRev5(base, 1));
    const masks: number[] = [];
    for (let f = 0; f < 400; f++) masks.push(f % 5 < 3 ? IN_THROTTLE : IN_LEAN_L);

    const sim = REV5.createSim(level, spec);
    const hashes: string[] = [];
    for (let f = 0; f < masks.length; f++) {
      sim.advance(masks[f]);
      if ((f + 1) % 64 === 0) hashes.push(sim.hash());
    }
    const replay = REV5.buildReplay({ level, spec, masks, hashEvery: 64, hashes, state: sim.state });
    expect(replay.simRev).toBe(5);

    const good = REV5.verifyReplay(level, spec, replay);
    expect(good.ok, good.reason ?? '').toBe(true);

    const bad = REV4.verifyReplay(REV4.parseLevel(TEST_LEVEL), base, replay);
    expect(bad.ok).toBe(false);
    expect(bad.reason).toMatch(/sim rev 5/);
  });
});

describe('rev 5 runtime purity', () => {
  // purity.test.ts's SOURCE scan already reads every file in every rev
  // directory, which catches a banned call on a code path no test reaches. It
  // cannot catch an aliased or computed one — `Math['s' + 'in']` — and rev 5 is
  // new arithmetic in a file nobody has run under the trap. So: trap everything
  // on Math that ECMA-262 leaves implementation-approximated, plus the clocks,
  // and drive the new term hard enough to reach it.
  const ALLOWED = new Set(['sqrt', 'abs', 'min', 'max', 'floor', 'ceil', 'round', 'trunc', 'sign', 'imul']);

  it('runs the new term with every implementation-approximated Math.* trapped', () => {
    const level = REV5.parseLevel(TEST_LEVEL);
    const spec = REV5.parseSpec(onRev5(cloneSpec(DEFAULT_SPEC), 1));

    const masks: number[] = [];
    for (let f = 0; f < 800; f++) {
      let m = 0;
      if (f % 7 < 4) m |= IN_THROTTLE;
      if (f % 23 === 0) m |= IN_BRAKE;
      if (f % 11 < 3) m |= IN_LEAN_L;
      if (f % 17 < 3) m |= IN_LEAN_R;
      if (f % 53 === 0) m |= IN_FLIP;
      masks.push(m);
    }

    const saved = new Map<string, PropertyDescriptor>();
    const tripped: string[] = [];
    const trap = (name: string) => () => {
      tripped.push(name);
      throw new Error(`rev 5 called banned ${name}`);
    };
    const banned = Object.getOwnPropertyNames(Math).filter(
      (k) => typeof (Math as unknown as Record<string, unknown>)[k] === 'function' && !ALLOWED.has(k),
    );
    const origDateNow = Date.now;
    try {
      for (const k of banned) {
        const d = Object.getOwnPropertyDescriptor(Math, k);
        if (d) saved.set(k, d);
        Object.defineProperty(Math, k, { value: trap(`Math.${k}`), configurable: true, writable: true });
      }
      Date.now = trap('Date.now') as typeof Date.now;

      const sim = REV5.createSim(level, spec);
      const hashes: string[] = [];
      for (let f = 0; f < masks.length; f++) {
        sim.advance(masks[f]);
        if ((f + 1) % 64 === 0) hashes.push(sim.hash());
      }
      const replay = REV5.buildReplay({ level, spec, masks, hashEvery: 64, hashes, state: sim.state });
      expect(replay.simRev).toBe(5);
      const res = REV5.verifyReplay(level, spec, replay);
      expect(res.ok, res.reason ?? '').toBe(true);
    } finally {
      for (const [k, d] of saved) Object.defineProperty(Math, k, d);
      Date.now = origDateNow;
    }
    expect(tripped).toEqual([]);
  });
});
