// Drive a level headlessly and report whether every apple and the flower can
// actually be reached — and, with --save, hand back the run it found as a
// replay you can watch.
//
// bin/level-check validates GEOMETRY. It cannot tell you whether a level is
// COMPLETABLE, and the first hand-authored level in this repo shipped with
// apples nobody could reach. This is the cheap answer to that: a scripted rider
// run over a few route variations.
//
// It is a lower bound, not a proof: "some run reached it" means reachable, and
// "no run reached it" means only that this rider could not.
//
// WHY --save EXISTS: the pilot used to find a winning run and throw it away,
// which is a waste of the one thing determinism buys us. The input stream it
// found IS a replay; wrapping it in the standard container costs nothing and
// turns "the computer can do it" into "watch the computer do it" — load the
// file in the client with L or drag-and-drop, or re-run it with bin/replay.
// Deliberately NOT a second file format: same envelope, same verifier, same
// SIM_REV refusal on a physics change.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseLevel } from '../src/sim/level.ts';
import type { Level } from '../src/sim/level.ts';
import { createSim } from '../src/sim/sim.ts';
import { buildReplay, toReplayFile, replayFileName, verifyReplay } from '../src/sim/replay.ts';
import { probeAll } from './_pilot.ts';
import type { Cap, Run } from './_pilot.ts';
import { BOOT_PRESET } from '../src/client/presets.ts';
import type { BikeSpec } from '../src/sim/spec.ts';

/** Must divide the frame count the same way the client's recorder does. */
const HASH_EVERY = 64;

interface Args { files: string[]; save?: string }

function parseArgs(argv: string[]): Args {
  const out: Args = { files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--save') {
      out.save = argv[++i];
      if (out.save === undefined) die('--save needs a path');
    } else if (a.startsWith('-')) die(`unknown option ${a}`);
    else out.files.push(a);
  }
  if (out.files.length === 0) die('usage: bin/level-drive <file.json> [more.json ...] [--save <dir|file>]');
  return out;
}

function die(msg: string): never {
  console.error(msg);
  process.exit(2);
}

/**
 * Re-run the masks the pilot found, collecting the periodic state hashes the
 * verifier will re-derive. Re-running rather than hashing during the search is
 * deliberate: the pilot tries many runs and only one of them is the answer, and
 * a replay must be built from exactly the stream that is written out.
 */
function record(level: Level, spec: BikeSpec, masks: readonly number[]) {
  const sim = createSim(level, spec);
  const hashes: string[] = [];
  for (let f = 0; f < masks.length; f++) {
    sim.advance(masks[f]);
    if ((f + 1) % HASH_EVERY === 0) hashes.push(sim.hash());
  }
  return buildReplay({ level, spec, masks, hashEvery: HASH_EVERY, hashes, state: sim.state, bike: BOOT_PRESET.id });
}

const args = parseArgs(process.argv.slice(2));
let bad = 0;

for (const f of args.files) {
  const raw: unknown = JSON.parse(readFileSync(f, 'utf8'));
  const lvl = parseLevel(raw);
  const span = lvl.maxX - lvl.minX;
  // Route variations: straight through, or easing off over each sixth of the
  // level so that anything down a hole gets a chance to be dropped into.
  const routes: Cap[][] = [[]];
  for (let i = 0; i < 6; i++) {
    const a = lvl.minX + (span * i) / 6;
    routes.push([[a, a + span / 6 + 2, 6]] as Cap[]);
  }
  const t0 = Date.now();
  const r = probeAll(lvl, BOOT_PRESET.spec, routes);
  const miss = r.ever.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  console.log((r.finished ? '==> DRIVEABLE  ' : '==> INCOMPLETE ') + f);
  console.log('    ' + lvl.name);
  console.log('    apples reached  ' + r.ever.filter(Boolean).length + '/' + lvl.apples.length
    + (miss.length ? '   NOT REACHED: ' + miss.map((i) => i + ' at (' + lvl.apples[i].x + ', ' + lvl.apples[i].y + ')').join(', ') : ''));
  console.log('    best run        ' + r.best.outcome + ' at x ' + r.best.x.toFixed(1) + ' after ' + r.best.seconds.toFixed(1) + ' s');
  console.log('    ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s of search');

  if (args.save !== undefined) save(args.save, f, raw, lvl, r.best);
  if (!r.finished) bad++;
}
process.exit(bad ? 1 : 0);

function save(dest: string, levelPath: string, raw: unknown, lvl: Level, best: Run): void {
  const spec = BOOT_PRESET.spec;
  const replay = record(lvl, spec, best.masks);
  // Refuse to hand over a file that does not verify. A replay the verifier
  // rejects is worse than none: it would read as a physics bug rather than as
  // a bug here.
  const v = verifyReplay(lvl, spec, replay);
  if (!v.ok) {
    console.log('    save            FAILED — the recorded stream does not verify: ' + v.reason);
    bad++;
    return;
  }
  const file = toReplayFile(replay, {
    level: raw,
    levelName: lvl.name,
    spec,
    recordedAt: new Date().toISOString(),
    note: 'bin/level-drive scripted pilot, ' + best.outcome + ', from ' + levelPath,
  });
  const isDir = dest.endsWith('/') || (existsSync(dest) && statSync(dest).isDirectory());
  let out = dest;
  if (isDir) {
    mkdirSync(dest, { recursive: true });
    out = join(dest, replayFileName(replay, 'pilot'));
  } else if (args.files.length > 1) {
    die('--save <file> takes one level; pass a directory (trailing /) to drive several');
  }
  writeFileSync(out, JSON.stringify(file, null, 2) + '\n');
  console.log('    saved           ' + out + '   (' + best.outcome + ', ' + best.masks.length + ' input frames, verified)');
  console.log('                    watch it: bin/replay ' + out + '   or load it in the client with L');
}
