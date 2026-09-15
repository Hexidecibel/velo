import { describe, it, expect } from 'vitest';
import { parseLevel } from './level.ts';
import { createSim } from './sim.ts';
import { DEFAULT_SPEC, cloneSpec } from './spec.ts';
import { TEST_LEVEL } from './testlevel.ts';
import { IN_FLIP, IN_LEAN_L, IN_THROTTLE, TICKS_PER_FRAME } from './consts.ts';

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
