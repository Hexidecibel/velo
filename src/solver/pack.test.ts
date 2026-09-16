// The drift guard for the packed state layout.
//
// pack.ts lives outside src/sim on purpose — the physics is frozen at SIM_REV 4
// and a search is not a reason to reach into it — and the price of that is a
// second copy of the knowledge of what a SimState contains. This file is what
// makes that price safe to pay: add a field to SimState and the first test
// below fails by name, rather than the field being silently dropped from every
// node in the search and the solver quietly solving a slightly different game.
import { describe, it, expect } from 'vitest';
import { parseLevel } from '@/sim/level.ts';
import { DEFAULT_SPEC } from '@/sim/spec.ts';
import { createWorld } from '@/sim/world.ts';
import { createState } from '@/sim/step.ts';
import { createSim } from '@/sim/sim.ts';
import { TEST_LEVEL } from '@/sim/testlevel.ts';
import { IN_THROTTLE, IN_LEAN_L, IN_FLIP } from '@/sim/consts.ts';
import { SCALAR_FIELDS, PAIR_FIELDS, BOOL_FIELDS, ARRAY_FIELDS, stateFloats, StatePool } from './pack.ts';

const level = parseLevel(TEST_LEVEL);

describe('packed state layout', () => {
  it('covers exactly the fields SimState has', () => {
    const world = createWorld(level, DEFAULT_SPEC);
    const known = new Set<string>([...SCALAR_FIELDS, ...PAIR_FIELDS, ...BOOL_FIELDS, ...ARRAY_FIELDS]);
    const actual = new Set(Object.keys(createState(world)));
    const missing = [...actual].filter((k) => !known.has(k));
    const stale = [...known].filter((k) => !actual.has(k));
    expect({ missing, stale }).toEqual({ missing: [], stale: [] });
  });

  it('sizes itself from the apple count', () => {
    expect(stateFloats(0)).toBe(SCALAR_FIELDS.length + PAIR_FIELDS.length * 2 + BOOL_FIELDS.length);
    expect(stateFloats(7) - stateFloats(0)).toBe(7);
  });
});

describe('StatePool', () => {
  it('round-trips a stepped state bit-exactly', () => {
    const sim = createSim(level, DEFAULT_SPEC);
    const pool = new StatePool(level.apples.length, 8);
    const want: string[] = [];
    const ids: number[] = [];
    for (let i = 0; i < 40; i++) {
      sim.advance(i % 7 === 0 ? IN_THROTTLE | IN_LEAN_L : IN_THROTTLE);
      ids.push(pool.push(sim.state));
      want.push(sim.hash());
    }
    // Backwards, so a pool that only ever returns the most recent chunk fails.
    for (let i = ids.length - 1; i >= 0; i--) {
      pool.load(ids[i], sim.state);
      expect(sim.hash()).toBe(want[i]);
    }
  });

  it('restores a state the sim can be stepped on from', () => {
    const a = createSim(level, DEFAULT_SPEC);
    const pool = new StatePool(level.apples.length);
    for (let i = 0; i < 30; i++) a.advance(IN_THROTTLE);
    const id = pool.push(a.state);
    for (let i = 0; i < 30; i++) a.advance(IN_LEAN_L);
    const straight = a.hash();

    const b = createSim(level, DEFAULT_SPEC);
    pool.load(id, b.state);
    for (let i = 0; i < 30; i++) b.advance(IN_LEAN_L);
    expect(b.hash()).toBe(straight);
  });

  it('carries prevMask, so a flip restored mid-edge does not re-trigger', () => {
    const sim = createSim(level, DEFAULT_SPEC);
    sim.advance(IN_FLIP);
    const pool = new StatePool(level.apples.length);
    const id = pool.push(sim.state);
    const facing = sim.state.facing;
    pool.load(id, sim.state);
    // Holding flip must NOT flip again: the edge was already consumed, and
    // prevMask is how the sim knows that.
    sim.advance(IN_FLIP);
    expect(sim.state.facing).toBe(facing);
  });

  it('reports the memory it is holding', () => {
    const pool = new StatePool(3, 16);
    expect(pool.bytes).toBe(0);
    const sim = createSim(level, DEFAULT_SPEC);
    for (let i = 0; i < 17; i++) pool.push(sim.state);
    expect(pool.bytes).toBe(2 * 16 * stateFloats(3) * 8);
  });
});
