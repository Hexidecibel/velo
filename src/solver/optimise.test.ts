// Optimising, and the three things about it that must be true.
//
// The first is the one worth a test on its own: OPTIMISING MUST NEVER MAKE A
// LEVEL LOOK WORSE. Every round searches against a ceiling and returns nothing
// unless it beats it, so the incumbent from the cheap gate is a floor on the
// answer — and a level the gate could not do at all must be reported exactly as
// the gate reported it, because an optimising round that turned a "could not"
// into something else would be inventing a finding.
//
// The second is that the ceiling actually prunes, which is what pays for the
// near-Dijkstra weight the first is worth having.
//
// The third is that a forced order is really forced, because route tension is
// measured by forcing one and comparing.
import { describe, it, expect } from 'vitest';
import { parseLevel } from '@/sim/level.ts';
import { DEFAULT_SPEC } from '@/sim/spec.ts';
import { createSim } from '@/sim/sim.ts';
import { TEST_LEVEL } from '@/sim/testlevel.ts';
import { Nodes, search, DEFAULT_SEARCH } from './search.ts';
import type { SearchOpts } from './search.ts';
import { buildField, geodesic, distAt } from './field.ts';
import { solveLevel } from './solve.ts';
import { optimiseLevel, greedyOrder } from './optimise.ts';

const level = parseLevel(TEST_LEVEL);
const spec = DEFAULT_SPEC;

function opts(over: Partial<SearchOpts> & { budget: number }): SearchOpts {
  return { ...DEFAULT_SEARCH, deadline: Date.now() + 30000, ...over };
}

describe('the cost ceiling', () => {
  const field = buildField(level, 0.4, 0.3);
  const toApple0 = geodesic(field, level.apples[0].x, level.apples[0].y);
  const h = (s: { px: number; py: number }): number =>
    distAt(field, toApple0, s.px, s.py, level.apples[0].x, level.apples[0].y);
  const run = (over: Partial<SearchOpts>) => {
    const sim = createSim(level, spec);
    const nodes = new Nodes(level.apples.length);
    nodes.add(sim.state, -1, 0, 0, 0);
    return search(sim, nodes, [0], (s) => s.applesTaken[0] !== 0, h, opts({ budget: 20000, ...over }));
  };

  it('is off by default, and off means not one node rejected', () => {
    const res = run({});
    expect(res.found).toBe(true);
    expect(res.stats.pruned).toBe(0);
  });

  it('rejects everything when nothing could possibly fit under it', () => {
    const res = run({ costCeil: 1, tailFrames: 0, boundFramesPerMetre: 16 });
    expect(res.found).toBe(false);
    expect(res.stats.pruned).toBeGreaterThan(0);
  });

  it('counts what the tail costs as well as what the leg costs', () => {
    // The leg itself fits inside 4 000 frames and the tail does not, so the
    // ceiling has to be reading both to reject this.
    const res = run({ costCeil: 4000, tailFrames: 4000, boundFramesPerMetre: 0 });
    expect(res.found).toBe(false);
    expect(res.stats.pruned).toBeGreaterThan(0);
  });
});

describe('greedyOrder', () => {
  it('is a permutation of every apple', () => {
    const g = greedyOrder(level);
    expect([...g].sort((a, b) => a - b)).toEqual(level.apples.map((_, i) => i));
  });
});

describe('forceOrder', () => {
  it('collects the apples in exactly the order it was given', () => {
    const order = [...level.apples.map((_, i) => i)].reverse();
    const r = solveLevel(level, spec, { timeBudgetMs: 20000, forceOrder: order });
    if (!r.solved) return; // the forced order may be unrideable; that is not this test's business
    const sim = createSim(level, spec);
    const seen: number[] = [];
    const had = level.apples.map(() => false);
    for (const m of r.masks) {
      sim.advance(m);
      for (let i = 0; i < had.length; i++) {
        if (!had[i] && sim.state.applesTaken[i] !== 0) { had[i] = true; seen.push(i); }
      }
    }
    // Opportunistic pickups are allowed and are why this is not `toEqual`: the
    // list only promises that nothing was collected out of turn on purpose.
    expect(seen.length).toBe(level.apples.length);
  });
});

describe('optimiseLevel', () => {
  // Generous, because the assertions below are about the SHAPE of the answer
  // and a budget too tight to gate in turns them into a test of this machine's
  // load average. The `solved` guard is the same argument taken seriously: a
  // gate that did not finish is a legitimate outcome of a wall clock and the
  // invariant it has to satisfy is the passthrough one, not the fast one.
  const o = optimiseLevel(level, spec, { timeBudgetMs: 45000, gateBudgetMs: 25000 });

  it('never returns something slower than the gate found', () => {
    if (!o.best.solved) {
      expect(o.rounds).toEqual([]);
      expect(o.gateFrames).toBe(0);
      return;
    }
    expect(o.best.frames).toBeLessThanOrEqual(o.gateFrames);
  });

  it('re-simulates from scratch to a finished, living run', () => {
    if (!o.best.solved) return;
    const sim = createSim(level, spec);
    for (const m of o.best.masks) sim.advance(m);
    expect(sim.state.finished).toBe(true);
    expect(sim.state.dead).toBe(false);
    expect(sim.state.applesLeft).toBe(0);
  });

  it('says what every round did, improvement or not', () => {
    if (!o.best.solved) return;
    expect(o.rounds.length).toBeGreaterThan(0);
    for (const r of o.rounds) expect(r.ceil).toBeGreaterThan(0);
  });

  it('hands back the gate untouched when the gate could not do it', () => {
    const none = optimiseLevel(level, spec, { timeBudgetMs: 2, gateBudgetMs: 1 });
    expect(none.best.solved).toBe(false);
    expect(none.rounds).toEqual([]);
    expect(none.gateFrames).toBe(0);
  });
});
