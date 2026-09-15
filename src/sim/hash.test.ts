import { describe, it, expect } from 'vitest';
import { Hasher, hashNumbers } from './hash.ts';

describe('hasher', () => {
  it('treats -0 and +0 as the same value', () => {
    // They compare === but have different bit patterns. A bit-level hash that
    // does not normalise reports a desync that is not one, and that false
    // alarm is far more expensive than a missed one because it trains you to
    // ignore the alarm.
    expect(hashNumbers([-0])).toBe(hashNumbers([0]));
    expect(hashNumbers([1, -0, 2])).toBe(hashNumbers([1, 0, 2]));
  });

  it('collapses sub-epsilon magnitudes', () => {
    expect(hashNumbers([1e-12])).toBe(hashNumbers([0]));
    expect(hashNumbers([-1e-12])).toBe(hashNumbers([0]));
    expect(hashNumbers([1e-8])).not.toBe(hashNumbers([0]));
  });

  it('canonicalises NaN payloads', () => {
    const view = new DataView(new ArrayBuffer(8));
    view.setUint32(0, 0x7ff80000);
    view.setUint32(4, 0x00000001); // a NaN with a non-zero payload
    const weird = view.getFloat64(0);
    expect(Number.isNaN(weird)).toBe(true);
    expect(hashNumbers([weird])).toBe(hashNumbers([NaN]));
  });

  it('distinguishes values, orderings and types', () => {
    expect(hashNumbers([1, 2])).not.toBe(hashNumbers([2, 1]));
    expect(hashNumbers([1])).not.toBe(hashNumbers([1, 0]));
    const a = new Hasher();
    a.int(1);
    const b = new Hasher();
    b.num(1);
    expect(a.digest()).not.toBe(b.digest());
  });

  it('produces 16 lowercase hex characters', () => {
    expect(hashNumbers([1.5])).toMatch(/^[0-9a-f]{16}$/);
  });
});
