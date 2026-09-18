// bin/solve — find a run that completes a level, prove it, and score it.
//
// See bin/solve for the usage block and the why. This file is the CLI: argument
// parsing, the worker pool, and the report.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { parseSpec, cloneSpec } from '@/sim/spec.ts';
import { replayFileName } from '@/sim/replay.ts';
import { SIM_REV } from '@/sim/rev.ts';
import { BOOT_PRESET } from '@/client/presets.ts';
import { chooseRev, specOn } from './_rev.ts';
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
  /** Stream the search log as it happens. See `Job.progress`. */
  progress: boolean;
  /** Which physics. Defaults to the LIVE rev, never the newest one. */
  rev: number;
  /** rev 5's rider.inertialTransferLinear. */
  linear: number;
  /** Keep searching after the first run that works; return the fastest found. */
  optimise: boolean;
  /** Seconds the satisficing gate may take out of --time. 0 = a quarter of it. */
  gateTime: number;
  /** Metres per second the optimiser's ceiling prunes against. 0 = measure it. */
  boundVref: number;
  /** 'greedy', or an explicit comma-separated apple order. Undefined = search it. */
  order?: number[] | 'greedy';
  /** Search with a rider's hands rather than a solver's. See src/solver/human.ts. */
  human: boolean;
  /** Human-sized fumbles behind the slip axis. Always measured, --human or not. */
  humanTrials: number;
  /** Timing error per boundary, input frames. 4 is 31 ms. */
  humanSigma: number;
  /** Solve a second time with nearest-apple-first forced and report the spread. */
  tension: boolean;
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
    branch: 4, tries: 2, trials: 200, seed: 0x5e1f, quiet: false, progress: false,
    rev: SIM_REV, linear: 0,
    optimise: false, gateTime: 0, boundVref: 0,
    human: false, humanTrials: 100, humanSigma: 4,
    tension: false,
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
    else if (s === '--rev') a.rev = Math.round(num(argv[++i], '--rev'));
    else if (s === '--linear') a.linear = num(argv[++i], '--linear');
    else if (s === '--optimise' || s === '--optimize') a.optimise = true;
    else if (s === '--human') a.human = true;
    else if (s === '--tension') a.tension = true;
    // The slip test is no longer behind --human — it is the score's primary
    // axis — so it has its own names. The --human-* spellings stay because they
    // are what the README and the shell history say.
    else if (s === '--slip-trials' || s === '--human-trials') a.humanTrials = Math.round(num(argv[++i], s));
    else if (s === '--slip-sigma' || s === '--human-sigma') a.humanSigma = num(argv[++i], s);
    else if (s === '--gate-time') a.gateTime = num(argv[++i], '--gate-time');
    else if (s === '--bound-vref') a.boundVref = num(argv[++i], '--bound-vref');
    else if (s === '--order') {
      const v = argv[++i] ?? die('--order needs greedy or a comma-separated apple order');
      if (v === 'greedy') a.order = 'greedy';
      else {
        const list = v.split(',').map((x) => Math.round(num(x, '--order')));
        if (list.some((x) => x < 0)) die('--order takes apple indices, which start at 0');
        a.order = list;
      }
    }
    else if (s === '--quiet') a.quiet = true;
    else if (s === '--progress') a.progress = true;
    else if (s.startsWith('-')) die(`unknown option ${s}`);
    else a.files.push(s);
  }
  if (a.files.length === 0) die('usage: bin/solve <level.json> [more.json ...] [--save <dir|file>] [--jobs N] [--time SECONDS] [--optimise [--gate-time SECONDS] [--tension] [--order greedy|i,j,k]]');
  if (!a.optimise && (a.gateTime > 0 || a.order !== undefined)) {
    // Silently ignoring these would be the worst of the three options: --order
    // without --optimise is a plausible thing to type for a route experiment
    // and it does in fact do something, so it is allowed; --gate-time without
    // --optimise names a phase that does not exist.
    if (a.gateTime > 0) die('--gate-time is only meaningful with --optimise; without it the whole --time IS the gate');
  }
  if (a.save !== undefined && a.files.length > 1) {
    const isDir = a.save.endsWith('/') || (existsSync(a.save) && statSync(a.save).isDirectory());
    if (!isDir) die('--save <file> takes one level; pass a directory (trailing /) to solve several');
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
const CHOICE = chooseRev(args.rev, args.linear);
const baseSpec = args.spec
  ? parseSpec(JSON.parse(readFileSync(args.spec, 'utf8')))
  : cloneSpec(BOOT_PRESET.spec);
// The presets are rev-4 shaped; `specOn` adds the rev's extra fields on the way
// past rather than editing what the game ships on. See bin/_rev.ts.
const spec = specOn(CHOICE, baseSpec);
const bike = args.spec ? 'custom' : CHOICE.rev === SIM_REV ? BOOT_PRESET.id : `${BOOT_PRESET.id}-r${CHOICE.rev}`;

const jobOf = (file: string): Job => ({
  file,
  rev: CHOICE.rev,
  spec: spec as unknown,
  bike,
  timeBudgetMs: Math.round(args.time * 1000),
  effort: args.effort,
  branch: args.branch,
  targetTries: args.tries,
  trials: args.trials,
  seed: args.seed,
  wantReplay: args.save !== undefined,
  progress: args.progress,
  optimise: args.optimise,
  gateBudgetMs: args.gateTime > 0 ? Math.round(args.gateTime * 1000) : undefined,
  boundVref: args.boundVref,
  order: args.order,
  human: args.human,
  humanTrials: args.humanTrials,
  humanSigma: args.humanSigma,
  tension: args.tension,
});

function pct(v: number): string {
  return (v * 100).toFixed(0) + '%';
}

function report(file: string, o: Outcome, tail = ''): void {
  console.log((o.solved ? '==> SOLVED     ' : '==> UNSOLVED   ') + file + tail);
  console.log('    ' + o.name + '   (rev ' + CHOICE.rev
    + (CHOICE.rev >= 5 ? ', linear ' + CHOICE.linear : '')
    + ', ' + o.apples + ' apples)');
  if (!args.quiet && !args.progress) for (const l of o.log) console.log(l);
  if (o.solved) {
    console.log('    time            ' + o.seconds.toFixed(2) + ' s of game time, ' + o.frames + ' input frames'
      + (o.verified ? '  (re-verified)' : '  (NOT VERIFIED)'));
    if (args.optimise && o.gateSeconds > 0) {
      const saved = o.gateSeconds - o.seconds;
      console.log('    optimised from  ' + o.gateSeconds.toFixed(2) + ' s — ' + saved.toFixed(2) + ' s faster ('
        + (o.gateSeconds > 0 ? ((saved / o.gateSeconds) * 100).toFixed(0) : '0') + '%) over '
        + o.rounds.length + ' round' + (o.rounds.length === 1 ? '' : 's'));
    }
    if (o.forcedOrder) console.log('    order forced    ' + o.forcedOrder.join(' -> '));
    console.log('    par             ' + (o.par ?? 0).toFixed(2) + ' s'
      + (o.parMode === 'optimised'
        ? '  (optimised — a target)'
        : '  (one satisficing pass — an upper bound, not a target)'));
    console.log('    apple order     ' + (o.appleOrder.length ? o.appleOrder.join(' -> ') : '(none)'));
    if (o.tension) {
      const t = o.tension;
      console.log('    route tension   ' + (t.greedySeconds === null
        ? 'nearest-first cannot do this level at all'
        : t.searchedSeconds.toFixed(2) + ' s searched vs ' + t.greedySeconds.toFixed(2) + ' s nearest-first — '
          + t.spreadSeconds.toFixed(2) + ' s apart')
        + (t.real ? '  (a finding: over the ' : '  (noise: under the ') + t.noiseFloorSeconds + ' s floor)');
    }
    const d = o.difficulty;
    if (d) {
      console.log('    difficulty      ' + d.score.toFixed(0) + '/100'
        + '   slip ' + d.slip.toFixed(2)
        + '  clearance ' + d.clearance.toFixed(2)
        + '   [on the ' + d.measuredOn + ' line, scoreRev ' + d.scoreRev + ']');
      console.log('    human slip      ' + pct(d.humanSlip.lethal) + ' of ' + d.humanSlip.trials
        + ' human-sized fumbles are fatal, ' + pct(d.humanSlip.finished) + ' still finish'
        + '  (' + d.humanSlip.burst + ' inputs, sigma ' + (d.humanSlip.sigmaFrames * (1000 / 128)).toFixed(0) + ' ms)');
      console.log('    head clearance  ' + d.line.minHeadClearance.toFixed(3) + ' m at ('
        + d.line.atX.toFixed(1) + ', ' + d.line.atY.toFixed(1) + ')');
      console.log('    diagnostics     nudge ' + d.nudge.toFixed(2)
        + '  effort ' + d.effort.toFixed(2)
        + '  lethality ' + d.lethality.toFixed(2)
        + '   (none of these are in the score — they measure the search)');
      console.log('    the line        ' + pct(d.line.airFraction) + ' airborne, peak '
        + d.line.maxSpeed.toFixed(1) + ' m/s, ' + d.line.flips + ' flips, ' + d.routeMetres.toFixed(0) + ' m of route');
    }
  } else {
    console.log('    unrated         ' + (o.unrated ?? 'unsolved')
      + (o.unrated === 'zero-apples'
        ? ' — no apples, so the search is one leg steered by distance-to-flower. See bin/solve.'
        : ''));
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
    const level = CHOICE.engine.parseLevel(raw);
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
      + '  par ' + (o.par === null ? '     — ' : o.par.toFixed(1).padStart(6) + ' s')
      + '  ' + (o.wallMs / 1000).toFixed(0).padStart(4) + ' s search'
      + '  ' + file);
  }
  console.log('    ' + (outcomes.length - bad) + '/' + outcomes.length + ' solved');
}

if (args.json !== undefined) {
  const payload = outcomes.map(({ file, o }) => ({
    file, name: o.name, simRev: CHOICE.rev, linear: CHOICE.rev >= 5 ? CHOICE.linear : undefined, solved: o.solved, seconds: o.seconds, frames: o.frames,
    appleOrder: o.appleOrder, apples: o.apples, routeMetres: o.routeMetres,
    // `precision` rides along as an alias for `nudge` and is the only
    // back-compat shim in here. The level editor reads this payload over HTTP
    // (src/client/editor/solve.ts) and renders `d.precision` directly, so
    // dropping the name would crash the editor's report rather than change a
    // number. It is the same value under the old name and it should go the day
    // that file reads `slip` and `nudge`.
    difficulty: o.difficulty === null ? null : { ...o.difficulty, precision: o.difficulty.nudge },
    optimised: args.optimise, gateSeconds: o.gateSeconds, rounds: o.rounds, forcedOrder: o.forcedOrder,
    par: o.par, parMode: o.parMode, tension: o.tension, unrated: o.unrated,
    // The mode every stored row has to carry. A number that does not say how it
    // was measured cannot be compared to another number.
    mode: {
      line: o.parMode,
      hands: args.human ? 'human' : 'solver',
      budgetSeconds: args.time,
      slipTrials: args.humanTrials,
      slipSigmaMs: Number((args.humanSigma * (1000 / 128)).toFixed(1)),
      nudgeTrials: args.trials,
      seed: args.seed,
      effort: args.effort,
    },
    human: args.human,
    expansions: o.expansions, simFrames: o.simFrames, deaths: o.deaths, wallMs: o.wallMs,
    segments: o.segments, retried: o.retried, failure: o.failure, verified: o.verified,
  }));
  writeFileSync(args.json, JSON.stringify(payload, null, 2) + '\n');
  console.log('==> wrote ' + args.json);
}

process.exit(bad ? 1 : 0);
