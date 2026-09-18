// Solve one level and package the answer, shared by the in-process path and
// the worker path so that `--jobs 1` and `--jobs 8` cannot drift apart.
import { getEngine } from '@/sim/rev.ts';
import { toReplayFile } from '@/sim/replay.ts';
import type { ReplayFile } from '@/sim/replay.ts';
import type { Level } from '@/sim/level.ts';
import type { BikeSpec } from '@/sim/spec.ts';
import { solveLevel, DEFAULT_SOLVE } from '@/solver/solve.ts';
import { optimiseLevel, greedyOrder } from '@/solver/optimise.ts';
import type { OptimiseRound } from '@/solver/optimise.ts';
import { HUMAN_DURATIONS, measureHumanSlip } from '@/solver/human.ts';
import type { HumanSlip } from '@/solver/human.ts';
import { scoreDifficulty } from '@/solver/difficulty.ts';
import type { Difficulty } from '@/solver/difficulty.ts';

/** Must divide the frame count the same way the client's recorder does. */
export const HASH_EVERY = 64;

export interface Job {
  file: string;
  /** Which physics rev to search, verify and stamp the replay with. */
  rev: number;
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
  /**
   * Print the search log AS IT HAPPENS rather than only in the final report.
   *
   * A single-level solve prints nothing for one to fourteen minutes otherwise,
   * which is indistinguishable from a hung process — and it is unusable as the
   * editor's deliberate feedback tier, which has to be able to say what the
   * solver is doing while it does it. Off by default so `bin/solve levels/*`
   * keeps its per-level report shape.
   */
  progress?: boolean;
  /**
   * Keep searching after the first run that works and return the fastest found.
   *
   * See src/solver/optimise.ts. `timeBudgetMs` then covers the whole thing —
   * the satisficing gate that produces the first bound AND the optimising
   * rounds that beat it — with `gateBudgetMs` capping the gate's share.
   */
  optimise?: boolean;
  gateBudgetMs?: number;
  /** Metres per second the optimiser's ceiling prunes against. 0 = measure it. */
  boundVref?: number;
  /**
   * Collect the apples in exactly this order. 'greedy' means nearest-first,
   * recomputed as apples are collected, which is the baseline route tension is
   * measured against.
   */
  order?: number[] | 'greedy';
  /**
   * Search with a rider's hands rather than a solver's: held inputs no shorter
   * than 94 ms and every boundary on a 31 ms grid, then ride the answer badly
   * on purpose and count how often it still finishes. See src/solver/human.ts.
   */
  human?: boolean;
  /** Jitter trials for the human slip test. */
  humanTrials?: number;
  /** Timing error per boundary, input frames. 4 is 31 ms. */
  humanSigma?: number;
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
  /** Optimising mode only: what the cheap satisficing gate got, seconds. */
  gateSeconds: number;
  rounds: OptimiseRound[];
  /** Human mode only: how often a human-sized slip still finishes the run. */
  slip: HumanSlip | null;
  /** The order the run actually collected the apples in, as asked for. */
  forcedOrder: number[] | null;
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
  const engine = getEngine(job.rev);
  const onProgress = (l: string): void => {
    log.push(l);
    // Straight out, unbuffered by anything of ours, so a reader on the other
    // end of a pipe sees it now rather than at exit.
    if (job.progress) console.log(l);
  };
  const forced = job.order === 'greedy' ? greedyOrder(level) : (job.order ?? null);
  // The alphabet is the whole of the rate limit: `search` is the only thing
  // that decides how long a held input may last, so constraining it here
  // constrains every strategy, both modes and every round at once.
  const searchOver = job.human ? { durations: HUMAN_DURATIONS } : {};
  let rounds: OptimiseRound[] = [];
  let gateSeconds = 0;
  // Effort and lethality are scored on the GATE's search, always — see
  // OptimiseResult.gateExpansions for why. In plain mode the gate IS the search.
  let effortExpansions: number;
  let effortDeaths: number;
  let effortMetres: number;
  let r;

  if (job.optimise) {
    const o = optimiseLevel(level, spec, {
      rev: job.rev,
      timeBudgetMs: job.timeBudgetMs,
      gateBudgetMs: job.gateBudgetMs ?? Math.min(job.timeBudgetMs / 4, 240000),
      effort: job.effort,
      branch: job.branch,
      targetTries: job.targetTries,
      boundVref: job.boundVref ?? 0,
      forceOrder: forced ?? undefined,
      forceGate: forced !== null,
      search: searchOver,
      onProgress,
    });
    r = o.best;
    rounds = o.rounds;
    gateSeconds = o.gateFrames / 128;
    effortExpansions = o.gateExpansions;
    effortDeaths = o.gateDeaths;
    effortMetres = o.gateRouteMetres;
  } else {
    r = solveLevel(level, spec, {
      rev: job.rev,
      timeBudgetMs: job.timeBudgetMs,
      strategies: DEFAULT_SOLVE.strategies.map((s) => ({ ...s, budget: Math.round(s.budget * job.effort) })),
      branch: job.branch,
      targetTries: job.targetTries,
      forceOrder: forced ?? undefined,
      search: searchOver,
      onProgress,
    });
    gateSeconds = r.solved ? r.frames / 128 : 0;
    effortExpansions = r.totals.expansions;
    effortDeaths = r.totals.deaths;
    effortMetres = r.routeMetres;
  }

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
    // "Needed a retry" means a search that did not get where it was sent. In
    // plain mode that is a leg that fell past its first strategy; in optimising
    // mode every round runs one strategy and the same fact is simply a segment
    // that failed, which is what is counted here.
    retried: job.optimise
      ? r.segments.filter((sg) => !sg.ok).length
      : r.segments.filter((sg) => sg.strategy !== DEFAULT_SOLVE.strategies[0].name).length,
    failure: null,
    replay: null,
    verified: false,
    log,
    gateSeconds,
    rounds,
    slip: null,
    forcedOrder: forced,
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
  const sim = engine.createSim(level, spec);
  const hashes: string[] = [];
  for (let f = 0; f < r.masks.length; f++) {
    sim.advance(r.masks[f]);
    if ((f + 1) % HASH_EVERY === 0) hashes.push(sim.hash());
  }
  const replay = engine.buildReplay({ level, spec, masks: r.masks, hashEvery: HASH_EVERY, hashes, state: sim.state, bike: job.bike });
  const v = engine.verifyReplay(level, spec, replay);
  out.verified = v.ok && sim.state.finished && !sim.state.dead && sim.state.applesLeft === 0;
  if (!out.verified) {
    out.solved = false;
    out.failure = `the solution did not re-verify: ${v.reason ?? 'finished=' + sim.state.finished + ' dead=' + sim.state.dead}`;
    return out;
  }

  out.difficulty = scoreDifficulty({
    level, spec, masks: r.masks,
    expansions: effortExpansions, deaths: effortDeaths, routeMetres: effortMetres,
    trials: job.trials, seed: job.seed, rev: job.rev,
  });

  if (job.human) {
    out.slip = measureHumanSlip(level, spec, r.masks, {
      trials: job.humanTrials, sigmaFrames: job.humanSigma, seed: job.seed, rev: job.rev,
    });
  }

  if (job.wantReplay) {
    out.replay = toReplayFile(replay, {
      level: raw,
      levelName: level.name,
      spec,
      recordedAt: new Date().toISOString(),
      note: `bin/solve${job.optimise ? ' --optimise' : ''} on sim rev ${job.rev}, ${r.totals.expansions} expansions, apple order ${r.appleOrder.join('-')}`,
    });
  }
  return out;
}
