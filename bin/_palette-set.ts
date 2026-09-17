// How different are the shipped levels AS A SET?
//
// Per-palette checks cannot answer this and never will: twenty legible rooms
// that look alike pass every one of them individually. The first contact sheet
// found twenty different solids behind twenty near-identical pale walls, and
// the only instrument that could have found it is one that looks at the whole
// set at once.
//
// The distance function lives in palette.ts so that this and palette.test.ts
// agree by construction — a number printed here and a number asserted in CI
// that could drift apart is worse than neither.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseLevel } from '../src/sim/level.ts';
import { levelPalette, paletteDistance, SET_MIN_DISTANCE } from '../src/client/art/palette.ts';
import { hexRgb, hueOf, lum } from '../src/client/art/color.ts';

const dir = join(process.cwd(), 'levels');
const files = readdirSync(dir).filter((f) => /^\d\d-.*\.json$/.test(f)).sort();

/** HSV saturation — the one that says "how much colour is left in this". */
function sat(hex: string): number {
  const [r, g, b] = hexRgb(hex);
  const mx = Math.max(r, g, b);
  return mx === 0 ? 0 : (mx - Math.min(r, g, b)) / mx;
}

const rows = files.map((f) => {
  const level = parseLevel(JSON.parse(readFileSync(join(dir, f), 'utf8')));
  return { id: f.slice(0, 2), name: f.slice(3, -5), p: levelPalette(level.style, level.simHash) };
});

console.log('level                   wall top   wall bot   solid      lipTop     hue   lum    chroma');
for (const r of rows) {
  const w = r.p.wall[0];
  console.log(
    `  ${r.id} ${r.name.padEnd(18)} ${w}    ${r.p.wall[r.p.wall.length - 1]}    ${r.p.solid}    ${r.p.lipTop}   ` +
      `${hueOf(w).toFixed(0).padStart(3)}   ${lum(w).toFixed(3)}  ${sat(w).toFixed(2)}`,
  );
}

const sats = rows.map((r) => sat(r.p.wall[0]));
const lums = rows.map((r) => lum(r.p.wall[0]));
const span = (v: number[]): string => `${Math.min(...v).toFixed(2)} .. ${Math.max(...v).toFixed(2)}`;
console.log(`\nwall chroma spans ${span(sats)}   wall luminance spans ${span(lums)}`);
console.log('    (chroma bunched at the low end is the "a bright wall has no colour left to have" failure)');

const pairs: { a: string; b: string; d: number }[] = [];
for (let i = 0; i < rows.length; i++) {
  for (let j = i + 1; j < rows.length; j++) {
    pairs.push({ a: rows[i].id, b: rows[j].id, d: paletteDistance(rows[i].p, rows[j].p) });
  }
}
pairs.sort((x, y) => x.d - y.d);
console.log('\nclosest pairs — these are the ones at risk of reading as the same place:');
for (const p of pairs.slice(0, 8)) {
  console.log(`  ${p.a} / ${p.b}   ${p.d.toFixed(3)}${p.d < SET_MIN_DISTANCE ? '   BELOW THE FLOOR' : ''}`);
}
const mean = pairs.reduce((a, p) => a + p.d, 0) / pairs.length;
console.log(
  `\nmean pair distance ${mean.toFixed(3)}   closest ${pairs[0].d.toFixed(3)}   ` +
    `floor ${SET_MIN_DISTANCE}   pairs under the floor: ${pairs.filter((p) => p.d < SET_MIN_DISTANCE).length}`,
);
console.log('\nThis is a proxy and not a verdict. Render the contact sheet —');
console.log('SHOTS_ONLY=art-62 bin/shots — and judge it as a set; if two levels still read');
console.log('as the same place, the generator is still too timid whatever this prints.');
process.exit(pairs[0].d < SET_MIN_DISTANCE ? 1 : 0);
