// bin/solve — find a run that completes a level, prove it, and score it.
//
// See bin/solve for the usage block and the why. This file is the CLI: argument
// parsing, the worker pool, and the report.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { parseLevel } from '@/sim/level.ts';
import { parseSpec, cloneSpec } from '@/sim/spec.ts';
import { replayFileName } from '@/sim/replay.ts';
import { SIM_REV } from '@/sim/rev.ts';
import { BOOT_PRESET } from '@/client/presets.ts';
import { solveOne } from './_solve-run.ts';
import type { Job, Outcome } from './_solve-run.ts';

interface Args {
  files: string[];
  save?: string;
  json?: string;
  jobs: number;
  time: number;
  effort: number;
  branch: number;
  tries: number;
  trials: number;
  seed: number;
  spec?: string;
  quiet: boolean;
}

function die(msg: string): never {
  console.error(msg);
  process.exit(2);
}

function num(v: string | undefined, what: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) die(`${what} needs a number`);
  return n;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    files: [], jobs: 1, time: 300, effort: 1,
    branch: 4, tries: 2, trials: 200, seed: 0x5e1f, quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (s === '--save') a.save = argv[++i] ?? die('--save needs a path');
    else if (s === '--json') a.json = argv[++i] ?? die('--json needs a path');
    else if (s === '--jobs') a.jobs = Math.max(1, Math.round(num(argv[++i], '--jobs')));
    else if (s === '--time') a.time = num(argv[++i], '--time');
    else if (s === '--effort') a.effort = num(argv[++i], '--effort');
    else if (s === '--branch') a.branch = Math.round(num(argv[++i], '--branch'));
    else if (s === '--tries') a.tries = Math.round(num(argv[++i], '--tries'));
    else if (s === '--trials') a.trials = Math.round(num(argv[++i], '--trials'));
    else if (s === '--seed') a.seed = Math.round(num(argv[++i], '--seed'));
    else if (s === '--spec') a.spec = argv[++i] ?? die('--spec needs a path');
    else if (s === '--quiet') a.quiet = true;
    else if (s.startsWith('-')) die(`unknown option ${s}`);
    else a.files.push(s);
  }
  if (a.files.length === 0) die('usage: bin/solve <level.json> [more.json ...] [--save <dir|file>] [--jobs N] [--time SECONDS]');
  if (a.save !== undefined && a.files.length > 1) {
    const isDir = a.save.endsWith('/') || (existsSync(a.save) && statSync(a.save).isDirectory());
    if (!isDir) die('--save <file> takes one level; pass a directory (trailing /) to solve several');
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
const spec = args.spec ? parseSpec(JSON.parse(readFileSync(args.spec, 'utf8'))) : cloneSpec(BOOT_PRESET.spec);
const bike = args.spec ? 'custom' : BOOT_PRESET.id;

const jobOf = (file: string): Job => ({
  file,
  spec: spec as unknown,
  bike,
  timeBudgetMs: Math.round(args.time * 1000),
  effort: args.effort,
  branch: args.branch,
  targetTries: args.tries,
  trials: args.trials,
  seed: args.seed,
  wantReplay: args.save !== undefined,
});

function pct(v: number): string {
  return (v * 100).toFixed(0) + '%';
}

function report(file: string, o: Outcome, tail = ''): void {
  console.log((o.solved ? '==> SOLVED     ' : '==> UNSOLVED   ') + file + tail);
  console.log('    ' + o.name + '   (rev ' + SIM_REV + ', ' + o.apples + ' apples)');
  if (!args.quiet) for (const l of o.log) console.log(l);
  if (o.solved) {
    console.log('    time            ' + o.seconds.toFixed(2) + ' s of game time, ' + o.frames + ' input frames'
      + (o.verified ? '  (re-verified)' : '  (NOT VERIFIED)'));
    console.log('    apple order     ' + (o.appleOrder.length ? o.appleOrder.join(' -> ') : '(none)'));
    const d = o.difficulty;
    if (d) {
      console.log('    difficulty      ' + d.score.toFixed(0) + '/100'
        + '   precision ' + d.precision.toFixed(2)
        + '  clearance ' + d.clearance.toFixed(2)
        + '  effort ' + d.effort.toFixed(2)
        + '  lethality ' + d.lethality.toFixed(2));
      console.log('    slip test       ' + pct(d.tolerance.lethal) + ' of one-frame slips are fatal, '
        + pct(d.tolerance.finished) + ' still finish  (' + d.tolerance.trials + ' trials)');
      console.log('    head clearance  ' + d.line.minHeadClearance.toFixed(3) + ' m at ('
        + d.line.atX.toFixed(1) + ', ' + d.line.atY.toFixed(1) + ')');
      console.log('    the line        ' + pct(d.line.airFraction) + ' airborne, peak '
        + d.line.maxSpeed.toFixed(1) + ' m/s, ' + d.line.flips + ' flips, ' + d.routeMetres.toFixed(0) + ' m of route');
    }
  } else {
    console.log('    stopped at      ' + (o.failure ?? 'unknown'));
  }
  console.log('    search          ' + o.expansions.toLocaleString('en-US') + ' expansions, '
    + (o.simFrames / 1e6).toFixed(1) + 'M input frames simulated, '
    + o.deaths.toLocaleString('en-US') + ' deaths, ' + o.segments + ' segments (' + o.retried + ' needed a retry)');
  console.log('    cost            ' + (o.wallMs / 1000).toFixed(1) + ' s wall clock, '
    + (o.nodeBytes / 1e6).toFixed(0) + ' MB of nodes');
}

function save(dest: string, o: Outcome): void {
  if (!o.replay) return;
  const isDir = dest.endsWith('/') || (existsSync(dest) && statSync(dest).isDirectory());
  let out = dest;
  if (isDir) {
    mkdirSync(dest, { recursive: true });
    out = join(dest, replayFileName(o.replay, 'solve'));
  }
  writeFileSync(out, JSON.stringify(o.replay, null, 2) + '\n');
  console.log('    saved           ' + out);
  console.log('                    watch it: bin/replay ' + out + '   or load it in the client with L');
}

/**
 * The worker pool.
 *
 * `execArgv: process.execArgv` is NOT decoration. Under `tsx` the loader is
 * carried on execArgv, a worker that does not inherit it cannot resolve a
 * single `@/` import, and it dies before running a line — which looks from out
 * here exactly like a slow level. So: inherit it explicitly, demand a handshake
 * within HANDSHAKE_MS, and fail loudly with the reason rather than hanging.
 */
const HANDSHAKE_MS = 20000;

async function runPool(
  files: string[],
  jobs: number,
  onDone: (file: string, r: Outcome | string) => void,
): Promise<Map<string, Outcome | string>> {
  const results = new Map<string, Outcome | string>();
  const queue = [...files];
  const url = new URL('./_solve-worker.ts', import.meta.url);
  const n = Math.min(jobs, files.length);

  await Promise.all(
    Array.from({ length: n }, () => new Promise<void>((resolve, reject) => {
      const w = new Worker(url, { execArgv: process.execArgv });
      let ready = false;
      let current: string | null = null;
      const hs = setTimeout(() => {
        if (!ready) {
          w.terminate();
          reject(new Error(
            'a solver worker did not report ready within ' + HANDSHAKE_MS / 1000 + ' s. ' +
            'Under tsx the TypeScript loader rides on process.execArgv; if it was not passed through, ' +
            'the worker cannot resolve its imports and dies silently. Re-run with --jobs 1.',
          ));
        }
      }, HANDSHAKE_MS);

      const next = (): void => {
        const f = queue.shift();
        if (f === undefined) { current = null; void w.terminate(); resolve(); return; }
        current = f;
        w.postMessage(jobOf(f));
      };

      w.on('message', (raw: unknown) => {
        const m = raw as { kind: string; file?: string; result?: Outcome; error?: string };
        if (m.kind === 'ready') { ready = true; clearTimeout(hs); next(); return; }
        if (m.kind === 'done') {
          const f = m.file as string;
          const r = m.result ?? (m.error ?? 'worker returned nothing');
          results.set(f, r);
          // Reported the moment it lands rather than at the end. A twenty-level
          // run is twenty minutes; a tool that prints nothing for twenty
          // minutes is indistinguishable from a hung one.
          onDone(f, r);
          next();
        }
      });
      w.on('error', (e) => { clearTimeout(hs); if (current) results.set(current, String(e)); reject(e); });
      w.on('exit', () => { clearTimeout(hs); resolve(); });
    })),
  );
  return results;
}

let bad = 0;
const outcomes: { file: string; o: Outcome }[] = [];

if (args.jobs > 1 && args.files.length > 1) {
  console.log('==> solving ' + args.files.length + ' levels on ' + Math.min(args.jobs, args.files.length) + ' workers');
  let landed = 0;
  const total = args.files.length;
  const onDone = (f: string, r: Outcome | string): void => {
    landed++;
    if (typeof r === 'string') {
      console.log('==> ERROR      ' + f + '   [' + landed + '/' + total + ']');
      console.log('    ' + r);
      bad++;
      return;
    }
    report(f, r, '   [' + landed + '/' + total + ']');
    if (args.save !== undefined) save(args.save, r);
    outcomes.push({ file: f, o: r });
    if (!r.solved) bad++;
  };
  try {
    await runPool(args.files, args.jobs, onDone);
  } catch (e) {
    // A worker that dies takes its level with it; say so rather than exiting on
    // an unhandled rejection with a stack trace and no context.
    console.error('==> the worker pool failed: ' + (e instanceof Error ? e.message : String(e)));
    process.exit(2);
  }
} else {
  for (const f of args.files) {
    const raw: unknown = JSON.parse(readFileSync(f, 'utf8'));
    const level = parseLevel(raw);
    const o = solveOne(jobOf(f), level, spec, raw);
    report(f, o);
    if (args.save !== undefined) save(args.save, o);
    outcomes.push({ file: f, o });
    if (!o.solved) bad++;
  }
}

if (outcomes.length > 1) {
  console.log('==> summary');
  const rows = [...outcomes].sort((a, b) => (b.o.difficulty?.score ?? -1) - (a.o.difficulty?.score ?? -1));
  for (const { file, o } of rows) {
    const d = o.difficulty;
    console.log('    ' + (o.solved ? 'ok  ' : 'FAIL')
      + ' ' + (d ? String(Math.round(d.score)).padStart(3) : '  -') + '/100'
      + '  ' + (o.solved ? o.seconds.toFixed(1).padStart(6) + ' s' : '     — ')
      + '  ' + (o.wallMs / 1000).toFixed(0).padStart(4) + ' s search'
      + '  ' + file);
  }
  console.log('    ' + (outcomes.length - bad) + '/' + outcomes.length + ' solved');
}

if (args.json !== undefined) {
  const payload = outcomes.map(({ file, o }) => ({
    file, name: o.name, simRev: SIM_REV, solved: o.solved, seconds: o.seconds, frames: o.frames,
    appleOrder: o.appleOrder, apples: o.apples, difficulty: o.difficulty, routeMetres: o.routeMetres,
    expansions: o.expansions, simFrames: o.simFrames, deaths: o.deaths, wallMs: o.wallMs,
    segments: o.segments, retried: o.retried, failure: o.failure, verified: o.verified,
  }));
  writeFileSync(args.json, JSON.stringify(payload, null, 2) + '\n');
  console.log('==> wrote ' + args.json);
}

process.exit(bad ? 1 : 0);
