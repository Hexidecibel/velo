// State hashing. Two 32-bit FNV-1a lanes with different primes, printed as 16
// hex chars. Not a cryptographic hash and does not need to be — its job is to
// make a desync loud at the tick it happens instead of six months later in a
// leaderboard dispute.
//
// Three details here are the ones that are easy to get wrong:
//
//  * `-0` and `+0` compare `===` but have different bit patterns, so a
//    bit-level hash reports a desync that is not one. Normalised on write.
//  * `DataView.setFloat64(off, v, true)` rather than a Float64Array view, so
//    that endianness is stated rather than inherited from the host.
//  * magnitudes under HASH_EPS collapse to zero, UNCONDITIONALLY. Putting that
//    behind a debug flag makes a dev build and a prod build hash differently.
import { HASH_EPS } from './consts.ts';

const SCRATCH = new DataView(new ArrayBuffer(8));

const FNV_OFFSET_A = 0x811c9dc5 | 0;
const FNV_OFFSET_B = 0xcbf29ce4 | 0;
const FNV_PRIME_A = 0x01000193;
const FNV_PRIME_B = 0x85ebca6b;

export class Hasher {
  private a = FNV_OFFSET_A;
  private b = FNV_OFFSET_B;

  byte(v: number): void {
    const x = v & 0xff;
    this.a = Math.imul(this.a ^ x, FNV_PRIME_A);
    this.b = Math.imul(this.b ^ x, FNV_PRIME_B);
  }

  /** A 32-bit integer, little-endian, four bytes. */
  int(v: number): void {
    const x = v | 0;
    this.byte(x);
    this.byte(x >>> 8);
    this.byte(x >>> 16);
    this.byte(x >>> 24);
  }

  /** A float64, normalised per the header, little-endian, eight bytes. */
  num(v: number): void {
    let x = v;
    if (x === 0) {
      x = 0; // collapses -0 to +0
    } else if (x !== x) {
      x = NaN; // canonicalise any NaN payload; NaN in the sim is a bug, but a
      // DETERMINISTIC one, so the hash still agrees across engines and the
      // failure surfaces as "the bike exploded" rather than "desync".
    } else if (x < HASH_EPS && x > -HASH_EPS) {
      x = 0;
    }
    SCRATCH.setFloat64(0, x, true);
    for (let i = 0; i < 8; i++) this.byte(SCRATCH.getUint8(i));
  }

  bool(v: boolean): void {
    this.byte(v ? 1 : 0);
  }

  str(s: string): void {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      this.byte(c);
      this.byte(c >>> 8);
    }
    this.byte(0);
  }

  digest(): string {
    return hex32(this.a) + hex32(this.b);
  }
}

function hex32(v: number): string {
  const s = (v >>> 0).toString(16);
  return '00000000'.slice(s.length) + s;
}

export function hashNumbers(values: readonly number[]): string {
  const h = new Hasher();
  for (const v of values) h.num(v);
  return h.digest();
}
