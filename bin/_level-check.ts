// The real work behind bin/level-check. Underscore-prefixed because it is run
// BY a bin/ script rather than by hand, matching bin/_smoke.mjs.
//
// Two jobs, and the second is the interesting one:
//
//  1. Load every file through the real loader, so that whatever rejects a level
//     at load time rejects it HERE, with a message naming the polygon and the
//     vertex, instead of at 20 m/s as a bike that silently vanishes.
//
//  2. WARN about hand-authored straight runs that are too coarse. A wheel
//     rolling a chord of length L across a curve of radius R drops L^2/(8R)
//     below the true surface mid-chord; measured against the 0.25 m wheel that
//     is imperceptible at 0.25 m segments and a real jolt at 1 m segments on a
//     tight curve. So: estimate the curvature each vertex implies against its
//     two neighbours, compute the sag, and say so.
//
// This WARNS and never rejects. A deliberate hard edge is legitimate level
// design — test01 is made of them on purpose — and a tool that called that an
// error would be a tool people learn to ignore.
import { readFileSync } from 'node:fs';
import { parseLevel } from '../src/sim/level.ts';
import { sagFindings } from './_sag.ts';
import type { Finding } from './_sag.ts';

const mm = (v: number): string => (v * 1000).toFixed(1) + ' mm';
const n2 = (v: number): string => (Math.round(v * 100) / 100).toString();

let bad = 0;
let warned = 0;
for (const file of process.argv.slice(2)) {
  let lvl;
  try {
    lvl = parseLevel(JSON.parse(readFileSync(file, 'utf8')));
  } catch (e) {
    bad++;
    console.error('==> BAD  ' + file);
    console.error('    ' + (e instanceof Error ? e.message : String(e)));
    continue;
  }

  console.log('==> OK   ' + file);
  console.log('    name        ' + lvl.name);
  console.log('    simHash     ' + lvl.simHash + '   (leaderboards key on this)');
  console.log('    contentHash ' + lvl.contentHash);
  console.log('    ' + lvl.polys.length + ' collidable + ' + lvl.decor.length + ' decor, ' + lvl.apples.length + ' apples');
  if (lvl.arcCount > 0) {
    console.log(
      '    arcs        ' + lvl.arcCount + ' -> ' + lvl.arcSegments +
      ' generated vertices at sagTolerance ' + lvl.sagTolerance + ' m',
    );
    console.log('                changing that tolerance MOVES simHash and invalidates times');
  } else {
    console.log('    arcs        none (sagTolerance ' + lvl.sagTolerance + ' m would apply)');
  }
  console.log('    bounds      x ' + lvl.minX + '..' + lvl.maxX + '  y ' + lvl.minY + '..' + lvl.maxY);

  // --- sag warnings --------------------------------------------------------
  const all: { poly: number; f: Finding }[] = [];
  lvl.polys.forEach((p, pi) => {
    for (const f of sagFindings(p, lvl.sagTolerance)) all.push({ poly: pi, f });
  });
  if (all.length === 0) {
    console.log('    sag         clean — no straight run implies more than ' + mm(lvl.sagTolerance) + ' of sag');
    continue;
  }
  all.sort((a, b) => b.f.sag - a.f.sag);
  warned++;
  console.log(
    '    sag         ' + all.length + ' vertices imply more than ' + mm(lvl.sagTolerance) +
    ' of sag (worst ' + mm(all[0].f.sag) + ')',
  );
  const show = all.slice(0, 8);
  for (const { poly, f } of show) {
    console.log(
      '      warn      polygon ' + poly + ' at (' + n2(f.x) + ', ' + n2(f.y) + '): turns ' +
      f.turn.toFixed(1) + ' deg, so a ' + n2(f.chord) + ' m chord across the implied ' +
      n2(f.radius) + ' m curve sags ' + mm(f.sag),
    );
  }
  if (all.length > show.length) console.log('      ...       and ' + (all.length - show.length) + ' more');
  console.log('      note      this is a WARNING. A deliberate hard edge is legitimate level design.');
  console.log('      fix       replace the run with one arc entry, e.g. { "arcTo": [x, y], "bulge": metres }');
}

if (bad) console.error('\n' + bad + ' file(s) rejected');
else if (warned) console.log('\nloaded clean; ' + warned + ' file(s) have coarse runs — warnings only');
process.exit(bad ? 1 : 0);
