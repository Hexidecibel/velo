// The home-screen icons, drawn rather than shipped as binaries nobody can edit.
//
// WHY A GENERATOR AND NOT THREE PNGs IN THE REPO: an icon is the one asset that
// has to exist in several sizes at once, and a set of hand-exported PNGs drifts
// the moment the palette moves — which it has, once, already. This draws all of
// them from `src/client/art/palette.ts`'s own colours, so "the icon is a
// different blue from the game" is not a state this can be in.
//
// No dependencies. A PNG is a signature, an IHDR, one zlib stream of filtered
// scanlines and an IEND, and node has zlib.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'public');

// The chrome palette, which is the art palette. Keep in step with style.css.
const BG = [0x0d, 0x0b, 0x1a];
const EDGE = [0x29, 0xd9, 0xf2];
const ACCENT = [0xff, 0xd2, 0x1f];
const INK = [0xe6, 0xe1, 0xf5];

function crcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const CRC = crcTable();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** `rgb` is a (w*h*3) byte array; PNG colour type 2, 8 bits, no alpha. */
function png(w, h, rgb) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none. These are tiny and it is honest.
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * The mark: two wheels and a frame, in the game's own cyan, over the game's own
 * background. Drawn in UNIT SPACE and sampled 3x3 per pixel, so 192 and 512 are
 * the same picture rather than two pictures that nearly agree — and so the edges
 * are not a staircase at the size a launcher actually shows.
 *
 * `inset` is the maskable version's safe area: Android will crop an adaptive
 * icon to whatever shape the launcher likes, and anything in the outer 10% of
 * the square is not guaranteed to survive.
 */
function draw(size, inset) {
  const out = Buffer.alloc(size * size * 3);
  const S = 3;
  const rear = { x: 0.31, y: 0.63, r: 0.155 };
  const front = { x: 0.71, y: 0.63, r: 0.155 };
  const tyre = 0.042;
  // The frame: rear hub -> saddle -> head, and head -> front hub. Two strokes.
  const seg = [
    [rear.x, rear.y, 0.46, 0.40],
    [0.46, 0.40, 0.66, 0.40],
    [0.66, 0.40, front.x, front.y],
    [0.46, 0.40, 0.40, 0.30],
  ];
  const distSeg = (px, py, [ax, ay, bx, by]) => {
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          // Unit coordinates, with the whole mark shrunk into the safe area.
          const u = (x + (sx + 0.5) / S) / size;
          const v = (y + (sy + 0.5) / S) / size;
          const cu = (u - 0.5) / (1 - 2 * inset) + 0.5;
          const cv = (v - 0.5) / (1 - 2 * inset) + 0.5;
          let c = BG;
          for (const w of [rear, front]) {
            const d = Math.abs(Math.hypot(cu - w.x, cv - w.y) - w.r);
            if (d < tyre * 0.5) c = EDGE;
          }
          if (c === BG) {
            for (let i = 0; i < seg.length; i++) {
              if (distSeg(cu, cv, seg[i]) < 0.028) c = i === 3 ? ACCENT : INK;
            }
          }
          // The ground line: the collision edge is the thing this game is about.
          if (c === BG && cv > 0.80 && cv < 0.845) c = EDGE;
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const n = S * S;
      const o = (y * size + x) * 3;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
    }
  }
  return out;
}

mkdirSync(OUT, { recursive: true });
const want = [
  ['icon-180.png', 180, 0.06],
  ['icon-192.png', 192, 0.06],
  ['icon-512.png', 512, 0.06],
  // Maskable: 20% inset, so the mark survives a circle, a squircle or a
  // teardrop crop without a wheel being shaved off.
  ['icon-maskable-512.png', 512, 0.2],
];
for (const [name, size, inset] of want) {
  const buf = png(size, size, draw(size, inset));
  writeFileSync(join(OUT, name), buf);
  console.log(`    ${name}  ${size}x${size}  ${(buf.length / 1024).toFixed(1)} KB`);
}
console.log(`==> ${OUT}`);
