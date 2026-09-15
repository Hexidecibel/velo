import { describe, it, expect } from 'vitest';
import { parseLevel } from './level.ts';
import { TEST_LEVEL } from './testlevel.ts';
import { DEFAULT_SPEC } from './spec.ts';
import { crossCheck, crossCheckMask } from './crosscheck.ts';
import { IN_MASK } from './consts.ts';

describe('cross-engine harness', () => {
  it('generates a busy input pattern that stays inside the mask', () => {
    // A code path the pattern never takes is a code path the cross-engine
    // check never covers, so assert it actually reaches everything.
    let seen = 0;
    for (let f = 0; f < 4000; f++) {
      const m = crossCheckMask(f);
      expect(m & ~IN_MASK).toBe(0);
      seen |= m;
    }
    expect(seen).toBe(IN_MASK);
  });

  it('is reproducible within this engine', () => {
    const level = parseLevel(TEST_LEVEL);
    const a = crossCheck(level, DEFAULT_SPEC, 600, 50);
    const b = crossCheck(level, DEFAULT_SPEC, 600, 50);
    expect(b.hashes).toEqual(a.hashes);
    expect(b.final).toBe(a.final);
  });

  it('spends the whole window on live physics rather than a frozen corpse', () => {
    const level = parseLevel(TEST_LEVEL);
    const r = crossCheck(level, DEFAULT_SPEC, 2000, 100);
    expect(r.runs).toBeGreaterThan(0);
    expect(new Set(r.hashes).size).toBe(r.hashes.length);
  });
});
