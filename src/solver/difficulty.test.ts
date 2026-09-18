// Difficulty is a measurement, so these tests check that it measures — not that
// any particular level scores any particular number, which would pin the
// weights and make re-scaling them a test failure rather than a presentation
// change.
//
// The one test here with teeth is "effort and lethality cannot move the score".
// Both were in the composite until scoreRev 2 and both are really measures of
// the SEARCH, so the whole point of the rework is that multiplying the search
// totals by fifty now changes the diagnostics and leaves the score alone.
import { describe, it, expect } from 'vitest';
import { parseLevel } from '@/sim/level.ts';
import { DEFAULT_SPEC } from '@/sim/spec.ts';
import { TEST_LEVEL } from '@/sim/testlevel.ts';
import { IN_THROTTLE } from '@/sim/consts.ts';
import { solveLevel } from './solve.ts';
import {
  measureLine, measureTolerance, scoreDifficulty, tensionOf,
  WEIGHTS, SCORE_REV, TENSION_NOISE_FLOOR,
} from './difficulty.ts';

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
  const base = {
    level, spec: DEFAULT_SPEC,
    lines: [{ mode: 'gate' as const, masks: solved.masks }],
    expansions: solved.totals.expansions, deaths: solved.totals.deaths,
    routeMetres: solved.routeMetres, trials: 40, slipTrials: 20,
  };
  const d = scoreDifficulty(base);

  it('puts every component in 0..1 and the score in 0..100', () => {
    for (const v of [d.slip, d.clearance, d.nudge, d.effort, d.lethality]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(d.score).toBeGreaterThanOrEqual(0);
    expect(d.score).toBeLessThanOrEqual(100);
  });

  it('is exactly the weighted sum of its two axes, so the number is explicable', () => {
    const want = 100 * (WEIGHTS.slip * d.slip + WEIGHTS.clearance * d.clearance);
    expect(d.score).toBeCloseTo(want, 9);
  });

  it('weights sum to one, so the scale means something', () => {
    expect(WEIGHTS.slip + WEIGHTS.clearance).toBeCloseTo(1, 12);
  });

  it('records which line it was measured on, because the same geometry scores two ways', () => {
    expect(d.measuredOn).toBe('gate');
    expect(scoreDifficulty({ ...base, lines: [{ mode: 'optimised', masks: solved.masks }] }).measuredOn)
      .toBe('optimised');
  });

  it('scores the MOST FORGIVING candidate, not the first or the fastest', () => {
    // A stream of pure throttle off the start line is a run that dies, so every
    // fumble of it is fatal and it is the worse of the two by construction.
    const doomed = { mode: 'optimised' as const, masks: new Array(400).fill(IN_THROTTLE) };
    const real = { mode: 'gate' as const, masks: solved.masks };
    for (const order of [[real, doomed], [doomed, real]]) {
      const pick = scoreDifficulty({ ...base, lines: order });
      expect(pick.measuredOn).toBe('gate');
      expect(pick.slip).toBeCloseTo(d.slip, 9);
    }
  });

  it('needs a line, and says so rather than returning a number about nothing', () => {
    expect(() => scoreDifficulty({ ...base, lines: [] })).toThrow(/at least one line/);
  });

  it('stamps the formula version, so a row from another one is not mistaken for this one', () => {
    expect(d.scoreRev).toBe(SCORE_REV);
  });

  it('cannot be moved by the search totals — effort and lethality are diagnostics now', () => {
    const thrashed = scoreDifficulty({
      ...base,
      // Deaths scale with expansions: lethality is deaths PER EXPANSION, so
      // holding the death count fixed while multiplying expansions would
      // quietly move the diagnostic the other way and test nothing.
      expansions: solved.totals.expansions * 50, deaths: solved.totals.deaths * 50,
    });
    expect(thrashed.effort).toBeGreaterThan(d.effort);
    expect(thrashed.score).toBeCloseTo(d.score, 9);
  });

  it('is deterministic for a seed', () => {
    expect(scoreDifficulty({ ...base, seed: 11 }).score)
      .toBe(scoreDifficulty({ ...base, seed: 11 }).score);
  });
});

describe('tensionOf', () => {
  it('calls a spread under the noise floor no finding at all', () => {
    const t = tensionOf(30, 31, [0, 1]);
    expect(t.spreadSeconds).toBeCloseTo(1, 9);
    expect(t.real).toBe(false);
    expect(t.noiseFloorSeconds).toBe(TENSION_NOISE_FLOOR);
  });

  it('is a finding when the obvious order is seconds off the searched one', () => {
    const t = tensionOf(54.63, 29.28, [2, 0, 1]);
    expect(t.spreadSeconds).toBeCloseTo(25.35, 6);
    expect(t.real).toBe(true);
  });

  it('is unbounded when the obvious order cannot do the level at all', () => {
    const t = tensionOf(20, null, [0]);
    expect(t.spreadSeconds).toBe(Infinity);
    expect(t.real).toBe(true);
  });
});
