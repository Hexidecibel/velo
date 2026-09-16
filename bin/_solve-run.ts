// Solve one level and package the answer, shared by the in-process path and
// the worker path so that `--jobs 1` and `--jobs 8` cannot drift apart.
import { createSim } from '@/sim/sim.ts';
import { buildReplay, toReplayFile, verifyReplay } from '@/sim/replay.ts';
import type { ReplayFile } from '@/sim/replay.ts';
import type { Level } from '@/sim/level.ts';
import type { BikeSpec } from '@/sim/spec.ts';
import { solveLevel, DEFAULT_SOLVE } from '@/solver/solve.ts';
import { scoreDifficulty } from '@/solver/difficulty.ts';
import type { Difficulty } from '@/solver/difficulty.ts';

/** Must divide the frame count the same way the client's recorder does. */
export const HASH_EVERY = 64;

export interface Job {
  file: string;
  /** Raw BikeSpec-shaped object; workers re-parse it rather than trust it. */
  spec: unknown;
  bike: string;
  timeBudgetMs: number;
  /** Multiplies every strategy's expansion budget. 1 is the default effort. */
  effort: number;
  branch: number;
  targetTries: number;
  trials: number;
  seed: number;
  /** Embed the level and spec in the replay so the file stands alone. */
  wantReplay: boolean;
}

export interface Outcome {
  name: string;
  solved: boolean;
  /** Game time of the winning run, seconds. Zero when unsolved. */
  seconds: number;
  frames: number;
  appleOrder: number[];
  apples: number;
  difficulty: Difficulty | null;
  routeMetres: number;
  expansions: number;
  simFrames: number;
  deaths: number;
  nodeBytes: number;
  wallMs: number;
  segments: number;
  /** Searches that had to fall back past the first strategy. */
  retried: number;
  failure: string | null;
  replay: ReplayFile | null;
  verified: boolean;
  log: string[];
}

export interface Done {
  kind: 'done';
  file: string;
  result?: Outcome;
  error?: string;
}

export function solveOne(job: Job, level: Level, spec: BikeSpec, raw: unknown): Outcome {
  const log: string[] = [];
  const t0 = Date.now();
  const r = solveLevel(level, spec, {
    timeBudgetMs: job.timeBudgetMs,
    strategies: DEFAULT_SOLVE.strategies.map((s) => ({ ...s, budget: Math.round(s.budget * job.effort) })),
    branch: job.branch,
    targetTries: job.targetTries,
    onProgress: (l) => log.push(l),
  });

  const out: Outcome = {
    name: level.name,
    solved: r.solved,
    seconds: r.frames / 128,
    frames: r.frames,
    appleOrder: r.appleOrder,
    apples: level.apples.length,
    difficulty: null,
    routeMetres: r.routeMetres,
    expansions: r.totals.expansions,
    simFrames: r.totals.frames,
    deaths: r.totals.deaths,
    nodeBytes: r.poolBytes,
    wallMs: Date.now() - t0,
    segments: r.segments.length,
    retried: r.segments.filter((s) => s.strategy !== DEFAULT_SOLVE.strategies[0].name).length,
    failure: null,
    replay: null,
    verified: false,
    log,
  };

  if (!r.solved) {
    const f = r.failure;
    out.failure = f
      ? `${f.target < 0 ? 'the flower' : `apple ${f.target}`} at (${f.targetX}, ${f.targetY}): ` +
        `stopped ${Number.isFinite(f.closest) ? f.closest.toFixed(1) + ' m' : 'never started'} short` +
        (Number.isFinite(f.closestX) ? `, best at (${f.closestX.toFixed(1)}, ${f.closestY.toFixed(1)})` : '') +
        ` — ${f.reason}`
      : 'no route found';
    return out;
  }

  // Re-simulate the winning stream from scratch. The search built it a segment
  // at a time from snapshots; this is the only thing that proves the whole
  // chain is one run, and it is also where the periodic hashes come from.
  const sim = createSim(level, spec);
  const hashes: string[] = [];
  for (let f = 0; f < r.masks.length; f++) {
    sim.advance(r.masks[f]);
    if ((f + 1) % HASH_EVERY === 0) hashes.push(sim.hash());
  }
  const replay = buildReplay({ level, spec, masks: r.masks, hashEvery: HASH_EVERY, hashes, state: sim.state, bike: job.bike });
  const v = verifyReplay(level, spec, replay);
  out.verified = v.ok && sim.state.finished && !sim.state.dead && sim.state.applesLeft === 0;
  if (!out.verified) {
    out.solved = false;
    out.failure = `the solution did not re-verify: ${v.reason ?? 'finished=' + sim.state.finished + ' dead=' + sim.state.dead}`;
    return out;
  }

  out.difficulty = scoreDifficulty({
    level, spec, masks: r.masks,
    expansions: r.totals.expansions, deaths: r.totals.deaths, routeMetres: r.routeMetres,
    trials: job.trials, seed: job.seed,
  });

  if (job.wantReplay) {
    out.replay = toReplayFile(replay, {
      level: raw,
      levelName: level.name,
      spec,
      recordedAt: new Date().toISOString(),
      note: `bin/solve, ${r.totals.expansions} expansions, apple order ${r.appleOrder.join('-')}`,
    });
  }
  return out;
}
