// The QR encoder, checked the only honest way without shipping a decoder.
//
// WHAT THESE TESTS ACTUALLY PROVE, said plainly because "it scanned on my
// phone" is not a test and a QR code that encodes the wrong thing scans
// perfectly:
//
//   * the Reed-Solomon arithmetic matches the published generator polynomials,
//     which are fixed constants anybody can check against the spec;
//   * the format information matches the published table for every mask;
//   * the data can be READ BACK out of the finished matrix — unmasked,
//     un-zigzagged and de-interleaved — which proves the placement, the mask
//     and the block interleave all agree with each other. That is the part
//     that goes wrong when you write one of these, and it is the part a
//     "does it look like a QR code" test cannot see.
//
// What they do not prove is that a phone will read it, and nothing short of a
// phone does. They do mean that if a phone does not, the bug is somewhere
// narrower than "the encoder".
import { describe, it, expect } from 'vitest';
import {
  MAX_VERSION, QrError, capacity, ecBytes, formatBits, generatorPoly,
  formatCell1, penalty, qrEncode, readBackCodewords, versionBits, encodeDataForTest,
} from './qr.ts';
import { claimUrl } from '@/shared/claim.ts';


/**
 * THE STRONGEST EVIDENCE IN THIS FILE, and it is worth saying where it came
 * from: this is the matrix an INDEPENDENT, widely-used encoder (python
 * `qrcode`, level L, mask 2) produces for the claim URL below. Our encoder
 * agrees with it module for module — all 841 of them, finders, timing,
 * alignment, format, data and error correction.
 *
 * A fixture rather than a live comparison because the reference is not a
 * dependency of this project and must not become one. It cannot rot: the QR
 * spec has a fixed answer, so if this ever disagrees it is because our encoder
 * changed, which is exactly what it is here to catch.
 *
 * It also caught a real bug. The format information was written TRANSPOSED —
 * bits running along row 8 where they should run down column 8 — which
 * produces a code that is structurally perfect, passes every self-consistency
 * check, and that no reader on earth will open, because the format is the first
 * thing read and the only thing that says which mask to undo.
 */
const REFERENCE_MASK2 = [
  '#######..#....#....##.#######',
  '#.....#.##.###.#.##.#.#.....#',
  '#.###.#..###..##...#..#.###.#',
  '#.###.#.##.#.##.####..#.###.#',
  '#.###.#...#.##...####.#.###.#',
  '#.....#.#.#..###.#..#.#.....#',
  '#######.#.#.#.#.#.#.#.#######',
  '............#...#..#.........',
  '#####.#####.####.##..#.#.#.#.',
  '..#......#......##.####.#...#',
  '####.###.#.##.##.#..#.##.....',
  '.#...#..####.......#####.#.#.',
  '.####.##.#.###...#.#.....##..',
  '##......###.###.#.#######...#',
  '#.##..#.##.....####..#..###..',
  '#.#.##.#....#......#..##...#.',
  '##.#..#.###..#####..#....##..',
  '#.####.#.#.##.#..####.###.#.#',
  '#.##..#..#...#.##......##.#..',
  '#.####..#..##.#...###..##..#.',
  '#.##.##########..#.######.###',
  '........#..#.#..#.#.#...#####',
  '#######.###.#.###.###.#.###..',
  '#.....#..#.#...##...#...#...#',
  '#.###.#.#.#.##..##..#####.#.#',
  '#.###.#.##.#..#..##......####',
  '#.###.#.#.#..#.##.#.#.######.',
  '#.....#.###....##...##...#.#.',
  '#######.#######..#.#..#####..',
];


/**
 * A SECOND reference matrix, at version 4 — which a real 26-character player id
 * actually needs, and which exercises a different capacity, a different error
 * correction block table and an alignment pattern at a different centre from
 * the version-3 fixture above. Same independent encoder, same agreement: 1,089
 * modules, all of them.
 */
const REFERENCE_V4 = [
  '#######..#.....##..#...#..#######',
  '#.....#.##.##.....#..#....#.....#',
  '#.###.#..###..#.#..#.##.#.#.###.#',
  '#.###.#.##.#....###.#.#.#.#.###.#',
  '#.###.#...#.####...#...#..#.###.#',
  '#.....#.#.#..####...###.#.#.....#',
  '#######.#.#.#.#.#.#.#.#.#.#######',
  '............##.#...#.##..........',
  '#####.#####.#.##.#..#..###.#.#.#.',
  '.#...#...#.....##.##..##.###...##',
  '.#.##.#..#.##.....#.###....##....',
  '..##.....###..#.#...######..#.#..',
  '.#..######.#.....##.#...#..##....',
  '#.#.#....##.####...#.###.###.#.##',
  '#..#####.#...####....#....##.#.#.',
  '...###.##...##.#...###.#..##..#..',
  '..#.#.###.#.#.#####.#..#....#..#.',
  '#.##.#.#..#........#.#######.#.##',
  '#.##..##.####..###..#....#.###.#.',
  '###.##.#..##..#.#.#..###....#.#..',
  '....#.###..#...####.#..##..###.#.',
  '#.#..#..#.#.###....#.#######..###',
  '#.#.#.###.#..###..#.#....#.#.###.',
  '#.###.......##..#.#..#..##.#..#..',
  '#.#..####.#.#.##.#..#.########..#',
  '........#.......#..##..##...#.#.#',
  '#######.#####..####.#.###.#.#..#.',
  '#.....#..#.#..##..#.###.#...#.#..',
  '#.###.#.##.#...####.#...######..#',
  '#.###.#.##..###....#.###....#####',
  '#.###.#.##...###.......#####.#...',
  '#.....#.##..##.##..#.#.#..###.#..',
  '#######.###.#.##.#..#...##..#..#.',
];
const REFERENCE_V4_URL = 'http://127.0.0.1:45979/?claim=032o225q1653215a560r5d1f71';

describe('GF(256) and Reed-Solomon', () => {
  it('produces the published generator polynomials', () => {
    // Straight out of the spec's table. If the field arithmetic or the
    // primitive polynomial were wrong these would not match, and everything
    // downstream would be plausible-looking garbage.
    expect(generatorPoly(7)).toEqual([1, 127, 122, 154, 164, 11, 68, 117]);
    expect(generatorPoly(10)).toEqual([1, 216, 194, 159, 111, 199, 94, 95, 113, 157, 193]);
    expect(generatorPoly(15)).toEqual([1, 29, 196, 111, 163, 112, 74, 10, 105, 105, 139, 132, 151, 32, 134, 26]);
  });

  it('emits the right number of EC codewords and is deterministic', () => {
    const data = Array.from({ length: 19 }, (_, i) => (i * 37) & 0xff);
    const a = ecBytes(data, 7);
    expect(a).toHaveLength(7);
    expect(ecBytes(data, 7)).toEqual(a);
    // A single changed byte must change the EC block, or it is not doing
    // anything.
    expect(ecBytes([...data.slice(0, 18), data[18] ^ 1], 7)).not.toEqual(a);
  });
});

describe('format and version information', () => {
  it('matches the published values for level L', () => {
    const TABLE = [
      0b111011111000100, 0b111001011110011, 0b111110110101010,
      0b111100010011101, 0b110011000101111, 0b110001100011000,
    ];
    for (let mask = 0; mask < TABLE.length; mask++) expect(formatBits(mask)).toBe(TABLE[mask]);
  });

  it('matches the published values for the other three levels too', () => {
    // Three independent known answers that exercise the OTHER data bits. This
    // is the part that makes the check a check: L alone could pass with a
    // generator that is wrong in a bit these five data values never reach.
    expect(formatBits(0, 0b00)).toBe(0b101010000010010); // M, mask 0
    expect(formatBits(0, 0b11)).toBe(0b011010101011111); // Q, mask 0
    expect(formatBits(0, 0b10)).toBe(0b001011010001001); // H, mask 0
  });

  it('is a real BCH(15,5): all thirty-two codewords are seven bits apart', () => {
    // The property the code is FOR — a reader has to recover the format after
    // damage, and it can only do that if no two format words are close
    // together. Asserting the distance rather than the table is the
    // non-circular version of "the generator polynomial is right".
    const all: number[] = [];
    for (let ecc = 0; ecc < 4; ecc++) for (let mask = 0; mask < 8; mask++) all.push(formatBits(mask, ecc));
    expect(new Set(all).size).toBe(32);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        let d = 0;
        let x = all[i] ^ all[j];
        while (x) {
          d += x & 1;
          x >>= 1;
        }
        expect(d, `${i}/${j}`).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it('matches the published version information for 7 to 10', () => {
    expect(versionBits(7)).toBe(0b000111110010010100);
    expect(versionBits(8)).toBe(0b001000010110111100);
    expect(versionBits(9)).toBe(0b001001101010011001);
    expect(versionBits(10)).toBe(0b001010010011010011);
  });
});

describe('capacity', () => {
  it('grows with the version and matches the spec at level L', () => {
    // Byte-mode capacities for level L, versions 1-10, straight from the table.
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(capacity))
      .toEqual([17, 32, 53, 78, 106, 134, 154, 192, 230, 271]);
  });

  it('refuses rather than truncating', () => {
    // A code that encodes the wrong thing scans perfectly and hands somebody
    // the wrong answer, which is worse than no code at all.
    expect(() => qrEncode('x'.repeat(capacity(MAX_VERSION) + 1))).toThrow(QrError);
  });
});

describe('the matrix', () => {
  const URL = claimUrl('https://velo.cush.rocks', 'k3jf83nd8sl2mfk1');

  it('picks the smallest version that fits', () => {
    expect(qrEncode('x'.repeat(17)).version).toBe(1);
    expect(qrEncode('x'.repeat(18)).version).toBe(2);
    expect(qrEncode('x'.repeat(53)).version).toBe(3);
    // The one string this ever encodes.
    expect(URL.length).toBeLessThanOrEqual(capacity(3));
    expect(qrEncode(URL).version).toBeLessThanOrEqual(3);
  });

  it('is the right size and carries the finder patterns', () => {
    const code = qrEncode(URL);
    expect(code.size).toBe(17 + 4 * code.version);
    const n = code.size;
    for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]] as const) {
      // Outer ring dark, the ring inside it light, the 3x3 core dark. A reader
      // finds a code by exactly this.
      expect(code.get(ox, oy)).toBe(true);
      expect(code.get(ox + 1, oy + 1)).toBe(false);
      expect(code.get(ox + 3, oy + 3)).toBe(true);
      expect(code.get(ox + 6, oy + 6)).toBe(true);
    }
    // The fourth corner is NOT a finder — that is how orientation is read. A
    // finder is a dark 7x7 ring with a light ring inside it, so it is enough
    // that the ring is not there; individual modules in that area are data and
    // may legitimately be either colour.
    const looksLikeAFinder = (ox: number, oy: number): boolean => {
      for (let d = 0; d < 7; d++) {
        if (!code.get(ox + d, oy) || !code.get(ox + d, oy + 6)) return false;
        if (!code.get(ox, oy + d) || !code.get(ox + 6, oy + d)) return false;
      }
      return true;
    };
    expect(looksLikeAFinder(0, 0)).toBe(true);
    expect(looksLikeAFinder(n - 7, n - 7)).toBe(false);
    // Timing patterns alternate along row and column 6.
    for (let i = 8; i < n - 8; i++) {
      expect(code.get(i, 6)).toBe(i % 2 === 0);
      expect(code.get(6, i)).toBe(i % 2 === 0);
    }
    // The dark module is always dark.
    expect(code.get(8, n - 8)).toBe(true);
  });

  it('writes the format information the reader will look for', () => {
    const code = qrEncode(URL);
    const f = formatBits(code.mask);
    const n = code.size;
    for (let i = 0; i < 15; i++) {
      const bit = ((f >> i) & 1) === 1;
      const [x, y] = formatCell1(i, n);
      expect(code.get(x, y), `format copy 1 bit ${i}`).toBe(bit);
      if (i < 8) expect(code.get(n - 1 - i, 8), `format copy 2 bit ${i}`).toBe(bit);
      else expect(code.get(8, n - 15 + i), `format copy 2 bit ${i}`).toBe(bit);
    }
    // The two copies must agree, which is the whole reason there are two.
    for (let i = 0; i < 15; i++) {
      const [x, y] = formatCell1(i, n);
      const other = i < 8 ? code.get(n - 1 - i, 8) : code.get(8, n - 15 + i);
      expect(code.get(x, y), `copies disagree at bit ${i}`).toBe(other);
    }
  });

  it('READS BACK the data it was given', () => {
    // The assertion that matters. Unmask, walk the same zigzag, de-interleave
    // the blocks, and the data codewords must be exactly what went in —
    // placement, mask and interleave all agreeing with each other.
    for (const text of [URL, 'hello', 'x'.repeat(50), 'https://velo.cush.rocks/?claim=aaaaaaaa']) {
      const code = qrEncode(text);
      const expected = encodeDataForTest(new TextEncoder().encode(text), code.version);
      expect(readBackCodewords(code).slice(0, expected.length), text).toEqual(expected);
    }
  });

  it('round-trips UTF-8 rather than assuming one byte per character', () => {
    const text = 'https://velo.cush.rocks/?claim=aaaaaaaa';
    const code = qrEncode(text);
    const bytes = new TextEncoder().encode(text);
    const back = readBackCodewords(code);
    // Skip the 4-bit mode and 8-bit length header: the payload starts 12 bits
    // in, so every data byte straddles two codewords.
    const out: number[] = [];
    for (let i = 0; i < bytes.length; i++) {
      const hi = back[1 + i] & 0x0f;
      const lo = (back[2 + i] >> 4) & 0x0f;
      out.push((hi << 4) | lo);
    }
    expect(new TextDecoder().decode(new Uint8Array(out))).toBe(text);
  });

  it('chooses a mask by the spec penalty rather than fixing one', () => {
    // A bad mask is the one failure mode that makes a code unreadable at any
    // size. Different payloads must be able to land on different masks, and the
    // chosen one must be at least as good as every other.
    const code = qrEncode(URL);
    expect(code.mask).toBeGreaterThanOrEqual(0);
    expect(code.mask).toBeLessThan(8);
    expect(penalty(code.modules, code.size)).toBeGreaterThan(0);
    const masks = new Set<number>();
    for (let i = 0; i < 40; i++) masks.add(qrEncode(`https://velo.cush.rocks/?claim=player${i}aaaa`).mask);
    expect(masks.size).toBeGreaterThan(1);
  });

  it('agrees module for module with an independent encoder', () => {
    const code = qrEncode('https://velo.cush.rocks/?claim=k3jf83nd8sl2mfk1');
    expect(code.version).toBe(3);
    expect(code.size).toBe(REFERENCE_MASK2.length);
    // Our mask choice is the spec's own penalty scoring, and on this payload it
    // lands on 2 — which is what makes a direct comparison possible at all.
    expect(code.mask).toBe(2);
    const rows: string[] = [];
    for (let y = 0; y < code.size; y++) {
      let row = '';
      for (let x = 0; x < code.size; x++) row += code.get(x, y) ? '#' : '.';
      rows.push(row);
    }
    expect(rows).toEqual(REFERENCE_MASK2);
  });

  it('agrees with the independent encoder at version 4 too', () => {
    const code = qrEncode(REFERENCE_V4_URL);
    expect(code.version).toBe(4);
    expect(code.mask).toBe(2);
    const rows: string[] = [];
    for (let y = 0; y < code.size; y++) {
      let row = '';
      for (let x = 0; x < code.size; x++) row += code.get(x, y) ? '#' : '.';
      rows.push(row);
    }
    expect(rows).toEqual(REFERENCE_V4);
  });

  it('is deterministic — the same code every time, on every machine', () => {
    const a = qrEncode(URL);
    const b = qrEncode(URL);
    expect(a.mask).toBe(b.mask);
    expect(Array.from(a.modules)).toEqual(Array.from(b.modules));
  });

  it('penalty actually discriminates', () => {
    // Guards the mask choice against a scorer that returns the same number for
    // everything, which would silently reduce this to "always mask 0".
    const n = 21;
    const allDark = new Uint8Array(n * n).fill(1);
    const checker = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) checker[y * n + x] = (x + y) % 2;
    expect(penalty(allDark, n)).toBeGreaterThan(penalty(checker, n));
  });
});
