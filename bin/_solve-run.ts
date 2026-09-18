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
import { HUMAN_DURATIONS } from '@/solver/human.ts';
import { scoreDifficulty, tensionOf } from '@/solver/difficulty.ts';
import type { Difficulty, Line, LineMode, Tension } from '@/solver/difficulty.ts';

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
   * than 62.5 ms and every boundary on that grid. See src/solver/human.ts.
   *
   * The slip test is NOT behind this any more — it is the score's primary axis
   * and runs on every solve. This flag constrains the SEARCH, which is a
   * different and much more expensive claim.
   */
  human?: boolean;
  /** Human-sized fumbles behind the slip axis. Measured whether or not `human` is set. */
  humanTrials?: number;
  /** Timing error per boundary, input frames. 4 is 31 ms. */
  humanSigma?: number;
  /**
   * Also solve with plain nearest-apple-first forced, and report the spread as
   * route tension. See `Tension`.
   *
   * It is a FLAG and not the default because it doubles the cost: tension is a
   * difference between two whole solves and there is no cheaper way to get it.
   * The completability gate runs on every generated level and has to stay
   * cheap, so anything that doubles it goes behind a flag.
   */
  tension?: boolean;
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
  /**
   * PAR — the fastest run anything has found on this level, seconds, or null
   * when nothing has.
   *
   * It is the same number as `seconds` and it exists separately on purpose: it
   * is the one number in this whole report that is about the LEVEL and nothing
   * else, it is what a level chooser wants to show next to your own best, and
   * giving it its own name is what stops it being read as "how long the solver
   * took", which is `searchSeconds`. Under --optimise it is a real target. From
   * a bare satisficing gate it is an honest upper bound and says so through
   * `parMode`.
   */
  par: number | null;
  /** Whether par came from an optimising run or from one satisficing pass. */
  parMode: LineMode;
  /** Route tension, when it was asked for. See `Job.tension`. */
  tension: Tension | null;
  /**
   * Why there is no score, as a code the chooser can branch on rather than a
   * sentence it has to parse. Null when the level is rated.
   *
   *   'unsolved'     the search did not complete it inside its budget. An
   *                  honest "could not", never a "cannot".
   *   'zero-apples'  the level has no apples, so the whole search is one leg
   *                  straight at the flower and the heuristic is the distance
   *                  to it. See the note in solveOne.
   *   'unverified'   a run was found and did not re-simulate to a finished,
   *                  living bike. That is a bug, not a difficulty.
   */
  unrated: 'unsolved' | 'zero-apples' | 'unverified' | null;
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
  // Every line this run knows about. Difficulty is scored on the most forgiving
  // of them and says which that was; see src/solver/difficulty.ts.
  let lines: Line[] = [];
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
    lines = o.gate.solved && o.gate.masks !== o.best.masks
      ? [{ mode: 'optimised', masks: o.best.masks }, { mode: 'gate', masks: o.gate.masks }]
      : [{ mode: 'optimised', masks: o.best.masks }];
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
    lines = [{ mode: 'gate', masks: r.masks }];
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
    par: null,
    parMode: job.optimise ? 'optimised' : 'gate',
    tension: null,
    unrated: null,
    forcedOrder: forced,
  };

  if (!r.solved) {
    // A ZERO-APPLE LEVEL IS ITS OWN FAILURE AND SAYS SO.
    //
    // With no apples the whole solve collapses to one leg — start to flower —
    // steered by a heuristic that is the geodesic distance to the flower. That
    // is fine on a level where the flower is downhill of you and hopeless on
    // one where getting to it means riding AWAY from it first: every state the
    // search would have to pass through scores worse than the state it came
    // from, and a weighted A* simply does not go there. 26-nothing-to-take is
    // exactly that level and it is provably completable — an input stream
    // driven on a copy of it with a helper apple in the pit finishes the
    // SHIPPED file in 11.61 s.
    //
    // So the report is 'zero-apples' rather than 'unsolved'. The distinction
    // matters because the two have different fixes: 'unsolved' wants more
    // budget, this wants a waypoint. See bin/solve's usage block for what
    // gating this format would take.
    out.unrated = level.apples.length === 0 ? 'zero-apples' : 'unsolved';
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
    out.unrated = 'unverified';
    out.failure = `the solution did not re-verify: ${v.reason ?? 'finished=' + sim.state.finished + ' dead=' + sim.state.dead}`;
    return out;
  }

  // Par is the run that is actually in hand, which under --optimise is the
  // fastest of every round and otherwise is the gate's one pass. `parMode` is
  // what tells those two apart later; without it a 113 s satisficing lap and a
  // 41 s optimised one are the same field with the same name.
  out.par = r.frames / 128;

  // SCORED ON THE LINE WE ACTUALLY HAVE, and it says which one that is.
  //
  // The line measurements — head clearance and the human slip — move by up to
  // fourteen composite points between the gate's line and the optimiser's, and
  // on 21-rollers the FAST line is the roomier one (0.282 m -> 0.586 m). A
  // score that does not record which line it came from is not comparable to
  // another score.
  out.difficulty = scoreDifficulty({
    level, spec,
    lines: lines.length > 0 ? lines : [{ mode: out.parMode, masks: r.masks }],
    // Still the gate's totals even here: the two diagnostic axes are measures
    // of a SEARCH, and measured on an optimising run they would report how long
    // the optimiser was given.
    expansions: effortExpansions, deaths: effortDeaths, routeMetres: effortMetres,
    trials: job.trials, slipTrials: job.humanTrials, slipSigmaFrames: job.humanSigma,
    seed: job.seed, rev: job.rev,
  });

  // ROUTE TENSION: what the apple ORDER is worth, measured and not guessed.
  //
  // A second whole solve with plain nearest-apple-first forced, on the same
  // budget and the same mode as the first, because the spread is only
  // meaningful between two runs found the same way. Behind a flag: it doubles
  // the cost and the cheap gate has to stay cheap.
  if (job.tension && level.apples.length > 1 && forced === null) {
    const order = greedyOrder(level);
    const g = job.optimise
      ? optimiseLevel(level, spec, {
          rev: job.rev, timeBudgetMs: job.timeBudgetMs,
          gateBudgetMs: job.gateBudgetMs ?? Math.min(job.timeBudgetMs / 4, 240000),
          effort: job.effort, branch: job.branch, targetTries: job.targetTries,
          boundVref: job.boundVref ?? 0, forceOrder: order, forceGate: true,
          search: searchOver, onProgress,
        }).best
      : solveLevel(level, spec, {
          rev: job.rev, timeBudgetMs: job.timeBudgetMs,
          strategies: DEFAULT_SOLVE.strategies.map((st) => ({ ...st, budget: Math.round(st.budget * job.effort) })),
          branch: job.branch, targetTries: job.targetTries, forceOrder: order,
          search: searchOver, onProgress,
        });
    out.tension = tensionOf(out.par, g.solved ? g.frames / 128 : null, order);
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
