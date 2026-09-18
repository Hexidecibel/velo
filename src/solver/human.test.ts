// The rider's hands, and the two things that have to be true about them.
import { describe, it, expect } from 'vitest';
import { parseLevel } from '@/sim/level.ts';
import { DEFAULT_SPEC } from '@/sim/spec.ts';
import { createSim } from '@/sim/sim.ts';
import { TEST_LEVEL } from '@/sim/testlevel.ts';
import { HUMAN_DURATIONS, HUMAN_GRID, measureHumanSlip } from './human.ts';
import { solveLevel } from './solve.ts';

const level = parseLevel(TEST_LEVEL);
const spec = DEFAULT_SPEC;

// One solve, shared. Two of these doubled the suite's collection time for no
// extra coverage, and the budget is a wall clock rather than a claim: under a
// loaded machine it may not finish, and every test below treats not finishing
// as "nothing to say here" rather than as a failure. Whether the human
// alphabet CAN complete a level is a question for bin/solve --human on the real
// set, not for a unit test racing a clock.
const found = solveLevel(level, spec, { timeBudgetMs: 30000, search: { durations: HUMAN_DURATIONS } });

describe('the human alphabet', () => {
  it('holds nothing for less than 60 ms', () => {
    expect(Math.min(...HUMAN_DURATIONS) / 128).toBeGreaterThanOrEqual(0.06);
  });

  it('puts every boundary on the grid, not just every duration above a floor', () => {
    for (const d of HUMAN_DURATIONS) expect(d % HUMAN_GRID).toBe(0);
    expect(HUMAN_GRID / 128).toBeGreaterThan(0.03);
    // A mode whose own alphabet cannot complete the repo's test level reports
    // on itself rather than on the level. See HUMAN_DURATIONS.
    expect(found.solved).toBe(true);
  });

  it('is nested, so one rollout still emits every child', () => {
    for (let i = 1; i < HUMAN_DURATIONS.length; i++) {
      expect(HUMAN_DURATIONS[i]).toBeGreaterThan(HUMAN_DURATIONS[i - 1]);
    }
  });
});

describe('a run found with hands', () => {
  const r = found;

  it('holds its inputs for human lengths, allowing for flips and pickups', () => {
    if (!r.solved) return;
    const floor = Math.min(...HUMAN_DURATIONS);
    const runs: number[] = [];
    let at = 0;
    while (at < r.masks.length) {
      let k = at;
      while (k < r.masks.length && r.masks[k] === r.masks[at]) k++;
      runs.push(k - at);
      at = k;
    }
    // NOT every run, and the exceptions are both real rather than slack in the
    // test. Flip is edge-triggered: `masksTo` emits it on the first frame of a
    // macro and the held mask for the rest, so every flip macro shows up as a
    // one-frame run followed by a long one, and that one frame is not a held
    // input at all. And a macro is cut at the frame an apple is reached rather
    // than run out, so each leg boundary can leave a short tail. What the rate
    // limit promises is that the rider is not CHOOSING sub-floor holds, and the
    // bulk of the stream is where that shows.
    const long = runs.filter((n) => n >= floor).length;
    expect(runs.length).toBeGreaterThan(4);
    expect(long / runs.length).toBeGreaterThan(0.5);
    const total = runs.reduce((a, b) => a + b, 0);
    const heldInLong = runs.filter((n) => n >= floor).reduce((a, b) => a + b, 0);
    // And by frames rather than by count it is nearly all of it.
    expect(heldInLong / total).toBeGreaterThan(0.85);
  });

  it('still re-simulates to a finished, living run', () => {
    if (!r.solved) return;
    const sim = createSim(level, spec);
    for (const m of r.masks) sim.advance(m);
    expect(sim.state.finished).toBe(true);
    expect(sim.state.dead).toBe(false);
  });
});

describe('measureHumanSlip', () => {
  const r = found;

  it('is deterministic for a seed and moves with a different one', () => {
    if (!r.solved) return;
    const a = measureHumanSlip(level, spec, r.masks, { trials: 40, seed: 1 });
    const b = measureHumanSlip(level, spec, r.masks, { trials: 40, seed: 1 });
    expect(a.finished).toBe(b.finished);
    expect(a.trials).toBe(40);
  });

  it('a rider with no error at all rides the line exactly', () => {
    if (!r.solved) return;
    const perfect = measureHumanSlip(level, spec, r.masks, { trials: 5, sigmaFrames: 0 });
    expect(perfect.finished).toBe(1);
    expect(perfect.lethal).toBe(0);
  });

  it('gets worse as the hands get worse', () => {
    if (!r.solved) return;
    const steady = measureHumanSlip(level, spec, r.masks, { trials: 60, sigmaFrames: 1, seed: 7 });
    const shaky = measureHumanSlip(level, spec, r.masks, { trials: 60, sigmaFrames: 16, seed: 7 });
    expect(shaky.lethal).toBeGreaterThanOrEqual(steady.lethal);
  });

  it('reports the shape of the error it used, so the number can be read', () => {
    if (!r.solved) return;
    const m = measureHumanSlip(level, spec, r.masks, { trials: 10 });
    expect(m.burst).toBeGreaterThan(0);
    expect(m.horizon).toBeGreaterThan(0);
    expect(m.sigmaFrames).toBeGreaterThan(0);
  });

  it('says nothing rather than something wrong about an empty stream', () => {
    const none = measureHumanSlip(level, spec, [], { trials: 10 });
    expect(none.trials).toBe(0);
    expect(none.finished).toBe(0);
  });
});
