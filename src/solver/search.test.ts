// The search, and the one property everything downstream depends on: the mask
// stream reconstructed from a node must reproduce that node's state exactly.
//
// If it does not, the solver finds runs that cannot be replayed, and the failure
// surfaces months later as "the leaderboard rejected my time". `advance(mask)`
// being the only way time moves here is what makes it true; this is the test
// that says so rather than the comment.
import { describe, it, expect } from 'vitest';
import { parseLevel } from '@/sim/level.ts';
import { DEFAULT_SPEC } from '@/sim/spec.ts';
import { createSim } from '@/sim/sim.ts';
import { TEST_LEVEL } from '@/sim/testlevel.ts';
import { IN_FLIP, IN_LEAN_L, IN_LEAN_R, IN_MASK } from '@/sim/consts.ts';
import { Nodes, search, viable, diverseGoals, DEFAULT_SEARCH, HELD_MASKS, FLIP_MASKS, DURATIONS } from './search.ts';
import type { SearchOpts } from './search.ts';
import { buildField, geodesic, distAt } from './field.ts';

const level = parseLevel(TEST_LEVEL);
const spec = DEFAULT_SPEC;

function opts(over: Partial<SearchOpts> & { budget: number }): SearchOpts {
  return { ...DEFAULT_SEARCH, deadline: Date.now() + 30000, ...over };
}

describe('the macro alphabet', () => {
  it('never holds both lean keys, which the sim treats as neither', () => {
    for (const m of [...HELD_MASKS, ...FLIP_MASKS]) {
      expect((m & IN_LEAN_L) !== 0 && (m & IN_LEAN_R) !== 0).toBe(false);
    }
  });

  it('keeps the flip bit out of the held masks, so the edge is never stuck on', () => {
    for (const m of [...HELD_MASKS, ...FLIP_MASKS]) expect(m & IN_FLIP).toBe(0);
  });

  it('has nested durations, so one rollout emits every child', () => {
    for (let i = 1; i < DURATIONS.length; i++) expect(DURATIONS[i]).toBeGreaterThan(DURATIONS[i - 1]);
    expect(DURATIONS[0]).toBeGreaterThanOrEqual(1);
  });
});

describe('search', () => {
  const field = buildField(level, 0.4, 0.3);
  const toApple0 = geodesic(field, level.apples[0].x, level.apples[0].y);
  const h = (s: { px: number; py: number }): number =>
    distAt(field, toApple0, s.px, s.py, level.apples[0].x, level.apples[0].y);

  it('finds the first apple and every mask chain replays to its own state', () => {
    const sim = createSim(level, spec);
    const nodes = new Nodes(level.apples.length);
    nodes.add(sim.state, -1, 0, 0, 0);
    const res = search(sim, nodes, [0], (s) => s.applesTaken[0] !== 0, h, opts({ budget: 20000 }));
    expect(res.found).toBe(true);

    for (const g of res.goals.slice(0, 3)) {
      const masks = nodes.masksTo(g);
      expect(masks.length).toBe(nodes.g[g]);
      for (const m of masks) expect(m & ~IN_MASK).toBe(0);
      const fresh = createSim(level, spec);
      for (const m of masks) fresh.advance(m);
      nodes.pool.load(g, sim.state);
      expect(fresh.hash()).toBe(sim.hash());
      expect(fresh.state.applesTaken[0]).toBe(1);
    }
  });

  it('keeps fast and slow states apart instead of collapsing onto "do nothing"', () => {
    // The recorded failure of the first attempt at this: a position-only dedupe
    // key let a stationary bike dominate the start square forever. With
    // velocity in the key the search must leave the start line.
    const sim = createSim(level, spec);
    const nodes = new Nodes(level.apples.length);
    nodes.add(sim.state, -1, 0, 0, 0);
    search(sim, nodes, [0], () => false, h, opts({ budget: 400 }));
    let far = 0;
    for (let i = 1; i < nodes.size; i++) far = Math.max(far, nodes.pool.at(i, 1) - level.start.x);
    expect(far).toBeGreaterThan(3);
  });

  it('reports what it cost and how close it came when it fails', () => {
    const sim = createSim(level, spec);
    const nodes = new Nodes(level.apples.length);
    nodes.add(sim.state, -1, 0, 0, 0);
    const res = search(sim, nodes, [0], () => false, h, opts({ budget: 150 }));
    expect(res.found).toBe(false);
    expect(res.stats.expansions).toBeGreaterThan(0);
    expect(res.stats.frames).toBeGreaterThan(res.stats.expansions);
    expect(Number.isFinite(res.stats.closest)).toBe(true);
  });

  it('refuses to spend more frames than maxFrames allows', () => {
    const sim = createSim(level, spec);
    const nodes = new Nodes(level.apples.length);
    nodes.add(sim.state, -1, 0, 0, 0);
    search(sim, nodes, [0], () => false, h, opts({ budget: 600, maxFrames: 200 }));
    for (let i = 0; i < nodes.size; i++) expect(nodes.g[i]).toBeLessThanOrEqual(200);
  });
});

describe('viable', () => {
  it('leaves the sim exactly where it found it', () => {
    const sim = createSim(level, spec);
    for (let i = 0; i < 50; i++) sim.advance(1);
    const before = sim.hash();
    viable(sim, 40);
    expect(sim.hash()).toBe(before);
  });

  it('passes a bike standing on the floor and fails one with its head in the ground', () => {
    const sim = createSim(level, spec);
    expect(viable(sim, 60)).toBe(true);
    // Swing the arm straight down. The head is then armLength below a chassis
    // that is resting on the floor, i.e. inside it, and nothing rides that out.
    sim.state.ax = 0;
    sim.state.ay = -1;
    expect(viable(sim, 60)).toBe(false);
  });

  it('is a no-op when disabled', () => {
    const sim = createSim(level, spec);
    sim.state.ax = 0;
    sim.state.ay = -1;
    expect(viable(sim, 0)).toBe(true);
  });
});

describe('diverseGoals', () => {
  it('returns everything when asked for more than it has', () => {
    const nodes = new Nodes(1);
    const sim = createSim(level, spec);
    const ids = [nodes.add(sim.state, -1, 0, 0, 0)];
    expect(diverseGoals(nodes, ids, 4)).toEqual(ids);
  });

  it('always keeps the earliest arrival, then spreads', () => {
    const sim = createSim(level, spec);
    const nodes = new Nodes(level.apples.length);
    const ids: number[] = [];
    for (let i = 0; i < 12; i++) {
      for (let k = 0; k < 8; k++) sim.advance(1);
      ids.push(nodes.add(sim.state, -1, 0, 0, i));
    }
    const picked = diverseGoals(nodes, ids, 4);
    expect(picked.length).toBe(4);
    expect(picked[0]).toBe(ids[0]);
    expect(new Set(picked).size).toBe(4);
  });
});
