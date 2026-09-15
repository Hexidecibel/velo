// Seeded RNG for the procedural art.
//
// mulberry32: small, fast, and — the only property that matters here —
// REPRODUCIBLE. Every blotch, crack, stain and stencil placement in a level is
// a draw from a stream seeded off the level's simHash, so the art is stable
// across reloads, across rebakes and across machines. A level that grew a
// different set of cracks every time you pressed R would be unreadable as a
// place.
//
// simHash and not contentHash on purpose: recolouring or retitling a level must
// not move its cracks, for exactly the reason simHash exists at all.
//
// This is renderer code and has nothing to do with the sim's determinism rules;
// it is never stepped, never hashed and never verified.
export type Rng = () => number;

export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fold a hex digest (or any string) into a 32-bit seed. FNV-1a. */
export function seedFrom(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A sub-stream, so adding a layer cannot shift every other layer's draws. */
export function substream(seed: number, tag: string): Rng {
  return rng((seed ^ seedFrom(tag)) >>> 0);
}
