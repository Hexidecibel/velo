// Optimising: finding a FAST run rather than a run.
//
// solve.ts satisfices, deliberately and at all three levels of its decision —
// first apple order that completes, first strategy that gets a leg done, first
// arrival the search trips over. For the completability gate that is exactly
// right and it is why the gate is cheap enough to run on every generated level.
// It is also why, on the seventeen levels where a person and the solver both
// have a time, the person is faster on sixteen.
//
// The fix is not a better heuristic. It is a bound. Optimising a route is a
// search problem with an enormous branching factor and no admissible heuristic
// worth the name, and the one thing that makes it tractable is having a run
// already in hand: every state can then be asked "could anything through here
// finish sooner than what we have", and on a level where the incumbent is
// decent most of the state space answers no and costs one subtraction to
// reject. So this is branch and bound, and the gate is where the first bound
// comes from.
//
// The shape:
//
//   GATE. One ordinary solve, cheap, satisficing. If it fails the level is
//   reported exactly as the gate reported it — an optimising round cannot make
//   an uncompletable level completable and must never be allowed to make a
//   completable one look worse.
//
//   ROUNDS. Each round is a whole fresh solve with `optimise` on and the
//   ceiling set to the best run so far, so it either returns something strictly
//   faster or it returns nothing. The ladder gets more patient as it climbs —
//   more expansions per search, more arrival states carried between legs — and
//   the ceiling it inherits gets tighter, which is what pays for the patience.
//
//   ANYTIME. Every round is bounded by the clock and the best run is held
//   outside them, so stopping early costs quality and never correctness. A
//   round that runs out of time mid-search returns nothing and the previous
//   best stands.
//
// FRESH NODES PER ROUND, which is the reason this is a loop of solves rather
// than one long search. A node table is never reclaimed inside a solve — the
// mask chain back to the start has to stay walkable — so a single search that
// kept improving for fifteen minutes would hold every state it had ever
// considered. Restarting throws all of it away and keeps only the number that
// matters, which is the ceiling.
import type { Level } from '@/sim/level.ts';
import type { BikeSpec } from '@/sim/spec.ts';
import { SIM_REV } from '@/sim/rev.ts';
import { buildField, geodesic, distAt } from './field.ts';
import { measureLine } from './difficulty.ts';
import { solveLevel, DEFAULT_SOLVE, OPT_STRATEGIES, OPT_SEARCH } from './solve.ts';
import type { SolveOpts, SolveResult } from './solve.ts';
import type { SearchOpts } from './search.ts';

export interface OptimiseOpts {
  rev: number;
  /** Wall clock for the whole thing, gate included, milliseconds. */
  timeBudgetMs: number;
  /**
   * Ceiling on the gate's share of it. The gate is the cheap half and on most
   * levels finishes well inside this; the cap exists so that a level the gate
   * struggles with cannot eat the whole budget and leave nothing to optimise
   * with.
   */
  gateBudgetMs: number;
  /** Multiplies every optimising strategy's expansion budget. */
  effort: number;
  branch: number;
  targetTries: number;
  /**
   * Metres per second the ceiling prunes against. Zero measures it from the
   * gate's own line, which is what you want unless you are testing.
   */
  boundVref: number;
  /** Collect the apples in exactly this order. See SolveOpts.forceOrder. */
  forceOrder?: number[];
  /** Gate with this order too. Off by default; route tension wants it on. */
  forceGate: boolean;
  /**
   * Search knobs every pass inherits — the gate and every round. The macro
   * alphabet lives here, so this is how human mode constrains all of them at
   * once rather than per-pass.
   */
  search: Partial<Omit<SearchOpts, 'budget' | 'deadline'>>;
  onProgress?: (line: string) => void;
}

export const DEFAULT_OPTIMISE: OptimiseOpts = {
  rev: SIM_REV,
  timeBudgetMs: 15 * 60 * 1000,
  gateBudgetMs: 4 * 60 * 1000,
  effort: 1,
  branch: 6,
  targetTries: 3,
  boundVref: 0,
  forceGate: false,
  search: {},
};

export interface OptimiseRound {
  name: string;
  /** Frames of the run this round found, or null if it found nothing better. */
  frames: number | null;
  ms: number;
  expansions: number;
  /** The ceiling the round searched against, in frames. */
  ceil: number;
}

export interface OptimiseResult {
  /** The fastest run found. On a level the gate could not do, the gate's own report. */
  best: SolveResult;
  /** What the cheap satisficing pass got, for the before/after. */
  gateFrames: number;
  gateMs: number;
  /**
   * The gate's own search totals.
   *
   * Difficulty's effort and lethality axes are expansions per route metre and
   * deaths per expansion — measures of what the search experienced — and after
   * this file exists they would otherwise measure how long the OPTIMISER was
   * given, which is a fact about the budget and not about the level. So the
   * gate's numbers are carried out separately and those two axes keep being
   * scored on the one pass whose effort means what it used to mean.
   */
  gateExpansions: number;
  gateDeaths: number;
  gateRouteMetres: number;
  rounds: OptimiseRound[];
  ms: number;
}

/**
 * The rounds, in the order they are ridden, cycled until the clock runs out.
 *
 * Two axes and they are not the same axis. STRATEGY is how the frontier is
 * ordered, from momentum-hungry and greedy to nearly elapsed-time. ORDER is
 * where the apple order comes from, and it has three answers rather than two:
 *
 *   'best'   re-ride the order the best run already uses. Cheap, because there
 *            is no order search to pay for, and it is where most of the seconds
 *            come from once the route has settled.
 *   'greedy' plain nearest-apple-first, recomputed as apples are collected —
 *            the order a player would guess. It is here because the gate's own
 *            order is NOT reliably better than it: forcing plain greedy beats
 *            the free search on 01-first-light (10.32 s against 10.72 s) and
 *            gates 09-runaway four seconds faster, because solve.ts's tier rule
 *            is a guess and sometimes a worse one.
 *   'free'   search the order. Expensive and occasionally worth several
 *            seconds at once.
 *
 * It cycles rather than climbing, and that is a correction to the obvious
 * design rather than a flourish — see the loop below for the measurement that
 * forced it. Each cycle gets more expansions than the last.
 */
const SCHEDULE: { strategy: number; effort: number; branch: number; goalExtra: number; order: 'best' | 'greedy' | 'free' }[] = [
  { strategy: 1, effort: 1, branch: 6, goalExtra: 2500, order: 'best' },
  { strategy: 0, effort: 1, branch: 6, goalExtra: 2500, order: 'best' },
  { strategy: 1, effort: 1, branch: 6, goalExtra: 2500, order: 'greedy' },
  { strategy: 2, effort: 1.5, branch: 8, goalExtra: 4000, order: 'best' },
  { strategy: 1, effort: 1, branch: 6, goalExtra: 2500, order: 'free' },
  { strategy: 3, effort: 2.5, branch: 10, goalExtra: 8000, order: 'best' },
  { strategy: 2, effort: 1.5, branch: 8, goalExtra: 4000, order: 'greedy' },
  { strategy: 2, effort: 1.5, branch: 8, goalExtra: 4000, order: 'free' },
];

export function optimiseLevel(level: Level, spec: BikeSpec, userOpts: Partial<OptimiseOpts> = {}): OptimiseResult {
  const opts: OptimiseOpts = { ...DEFAULT_OPTIMISE, ...userOpts };
  const say = opts.onProgress ?? ((): void => {});
  const t0 = Date.now();
  const deadline = t0 + opts.timeBudgetMs;

  const common: Partial<SolveOpts> = {
    rev: opts.rev,
    search: opts.search,
    onProgress: say,
  };

  say('  gate: looking for any run at all');
  const gate = solveLevel(level, spec, {
    ...common,
    timeBudgetMs: Math.min(opts.gateBudgetMs, opts.timeBudgetMs),
    branch: DEFAULT_SOLVE.branch,
    targetTries: opts.targetTries,
    forceOrder: opts.forceGate ? opts.forceOrder : undefined,
  });
  const gateMs = Date.now() - t0;
  const rounds: OptimiseRound[] = [];

  if (!gate.solved) {
    say(`  gate: no run found in ${(gateMs / 1000).toFixed(0)} s — nothing to optimise`);
    return {
      best: gate, gateFrames: 0, gateMs, rounds, ms: Date.now() - t0,
      gateExpansions: gate.totals.expansions, gateDeaths: gate.totals.deaths, gateRouteMetres: gate.routeMetres,
    };
  }
  say(`  gate: ${(gate.frames / 128).toFixed(2)} s in ${(gateMs / 1000).toFixed(0)} s of search — now beating it`);

  let best = gate;
  // Computed once. The field build behind it is a second or two and every
  // 'greedy' rung wants the same answer.
  const greedy = opts.forceOrder ?? greedyOrder(level);

  // How fast anything on this level goes, as far as anyone knows.
  //
  // The ceiling prunes by turning "metres still to go" into "frames at best",
  // so the speed it assumes decides whether it prunes anything at all. The
  // first version of this used a flat eighteen metres a second, a round number
  // picked before there was a measurement to pick from, and it is roughly twice
  // what these levels support — a bound at twice the real pace rejects nothing.
  // 02-the-long-climb's first round duly spent its entire clock on one leg,
  // because every node in it still looked like it might beat the run in hand.
  //
  // The gate's own line gives a real number. It is not a proof — a faster route
  // might reach a speed this one never does — but it is a measurement of this
  // bike on this geometry, and 15% of headroom on top covers a fair amount of
  // being wrong. Over-pruning costs improvement and never correctness: the
  // incumbent stands whatever the rounds do.
  const gateLine = measureLine(level, spec, gate.masks, opts.rev);
  const boundVref = opts.boundVref > 0 ? opts.boundVref : Math.max(8, gateLine.maxSpeed * 1.15);
  say(`  ceiling prunes at ${boundVref.toFixed(1)} m/s (the gate's line peaked at ${gateLine.maxSpeed.toFixed(1)})`);

  const roundWith = (
    name: string,
    rung: { strategy: number; effort: number; branch: number; goalExtra: number },
    slice: number,
    extra: number,
    order: number[] | undefined = opts.forceOrder,
  ): boolean => {
    const rt = Date.now();
    const base = OPT_STRATEGIES[Math.min(rung.strategy, OPT_STRATEGIES.length - 1)];
    // The gate's ladder rides behind as a fallback: see Strategy.fallback.
    const ladder = [
      { ...base, budget: Math.round(base.budget * opts.effort * rung.effort) },
      ...DEFAULT_SOLVE.strategies.map((st) => ({ ...st, budget: Math.round(st.budget * opts.effort), fallback: true })),
    ];
    say(`  ${name}: ceiling ${(best.frames / 128).toFixed(2)} s, ${(slice / 1000).toFixed(0)} s of clock, [${base.name}]`);
    // A round is an OPTIONAL improvement on a run already in hand, so a round
    // that throws is a round that found nothing and never a level that failed.
    // The realistic thrower is the dedupe key space check on a very large level
    // at a fine cell size, and losing the incumbent to it would turn a good
    // answer into no answer.
    let r;
    try {
      r = solveLevel(level, spec, {
        ...common,
        optimise: true,
        boundVref,
        timeCeil: best.frames,
        timeBudgetMs: slice,
        strategies: ladder,
        search: { ...OPT_SEARCH, goalExtra: rung.goalExtra, ...opts.search },
        branch: Math.max(opts.branch, rung.branch) + extra,
        targetTries: opts.targetTries,
        // A round that spends its whole clock on one leg returns nothing, because
        // a partial route is worth zero against a ceiling — and a cap at one
        // even share is the same failure from the other side, because the leg
        // that decides a level is never an even share of it. 04-switchback's
        // gate spends a third of its search on one apple and a ninth of the
        // round was not enough to ride the same apple faster. A third is.
        maxLegMs: Math.max(6000, Math.round(slice * 0.33)),
        // Re-routing exists for legs nothing can ride, and an optimising round is
        // by construction riding a leg something already rode. Blocking the map
        // here would only hide the route that works.
        reroutes: 0,
        forceOrder: order,
      });
    } catch (e) {
      say(`  ${name}: the round failed outright (${e instanceof Error ? e.message : String(e)}) — keeping what we had`);
      rounds.push({ name, frames: null, ms: Date.now() - rt, expansions: 0, ceil: best.frames });
      return false;
    }
    rounds.push({
      name, frames: r.solved ? r.frames : null, ms: Date.now() - rt,
      expansions: r.totals.expansions, ceil: best.frames,
    });
    if (r.solved && r.frames < best.frames) {
      say(`  ${name}: ${(r.frames / 128).toFixed(2)} s (was ${(best.frames / 128).toFixed(2)} s)`);
      best = r;
      return true;
    }
    say(`  ${name}: nothing faster`);
    return false;
  };

  // The schedule cycles rather than climbing, and that is a correction to the
  // obvious design rather than a flourish.
  //
  // A ladder from greedy to near-Dijkstra reads right and behaves badly: on
  // 01-first-light the greedy round took 13.69 s to 11.88 s and then both of
  // the patient rounds returned NOTHING, because at a weight near 1.0 the leg
  // to the last apple is a search they cannot finish inside any sane leg cap.
  // The strategy that improved the run was the first one, and the ladder never
  // went back to it — against the tighter ceiling it had itself earned, which
  // is exactly the condition under which it would have found more.
  //
  // So every strategy gets another turn, each time against whatever ceiling now
  // stands, and each cycle is given more expansions than the last. The clock
  // is the only thing that ends it.
  // A round has to ride the same legs the gate rode, so a round given much less
  // than the gate took cannot finish a route — and a round that cannot finish a
  // route is worth nothing against a ceiling. Eight rounds if the gate was
  // cheap, fewer and longer if it was not. Computed once from the whole
  // optimising budget rather than from the clock as it stands: a share of what
  // REMAINS shrinks geometrically, which on 01-first-light turned six useful
  // rounds into fifteen too short to finish a route.
  const optimiseMs = Math.max(0, deadline - Date.now());
  // At LEAST what the gate took, and by a margin, because the round has to ride
  // the same legs AND beat a ceiling while doing it. At 0.9 of the gate's time
  // 04-switchback returned nothing from eight rounds in a row, every one of
  // them stalling two metres short of the same apple with the clock gone.
  // Capped so that three rounds always fit, because one enormous round that
  // finds nothing is the worst way to spend the budget.
  const roundMs = Math.min(Math.max(gateMs * 1.2, optimiseMs / 8), Math.max(30000, optimiseMs / 3));
  for (let cycle = 0; ; cycle++) {
    let done = false;
    for (const rung of SCHEDULE) {
      const remaining = deadline - Date.now();
      if (remaining < 15000) { done = true; break; }
      const slice = Math.min(remaining, roundMs);
      const n = rounds.length + 1;
      const order = opts.forceOrder
        ?? (rung.order === 'best' ? [...best.appleOrder] : rung.order === 'greedy' ? greedy : undefined);
      roundWith(`round ${n} [${rung.order}]`, { ...rung, effort: rung.effort * (1 + cycle) }, slice, cycle, order);
    }
    if (done) break;
  }

  return {
    best, gateFrames: gate.frames, gateMs, rounds, ms: Date.now() - t0,
    gateExpansions: gate.totals.expansions, gateDeaths: gate.totals.deaths, gateRouteMetres: gate.routeMetres,
  };
}

/**
 * The obvious order: nearest apple first, by the same geodesic the search
 * steers on, recomputed from each apple as it is collected.
 *
 * This is the baseline route tension is measured against, and "obvious" has to
 * mean obvious to a PLAYER — so it is greedy nearest, with none of the tier
 * rule solve.ts uses to keep from stranding apples on a shelf. A level where
 * that rule is load-bearing is exactly a level with route tension in it.
 */
export function greedyOrder(level: Level, fieldCell = 0.5): number[] {
  const field = buildField(level, fieldCell, 0.3);
  const fields = level.apples.map((a) => geodesic(field, a.x, a.y));
  const dist = (t: number, x: number, y: number): number =>
    distAt(field, fields[t], x, y, level.apples[t].x, level.apples[t].y);
  const left = level.apples.map((_, i) => i);
  const out: number[] = [];
  let x = level.start.x;
  let y = level.start.y;
  while (left.length > 0) {
    let bi = 0;
    let bd = Infinity;
    for (let k = 0; k < left.length; k++) {
      const d = dist(left[k], x, y);
      const v = Number.isFinite(d) ? d : Infinity;
      if (v < bd) { bd = v; bi = k; }
    }
    const t = left.splice(bi, 1)[0];
    out.push(t);
    x = level.apples[t].x;
    y = level.apples[t].y;
  }
  return out;
}
