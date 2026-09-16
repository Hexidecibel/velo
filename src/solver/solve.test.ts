// End to end: the solver finishes the repo's test level, and the stream it
// produces verifies through the real replay verifier.
//
// That last part is the point. A solver that finds a trajectory the replay
// format cannot express has found nothing — and the only way to know is to put
// the answer through the same `verifyReplay` the leaderboard will one day run
// on a stranger's upload.
import { describe, it, expect } from 'vitest';
import { parseLevel } from '@/sim/level.ts';
import { DEFAULT_SPEC } from '@/sim/spec.ts';
import { createSim } from '@/sim/sim.ts';
import { buildReplay, verifyReplay } from '@/sim/replay.ts';
import { IN_MASK } from '@/sim/consts.ts';
import { TEST_LEVEL } from '@/sim/testlevel.ts';
import { solveLevel } from './solve.ts';

const level = parseLevel(TEST_LEVEL);

describe('solveLevel', () => {
  const r = solveLevel(level, DEFAULT_SPEC, { timeBudgetMs: 120000 });

  it('completes the test level', () => {
    expect(r.solved).toBe(true);
    expect(r.masks.length).toBeGreaterThan(0);
  });

  it('collects every apple, in an order it reports', () => {
    expect([...r.appleOrder].sort((a, b) => a - b)).toEqual(level.apples.map((_, i) => i));
  });

  it('emits only legal input masks', () => {
    for (const m of r.masks) expect(m & ~IN_MASK).toBe(0);
  });

  it('re-simulates from scratch to a finished, living run', () => {
    const sim = createSim(level, DEFAULT_SPEC);
    for (const m of r.masks) sim.advance(m);
    expect(sim.state.finished).toBe(true);
    expect(sim.state.dead).toBe(false);
    expect(sim.state.applesLeft).toBe(0);
  });

  it('produces a replay the verifier accepts', () => {
    const sim = createSim(level, DEFAULT_SPEC);
    const hashes: string[] = [];
    for (let f = 0; f < r.masks.length; f++) {
      sim.advance(r.masks[f]);
      if ((f + 1) % 64 === 0) hashes.push(sim.hash());
    }
    const replay = buildReplay({
      level, spec: DEFAULT_SPEC, masks: r.masks, hashEvery: 64, hashes, state: sim.state,
    });
    const v = verifyReplay(level, DEFAULT_SPEC, replay);
    expect(v.reason).toBeUndefined();
    expect(v.ok).toBe(true);
    expect(v.finished).toBe(true);
  });

  it('reports what the search cost', () => {
    expect(r.totals.expansions).toBeGreaterThan(0);
    expect(r.totals.frames).toBeGreaterThan(r.frames);
    expect(r.segments.length).toBeGreaterThanOrEqual(level.apples.length + 1);
    expect(r.routeMetres).toBeGreaterThan(10);
  });

  it('gives up honestly, with a place, when it has no time at all', () => {
    const none = solveLevel(level, DEFAULT_SPEC, { timeBudgetMs: 1 });
    expect(none.solved).toBe(false);
    expect(none.masks).toEqual([]);
    expect(none.failure).toBeDefined();
  });
});
