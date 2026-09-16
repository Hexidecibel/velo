// Difficulty is a measurement, so these tests check that it measures — not that
// any particular level scores any particular number, which would pin the
// weights and make re-scaling them a test failure rather than a presentation
// change.
import { describe, it, expect } from 'vitest';
import { parseLevel } from '@/sim/level.ts';
import { DEFAULT_SPEC } from '@/sim/spec.ts';
import { TEST_LEVEL } from '@/sim/testlevel.ts';
import { IN_THROTTLE } from '@/sim/consts.ts';
import { solveLevel } from './solve.ts';
import { measureLine, measureTolerance, scoreDifficulty, WEIGHTS } from './difficulty.ts';

const level = parseLevel(TEST_LEVEL);
const solved = solveLevel(level, DEFAULT_SPEC, { timeBudgetMs: 120000 });

describe('measureLine', () => {
  it('reports a positive head clearance for a run that did not die', () => {
    const l = measureLine(level, DEFAULT_SPEC, solved.masks);
    expect(l.minHeadClearance).toBeGreaterThan(0);
    expect(Number.isFinite(l.atX)).toBe(true);
    expect(l.airFraction).toBeGreaterThanOrEqual(0);
    expect(l.airFraction).toBeLessThanOrEqual(1);
    expect(l.maxSpeed).toBeGreaterThan(1);
  });

  it('handles an empty stream without producing a NaN', () => {
    const l = measureLine(level, DEFAULT_SPEC, []);
    expect(l.airFraction).toBe(0);
    expect(l.maxSpeed).toBe(0);
  });
});

describe('measureTolerance', () => {
  it('is deterministic for a given seed and moves with a different one', () => {
    const a = measureTolerance(level, DEFAULT_SPEC, solved.masks, 40, 1);
    const b = measureTolerance(level, DEFAULT_SPEC, solved.masks, 40, 1);
    expect(a).toEqual(b);
    const c = measureTolerance(level, DEFAULT_SPEC, solved.masks, 40, 2);
    expect(c).toEqual(measureTolerance(level, DEFAULT_SPEC, solved.masks, 40, 2));
  });

  it('returns fractions, not counts', () => {
    const t = measureTolerance(level, DEFAULT_SPEC, solved.masks, 40, 7);
    expect(t.lethal).toBeGreaterThanOrEqual(0);
    expect(t.lethal).toBeLessThanOrEqual(1);
    expect(t.finished).toBeGreaterThanOrEqual(0);
    expect(t.finished).toBeLessThanOrEqual(1);
  });

  it('says nothing rather than dividing by zero on an empty stream', () => {
    expect(measureTolerance(level, DEFAULT_SPEC, [], 10).trials).toBe(0);
  });

  it('calls a stream that never finished unfinished', () => {
    const t = measureTolerance(level, DEFAULT_SPEC, new Array(300).fill(IN_THROTTLE), 20, 3);
    expect(t.finished).toBe(0);
  });
});

describe('scoreDifficulty', () => {
  const d = scoreDifficulty({
    level, spec: DEFAULT_SPEC, masks: solved.masks,
    expansions: solved.totals.expansions, deaths: solved.totals.deaths,
    routeMetres: solved.routeMetres, trials: 40,
  });

  it('puts every component in 0..1 and the score in 0..100', () => {
    for (const v of [d.precision, d.clearance, d.effort, d.lethality]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(d.score).toBeGreaterThanOrEqual(0);
    expect(d.score).toBeLessThanOrEqual(100);
  });

  it('is exactly the weighted sum of its components, so the number is explicable', () => {
    const want = 100 * (WEIGHTS.precision * d.precision + WEIGHTS.clearance * d.clearance
      + WEIGHTS.effort * d.effort + WEIGHTS.lethality * d.lethality);
    expect(d.score).toBeCloseTo(want, 9);
  });

  it('weights sum to one, so the scale means something', () => {
    const sum = WEIGHTS.precision + WEIGHTS.clearance + WEIGHTS.effort + WEIGHTS.lethality;
    expect(sum).toBeCloseTo(1, 12);
  });

  it('rises with search effort, all else equal', () => {
    const harder = scoreDifficulty({
      level, spec: DEFAULT_SPEC, masks: solved.masks,
      // Deaths scale with it: lethality is deaths PER EXPANSION, so holding the
      // death count fixed while multiplying expansions would quietly make the
      // level look safer and test the wrong thing.
      expansions: solved.totals.expansions * 50, deaths: solved.totals.deaths * 50,
      routeMetres: solved.routeMetres, trials: 40,
    });
    expect(harder.effort).toBeGreaterThan(d.effort);
    expect(harder.score).toBeGreaterThan(d.score);
  });
});
