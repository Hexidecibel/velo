// A QR encoder, written out rather than installed.
//
// WHY HAND-ROLLED. This repo draws its own things: the physics, the art, the
// stroke alphabet and the audio are all written here for the same reason — a
// dependency is a thing that has to be pinned, audited, updated and trusted, and
// the ones that produce PIXELS have a habit of producing slightly different
// pixels next release. A QR encoder is a spec with a fixed answer; there is no
// version of it that gets better, so there is nothing to gain by importing one.
// This is about three hundred lines and it is the whole of it.
//
// SCOPE, DELIBERATELY NARROW. Byte mode, error correction level L, versions 1
// to 10. That is up to 271 bytes, and the only thing this ever encodes is a
// claim URL of about fifty characters — `https://host/?claim=<playerId>`.
// Anything longer is refused loudly rather than silently truncated, because a
// QR code that encodes the wrong thing scans perfectly and hands somebody the
// wrong answer.
//
// Level L rather than a higher one on purpose: a claim code is read once, off a
// bright screen, from thirty centimetres away. L keeps the module count down,
// which makes the modules bigger at the same pixel size, which is what actually
// helps a phone camera here. The mask is still chosen by the spec's own penalty
// scoring rather than fixed, because a bad mask is the one failure mode that
// makes a code unreadable at any size.

export class QrError extends Error {}

/** [ec codewords per block, group-1 blocks, group-1 data cw, group-2 blocks, group-2 data cw] */
const EC_L: Record<number, readonly [number, number, number, number, number]> = {
  1: [7, 1, 19, 0, 0],
  2: [10, 1, 34, 0, 0],
  3: [15, 1, 55, 0, 0],
  4: [20, 1, 80, 0, 0],
  5: [26, 1, 108, 0, 0],
  6: [18, 2, 68, 0, 0],
  7: [20, 2, 78, 0, 0],
  8: [24, 2, 97, 0, 0],
  9: [30, 2, 116, 0, 0],
  10: [18, 2, 68, 2, 69],
};

/** Alignment pattern centres, by version. Version 1 has none. */
const ALIGN: Record<number, readonly number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

/** Remainder bits after the interleaved codewords, by version. */
function remainderBits(version: number): number {
  if (version === 1) return 0;
  if (version <= 6) return 7;
  return 0;
}

export const MAX_VERSION = 10;

function dataCodewords(version: number): number {
  const [, g1, g1d, g2, g2d] = EC_L[version];
  return g1 * g1d + g2 * g2d;
}

/** Byte-mode capacity at level L. The length field widens at version 10. */
export function capacity(version: number): number {
  const overheadBits = 4 + (version >= 10 ? 16 : 8);
  return Math.floor((dataCodewords(version) * 8 - overheadBits) / 8);
}

// --- GF(256) -----------------------------------------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function buildTables(): void {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    // The QR primitive polynomial, x^8 + x^4 + x^3 + x^2 + 1.
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** The Reed-Solomon generator polynomial of degree `n`, coefficients high-first. */
export function generatorPoly(n: number): number[] {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], 1);
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** The `n` error-correction codewords for one block. */
export function ecBytes(data: readonly number[], n: number): number[] {
  const gen = generatorPoly(n);
  const rem = new Array<number>(n).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let i = 0; i < n; i++) rem[i] ^= gfMul(gen[i + 1], factor);
  }
  return rem;
}

// --- the bit stream ----------------------------------------------------------

class Bits {
  readonly out: number[] = [];
  push(value: number, width: number): void {
    for (let i = width - 1; i >= 0; i--) this.out.push((value >> i) & 1);
  }
}

function encodeData(bytes: Uint8Array, version: number): number[] {
  const total = dataCodewords(version);
  const b = new Bits();
  b.push(0b0100, 4); // byte mode
  b.push(bytes.length, version >= 10 ? 16 : 8);
  for (const v of bytes) b.push(v, 8);
  // Terminator, then pad to a byte boundary, then the spec's alternating pad.
  const room = total * 8 - b.out.length;
  b.push(0, Math.min(4, room));
  while (b.out.length % 8 !== 0) b.out.push(0);
  const cw: number[] = [];
  for (let i = 0; i < b.out.length; i += 8) {
    let v = 0;
    for (let k = 0; k < 8; k++) v = (v << 1) | b.out[i + k];
    cw.push(v);
  }
  const PAD = [0xec, 0x11];
  for (let i = 0; cw.length < total; i++) cw.push(PAD[i % 2]);
  return cw;
}

/** Split into blocks, add EC, and interleave — data first, then EC. */
export function interleave(cw: readonly number[], version: number): number[] {
  const [ecPer, g1, g1d, g2, g2d] = EC_L[version];
  const blocks: number[][] = [];
  let at = 0;
  for (let i = 0; i < g1; i++) {
    blocks.push(cw.slice(at, at + g1d));
    at += g1d;
  }
  for (let i = 0; i < g2; i++) {
    blocks.push(cw.slice(at, at + g2d));
    at += g2d;
  }
  const ecs = blocks.map((blk) => ecBytes(blk, ecPer));
  const out: number[] = [];
  const widest = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < widest; i++) {
    for (const blk of blocks) if (i < blk.length) out.push(blk[i]);
  }
  for (let i = 0; i < ecPer; i++) {
    for (const e of ecs) out.push(e[i]);
  }
  return out;
}

// --- the matrix --------------------------------------------------------------

export interface QrCode {
  version: number;
  size: number;
  mask: number;
  /** Row-major, 1 for a dark module. */
  modules: Uint8Array;
  get(x: number, y: number): boolean;
}

const FORMAT_MASK = 0b101010000010010;

/**
 * 15-bit format information, BCH(15,5) encoded and then XOR'd with the spec's
 * fixed mask.
 *
 * `ecc` defaults to level L (0b01), which is the only level this encoder emits.
 * It is a parameter solely so the test can cross-check the arithmetic against
 * the published values for M, Q and H as well — three independent known answers
 * that exercise the other data bits, which is what makes that test a check on
 * the implementation rather than a restatement of it.
 */
export function formatBits(mask: number, ecc = 0b01): number {
  const data = (ecc << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) rem ^= 0b10100110111 << (i - 10);
  }
  return ((data << 10) | rem) ^ FORMAT_MASK;
}

/** 18-bit version information, for versions 7 and up. */
export function versionBits(version: number): number {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((rem >> i) & 1) rem ^= 0b1111100100101 << (i - 12);
  }
  return (version << 12) | rem;
}

function maskAt(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

interface Grid {
  size: number;
  m: Uint8Array;
  fn: Uint8Array;
}

function newGrid(version: number): Grid {
  const size = 17 + 4 * version;
  return { size, m: new Uint8Array(size * size), fn: new Uint8Array(size * size) };
}

function setFn(g: Grid, x: number, y: number, dark: boolean): void {
  if (x < 0 || y < 0 || x >= g.size || y >= g.size) return;
  g.m[y * g.size + x] = dark ? 1 : 0;
  g.fn[y * g.size + x] = 1;
}

function drawFunctionPatterns(g: Grid, version: number): void {
  // Finders and their separators, in three corners.
  for (const [ox, oy] of [[0, 0], [g.size - 7, 0], [0, g.size - 7]] as const) {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const inRing = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
        const outer = inRing && (dx === 0 || dx === 6 || dy === 0 || dy === 6);
        const core = inRing && dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
        setFn(g, ox + dx, oy + dy, outer || core);
      }
    }
  }
  // Timing patterns.
  for (let i = 8; i < g.size - 8; i++) {
    setFn(g, i, 6, i % 2 === 0);
    setFn(g, 6, i, i % 2 === 0);
  }
  // Alignment patterns, skipping the three that would sit on a finder.
  const centres = ALIGN[version];
  for (const cy of centres) {
    for (const cx of centres) {
      const onFinder =
        (cx === 6 && cy === 6) ||
        (cx === 6 && cy === g.size - 7) ||
        (cx === g.size - 7 && cy === 6);
      if (onFinder) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const ring = Math.max(Math.abs(dx), Math.abs(dy));
          setFn(g, cx + dx, cy + dy, ring !== 1);
        }
      }
    }
  }
  // The dark module, and the reserved format areas.
  setFn(g, 8, g.size - 8, true);
  // INDEX 6 IS SKIPPED, and forgetting it is the classic way to break one of
  // these: (8, 6) and (6, 8) are TIMING modules, not format ones, and the
  // format bit layout below steps over them for exactly that reason. Reserving
  // them here would overwrite two timing modules with light, which leaves a
  // code that still looks like a QR and that some readers refuse.
  for (let i = 0; i < 9; i++) {
    if (i === 6) continue;
    setFn(g, i, 8, false);
    setFn(g, 8, i, false);
  }
  for (let i = 0; i < 8; i++) {
    setFn(g, g.size - 1 - i, 8, false);
    setFn(g, 8, g.size - 1 - i, false);
  }
  if (version >= 7) {
    const v = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((v >> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + g.size - 11;
      setFn(g, a, b, bit);
      setFn(g, b, a, bit);
    }
  }
}

/** The zigzag order the spec places data in: two columns at a time, right to left. */
function placeData(g: Grid, codewords: readonly number[]): void {
  let bit = 0;
  const total = codewords.length * 8;
  let upward = true;
  for (let right = g.size - 1; right >= 1; right -= 2) {
    // Column 6 is the vertical timing pattern and is skipped entirely.
    if (right === 6) right = 5;
    for (let i = 0; i < g.size; i++) {
      const y = upward ? g.size - 1 - i : i;
      for (const x of [right, right - 1]) {
        if (g.fn[y * g.size + x]) continue;
        let dark = false;
        if (bit < total) dark = ((codewords[bit >> 3] >> (7 - (bit & 7))) & 1) === 1;
        g.m[y * g.size + x] = dark ? 1 : 0;
        bit++;
      }
    }
    upward = !upward;
  }
}

function applyMask(g: Grid, mask: number): Uint8Array {
  const out = new Uint8Array(g.m);
  for (let y = 0; y < g.size; y++) {
    for (let x = 0; x < g.size; x++) {
      if (g.fn[y * g.size + x]) continue;
      if (maskAt(mask, x, y)) out[y * g.size + x] ^= 1;
    }
  }
  return out;
}

/** Where format bit `i` sits in the copy around the top-left finder. */
export function formatCell1(i: number, _size: number): [number, number] {
  if (i < 6) return [8, i];
  if (i === 6) return [8, 7];
  if (i === 7) return [8, 8];
  if (i === 8) return [7, 8];
  return [14 - i, 8];
}

function writeFormat(g: Grid, m: Uint8Array, mask: number): void {
  const f = formatBits(mask);
  for (let i = 0; i < 15; i++) {
    const bit = (f >> i) & 1;
    // COPY 1, around the top-left finder: bits 0-5 run DOWN column 8, then the
    // corner at (8, 7) and (8, 8), then bits 9-14 run LEFT along row 8. The
    // index-6 skip in both directions is the timing pattern, reserved above.
    //
    // Getting this transposed produces a code that is structurally perfect and
    // that no reader will open, because the format is the first thing read and
    // the only thing that says which mask to undo. It was transposed once here,
    // caught by diffing against an independent encoder's matrix.
    const [x1, y1] = formatCell1(i, g.size);
    m[y1 * g.size + x1] = bit;
    // COPY 2, split between the other two finders, so a code with one corner
    // damaged still yields its format.
    if (i < 8) m[8 * g.size + (g.size - 1 - i)] = bit;
    else m[(g.size - 15 + i) * g.size + 8] = bit;
  }
  m[(g.size - 8) * g.size + 8] = 1; // the dark module, always
}

/** The spec's four penalty rules. Lower is better. */
export function penalty(m: Uint8Array, size: number): number {
  const at = (x: number, y: number): number => m[y * size + x];
  let score = 0;

  // N1: runs of five or more.
  for (let i = 0; i < size; i++) {
    for (const rowwise of [true, false]) {
      let run = 1;
      let prev = rowwise ? at(0, i) : at(i, 0);
      for (let j = 1; j < size; j++) {
        const v = rowwise ? at(j, i) : at(i, j);
        if (v === prev) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
          prev = v;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  }

  // N2: 2x2 blocks of one colour.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const v = at(x, y);
      if (v === at(x + 1, y) && v === at(x, y + 1) && v === at(x + 1, y + 1)) score += 3;
    }
  }

  // N3: the finder-like 1:1:3:1:1 pattern with four light modules beside it.
  const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let i = 0; i < size; i++) {
    for (let j = 0; j + 11 <= size; j++) {
      let rowA = true;
      let rowB = true;
      let colA = true;
      let colB = true;
      for (let k = 0; k < 11; k++) {
        const r = at(j + k, i);
        const c = at(i, j + k);
        if (r !== A[k]) rowA = false;
        if (r !== B[k]) rowB = false;
        if (c !== A[k]) colA = false;
        if (c !== B[k]) colB = false;
      }
      if (rowA) score += 40;
      if (rowB) score += 40;
      if (colA) score += 40;
      if (colB) score += 40;
    }
  }

  // N4: how far the dark proportion is from half.
  let dark = 0;
  for (let i = 0; i < m.length; i++) dark += m[i];
  const pct = (dark * 100) / (size * size);
  score += 10 * Math.floor(Math.abs(pct - 50) / 5);
  return score;
}

/**
 * Encode `text` as a QR code.
 *
 * Refuses rather than truncating: a QR that encodes the wrong thing scans
 * perfectly and hands somebody the wrong answer, which is worse than no code at
 * all. The one caller here encodes a ~50 character URL, so this cannot fire in
 * practice — it is here so it cannot start firing silently later.
 */
export function qrEncode(text: string): QrCode {
  const bytes = new TextEncoder().encode(text);
  let version = 0;
  for (let v = 1; v <= MAX_VERSION; v++) {
    if (bytes.length <= capacity(v)) {
      version = v;
      break;
    }
  }
  if (version === 0) {
    throw new QrError(
      `${bytes.length} bytes will not fit a version-${MAX_VERSION} code at level L (max ${capacity(MAX_VERSION)})`,
    );
  }

  const g = newGrid(version);
  drawFunctionPatterns(g, version);
  const cw = interleave(encodeData(bytes, version), version);
  // Remainder bits are already zero in the grid; placeData simply runs out of
  // codeword bits and writes light modules for them, which is what the spec
  // asks for.
  placeData(g, cw);

  let best: { mask: number; m: Uint8Array } | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = applyMask(g, mask);
    writeFormat(g, m, mask);
    const s = penalty(m, g.size);
    if (s < bestScore) {
      bestScore = s;
      best = { mask, m };
    }
  }
  const chosen = best!;
  return {
    version,
    size: g.size,
    mask: chosen.mask,
    modules: chosen.m,
    get: (x, y) => chosen.m[y * g.size + x] === 1,
  };
}

/**
 * Read the data codewords back out of a finished code.
 *
 * Exported for the test, and it is the test that matters: it unmasks, walks the
 * same zigzag, de-interleaves the blocks and hands back the data bytes, so
 * asserting it equals what went in proves the placement, the mask and the
 * interleave all agree with each other. It is not a decoder — it does not
 * correct errors and does not read the format info — and it is not presented as
 * one.
 */
export function readBackCodewords(code: QrCode): number[] {
  const version = code.version;
  const g = newGrid(version);
  drawFunctionPatterns(g, version);
  const un = new Uint8Array(code.modules);
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) {
      if (g.fn[y * code.size + x]) continue;
      if (maskAt(code.mask, x, y)) un[y * code.size + x] ^= 1;
    }
  }
  const bits: number[] = [];
  let upward = true;
  for (let right = code.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let i = 0; i < code.size; i++) {
      const y = upward ? code.size - 1 - i : i;
      for (const x of [right, right - 1]) {
        if (g.fn[y * code.size + x]) continue;
        bits.push(un[y * code.size + x]);
      }
    }
    upward = !upward;
  }
  const inter: number[] = [];
  const cwCount = dataCodewords(version) + EC_L[version][0] * (EC_L[version][1] + EC_L[version][3]);
  for (let i = 0; i < cwCount; i++) {
    let v = 0;
    for (let k = 0; k < 8; k++) v = (v << 1) | (bits[i * 8 + k] ?? 0);
    inter.push(v);
  }
  // De-interleave the data half back into block order.
  const [, g1, g1d, g2, g2d] = EC_L[version];
  const sizes = [...new Array(g1).fill(g1d), ...new Array(g2).fill(g2d)] as number[];
  const blocks: number[][] = sizes.map(() => []);
  let at = 0;
  const widest = Math.max(...sizes);
  for (let i = 0; i < widest; i++) {
    for (let b = 0; b < sizes.length; b++) {
      if (i < sizes[b]) blocks[b].push(inter[at++]);
    }
  }
  return blocks.flat();
}

/** The same encoding, as data the UI can hand to a canvas. */
export { encodeData as encodeDataForTest, remainderBits as remainderBitsForTest };
